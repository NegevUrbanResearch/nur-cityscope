// ABOUTME: Canvas-based layer renderer for projector - renders layers as image for performance
// Replaces SVG rendering with Canvas for much faster display and updates

import AdvancedStyleEngine from "../map-utils/advanced-style-engine.js";
import AdvancedStyleDrawing from "../map-utils/advanced-style-drawing.js";

/**
 * CanvasLayerRenderer - Renders GeoJSON layers to Canvas for fast display
 * Always uses the AdvancedStyleEngine pipeline (ESM guarantees availability).
 */
class CanvasLayerRenderer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Container ${containerId} not found`);
    }

    this.canvas = null;
    this.ctx = null;
    this.canvasBottom = null;
    this.ctxBottom = null;
    this.labelsCanvas = null;
    this.ctxLabels = null;
    this.layers = {}; // { layerId: { geojson, styleFunction, visible, geometryType, belowWmts, isLabelLayer } }
    this.modelBounds = null;
    this.displayBounds = null;
    this.dpr = 1;  // Device pixel ratio for high-DPI rendering
    this._patterns = {}; // Cache for hatch patterns
    this._advancedDrawer = null; // Shared AdvancedStyleDrawing instance
    this._iconCache = {}; // iconUrl -> { img, loaded, failed }

    this._createCanvas();
  }

  _createCanvas() {
    const highlightOverlay = this.container.querySelector("#highlightOverlay");
    ["#labelsCanvas", "#layersCanvas", "#layersCanvasBottom"].forEach((sel) => {
      const existing = this.container.querySelector(sel);
      if (existing) existing.remove();
    });

    const style =
      "position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; image-rendering: crisp-edges; image-rendering: -webkit-optimize-contrast;";

    this.canvasBottom = document.createElement("canvas");
    this.canvasBottom.id = "layersCanvasBottom";
    this.canvasBottom.style.cssText = style + " z-index: 5;";
    this.ctxBottom = this.canvasBottom.getContext("2d");

    this.canvas = document.createElement("canvas");
    this.canvas.id = "layersCanvas";
    this.canvas.style.cssText = style + " z-index: 7;";
    this.ctx = this.canvas.getContext("2d");

    this.labelsCanvas = document.createElement("canvas");
    this.labelsCanvas.id = "labelsCanvas";
    this.labelsCanvas.style.cssText = style + " z-index: 8;";
    this.ctxLabels = this.labelsCanvas.getContext("2d");

    if (highlightOverlay) {
      this.container.insertBefore(this.canvasBottom, highlightOverlay);
      this.container.insertBefore(this.canvas, highlightOverlay);
      this.container.insertBefore(this.labelsCanvas, highlightOverlay);
    } else {
      this.container.appendChild(this.canvasBottom);
      this.container.appendChild(this.canvas);
      this.container.appendChild(this.labelsCanvas);
    }
  }

  /**
   * Update canvas position and size to match displayed image
   * Uses devicePixelRatio for high-DPI rendering
   * Resolution is driven by Web Render TOP size (TouchDesigner), not URL parameters
   */
  updatePosition(displayBounds, modelBounds) {
    if (!displayBounds || !modelBounds) return;

    this.displayBounds = displayBounds;
    this.modelBounds = modelBounds;

    this.dpr = window.devicePixelRatio || 1;
    const canvasWidth = Math.round(displayBounds.width * this.dpr);
    const canvasHeight = Math.round(displayBounds.height * this.dpr);

    const posStyle = `left: ${displayBounds.offsetX}px; top: ${displayBounds.offsetY}px; width: ${displayBounds.width}px; height: ${displayBounds.height}px;`;
    [this.canvasBottom, this.canvas, this.labelsCanvas].forEach((el) => {
      el.style.left = displayBounds.offsetX + "px";
      el.style.top = displayBounds.offsetY + "px";
      el.style.width = displayBounds.width + "px";
      el.style.height = displayBounds.height + "px";
      el.width = canvasWidth;
      el.height = canvasHeight;
    });

    this.ctxBottom.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctxLabels.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this._scheduleRender();
  }

  /**
   * Add/update a layer
   */
  setLayer(layerId, geojson, styleFunction, geometryType, styleConfig) {
    const belowWmts = layerId.includes("רקע_שחור");
    const style = styleConfig && styleConfig.style;
    const hasLabels = style && style.labels;
    // Label-only layers: names, שמות_יישובים, or any layer ending in .names
    const isLabelLayer =
      (geometryType === "point" || geometryType === "Point") &&
      (layerId.endsWith(".names") ||
        layerId === "names" ||
        layerId.endsWith(".שמות_יישובים") ||
        layerId === "שמות_יישובים") &&
      !!hasLabels;
    this.layers[layerId] = {
      geojson: geojson,
      styleFunction: styleFunction,
      styleConfig: styleConfig || null,
      visible: false,
      geometryType: geometryType || "polygon",
      belowWmts: belowWmts,
      isLabelLayer: !!isLabelLayer,
    };
  }

  /**
   * Set layer visibility
   */
  setLayerVisibility(layerId, visible) {
    if (this.layers[layerId]) {
      this.layers[layerId].visible = visible;
      this._scheduleRender();
    }
  }

  /**
   * Debounced render to prevent excessive re-renders
   */
  _renderScheduled = false;
  _scheduleRender() {
    if (this._renderScheduled) return;
    this._renderScheduled = true;
    requestAnimationFrame(() => {
      this._renderScheduled = false;
      this.render();
    });
  }

  /**
   * Render all visible layers to canvas
   */
  _layerSortKey([id, layer]) {
    const isBlackBg = id.includes("רקע_שחור");
    const isSea = id.includes("sea");
    const isBase = id.startsWith("projector_base.");
    const typeRank = { polygon: 0, line: 1, point: 2 };
    const geomRank = typeRank[layer.geometryType] ?? 0;
    return [isBlackBg ? 0 : 1, isSea ? 0 : 1, isBase ? 0 : 1, geomRank, id];
  }

  render() {
    if (
      !this.ctx ||
      !this.ctxBottom ||
      !this.displayBounds ||
      !this.modelBounds
    )
      return;

    const startTime = performance.now();

    const layerEntries = Object.entries(this.layers);
    const below = layerEntries.filter(
      ([, l]) => l.belowWmts && l.visible && l.geojson?.features
    );
    const above = layerEntries.filter(
      ([, l]) => !l.belowWmts && l.visible && l.geojson?.features
    );
    const labelLayers = above.filter(([, l]) => l.isLabelLayer && l.geojson?.features);
    const aboveNonLabel = above.filter(([, l]) => !l.isLabelLayer);

    this.ctxBottom.clearRect(
      0,
      0,
      this.canvasBottom.width,
      this.canvasBottom.height
    );
    // When black-background layer is visible, fill bottom canvas with black first
    // so it shows even if the polygon extent doesn't match the viewport
    const hasBlackBg = below.some(([id]) => id.includes("רקע_שחור"));
    if (hasBlackBg) {
      this.ctxBottom.fillStyle = "#000000";
      this.ctxBottom.fillRect(
        0,
        0,
        this.canvasBottom.width,
        this.canvasBottom.height
      );
    }
    below.sort((a, b) => {
      const ka = this._layerSortKey(a);
      const kb = this._layerSortKey(b);
      for (let i = 0; i < ka.length; i++) {
        if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
      }
      return 0;
    });
    for (const [layerId, layer] of below) {
      this._renderLayer(layerId, layer.geojson, layer.styleFunction, this.ctxBottom, layer.styleConfig);
    }

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    aboveNonLabel.sort((a, b) => {
      const ka = this._layerSortKey(a);
      const kb = this._layerSortKey(b);
      for (let i = 0; i < ka.length; i++) {
        if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
      }
      return 0;
    });
    for (const [layerId, layer] of aboveNonLabel) {
      this._renderLayer(layerId, layer.geojson, layer.styleFunction, this.ctx, layer.styleConfig);
    }

    this.ctxLabels.clearRect(
      0,
      0,
      this.labelsCanvas.width,
      this.labelsCanvas.height
    );
    for (const [, layer] of labelLayers) {
      this._renderLabelLayer(layer.geojson, layer.styleConfig, this.ctxLabels);
    }

    const elapsed = performance.now() - startTime;
    if (elapsed > 2000) {
      console.warn(`[CanvasRenderer] Slow render: ${elapsed.toFixed(0)}ms`);
    }
  }

  /**
   * Render a single layer
   * Optimized to reduce canvas operations for large feature sets
   */
  _resolveProjectionFlowConfig(layerId, styleAnimation) {
    const projectionCfg =
      typeof MapProjectionConfig !== "undefined" &&
      MapProjectionConfig &&
      MapProjectionConfig.PROJECTION_LAYER_ANIMATIONS
        ? MapProjectionConfig.PROJECTION_LAYER_ANIMATIONS
        : {};

    const overrides =
      projectionCfg.LAYER_OVERRIDES && typeof projectionCfg.LAYER_OVERRIDES === "object"
        ? projectionCfg.LAYER_OVERRIDES
        : {};
    const layerOverride =
      overrides && Object.prototype.hasOwnProperty.call(overrides, layerId)
        ? overrides[layerId]
        : null;

    const hasStyleFlow = styleAnimation && styleAnimation.type === "flow";
    const enableFlowViaOverride = !!(
      layerOverride &&
      typeof layerOverride === "object" &&
      layerOverride.ENABLE_FLOW
    );

    if (!hasStyleFlow && !enableFlowViaOverride) {
      return null;
    }

    const enabledByDefault =
      layerOverride && typeof layerOverride.ENABLED_BY_DEFAULT === "boolean"
        ? layerOverride.ENABLED_BY_DEFAULT
        : typeof styleAnimation?.enabledByDefault === "boolean"
          ? styleAnimation.enabledByDefault
          : !!projectionCfg.ENABLED_BY_DEFAULT;

    let speed =
      layerOverride && typeof layerOverride.SPEED === "number"
        ? layerOverride.SPEED
        : typeof styleAnimation?.speed === "number"
          ? styleAnimation.speed
          : typeof projectionCfg.DEFAULT_SPEED === "number"
            ? projectionCfg.DEFAULT_SPEED
            : 0;

    let dashArray = Array.isArray(layerOverride?.DASH_ARRAY)
      ? layerOverride.DASH_ARRAY
      : Array.isArray(styleAnimation?.dashArray)
        ? styleAnimation.dashArray
        : Array.isArray(projectionCfg.DEFAULT_DASH_ARRAY)
          ? projectionCfg.DEFAULT_DASH_ARRAY
          : null;

    const mode =
      typeof layerOverride?.MODE === "string"
        ? layerOverride.MODE
        : typeof styleAnimation?.mode === "string"
          ? styleAnimation.mode
          : undefined;
    const headRadius =
      typeof layerOverride?.HEAD_RADIUS === "number"
        ? layerOverride.HEAD_RADIUS
        : typeof styleAnimation?.headRadius === "number"
          ? styleAnimation.headRadius
          : undefined;
    const hideHeadAtEnd =
      typeof layerOverride?.HIDE_HEAD_AT_END === "boolean"
        ? layerOverride.HIDE_HEAD_AT_END
        : typeof styleAnimation?.hideHeadAtEnd === "boolean"
          ? styleAnimation.hideHeadAtEnd
          : undefined;

    return {
      enabledByDefault,
      speed,
      dashArray,
      ...(typeof mode === "string" ? { mode } : {}),
      ...(typeof headRadius === "number" ? { headRadius } : {}),
      ...(typeof hideHeadAtEnd === "boolean" ? { hideHeadAtEnd } : {}),
    };
  }

  /**
   * Convert ITM coordinates to canvas pixel coordinates within the current
   * display bounds. Mirrors the logic used by the WMTS renderer so both
   * pipelines stay in sync.
   *
   * @param {number[]|{x:number,y:number}} coord
   * @returns {{x:number,y:number}}
   */
  _coordToPixel(coord) {
    if (!coord || !this.modelBounds || !this.displayBounds) {
      return { x: 0, y: 0 };
    }

    const rawX = Array.isArray(coord) ? coord[0] : coord.x;
    const rawY = Array.isArray(coord) ? coord[1] : coord.y;
    const x = Number(rawX ?? 0);
    const y = Number(rawY ?? 0);

    const mb = this.modelBounds;
    const db = this.displayBounds;

    const spanX = mb.east - mb.west || 1;
    const spanY = mb.north - mb.south || 1;

    const pctX = (x - mb.west) / spanX;
    const pctY = (mb.north - y) / spanY;

    return {
      x: pctX * db.width,
      y: pctY * db.height,
    };
  }

  /**
   * Load and cache an icon image. Returns a cache entry
   * { img, loaded, failed } and schedules a re-render when the
   * image finishes loading.
   */
  _getIconEntry(url) {
    if (!url) return null;
    if (this._iconCache[url]) {
      return this._iconCache[url];
    }

    const img = new Image();
    const entry = { img, loaded: false, failed: false };
    img.onload = () => {
      entry.loaded = true;
      this._scheduleRender();
    };
    img.onerror = () => {
      entry.failed = true;
    };
    img.src = url;
    this._iconCache[url] = entry;
    return entry;
  }

  _renderLayer(layerId, geojson, styleFunction, ctx, styleConfig) {
    const targetCtx = ctx || this.ctx;
    const prevCtx = this.ctx;
    this.ctx = targetCtx;

    const features = geojson.features || [];

    if (features.length === 0) {
      this.ctx = prevCtx;
      return;
    }

    const style = styleConfig && styleConfig.style;

    // Prefer style-config-based resolution (symbol IR from styles.json) so that
    // per-symbol opacity (e.g. uniqueValue fill opacity) is preserved. Using
    // styleFunction would convert symbol → bag → _symbolFromSimpleStyle → symbol
    // and can lose or alter opacity. When style has defaultSymbol or uniqueValues,
    // resolve from config to match GIS behavior and correct projection opacity.
    const useConfigResolution =
      style &&
      (style.defaultSymbol || (style.uniqueValues && style.uniqueValues.classes?.length));
    const commands = AdvancedStyleEngine.computeCommands(
      features,
      style,
      {},
      useConfigResolution ? null : styleFunction,
    );
    const flowCfg = this._resolveProjectionFlowConfig(
      layerId,
      style && style.animation,
    );
    if (flowCfg) {
      let enabled = !!flowCfg.enabledByDefault;
      if (
        typeof OTEFDataContext !== "undefined" &&
        OTEFDataContext &&
        typeof OTEFDataContext.getAnimations === "function"
      ) {
        const animations = OTEFDataContext.getAnimations() || {};
        if (Object.prototype.hasOwnProperty.call(animations, layerId)) {
          enabled = !!animations[layerId];
        }
      }
      let phasePx = 0;
      if (enabled) {
        if (
          typeof AnimationRuntime !== "undefined" &&
          AnimationRuntime &&
          typeof AnimationRuntime.setSpeed === "function"
        ) {
          AnimationRuntime.setSpeed(layerId, flowCfg.speed || 0);
        }
        if (
          typeof AnimationRuntime !== "undefined" &&
          AnimationRuntime &&
          typeof AnimationRuntime.getPhasePx === "function"
        ) {
          phasePx = AnimationRuntime.getPhasePx(layerId);
        }
      }

      for (const command of commands) {
        if (command && command.type === "drawLine") {
          command.animation = {
            flow: {
              enabled,
              phasePx,
              speed: flowCfg.speed,
              dashArray: Array.isArray(flowCfg.dashArray)
                ? flowCfg.dashArray
                : null,
              ...(typeof flowCfg.mode === "string" ? { mode: flowCfg.mode } : {}),
              ...(typeof flowCfg.headRadius === "number"
                ? { headRadius: flowCfg.headRadius }
                : {}),
              ...(typeof flowCfg.hideHeadAtEnd === "boolean"
                ? { hideHeadAtEnd: flowCfg.hideHeadAtEnd }
                : {}),
            },
          };
        }
      }
    }

    // When a layer is logically a "line" but its actual geometry is Polygon
    // (e.g. damaged open space boundaries), mirror the GIS behavior by
    // dropping polygon fill for projection so only the outline is drawn.
    const layerMeta = this.layers[layerId];
    const geometryType = layerMeta && layerMeta.geometryType;
    if (geometryType === "line" && Array.isArray(commands)) {
      for (const cmd of commands) {
        if (!cmd || cmd.type !== "drawPolygon" || !cmd.symbol) continue;
        const symLayers = cmd.symbol.symbolLayers;
        if (!Array.isArray(symLayers)) continue;
        for (const l of symLayers) {
          if (l && l.type === "fill") {
            l.opacity = 0;
          }
        }
      }
    }

    if (!this._advancedDrawer) {
      this._advancedDrawer = new AdvancedStyleDrawing();
    }

    const viewContext = {
      coordToPixel: (coord) => this._coordToPixel(coord),
      pixelRatio: this.dpr || window.devicePixelRatio || 1,
      viewportWidth: this.displayBounds ? this.displayBounds.width : this.canvas.width,
      viewportHeight: this.displayBounds ? this.displayBounds.height : this.canvas.height,
    };

    this._advancedDrawer.drawCommands(targetCtx, commands, viewContext, {
      getIcon: (url) => this._getIconEntry(url),
    });

    this.ctx = prevCtx;
  }

  /**
   * Render a label-only layer (point features with style.labels).
   * Draws text at each point; always on top (labels canvas).
   */
  _renderLabelLayer(geojson, styleConfig, ctx) {
    const labels = styleConfig?.style?.labels;
    if (!labels || !ctx || !this.displayBounds || !this.modelBounds) return;

    const features = geojson.features || [];
    const field = labels.field || "name";
    const fontFamily = labels.font || "Arial, sans-serif";
    const sizePt = typeof labels.size === "number" ? labels.size : 10;
    // Convert ArcGIS point size to CSS pixels, then apply optional projector-wide scale factor.
    let sizePx = (sizePt * 96) / 72;
    let labelScale = 1;
    if (
      typeof MapProjectionConfig !== "undefined" &&
      MapProjectionConfig &&
      typeof MapProjectionConfig.LABEL_SIZE_SCALE === "number"
    ) {
      labelScale = MapProjectionConfig.LABEL_SIZE_SCALE;
    }
    sizePx = Math.max(8, sizePx * labelScale);
    const color = labels.color || "#000000";
    const opacity = labels.colorOpacity != null ? labels.colorOpacity : 1;
    const haloSize = typeof labels.haloSize === "number" ? labels.haloSize : 0;
    const haloColor = labels.haloColor || "#ffffff";
    const dir = labels.textDirection === "RTL" ? "rtl" : "ltr";
    const fontWeight = labels.fontWeight || "normal";
    const fontStyle = labels.fontStyle || "normal";

    const alignMap = {
      Left: "left",
      Center: "center",
      Right: "right",
    };
    const baselineMap = {
      Top: "top",
      Middle: "middle",
      Center: "middle",
      Baseline: "alphabetic",
      Bottom: "bottom",
    };
    const textAlign = alignMap[labels.horizontalAlignment] || "center";
    const textBaseline = baselineMap[labels.verticalAlignment] || "middle";

    ctx.font = `${fontStyle} ${fontWeight} ${sizePx}px ${fontFamily}`;
    ctx.textAlign = textAlign;
    ctx.textBaseline = textBaseline;
    ctx.direction = dir;

    for (const feature of features) {
      const geom = feature.geometry;
      if (!geom || !geom.coordinates) continue;

      const props = feature.properties || feature.props || {};
      let text = props[field];
      if (text == null) text = "";
      text = String(text).trim();
      if (!text) continue;

      let x, y;
      if (geom.type === "Point") {
        const p = this._coordToPixel(geom.coordinates);
        x = p.x;
        y = p.y;
      } else if (geom.type === "MultiPoint" && geom.coordinates.length > 0) {
        const first = this._coordToPixel(geom.coordinates[0]);
        x = first.x;
        y = first.y;
      } else {
        continue;
      }

      if (haloSize > 0) {
        ctx.strokeStyle = haloColor;
        ctx.lineWidth = haloSize * 2;
        ctx.strokeText(text, x, y);
      }
      ctx.globalAlpha = opacity;
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      ctx.globalAlpha = 1;
    }
  }
}

export { CanvasLayerRenderer };
