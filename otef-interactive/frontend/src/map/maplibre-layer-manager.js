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

function addLayerToMap(map, fullId, state) {
  const { loadedSources, loadedLayerIds } = state;
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
