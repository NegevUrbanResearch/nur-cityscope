/**
 * AdvancedStyleDrawing
 *
 * Canvas only. Draws commands using viewContext (must include tileOrigin for
 * seamless hatch). No style resolution or tile lifecycle.
 *
 * Responsibilities:
 *  - Given a CanvasRenderingContext2D, a viewContext, and drawing commands,
 *    perform the actual canvas calls.
 *  - Hatch patterns are aligned using viewContext.tileOrigin so that pattern
 *    phase is consistent across tiles. Any cache for patterns must key by the
 *    same tileOrigin used when drawing.
 */
class AdvancedStyleDrawing {
  static _HATCH_PATTERN_CACHE_MAX = 100;

  constructor() {
    if (!AdvancedStyleDrawing._hatchSourceCache) {
      AdvancedStyleDrawing._hatchSourceCache = new Map();
    }
    // Per-instance pattern cache: key = hatchKey|originKey, value = Map<ctx, CanvasPattern>
    this._hatchPatternCache = new Map();
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
   * @param {Object} [helpers] - Optional helpers provided by the renderer
   * @param {Function} [helpers.getIcon] - (url) => { img, loaded, failed }
   */
  drawCommands(ctx, commands, viewContext, helpers) {
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
        this._drawLineCommand(
          ctx,
          cmd.geometry,
          symbolLayers,
          viewContext,
          cmd.animation && cmd.animation.flow ? cmd.animation.flow : null,
        );
      } else if (cmd.type === "drawPolygon") {
        this._drawPolygonCommand(ctx, cmd.geometry, symbolLayers, viewContext);
      } else if (cmd.type === "drawMarker") {
        this._drawMarkerCommand(
          ctx,
          cmd.geometry,
          symbolLayers,
          viewContext,
          helpers,
        );
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

  _drawLineCommand(ctx, geometry, symbolLayers, viewContext, flowAnimation) {
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
      const styleForDraw = { hatch: null, dashArray, flow: flowAnimation };

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
    let strokeApplied = false;

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
        const opacity =
          layer.opacity !== undefined ? layer.opacity : 1.0;
        const width = layer.width !== undefined ? layer.width : 1;
        const visible = opacity > 0 && width > 0;
        if (visible && !strokeApplied) {
          strokeColor = layer.color || strokeColor;
          strokeOpacity = opacity;
          lineWidth = width;
          strokeApplied = true;
          if (layer.dash && Array.isArray(layer.dash.array)) {
            dashArray = layer.dash.array.slice();
          }
        } else if (!strokeApplied) {
          strokeColor = layer.color || strokeColor;
          strokeOpacity = opacity;
          lineWidth = width;
          if (layer.dash && Array.isArray(layer.dash.array)) {
            dashArray = layer.dash.array.slice();
          }
        }
      } else if (layer.type === "markerPoint") {
        // marker.size from styles.json is diameter (px); use half for circle radius
        const sizePx =
          layer.marker && typeof layer.marker.size === "number"
            ? layer.marker.size
            : radius * 2;
        radius = sizePx / 2;
      }
    }
    if (!strokeApplied && (baseFillColor || hatch)) {
      strokeOpacity = 1.0;
      lineWidth = lineWidth > 0 ? lineWidth : 1;
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

  _drawMarkerCommand(ctx, geometry, symbolLayers, viewContext, helpers) {
    let fillColor = "#808080";
    let fillOpacity = 1.0;
    let strokeColor = "#000000";
    let strokeOpacity = 1.0;
    let lineWidth = 1;
    let radius = 5;
    let markerStrokeFromPoint = null;
    let strokeApplied = false;
    let markerHasVisibleFill = false;
    let iconLayer = null;

    for (const layer of symbolLayers) {
      if (layer.type === "fill") {
        const nextColor = layer.color || fillColor;
        const nextOpacity =
          layer.opacity !== undefined ? layer.opacity : fillOpacity;
        const isVisibleFill =
          typeof nextOpacity === "number" ? nextOpacity > 0 : true;
        if (isVisibleFill) {
          fillColor = nextColor;
          fillOpacity = nextOpacity;
          markerHasVisibleFill = true;
        } else if (!markerHasVisibleFill) {
          fillColor = nextColor;
          fillOpacity = nextOpacity;
        }
      } else if (layer.type === "stroke") {
        const opacity =
          layer.opacity !== undefined ? layer.opacity : 1.0;
        const width = layer.width !== undefined ? layer.width : 1;
        const visible = opacity > 0 && width > 0;
        if (visible && !strokeApplied) {
          strokeColor = layer.color || strokeColor;
          strokeOpacity = opacity;
          lineWidth = width;
          strokeApplied = true;
        } else if (!strokeApplied) {
          strokeColor = layer.color || strokeColor;
          strokeOpacity = opacity;
          lineWidth = width;
        }
      } else if (layer.type === "markerPoint" && layer.marker) {
        const sizePx =
          typeof layer.marker.size === "number"
            ? layer.marker.size
            : radius * 2;
        radius = sizePx / 2;
        if (layer.marker.iconUrl) {
          iconLayer = layer;
        }
        if (
          layer.marker.strokeColor != null ||
          (typeof layer.marker.strokeWidth === "number" && layer.marker.strokeWidth > 0)
        ) {
          markerStrokeFromPoint = {
            color: layer.marker.strokeColor || "#000000",
            width:
              typeof layer.marker.strokeWidth === "number" && layer.marker.strokeWidth > 0
                ? layer.marker.strokeWidth
                : 1,
          };
        }
      }
    }
    if (markerStrokeFromPoint) {
      strokeColor = markerStrokeFromPoint.color;
      lineWidth = markerStrokeFromPoint.width;
      strokeOpacity = 1.0;
    }
    const styleForDraw = { hatch: null, dashArray: null };

    // Icon marker support: when a markerPoint layer includes marker.iconUrl,
    // delegate image loading to helpers.getIcon and draw the icon instead of
    // a circle marker.
    if (iconLayer && helpers && typeof helpers.getIcon === "function") {
      const iconUrl = iconLayer.marker.iconUrl;
      const entry = helpers.getIcon(iconUrl);
      if (entry && entry.img && entry.loaded && !entry.failed) {
        const sizePx =
          typeof iconLayer.marker.size === "number"
            ? iconLayer.marker.size
            : radius * 2;
        const width = sizePx;
        const height = sizePx;

        const drawAt = (coords) => {
          if (!coords || coords.length < 2) return;
          const pt = viewContext.coordToPixel(coords);
          ctx.save();
          ctx.globalAlpha = 1;
          ctx.drawImage(
            entry.img,
            pt.x - width / 2,
            pt.y - height / 2,
            width,
            height,
          );
          ctx.restore();
        };

        const type = geometry.type;
        const coords = geometry.coordinates;
        if (type === "Point") {
          drawAt(coords);
        } else if (type === "MultiPoint" && Array.isArray(coords)) {
          coords.forEach((p) => drawAt(p));
        }
      }
      // When an icon style is configured we skip circle rendering; if the icon
      // has not finished loading yet, nothing is drawn and a later render
      // (triggered by the loader) will paint it.
      return;
    }

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

    const flow = style && style.flow;
    const phasePx = Number(flow?.phasePx) || 0;

    // Build pixel path once for modes that need length or reuse
    const pts = coords.map((c) => viewContext.coordToPixel(c));

    if (flow && flow.enabled && flow.mode === "reveal") {
      // Solid line that draws along the path (no dashes). Stroke only from start
      // up to (phasePx % totalLength) so the line "reveals" over time.
      const totalLength = this._pathLength(pts);
      if (totalLength <= 0) return;
      const revealAt = phasePx % totalLength;

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i - 1].x;
        const dy = pts[i].y - pts[i - 1].y;
        const segLen = Math.sqrt(dx * dx + dy * dy);
        if (acc + segLen >= revealAt) {
          const t = segLen > 0 ? (revealAt - acc) / segLen : 0;
          const x = pts[i - 1].x + dx * t;
          const y = pts[i - 1].y + dy * t;
          ctx.lineTo(x, y);
          break;
        }
        acc += segLen;
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.globalAlpha = strokeOpacity;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash([]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      return;
    }

    if (flow && flow.enabled && flow.mode === "trail") {
      // Point moves along path and leaves the line as trail; route stays visible.
      // No "ball that leaves nothing" – the trail IS the route.
      const totalLength = this._pathLength(pts);
      if (totalLength <= 0) return;
      // On short lines, slow the effective phase so one traverse takes at least
      // minDuration seconds – avoids strobing when path is very short.
      const minDurationSec = 2.2;
      const speed = Math.max(1, Number(flow.speed) || 20);
      const effectiveSpeed = Math.min(speed, totalLength / minDurationSec);
      const trailPhasePx = (phasePx * effectiveSpeed) / speed;
      const revealAt = trailPhasePx % totalLength;

      // 1) Draw the trail (line from start up to current position)
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i - 1].x;
        const dy = pts[i].y - pts[i - 1].y;
        const segLen = Math.sqrt(dx * dx + dy * dy);
        if (acc + segLen >= revealAt) {
          const t = segLen > 0 ? (revealAt - acc) / segLen : 0;
          ctx.lineTo(
            pts[i - 1].x + dx * t,
            pts[i - 1].y + dy * t,
          );
          break;
        }
        acc += segLen;
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.globalAlpha = strokeOpacity;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash([]);
      ctx.stroke();

      // 2) Draw head (point at leading edge) unless we hide it at end
      const hideAtEnd = flow.hideHeadAtEnd === true;
      const atEnd = revealAt >= totalLength - 2;
      if (!(hideAtEnd && atEnd)) {
        const head = this._pointAtDistance(pts, revealAt);
        const r = Math.max(1, lineWidth * (flow.headRadius ?? 1.5));
        ctx.beginPath();
        ctx.arc(head.x, head.y, r, 0, Math.PI * 2);
        ctx.fillStyle = strokeColor;
        ctx.globalAlpha = strokeOpacity;
        ctx.fill();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      return;
    }

    // Full path for default / dash mode
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y);
    }

    ctx.globalAlpha = strokeOpacity;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;

    if (flow && flow.enabled) {
      const flowDashArray = Array.isArray(flow.dashArray) ? flow.dashArray : null;
      if (flowDashArray && flowDashArray.length > 0) {
        ctx.setLineDash(flowDashArray);
      } else if (style.dashArray && Array.isArray(style.dashArray)) {
        ctx.setLineDash(style.dashArray);
      } else {
        ctx.setLineDash([10, 14]);
      }
      ctx.lineDashOffset = phasePx;
    } else if (style.dashArray && Array.isArray(style.dashArray)) {
      ctx.setLineDash(style.dashArray);
      ctx.lineDashOffset = 0;
    } else {
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;
    }

    let prevAlpha = ctx.globalAlpha;
    if (flow && flow.enabled && typeof flow.opacity === "number") {
      ctx.globalAlpha = prevAlpha * flow.opacity;
    }
    ctx.stroke();
    ctx.globalAlpha = prevAlpha;
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  _pathLength(pts) {
    if (!pts || pts.length < 2) return 0;
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      len += Math.sqrt(dx * dx + dy * dy);
    }
    return len;
  }

  /** Returns { x, y } at distance along the path (clamped to path bounds). */
  _pointAtDistance(pts, distance) {
    if (!pts || pts.length < 2) return pts[0] ?? { x: 0, y: 0 };
    if (distance <= 0) return pts[0];
    const total = this._pathLength(pts);
    if (distance >= total) return pts[pts.length - 1];
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      const segLen = Math.sqrt(dx * dx + dy * dy);
      if (acc + segLen >= distance) {
        const t = segLen > 0 ? (distance - acc) / segLen : 0;
        return {
          x: pts[i - 1].x + dx * t,
          y: pts[i - 1].y + dy * t,
        };
      }
      acc += segLen;
    }
    return pts[pts.length - 1];
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

  /**
   * Hatch patterns are aligned using viewContext.tileOrigin so that pattern
   * phase is consistent across tiles. Cache is keyed by (hatch params, tileOrigin).
   */
  _getHatchPattern(hatch, ctx, viewContext) {
    if (!hatch) return null;

    const origin = viewContext.tileOrigin || { x: 0, y: 0 };
    const hatchKey = `${hatch.color || "#000000"}|${Math.max(1, hatch.separation || 10)}|${hatch.width || 1}|${hatch.rotation || 0}`;
    const originKey = `${origin.x}_${origin.y}`;
    const cacheKey = `${hatchKey}|${originKey}`;

    let byCtx = this._hatchPatternCache.get(cacheKey);
    if (byCtx) {
      const cached = byCtx.get(ctx);
      if (cached) return cached;
    } else {
      byCtx = new Map();
      this._hatchPatternCache.set(cacheKey, byCtx);
      if (this._hatchPatternCache.size > AdvancedStyleDrawing._HATCH_PATTERN_CACHE_MAX) {
        const firstKey = this._hatchPatternCache.keys().next().value;
        this._hatchPatternCache.delete(firstKey);
      }
    }

    const sourceCanvas = this._getHatchSourceCanvas(hatch);
    if (!sourceCanvas) return null;

    const pattern = ctx.createPattern(sourceCanvas, "repeat");
    if (!pattern) return null;

    const rotation = hatch.rotation || 0;
    try {
      const matrix = new DOMMatrix();
      matrix.rotateSelf(rotation);
      matrix.translateSelf(origin.x, origin.y);
      if (pattern.setTransform) {
        pattern.setTransform(matrix);
      }
    } catch (e) {
      // DOMMatrix or setTransform may be unsupported in some environments
    }

    byCtx.set(ctx, pattern);
    return pattern;
  }
}

if (typeof window !== "undefined") {
  window.AdvancedStyleDrawing = AdvancedStyleDrawing;
}

export default AdvancedStyleDrawing;
