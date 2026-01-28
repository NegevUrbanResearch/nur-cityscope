// Projection layer manager
// Handles layer loading and registry integration only (legacy road layers removed)

(function () {
  let getModelBounds = null;
  let getDisplayedImageBounds = null;
  let canvasRenderer = null;

  const loadedLayers = {};
  const layerState = {
    model: false,
  };

  function configure(deps) {
    getModelBounds = deps?.getModelBounds || null;
    getDisplayedImageBounds = deps?.getDisplayedImageBounds || null;
  }

  function getModelBoundsSafe() {
    return typeof getModelBounds === "function" ? getModelBounds() : null;
  }

  function getDisplayBoundsSafe() {
    return typeof getDisplayedImageBounds === "function"
      ? getDisplayedImageBounds()
      : null;
  }

  function updateLayerVisibility(layerId, visible) {
    if (canvasRenderer) {
      canvasRenderer.setLayerVisibility(layerId, visible);
    }
  }

  /**
   * Initialize layers - create Canvas renderer and load default layers
   */
  async function initializeLayers() {
    const modelBounds = getModelBoundsSafe();
    if (!modelBounds) {
      console.error("Cannot initialize layers: model bounds not loaded");
      return;
    }

    // Create Canvas renderer (replaces SVG for performance)
    try {
      canvasRenderer = new CanvasLayerRenderer("displayContainer");

      // Update canvas position now
      const displayBounds = getDisplayBoundsSafe();
      if (displayBounds) {
        canvasRenderer.updatePosition(displayBounds, modelBounds);
      }
    } catch (error) {
      console.error("[Projection] Failed to create Canvas renderer:", error);
      return;
    }

    // Initialize layer registry if available
    if (typeof layerRegistry !== "undefined") {
      await layerRegistry.init();

      // Load layers from new layer groups system
      if (layerRegistry._initialized) {
        await loadProjectionLayerGroups();

        // Now that layerRegistry is initialized, sync with current state from OTEFDataContext
        // This handles the case where OTEFDataContext loaded state before layerRegistry was ready
        if (typeof OTEFDataContext !== "undefined") {
          const currentLayerGroups = OTEFDataContext.getLayerGroups();
          if (currentLayerGroups) {
            // Sync layer groups after registry init
            syncLayerGroupsFromState(currentLayerGroups);
          }
        }
      }
    }

    layerState.model = false;

    // Set model image visibility to match default state
    const img = document.getElementById("displayedImage");
    if (img) {
      img.style.opacity = layerState.model ? "1" : "0";
    }
  }

  /**
   * Load all layers from the new layer groups system for projection display.
   */
  async function loadProjectionLayerGroups() {
    if (!layerRegistry || !layerRegistry._initialized) {
      console.warn("[Projection] Layer registry not initialized");
      return;
    }

    const layerGroups =
      typeof OTEFDataContext !== "undefined"
        ? OTEFDataContext.getLayerGroups()
        : null;
    if (!Array.isArray(layerGroups) || layerGroups.length === 0) {
      // Defer heavy registry loads until layer groups state is available
      return;
    }

    // Load only enabled layers to avoid heavy initial transforms
    for (const group of layerGroups) {
      for (const layer of group.layers || []) {
        if (!layer.enabled) continue;
        const fullLayerId = `${group.id}.${layer.id}`;
        await loadProjectionLayerFromRegistry(fullLayerId);
      }
    }
  }

  /**
   * Load a single layer from the layer registry for projection display.
   * @param {string} fullLayerId - Full layer ID (e.g., "map_3_future.mimushim")
   */
  async function loadProjectionLayerFromRegistry(fullLayerId) {
    if (loadedLayers[fullLayerId]) {
      return;
    }

    const layerConfig = layerRegistry.getLayerConfig(fullLayerId);
    if (!layerConfig) {
      console.warn(`[Projection] Layer config not found: ${fullLayerId}`);
      return;
    }

    try {
      // Projection always uses GeoJSON (PMTiles not supported in Canvas renderer)
      const dataUrl = layerRegistry.getLayerDataUrl(fullLayerId);
      if (!dataUrl) {
        console.warn(`[Projection] No GeoJSON data URL for layer: ${fullLayerId}`);
        return;
      }

      console.log(`[Projection] Fetching layer data: ${fullLayerId} from ${dataUrl}`);
      const response = await fetch(dataUrl);
      if (!response.ok) {
        throw new Error(`Failed to load layer data: ${response.status}`);
      }

      let geojson = await response.json();
      console.log(`[Projection] Loaded layer ${fullLayerId}, features: ${geojson.features?.length || 0}`);

      // Check CRS and transform from WGS84 to ITM if needed
      // Projection canvas expects ITM coordinates to match model bounds
      const crs = geojson.crs?.properties?.name || "";

      // Heuristic: Check if coordinates look like WGS84 (small values) vs ITM (large values)
      const firstCoord = getFirstCoordinate(geojson);
      let isWgs84 = false;

      if (firstCoord) {
          // If x < 1000 and y < 1000, it's definitely not ITM (ITM is usually ~200,000 / ~600,000)
          if (Math.abs(firstCoord[0]) < 1000 && Math.abs(firstCoord[1]) < 1000) {
              isWgs84 = true;
          }
      }

      if (crs.includes("4326") || crs.includes("WGS") || isWgs84) {
        if (isWgs84) console.log(`[Projection] Detected WGS84 coordinates for ${fullLayerId}, transforming to ITM...`);
        geojson = CoordUtils.transformGeojsonToItm(geojson);
      } else if (!crs || crs === "") {
         // Fallback logic preserved but enhanced above
         // If we are here, isWgs84 is false, meaning coordinates are likely large (ITM)
         console.log(`[Projection] Detected existing ITM-like coordinates for ${fullLayerId}`);
      }

      // Get canvas style function from StyleApplicator
      const canvasStyleFunction = StyleApplicator.getCanvasStyle(layerConfig);

      // Render layer using Canvas renderer
      await renderLayerFromGeojson(geojson, fullLayerId, canvasStyleFunction, layerConfig.geometryType);
    } catch (error) {
      console.error(`[Projection] Error loading layer ${fullLayerId}:`, error);
    }
  }



  /**
   * Extract the first coordinate from a GeoJSON to detect CRS
   * @param {Object} geojson - GeoJSON object
   * @returns {Array|null} First coordinate [x, y] or null
   */
  function getFirstCoordinate(geojson) {
    if (!geojson.features || geojson.features.length === 0) return null;

    for (const feature of geojson.features) {
      if (!feature.geometry || !feature.geometry.coordinates) continue;

      let coords = feature.geometry.coordinates;
      // Drill down to find a coordinate pair
      while (Array.isArray(coords) && Array.isArray(coords[0])) {
        coords = coords[0];
      }
      if (Array.isArray(coords) && typeof coords[0] === "number") {
        return coords;
      }
    }
    return null;
  }

  /**
   * Sync layer groups state for projection display.
   *
   * Note: group.enabled acts as a "toggle all" shortcut, not a gate.
   * Individual layers can be shown/hidden regardless of group.enabled state.
   */
  function syncLayerGroupsFromState(layerGroups) {
    if (!layerGroups || !Array.isArray(layerGroups)) {
      console.warn("[Projection] Invalid layer groups state");
      return;
    }

    // Guard against race condition: layerRegistry must be initialized before syncing
    if (typeof layerRegistry === "undefined" || !layerRegistry._initialized) {
      return;
    }

    // Process each group - individual layer.enabled is the source of truth for visibility
    for (const group of layerGroups) {
      for (const layer of group.layers || []) {
        const fullLayerId = `${group.id}.${layer.id}`;

        if (layer.enabled) {
          // Layer should be visible - load if needed, then show
          if (!loadedLayers[fullLayerId]) {
            loadProjectionLayerFromRegistry(fullLayerId)
              .then(() => {
                updateLayerVisibility(fullLayerId, true);
              })
              .catch((err) => {
                console.error(`[Projection] Failed to load layer ${fullLayerId}:`, err);
              });
          } else {
            updateLayerVisibility(fullLayerId, true);
          }
        } else {
          // Layer is disabled, hide it
          updateLayerVisibility(fullLayerId, false);
        }
      }
    }
  }

  /**
   * Helper function to render a layer from GeoJSON using Canvas
   */
  async function renderLayerFromGeojson(geojson, layerName, styleFunction, geometryType) {
    const displayBounds = getDisplayBoundsSafe();
    const modelBounds = getModelBoundsSafe();
    if (!displayBounds || !modelBounds) {
      throw new Error("Display bounds not available");
    }

    // Store for Canvas renderer (raw ITM coordinates, Canvas does transformation)
    loadedLayers[layerName] = {
      originalGeojson: geojson,
      styleFunction: styleFunction,
      geometryType: geometryType
    };

    // Add layer to Canvas renderer
    if (canvasRenderer) {
      canvasRenderer.setLayer(layerName, geojson, styleFunction, geometryType);
      canvasRenderer.updatePosition(displayBounds, modelBounds);

      // Registry layers: individual layer.enabled is the source of truth
      let shouldBeVisible = false;
      if (typeof OTEFDataContext !== "undefined") {
        const layerGroups = OTEFDataContext.getLayerGroups();
        if (layerGroups) {
          const [groupId, layerId] = layerName.split(".");
          const group = layerGroups.find((g) => g.id === groupId);
          if (group) {
            const layerStateObj = group.layers.find((l) => l.id === layerId);
            shouldBeVisible = layerStateObj ? layerStateObj.enabled : false;
          }
        }
      }
      canvasRenderer.setLayerVisibility(layerName, shouldBeVisible);
    }
  }

  /**
   * Sync layers from state object (shared by API fetch and notifications).
   * Only model base image visibility is driven by legacy layers; all vector layers use registry.
   */
  function syncLayersFromState(layers) {
    if (layers.model === undefined || layers.model === layerState.model) return;
    layerState.model = layers.model;
    const img = document.getElementById("displayedImage");
    if (img) {
      img.style.opacity = layers.model ? "1" : "0";
    }
  }

  /**
   * Handle layer update from WebSocket.
   * Only model base image visibility is driven by legacy layers.
   */
  function handleLayerUpdate(msg) {
    if (!validateLayerUpdate(msg)) {
      console.warn("[Projection] Invalid layer update message:", msg);
      return;
    }
    const layers = msg.layers;
    if (layers.model === undefined || layers.model === layerState.model) return;
    layerState.model = layers.model;
    const img = document.getElementById("displayedImage");
    if (img) {
      img.style.opacity = layers.model ? "1" : "0";
    }
  }

  function handleResize() {
    const displayBounds = getDisplayBoundsSafe();
    const modelBounds = getModelBoundsSafe();
    if (canvasRenderer && displayBounds && modelBounds) {
      canvasRenderer.updatePosition(displayBounds, modelBounds);
    }
  }

  window.ProjectionLayerManager = {
    configure,
    initializeLayers,
    syncLayersFromState,
    syncLayerGroupsFromState,
    handleLayerUpdate,
    handleResize
  };
})();
