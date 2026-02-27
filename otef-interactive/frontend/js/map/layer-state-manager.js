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

function isVisibilityBatchingEnabled() {
  if (typeof MapProjectionConfig === "undefined" || !MapProjectionConfig.GIS_PERF) {
    return true;
  }
  return MapProjectionConfig.GIS_PERF.ENABLE_LAYER_VISIBILITY_BATCHING !== false;
}

function applyVisibilityIfChanged(
  updateVisibility,
  fullLayerId,
  nextVisible,
  visibilityCache,
) {
  if (!updateVisibility) return;
  if (!isVisibilityBatchingEnabled()) {
    updateVisibility(fullLayerId, nextVisible);
    return;
  }
  const previous = visibilityCache.get(fullLayerId);
  if (previous === nextVisible) return;
  visibilityCache.set(fullLayerId, nextVisible);
  updateVisibility(fullLayerId, nextVisible);
}

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
  const reconcileStart = Date.now();
  if (!layerGroups || !Array.isArray(layerGroups)) {
    console.warn("[GIS Map] Invalid layer groups state");
    return;
  }
  if (!deps || typeof deps !== "object") {
    console.warn("[GIS Map] applyLayerGroupsState requires deps");
    return;
  }

  const registry = deps.layerRegistry;
  const registryReady = registry && registry._initialized;

  // If registry isn't ready, queue for retry but still process curated layers now
  if (registry && !registry._initialized) {
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
  }

  const loadLayer = deps.loadLayerFromRegistry || null;
  const updateVisibility = deps.updateLayerVisibilityFromRegistry || null;
  const loadedMap = deps.loadedLayersMap || null;
  const updateLegend =
    typeof deps.updateMapLegend === "function"
      ? deps.updateMapLegend
      : () => {};
  const mapInstance = deps.map || null;
  const visibilityCache =
    deps._visibilityStateCache || (deps._visibilityStateCache = new Map());

  // Process each group - individual layer.enabled is the source of truth for visibility
  for (const group of layerGroups) {
    const isCurated = group.id.startsWith("curated");

    // Registry layers need the registry to be initialized
    if (!isCurated && !registryReady) continue;

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
              applyVisibilityIfChanged(
                updateVisibility,
                fullLayerId,
                true,
                visibilityCache,
              );
            }
          } else {
            loadLayer(fullLayerId)
              .then(() => {
                if (updateVisibility) {
                  applyVisibilityIfChanged(
                    updateVisibility,
                    fullLayerId,
                    true,
                    visibilityCache,
                  );
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
        applyVisibilityIfChanged(
          updateVisibility,
          fullLayerId,
          false,
          visibilityCache,
        );
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

          applyVisibilityIfChanged(
            updateVisibility,
            fullLayerId,
            allowed,
            visibilityCache,
          );
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

  if (
    typeof window !== "undefined" &&
    window.MapPerfTelemetry &&
    typeof window.MapPerfTelemetry.record === "function"
  ) {
    window.MapPerfTelemetry.record(
      "layerReconcileMs",
      Date.now() - reconcileStart,
    );
  }
}

// Export for Node/CommonJS consumers (tests)
if (typeof module !== "undefined" && module.exports) {
  module.exports = { applyLayerGroupsState };
}
