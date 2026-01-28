// Helper functions for reading layer state from OTEFDataContext.
// Centralizes the pattern of resolving a fullLayerId ("group.layer")
// into its group + layer objects and enabled flag.

/**
 * Resolve a full layer id like "groupId.layerId" against the given context.
 *
 * @param {Object} ctx - OTEFDataContext or compatible object with getLayerGroups()
 * @param {string} fullLayerId - e.g. "map_3_future.mimushim"
 * @returns {{group: Object, layer: Object, enabled: boolean}|null}
 */
function resolveLayerState(ctx, fullLayerId) {
  if (!ctx || typeof ctx.getLayerGroups !== 'function' || !fullLayerId) {
    return null;
  }

  const layerGroups = ctx.getLayerGroups();
  if (!Array.isArray(layerGroups) || layerGroups.length === 0) {
    return null;
  }

  const parts = fullLayerId.split('.');
  if (parts.length !== 2) return null;
  const [groupId, layerId] = parts;

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
    enabled: groupEnabled && layerEnabled
  };
}

/**
 * Convenience wrapper that uses the global OTEFDataContext when available.
 *
 * @param {string} fullLayerId
 * @returns {{group: Object, layer: Object, enabled: boolean}|null}
 */
function getLayerState(fullLayerId) {
  if (typeof OTEFDataContext === 'undefined') {
    return null;
  }
  return resolveLayerState(OTEFDataContext, fullLayerId);
}

// Expose globals for browser consumers
if (typeof window !== 'undefined') {
  window.LayerStateHelper = {
    resolveLayerState,
    getLayerState
  };
}

// Export for Node/CommonJS consumers (tests, tooling)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    resolveLayerState,
    getLayerState
  };
}

