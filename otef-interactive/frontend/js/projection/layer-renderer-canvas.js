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
    this.layers = {};  // { layerId: { geojson, styleFunction, visible } }
    this.modelBounds = null;
    this.displayBounds = null;
    this.dpr = 1;  // Device pixel ratio for high-DPI rendering

    this._createCanvas();
  }

  _createCanvas() {
    // Remove existing canvas if present
    const existing = this.container.querySelector('#layersCanvas');
    if (existing) existing.remove();

    // Create canvas element with crisp rendering for projector output
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'layersCanvas';
    this.canvas.style.cssText = 'position: absolute; pointer-events: none; z-index: 5; image-rendering: crisp-edges; image-rendering: -webkit-optimize-contrast;';

    // Insert before highlight overlay
    const highlightOverlay = this.container.querySelector('#highlightOverlay');
    if (highlightOverlay) {
      this.container.insertBefore(this.canvas, highlightOverlay);
    } else {
      this.container.appendChild(this.canvas);
    }

    this.ctx = this.canvas.getContext('2d');
  }

  /**
   * Update canvas position and size to match displayed image
   * Supports high-DPI rendering via devicePixelRatio and optional URL override
   */
  updatePosition(displayBounds, modelBounds) {
    if (!displayBounds || !modelBounds) return;

    this.displayBounds = displayBounds;
    this.modelBounds = modelBounds;

    // Check for explicit resolution override via URL parameter (e.g., ?canvasRes=1920x1200)
    const urlParams = new URLSearchParams(window.location.search);
    const canvasRes = urlParams.get('canvasRes');

    let canvasWidth, canvasHeight;

    if (canvasRes && canvasRes.match(/^\d+x\d+$/)) {
      // Explicit resolution override - render at exact specified resolution
      const [w, h] = canvasRes.split('x').map(Number);
      canvasWidth = w;
      canvasHeight = h;
      this.dpr = canvasWidth / displayBounds.width;  // Calculate effective DPR
      console.log(`[CanvasLayerRenderer] Using explicit resolution: ${w}x${h}`);
    } else {
      // Use devicePixelRatio for high-DPI rendering
      this.dpr = window.devicePixelRatio || 1;
      canvasWidth = Math.round(displayBounds.width * this.dpr);
      canvasHeight = Math.round(displayBounds.height * this.dpr);
    }

    // Position canvas over the image (CSS size)
    this.canvas.style.left = displayBounds.offsetX + 'px';
    this.canvas.style.top = displayBounds.offsetY + 'px';
    this.canvas.style.width = displayBounds.width + 'px';
    this.canvas.style.height = displayBounds.height + 'px';

    // Set canvas internal resolution (scaled for high-DPI)
    this.canvas.width = canvasWidth;
    this.canvas.height = canvasHeight;

    // Scale context so drawing operations use CSS pixel coordinates
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Re-render all visible layers (use scheduled render to avoid blocking)
    this._scheduleRender();
  }

  /**
   * Add/update a layer
   */
  setLayer(layerId, geojson, styleFunction) {
    this.layers[layerId] = {
      geojson: geojson,
      styleFunction: styleFunction,
      visible: false
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
  render() {
    if (!this.ctx || !this.displayBounds || !this.modelBounds) return;

    const startTime = performance.now();

    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Render each visible layer
    for (const [layerId, layer] of Object.entries(this.layers)) {
      if (!layer.visible || !layer.geojson?.features) continue;

      this._renderLayer(layer.geojson, layer.styleFunction);
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
  _renderLayer(geojson, styleFunction) {
    const ctx = this.ctx;
    const features = geojson.features || [];
    
    if (features.length === 0) return;

    // Batch style calculations to reduce function calls
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
      this._drawGeometry(ctx, feature.geometry, fillColor, strokeColor, fillOpacity, strokeOpacity, lineWidth, radius);
    }
  }

  /**
   * Draw a geometry to canvas
   */
  _drawGeometry(ctx, geometry, fillColor, strokeColor, fillOpacity, strokeOpacity, lineWidth, radius) {
    const type = geometry.type;
    const coords = geometry.coordinates;

    if (type === 'Polygon') {
      this._drawPolygon(ctx, coords, fillColor, strokeColor, fillOpacity, strokeOpacity, lineWidth);
    } else if (type === 'MultiPolygon') {
      for (const polygon of coords) {
        this._drawPolygon(ctx, polygon, fillColor, strokeColor, fillOpacity, strokeOpacity, lineWidth);
      }
    } else if (type === 'LineString') {
      this._drawLineString(ctx, coords, strokeColor, strokeOpacity, lineWidth);
    } else if (type === 'MultiLineString') {
      for (const line of coords) {
        this._drawLineString(ctx, line, strokeColor, strokeOpacity, lineWidth);
      }
    } else if (type === 'Point') {
      this._drawPoint(ctx, coords, fillColor, strokeColor, fillOpacity, strokeOpacity, lineWidth, radius);
    } else if (type === 'MultiPoint') {
      for (const point of coords) {
        this._drawPoint(ctx, point, fillColor, strokeColor, fillOpacity, strokeOpacity, lineWidth, radius);
      }
    }
  }

  /**
   * Draw a polygon (with holes support)
   */
  _drawPolygon(ctx, rings, fillColor, strokeColor, fillOpacity, strokeOpacity, lineWidth) {
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
      ctx.fillStyle = fillColor;
      ctx.fill('evenodd');  // evenodd for holes
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
   * Draw a line string
   */
  _drawLineString(ctx, coords, strokeColor, strokeOpacity, lineWidth) {
    if (!coords || coords.length < 2) return;

    ctx.beginPath();

    const first = this._coordToPixel(coords[0]);
    ctx.moveTo(first.x, first.y);

    for (let i = 1; i < coords.length; i++) {
      const pt = this._coordToPixel(coords[i]);
      ctx.lineTo(pt.x, pt.y);
    }

    ctx.globalAlpha = strokeOpacity;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
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
}

// Expose globally
window.CanvasLayerRenderer = CanvasLayerRenderer;
