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
    this._advancedDrawer = null; // Shared AdvancedStyleDrawing instance

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
  setLayer(layerId, geojson, styleFunction, geometryType, styleConfig) {
    const belowWmts = layerId.includes("רקע_שחור");
    this.layers[layerId] = {
      geojson: geojson,
      styleFunction: styleFunction,
      styleConfig: styleConfig || null,
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
      this._renderLayer(layer.geojson, layer.styleFunction, this.ctxBottom, layer.styleConfig);
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
      this._renderLayer(layer.geojson, layer.styleFunction, this.ctx, layer.styleConfig);
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
  _renderLayer(geojson, styleFunction, ctx, styleConfig) {
    const targetCtx = ctx || this.ctx;
    const prevCtx = this.ctx;
    this.ctx = targetCtx;

    const features = geojson.features || [];

    if (features.length === 0) {
      this.ctx = prevCtx;
      return;
    }

    const style = styleConfig && styleConfig.style;
    const hasAdvancedSymbol =
      style &&
      (style.advancedSymbol?.symbolLayers?.length > 0 ||
        (style.uniqueValues?.classes || []).some(
          (c) => c.advancedSymbol?.symbolLayers?.length > 0,
        ));
    const isAdvanced =
      hasAdvancedSymbol &&
      typeof AdvancedStyleEngine !== "undefined" &&
      typeof AdvancedStyleDrawing !== "undefined";

    if (isAdvanced) {
      // Use shared advanced style engine to compute drawing commands, then
      // delegate actual drawing to AdvancedStyleDrawing, including multi-stroke
      // lines, hatch fills, and marker-along-line.
      const commands = AdvancedStyleEngine.computeCommands(
        features,
        style,
        {},
      );

      if (!this._advancedDrawer) {
        this._advancedDrawer = new AdvancedStyleDrawing();
      }

      const viewContext = {
        coordToPixel: (coord) => this._coordToPixel(coord),
        pixelRatio: this.dpr || window.devicePixelRatio || 1,
        viewportWidth: this.displayBounds ? this.displayBounds.width : this.canvas.width,
        viewportHeight: this.displayBounds ? this.displayBounds.height : this.canvas.height,
      };

      this._advancedDrawer.drawCommands(targetCtx, commands, viewContext);

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

    // Fill (solid background and/or hatch)
    const hasHatch = style && style.hatch;
    if (fillOpacity > 0 || hasHatch) {
      // Draw solid background first if we have one
      if (fillOpacity > 0) {
        ctx.globalAlpha = fillOpacity;
        ctx.fillStyle = fillColor;
        ctx.fill('evenodd');
      }

      // Draw hatch on top if defined (even for pure-hatch symbols with no solid fill).
      // We use a cached, viewport-sized pattern per hatch style so that we only pay
      // the cost of drawing hatch lines once per style instead of once per feature.
      if (hasHatch) {
        ctx.globalAlpha = 1;
        const pattern = this._getHatchPattern(style.hatch);
        if (pattern) {
          ctx.fillStyle = pattern;
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
   * Draw markers along a line based on markerLine symbol layer
   */
  _drawMarkerLine(ctx, geometry, markerLayer) {
    if (!geometry || !geometry.type || !geometry.coordinates) return;

    const type = geometry.type;
    const allLines =
      type === "LineString"
        ? [geometry.coordinates]
        : type === "MultiLineString"
          ? geometry.coordinates
          : [];

    if (!allLines.length) return;

    const marker = markerLayer.marker || {};
    const size =
      typeof marker.size === "number" && marker.size > 0 ? marker.size : 5;
    const fillColor = marker.fillColor || marker.strokeColor || "#000000";
    const strokeColor = marker.strokeColor || fillColor || "#000000";
    const strokeWidth =
      typeof marker.strokeWidth === "number" && marker.strokeWidth > 0
        ? marker.strokeWidth
        : 1;
    const shape = marker.shape || "circle";

    const placement = markerLayer.placement || {};
    const interval =
      typeof placement.interval === "number" && placement.interval > 0
        ? placement.interval
        : 30; // sensible default in pixels
    const offsetAlong =
      typeof placement.offsetAlong === "number" && placement.offsetAlong > 0
        ? placement.offsetAlong
        : 0;

    const orientation = markerLayer.orientation || {};
    const alignToLine = !!orientation.alignToLine;

    const radius = size / 2;

    for (const line of allLines) {
      if (!Array.isArray(line) || line.length < 2) continue;

      // Convert to pixel coords
      const pts = line.map((c) => this._coordToPixel(c));

      // Compute cumulative distances along the polyline in pixels
      const segLengths = [];
      let total = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const dx = pts[i + 1].x - pts[i].x;
        const dy = pts[i + 1].y - pts[i].y;
        const len = Math.sqrt(dx * dx + dy * dy);
        segLengths.push(len);
        total += len;
      }
      if (total <= 0) continue;

      let d = offsetAlong;
      while (d <= total) {
        // Find segment for distance d
        let acc = 0;
        let segIndex = 0;
        while (segIndex < segLengths.length && acc + segLengths[segIndex] < d) {
          acc += segLengths[segIndex];
          segIndex++;
        }
        if (segIndex >= segLengths.length) break;

        const segLen = segLengths[segIndex];
        const t = segLen > 0 ? (d - acc) / segLen : 0;

        const p0 = pts[segIndex];
        const p1 = pts[segIndex + 1];
        const mx = p0.x + (p1.x - p0.x) * t;
        const my = p0.y + (p1.y - p0.y) * t;
        const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);

        ctx.save();
        ctx.translate(mx, my);
        if (alignToLine) {
          ctx.rotate(angle);
        }
        ctx.beginPath();
        ctx.globalAlpha = 1;
        ctx.fillStyle = fillColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;

        if (shape === "square") {
          const side = size;
          ctx.rect(-side / 2, -side / 2, side, side);
        } else {
          ctx.arc(0, 0, radius, 0, Math.PI * 2);
        }

        ctx.fill();
        ctx.stroke();
        ctx.restore();

        d += interval;
      }
    }
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

      const dpr = this.dpr || window.devicePixelRatio || 1;
      const width =
        (this.displayBounds ? this.displayBounds.width : this.canvas.width) *
        dpr;
      const height =
        (this.displayBounds ? this.displayBounds.height : this.canvas.height) *
        dpr;
      if (width <= 0 || height <= 0) return null;

      const pCanvas = document.createElement('canvas');
      pCanvas.width = width;
      pCanvas.height = height;
      const pCtx = pCanvas.getContext('2d');
      if (!pCtx) return null;

      pCtx.strokeStyle = color;
      pCtx.lineWidth = lineWidth;

      const angle = (rotation * Math.PI) / 180;
      const diag = Math.sqrt(width * width + height * height);

      pCtx.save();
      pCtx.translate(width / 2, height / 2);
      // ArcGIS rotation is CCW from East; Canvas positive rotation is CW,
      // so we negate the angle to match the visual direction.
      pCtx.rotate(-angle);

      for (let y = -diag; y <= diag; y += separation) {
        pCtx.beginPath();
        pCtx.moveTo(-diag, y);
        pCtx.lineTo(diag, y);
        pCtx.stroke();
      }
      pCtx.restore();

      // Single viewport-sized tile; no repetition needed.
      return this.ctx.createPattern(pCanvas, 'no-repeat');
    } catch (e) {
      console.warn('Failed to create hatch pattern', e);
      return null;
    }
  }

  /**
   * Get (or create) a cached hatch pattern for a given hatch style.
   * The pattern is sized to the current viewport so that lines appear continuous
   * and we only pay the line-drawing cost once per style.
   */
  _getHatchPattern(hatch) {
    if (!hatch) return null;
    const key = [
      hatch.color || '#000000',
      hatch.rotation || 0,
      hatch.separation || 10,
      hatch.width || 1,
      this.displayBounds ? this.displayBounds.width : this.canvas.width,
      this.displayBounds ? this.displayBounds.height : this.canvas.height,
      this.dpr || window.devicePixelRatio || 1,
    ].join('|');

    if (!this._patterns[key]) {
      this._patterns[key] = this._createHatchPattern(hatch);
    }

    return this._patterns[key];
  }
}

// Expose globally
window.CanvasLayerRenderer = CanvasLayerRenderer;
