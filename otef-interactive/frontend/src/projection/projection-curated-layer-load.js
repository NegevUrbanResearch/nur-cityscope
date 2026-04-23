// Curated projection layers: API load + listing enabled ids + Supabase reload.
// projection-layer-manager builds `deps` and calls into this module.

import {
  colabBundleHasRenderableGeometry,
  parseColabRouteGeometryBundle,
} from "../map-utils/colab-route-geometry-bundle.js";
import { isCuratedPackFullLayerId } from "../shared/gis-layer-filter.js";

export async function loadProjectionCuratedLayerFromAPI(deps, fullLayerId) {
  const {
    CoordUtils,
    loadedLayers,
    fetchCuratedLayerData,
    fetchPinkLinePaths,
    extractPointFeatures,
    extractPinkDetourPointFeatures,
    buildColabAlignedCuratedOverlayGeoJSON,
    applyProjectionCuratedOverlayContrast,
    getMemorialIconForFeature,
    getCuratedLayerColorForProjection,
    getSubmissionDisplayPrimaryForCuratedLayer,
    ensureProjectionPinkLineBaseLayer,
    renderLayerFromGeojson,
    buildIntegratedRoute,
  } = deps;

  if (loadedLayers[fullLayerId]) return;

  const result = await fetchCuratedLayerData(fullLayerId);
  if (!result) return;
  let { geojson, layerData } = result;

  let wgs84Geojson = geojson;
  const firstCoord = CoordUtils.getFirstCoordinate(geojson);
  const looksLikeWgs84 =
    firstCoord &&
    Math.abs(firstCoord[0]) < 1000 &&
    Math.abs(firstCoord[1]) < 1000;
  if (!looksLikeWgs84 && firstCoord && Math.abs(firstCoord[0]) >= 1000) {
    wgs84Geojson = CoordUtils.transformGeojsonToWgs84(geojson);
  }

  const pointItems = extractPointFeatures(wgs84Geojson);

  const { basePaths } = await fetchPinkLinePaths();
  const hasRouteUtils = typeof buildIntegratedRoute === "function";
  const parsedBundle = parseColabRouteGeometryBundle(
    wgs84Geojson.colab_route_geometry_bundle,
  );
  const bundleRenderable = colabBundleHasRenderableGeometry(parsedBundle);
  const hasAnyLineGeometryInGeojson = (wgs84Geojson.features || []).some(
    (f) =>
      f.geometry &&
      (f.geometry.type === "LineString" || f.geometry.type === "MultiLineString"),
  );

  const detourPointItems = extractPinkDetourPointFeatures(wgs84Geojson);
  let routingLatLng = detourPointItems.map((x) => x.latlng);
  if (routingLatLng.length === 0 && pointItems.length > 0) {
    routingLatLng = pointItems
      .filter(({ feature }) => !getMemorialIconForFeature(feature.properties || {}))
      .map((x) => x.latlng);
  }

  /** Mirrors `leaflet-curated-layer-loader.js` `usePinkLineProjection` + `canRunPinkOverlay`. */
  const usePinkLineProjection =
    hasRouteUtils &&
    (bundleRenderable ||
      (basePaths.length > 0 &&
        (routingLatLng.length > 0 || hasAnyLineGeometryInGeojson)));
  const canRunPinkOverlay =
    usePinkLineProjection && (routingLatLng.length > 0 || bundleRenderable);

  /** Same `removed` heritage as GIS overlay — used to clip regional axis under ghost segments. */
  let removedForBaseClip = [];
  if (bundleRenderable) {
    removedForBaseClip = parsedBundle.integratedRoute?.removed || [];
  } else if (basePaths.length > 0) {
    const br = buildIntegratedRoute(basePaths, routingLatLng);
    removedForBaseClip = br.removed;
  }

  let builtGeojson = null;
  if (canRunPinkOverlay) {
    if (basePaths.length > 0) {
      const clipRemoved =
        Array.isArray(removedForBaseClip) &&
        removedForBaseClip.some((p) => Array.isArray(p) && p.length >= 2);
      await ensureProjectionPinkLineBaseLayer(
        clipRemoved ? { removedPaths: removedForBaseClip } : {},
      );
    }
    const submissionPrimary = getSubmissionDisplayPrimaryForCuratedLayer(
      fullLayerId,
      layerData,
    );
    builtGeojson = buildColabAlignedCuratedOverlayGeoJSON(
      basePaths,
      wgs84Geojson,
      submissionPrimary,
      { useAllPointsAsDetourWhenEmpty: true },
    );
  }

  if (builtGeojson) {
    if (typeof applyProjectionCuratedOverlayContrast === "function") {
      applyProjectionCuratedOverlayContrast(builtGeojson);
    }
    const itmGeojson = CoordUtils.transformGeojsonToItm(builtGeojson);
    const layerColor = getCuratedLayerColorForProjection(fullLayerId, layerData);
    const customStyleFunction = (feature) =>
      feature.properties && feature.properties._curatedStyle
        ? feature.properties._curatedStyle
        : { color: layerColor, weight: 4, opacity: 0.85, fillColor: layerColor, fillOpacity: 0.8, radius: 5 };
    const layerConfig = { style: { type: "simple" } };
    await renderLayerFromGeojson(
      itmGeojson,
      fullLayerId,
      layerConfig,
      "line",
      { customStyleFunction },
    );
    return;
  }

  if (pointItems.length > 0) {
    const features = pointItems.map(({ feature: f }) => {
      const c = f.geometry.coordinates;
      const props = f.properties || {};
      const iconUrl = getMemorialIconForFeature(props);
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [c[0], c[1]] },
        properties: {
          ...props,
          _curatedStyle: iconUrl
            ? { _iconUrl: iconUrl, _iconSize: 32 }
            : {
                fillColor: getCuratedLayerColorForProjection(fullLayerId, layerData),
                color: "#fff",
                weight: 1,
                fillOpacity: 0.9,
                opacity: 1,
                radius: 6,
              },
        },
      };
    });
    const fallbackPointGeojson = { type: "FeatureCollection", features };
    const itmGeojson = CoordUtils.transformGeojsonToItm(fallbackPointGeojson);
    const customStyleFunction = (feature) =>
      feature.properties && feature.properties._curatedStyle
        ? feature.properties._curatedStyle
        : {
            fillColor: "#e76f51",
            color: "#fff",
            weight: 1,
            fillOpacity: 0.9,
            opacity: 1,
            radius: 6,
          };
    const layerConfig = { style: { type: "simple" } };
    await renderLayerFromGeojson(itmGeojson, fullLayerId, layerConfig, "Point", {
      customStyleFunction,
    });
    return;
  }

  const itmGeojson = looksLikeWgs84
    ? CoordUtils.transformGeojsonToItm(geojson)
    : geojson;
  const layerConfig = {
    style: {
      type: "simple",
      defaultStyle: {
        fillColor: "#00d4ff",
        fillOpacity: 0.4,
        strokeColor: "#00a8cc",
        strokeWidth: 2,
      },
    },
  };
  const geometryType = itmGeojson.features[0]?.geometry?.type || "Polygon";
  await renderLayerFromGeojson(itmGeojson, fullLayerId, layerConfig, geometryType);
}

export function listCuratedFullLayerIdsToReload(deps) {
  const { getLayerGroups, MORESHET_AXIS_GROUP_ID, isPinkLineParkingLayerId } =
    deps;
  const layerGroups =
    typeof getLayerGroups === "function" ? getLayerGroups() : null;
  const ids = [];
  if (!Array.isArray(layerGroups)) return ids;
  for (const g of layerGroups) {
    if (!g || typeof g.id !== "string" || !g.id.startsWith("curated")) continue;
    for (const layer of g.layers || []) {
      if (!layer || !layer.enabled) continue;
      if (
        g.id === MORESHET_AXIS_GROUP_ID &&
        isPinkLineParkingLayerId(String(layer.id || ""))
      ) {
        continue;
      }
      ids.push(`${g.id}.${layer.id}`);
    }
  }
  return ids;
}

export function computeCuratedReloadTargets(
  enabledCuratedLayerIds,
  affectedIds,
) {
  if (!Array.isArray(affectedIds) || affectedIds.length === 0) {
    return enabledCuratedLayerIds;
  }
  const affected = new Set(affectedIds);
  return enabledCuratedLayerIds.filter((id) => affected.has(id));
}

/**
 * @param {{ affectedCuratedFullLayerIds?: string[] }} [options]
 * When `affectedCuratedFullLayerIds` is a non-empty array of strings, only those curated
 * pack layers are removed and re-fetched; otherwise all curated packs in `loadedLayers`
 * are cleared and every enabled curated layer is reloaded (previous behavior).
 */
export async function reloadProjectionCuratedLayersFromSupabase(deps, options = {}) {
  const {
    loadedLayers,
    inFlightLayerLoads,
    canvasRenderer,
    loadProjectionLayerFromRegistry,
    updateLayerVisibility,
    getLayerGroups,
    MORESHET_AXIS_GROUP_ID,
    isPinkLineParkingLayerId,
  } = deps;

  const hasProvidedAffectedCuratedFullLayerIds = Array.isArray(
    options.affectedCuratedFullLayerIds,
  );
  const normalizedAffectedCuratedFullLayerIds = hasProvidedAffectedCuratedFullLayerIds
    ? options.affectedCuratedFullLayerIds
        .filter((id) => typeof id === "string")
        .map((id) => id.trim())
        .filter((id) => id.length > 0 && id.includes("."))
    : [];
  const selective =
    hasProvidedAffectedCuratedFullLayerIds &&
    normalizedAffectedCuratedFullLayerIds.length > 0;
  if (
    hasProvidedAffectedCuratedFullLayerIds &&
    normalizedAffectedCuratedFullLayerIds.length === 0
  ) {
    return [];
  }
  const want = selective
    ? new Set(normalizedAffectedCuratedFullLayerIds)
    : null;

  if (selective && typeof deps.refreshLayerGroupsBeforeReload === "function") {
    await deps.refreshLayerGroupsBeforeReload();
  }

  const curatedKeys = Object.keys(loadedLayers).filter((k) =>
    isCuratedPackFullLayerId(k),
  );
  const keysToRemove = selective
    ? curatedKeys.filter((k) => want.has(k))
    : curatedKeys;

  for (const id of keysToRemove) {
    delete inFlightLayerLoads[id];
    delete loadedLayers[id];
    if (canvasRenderer && typeof canvasRenderer.removeLayer === "function") {
      canvasRenderer.removeLayer(id);
    }
  }

  if (!selective && typeof deps.refreshLayerGroupsBeforeReload === "function") {
    await deps.refreshLayerGroupsBeforeReload();
  }

  const listDeps = {
    getLayerGroups,
    MORESHET_AXIS_GROUP_ID,
    isPinkLineParkingLayerId,
  };
  const allEnabledCurated = listCuratedFullLayerIdsToReload(listDeps);
  const toLoad = computeCuratedReloadTargets(
    allEnabledCurated,
    normalizedAffectedCuratedFullLayerIds,
  );
  const BATCH_SIZE = 4;
  for (let i = 0; i < toLoad.length; i += BATCH_SIZE) {
    const batch = toLoad.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (fullLayerId) => {
        try {
          await loadProjectionLayerFromRegistry(fullLayerId);
        } catch (err) {
          console.error(
            `[Projection] Curated Supabase reload failed for ${fullLayerId}:`,
            err,
          );
        }
      }),
    );
  }
  return toLoad;
}
