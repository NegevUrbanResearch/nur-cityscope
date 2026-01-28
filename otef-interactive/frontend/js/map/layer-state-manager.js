/**
 * Layer visibility state management for the Leaflet GIS map.
 * Depends on global `map`, `layerState`, `modelOverlay`.
 * Legacy: model base only; vector layers use registry.
 */

/**
 * Apply layer state from API/notification.
 * Only model base image is driven by legacy layers; vector layers use registry.
 */
function applyLayerState(layers) {
  if (layers.model === undefined || layers.model === layerState.model) return;
  if (modelOverlay) {
    if (layers.model) {
      map.addLayer(modelOverlay);
    } else {
      map.removeLayer(modelOverlay);
    }
  }
  layerState.model = layers.model;
  updateMapLegend();
}

/**
 * Handle layer update from remote controller.
 * GIS map is receive-only, so all updates come from remote.
 * Only model base image is driven by legacy layers.
 */
function handleLayerUpdate(msg) {
  if (!validateLayerUpdate(msg)) {
    console.warn("[GIS Map] Invalid layer update message:", msg);
    return;
  }
  const layers = msg.layers;
  if (layers.model === undefined || layers.model === layerState.model) return;
  if (layers.model) {
    map.addLayer(modelOverlay);
  } else {
    map.removeLayer(modelOverlay);
  }
  layerState.model = layers.model;
  updateMapLegend();
}

/**
 * Apply layer groups state from API/notification.
 * Handles the new hierarchical layer groups structure.
 *
 * Note: group.enabled acts as a "toggle all" shortcut, not a gate.
 * Individual layers can be shown/hidden regardless of group.enabled state.
 * When group.enabled changes, it sets all layers in the group to that state.
 */
let pendingLayerGroupsState = null;
let layerRegistryInitPromise = null;

function applyLayerGroupsState(layerGroups) {
  if (!layerGroups || !Array.isArray(layerGroups)) {
    console.warn("[GIS Map] Invalid layer groups state");
    return;
  }

  if (typeof layerRegistry === "undefined") {
    return;
  }

  if (!layerRegistry._initialized) {
    pendingLayerGroupsState = layerGroups;
    if (!layerRegistryInitPromise) {
      layerRegistryInitPromise = layerRegistry
        .init()
        .then(() => {
          const pending = pendingLayerGroupsState;
          pendingLayerGroupsState = null;
          layerRegistryInitPromise = null;
          if (pending) {
            applyLayerGroupsState(pending);
          }
        })
        .catch(() => {
          layerRegistryInitPromise = null;
        });
    }
    return;
  }

  // Process each group - individual layer.enabled is the source of truth for visibility
  for (const group of layerGroups) {
    // Skip projector_base group - these are projector-only layers
    if (group.id === 'projector_base') {
      continue;
    }

    for (const layer of group.layers || []) {
      const fullLayerId = `${group.id}.${layer.id}`;

      if (layer.enabled) {
        // Layer should be visible - load if needed, then show
        if (typeof loadLayerFromRegistry === 'function') {
          // Check if layer is already loaded - if so, just set visibility directly
          if (typeof loadedLayersMap !== 'undefined' && loadedLayersMap.has(fullLayerId)) {
            if (typeof updateLayerVisibilityFromRegistry === 'function') {
              updateLayerVisibilityFromRegistry(fullLayerId, true);
            }
          } else {
            // Layer not loaded yet, load it first
            loadLayerFromRegistry(fullLayerId)
              .then(() => {
                if (typeof updateLayerVisibilityFromRegistry === 'function') {
                  updateLayerVisibilityFromRegistry(fullLayerId, true);
                }
                updateMapLegend();
              })
              .catch((err) => {
                console.error(`[GIS Map] Failed to load layer ${fullLayerId}:`, err);
              });
          }
        }
      } else {
        // Layer is disabled, hide it
        if (typeof updateLayerVisibilityFromRegistry === 'function') {
          updateLayerVisibilityFromRegistry(fullLayerId, false);
        }
      }
    }
  }

  updateMapLegend();
}
