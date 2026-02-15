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

  function updateAllRendererPositions(displayBounds, modelBounds) {
    if (!displayBounds || !modelBounds) return;
    if (canvasRenderer) {
      canvasRenderer.updatePosition(displayBounds, modelBounds);
    }
    if (wmtsRenderer) {
      wmtsRenderer.updatePosition(displayBounds, modelBounds);
    }
  }

  function updateLayerVisibility(layerId, visible) {
    if (canvasRenderer) {
      canvasRenderer.setLayerVisibility(layerId, visible);
    }
  }

  function updateWmtsVisibility(fullLayerId, visible) {
    if (wmtsRenderer) {
      wmtsRenderer.setVisible(fullLayerId, visible);
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
        updateAllRendererPositions(displayBounds, modelBounds);
      }
    } catch (error) {
      console.error("[Projection] Failed to create Canvas renderer:", error);
      return;
    }

    try {
      if (typeof WmtsLayerRenderer !== "undefined") {
        wmtsRenderer = new WmtsLayerRenderer("displayContainer");
        const displayBounds = getDisplayBoundsSafe();
        if (displayBounds) {
          updateAllRendererPositions(displayBounds, modelBounds);
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
        const modelImageUrl = layerRegistry.getLayerDataUrl(
          "projector_base.model_base",
        );
        const img = document.getElementById("displayedImage");
        if (img && modelImageUrl) {
          img.src = modelImageUrl;
        }

        if (typeof LayerStateHelper !== "undefined" && typeof LayerStateHelper.getEffectiveLayerGroups === "function") {
          const effective = LayerStateHelper.getEffectiveLayerGroups();
          if (effective.length > 0) {
            syncLayerGroupsFromState(effective);
          }
        } else if (typeof OTEFDataContext !== "undefined") {
          const currentLayerGroups = OTEFDataContext.getLayerGroups();
          if (currentLayerGroups && currentLayerGroups.length > 0) {
            syncLayerGroupsFromState(currentLayerGroups);
          }
        }
      }
    }

    // Initialize model base image visibility from layerGroups state
    if (typeof OTEFDataContext !== "undefined") {
      const layerGroups = OTEFDataContext.getLayerGroups();
      const modelBaseState = getLayerStateFromGroups(
        layerGroups,
        "projector_base",
        "model_base",
      );
      updateModelImageVisibility(modelBaseState?.enabled || false);
    }
  }

  /**
   * Load all layers from the new layer groups system for projection display.
   * Uses effective layer groups (registry + context with defaults) so layers load when API has no state.
   */
  async function loadProjectionLayerGroups() {
    if (!layerRegistry || !layerRegistry._initialized) {
      console.warn("[Projection] Layer registry not initialized");
      return;
    }

    const layerGroups =
      typeof LayerStateHelper !== "undefined" &&
      typeof LayerStateHelper.getEffectiveLayerGroups === "function"
        ? LayerStateHelper.getEffectiveLayerGroups()
        : typeof OTEFDataContext !== "undefined"
          ? OTEFDataContext.getLayerGroups()
          : null;
    if (!Array.isArray(layerGroups) || layerGroups.length === 0) {
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
   * Load a curated layer from the API for projection. GeoJSON from API is in ITM.
   */
  async function loadProjectionCuratedLayerFromAPI(fullLayerId) {
    if (loadedLayers[fullLayerId]) return;
    const parts = fullLayerId.split(".");
    if (parts[0] !== "curated" || parts.length < 2) return;
    const layerId = parts.slice(1).join(".");

    let response;
    try {
      response = await fetch("/api/actions/get_otef_layers/?table=otef");
      if (!response.ok) throw new Error(response.status);
    } catch (e) {
      console.warn("[Projection] Failed to fetch OTEF layers for curated:", e);
      return;
    }

    const list = await response.json();
    const layerData = Array.isArray(list)
      ? list.find((l) => String(l.id) === String(layerId))
      : null;
    if (!layerData || layerData.layer_type !== "geojson") return;

    let geojson = layerData.geojson;
    if (!geojson && layerData.url) {
      const r = await fetch(layerData.url);
      if (!r.ok) throw new Error(r.status);
      geojson = await r.json();
    }
    if (!geojson || !geojson.features) return;

    const firstCoord = getFirstCoordinate(geojson);
    const looksLikeWgs84 =
      firstCoord &&
      Math.abs(firstCoord[0]) < 1000 &&
      Math.abs(firstCoord[1]) < 1000;
    if (looksLikeWgs84) {
      geojson = CoordUtils.transformGeojsonToItm(geojson);
    }

    const layerConfig = {
      style: {
        type: "simple",
        defaultStyle: {
          fillColor: "#00d4ff",
          fillOpacity: 0.4,
          strokeColor: "#00a8cc",
          strokeWidth: 2,
        },
      },
    };
    const geometryType =
      geojson.features[0]?.geometry?.type || "Polygon";
    await renderLayerFromGeojson(
      geojson,
      fullLayerId,
      layerConfig,
      geometryType,
    );
  }

  /**
   * Load a single layer from the layer registry for projection display.
   * @param {string} fullLayerId - Full layer ID (e.g., "map_3_future.mimushim")
   */
  async function loadProjectionLayerFromRegistry(fullLayerId) {
    if (loadedLayers[fullLayerId]) {
      return;
    }

    const layerConfig =
      layerRegistry && layerRegistry._initialized
        ? layerRegistry.getLayerConfig(fullLayerId)
        : null;
    if (!layerConfig) {
      if (fullLayerId.startsWith("curated.")) {
        await loadProjectionCuratedLayerFromAPI(fullLayerId);
        return;
      }
      console.warn(`[Projection] Layer config not found: ${fullLayerId}`);
      return;
    }

    // Handle image layers differently (they don't have GeoJSON data)
    if (layerConfig.format === "image") {
      console.log(
        `[Projection] Skipping image layer ${fullLayerId} (rendered via <img> element)`,
      );
      loadedLayers[fullLayerId] = { type: "image" };
      return;
    }

    // Handle WMTS layers (tile imagery)
    if (layerConfig.format === "wmts") {
      if (wmtsRenderer && layerConfig.wmts) {
        let maskGeometry = null;
        const maskConfig =
          typeof layerRegistry.getLayerMaskConfig === "function"
            ? layerRegistry.getLayerMaskConfig(fullLayerId)
            : layerConfig.mask;
        if (maskConfig && typeof layerRegistry.getLayerMaskAssetUrl === "function") {
          const maskUrl = layerRegistry.getLayerMaskAssetUrl(
            fullLayerId,
            maskConfig,
          );
          if (maskUrl) {
            try {
              const maskRes = await fetch(maskUrl);
              if (maskRes.ok) {
                let maskGeojson = await maskRes.json();
                const mcrs = (maskGeojson.crs?.properties?.name || "").toUpperCase();
                const mFirst = getFirstCoordinate(maskGeojson);
                const maskLooksWgs84 =
                  mFirst &&
                  Math.abs(mFirst[0]) < 1000 &&
                  Math.abs(mFirst[1]) < 1000;
                if (mcrs.includes("4326") || mcrs.includes("WGS") || maskLooksWgs84) {
                  maskGeojson = CoordUtils.transformGeojsonToItm(maskGeojson);
                }
                maskGeometry = maskGeojson;
              }
            } catch (e) {
              console.warn(
                `[Projection] Failed to load mask for ${fullLayerId}:`,
                e,
              );
            }
          }
        }
        wmtsRenderer.setLayer(fullLayerId, layerConfig, maskGeometry);
        const displayBounds = getDisplayBoundsSafe();
        const modelBounds = getModelBoundsSafe();
        if (displayBounds && modelBounds) {
          updateAllRendererPositions(displayBounds, modelBounds);
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
        console.warn(
          `[Projection] No GeoJSON data URL for layer: ${fullLayerId}`,
        );
        return;
      }

      console.log(
        `[Projection] Fetching layer data: ${fullLayerId} from ${dataUrl}`,
      );
      const response = await fetch(dataUrl);
      if (!response.ok) {
        throw new Error(`Failed to load layer data: ${response.status}`);
      }

      let geojson = await response.json();
      console.log(
        `[Projection] Loaded layer ${fullLayerId}, features: ${
          geojson.features?.length || 0
        }`,
      );

      // Normalize to ITM for projection: canvas expects ITM to match model bounds.
      // GeoJSON from processed layers is WGS84 [lon, lat]; from API/source may be ITM or WGS84.
      const crs = (geojson.crs?.properties?.name || "").toUpperCase();
      const firstCoord = getFirstCoordinate(geojson);
      const looksLikeWgs84 =
        firstCoord &&
        Math.abs(firstCoord[0]) < 1000 &&
        Math.abs(firstCoord[1]) < 1000;
      const looksLikeItm =
        firstCoord &&
        Math.abs(firstCoord[0]) >= 1000 &&
        Math.abs(firstCoord[1]) >= 1000;

      const crsSaysWgs84 = crs.includes("4326") || crs.includes("WGS");
      const crsSaysItm = crs.includes("2039") || crs.includes("ITM");

      let shouldTransformToItm = false;
      if (looksLikeItm && crsSaysItm) {
        shouldTransformToItm = false;
      } else if (looksLikeWgs84 || crsSaysWgs84) {
        if (looksLikeItm) {
          // Metadata says WGS84 but coords look ITM: trust coords, skip transform
          shouldTransformToItm = false;
        } else {
          shouldTransformToItm = true;
        }
      } else if (!crs || crs === "") {
        shouldTransformToItm = looksLikeWgs84;
      }

      if (shouldTransformToItm) {
        geojson = CoordUtils.transformGeojsonToItm(geojson);
      }

      // Render layer using Canvas renderer
      await renderLayerFromGeojson(
        geojson,
        fullLayerId,
        layerConfig,
        layerConfig.geometryType,
      );
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
        if (fullLayerId === "projector_base.model_base") {
          updateModelImageVisibility(layer.enabled);
          continue;
        }

        // Handle WMTS layers (any pack)
        const layerConfig =
          typeof layerRegistry !== "undefined"
            ? layerRegistry.getLayerConfig(fullLayerId)
            : null;
        if (layerConfig && layerConfig.format === "wmts") {
          if (layer.enabled && !loadedLayers[fullLayerId]) {
            loadProjectionLayerFromRegistry(fullLayerId)
              .then(() => {
                updateWmtsVisibility(fullLayerId, true);
              })
              .catch((err) => {
                console.error(
                  `[Projection] Failed to load WMTS layer ${fullLayerId}:`,
                  err,
                );
              });
          } else {
            updateWmtsVisibility(fullLayerId, layer.enabled);
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
                console.error(
                  `[Projection] Failed to load layer ${fullLayerId}:`,
                  err,
                );
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
  async function renderLayerFromGeojson(
    geojson,
    layerName,
    layerConfig,
    geometryType,
  ) {
    const displayBounds = getDisplayBoundsSafe();
    const modelBounds = getModelBoundsSafe();
    if (!displayBounds || !modelBounds) {
      throw new Error("Display bounds not available");
    }

    // Store for Canvas renderer (raw ITM coordinates, Canvas does transformation)
    loadedLayers[layerName] = {
      originalGeojson: geojson,
      styleFunction: StyleApplicator.getCanvasStyle(layerConfig),
      styleConfig: layerConfig,
      geometryType: geometryType,
    };

    // Add layer to Canvas renderer
    if (canvasRenderer) {
      canvasRenderer.setLayer(
        layerName,
        geojson,
        loadedLayers[layerName].styleFunction,
        geometryType,
        loadedLayers[layerName].styleConfig,
      );
      updateAllRendererPositions(displayBounds, modelBounds);

      // Registry layers: individual layer.enabled is the source of truth.
      // Reuse shared LayerStateHelper so projection and map agree on visibility.
      let shouldBeVisible = false;
      if (
        typeof LayerStateHelper !== "undefined" &&
        typeof LayerStateHelper.getLayerState === "function"
      ) {
        const state = LayerStateHelper.getLayerState(layerName);
        shouldBeVisible = !!(state && state.enabled);
      } else if (typeof OTEFDataContext !== "undefined") {
        // Fallback to legacy direct lookup if helper is not available
        const layerGroups = OTEFDataContext.getLayerGroups();
        if (layerGroups) {
          const parsed =
            typeof LayerStateHelper !== "undefined" &&
            typeof LayerStateHelper.parseFullLayerId === "function"
              ? LayerStateHelper.parseFullLayerId(layerName)
              : null;
          if (parsed) {
            const { groupId, layerId } = parsed;
            const group = layerGroups.find((g) => g.id === groupId);
            if (group && Array.isArray(group.layers)) {
              const layerStateObj = group.layers.find(
                (l) => l && l.id === layerId,
              );
              shouldBeVisible = !!(layerStateObj && layerStateObj.enabled);
            }
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
    const group = layerGroups.find((g) => g.id === groupId);
    if (!group || !Array.isArray(group.layers)) return null;
    return group.layers.find((l) => l.id === layerId);
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
    updateAllRendererPositions(displayBounds, modelBounds);
  }

  window.ProjectionLayerManager = {
    configure,
    initializeLayers,
    syncLayerGroupsFromState,
    handleResize,
  };
})();
