/**
 * Layer management for the projection MapLibre instance.
 * Reuses the same style bridge and layer manager logic as GIS,
 * and adds WMTS raster source support for projection overlays.
 *
 * Masking: loads mask GeoJSON via layerRegistry.getLayerMaskAssetUrl, normalizes to WGS84,
 * and sets raster source bounds to the mask bbox so tile requests stay geographically bounded
 * (polygon-accurate include clipping needs a future MapLibre clip/stencil path).
 *
 * mask.exclude: MapLibre cannot subtract a polygon from raster tiles (no per-pixel inverse).
 * We still apply the same mask GeoJSON bbox as `bounds` on the raster source so rendering
 * stays near the AOI instead of unbounded global/projection-wide requests. Tiles still draw
 * inside the excluded polygon; true holes require canvas WmtsLayerRenderer or future clip layers.
 *
 * Fail closed: any WMTS with a mask config must obtain a bbox from the mask asset; if the
 * URL is missing, fetch fails, or geometry cannot produce bounds, the layer is omitted (never
 * added as an unbounded global raster).
 */
import { CoordUtils } from "../map-utils/coordinate-utils.js";
import { applyLayerGroupsToMap } from "../map/maplibre-layer-manager.js";
import { formatFullLayerIdFromGroupLayer } from "../shared/layer-state-helper.js";
import layerRegistry from "../shared/layer-registry.js";

const wmtsStateByMap = new WeakMap(); // map -> Set<fullLayerId>
const wmtsPendingIncludeByMap = new WeakMap(); // map -> Set<fullLayerId> (mask include path, async)
const wmtsMaskEpochByMap = new WeakMap(); // map -> Map<fullId, number>

function asArrayLayerGroups(layerGroups) {
  if (Array.isArray(layerGroups)) return layerGroups;
  if (layerGroups && typeof layerGroups === "object") return Object.values(layerGroups);
  return [];
}

function cloneGroupsWithWmtsDisabled(groups) {
  return groups.map((group) => ({
    ...group,
    layers: (group.layers || []).map((layer) => {
      const fullId = formatFullLayerIdFromGroupLayer(group, layer);
      if (!fullId) {
        return layer;
      }
      const cfg = layerRegistry.getLayerConfig(fullId);
      if (!cfg) return layer;
      if (cfg.format === "wmts") return { ...layer, enabled: false };
      if (cfg.format === "image" || cfg.geometryType === "image") {
        return { ...layer, enabled: false };
      }
      return layer;
    }),
  }));
}

function getOrCreateWmtsState(map) {
  let state = wmtsStateByMap.get(map);
  if (!state) {
    state = new Set();
    wmtsStateByMap.set(map, state);
  }
  return state;
}

function addPendingInclude(map, fullId) {
  let s = wmtsPendingIncludeByMap.get(map);
  if (!s) {
    s = new Set();
    wmtsPendingIncludeByMap.set(map, s);
  }
  s.add(fullId);
}

function removePendingInclude(map, fullId) {
  wmtsPendingIncludeByMap.get(map)?.delete(fullId);
}

function bumpWmtsMaskEpoch(map, fullId) {
  let idMap = wmtsMaskEpochByMap.get(map);
  if (!idMap) {
    idMap = new Map();
    wmtsMaskEpochByMap.set(map, idMap);
  }
  const next = (idMap.get(fullId) || 0) + 1;
  idMap.set(fullId, next);
  return next;
}

function getWmtsMaskEpoch(map, fullId) {
  return wmtsMaskEpochByMap.get(map)?.get(fullId) || 0;
}

function resolveEnabledWmtsFullIds(layerGroups) {
  const enabled = new Set();
  for (const group of asArrayLayerGroups(layerGroups)) {
    if (!group) continue;
    for (const layer of group.layers || []) {
      if (!layer || !layer.enabled) continue;
      const fullId = formatFullLayerIdFromGroupLayer(group, layer);
      if (!fullId) continue;
      const cfg = layerRegistry.getLayerConfig(fullId);
      if (!cfg || cfg.format !== "wmts" || !cfg.wmts) continue;
      enabled.add(fullId);
    }
  }
  return enabled;
}

function getResolvedMaskConfig(layerConfig, fullId) {
  if (typeof layerRegistry.getLayerMaskConfig === "function") {
    const fromRegistry = layerRegistry.getLayerMaskConfig(fullId);
    if (fromRegistry) return fromRegistry;
  }
  return layerConfig.mask || null;
}

/** Mask GeoJSON for MapLibre must be WGS84 lon/lat. */
function normalizeMaskGeoJsonForMapLibre(geojson) {
  if (!geojson || !geojson.features) return geojson;
  const crs = (geojson.crs?.properties?.name || "").toUpperCase();
  const first = CoordUtils.getFirstCoordinate(geojson);
  const looksWgs84 =
    first && Math.abs(first[0]) < 1000 && Math.abs(first[1]) < 1000;
  const looksItm =
    first && Math.abs(first[0]) >= 1000 && Math.abs(first[1]) >= 1000;
  const crsSaysItm = crs.includes("2039") || crs.includes("ITM");

  if (looksItm || crsSaysItm) {
    return CoordUtils.transformGeojsonToWgs84(geojson);
  }
  if (looksWgs84 || crs.includes("4326") || crs.includes("WGS")) {
    return geojson;
  }
  return geojson;
}

function computeLngLatBBox(geojson) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  function consumeRing(ring) {
    if (!Array.isArray(ring)) return;
    for (const pt of ring) {
      if (!pt || typeof pt[0] !== "number") continue;
      minLon = Math.min(minLon, pt[0]);
      maxLon = Math.max(maxLon, pt[0]);
      minLat = Math.min(minLat, pt[1]);
      maxLat = Math.max(maxLat, pt[1]);
    }
  }

  function consumeGeom(g) {
    if (!g) return;
    if (g.type === "Polygon") {
      for (const ring of g.coordinates || []) consumeRing(ring);
    } else if (g.type === "MultiPolygon") {
      for (const poly of g.coordinates || []) {
        for (const ring of poly) consumeRing(ring);
      }
    }
  }

  for (const f of geojson.features || []) {
    consumeGeom(f.geometry);
  }

  if (!Number.isFinite(minLon)) return null;
  return [minLon, minLat, maxLon, maxLat];
}

function expandLngLatBoundsFromGeoJson(geojson, padDeg) {
  const b = computeLngLatBBox(geojson);
  if (!b) return null;
  const [minLon, minLat, maxLon, maxLat] = b;
  const p = padDeg ?? 0.002;
  return [
    Math.max(-180, minLon - p),
    Math.max(-85, minLat - p),
    Math.min(180, maxLon + p),
    Math.min(85, maxLat + p),
  ];
}

function removeWmtsRasterOnly(map, fullId) {
  const sourceId = `wmts__${fullId}`;
  const layerId = `${sourceId}__raster`;
  if (map.getLayer(layerId)) {
    map.removeLayer(layerId);
  }
  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  }
}

async function applyWmtsIncludeMaskFromRegistry(map, layerConfig, fullId, epochAtStart) {
  const state = getOrCreateWmtsState(map);
  const maskCfg = getResolvedMaskConfig(layerConfig, fullId);
  const url =
    maskCfg && typeof layerRegistry.getLayerMaskAssetUrl === "function"
      ? layerRegistry.getLayerMaskAssetUrl(fullId, maskCfg)
      : null;

  let bounds = null;
  let failReason = null;
  if (!url) {
    failReason = "no mask asset URL";
  } else {
    try {
      const res = await fetch(url);
      if (res.ok) {
        let gj = await res.json();
        gj = normalizeMaskGeoJsonForMapLibre(gj);
        bounds = expandLngLatBoundsFromGeoJson(gj, 0.002);
        if (!bounds) {
          failReason = "mask geometry produced no bbox";
        }
      } else {
        failReason = `mask fetch HTTP ${res.status}`;
      }
    } catch (e) {
      console.warn(`[maplibre-projection-layers] Mask fetch failed for ${fullId}`, e);
      failReason = "mask fetch error";
    }
  }

  if (getWmtsMaskEpoch(map, fullId) !== epochAtStart) {
    return;
  }

  const sourceId = `wmts__${fullId}`;
  const layerId = `${sourceId}__raster`;

  removeWmtsRasterOnly(map, fullId);

  if (getWmtsMaskEpoch(map, fullId) !== epochAtStart) {
    return;
  }

  if (!bounds) {
    console.warn(
      `[maplibre-projection-layers] Masked WMTS ${fullId} omitted (fail closed): ${failReason || "unknown"}.`,
    );
    return;
  }

  try {
    const spec = {
      type: "raster",
      tiles: [layerConfig.wmts.urlTemplate],
      tileSize: 256,
      attribution: layerConfig.wmts.attribution || "",
      bounds,
    };
    // For mask.exclude, `bounds` is still the mask geometry bbox only (see file header): strongest
    // practical cap under MapLibre without inverse raster clip—not a polygon hole.
    map.addSource(sourceId, spec);
    if (getWmtsMaskEpoch(map, fullId) !== epochAtStart) {
      removeWmtsRasterOnly(map, fullId);
      return;
    }
    map.addLayer({
      id: layerId,
      type: "raster",
      source: sourceId,
      paint: {
        "raster-opacity": layerConfig.wmts.opacity ?? 1.0,
      },
    });
    state.add(fullId);
  } catch (error) {
    console.warn(`[maplibre-projection-layers] Failed to add masked WMTS (include) ${fullId}`, error);
    removeWmtsRasterOnly(map, fullId);
    state.delete(fullId);
  }
}

export function syncProjectionLayers(map, layerGroups, options = {}) {
  if (!map) return;

  const groups = asArrayLayerGroups(layerGroups);
  const groupsWithoutWmts = cloneGroupsWithWmtsDisabled(groups);
  const opts = options && typeof options === "object" ? options : {};
  const { transition, ...restLayerStyleOptions } = opts;
  const layerStyleOptions = {
    applyProjectionHatchPresentation: true,
    ...restLayerStyleOptions,
  };
  if (transition && typeof transition === "object") {
    layerStyleOptions.transition = { ...transition };
  }
  applyLayerGroupsToMap(map, groupsWithoutWmts, layerStyleOptions);

  const wmtsState = getOrCreateWmtsState(map);
  const enabledWmts = resolveEnabledWmtsFullIds(groups);

  for (const fullId of enabledWmts) {
    const cfg = layerRegistry.getLayerConfig(fullId);
    if (cfg) {
      addWmtsSource(map, cfg);
    }
  }

  const pending = wmtsPendingIncludeByMap.get(map);
  const tracked = new Set([...wmtsState, ...(pending || [])]);
  for (const fullId of tracked) {
    if (!enabledWmts.has(fullId)) {
      removeWmtsSource(map, fullId);
      wmtsState.delete(fullId);
      removePendingInclude(map, fullId);
    }
  }
}

export function addWmtsSource(map, layerConfig) {
  if (!map || !layerConfig?.wmts) return;

  const fullId = layerConfig.fullId || `${layerConfig.groupId}.${layerConfig.id}`;
  const sourceId = `wmts__${fullId}`;
  const layerId = `${sourceId}__raster`;
  const state = getOrCreateWmtsState(map);
  const maskCfg = getResolvedMaskConfig(layerConfig, fullId);

  const sourceExistedAtStart = !!map.getSource(sourceId);
  const layerExistedAtStart = !!map.getLayer(layerId);

  if (maskCfg) {
    if (sourceExistedAtStart && layerExistedAtStart) {
      map.setPaintProperty(layerId, "raster-opacity", layerConfig.wmts.opacity ?? 1.0);
      map.setLayoutProperty(layerId, "visibility", "visible");
      state.add(fullId);
      return;
    }
    addPendingInclude(map, fullId);
    const epoch = bumpWmtsMaskEpoch(map, fullId);
    void applyWmtsIncludeMaskFromRegistry(map, layerConfig, fullId, epoch).finally(() => {
      removePendingInclude(map, fullId);
    });
    return;
  }

  if (sourceExistedAtStart && layerExistedAtStart) {
    map.setPaintProperty(layerId, "raster-opacity", layerConfig.wmts.opacity ?? 1.0);
    map.setLayoutProperty(layerId, "visibility", "visible");
    state.add(fullId);
    return;
  }

  try {
    if (!sourceExistedAtStart) {
      map.addSource(sourceId, {
        type: "raster",
        tiles: [layerConfig.wmts.urlTemplate],
        tileSize: 256,
        attribution: layerConfig.wmts.attribution || "",
      });
    }
    if (!layerExistedAtStart) {
      map.addLayer({
        id: layerId,
        type: "raster",
        source: sourceId,
        paint: {
          "raster-opacity": layerConfig.wmts.opacity ?? 1.0,
        },
      });
    }
    state.add(fullId);
  } catch (error) {
    console.warn(`[maplibre-projection-layers] Failed to add WMTS for ${fullId}`, error);
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
    if (!sourceExistedAtStart && map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }
    state.delete(fullId);
  }
}

function removeWmtsSource(map, fullId) {
  bumpWmtsMaskEpoch(map, fullId);
  const sourceId = `wmts__${fullId}`;
  const layerId = `${sourceId}__raster`;
  if (map.getLayer(layerId)) {
    map.removeLayer(layerId);
  }
  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  }
  removePendingInclude(map, fullId);
}
