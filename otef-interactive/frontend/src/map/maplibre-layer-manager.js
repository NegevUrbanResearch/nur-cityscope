/**
 * Manages adding/removing MapLibre sources and style layers
 * based on layer group state from data context.
 *
 * LayerRegistry is a singleton default export initialized elsewhere.
 */
import { irToMapLibreLayers } from "../shared/maplibre-style-bridge.js";
import layerRegistry from "../shared/layer-registry.js";

const mapStateByMap = new WeakMap(); // map -> { loadedSources: Map, loadedLayerIds: Map }

function getOrCreateMapState(map) {
  let state = mapStateByMap.get(map);
  if (!state) {
    state = {
      loadedSources: new Map(), // fullId -> sourceId
      loadedLayerIds: new Map(), // fullId -> string[]
    };
    mapStateByMap.set(map, state);
  }
  return state;
}

function resolveEnabledFullIds(layerGroups) {
  const enabled = new Set();
  if (!layerGroups) {
    return enabled;
  }

  const groups = Array.isArray(layerGroups)
    ? layerGroups
    : Object.values(layerGroups);

  for (const group of groups) {
    if (!group || group.enabled === false) {
      continue;
    }
    const groupId = group.id;
    if (!groupId) {
      continue;
    }
    for (const layer of group.layers || []) {
      if (layer?.enabled) {
        enabled.add(`${groupId}.${layer.id}`);
      }
    }
  }

  return enabled;
}

function removeFullIdFromMap(map, fullId, state) {
  const { loadedLayerIds, loadedSources } = state;
  const mlLayerIds = loadedLayerIds.get(fullId) || [];
  for (const layerId of mlLayerIds) {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  }
  loadedLayerIds.delete(fullId);

  const sourceId = loadedSources.get(fullId) || fullId;
  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  }
  loadedSources.delete(fullId);
}

function buildPmtilesUrl(pathFromRegistry) {
  if (!pathFromRegistry) return null;
  return `pmtiles://${window.location.origin}${pathFromRegistry}`;
}

function getVectorSourceLayerName(fullId, layerConfig) {
  // This fallback chain must be validated against actual PMTiles metadata.
  // If source-layer mismatches, MapLibre silently renders nothing.
  return (
    layerConfig?.sourceLayer ||
    layerConfig?.source_layer ||
    layerConfig?.id ||
    fullId.split(".").slice(1).join(".") ||
    "default"
  );
}

/**
 * Add a curated GeoJSON source directly to the map (bypasses layer registry).
 * @param {object} map - MapLibre map instance
 * @param {string} sourceId
 * @param {object} geojsonData - GeoJSON FeatureCollection or Feature
 */
export function addCuratedGeoJsonSource(map, sourceId, geojsonData) {
  if (!map || !sourceId || !geojsonData) return;
  if (map.getSource(sourceId)) return;
  try {
    map.addSource(sourceId, { type: "geojson", data: geojsonData });
  } catch (err) {
    console.warn(`[maplibre-layer-manager] Failed to add curated source ${sourceId}`, err);
  }
}

/**
 * Remove a single curated layer (and its source) by fully-qualified id.
 * @param {object} map
 * @param {string} fullId - e.g. "curated.42__solidLine__0"
 */
export function removeCuratedLayer(map, fullId) {
  if (!map || !fullId) return;
  const state = getOrCreateMapState(map);
  removeFullIdFromMap(map, fullId, state);
}

/**
 * Remove all curated layers whose fullId starts with `prefix`.
 * Also removes associated sources tracked in map state.
 * @param {object} map
 * @param {string} prefix - e.g. "curated.42"
 */
export function removeCuratedLayersByPrefix(map, prefix) {
  if (!map || !prefix) return;
  const state = getOrCreateMapState(map);
  const toRemove = [];
  for (const id of state.loadedLayerIds.keys()) {
    if (id.startsWith(prefix)) toRemove.push(id);
  }
  for (const id of state.loadedSources.keys()) {
    if (id.startsWith(prefix) && !toRemove.includes(id)) toRemove.push(id);
  }
  for (const id of toRemove) {
    removeFullIdFromMap(map, id, state);
  }
  // Also remove any MapLibre layers/sources with matching prefix not tracked in state
  try {
    const style = map.getStyle();
    if (style) {
      for (const layer of (style.layers || [])) {
        if (layer.id && layer.id.startsWith(prefix)) {
          if (map.getLayer(layer.id)) map.removeLayer(layer.id);
        }
      }
      for (const srcId of Object.keys(style.sources || {})) {
        if (srcId.startsWith(prefix)) {
          if (map.getSource(srcId)) map.removeSource(srcId);
        }
      }
    }
  } catch (_) {}
}

/**
 * Register curated layer ids and source into the map state for lifecycle tracking.
 * @param {object} map
 * @param {string} fullId - logical id (e.g. "curated.42")
 * @param {string} sourceId - MapLibre source id
 * @param {string[]} layerIds - MapLibre layer ids added for this curated pack
 */
export function registerCuratedLayerIds(map, fullId, sourceId, layerIds) {
  if (!map || !fullId) return;
  const state = getOrCreateMapState(map);
  state.loadedSources.set(fullId, sourceId);
  state.loadedLayerIds.set(fullId, Array.isArray(layerIds) ? layerIds : []);
}

function addLayerToMap(map, fullId, state) {
  const { loadedSources, loadedLayerIds } = state;
  // Curated layer ids are managed by maplibre-curated-layer-loader, not the registry path.
  if (!layerRegistry.getLayerConfig(fullId) && fullId.startsWith("curated")) return;
  const layerConfig = layerRegistry.getLayerConfig(fullId);
  if (!layerConfig) {
    console.warn(`[maplibre-layer-manager] Missing layer config for ${fullId}`);
    return;
  }

  if (layerConfig.format === "wmts") {
    return;
  }

  const sourceId = fullId;
  let hasSource = false;
  let usesVectorSource = false;

  if (layerConfig.pmtilesFile) {
    const pmPath = layerRegistry.getLayerPMTilesUrl(fullId);
    const pmtilesUrl = buildPmtilesUrl(pmPath);
    if (!pmtilesUrl) {
      return;
    }
    try {
      map.addSource(sourceId, { type: "vector", url: pmtilesUrl });
      hasSource = true;
      usesVectorSource = true;
    } catch (error) {
      console.warn(
        `[maplibre-layer-manager] Failed to add PMTiles source for ${fullId}`,
        error,
      );
      return;
    }
  } else {
    const dataUrl = layerRegistry.getLayerDataUrl(fullId);
    if (!dataUrl) {
      return;
    }
    try {
      map.addSource(sourceId, { type: "geojson", data: dataUrl });
      hasSource = true;
    } catch (error) {
      console.warn(
        `[maplibre-layer-manager] Failed to add GeoJSON source for ${fullId}`,
        error,
      );
      return;
    }
  }

  if (!hasSource) {
    return;
  }

  const addedLayerIds = [];
  let styleLayers;
  try {
    styleLayers = irToMapLibreLayers(fullId, sourceId, layerConfig);
  } catch (error) {
    console.warn(
      `[maplibre-layer-manager] Failed to build style layers for ${fullId}`,
      error,
    );
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }
    loadedLayerIds.delete(fullId);
    loadedSources.delete(fullId);
    return;
  }

  for (const styleLayer of styleLayers || []) {
    const layerDef = { ...styleLayer, source: sourceId };

    if (usesVectorSource) {
      layerDef["source-layer"] = getVectorSourceLayerName(fullId, layerConfig);
    }

    try {
      map.addLayer(layerDef);
      addedLayerIds.push(layerDef.id);
    } catch (error) {
      console.warn(
        `[maplibre-layer-manager] Failed to add style layer ${layerDef.id}`,
        error,
      );
    }
  }

  if (addedLayerIds.length === 0) {
    // No layer was added successfully, so rollback source and state for retry.
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }
    loadedLayerIds.delete(fullId);
    loadedSources.delete(fullId);
    return;
  }

  loadedSources.set(fullId, sourceId);
  loadedLayerIds.set(fullId, addedLayerIds);
}

export function applyLayerGroupsToMap(map, layerGroups) {
  const state = getOrCreateMapState(map);
  const { loadedSources, loadedLayerIds } = state;
  const enabledFullIds = resolveEnabledFullIds(layerGroups);
  const trackedFullIds = new Set([
    ...loadedLayerIds.keys(),
    ...loadedSources.keys(),
  ]);

  for (const fullId of trackedFullIds) {
    if (!enabledFullIds.has(fullId)) {
      removeFullIdFromMap(map, fullId, state);
    }
  }

  for (const fullId of enabledFullIds) {
    if (!loadedSources.has(fullId)) {
      addLayerToMap(map, fullId, state);
    }
  }
}

export function clearAllLayers(map) {
  const state = getOrCreateMapState(map);
  const trackedFullIds = new Set([
    ...state.loadedLayerIds.keys(),
    ...state.loadedSources.keys(),
  ]);

  for (const fullId of trackedFullIds) {
    removeFullIdFromMap(map, fullId, state);
  }
  state.loadedSources.clear();
  state.loadedLayerIds.clear();
}
