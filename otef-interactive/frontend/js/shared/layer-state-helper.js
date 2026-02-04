// Helper functions for reading layer state from OTEFDataContext.
// Centralizes the pattern of resolving a fullLayerId ("group.layer")
// into its group + layer objects and enabled flag.

/**
 * Parse fullLayerId into groupId and layerId using "first dot" split.
 * Supports layer ids that contain dots (e.g. "map_3.layer.with.dots").
 *
 * @param {string} fullLayerId - e.g. "map_3_future.mimushim" or "map_3.layer.with.dots"
 * @returns {{ groupId: string, layerId: string }|null} null if no dot or empty segment
 */
function parseFullLayerId(fullLayerId) {
  if (fullLayerId == null || typeof fullLayerId !== "string") {
    return null;
  }
  const dotIndex = fullLayerId.indexOf(".");
  if (dotIndex < 0) {
    return null;
  }
  const groupId = fullLayerId.slice(0, dotIndex).trim();
  const layerId = fullLayerId.slice(dotIndex + 1).trim();
  if (groupId === "" || layerId === "") {
    return null;
  }
  return { groupId, layerId };
}

/**
 * Get the layer id part only (everything after the first dot).
 * For display names when fullLayerId is "groupId.layerId".
 *
 * @param {string} fullLayerId - e.g. "map_3_future.mimushim"
 * @returns {string|null} layerId or null if unparseable
 */
function getLayerIdOnly(fullLayerId) {
  const parsed = parseFullLayerId(fullLayerId);
  return parsed ? parsed.layerId : null;
}

/**
 * Resolve a full layer id like "groupId.layerId" against the given context.
 *
 * @param {Object} ctx - OTEFDataContext or compatible object with getLayerGroups()
 * @param {string} fullLayerId - e.g. "map_3_future.mimushim"
 * @returns {{group: Object, layer: Object, enabled: boolean}|null}
 */
function resolveLayerState(ctx, fullLayerId) {
  if (!ctx || typeof ctx.getLayerGroups !== "function" || !fullLayerId) {
    return null;
  }

  const parsed = parseFullLayerId(fullLayerId);
  if (!parsed) {
    return null;
  }
  const { groupId, layerId } = parsed;

  const layerGroups = ctx.getLayerGroups();
  if (!Array.isArray(layerGroups) || layerGroups.length === 0) {
    return null;
  }

  const group = layerGroups.find((g) => g && g.id === groupId);
  if (!group || !Array.isArray(group.layers)) {
    return null;
  }

  const layer = group.layers.find((l) => l && l.id === layerId);
  if (!layer) {
    return null;
  }

  // Treat group.enabled as a top-level gate: if the pack is disabled,
  // all of its layers are considered disabled for visibility purposes,
  // even if an individual layer.enabled flag remains true because of a
  // partial or out-of-sync update from the controller.
  const groupEnabled = group.enabled !== false;
  const layerEnabled = !!layer.enabled;

  return {
    group,
    layer,
    enabled: groupEnabled && layerEnabled,
  };
}

/**
 * Convenience wrapper that uses the global OTEFDataContext when available.
 *
 * @param {string} fullLayerId
 * @returns {{group: Object, layer: Object, enabled: boolean}|null}
 */
function getLayerState(fullLayerId) {
  if (typeof OTEFDataContext === "undefined") {
    return null;
  }
  return resolveLayerState(OTEFDataContext, fullLayerId);
}

// Expose globals for browser consumers
if (typeof window !== "undefined") {
  window.LayerStateHelper = {
    parseFullLayerId,
    getLayerIdOnly,
    resolveLayerState,
    getLayerState,
  };
}

// Export for Node/CommonJS consumers (tests, tooling)
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseFullLayerId,
    getLayerIdOnly,
    resolveLayerState,
    getLayerState,
  };
}
