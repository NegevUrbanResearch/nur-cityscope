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

    this._createCanvas();
  }

  _createCanvas() {
    // Remove existing canvas if present
    const existing = this.container.querySelector('#layersCanvas');
    if (existing) existing.remove();

    // Create canvas element
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'layersCanvas';
    this.canvas.style.cssText = 'position: absolute; pointer-events: none; z-index: 5;';

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
   */
  updatePosition(displayBounds, modelBounds) {
    if (!displayBounds || !modelBounds) return;

    this.displayBounds = displayBounds;
    this.modelBounds = modelBounds;

    // Position canvas over the image
    this.canvas.style.left = displayBounds.offsetX + 'px';
    this.canvas.style.top = displayBounds.offsetY + 'px';
    this.canvas.style.width = displayBounds.width + 'px';
    this.canvas.style.height = displayBounds.height + 'px';

    // Set canvas resolution (use 1x for performance, could be 2x for retina)
    this.canvas.width = displayBounds.width;
    this.canvas.height = displayBounds.height;

    // Re-render all visible layers
    this.render();
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
      this.render();
    }
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
    if (elapsed > 50) {
      console.log(`Canvas render took ${elapsed.toFixed(1)}ms`);
    }
  }

  /**
   * Render a single layer
   */
  _renderLayer(geojson, styleFunction) {
    const ctx = this.ctx;

    for (const feature of geojson.features) {
      if (!feature.geometry) continue;

      const style = styleFunction ? styleFunction(feature) : {};
      const fillColor = style.fillColor || style.fill || '#888888';
      const strokeColor = style.color || style.stroke || '#333333';
      const fillOpacity = style.fillOpacity ?? 1.0;  // Full opacity for projector
      const strokeOpacity = style.opacity ?? 1.0;
      const lineWidth = style.weight ?? 1;

      // Draw the geometry
      this._drawGeometry(ctx, feature.geometry, fillColor, strokeColor, fillOpacity, strokeOpacity, lineWidth);
    }
  }

  /**
   * Draw a geometry to canvas
   */
  _drawGeometry(ctx, geometry, fillColor, strokeColor, fillOpacity, strokeOpacity, lineWidth) {
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
   * Convert ITM coordinate to canvas pixel
   */
  _coordToPixel(coord) {
    const [x, y] = coord;
    const bounds = this.modelBounds;
    const display = this.displayBounds;

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
