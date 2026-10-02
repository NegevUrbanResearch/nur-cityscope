import { OUTPUT_HEIGHT, OUTPUT_WIDTH, projectionOverlayMatrix } from "./projection-overlay-placement.js";
import { paintCaptivityBleedMarker } from "../shared/captivity-bleed-marker.js";
import { PROJECTION_LEGEND_FONT as FONT, layoutProjectionLegend, resolveLegendRasterSize } from "./legend-content-layout.js";

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

function drawBands(context, bands, x, y, width, height) {
  for (const band of bands || []) {
    const size = Math.max(0, Math.min(1, Number(band.size)));
    if (!band.color || size <= 0) continue;
    shapePath(context, "polygon", x, y, width * size, height * size);
    context.fillStyle = band.color;
    context.globalAlpha = Number.isFinite(band.opacity) ? band.opacity : 1;
    context.fill?.();
  }
}

function drawSymbol(context, part, x, y, font, geometry, scale) {
  const shape = part.shape || "polygon";
  const symbolWidth = geometry.width;
  const symbolHeight = geometry.height;
  const fill = part.fill ?? "transparent";
  const stroke = part.stroke ?? "transparent";
  const fillOpacity = Number.isFinite(part.fillOpacity) ? part.fillOpacity : (Number.isFinite(part.opacity) ? part.opacity : 1);
  const strokeOpacity = Number.isFinite(part.strokeOpacity) ? part.strokeOpacity : 1;
  context.save?.();
  context.shadowColor = "transparent";
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
  context.shadowBlur = 0;
  if (shape === "line") {
    const dash = part.dash && (Array.isArray(part.dash) ? part.dash : part.dash.array);
    const dashScale = part.carrier ? 0.5 : 1.5;
    const dashArray = dash?.length ? dash.map((value) => Math.max(2, Math.round(Number(value) * dashScale))) : [];
    context.beginPath();
    context.moveTo(x - symbolWidth / 2, y);
    context.lineTo(x + symbolWidth / 2, y);
    if (part.carrier) {
      context.strokeStyle = part.carrier;
      context.globalAlpha = strokeOpacity;
      context.lineWidth = Math.max(2, (Number(part.strokeWidth) || 1) + 2);
      context.setLineDash?.([]);
      context.stroke();
      context.beginPath();
      context.moveTo(x - symbolWidth / 2, y);
      context.lineTo(x + symbolWidth / 2, y);
    }
    context.strokeStyle = stroke || fill;
    context.globalAlpha = strokeOpacity;
    context.lineWidth = Math.max(2, Number(part.strokeWidth) || 1);
    context.setLineDash?.(dashArray);
    if (part.halo && part.halo !== "transparent") { context.shadowColor = part.halo; context.shadowBlur = scale; }
    context.stroke();
    context.setLineDash?.([]);
  } else if (part.captivityBleed) {
    const r = Math.min(symbolWidth, symbolHeight) / 2;
    paintCaptivityBleedMarker(context, { cx: x, cy: y, r });
  } else {
    shapePath(context, shape, x, y, symbolWidth, symbolHeight);
    if (Array.isArray(part.bands) && part.bands.length > 0) {
      drawBands(context, part.bands, x, y, symbolWidth, symbolHeight);
    } else {
      context.fillStyle = fill;
      context.globalAlpha = fillOpacity;
      context.fill?.();
    }
    context.strokeStyle = stroke;
    context.globalAlpha = strokeOpacity;
    context.lineWidth = Number(part.strokeWidth) || 1;
    context.stroke?.();
    if (part.hatchStyle) drawHatch(context, part.hatchStyle, x, y, symbolWidth, symbolHeight);
    if (part.hatchStyle2) drawHatch(context, part.hatchStyle2, x, y, symbolWidth, symbolHeight);
  }
  if (part.alarmShockwave) {
    context.globalAlpha = 0.4;
    context.strokeStyle = part.alarmShockwaveColor || fill || "transparent";
    context.lineWidth = 1.6;
    context.beginPath();
    context.arc(x, y, Math.max(symbolWidth, symbolHeight) / 2 + font * 0.28, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore?.();
}

function drawPlacement(context, placement, font, scale) {
  const label = placement.labelGeometry;
  context.fillStyle = INK;
  context.font = `${font}px ${FONT}`;
  context.direction = label.direction;
  context.textAlign = label.align;
  context.textBaseline = "alphabetic";
  context.letterSpacing = "0px";
  setShadow(context, scale);
  placement.labelLines.forEach((line, index) => context.fillText(line, label.x, label.y + label.lineHeight * index));
  for (const component of placement.symbolGeometry.components) {
    drawSymbol(context, component.part, component.x, component.y, font, component, scale);
  }
}

export function createProjectionLegendAdapter({ canvasFactory } = {}) {
  const canvas = makeCanvas(canvasFactory);
  const context = canvas.getContext?.("2d");
  if (!context) throw new Error("projection legend adapter requires a 2d canvas");
  let snapshot = null;
  let layout = {};
  let dirty = true;
  let disposed = false;
  let signature = null;
  let contentVersion = 0;
  let contentLayout = null;
  let rasterSize = { width: canvas.width, height: canvas.height };

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
    const nextPlan = planFor(snapshot, layout, size);
    const nextSignature = JSON.stringify([snapshot.language, snapshot.blocks, snapshot.pages, snapshot.pageIndex, Number(layout.fontPx) || 22,
      size.width, size.height, Number(layout.columns) || 0, nextPlan, Number(snapshot.fontRevision) || 0]);
    if (nextSignature === signature) return;
    signature = nextSignature;
    contentLayout = nextPlan;
    rasterSize = size;
    if (canvas.width !== size.width || canvas.height !== size.height) {
      canvas.width = size.width;
      canvas.height = size.height;
    }
    dirty = true;
  };

  const draw = () => {
    if (disposed || !snapshot || snapshot.visible === false || snapshot.spanId === "right" || snapshot.layout?.visible === false) return null;
    if (dirty) {
      context.clearRect(0, 0, canvas.width, canvas.height);
      const font = Number(layout.fontPx) || 22;
      const scale = Number(contentLayout?.scale) || 1;
      context.save?.();
      context.scale?.(scale, scale);
      for (const placement of contentLayout?.placements || []) drawPlacement(context, placement, font, scale);
      context.restore?.();
      dirty = false;
      contentVersion += 1;
    }
    const rasterWidthPct = rasterSize.width / OUTPUT_WIDTH * 100;
    const rasterHeightPct = rasterSize.height / OUTPUT_HEIGHT * 100;
    const paintLayout = { ...layout, leftPct: layout.leftPct + (layout.widthPct - rasterWidthPct) / 2,
      topPct: layout.topPct + (layout.heightPct - rasterHeightPct) / 2, widthPct: rasterWidthPct, heightPct: rasterHeightPct };
    return { source: canvas, contentVersion, matrix: projectionOverlayMatrix(paintLayout) };
  };

  return {
    canvas,
    sync,
    draw,
    dispose() {
      disposed = true;
      context.clearRect(0, 0, canvas.width, canvas.height);
      snapshot = null;
    },
  };
}

export { projectionOverlayMatrix as matrixFor };
