/**
 * Layer visibility state management for the Leaflet GIS map.
 * Depends on global `map`, `layerState`, `parcelsLayer`, `roadsLayer`,
 * `modelOverlay`, `majorRoadsLayer`, `smallRoadsLayer`, and the async
 * loader helpers defined in `leaflet-control-with-basemap.js`.
 */

/**
 * Apply layer state from API/notification.
 */
function applyLayerState(layers) {
  let hasChanges = false;

  // Update roads layer
  if (layers.roads !== undefined && layers.roads !== layerState.roads) {
    if (roadsLayer) {
      if (layers.roads) {
        map.addLayer(roadsLayer);
      } else {
        map.removeLayer(roadsLayer);
      }
    }
    layerState.roads = layers.roads;
    hasChanges = true;
  }

  // Update parcels layer
  if (layers.parcels !== undefined && layers.parcels !== layerState.parcels) {
    if (parcelsLayer) {
      if (layers.parcels) {
        map.addLayer(parcelsLayer);
      } else {
        map.removeLayer(parcelsLayer);
      }
    }
    layerState.parcels = layers.parcels;
    hasChanges = true;
  }

  // Update model layer
  if (layers.model !== undefined && layers.model !== layerState.model) {
    if (modelOverlay) {
      if (layers.model) {
        map.addLayer(modelOverlay);
      } else {
        map.removeLayer(modelOverlay);
      }
    }
    layerState.model = layers.model;
    hasChanges = true;
  }

  // Update majorRoads layer
  if (layers.majorRoads !== undefined && layers.majorRoads !== layerState.majorRoads) {
    if (layers.majorRoads && !majorRoadsLayer) {
      loadMajorRoadsFromGeoJSON().then(() => {
        if (majorRoadsLayer && layers.majorRoads) {
          map.addLayer(majorRoadsLayer);
          updateMapLegend();
        }
      });
    } else if (majorRoadsLayer) {
      if (layers.majorRoads) {
        map.addLayer(majorRoadsLayer);
      } else {
        map.removeLayer(majorRoadsLayer);
      }
    }
    layerState.majorRoads = layers.majorRoads;
    hasChanges = true;
  }

  // Update smallRoads layer
  if (layers.smallRoads !== undefined && layers.smallRoads !== layerState.smallRoads) {
    if (layers.smallRoads && !smallRoadsLayer) {
      loadSmallRoadsFromGeoJSON().then(() => {
        if (smallRoadsLayer && layers.smallRoads) {
          map.addLayer(smallRoadsLayer);
          updateMapLegend();
        }
      });
    } else if (smallRoadsLayer) {
      if (layers.smallRoads) {
        map.addLayer(smallRoadsLayer);
      } else {
        map.removeLayer(smallRoadsLayer);
      }
    }
    layerState.smallRoads = layers.smallRoads;
    hasChanges = true;
  }

  if (hasChanges) {
    updateMapLegend();
    console.log("[GIS Map] Layer state applied:", layerState);
  }
}

/**
 * Handle layer update from remote controller.
 * GIS map is receive-only, so all updates come from remote.
 */
function handleLayerUpdate(msg) {
  if (!validateLayerUpdate(msg)) {
    console.warn("[GIS Map] Invalid layer update message:", msg);
    return;
  }

  const layers = msg.layers;

  // Check if there are any actual changes
  const hasChanges =
    (layers.roads !== undefined && layers.roads !== layerState.roads) ||
    (layers.parcels !== undefined && layers.parcels !== layerState.parcels) ||
    (layers.model !== undefined && layers.model !== layerState.model) ||
    (layers.majorRoads !== undefined && layers.majorRoads !== layerState.majorRoads) ||
    (layers.smallRoads !== undefined && layers.smallRoads !== layerState.smallRoads);

  if (!hasChanges) {
    console.log("[GIS Map] Layer update matches current state, ignoring");
    return;
  }

  console.log("[GIS Map] Processing layer update from remote:", layers);

  // Update layer visibility (GIS map is receive-only, no broadcasting)
  if (layers.roads !== undefined && layers.roads !== layerState.roads) {
    if (layers.roads) {
      map.addLayer(roadsLayer);
    } else {
      map.removeLayer(roadsLayer);
    }
    layerState.roads = layers.roads;
  }

  if (layers.parcels !== undefined && layers.parcels !== layerState.parcels) {
    if (layers.parcels) {
      map.addLayer(parcelsLayer);
    } else {
      map.removeLayer(parcelsLayer);
    }
    layerState.parcels = layers.parcels;
  }

  if (layers.model !== undefined && layers.model !== layerState.model) {
    if (layers.model) {
      map.addLayer(modelOverlay);
    } else {
      map.removeLayer(modelOverlay);
    }
    layerState.model = layers.model;
  }

  // Update majorRoads layer
  if (layers.majorRoads !== undefined && layers.majorRoads !== layerState.majorRoads) {
    if (layers.majorRoads && !majorRoadsLayer) {
      // Lazy load if needed
      loadMajorRoadsFromGeoJSON().then(() => {
        if (majorRoadsLayer && layers.majorRoads) {
          map.addLayer(majorRoadsLayer);
          updateMapLegend();
        }
      });
    } else if (majorRoadsLayer) {
      if (layers.majorRoads) {
        map.addLayer(majorRoadsLayer);
      } else {
        map.removeLayer(majorRoadsLayer);
      }
    }
    layerState.majorRoads = layers.majorRoads;
  }

  // Update smallRoads layer
  if (layers.smallRoads !== undefined && layers.smallRoads !== layerState.smallRoads) {
    if (layers.smallRoads && !smallRoadsLayer) {
      // Lazy load if needed
      loadSmallRoadsFromGeoJSON().then(() => {
        if (smallRoadsLayer && layers.smallRoads) {
          map.addLayer(smallRoadsLayer);
          updateMapLegend();
        }
      });
    } else if (smallRoadsLayer) {
      if (layers.smallRoads) {
        map.addLayer(smallRoadsLayer);
      } else {
        map.removeLayer(smallRoadsLayer);
      }
    }
    layerState.smallRoads = layers.smallRoads;
  }

  // Update legend to show only active layers
  updateMapLegend();

  // GIS map is receive-only - no broadcasting needed
}

