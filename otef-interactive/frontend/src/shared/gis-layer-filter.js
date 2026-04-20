/**
 * GIS-visible layer rule: single source of truth for which layers appear on the GIS map.
 * projector_base is projector-only except Tkuma_Area_LIne, which also appears on GIS.
 */

/**
 * True when `fullLayerId` is a curated pack layer id (`curated…<group>.<layer>`), including
 * `curated_moresht_axis.12` (underscore group ids), not only the legacy `curated.12` form.
 *
 * @param {unknown} fullLayerId
 * @returns {boolean}
 */
function isCuratedPackFullLayerId(fullLayerId) {
  return (
    typeof fullLayerId === "string" &&
    fullLayerId.startsWith("curated") &&
    fullLayerId.includes(".")
  );
}

/**
 * Whether a layer should be shown on the GIS map.
 *
 * @param {string} groupId - Layer group id (e.g. "projector_base", "map_3_future")
 * @param {string} layerId - Layer id within the group (e.g. "Tkuma_Area_LIne", "model_base")
 * @returns {boolean} - true if the layer should be shown on the GIS map
 */
function shouldShowLayerOnGisMap(groupId, layerId) {
  // Parking companion is driven by pink-line modules, not registry GeoJSON.
  if (groupId === "curated_moresht_axis" && layerId === "pink_line_parking") {
    return false;
  }
  if (typeof layerRegistry !== "undefined" && layerRegistry.getLayerConfig) {
    const config = layerRegistry.getLayerConfig(`${groupId}.${layerId}`);
    if (config) {
      // WMTS / raster layers are projection-only; never show on GIS map or legend
      if (config.format === "wmts" || config.geometryType === "raster") {
        return false;
      }
      if (config.ui && config.ui.hideInLegend) {
        return false;
      }
    }
  }

  // Legacy fallback: projector_base is projector-only except Tkuma_Area_LIne
  if (groupId === "projector_base" && layerId !== "Tkuma_Area_LIne") {
    return false;
  }
  return true;
}

/**
 * Curated pack fullLayerIds that are enabled and GIS-visible per effective layer groups.
 * @returns {Set<string>|null} null if LayerStateHelper is unavailable (caller skips filtering)
 */
function collectEnabledCuratedGisFullLayerIds() {
  if (
    typeof LayerStateHelper === "undefined" ||
    typeof LayerStateHelper.getEffectiveLayerGroups !== "function"
  ) {
    return null;
  }
  const groups = LayerStateHelper.getEffectiveLayerGroups();
  const out = new Set();
  for (const group of groups || []) {
    if (!group || typeof group.id !== "string" || !group.id.startsWith("curated")) {
      continue;
    }
    for (const layer of group.layers || []) {
      if (!layer || !layer.enabled) continue;
      if (!shouldShowLayerOnGisMap(group.id, layer.id)) continue;
      out.add(`${group.id}.${layer.id}`);
    }
  }
  return out;
}

/**
 * Filter layer groups to only layers that should be shown on the GIS map.
 * Returns a copy of each group with layers filtered; group structure is preserved.
 *
 * @param {Array<{id: string, layers: Array<{id: string}>}>} layerGroups
 * @returns {Array<{id: string, layers: Array}>}
 */
function filterGroupsForGisMap(layerGroups) {
  if (!layerGroups || !Array.isArray(layerGroups)) {
    return [];
  }
  return layerGroups.map((group) => ({
    ...group,
    layers: (group.layers || []).filter((layer) =>
      shouldShowLayerOnGisMap(group.id, layer.id),
    ),
  }));
}

// Expose globals for browser consumers
if (typeof window !== "undefined") {
  window.shouldShowLayerOnGisMap = shouldShowLayerOnGisMap;
  window.filterGroupsForGisMap = filterGroupsForGisMap;
}

export {
  shouldShowLayerOnGisMap,
  filterGroupsForGisMap,
  isCuratedPackFullLayerId,
  collectEnabledCuratedGisFullLayerIds,
};
