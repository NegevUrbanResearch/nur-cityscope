// Projection layer manager
// Handles layer loading and registry integration only (legacy road layers removed)

(function () {
  let getModelBounds = null;
  let getDisplayedImageBounds = null;
  let canvasRenderer = null;
  let wmtsRenderer = null;

  const loadedLayers = {};

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

  function updateWmtsVisibility(visible) {
    if (wmtsRenderer) {
      wmtsRenderer.setVisible(visible);
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

    // Create WMTS layer renderer (satellite imagery etc.)
    try {
      if (typeof WmtsLayerRenderer !== "undefined") {
        wmtsRenderer = new WmtsLayerRenderer("displayContainer");
        const displayBounds = getDisplayBoundsSafe();
        if (displayBounds) {
          wmtsRenderer.updatePosition(displayBounds, modelBounds);
        }
      }
    } catch (error) {
      console.warn("[Projection] WMTS renderer not available:", error);
    }

    // Initialize layer registry if available
    if (typeof layerRegistry !== "undefined") {
      await layerRegistry.init();

      // Load layers from new layer groups system
      if (layerRegistry._initialized) {
        await loadProjectionLayerGroups();

        // Set model image src from registry (avoids hardcoded path / 404)
        const modelImageUrl = layerRegistry.getLayerDataUrl("projector_base.model_base");
        const img = document.getElementById("displayedImage");
        if (img && modelImageUrl) {
          img.src = modelImageUrl;
        }

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

    // Initialize model base image visibility from layerGroups state
    if (typeof OTEFDataContext !== "undefined") {
      const layerGroups = OTEFDataContext.getLayerGroups();
      const modelBaseState = getLayerStateFromGroups(layerGroups, 'projector_base', 'model_base');
      updateModelImageVisibility(modelBaseState?.enabled || false);
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

    // Handle image layers differently (they don't have GeoJSON data)
    if (layerConfig.format === "image") {
      console.log(
        `[Projection] Skipping image layer ${fullLayerId} (rendered via <img> element)`
      );
      loadedLayers[fullLayerId] = { type: "image" };
      return;
    }

    // Handle WMTS layers (tile imagery)
    if (layerConfig.format === "wmts") {
      if (wmtsRenderer && layerConfig.wmts) {
        wmtsRenderer.setLayer(fullLayerId, layerConfig);
        wmtsRenderer.setVisible(true);
        const displayBounds = getDisplayBoundsSafe();
        const modelBounds = getModelBoundsSafe();
        if (displayBounds && modelBounds) {
          wmtsRenderer.updatePosition(displayBounds, modelBounds);
        }
        loadedLayers[fullLayerId] = { type: "wmts" };
        console.log(`[Projection] WMTS layer loaded: ${fullLayerId}`);
      }
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

        // Handle model_base image layer specially
        if (fullLayerId === 'projector_base.model_base') {
          updateModelImageVisibility(layer.enabled);
          continue;
        }

        // Handle WMTS layer (satellite_imagery)
        if (fullLayerId === "projector_base.satellite_imagery") {
          updateWmtsVisibility(layer.enabled);
          if (layer.enabled && !loadedLayers[fullLayerId]) {
            loadProjectionLayerFromRegistry(fullLayerId)
              .then(() => {})
              .catch((err) => {
                console.error(
                  `[Projection] Failed to load WMTS layer ${fullLayerId}:`,
                  err
                );
              });
          }
          continue;
        }

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
      geometryType: geometryType,
    };

    // Add layer to Canvas renderer
    if (canvasRenderer) {
      canvasRenderer.setLayer(layerName, geojson, styleFunction, geometryType);
      canvasRenderer.updatePosition(displayBounds, modelBounds);

      // Registry layers: individual layer.enabled is the source of truth.
      // Reuse shared LayerStateHelper so projection and map agree on visibility.
      let shouldBeVisible = false;
      if (typeof LayerStateHelper !== "undefined" && typeof LayerStateHelper.getLayerState === "function") {
        const state = LayerStateHelper.getLayerState(layerName);
        shouldBeVisible = !!(state && state.enabled);
      } else if (typeof OTEFDataContext !== "undefined") {
        // Fallback to legacy direct lookup if helper is not available
        const layerGroups = OTEFDataContext.getLayerGroups();
        if (layerGroups) {
          const [groupId, layerId] = layerName.split(".");
          const group = layerGroups.find((g) => g.id === groupId);
          if (group && Array.isArray(group.layers)) {
            const layerStateObj = group.layers.find((l) => l && l.id === layerId);
            shouldBeVisible = !!(layerStateObj && layerStateObj.enabled);
          }
        }
      }

      canvasRenderer.setLayerVisibility(layerName, shouldBeVisible);
    }
  }

  /**
   * Helper to get layer state from layerGroups structure
   */
  function getLayerStateFromGroups(layerGroups, groupId, layerId) {
    if (!Array.isArray(layerGroups)) return null;
    const group = layerGroups.find(g => g.id === groupId);
    if (!group || !Array.isArray(group.layers)) return null;
    return group.layers.find(l => l.id === layerId);
  }

  /**
   * Update model base image visibility
   */
  function updateModelImageVisibility(visible) {
    const img = document.getElementById("displayedImage");
    if (img) {
      img.style.opacity = visible ? "1" : "0";
    }
  }

  function handleResize() {
    const displayBounds = getDisplayBoundsSafe();
    const modelBounds = getModelBoundsSafe();
    if (canvasRenderer && displayBounds && modelBounds) {
      canvasRenderer.updatePosition(displayBounds, modelBounds);
    }
    if (wmtsRenderer && displayBounds && modelBounds) {
      wmtsRenderer.updatePosition(displayBounds, modelBounds);
    }
  }

  window.ProjectionLayerManager = {
    configure,
    initializeLayers,
    syncLayerGroupsFromState,
    handleResize
  };
})();
