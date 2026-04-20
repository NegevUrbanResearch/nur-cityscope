// Curated projection layers: API load + listing enabled ids + Supabase reload.
// projection-layer-manager builds `deps` and calls into this module.

export async function loadProjectionCuratedLayerFromAPI(deps, fullLayerId) {
  const {
    CoordUtils,
    loadedLayers,
    fetchCuratedLayerData,
    fetchPinkLinePaths,
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

  const pointFeatures = (wgs84Geojson.features || []).filter(
    (f) => f.geometry && f.geometry.type === "Point" && f.geometry.coordinates,
  );

  const hasRouteUtils = typeof buildIntegratedRoute === "function";

  let builtGeojson = null;
  const { basePaths } = await fetchPinkLinePaths();
  if (basePaths.length > 0 && hasRouteUtils && pointFeatures.length > 0) {
    await ensureProjectionPinkLineBaseLayer();
    const submissionPrimary = getSubmissionDisplayPrimaryForCuratedLayer(
      fullLayerId,
      layerData,
    );
    // Three-layer proposed stack matches Colab/leaflet curated overlay (buildColabAlignedCuratedOverlayGeoJSON).
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

  if (pointFeatures.length > 0) {
    const features = pointFeatures.map((f) => {
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

export async function reloadProjectionCuratedLayersFromSupabase(deps) {
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

  const curatedKeys = Object.keys(loadedLayers).filter(
    (k) => k.startsWith("curated_") && k.includes("."),
  );
  for (const id of curatedKeys) {
    delete inFlightLayerLoads[id];
    delete loadedLayers[id];
    if (canvasRenderer && typeof canvasRenderer.removeLayer === "function") {
      canvasRenderer.removeLayer(id);
    }
  }
  if (typeof deps.refreshLayerGroupsBeforeReload === "function") {
    await deps.refreshLayerGroupsBeforeReload();
  }
  const listDeps = {
    getLayerGroups,
    MORESHET_AXIS_GROUP_ID,
    isPinkLineParkingLayerId,
  };
  const toLoad = listCuratedFullLayerIdsToReload(listDeps);
  for (const fullLayerId of toLoad) {
    try {
      await loadProjectionLayerFromRegistry(fullLayerId);
    } catch (err) {
      console.error(
        `[Projection] Curated Supabase reload failed for ${fullLayerId}:`,
        err,
      );
    }
  }
  for (const fullLayerId of toLoad) {
    updateLayerVisibility(fullLayerId, true);
  }
}
