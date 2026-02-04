/**
 * Layer visibility state management for the Leaflet GIS map.
 * Vector layers use registry and layer groups.
 *
 * Map deps contract (when deps is passed):
 * - map: Leaflet map instance
 * - layerRegistry: LayerRegistry instance
 * - loadLayerFromRegistry(fullLayerId): async load function
 * - updateLayerVisibilityFromRegistry(fullLayerId, visible): visibility setter
 * - loadedLayersMap: Map of fullLayerId -> layer instance
 * - updateMapLegend(): optional legend refresh
 */

let pendingLayerGroupsState = null;
let layerRegistryInitPromise = null;
let pendingDeps = null;

/**
 * Apply layer groups state from API/notification.
 * Handles the new hierarchical layer groups structure.
 *
 * @param {Array} layerGroups - Layer groups from OTEFDataContext
 * @param {Object} deps - Map deps (required): map, layerRegistry, loadLayerFromRegistry, updateLayerVisibilityFromRegistry, loadedLayersMap, updateMapLegend.
 *
 * Note: group.enabled acts as a "toggle all" shortcut, not a gate.
 * Individual layers can be shown/hidden regardless of group.enabled state.
 */
function applyLayerGroupsState(layerGroups, deps) {
  if (!layerGroups || !Array.isArray(layerGroups)) {
    console.warn("[GIS Map] Invalid layer groups state");
    return;
  }
  if (!deps || typeof deps !== "object") {
    console.warn("[GIS Map] applyLayerGroupsState requires deps");
    return;
  }

  const registry = deps.layerRegistry;
  if (!registry) {
    return;
  }

  if (!registry._initialized) {
    pendingLayerGroupsState = layerGroups;
    pendingDeps = deps;
    if (!layerRegistryInitPromise) {
      layerRegistryInitPromise = registry
        .init()
        .then(() => {
          const pending = pendingLayerGroupsState;
          pendingLayerGroupsState = null;
          const nextDeps = pendingDeps;
          pendingDeps = null;
          layerRegistryInitPromise = null;
          if (pending && nextDeps) {
            applyLayerGroupsState(pending, nextDeps);
          }
        })
        .catch(() => {
          layerRegistryInitPromise = null;
        });
    }
    return;
  }

  const loadLayer = deps.loadLayerFromRegistry || null;
  const updateVisibility = deps.updateLayerVisibilityFromRegistry || null;
  const loadedMap = deps.loadedLayersMap || null;
  const updateLegend =
    typeof deps.updateMapLegend === "function"
      ? deps.updateMapLegend
      : () => {};
  const mapInstance = deps.map || null;

  // Process each group - individual layer.enabled is the source of truth for visibility
  for (const group of layerGroups) {
    for (const layer of group.layers || []) {
      if (
        typeof shouldShowLayerOnGisMap === "function" &&
        !shouldShowLayerOnGisMap(group.id, layer.id)
      ) {
        continue;
      }

      const fullLayerId = `${group.id}.${layer.id}`;

      if (layer.enabled) {
        if (loadLayer) {
          if (loadedMap && loadedMap.has(fullLayerId)) {
            if (updateVisibility) {
              updateVisibility(fullLayerId, true);
            }
          } else {
            loadLayer(fullLayerId)
              .then(() => {
                if (updateVisibility) {
                  updateVisibility(fullLayerId, true);
                }
                updateLegend();
              })
              .catch((err) => {
                console.error(
                  `[GIS Map] Failed to load layer ${fullLayerId}:`,
                  err,
                );
              });
          }
        }
      } else {
        if (updateVisibility) {
          updateVisibility(fullLayerId, false);
        }
      }
    }
  }

  // Reconcile all loaded layers against zoom + OTEFDataContext visibility
  try {
    if (
      loadedMap &&
      typeof VisibilityController !== "undefined" &&
      typeof LayerStateHelper !== "undefined" &&
      updateVisibility
    ) {
      const currentZoom =
        mapInstance && typeof mapInstance.getZoom === "function"
          ? mapInstance.getZoom()
          : null;

      if (currentZoom !== null) {
        for (const fullLayerId of loadedMap.keys()) {
          let scaleRange = null;
          if (registry) {
            const cfg = registry.getLayerConfig(fullLayerId);
            if (cfg && cfg.style && cfg.style.scaleRange) {
              scaleRange = cfg.style.scaleRange;
            }
          }

          const state = LayerStateHelper.getLayerState(fullLayerId);

          const allowed = VisibilityController.shouldLayerBeVisible({
            fullLayerId,
            scaleRange,
            zoom: currentZoom,
            layerStateHelper: LayerStateHelper,
          });

          updateVisibility(fullLayerId, allowed);
        }
      }
    }
  } catch (err) {
    console.warn(
      "[GIS Map] Failed to reconcile loaded layers after state update:",
      err,
    );
  }

  updateLegend();
}

// Export for Node/CommonJS consumers (tests)
if (typeof module !== "undefined" && module.exports) {
  module.exports = { applyLayerGroupsState };
}
