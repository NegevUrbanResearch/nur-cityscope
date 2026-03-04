// Projection layer manager
// Handles layer loading and registry integration only (legacy road layers removed)

(function () {
  let getModelBounds = null;
  let getDisplayedImageBounds = null;
  let canvasRenderer = null;
  let wmtsRenderer = null;
  let animationLoopHandle = null;
  let animationLastFrameMs = 0;

  const loadedLayers = {};
  const inFlightLayerLoads = {};

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

  const PINK_LINE_BASE_LAYER_ID = "pink_line_base";
  const CURATED_PROJECTION_PALETTE = ["#00b4d8", "#2dc653", "#e9c46a", "#e76f51", "#9b59b6", "#1dd3b0"];
  const MEMORIAL_ICON_URLS = {
    central: "/otef-interactive/img/memorial-sites/regional-memorial-site.png",
    local: "/otef-interactive/img/memorial-sites/local-memorial-site.png",
  };
  function getCuratedLayerColorForProjection(fullLayerId) {
    let h = 0;
    for (let i = 0; i < fullLayerId.length; i++) h = (h << 5) - h + fullLayerId.charCodeAt(i);
    return CURATED_PROJECTION_PALETTE[Math.abs(h) % CURATED_PROJECTION_PALETTE.length];
  }

  async function ensureProjectionPinkLineBaseLayer() {
    if (loadedLayers[PINK_LINE_BASE_LAYER_ID]) return;
    if (typeof parseDefaultLinePaths !== "function") return;
    try {
      const pinkRes = await fetch("/api/pink-line/");
      if (!pinkRes.ok) return;
      const pinkGeojson = await pinkRes.json();
      const basePaths = parseDefaultLinePaths(pinkGeojson);
      if (basePaths.length === 0) return;
      const features = basePaths.map((path) => ({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: path.map(([lat, lng]) => [lng, lat]),
        },
        properties: {},
      }));
      const wgs84Geojson = { type: "FeatureCollection", features };
      const itmGeojson = CoordUtils.transformGeojsonToItm(wgs84Geojson);
      const layerConfig = {
        style: {
          type: "simple",
          defaultStyle: { color: "#ff69b4", weight: 5, opacity: 1 },
        },
      };
      const styleFunction = () => ({ color: "#ff69b4", weight: 5, opacity: 1 });
      loadedLayers[PINK_LINE_BASE_LAYER_ID] = {
        originalGeojson: itmGeojson,
        styleFunction,
        styleConfig: layerConfig,
        geometryType: "line",
      };
      if (canvasRenderer) {
        canvasRenderer.setLayer(
          PINK_LINE_BASE_LAYER_ID,
          itmGeojson,
          styleFunction,
          "line",
          layerConfig,
        );
        canvasRenderer.setLayerVisibility(PINK_LINE_BASE_LAYER_ID, true);
      }
    } catch (_) {}
  }

  /**
   * Load a curated layer for projection. Original pink line shown in full (separate layer); curated only draws variations (dashed) + nodes.
   */
  async function loadProjectionCuratedLayerFromAPI(fullLayerId) {
    if (loadedLayers[fullLayerId]) return;
    const parts = fullLayerId.split(".");
    if (!parts[0].startsWith("curated") || parts.length < 2) return;
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

    let wgs84Geojson = geojson;
    const firstCoord = getFirstCoordinate(geojson);
    const looksLikeWgs84 =
      firstCoord &&
      Math.abs(firstCoord[0]) < 1000 &&
      Math.abs(firstCoord[1]) < 1000;
    if (!looksLikeWgs84 && firstCoord && Math.abs(firstCoord[0]) >= 1000) {
      wgs84Geojson = CoordUtils.transformGeojsonToWgs84(geojson);
    }

    const pointFeatures = (wgs84Geojson.features || []).filter(
      (f) => f.geometry && f.geometry.type === "Point" && f.geometry.coordinates
    );

    // Memorial sites: render as icon markers, skip pink line route integration
    const hasMemorialFeatures = pointFeatures.some(
      (f) => f.properties && (f.properties.feature_type === "central" || f.properties.feature_type === "local")
    );
    if (hasMemorialFeatures) {
      const features = pointFeatures.map((f) => {
        const c = f.geometry.coordinates;
        const ft = f.properties && f.properties.feature_type;
        const iconUrl = (ft && MEMORIAL_ICON_URLS[ft]) || null;
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: [c[0], c[1]] },
          properties: {
            ...f.properties,
            _curatedStyle: iconUrl
              ? { _iconUrl: iconUrl, _iconSize: 32 }
              : { fillColor: "#e76f51", color: "#fff", weight: 1, fillOpacity: 0.9, opacity: 1, radius: 6 },
          },
        };
      });
      const memorialGeojson = { type: "FeatureCollection", features };
      const itmGeojson = CoordUtils.transformGeojsonToItm(memorialGeojson);
      const customStyleFunction = (feature) =>
        feature.properties && feature.properties._curatedStyle
          ? feature.properties._curatedStyle
          : { fillColor: "#e76f51", color: "#fff", weight: 1, fillOpacity: 0.9, opacity: 1, radius: 6 };
      const layerConfig = { style: { type: "simple" } };
      await renderLayerFromGeojson(itmGeojson, fullLayerId, layerConfig, "Point", { customStyleFunction });
      return;
    }

    const userPoints = pointFeatures.map((f) => {
      const c = f.geometry.coordinates;
      return [c[1], c[0]];
    });

    let builtGeojson = null;
    if (
      typeof parseDefaultLinePaths === "function" &&
      typeof buildIntegratedRoute === "function" &&
      userPoints.length > 0
    ) {
      let pinkGeojson = null;
      try {
        const pinkRes = await fetch("/api/pink-line/");
        if (pinkRes.ok) pinkGeojson = await pinkRes.json();
      } catch (_) {}
      if (pinkGeojson) {
        await ensureProjectionPinkLineBaseLayer();
        const basePaths = parseDefaultLinePaths(pinkGeojson);
        if (basePaths.length > 0) {
          const { dashed } = buildIntegratedRoute(basePaths, userPoints);
          const layerColor = getCuratedLayerColorForProjection(fullLayerId);
          const features = [];
          dashed.forEach((path) => {
            const coords = path.map(([lat, lng]) => [lng, lat]);
            features.push({
              type: "Feature",
              geometry: { type: "LineString", coordinates: coords },
              properties: { _curatedStyle: { color: layerColor, weight: 5, opacity: 0.9, dashArray: [10, 10] } },
            });
          });
          pointFeatures.forEach((f) => {
            const c = f.geometry.coordinates;
            const ft = f.properties && f.properties.feature_type;
            const memorialIconUrl = ft && MEMORIAL_ICON_URLS[ft];
            const pointStyle = memorialIconUrl
              ? { _iconUrl: memorialIconUrl, _iconSize: 32 }
              : {
                  fillColor: layerColor,
                  color: "#fff",
                  weight: 1,
                  fillOpacity: 0.9,
                  opacity: 1,
                  radius: 6,
                };
            features.push({
              type: "Feature",
              geometry: { type: "Point", coordinates: [c[0], c[1]] },
              properties: { ...f.properties, _curatedStyle: pointStyle },
            });
          });
          builtGeojson = { type: "FeatureCollection", features };
        }
      }
    }

    if (builtGeojson) {
      const itmGeojson = CoordUtils.transformGeojsonToItm(builtGeojson);
      const layerColor = getCuratedLayerColorForProjection(fullLayerId);
      const customStyleFunction = (feature) =>
        feature.properties && feature.properties._curatedStyle
          ? feature.properties._curatedStyle
          : { color: layerColor, weight: 4, opacity: 0.85, fillColor: layerColor, fillOpacity: 0.8, radius: 5 };
      const layerConfig = { style: { type: "simple" } };
      await renderLayerFromGeojson(
        itmGeojson,
        fullLayerId,
        layerConfig,
        "line",
        { customStyleFunction },
      );
      return;
    }

    const itmGeojson = looksLikeWgs84
      ? CoordUtils.transformGeojsonToItm(geojson)
      : geojson;
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
    const geometryType = itmGeojson.features[0]?.geometry?.type || "Polygon";
    await renderLayerFromGeojson(itmGeojson, fullLayerId, layerConfig, geometryType);
  }

  /**
   * Load a single layer from the layer registry for projection display.
   * @param {string} fullLayerId - Full layer ID (e.g., "map_3_future.mimushim")
   */
  async function loadProjectionLayerFromRegistry(fullLayerId) {
    if (loadedLayers[fullLayerId]) {
      return;
    }
    if (inFlightLayerLoads[fullLayerId]) {
      return inFlightLayerLoads[fullLayerId];
    }

    inFlightLayerLoads[fullLayerId] = (async () => {
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
          if (
            maskConfig &&
            typeof layerRegistry.getLayerMaskAssetUrl === "function"
          ) {
            const maskUrl = layerRegistry.getLayerMaskAssetUrl(
              fullLayerId,
              maskConfig,
            );
            if (maskUrl) {
              try {
                const maskRes = await fetch(maskUrl);
                if (maskRes.ok) {
                  let maskGeojson = await maskRes.json();
                  const mcrs = (
                    maskGeojson.crs?.properties?.name || ""
                  ).toUpperCase();
                  const mFirst = getFirstCoordinate(maskGeojson);
                  const maskLooksWgs84 =
                    mFirst &&
                    Math.abs(mFirst[0]) < 1000 &&
                    Math.abs(mFirst[1]) < 1000;
                  if (
                    mcrs.includes("4326") ||
                    mcrs.includes("WGS") ||
                    maskLooksWgs84
                  ) {
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
    })();

    try {
      await inFlightLayerLoads[fullLayerId];
    } finally {
      delete inFlightLayerLoads[fullLayerId];
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

    const registryReady =
      typeof layerRegistry !== "undefined" && layerRegistry._initialized;

    // Process each group - individual layer.enabled is the source of truth for visibility
    for (const group of layerGroups) {
      const isCurated = group.id.startsWith("curated");

      // Registry layers need the registry to be initialized
      if (!isCurated && !registryReady) continue;

      for (const layer of group.layers || []) {
        const fullLayerId = `${group.id}.${layer.id}`;

        // Handle model_base image layer specially
        if (fullLayerId === "projector_base.model_base") {
          updateModelImageVisibility(layer.enabled);
          continue;
        }

        // Handle WMTS layers (any pack)
        const layerConfig = registryReady
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
          updateLayerVisibility(fullLayerId, false);
        }
      }
    }
  }

  /**
   * Helper function to render a layer from GeoJSON using Canvas.
   * @param {Object} [options.customStyleFunction] - Optional; if provided, used instead of StyleApplicator.getCanvasStyle(layerConfig).
   */
  async function renderLayerFromGeojson(
    geojson,
    layerName,
    layerConfig,
    geometryType,
    options,
  ) {
    const displayBounds = getDisplayBoundsSafe();
    const modelBounds = getModelBoundsSafe();
    if (!displayBounds || !modelBounds) {
      throw new Error("Display bounds not available");
    }

    const styleFunction =
      options && typeof options.customStyleFunction === "function"
        ? options.customStyleFunction
        : StyleApplicator.getCanvasStyle(layerConfig);

    loadedLayers[layerName] = {
      originalGeojson: geojson,
      styleFunction,
      styleConfig: layerConfig,
      geometryType: geometryType,
    };

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

  function requestAnimationFrameForAnimations() {
    if (!canvasRenderer) return;
    if (animationLoopHandle) return;

    const projectionAnimCfg =
      typeof MapProjectionConfig !== "undefined" &&
      MapProjectionConfig.PROJECTION_LAYER_ANIMATIONS
        ? MapProjectionConfig.PROJECTION_LAYER_ANIMATIONS
        : null;
    const perfCfg =
      typeof MapProjectionConfig !== "undefined" && MapProjectionConfig.GIS_PERF
        ? MapProjectionConfig.GIS_PERF
        : {};
    const maxFps = Math.max(
      1,
      Number(
        (projectionAnimCfg && projectionAnimCfg.MAX_FPS) ||
          perfCfg.ANIMATION_MAX_FPS,
      ) || 30,
    );
    const minFrameMs = 1000 / maxFps;

    const hasEnabledAnimations = () => {
      if (
        typeof OTEFDataContext === "undefined" ||
        !OTEFDataContext ||
        typeof OTEFDataContext.getAnimations !== "function"
      ) {
        return false;
      }
      const animations = OTEFDataContext.getAnimations() || {};
      return Object.values(animations).some((v) => !!v);
    };

    const tick = (nowMs) => {
      if (!hasEnabledAnimations()) {
        animationLoopHandle = null;
        return;
      }
      if (nowMs - animationLastFrameMs >= minFrameMs) {
        animationLastFrameMs = nowMs;
        if (typeof canvasRenderer._scheduleRender === "function") {
          canvasRenderer._scheduleRender();
        } else if (typeof canvasRenderer.render === "function") {
          canvasRenderer.render();
        }
      }
      animationLoopHandle = requestAnimationFrame(tick);
    };

    animationLoopHandle = requestAnimationFrame(tick);
  }

  function stopAnimationLoop() {
    if (!animationLoopHandle) return;
    cancelAnimationFrame(animationLoopHandle);
    animationLoopHandle = null;
  }

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", stopAnimationLoop);
  }

  window.ProjectionLayerManager = {
    configure,
    initializeLayers,
    syncLayerGroupsFromState,
    handleResize,
    requestAnimationFrameForAnimations,
    stopAnimationLoop,
  };
})();
