import {
  setPinkLineBaseVisibility,
  setPinkLineParkingMapVisibility,
} from "./leaflet-curated-layer-loader.js";
import {
  computePinkLineBaseLayerVisible,
  computePinkLineParkingOverlayVisible,
} from "../map-utils/curated-pink-axis-state.js";

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
const MAX_GIS_LAYER_LOAD_CONCURRENCY = 2;
const queuedLayerLoads = new Set();
const layerLoadQueue = [];
let activeLayerLoads = 0;

function processLayerLoadQueue() {
  while (
    activeLayerLoads < MAX_GIS_LAYER_LOAD_CONCURRENCY &&
    layerLoadQueue.length > 0
  ) {
    const task = layerLoadQueue.shift();
    if (typeof task !== "function") continue;
    activeLayerLoads++;
    task().finally(() => {
      activeLayerLoads = Math.max(0, activeLayerLoads - 1);
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(processLayerLoadQueue);
      } else {
        setTimeout(processLayerLoadQueue, 0);
      }
    });
  }
}

function enqueueLayerLoad(loadLayer, fullLayerId, onLoaded, onError) {
  if (typeof loadLayer !== "function" || !fullLayerId) return;
  if (queuedLayerLoads.has(fullLayerId)) return;
  queuedLayerLoads.add(fullLayerId);
  layerLoadQueue.push(async () => {
    try {
      await loadLayer(fullLayerId);
      if (typeof onLoaded === "function") onLoaded();
    } catch (err) {
      if (typeof onError === "function") onError(err);
    } finally {
      queuedLayerLoads.delete(fullLayerId);
    }
  });
  processLayerLoadQueue();
}

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

function getLayerEnabled(effectiveLayerEnabledMap, fullLayerId) {
  if (!(effectiveLayerEnabledMap instanceof Map)) return false;
  return effectiveLayerEnabledMap.get(fullLayerId) === true;
}

function isLayerEnableStateUnchanged(
  previousEffective,
  nextEffective,
  fullLayerId,
) {
  const before = getLayerEnabled(previousEffective, fullLayerId);
  const after = getLayerEnabled(nextEffective, fullLayerId);
  return before === after;
}

function buildEffectiveLayerEnabledMap(layerGroups) {
  const effective = new Map();
  for (const group of layerGroups || []) {
    for (const layer of group.layers || []) {
      if (
        typeof shouldShowLayerOnGisMap === "function" &&
        !shouldShowLayerOnGisMap(group.id, layer.id)
      ) {
        continue;
      }
      effective.set(`${group.id}.${layer.id}`, !!layer.enabled);
    }
  }
  return effective;
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

  const registry = deps.layerRegistry || null;
  const registryReady = !!(registry && registry._initialized);

  const pinkBaseVisible = computePinkLineBaseLayerVisible(layerGroups);
  const pinkParkingVisible = computePinkLineParkingOverlayVisible(layerGroups);
  if (typeof setPinkLineBaseVisibility === "function") {
    try {
      setPinkLineBaseVisibility(pinkBaseVisible);
    } catch (_) {
      // Non-fatal; base pink-line visibility is a visual enhancement.
    }
  }
  if (typeof setPinkLineParkingMapVisibility === "function") {
    try {
      setPinkLineParkingMapVisibility(pinkParkingVisible);
    } catch (_) {
      // Non-fatal
    }
  }

  if (registry && !registryReady) {
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
    // Do not return here: curated/non-registry groups should still be processed.
  }

  const loadLayer = deps.loadLayerFromRegistry || null;
  const updateVisibility = deps.updateLayerVisibilityFromRegistry || null;
  const loadedMap = deps.loadedLayersMap || null;
  const updateLegend =
    typeof deps.updateMapLegend === "function"
      ? deps.updateMapLegend
      : () => {};
  const mapInstance = deps.map || null;
  const currentZoom =
    mapInstance && typeof mapInstance.getZoom === "function"
      ? mapInstance.getZoom()
      : null;
  const visibilityCache =
    deps._visibilityStateCache || (deps._visibilityStateCache = new Map());
  const previousEffectiveLayerEnabledMap =
    deps._previousEffectiveLayerEnabledMap || new Map();
  const nextEffectiveLayerEnabledMap = buildEffectiveLayerEnabledMap(layerGroups);
  deps._previousEffectiveLayerEnabledMap = nextEffectiveLayerEnabledMap;
  const computeAllowedVisibility = (
    fullLayerId,
    scaleRange,
    { requireEnabledState = false } = {},
  ) => {
    const zoomNow =
      mapInstance && typeof mapInstance.getZoom === "function"
        ? mapInstance.getZoom()
        : currentZoom;
    if (
      zoomNow === null ||
      typeof VisibilityController === "undefined" ||
      !VisibilityController ||
      typeof VisibilityController.shouldLayerBeVisible !== "function"
    ) {
      return true;
    }
    const allowedByZoom = VisibilityController.shouldLayerBeVisible({
      fullLayerId,
      scaleRange,
      zoom: zoomNow,
    });
    if (!allowedByZoom) return false;
    if (!requireEnabledState) return true;
    if (
      typeof LayerStateHelper !== "undefined" &&
      LayerStateHelper &&
      typeof LayerStateHelper.getLayerState === "function"
    ) {
      const state = LayerStateHelper.getLayerState(fullLayerId);
      if (state && state.enabled === false) {
        return false;
      }
    }
    return true;
  };

  // Process each group - individual layer.enabled is the source of truth for visibility.
  // Curated groups are allowed even when the registry is not yet initialized;
  // non-curated (registry-backed) groups are deferred until registryReady.
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

      const isCuratedGroup =
        typeof group.id === "string" && group.id.startsWith("curated");

      if (!isCuratedGroup && !registryReady) {
        continue;
      }

      if (layer.enabled) {
        let scaleRange = null;
        if (registryReady && registry && typeof registry.getLayerConfig === "function") {
          const cfg = registry.getLayerConfig(fullLayerId);
          if (cfg && cfg.style && cfg.style.scaleRange) {
            scaleRange = cfg.style.scaleRange;
          }
        }
        const shouldLoadAtCurrentZoom = computeAllowedVisibility(
          fullLayerId,
          scaleRange,
        );
        if (!shouldLoadAtCurrentZoom) {
          applyVisibilityIfChanged(
            updateVisibility,
            fullLayerId,
            false,
            visibilityCache,
          );
          continue;
        }

        if (
          loadedMap &&
          loadedMap.has(fullLayerId) &&
          isLayerEnableStateUnchanged(
            previousEffectiveLayerEnabledMap,
            nextEffectiveLayerEnabledMap,
            fullLayerId,
          )
        ) {
          continue;
        }

        if (loadLayer) {
          if (loadedMap && loadedMap.has(fullLayerId)) {
            if (updateVisibility) {
              applyVisibilityIfChanged(
                updateVisibility,
                fullLayerId,
                computeAllowedVisibility(fullLayerId, scaleRange, {
                  requireEnabledState: true,
                }),
                visibilityCache,
              );
            }
          } else {
            enqueueLayerLoad(
              loadLayer,
              fullLayerId,
              () => {
                if (updateVisibility) {
                  applyVisibilityIfChanged(
                    updateVisibility,
                    fullLayerId,
                    computeAllowedVisibility(fullLayerId, scaleRange, {
                      requireEnabledState: true,
                    }),
                    visibilityCache,
                  );
                }
                updateLegend();
              },
              (err) => {
                console.error(
                  `[GIS Map] Failed to load layer ${fullLayerId}:`,
                  err,
                );
              },
            );
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
      if (currentZoom !== null) {
        for (const fullLayerId of loadedMap.keys()) {
          let scaleRange = null;
          if (registryReady) {
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

export { applyLayerGroupsState };
