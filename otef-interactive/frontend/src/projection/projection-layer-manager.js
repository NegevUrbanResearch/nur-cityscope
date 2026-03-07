// Projection layer manager
// Handles layer loading and registry integration only (legacy road layers removed)

import { UI_CONFIG } from "../config/ui-config.js";
import { CanvasLayerRenderer } from "./layer-renderer-canvas.js";
import {
  fetchCuratedLayerData,
  extractPointFeatures,
  fetchPinkLinePaths,
  buildCuratedRouteGeoJSON,
  getMemorialIconForFeature,
} from "../shared/curated-layer-service.js";
import {
  configureAnimationRenderer,
  startAnimationLoop,
  stopAnimationLoop,
} from "./projection-animation-loop.js";

let getModelBounds = null;
let getDisplayedImageBounds = null;
let canvasRenderer = null;
let wmtsRenderer = null;

const loadedLayers = {};
const inFlightLayerLoads = {};

function isProjectionDebugEnabled() {
  return (
    typeof MapProjectionConfig !== "undefined" &&
    MapProjectionConfig &&
    MapProjectionConfig.ENABLE_PROJECTION_DEBUG
  );
}

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
      configureAnimationRenderer(canvasRenderer);

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
  const getCuratedLayerColorForProjection = UI_CONFIG.getCuratedColor;

  async function ensureProjectionPinkLineBaseLayer() {
    if (loadedLayers[PINK_LINE_BASE_LAYER_ID]) return;
    try {
      const { basePaths } = await fetchPinkLinePaths();
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
   * Toggle visibility of the shared pink-line base layer in the projection.
   * This allows the base line to disappear when all curated layers are disabled.
   */
  function setProjectionPinkLineBaseVisibility(visible) {
    if (!canvasRenderer || !loadedLayers[PINK_LINE_BASE_LAYER_ID]) return;
    canvasRenderer.setLayerVisibility(PINK_LINE_BASE_LAYER_ID, visible);
  }

  /**
   * Load a curated layer for Canvas projection display.
   * Data fetching / route building is delegated to the shared CuratedLayerService;
   * this function handles only the Canvas-specific rendering.
   */
  async function loadProjectionCuratedLayerFromAPI(fullLayerId) {
    if (loadedLayers[fullLayerId]) return;

    // --- Shared data fetch ---
    const result = await fetchCuratedLayerData(fullLayerId);
    if (!result) return;
    let { geojson } = result;

    // CRS normalisation (projection needs ITM, so first get to WGS-84 if needed)
    let wgs84Geojson = geojson;
    const firstCoord = CoordUtils.getFirstCoordinate(geojson);
    const looksLikeWgs84 =
      firstCoord &&
      Math.abs(firstCoord[0]) < 1000 &&
      Math.abs(firstCoord[1]) < 1000;
    if (!looksLikeWgs84 && firstCoord && Math.abs(firstCoord[0]) >= 1000) {
      wgs84Geojson = CoordUtils.transformGeojsonToWgs84(geojson);
    }

    // --- Shared point extraction ---
    const pointFeatures = (wgs84Geojson.features || []).filter(
      (f) => f.geometry && f.geometry.type === "Point" && f.geometry.coordinates,
    );

    // Memorial sites: render as icon markers, skip pink line route integration
    const hasMemorialFeatures = pointFeatures.some(
      (f) => f.properties && getMemorialIconForFeature(f.properties),
    );
    if (hasMemorialFeatures) {
      const features = pointFeatures.map((f) => {
        const c = f.geometry.coordinates;
        const iconUrl = getMemorialIconForFeature(f.properties || {});
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

    // --- Shared route building ---
    let builtGeojson = null;
    if (userPoints.length > 0) {
      const { basePaths } = await fetchPinkLinePaths();
      if (basePaths.length > 0) {
        await ensureProjectionPinkLineBaseLayer();
        const layerColor = getCuratedLayerColorForProjection(fullLayerId);
        builtGeojson = buildCuratedRouteGeoJSON(
          basePaths,
          userPoints,
          layerColor,
          pointFeatures,
        );
      }
    }

    // --- Canvas-specific rendering ---
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

    // Fallback: plain GeoJSON rendering
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
        if (fullLayerId.startsWith("curated")) {
          await loadProjectionCuratedLayerFromAPI(fullLayerId);
          return;
        }
        console.warn(`[Projection] Layer config not found: ${fullLayerId}`);
        return;
      }

      // Handle image layers differently (they don't have GeoJSON data)
      if (layerConfig.format === "image") {
        if (isProjectionDebugEnabled()) {
          console.log(
            `[Projection] Skipping image layer ${fullLayerId} (rendered via <img> element)`,
          );
        }
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
                  const mFirst = CoordUtils.getFirstCoordinate(maskGeojson);
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
          if (isProjectionDebugEnabled()) {
            console.log(`[Projection] WMTS layer loaded: ${fullLayerId}`);
          }
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

      if (isProjectionDebugEnabled()) {
        console.log(
          `[Projection] Fetching layer data: ${fullLayerId} from ${dataUrl}`,
        );
      }
      const response = await fetch(dataUrl);
      if (!response.ok) {
        throw new Error(`Failed to load layer data: ${response.status}`);
      }

      let geojson = await response.json();
      if (isProjectionDebugEnabled()) {
        console.log(
          `[Projection] Loaded layer ${fullLayerId}, features: ${
            geojson.features?.length || 0
          }`,
        );
      }

      // Normalize to ITM for projection: canvas expects ITM to match model bounds.
      // GeoJSON from processed layers is WGS84 [lon, lat]; from API/source may be ITM or WGS84.
      const crs = (geojson.crs?.properties?.name || "").toUpperCase();
      const firstCoord = CoordUtils.getFirstCoordinate(geojson);
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

    const hasRegistry =
      typeof layerRegistry !== "undefined" && !!layerRegistry;
    const registryReady = hasRegistry && !!layerRegistry._initialized;

    // Process each group - individual layer.enabled is the source of truth for visibility.
    // Curated groups are allowed even when the registry is not yet initialized;
    // non-curated (registry-backed) groups are deferred until registryReady.
    let hasEnabledCuratedLayer = false;

    for (const group of layerGroups) {
      const isCurated = group.id.startsWith("curated");

      // Registry layers need the registry to be initialized
      if (!isCurated && !registryReady) continue;

      for (const layer of group.layers || []) {
        const fullLayerId = `${group.id}.${layer.id}`;

        const isCuratedGroup =
          typeof group.id === "string" && group.id.startsWith("curated");
        const isCuratedLayer =
          typeof fullLayerId === "string" &&
          fullLayerId.startsWith("curated");
        const isCurated = isCuratedGroup || isCuratedLayer;

        // Handle model_base image layer specially
        if (fullLayerId === "projector_base.model_base") {
          updateModelImageVisibility(layer.enabled);
          continue;
        }

        // When registry is not ready, skip non-curated registry-backed layers.
        if (!isCurated && !registryReady) {
          continue;
        }

        // Handle WMTS layers (any pack)
        let layerConfig = null;
        if (registryReady) {
          layerConfig = layerRegistry.getLayerConfig(fullLayerId);
        }
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
          if (isCurated) {
            hasEnabledCuratedLayer = true;
          }
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

    // When no curated layers are enabled, hide the shared pink-line base layer.
    // When at least one curated layer is enabled, ensure it is visible.
    try {
      setProjectionPinkLineBaseVisibility(hasEnabledCuratedLayer);
    } catch (_) {
      // Non-fatal; base pink-line visibility is a visual enhancement.
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
    startAnimationLoop();
  }

  export {
    configure,
    initializeLayers,
    syncLayerGroupsFromState,
    handleResize,
    requestAnimationFrameForAnimations,
    stopAnimationLoop,
  };
