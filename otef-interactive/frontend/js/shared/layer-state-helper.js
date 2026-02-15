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

/**
 * Effective layer groups: registry groups merged with API/context state.
 * When context has no state for a group, applies defaults so projection/map/remote show and load registry layers.
 *
 * @returns {Array<{id: string, name?: string, enabled: boolean, layers: Array<{id: string, name?: string, enabled: boolean}>}>}
 */
function getEffectiveLayerGroups() {
  const contextGroups =
    typeof OTEFDataContext !== "undefined"
      ? OTEFDataContext.getLayerGroups()
      : null;
  const contextMap = new Map();
  if (Array.isArray(contextGroups)) {
    for (const g of contextGroups) {
      contextMap.set(g.id, g);
    }
  }

  let groups = [];
  if (
    typeof layerRegistry !== "undefined" &&
    layerRegistry._initialized
  ) {
    const registryGroups = layerRegistry.getGroups();
    for (const reg of registryGroups) {
      const state = contextMap.get(reg.id);
      if (state) {
        const layers = (reg.layers || []).map((layer) => {
          const layerState = state.layers?.find((l) => l.id === layer.id);
          return {
            ...layer,
            name: layerState?.displayName ?? layer.name ?? layer.id,
            enabled: layerState ? !!layerState.enabled : defaultLayerEnabled(reg.id, layer.id),
          };
        });
        const enabled =
          state.id === "_legacy"
            ? !!state.enabled
            : layers.length > 0 && layers.every((l) => l.enabled);
        groups.push({
          id: reg.id,
          name: reg.name ?? reg.id,
          enabled: !!state.enabled,
          layers,
        });
      } else {
        const layers = (reg.layers || []).map((layer) => ({
          ...layer,
          name: layer.name ?? layer.id,
          enabled: defaultLayerEnabled(reg.id, layer.id),
        }));
        const defaultGroupEnabled = defaultGroupEnabledFor(reg.id, layers);
        groups.push({
          id: reg.id,
          name: reg.name ?? reg.id,
          enabled: defaultGroupEnabled,
          layers,
        });
      }
    }
  }

  for (const cg of contextGroups || []) {
    if (groups.some((g) => g.id === cg.id)) continue;
    groups.push({
      id: cg.id,
      name: cg.id === "curated" ? "Curated" : cg.id,
      enabled: !!cg.enabled,
      layers: (cg.layers || []).map((l) => ({
        id: l.id,
        name: l.displayName || l.id,
        enabled: !!l.enabled,
      })),
    });
  }

  return groups;
}

function defaultGroupEnabledFor(groupId, layers) {
  if (groupId === "projector_base") return true;
  return layers.length > 0 && layers.every((l) => defaultLayerEnabled(groupId, l.id));
}

function defaultLayerEnabled(groupId, layerId) {
  if (groupId === "projector_base" && layerId === "model_base") return true;
  return false;
}

// Expose globals for browser consumers
if (typeof window !== "undefined") {
  window.LayerStateHelper = {
    parseFullLayerId,
    getLayerIdOnly,
    resolveLayerState,
    getLayerState,
    getEffectiveLayerGroups,
  };
}

// Export for Node/CommonJS consumers (tests, tooling)
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    parseFullLayerId,
    getLayerIdOnly,
    resolveLayerState,
    getLayerState,
    getEffectiveLayerGroups,
  };
}
