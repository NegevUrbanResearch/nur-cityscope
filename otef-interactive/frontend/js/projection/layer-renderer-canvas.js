// ABOUTME: Canvas-based layer renderer for projector - renders layers as image for performance
// Replaces SVG rendering with Canvas for much faster display and updates

/**
 * CanvasLayerRenderer - Renders GeoJSON layers to Canvas for fast display
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
    this.layers = {}; // { layerId: { geojson, styleFunction, visible, geometryType, belowWmts } }
    this.modelBounds = null;
    this.displayBounds = null;
    this.dpr = 1;  // Device pixel ratio for high-DPI rendering
    this._patterns = {}; // Cache for hatch patterns

    this._createCanvas();
  }

  _createCanvas() {
    const highlightOverlay = this.container.querySelector("#highlightOverlay");
    ["#layersCanvas", "#layersCanvasBottom"].forEach((sel) => {
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

    if (highlightOverlay) {
      this.container.insertBefore(this.canvasBottom, highlightOverlay);
      this.container.insertBefore(this.canvas, highlightOverlay);
    } else {
      this.container.appendChild(this.canvasBottom);
      this.container.appendChild(this.canvas);
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
    [this.canvasBottom, this.canvas].forEach((el) => {
      el.style.left = displayBounds.offsetX + "px";
      el.style.top = displayBounds.offsetY + "px";
      el.style.width = displayBounds.width + "px";
      el.style.height = displayBounds.height + "px";
      el.width = canvasWidth;
      el.height = canvasHeight;
    });

    this.ctxBottom.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this._scheduleRender();
  }

  /**
   * Add/update a layer
   */
  setLayer(layerId, geojson, styleFunction, geometryType) {
    const belowWmts = layerId.includes("רקע_שחור");
    this.layers[layerId] = {
      geojson: geojson,
      styleFunction: styleFunction,
      visible: false,
      geometryType: geometryType || "polygon",
      belowWmts: belowWmts,
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

    this.ctxBottom.clearRect(
      0,
      0,
      this.canvasBottom.width,
      this.canvasBottom.height
    );
    below.sort((a, b) => {
      const ka = this._layerSortKey(a);
      const kb = this._layerSortKey(b);
      for (let i = 0; i < ka.length; i++) {
        if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
      }
      return 0;
    });
    for (const [, layer] of below) {
      this._renderLayer(layer.geojson, layer.styleFunction, this.ctxBottom);
    }

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    above.sort((a, b) => {
      const ka = this._layerSortKey(a);
      const kb = this._layerSortKey(b);
      for (let i = 0; i < ka.length; i++) {
        if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
      }
      return 0;
    });
    for (const [, layer] of above) {
      this._renderLayer(layer.geojson, layer.styleFunction, this.ctx);
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
  _renderLayer(geojson, styleFunction, ctx) {
    const targetCtx = ctx || this.ctx;
    const prevCtx = this.ctx;
    this.ctx = targetCtx;

    const features = geojson.features || [];

    if (features.length === 0) {
      this.ctx = prevCtx;
      return;
    }

    for (const feature of features) {
      if (!feature.geometry) continue;

      const style = styleFunction ? styleFunction(feature) : {};
      const fillColor = style.fillColor || style.fill || '#888888';
      const strokeColor = style.color || style.stroke || '#333333';
      const fillOpacity = style.fillOpacity ?? 1.0;  // Full opacity for projector
      const strokeOpacity = style.opacity ?? 1.0;
      const lineWidth = style.weight ?? 1;
      const radius = style.radius ?? 5;  // Default radius for points

      // Draw the geometry
      this._drawGeometry(ctx, feature.geometry, fillColor, strokeColor, fillOpacity, strokeOpacity, lineWidth, radius, style);
    }

    this.ctx = prevCtx;
  }

  /**
   * Draw a geometry to canvas
   */
  _drawGeometry(ctx, geometry, fillColor, strokeColor, fillOpacity, strokeOpacity, lineWidth, radius, style) {
    const type = geometry.type;
    const coords = geometry.coordinates;

    if (type === 'Polygon') {
      this._drawPolygon(ctx, coords, fillColor, strokeColor, fillOpacity, strokeOpacity, lineWidth, style);
    } else if (type === 'MultiPolygon') {
      for (const polygon of coords) {
        this._drawPolygon(ctx, polygon, fillColor, strokeColor, fillOpacity, strokeOpacity, lineWidth, style);
      }
    } else if (type === 'LineString') {
      this._drawLineString(ctx, coords, strokeColor, strokeOpacity, lineWidth, style);
    } else if (type === 'MultiLineString') {
      for (const line of coords) {
        this._drawLineString(ctx, line, strokeColor, strokeOpacity, lineWidth, style);
      }
    } else if (type === 'Point') {
      this._drawPoint(ctx, coords, fillColor, strokeColor, fillOpacity, strokeOpacity, lineWidth, radius, style);
    } else if (type === 'MultiPoint') {
      for (const point of coords) {
        this._drawPoint(ctx, point, fillColor, strokeColor, fillOpacity, strokeOpacity, lineWidth, radius, style);
      }
    }
  }

  /**
   * Draw a polygon (with holes support)
   */
  _drawPolygon(ctx, rings, fillColor, strokeColor, fillOpacity, strokeOpacity, lineWidth, style) {
    if (!rings || rings.length === 0) return;

    ctx.beginPath();

    for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
      const ring = rings[ringIndex];
      if (!ring || ring.length < 3) continue;

      // Transform first point
      const first = this._coordToPixel(ring[0]);
      ctx.moveTo(first.x, first.y);

      // Draw remaining points
      for (let i = 1; i < ring.length; i++) {
        const pt = this._coordToPixel(ring[i]);
        ctx.lineTo(pt.x, pt.y);
      }

      ctx.closePath();
    }

    // Fill
    if (fillOpacity > 0) {
      ctx.globalAlpha = fillOpacity;

      // Draw solid background first
      ctx.fillStyle = fillColor;
      ctx.fill('evenodd');

      // Draw hatch on top if defined
      if (style && style.hatch) {
        const hKey = `${style.hatch.color}_${style.hatch.rotation}_${style.hatch.separation}_${style.hatch.width || 1}`;
        if (!this._patterns[hKey]) {
          this._patterns[hKey] = this._createHatchPattern(style.hatch);
        }
        if (this._patterns[hKey]) {
          ctx.fillStyle = this._patterns[hKey];
          ctx.fill('evenodd');
        }
      }
    }

    // Stroke
    if (strokeOpacity > 0 && lineWidth > 0) {
      ctx.globalAlpha = strokeOpacity;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth;

      if (style.dashArray && Array.isArray(style.dashArray)) {
        ctx.setLineDash(style.dashArray);
      } else {
        ctx.setLineDash([]);
      }

      ctx.stroke();
      ctx.setLineDash([]); // Reset
    }

    ctx.globalAlpha = 1;
  }

  /**
   * Draw a line string
   */
  _drawLineString(ctx, coords, strokeColor, strokeOpacity, lineWidth, style) {
    if (!coords || coords.length < 2) return;

    ctx.beginPath();

    const pt = this._coordToPixel(coords[0]);
    ctx.moveTo(pt.x, pt.y);

    for (let i = 1; i < coords.length; i++) {
      const pt = this._coordToPixel(coords[i]);
      ctx.lineTo(pt.x, pt.y);
    }

    ctx.globalAlpha = strokeOpacity;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;

    if (style.dashArray && Array.isArray(style.dashArray)) {
      ctx.setLineDash(style.dashArray);
    } else {
      ctx.setLineDash([]);
    }

    ctx.stroke();
    ctx.setLineDash([]); // Reset
    ctx.globalAlpha = 1;
  }

  /**
   * Draw a point (circle marker)
   */
  _drawPoint(ctx, coords, fillColor, strokeColor, fillOpacity, strokeOpacity, lineWidth, radius) {
    if (!coords || coords.length < 2) return;

    const pt = this._coordToPixel(coords);

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);

    // Fill
    if (fillOpacity > 0) {
      ctx.globalAlpha = fillOpacity;
      ctx.fillStyle = fillColor;
      ctx.fill();
    }

    // Stroke
    if (strokeOpacity > 0 && lineWidth > 0) {
      ctx.globalAlpha = strokeOpacity;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  /**
   * Convert ITM coordinate to canvas pixel
   * Standard geographic orientation: west on left, east on right
   */
  _coordToPixel(coord) {
    const [x, y] = coord;
    const bounds = this.modelBounds;
    const display = this.displayBounds;

    // Standard orientation: west on left (pctX=0), east on right (pctX=1)
    const pctX = (x - bounds.west) / (bounds.east - bounds.west);
    const pctY = (bounds.north - y) / (bounds.north - bounds.south);

    return {
      x: pctX * display.width,
      y: pctY * display.height
    };
  }

  /**
   * Create a hatch pattern for fills
   */
  _createHatchPattern(hatch) {
    try {
      const rotation = hatch.rotation || 0;
      const separation = hatch.separation || 10;
      const lineWidth = hatch.width || 1;
      const color = hatch.color || '#000000';

      // ArcGIS rotation is often arithmetic (CCW from East) but sometimes geographic (CW from North).
      // Based on visual observation: 45 degrees in lyrx shows as / in ArcGIS Pro,
      // which is CCW from East. In Canvas, positive rotate() is CW.
      // So to get CCW, we use negative angle.
      const angle = (rotation * Math.PI) / 180;

      // Create a pattern canvas large enough to cover the separation comfortably
      // We use a square that is a multiple of separation to ensure seamless tiling
      const size = Math.round(separation * 5); // Larger size for better precision
      if (size <= 0) return null;

      const pCanvas = document.createElement('canvas');
      pCanvas.width = size;
      pCanvas.height = size;
      const pCtx = pCanvas.getContext('2d');

      pCtx.strokeStyle = color;
      pCtx.lineWidth = lineWidth;

      // Draw multiple lines to ensure seamless repetition
      // We rotate the context and draw horizontal lines
      pCtx.save();
      pCtx.translate(size / 2, size / 2);
      pCtx.rotate(-angle); // Negative because Canvas rotate is CW

      const lineOffset = separation;
      const limit = Math.ceil(size * 1.5 / lineOffset);

      for (let i = -limit; i <= limit; i++) {
        pCtx.beginPath();
        pCtx.moveTo(-size * 2, i * lineOffset);
        pCtx.lineTo(size * 2, i * lineOffset);
        pCtx.stroke();
      }
      pCtx.restore();

      return this.ctx.createPattern(pCanvas, 'repeat');
    } catch (e) {
      console.warn('Failed to create hatch pattern', e);
      return null;
    }
  }
}

// Expose globally
window.CanvasLayerRenderer = CanvasLayerRenderer;
