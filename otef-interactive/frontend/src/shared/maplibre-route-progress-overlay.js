/**
 * GeoJSON + lineMetrics + line-gradient overlays for route “trail” animation
 * (Oct 7 ציר layers and any other pack layer with MODE trail + GeoJSON data URL).
 * Keeps PMTiles vector styling untouched; dims base line opacity while the overlay runs.
 */

import layerRegistry from "./layer-registry.js";
import {
  collectLineLayerIdsForFullLayer,
  fullLayerIdAnimationAliases,
  usesRouteProgressOverlay,
} from "./maplibre-flow-animation.js";

/** @typedef {{ routeKey: string, sourceId: string, lineLayerId: string, baseLineIds: string[], baselineOpacity: Map<string, unknown>, loopMs: number, color: string, lineWidth: number, headSourceId: string|null, headLayerId: string|null, headRadius: number, hideHeadAtEnd: boolean, paths: Array<{ coords: [number, number][], cum: number[], total: number }> }} RouteOverlayEntry */

/** @type {WeakMap<object, Map<string, RouteOverlayEntry>>} */
const overlaysByMap = new WeakMap();
/** @type {Set<object>} */
const mapsWithActiveOverlays = new Set();

let rafId = null;
let rafRunning = false;

function asGroupsArray(layerGroups) {
  if (Array.isArray(layerGroups)) return layerGroups;
  if (layerGroups && typeof layerGroups === "object") return Object.values(layerGroups);
  return [];
}

function isLayerEnabledIgnoringGroupGate(layerGroups, fullLayerId) {
  if (typeof fullLayerId !== "string" || !fullLayerId) return false;
  const dot = fullLayerId.indexOf(".");
  if (dot <= 0 || dot >= fullLayerId.length - 1) return false;
  const groupId = fullLayerId.slice(0, dot);
  const layerId = fullLayerId.slice(dot + 1);
  const group = layerGroups.find((g) => g && g.id === groupId);
  if (!group || !Array.isArray(group.layers)) return false;
  const layer = group.layers.find((l) => l && l.id === layerId);
  return !!(layer && layer.enabled);
}

function computeDesiredRouteKeys(animState, layerGroups) {
  const state = animState && typeof animState === "object" ? animState : {};
  const groups = asGroupsArray(layerGroups);
  /** @type {Set<string>} */
  const desired = new Set();
  for (const key of Object.keys(state)) {
    if (!state[key] || !usesRouteProgressOverlay(key)) continue;
    const rk = routeProgressGroupKey(key) || key;
    let layerOn = false;
    for (const alias of fullLayerIdAnimationAliases(key)) {
      if (isLayerEnabledIgnoringGroupGate(groups, alias)) {
        layerOn = true;
        break;
      }
    }
    if (layerOn) desired.add(rk);
  }
  return desired;
}

/**
 * Stable key for the two Oct 7 axis routes (hyphen / underscore ציר spellings merge).
 * @param {string} fullLayerId
 * @returns {string|null}
 */
export function routeProgressGroupKey(fullLayerId) {
  if (typeof fullLayerId !== "string") return null;
  const m = fullLayerId.match(/^october_7th\.(.+?)(?:-|_)ציר$/);
  return m ? `october_7th::${m[1]}` : fullLayerId;
}

function pickCanonicalFullLayerIdForData(routeKey, getLayerDataUrl) {
  const candidates = new Set();
  if (routeKey.includes("::")) {
    const base = routeKey.slice("october_7th::".length);
    candidates.add(`october_7th.${base}_ציר`);
    candidates.add(`october_7th.${base}-ציר`);
  } else {
    for (const a of fullLayerIdAnimationAliases(routeKey)) {
      candidates.add(a);
    }
  }
  for (const id of candidates) {
    if (!usesRouteProgressOverlay(id)) continue;
    const url = getLayerDataUrl(id);
    if (url) return id;
  }
  for (const id of candidates) {
    const url = getLayerDataUrl(id);
    if (url) return id;
  }
  return null;
}

function resolveTrailLoopMs(fullLayerId) {
  const overrides =
    typeof globalThis !== "undefined" &&
    globalThis.MapProjectionConfig?.PROJECTION_LAYER_ANIMATIONS?.LAYER_OVERRIDES;
  if (!overrides || typeof overrides !== "object") return 8000;
  for (const cand of fullLayerIdAnimationAliases(fullLayerId)) {
    const cfg = overrides[cand];
    if (cfg && Number.isFinite(cfg.SPEED) && cfg.SPEED > 0) {
      return Math.max(2500, 90000 / cfg.SPEED);
    }
  }
  return 8000;
}

function resolveTrailHeadConfig(fullLayerId) {
  const overrides =
    typeof globalThis !== "undefined" &&
    globalThis.MapProjectionConfig?.PROJECTION_LAYER_ANIMATIONS?.LAYER_OVERRIDES;
  const fallback = { headRadius: 1.6, hideHeadAtEnd: true };
  if (!overrides || typeof overrides !== "object") return fallback;
  for (const cand of fullLayerIdAnimationAliases(fullLayerId)) {
    const cfg = overrides[cand];
    if (!cfg || typeof cfg !== "object") continue;
    return {
      headRadius:
        Number.isFinite(cfg.HEAD_RADIUS) && cfg.HEAD_RADIUS >= 0 ? Number(cfg.HEAD_RADIUS) : fallback.headRadius,
      hideHeadAtEnd: cfg.HIDE_HEAD_AT_END !== false,
    };
  }
  return fallback;
}

function normalizeGeoJsonForLineMetrics(geojson) {
  if (!geojson || typeof geojson !== "object") return null;
  let gj = geojson;
  const crs = gj.crs?.properties?.name || "";
  if (
    (crs.includes("2039") || crs.includes("ITM")) &&
    typeof globalThis !== "undefined" &&
    globalThis.CoordUtils &&
    typeof globalThis.CoordUtils.transformGeojsonToWgs84 === "function"
  ) {
    gj = globalThis.CoordUtils.transformGeojsonToWgs84(gj);
  }
  const feats = Array.isArray(gj.features) ? gj.features : null;
  if (!feats || feats.length === 0) {
    if (gj.type === "Feature" && gj.geometry) {
      return { type: "FeatureCollection", features: [gj] };
    }
    if (gj.type === "LineString" || gj.type === "MultiLineString") {
      return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: gj }] };
    }
    return null;
  }
  const lineFeatures = feats.filter((f) => {
    const g = f && f.geometry;
    if (!g) return false;
    return g.type === "LineString" || g.type === "MultiLineString";
  });
  if (lineFeatures.length === 0) return null;
  return { type: "FeatureCollection", features: lineFeatures };
}

function getLineCoordinatesFromFeature(feature) {
  const geom = feature && feature.geometry;
  if (!geom || !Array.isArray(geom.coordinates)) return [];
  if (geom.type === "LineString") {
    return geom.coordinates.filter(
      (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]),
    );
  }
  if (geom.type === "MultiLineString") {
    let best = [];
    for (const part of geom.coordinates) {
      if (!Array.isArray(part)) continue;
      const coords = part.filter(
        (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]),
      );
      if (coords.length > best.length) best = coords;
    }
    return best;
  }
  return [];
}

function collectPathCoordinates(featureCollection) {
  const features = Array.isArray(featureCollection?.features) ? featureCollection.features : [];
  const out = [];
  for (const feature of features) {
    const coords = getLineCoordinatesFromFeature(feature);
    if (coords.length > 1) out.push(coords);
  }
  return out;
}

function segmentLengthApprox(a, b) {
  const latScale = Math.cos((((a[1] + b[1]) * Math.PI) / 180) / 2);
  const dx = (b[0] - a[0]) * Math.max(0.0001, latScale);
  const dy = b[1] - a[1];
  return Math.hypot(dx, dy);
}

function buildPathMetrics(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return { cum: [0], total: 0 };
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + segmentLengthApprox(coords[i - 1], coords[i]));
  }
  return { cum, total: cum[cum.length - 1] || 0 };
}

function pointAtProgress(coords, cum, total, t) {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  if (!Number.isFinite(total) || total <= 0 || coords.length === 1) return coords[0];
  const clamped = Math.min(1, Math.max(0, t));
  const target = clamped * total;
  let seg = 0;
  while (seg < cum.length - 1 && cum[seg + 1] < target) seg++;
  const a = coords[seg];
  const b = coords[Math.min(seg + 1, coords.length - 1)];
  const segStart = cum[seg];
  const segEnd = cum[Math.min(seg + 1, cum.length - 1)];
  const segLen = Math.max(1e-12, segEnd - segStart);
  const local = Math.min(1, Math.max(0, (target - segStart) / segLen));
  return [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local];
}

function emptyPointFeatureCollection() {
  return { type: "FeatureCollection", features: [] };
}

function pointsFeatureCollection(coords) {
  if (!Array.isArray(coords) || coords.length === 0) return emptyPointFeatureCollection();
  return {
    type: "FeatureCollection",
    features: coords
      .filter((coord) => coord && Number.isFinite(coord[0]) && Number.isFinite(coord[1]))
      .map((coord) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: coord },
      })),
  };
}

function toOpaqueAndTransparent(color) {
  const c = typeof color === "string" ? color.trim() : "#cc0000";
  if (c.startsWith("rgba(")) {
    const m = /^rgba\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*[\d.]+\s*\)$/i.exec(c);
    if (m) {
      return {
        opaque: `rgb(${m[1]},${m[2]},${m[3]})`,
        transparent: `rgba(${m[1]},${m[2]},${m[3]},0)`,
      };
    }
  }
  if (c.startsWith("#") && (c.length === 7 || c.length === 4)) {
    const hex = c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c;
    const n = parseInt(hex.slice(1), 16);
    if (Number.isFinite(n)) {
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      return { opaque: `rgb(${r},${g},${b})`, transparent: `rgba(${r},${g},${b},0)` };
    }
  }
  return { opaque: c, transparent: "rgba(200,24,24,0)" };
}

function buildLineGradientExpression(t, color) {
  const tt = Math.min(1, Math.max(0, t));
  const { opaque, transparent } = toOpaqueAndTransparent(color);
  // MapLibre requires strictly ascending interpolate stop inputs.
  // Near edges (tt≈0 or tt≈1), duplicate stops (e.g. hi===tt or tt===0/1) fail validation.
  const eps = 0.00015;
  if (tt <= eps) {
    return ["interpolate", ["linear"], ["line-progress"], 0, opaque, eps, transparent, 1, transparent];
  }
  if (tt >= 1 - eps) {
    return ["interpolate", ["linear"], ["line-progress"], 0, opaque, 1 - eps, opaque, 1, transparent];
  }
  const lo = tt;
  const hi = tt + eps;
  return ["interpolate", ["linear"], ["line-progress"], 0, opaque, lo, opaque, hi, transparent, 1, transparent];
}

function layerIdsForSource(map, sourceId) {
  const out = [];
  try {
    const style = typeof map.getStyle === "function" ? map.getStyle() : null;
    const layers = Array.isArray(style?.layers) ? style.layers : [];
    for (const ly of layers) {
      if (ly && ly.source === sourceId && typeof ly.id === "string") {
        out.push(ly.id);
      }
    }
  } catch (_) {
    /* ignore */
  }
  return out;
}

function removeOverlayEntry(map, routeKey) {
  const bundle = overlaysByMap.get(map);
  if (!bundle) return;
  const entry = bundle.get(routeKey);
  if (!entry) return;
  bundle.delete(routeKey);

  for (const lid of entry.baseLineIds) {
    try {
      if (typeof map.getLayer === "function" && map.getLayer(lid)) {
        const base = entry.baselineOpacity.get(lid);
        if (base === undefined) {
          if (typeof map.removePaintProperty === "function") {
            map.removePaintProperty(lid, "line-opacity");
          } else {
            map.setPaintProperty(lid, "line-opacity", 1);
          }
        } else {
          map.setPaintProperty(lid, "line-opacity", base);
        }
      }
    } catch (_) {
      /* ignore */
    }
  }

  try {
    const still = layerIdsForSource(map, entry.sourceId);
    for (const id of still) {
      if (typeof map.getLayer === "function" && map.getLayer(id)) {
        map.removeLayer(id);
      }
    }
    if (typeof map.getSource === "function" && map.getSource(entry.sourceId)) {
      map.removeSource(entry.sourceId);
    }
    if (entry.headSourceId) {
      const headLayers = layerIdsForSource(map, entry.headSourceId);
      for (const id of headLayers) {
        if (typeof map.getLayer === "function" && map.getLayer(id)) {
          map.removeLayer(id);
        }
      }
      if (typeof map.getSource === "function" && map.getSource(entry.headSourceId)) {
        map.removeSource(entry.headSourceId);
      }
    }
  } catch (_) {
    /* ignore */
  }

  if (bundle.size === 0) {
    overlaysByMap.delete(map);
    mapsWithActiveOverlays.delete(map);
  }
}

function stopGlobalRafIfIdle() {
  if (mapsWithActiveOverlays.size === 0 && rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
    rafRunning = false;
  }
}

function tickOverlays(ts) {
  rafId = null;
  if (mapsWithActiveOverlays.size === 0) {
    rafRunning = false;
    return;
  }
  const tMs = Number.isFinite(ts) ? ts : performance.now();
  for (const map of [...mapsWithActiveOverlays]) {
    const bundle = overlaysByMap.get(map);
    if (!bundle || bundle.size === 0) {
      mapsWithActiveOverlays.delete(map);
      continue;
    }
    for (const [rk, entry] of bundle) {
      const u = (tMs % entry.loopMs) / entry.loopMs;
      try {
        if (typeof map.getLayer === "function" && map.getLayer(entry.lineLayerId)) {
          map.setPaintProperty(entry.lineLayerId, "line-gradient", buildLineGradientExpression(u, entry.color));
        }
        if (entry.headSourceId && entry.paths.length > 0) {
          const headSource = typeof map.getSource === "function" ? map.getSource(entry.headSourceId) : null;
          if (headSource && typeof headSource.setData === "function") {
            const hide = entry.hideHeadAtEnd && u >= 0.999;
            if (hide) {
              headSource.setData(emptyPointFeatureCollection());
            } else {
              const coords = entry.paths
                .map((path) => pointAtProgress(path.coords, path.cum, path.total, u))
                .filter((coord) => !!coord);
              headSource.setData(pointsFeatureCollection(coords));
            }
          }
        }
      } catch (_) {
        removeOverlayEntry(map, rk);
      }
    }
  }
  if (mapsWithActiveOverlays.size > 0) {
    rafId = requestAnimationFrame(tickOverlays);
  } else {
    rafRunning = false;
  }
}

function ensureGlobalRaf() {
  if (rafRunning) return;
  rafRunning = true;
  rafId = requestAnimationFrame(tickOverlays);
}

function sampleLinePaintFromBase(map, baseLineIds) {
  let color = "#b42318";
  let width = 4;
  for (const lid of baseLineIds) {
    try {
      if (!map.getLayer(lid)) continue;
      const c = map.getPaintProperty(lid, "line-color");
      if (typeof c === "string") color = c;
      const w = map.getPaintProperty(lid, "line-width");
      if (typeof w === "number" && Number.isFinite(w) && w > 0) width = w;
      break;
    } catch (_) {
      /* continue */
    }
  }
  return { color, width };
}

/**
 * Sync GeoJSON route-progress overlays from animation + layer visibility state.
 *
 * @param {import('maplibre-gl').Map} map
 * @param {Record<string, boolean>|null|undefined} animState
 * @param {unknown} layerGroups
 * @param {{
 *   getLayerDataUrl?: (fullId: string) => string | null;
 *   visibilityLayerGroups?: unknown;
 * }} [deps] Optional `visibilityLayerGroups`: raw API groups for `resolveLayerState` when `layerGroups` is GIS-filtered.
 */
export async function syncRouteProgressOverlaysToMap(map, animState, layerGroups, deps = {}) {
  if (!map || typeof map.getStyle !== "function") return;
  const getLayerDataUrl =
    typeof deps.getLayerDataUrl === "function" ? deps.getLayerDataUrl : (id) => layerRegistry.getLayerDataUrl(id);

  const visibilityGroups = asGroupsArray(
    deps.visibilityLayerGroups != null ? deps.visibilityLayerGroups : layerGroups,
  );
  const desired = computeDesiredRouteKeys(animState, visibilityGroups);

  let bundle = overlaysByMap.get(map);
  if (!bundle) {
    bundle = new Map();
    overlaysByMap.set(map, bundle);
  }

  for (const rk of [...bundle.keys()]) {
    if (!desired.has(rk)) {
      removeOverlayEntry(map, rk);
    }
  }

  for (const routeKey of desired) {
    let b = overlaysByMap.get(map);
    if (!b) {
      b = new Map();
      overlaysByMap.set(map, b);
    }
    if (b.has(routeKey)) continue;

    const canonical = pickCanonicalFullLayerIdForData(routeKey, getLayerDataUrl);
    if (!canonical) continue;

    const dataUrl = getLayerDataUrl(canonical);
    if (!dataUrl) continue;

    const baseLineIds = collectLineLayerIdsForFullLayer(map, canonical);
    const loopMs = resolveTrailLoopMs(canonical);

    const sourceId = `otef-rp__${canonical.replace(/\./g, "__")}`;
    const lineLayerId = `${sourceId}__line`;
    const headSourceId = `${sourceId}__head`;
    const headLayerId = `${sourceId}__head__circle`;

    try {
      const res = await fetch(dataUrl);
      if (!res.ok) continue;
      const raw = await res.json();
      const normalized = normalizeGeoJsonForLineMetrics(raw);
      if (!normalized) continue;
      const pathCoordsList = collectPathCoordinates(normalized);
      const paths = pathCoordsList
        .map((coords) => {
          const metrics = buildPathMetrics(coords);
          return { coords, cum: metrics.cum, total: metrics.total };
        })
        .filter((p) => p.total > 0);

      const desiredAfter = computeDesiredRouteKeys(animState, visibilityGroups);
      if (!desiredAfter.has(routeKey)) continue;

      let bundleAfter = overlaysByMap.get(map);
      if (!bundleAfter) {
        bundleAfter = new Map();
        overlaysByMap.set(map, bundleAfter);
      }
      if (bundleAfter.has(routeKey)) continue;

      if (!map.getSource || !map.addSource) continue;
      if (map.getSource(sourceId)) {
        for (const lid of layerIdsForSource(map, sourceId)) {
          try {
            if (map.getLayer(lid)) map.removeLayer(lid);
          } catch (_) {
            /* ignore */
          }
        }
        try {
          map.removeSource(sourceId);
        } catch (_) {
          /* ignore */
        }
      }

      const { color, width } = sampleLinePaintFromBase(map, baseLineIds);
      const { headRadius, hideHeadAtEnd } = resolveTrailHeadConfig(canonical);
      const baselineOpacity = new Map();
      for (const lid of baseLineIds) {
        try {
          if (map.getLayer(lid)) {
            let op;
            try {
              op = map.getPaintProperty(lid, "line-opacity");
            } catch (_) {
              op = undefined;
            }
            baselineOpacity.set(lid, op);
            map.setPaintProperty(lid, "line-opacity", 0);
          }
        } catch (_) {
          /* ignore */
        }
      }

      map.addSource(sourceId, {
        type: "geojson",
        data: normalized,
        lineMetrics: true,
      });

      map.addLayer({
        id: lineLayerId,
        type: "line",
        source: sourceId,
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
        paint: {
          "line-width": width,
          "line-gradient": buildLineGradientExpression(0, color),
        },
      });
      if (headRadius > 0 && paths.length > 0) {
        const initialCoords = paths
          .map((path) => pointAtProgress(path.coords, path.cum, path.total, 0))
          .filter((coord) => !!coord);
        map.addSource(headSourceId, {
          type: "geojson",
          data: pointsFeatureCollection(initialCoords),
        });
        map.addLayer({
          id: headLayerId,
          type: "circle",
          source: headSourceId,
          paint: {
            "circle-color": color,
            "circle-radius": Math.max(2.25, headRadius),
            "circle-blur": 0.25,
            "circle-opacity": 0.95,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 1.1,
          },
        });
      }

      bundleAfter.set(routeKey, {
        routeKey,
        sourceId,
        lineLayerId,
        baseLineIds,
        baselineOpacity,
        loopMs,
        color,
        lineWidth: width,
        headSourceId: headRadius > 0 ? headSourceId : null,
        headLayerId: headRadius > 0 ? headLayerId : null,
        headRadius,
        hideHeadAtEnd,
        paths,
      });
      mapsWithActiveOverlays.add(map);
      ensureGlobalRaf();
    } catch (err) {
      console.warn("[maplibre-route-progress-overlay] failed to add overlay", canonical, err);
    }
  }
}

/**
 * Remove every route-progress overlay from a map (e.g. on teardown).
 * @param {import('maplibre-gl').Map} map
 */
export function disposeRouteProgressOverlaysForMap(map) {
  if (!map) return;
  const bundle = overlaysByMap.get(map);
  if (!bundle) return;
  for (const rk of [...bundle.keys()]) {
    removeOverlayEntry(map, rk);
  }
  stopGlobalRafIfIdle();
}
