import { paintShelterSymbol } from "../shared/nli-shelter-symbol.js";
import { OUTPUT_HEIGHT, OUTPUT_WIDTH, projectionOverlayMatrix } from "./projection-overlay-placement.js";
import { paintCaptivityBleedMarker } from "../shared/captivity-bleed-marker.js";
import { PROJECTION_LEGEND_FONT as FONT, layoutProjectionLegend, resolveLegendRasterSize } from "./legend-content-layout.js";
import { createLegendMotion } from "../shared/legend-motion.js";
import { resolveMotionMode } from "../shared/reduced-motion.js";
import { interpolateLegendPlacement } from "../shared/legend-placement-motion.js";

const INK = "#f2f3f4";

function makeCanvas(factory) {
  const canvas = factory?.() || globalThis.document?.createElement?.("canvas");
  if (!canvas) throw new Error("projection legend adapter requires canvas support");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  return canvas;
}

function setShadow(context, scale = 1) {
  context.shadowColor = "rgba(0, 0, 0, 0.85)";
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 2 * scale;
  context.shadowBlur = 8 * scale;
}

function shapePath(context, shape, x, y, width, height) {
  context.beginPath();
  if (shape === "point") {
    context.arc(x, y, Math.min(width, height) / 2, 0, Math.PI * 2);
  } else if (shape === "diamond") {
    context.moveTo(x, y - height / 2);
    context.lineTo(x + width / 2, y);
    context.lineTo(x, y + height / 2);
    context.lineTo(x - width / 2, y);
    context.closePath();
  } else {
    context.rect(x - width / 2, y - height / 2, width, height);
  }
}

function hatchSpec(style) {
  const match = String(style || "").match(/^repeating-linear-gradient\(\s*(-?[\d.]+)deg\s*,\s*(.*)\)$/i);
  if (!match) return null;
  const color = match[2].match(/^(#[\da-f]+|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]+)/i)?.[1];
  const widths = [...match[2].matchAll(/([\d.]+)px/g)].map((entry) => Number(entry[1]));
  if (!color || widths.length < 2) return null;
  return { angle: Number(match[1]) * Math.PI / 180, color, width: widths[0], spacing: widths.at(-1) };
}

function drawHatch(context, style, x, y, width, height) {
  const spec = hatchSpec(style);
  if (!spec) return;
  context.save?.();
  shapePath(context, "polygon", x, y, width, height);
  context.clip?.();
  context.translate?.(x, y);
  context.rotate?.(spec.angle);
  const extent = Math.max(width, height) * 2;
  context.strokeStyle = spec.color;
  context.lineWidth = spec.width;
  for (let offset = -extent; offset <= extent; offset += Math.max(1, spec.spacing)) {
    context.beginPath();
    context.moveTo(-extent, offset);
    context.lineTo(extent, offset);
    context.stroke();
  }
  context.restore?.();
}

function drawBands(context, bands, x, y, width, height, opacity) {
  for (const band of bands || []) {
    const size = Math.max(0, Math.min(1, Number(band.size)));
    if (!band.color || size <= 0) continue;
    shapePath(context, "polygon", x, y, width * size, height * size);
    context.fillStyle = band.color;
    context.globalAlpha = opacity * (Number.isFinite(band.opacity) ? band.opacity : 1);
    context.fill?.();
  }
}

function drawSymbol(context, part, x, y, font, geometry, scale, opacity) {
  const shape = part.shape || "polygon";
  const symbolWidth = geometry.width;
  const symbolHeight = geometry.height;
  const fill = part.fill ?? "transparent";
  const stroke = part.stroke ?? "transparent";
  const fillOpacity = Number.isFinite(part.fillOpacity) ? part.fillOpacity : (Number.isFinite(part.opacity) ? part.opacity : 1);
  const strokeOpacity = Number.isFinite(part.strokeOpacity) ? part.strokeOpacity : 1;
  context.save?.();
  context.globalAlpha = opacity;
  context.shadowColor = "transparent";
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  context.shadowBlur = 0;
  if (shape === "shelter") {
    paintShelterSymbol(context, { cx: x, cy: y, bodyWidthPx: symbolWidth, bodyColor: fill, separatorPx: scale });
    context.restore?.();
    return;
  }
  if (shape === "line") {
    const dash = part.dash && (Array.isArray(part.dash) ? part.dash : part.dash.array);
    const dashScale = part.carrier ? 0.5 : 1.5;
    const swatchScale = geometry.swatchScale || 1;
    const dashArray = dash?.length ? dash.map((value) => Math.max(2, Math.round(Number(value) * dashScale)) * swatchScale) : [];
    if (part.segmentedCarrier && part.carrier) {
      // Match the GIS CSS swatch: equal-height alternating fills and a 1px rim.
      const left = x - symbolWidth / 2;
      const top = y - symbolHeight / 2;
      if (part.halo && part.halo !== "transparent") {
        context.strokeStyle = part.halo;
        context.globalAlpha = opacity * strokeOpacity * 0.35;
        context.lineWidth = swatchScale;
        context.strokeRect(left - swatchScale / 2, top - swatchScale / 2, symbolWidth + swatchScale, symbolHeight + swatchScale);
      }
      context.globalAlpha = opacity * strokeOpacity;
      context.fillStyle = part.carrier;
      context.fillRect(left, top, symbolWidth, symbolHeight);
      context.fillStyle = stroke;
      const on = dashArray[0] || symbolWidth;
      const period = on + (dashArray[1] || 0);
      for (let offset = 0; offset < symbolWidth; offset += period) {
        context.fillRect(left + offset, top, Math.min(on, symbolWidth - offset), symbolHeight);
      }
      context.restore?.();
      return;
    }
    context.beginPath();
    context.moveTo(x - symbolWidth / 2, y);
    context.lineTo(x + symbolWidth / 2, y);
    if (part.carrier) {
      context.strokeStyle = part.carrier;
      context.globalAlpha = opacity * strokeOpacity;
      context.lineWidth = Math.max(2, (Number(part.strokeWidth) || 1) + 2);
      context.setLineDash?.([]);
      context.stroke();
      context.beginPath();
      context.moveTo(x - symbolWidth / 2, y);
      context.lineTo(x + symbolWidth / 2, y);
    }
    context.strokeStyle = stroke || fill;
    context.globalAlpha = opacity * strokeOpacity;
    context.lineWidth = part.gisLineSwatch ? symbolHeight : Math.max(2, Number(part.strokeWidth) || 1);
    if (part.strokeGradient?.length) {
      const gradient = context.createLinearGradient(x, y - context.lineWidth / 2, x, y + context.lineWidth / 2);
      for (const { offset, color } of part.strokeGradient) gradient.addColorStop(offset, color);
      context.strokeStyle = gradient;
    }
    context.setLineDash?.(dashArray);
    if (part.halo && part.halo !== "transparent") {
      context.shadowColor = part.halo;
      context.shadowBlur = Number.isFinite(part.haloBlur) ? Math.max(0, part.haloBlur) * swatchScale : scale;
    }
    context.stroke();
    context.setLineDash?.([]);
  } else if (part.captivityBleed) {
    const r = Math.min(symbolWidth, symbolHeight) / 2;
    paintCaptivityBleedMarker(context, { cx: x, cy: y, r });
  } else {
    shapePath(context, shape, x, y, symbolWidth, symbolHeight);
    if (Array.isArray(part.bands) && part.bands.length > 0) {
      drawBands(context, part.bands, x, y, symbolWidth, symbolHeight, opacity);
    } else {
      context.fillStyle = fill;
      context.globalAlpha = opacity * fillOpacity;
      context.fill?.();
    }
    context.strokeStyle = stroke;
    context.globalAlpha = opacity * strokeOpacity;
    context.lineWidth = Number(part.strokeWidth) || 1;
    context.stroke?.();
    if (part.hatchStyle) drawHatch(context, part.hatchStyle, x, y, symbolWidth, symbolHeight);
    if (part.hatchStyle2) drawHatch(context, part.hatchStyle2, x, y, symbolWidth, symbolHeight);
  }
  if (part.alarmShockwave) {
    context.globalAlpha = opacity * 0.4;
    context.strokeStyle = part.alarmShockwaveColor || fill || "transparent";
    context.lineWidth = 1.6;
    context.beginPath();
    context.arc(x, y, Math.max(symbolWidth, symbolHeight) / 2 + font * 0.28, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore?.();
}

function drawPlacement(context, placement, font, scale, fontStack, opacity = 1) {
  const label = placement.labelGeometry;
  context.fillStyle = INK;
  context.globalAlpha = opacity;
  context.font = `${font}px ${fontStack || FONT}`;
  context.direction = label.direction;
  context.textAlign = label.align;
  context.textBaseline = "alphabetic";
  context.letterSpacing = "0px";
  setShadow(context, scale);
  placement.labelLines.forEach((line, index) => context.fillText(line, label.x, label.y + label.lineHeight * index));
  for (const component of placement.symbolGeometry.components) {
    drawSymbol(context, component.part, component.x, component.y, font, component, scale, opacity);
  }
}

export function createProjectionLegendAdapter({ canvasFactory, rasterScale = 1, onInvalidate,
  now = () => performance.now(), requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  motionMode = () => requestFrame ? resolveMotionMode() : "reduced",
} = {}) {
  const canvas = makeCanvas(canvasFactory);
  const context = canvas.getContext?.("2d");
  if (!context) throw new Error("projection legend adapter requires a 2d canvas");
  let snapshot = null;
  let layout = {};
  let dirty = true;
  let disposed = false;
  let signature = null;
  let contentVersion = 0;
  let rasterSize = { width: canvas.width, height: canvas.height };
  const motion = createLegendMotion({ now, motionMode, interpolateData: interpolateLegendPlacement });
  let frame = null, wasMoving = false;

  const scheduleFrame = () => {
    if (disposed || frame != null || !requestFrame || !motion.sample().moving) return;
    frame = requestFrame(() => {
      frame = null;
      if (disposed) return;
      dirty = true;
      onInvalidate?.();
      scheduleFrame();
    });
  };

  const planFor = (source, sourceLayout, size) => {
    if (source.contentLayout) return source.contentLayout;
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    context.font = `${Number(sourceLayout.fontPx) || 22}px ${FONT}`;
    context.letterSpacing = "0px";
    return layoutProjectionLegend({ blocks: source.blocks || [], width: size.width, height: size.height,
      fontPx: Number(sourceLayout.fontPx) || 22, columns: sourceLayout.columns, language: source.language === "en" ? "en" : "he",
      measureText: (text) => context.measureText?.(text) || {} });
  };

  const sync = (next = {}) => {
    if (disposed) return;
    snapshot = next.snapshot || next;
    layout = snapshot.layout || layout;
    const size = resolveLegendRasterSize(layout);
    const fontStyle = snapshot.fontStyle || null;
    const nextPlan = planFor(snapshot, layout, size);
    const nextSignature = JSON.stringify([snapshot.language, fontStyle?.fontFamily || "", fontStyle?.canvasFontStack || "",
      snapshot.blocks, snapshot.pages, snapshot.pageIndex, Number(layout.fontPx) || 22,
      size.width, size.height, Number(layout.columns) || 0, nextPlan, Number(snapshot.fontRevision) || 0]);
    const visible = snapshot.visible !== false && snapshot.spanId !== "right" && snapshot.layout?.visible !== false;
    motion.update((nextPlan.placements || []).map(placement => ({
      id: `${placement.packId}:${placement.itemId}`, x: placement.x * nextPlan.scale, y: placement.y * nextPlan.scale,
      scale: nextPlan.scale, data: { placement, fitScale: nextPlan.scale,
        font: Number(layout.fontPx) || 22, fontStack: fontStyle?.canvasFontStack },
    })), { visible, immediate: snapshot.editing === true || snapshot.spanId === "right" });
    scheduleFrame();
    if (nextSignature === signature) return;
    signature = nextSignature;
    rasterSize = size;
    if (canvas.width !== size.width * rasterScale || canvas.height !== size.height * rasterScale) {
      canvas.width = size.width * rasterScale;
      canvas.height = size.height * rasterScale;
    }
    dirty = true;
  };

  const draw = () => {
    if (disposed || !snapshot || snapshot.spanId === "right") return null;
    const state = motion.sample();
    if (state.opacity === 0 && !state.moving) return null;
    if (dirty || state.moving || wasMoving) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.save?.();
      context.scale?.(rasterScale, rasterScale);
      for (const row of state.rows) {
        const { placement, font, fontStack } = row.data;
        context.save?.();
        context.translate?.(row.x - placement.x * row.scale, row.y - placement.y * row.scale);
        context.scale?.(row.scale, row.scale);
        drawPlacement(context, placement, font, row.scale * rasterScale, fontStack, row.opacity);
        context.restore?.();
      }
      context.restore?.();
      dirty = false;
      contentVersion += 1;
    }
    wasMoving = state.moving;
    const rasterWidthPct = rasterSize.width / OUTPUT_WIDTH * 100;
    const rasterHeightPct = rasterSize.height / OUTPUT_HEIGHT * 100;
    const paintLayout = { ...layout, leftPct: layout.leftPct + (layout.widthPct - rasterWidthPct) / 2,
      topPct: layout.topPct + (layout.heightPct - rasterHeightPct) / 2, widthPct: rasterWidthPct, heightPct: rasterHeightPct };
    return { source: canvas, contentVersion, matrix: projectionOverlayMatrix(paintLayout), opacity: state.opacity };
  };

  return {
    canvas,
    sync,
    draw,
    dispose() {
      disposed = true;
      if (frame != null) cancelFrame?.(frame);
      frame = null;
      motion.clear();
      context.clearRect(0, 0, canvas.width, canvas.height);
      snapshot = null;
    },
  };
}

export { projectionOverlayMatrix as matrixFor };
