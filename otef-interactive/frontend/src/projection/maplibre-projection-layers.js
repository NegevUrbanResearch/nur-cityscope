/**
 * Layer management for the projection MapLibre instance.
 * Reuses the same style bridge and layer manager logic as GIS,
 * and adds WMTS raster source support for projection overlays.
 */
import { applyLayerGroupsToMap } from "../map/maplibre-layer-manager.js";
import layerRegistry from "../shared/layer-registry.js";

const wmtsStateByMap = new WeakMap(); // map -> Set<fullLayerId>

function asArrayLayerGroups(layerGroups) {
  if (Array.isArray(layerGroups)) return layerGroups;
  if (layerGroups && typeof layerGroups === "object") return Object.values(layerGroups);
  return [];
}

function cloneGroupsWithWmtsDisabled(groups) {
  return groups.map((group) => ({
    ...group,
    layers: (group.layers || []).map((layer) => {
      const fullId = `${group.id}.${layer.id}`;
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

function resolveEnabledWmtsFullIds(layerGroups) {
  const enabled = new Set();
  for (const group of asArrayLayerGroups(layerGroups)) {
    if (!group || group.enabled === false) continue;
    for (const layer of group.layers || []) {
      if (!layer?.enabled) continue;
      const fullId = `${group.id}.${layer.id}`;
      const cfg = layerRegistry.getLayerConfig(fullId);
      if (!cfg || cfg.format !== "wmts" || !cfg.wmts) continue;
      enabled.add(fullId);
    }
  }
  return enabled;
}

export function syncProjectionLayers(map, layerGroups) {
  if (!map) return;

  const groups = asArrayLayerGroups(layerGroups);
  const groupsWithoutWmts = cloneGroupsWithWmtsDisabled(groups);
  applyLayerGroupsToMap(map, groupsWithoutWmts);

  const wmtsState = getOrCreateWmtsState(map);
  const enabledWmts = resolveEnabledWmtsFullIds(groups);

  for (const fullId of enabledWmts) {
    const cfg = layerRegistry.getLayerConfig(fullId);
    if (cfg) {
      addWmtsSource(map, cfg);
    }
  }

  for (const fullId of [...wmtsState]) {
    if (!enabledWmts.has(fullId)) {
      removeWmtsSource(map, fullId);
      wmtsState.delete(fullId);
    }
  }
}

export function addWmtsSource(map, layerConfig) {
  if (!map || !layerConfig?.wmts) return;

  const fullId = layerConfig.fullId || `${layerConfig.groupId}.${layerConfig.id}`;
  const sourceId = `wmts__${fullId}`;
  const layerId = `${sourceId}__raster`;
  const state = getOrCreateWmtsState(map);
  state.add(fullId);

  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: "raster",
      tiles: [layerConfig.wmts.urlTemplate],
      tileSize: 256,
      attribution: layerConfig.wmts.attribution || "",
    });
  }

  if (!map.getLayer(layerId)) {
    map.addLayer({
      id: layerId,
      type: "raster",
      source: sourceId,
      paint: {
        "raster-opacity": layerConfig.wmts.opacity ?? 1.0,
      },
    });
  } else {
    map.setPaintProperty(layerId, "raster-opacity", layerConfig.wmts.opacity ?? 1.0);
    map.setLayoutProperty(layerId, "visibility", "visible");
  }
}

function removeWmtsSource(map, fullId) {
  const sourceId = `wmts__${fullId}`;
  const layerId = `${sourceId}__raster`;
  if (map.getLayer(layerId)) {
    map.removeLayer(layerId);
  }
  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  }
}

