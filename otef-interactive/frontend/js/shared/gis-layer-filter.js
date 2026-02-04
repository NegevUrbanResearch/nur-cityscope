/**
 * GIS-visible layer rule: single source of truth for which layers appear on the GIS map.
 * projector_base is projector-only except Tkuma_Area_LIne, which also appears on GIS.
 */

/**
 * Whether a layer should be shown on the GIS map.
 *
 * @param {string} groupId - Layer group id (e.g. "projector_base", "map_3_future")
 * @param {string} layerId - Layer id within the group (e.g. "Tkuma_Area_LIne", "model_base")
 * @returns {boolean} - true if the layer should be shown on the GIS map
 */
function shouldShowLayerOnGisMap(groupId, layerId) {
  if (groupId === "projector_base" && layerId !== "Tkuma_Area_LIne") {
    return false;
  }
  return true;
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
      shouldShowLayerOnGisMap(group.id, layer.id)
    ),
  }));
}

// Expose globals for browser consumers
if (typeof window !== "undefined") {
  window.shouldShowLayerOnGisMap = shouldShowLayerOnGisMap;
  window.filterGroupsForGisMap = filterGroupsForGisMap;
}

// Export for Node/CommonJS consumers (tests, tooling)
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    shouldShowLayerOnGisMap,
    filterGroupsForGisMap,
  };
}
