/**
 * AdvancedStyleDrawing
 *
 * Shared canvas drawing adapter for AdvancedStyleEngine commands.
 *
 * Responsibilities:
 *  - Given a CanvasRenderingContext2D, a viewContext, and a single drawing
 *    command ({ type, geometry, symbol }), perform the actual canvas calls.
 *  - Handle:
 *      - Hatch fills (per-context hatch source canvas so no canvas is used as
 *        pattern source in more than one context; avoids cross-context issues)
 *      - Multi-stroke lines (correct ordering for halos vs main stroke)
 *      - Marker drawing and marker-line placement
 *
 * The adapter is renderer-agnostic. Callers must provide a viewContext with:
 *  - coordToPixel: (coord: [x, y]) => { x, y } in canvas pixels
 *  - pixelRatio: number (device pixel ratio)
 *  - viewportWidth, viewportHeight: canvas CSS pixel dimensions
 */
class AdvancedStyleDrawing {
  constructor() {
    // Global cache for hatch source canvases (not patterns, as patterns need per-call transform).
    // Key: color|separation|width
    // Value: HTMLCanvasElement
    if (!AdvancedStyleDrawing._hatchSourceCache) {
      AdvancedStyleDrawing._hatchSourceCache = new Map();
    }
  }

  /**
   * Draw a list of commands to the canvas.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {Object[]} commands - AdvancedStyleEngine commands
   * @param {Object} viewContext
   * @param {Function} viewContext.coordToPixel
   * @param {number} viewContext.pixelRatio
   * @param {number} viewContext.viewportWidth - unused for pattern generation now
   * @param {number} viewContext.viewportHeight - unused for pattern generation now
   * @param {Object} [viewContext.tileOrigin] - {x, y} global pixel offset of this tile/canvas origin
   */
  drawCommands(ctx, commands, viewContext) {
    if (!ctx || !Array.isArray(commands) || !viewContext) return;

    // Default tile origin to (0,0) if not provided (e.g. for single-canvas layers)
    if (!viewContext.tileOrigin) {
      viewContext.tileOrigin = { x: 0, y: 0 };
    }

    for (const cmd of commands) {
      const symbol = cmd.symbol || {};
      const symbolLayers = symbol.symbolLayers || [];

      if (!symbolLayers.length || !cmd.geometry) continue;

      if (cmd.type === "drawLine") {
        this._drawLineCommand(ctx, cmd.geometry, symbolLayers, viewContext);
      } else if (cmd.type === "drawPolygon") {
        this._drawPolygonCommand(ctx, cmd.geometry, symbolLayers, viewContext);
      } else if (cmd.type === "drawMarker") {
        this._drawMarkerCommand(ctx, cmd.geometry, symbolLayers, viewContext);
      } else if (cmd.type === "drawMarkerLine") {
        this._drawMarkerLineCommand(
          ctx,
          cmd.geometry,
          symbolLayers,
          viewContext,
        );
      }
    }
  }

  _drawLineCommand(ctx, geometry, symbolLayers, viewContext) {
    const strokeLayers = symbolLayers
      .filter((l) => l && l.type === "stroke")
      .slice();

    if (!strokeLayers.length) return;

    strokeLayers.sort((a, b) => {
      const aHasDash =
        a.dash && Array.isArray(a.dash.array) && a.dash.array.length > 0
          ? 1
          : 0;
      const bHasDash =
        b.dash && Array.isArray(b.dash.array) && b.dash.array.length > 0
          ? 1
          : 0;
      if (aHasDash !== bHasDash) {
        return aHasDash - bHasDash; // non-dashed first
      }
      const aWidth = typeof a.width === "number" && a.width > 0 ? a.width : 1;
      const bWidth = typeof b.width === "number" && b.width > 0 ? b.width : 1;
      return bWidth - aWidth; // wider first
    });

    const geomType = geometry.type;
    const coords = geometry.coordinates;
    if (geomType !== "LineString" && geomType !== "MultiLineString") return;

    const lines =
      geomType === "LineString"
        ? [coords]
        : Array.isArray(coords)
          ? coords
          : [];

    for (const sl of strokeLayers) {
      const dashArray =
        sl.dash && Array.isArray(sl.dash.array) ? sl.dash.array.slice() : null;
      const styleForDraw = { hatch: null, dashArray };

      for (const line of lines) {
        this._drawLineString(
          ctx,
          line,
          sl.color || "#000000",
          sl.opacity !== undefined ? sl.opacity : 1.0,
          sl.width !== undefined ? sl.width : 1.0,
          styleForDraw,
          viewContext,
        );
      }
    }
  }

  _drawPolygonCommand(ctx, geometry, symbolLayers, viewContext) {
    let baseFillColor = null;
    let baseFillOpacity = 0;
    let strokeColor = "#000000";
    let strokeOpacity = 0;
    let lineWidth = 1;
    let radius = 5;
    let hatch = null;
    let dashArray = null;

    for (const layer of symbolLayers) {
      if (layer.type === "fill") {
        const fillType = layer.fillType || "solid";
        if (fillType === "solid") {
          if (layer.color) baseFillColor = layer.color;
          if (layer.opacity !== undefined) {
            baseFillOpacity = layer.opacity;
          }
        } else if (fillType === "hatch" && layer.hatch) {
          hatch = {
            color: layer.hatch.color,
            rotation: layer.hatch.rotation,
            separation: layer.hatch.separation,
            width: layer.hatch.width,
          };
        }
      } else if (layer.type === "stroke") {
        strokeColor = layer.color || strokeColor;
        strokeOpacity =
          layer.opacity !== undefined ? layer.opacity : strokeOpacity;
        lineWidth = layer.width !== undefined ? layer.width : lineWidth;
        if (layer.dash && Array.isArray(layer.dash.array)) {
          dashArray = layer.dash.array.slice();
        }
      } else if (layer.type === "markerPoint") {
        radius =
          layer.marker && typeof layer.marker.size === "number"
            ? layer.marker.size
            : radius;
      }
    }

    const fillColor = baseFillColor || "#808080";
    const fillOpacity = baseFillColor ? baseFillOpacity : 0;

    const styleForDraw = {
      hatch,
      dashArray,
    };

    this._drawGeometry(
      ctx,
      geometry,
      fillColor,
      strokeColor,
      fillOpacity,
      strokeOpacity,
      lineWidth,
      radius,
      styleForDraw,
      viewContext,
    );
  }

  _drawMarkerCommand(ctx, geometry, symbolLayers, viewContext) {
    let fillColor = "#808080";
    let fillOpacity = 1.0;
    let strokeColor = "#000000";
    let strokeOpacity = 1.0;
    let lineWidth = 1;
    let radius = 5;

    for (const layer of symbolLayers) {
      if (layer.type === "fill") {
        fillColor = layer.color || fillColor;
        if (layer.opacity !== undefined) {
          fillOpacity = layer.opacity;
        }
      } else if (layer.type === "stroke") {
        strokeColor = layer.color || strokeColor;
        if (layer.opacity !== undefined) {
          strokeOpacity = layer.opacity;
        }
        if (layer.width !== undefined) {
          lineWidth = layer.width;
        }
      } else if (layer.type === "markerPoint") {
        radius =
          layer.marker && typeof layer.marker.size === "number"
            ? layer.marker.size
            : radius;
      }
    }

    const styleForDraw = { hatch: null, dashArray: null };

    this._drawGeometry(
      ctx,
      geometry,
      fillColor,
      strokeColor,
      fillOpacity,
      strokeOpacity,
      lineWidth,
      radius,
      styleForDraw,
      viewContext,
    );
  }

  _drawMarkerLineCommand(ctx, geometry, symbolLayers, viewContext) {
    const markerLayer = symbolLayers.find((l) => l && l.type === "markerLine");
    if (!markerLayer) return;
    this._drawMarkerLine(ctx, geometry, markerLayer, viewContext);
  }

  _drawGeometry(
    ctx,
    geometry,
    fillColor,
    strokeColor,
    fillOpacity,
    strokeOpacity,
    lineWidth,
    radius,
    style,
    viewContext,
  ) {
    const type = geometry.type;
    const coords = geometry.coordinates;

    if (type === "Polygon") {
      this._drawPolygon(
        ctx,
        coords,
        fillColor,
        strokeColor,
        fillOpacity,
        strokeOpacity,
        lineWidth,
        style,
        viewContext,
      );
    } else if (type === "MultiPolygon") {
      for (const polygon of coords) {
        this._drawPolygon(
          ctx,
          polygon,
          fillColor,
          strokeColor,
          fillOpacity,
          strokeOpacity,
          lineWidth,
          style,
          viewContext,
        );
      }
    } else if (type === "LineString") {
      this._drawLineString(
        ctx,
        coords,
        strokeColor,
        strokeOpacity,
        lineWidth,
        style,
        viewContext,
      );
    } else if (type === "MultiLineString") {
      for (const line of coords) {
        this._drawLineString(
          ctx,
          line,
          strokeColor,
          strokeOpacity,
          lineWidth,
          style,
          viewContext,
        );
      }
    } else if (type === "Point") {
      this._drawPoint(
        ctx,
        coords,
        fillColor,
        strokeColor,
        fillOpacity,
        strokeOpacity,
        lineWidth,
        radius,
        viewContext,
      );
    } else if (type === "MultiPoint") {
      for (const point of coords) {
        this._drawPoint(
          ctx,
          point,
          fillColor,
          strokeColor,
          fillOpacity,
          strokeOpacity,
          lineWidth,
          radius,
          viewContext,
        );
      }
    }
  }

  _drawPolygon(
    ctx,
    rings,
    fillColor,
    strokeColor,
    fillOpacity,
    strokeOpacity,
    lineWidth,
    style,
    viewContext,
  ) {
    if (!rings || rings.length === 0) return;

    ctx.beginPath();

    for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
      const ring = rings[ringIndex];
      if (!ring || ring.length < 3) continue;

      const first = viewContext.coordToPixel(ring[0]);
      ctx.moveTo(first.x, first.y);

      for (let i = 1; i < ring.length; i++) {
        const pt = viewContext.coordToPixel(ring[i]);
        ctx.lineTo(pt.x, pt.y);
      }

      ctx.closePath();
    }

    const hasHatch = style && style.hatch;
    if (fillOpacity > 0 || hasHatch) {
      if (fillOpacity > 0) {
        ctx.globalAlpha = fillOpacity;
        ctx.fillStyle = fillColor;
        ctx.fill("evenodd");
        ctx.globalAlpha = 1; // Reset alpha
      }

      if (hasHatch) {
        ctx.globalAlpha = 1;
        const pattern = this._getHatchPattern(style.hatch, ctx, viewContext);
        if (pattern) {
          ctx.fillStyle = pattern;
          ctx.fill("evenodd");
        }
      }
    }

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
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  _drawLineString(
    ctx,
    coords,
    strokeColor,
    strokeOpacity,
    lineWidth,
    style,
    viewContext,
  ) {
    if (!coords || coords.length < 2) return;

    ctx.beginPath();

    const first = viewContext.coordToPixel(coords[0]);
    ctx.moveTo(first.x, first.y);

    for (let i = 1; i < coords.length; i++) {
      const pt = viewContext.coordToPixel(coords[i]);
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
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  _drawPoint(
    ctx,
    coords,
    fillColor,
    strokeColor,
    fillOpacity,
    strokeOpacity,
    lineWidth,
    radius,
    viewContext,
  ) {
    if (!coords || coords.length < 2) return;

    const pt = viewContext.coordToPixel(coords);

    ctx.beginPath();
    ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);

    if (fillOpacity > 0) {
      ctx.globalAlpha = fillOpacity;
      ctx.fillStyle = fillColor;
      ctx.fill();
    }

    if (strokeOpacity > 0 && lineWidth > 0) {
      ctx.globalAlpha = strokeOpacity;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
  }

  _drawMarkerLine(ctx, geometry, markerLayer, viewContext) {
    // Implementation unchanged from original, omitted for brevity if unmodified logic
    // But since we are replacing the whole class, we must include it.
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
        : 30;
    const offsetAlong =
      typeof placement.offsetAlong === "number" && placement.offsetAlong > 0
        ? placement.offsetAlong
        : 0;

    const orientation = markerLayer.orientation || {};
    const alignToLine = !!orientation.alignToLine;

    const radius = size / 2;

    for (const line of allLines) {
      if (!Array.isArray(line) || line.length < 2) continue;

      const pts = line.map((c) => viewContext.coordToPixel(c));

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
   * Create or retrieve a seamless vertical line pattern canvas.
   * Cached by style (color|width|separation).
   */
  _getHatchSourceCanvas(hatch) {
    const color = hatch.color || "#000000";
    const separation = Math.max(1, hatch.separation || 10);
    const width = hatch.width || 1;

    // Rotation is handled by pattern transform, so we only need unique sources for
    // base properties.
    const key = `${color}|${separation}|${width}`;

    if (AdvancedStyleDrawing._hatchSourceCache.has(key)) {
      return AdvancedStyleDrawing._hatchSourceCache.get(key);
    }

    // Create a small seamless tile.
    // Vertical lines with 'separation' spacing.
    // Canvas width = separation. Height = separation.
    const size = separation;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size; // Height matches width for simplicity

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "butt"; // Use butt to avoid extra length projection

    // Center the line at x = size / 2.
    // This ensures that for a width W, we cover pixels [center - W/2, center + W/2].
    // Since pattern is repeated, the gap will be split evenly on left/right edges,
    // forming a continuous gap of (separation - width) when tiled.
    // This prevents clipping at the edges (x=0) which was causing "half-width" lines.
    ctx.beginPath();
    ctx.moveTo(size / 2, 0);
    ctx.lineTo(size / 2, size);
    ctx.stroke();

    AdvancedStyleDrawing._hatchSourceCache.set(key, canvas);
    return canvas;
  }

  _getHatchPattern(hatch, ctx, viewContext) {
    if (!hatch) return null;

    const sourceCanvas = this._getHatchSourceCanvas(hatch);
    if (!sourceCanvas) return null;

    // Create unique pattern object for this call (reusing source canvas)
    const pattern = ctx.createPattern(sourceCanvas, "repeat");
    if (!pattern) return null;

    // Calculate Transform Matrix for global alignment
    // We need to:
    // 1. Translate pattern origin to align with Global (0,0)
    //    Current drawing is happening in Tile Local space (0,0 is top-left of tile).
    //    Tile starts at Global (tileOrigin.x, tileOrigin.y).
    //    So Local (0,0) = Global (tileOrigin.x, tileOrigin.y).
    //    We want Pattern (0,0) to align with Global (0,0).
    //    So we shift Pattern by (-tileOrigin.x, -tileOrigin.y).
    // 2. Rotate pattern properties.

    const rotation = hatch.rotation || 0;
    const origin = viewContext.tileOrigin || { x: 0, y: 0 };

    try {
      const matrix = new DOMMatrix();

      // Order of operations:
      // We want to map User Space (P) to Pattern Space (P_pat).
      // We want P_pat to represent the Rotated World Coordinate.
      // P_world_aligned = P_user - Origin (Shift to align with World 0,0)
      // P_pat = Rotate(P_world_aligned)
      // P_pat = Rotate * (P_user - Origin)
      // P_pat = Rotate * Translate(-Origin) * P_user
      //
      // DOMMatrix operations (post-multiply):
      // m.rotate(r) -> M = R
      // m.translate(t) -> M = R * T
      //
      // So we must Rotate FIRST, then Translate in the chain.

      // Order of operations for Pattern Alignment (Global Phase):
      // We want to map Local Coordinate 'p' to a Global Pattern coordinate 'p_pat'.
      // 1. Map Local to Global (unrotated): p_global = p + origin.
      // 2. Rotate the Global Coordinate around (0,0): p_pat = R * p_global.
      // Matrix M = R * T(+origin).
      // Since translateSelf post-multiplies: M = I * R * T.

      // Correct Order: Translate to Global Origin (negative offset), THEN Rotate.
      // We want M = T(-Origin) * R
      // Since translateSelf/rotateSelf post-multiplies: M = I * T * R

      // Reverted to original order: Rotate, then Translate (Relative to Origin)
      // We want P_pattern = R * (P_local + Origin)
      // M = R * T(+Origin)
      matrix.rotateSelf(rotation);
      matrix.translateSelf(origin.x, origin.y);

      // DEBUG: Trace pattern matrix
      // console.log(`[Hatch] Key: ${viewContext.tileKey || 'N/A'} Origin: ${origin.x},${origin.y} Rot: ${rotation} Matrix: ${matrix.toString()}`);

      if (pattern.setTransform) {
        pattern.setTransform(matrix);
      }
    } catch (e) {
      // DOMMatrix or setTransform might not be supported in older environments/tests
      // Fallback: no alignment
    }

    return pattern;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = AdvancedStyleDrawing;
}

if (typeof window !== "undefined") {
  window.AdvancedStyleDrawing = AdvancedStyleDrawing;
}
