import { OUTPUT_HEIGHT, OUTPUT_WIDTH, projectionOverlayMatrix } from "./projection-overlay-placement.js";
import { paintCaptivityBleedMarker } from "../shared/captivity-bleed-marker.js";

const FONT = '"Guttman Hatzvi", "Noto Sans Hebrew", Arial, sans-serif';
const INK = "#f2f3f4";
const SUB = "#bbc2c6";

function makeCanvas(factory) {
  const canvas = factory?.() || globalThis.document?.createElement?.("canvas");
  if (!canvas) throw new Error("projection legend adapter requires canvas support");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_HEIGHT;
  return canvas;
}

function localSize(layout) {
  return {
    width: Math.max(1, Math.round(OUTPUT_WIDTH * (Number(layout?.widthPct) || 100) / 100)),
    height: Math.max(1, Math.round(OUTPUT_HEIGHT * (Number(layout?.heightPct) || 100) / 100)),
  };
}

function components(item) {
  if (item?.components?.length) return item.components;
  if (item?.strokeSwatches?.length) {
    return item.strokeSwatches.map((swatch) => ({ ...item, ...swatch, stroke: swatch.color }));
  }
  return [item || {}];
}

function textDirection(value, fallback) {
  const text = String(value || "");
  if ([...text].some((character) => /[\u0590-\u08ff]/u.test(character))) return "rtl";
  if ([...text].some((character) => /[A-Za-z\u00c0-\u024f]/u.test(character))) return "ltr";
  return fallback;
}

function glyphWidth(shape, font) {
  return shape === "point" || shape === "square" ? font * 0.55 : shape === "diamond" ? font * 0.45 : font * 1.23;
}

function glyphHeight(part, font) {
  return part.shape === "line" ? Math.max(2, Number(part.strokeWidth) || 1) : part.shape === "point" || part.shape === "square" ? font * 0.55 : part.shape === "diamond" ? font * 0.45 : font * 0.68;
}

function symbolMetrics(parts, font) {
  const gap = font * 0.18;
  const children = parts.map((part) => {
    const shape = part.shape || "polygon";
    const margin = shape === "point" || shape === "square" ? font * 0.32 : shape === "diamond" ? font * 0.36 : 0;
    const marginTop = shape === "point" || shape === "square" ? font * 0.09 : shape === "diamond" ? font * 0.14 : shape === "line" ? font * 0.27 : 0;
    return { part, width: glyphWidth(shape, font), height: glyphHeight(part, font), margin, marginTop };
  });
  const naturalWidth = children.reduce((sum, child) => sum + child.width + child.margin * 2, 0) + Math.max(0, children.length - 1) * gap;
  const slotWidth = Math.max(font * 1.23, naturalWidth);
  const slotHeight = Math.max(0, ...children.map((child) => child.marginTop + child.height));
  return { children, gap, width: slotWidth, height: slotHeight };
}

function textWidth(context, value, letterSpacing) {
  return (context.measureText?.(value).width || value.length * 8) + Math.max(0, value.length - 1) * letterSpacing;
}

function lineBoxBaseline(context, text, font, lineHeight) {
  const metrics = context.measureText?.(text) || {};
  const actualAscent = Number(metrics.actualBoundingBoxAscent) || font * 0.8;
  const ascent = Number(metrics.fontBoundingBoxAscent) || actualAscent;
  const descent = Number(metrics.fontBoundingBoxDescent) || Number(metrics.actualBoundingBoxDescent) || font * 0.2;
  return (lineHeight - ascent - descent) / 2 + ascent;
}

function setShadow(context) {
  context.shadowColor = "rgba(0, 0, 0, 0.85)";
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 2;
  context.shadowBlur = 8;
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

function drawSymbol(context, part, x, y, font) {
  const shape = part.shape || "polygon";
  const symbolWidth = shape === "point" ? font * 0.55 : shape === "square" ? font * 0.55 : shape === "diamond" ? font * 0.45 : font * 1.23;
  const symbolHeight = shape === "line" ? Math.max(2, Number(part.strokeWidth) || 1) : shape === "point" || shape === "square" ? font * 0.55 : shape === "diamond" ? font * 0.45 : font * 0.68;
  const fill = part.fill ?? "transparent";
  const stroke = part.stroke ?? "transparent";
  const fillOpacity = Number.isFinite(part.fillOpacity) ? part.fillOpacity : (Number.isFinite(part.opacity) ? part.opacity : 1);
  const strokeOpacity = Number.isFinite(part.strokeOpacity) ? part.strokeOpacity : 1;
  context.save?.();
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
    if (part.halo && part.halo !== "transparent") { context.shadowColor = part.halo; context.shadowBlur = 1; }
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
  return { width: symbolWidth, height: symbolHeight };
}

function wrapLabel(context, text, maxWidth, letterSpacing = 0) {
  const value = String(text || "");
  const words = value.split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let line = "";
  const widthOf = (value) => (context.measureText?.(value).width || value.length * 8) + Math.max(0, value.length - 1) * letterSpacing;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && widthOf(candidate) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

function drawLabel(context, lines, x, y, font, direction) {
  context.fillStyle = INK;
  context.font = `${font}px ${FONT}`;
  context.direction = direction;
  context.textAlign = direction === "rtl" ? "right" : "left";
  context.textBaseline = "alphabetic";
  context.letterSpacing = `${font * 0.01}px`;
  setShadow(context);
  const lineHeight = font * 1.35;
  lines.forEach((line, index) => context.fillText(line, x, y + lineHeight * index));
  return Math.max(1, lines.length) * lineHeight;
}

function measureItem(context, item, font) {
  const parts = components(item);
  const symbols = symbolMetrics(parts, font);
  const label = String(item.label || "");
  context.font = `${font}px ${FONT}`;
  const labelBoxWidth = Math.max(1, textWidth(context, label, font * 0.01));
  return {
    item,
    parts,
    symbols,
    label,
    labelBoxWidth,
    width: symbols.width + font * 0.36 + labelBoxWidth,
    height: Math.max(font * 1.14, symbols.height, font * 1.35),
  };
}

function paintItem(context, box, slotLeft, top, font, panelDirection, innerPanelWidth) {
  const labelDirection = textDirection(box.label, panelDirection);
  const slotFree = box.symbols.height;
  const symbolTop = top + font * 0.18;
  let cursor = panelDirection === "rtl" ? slotLeft + box.symbols.width : slotLeft;
  box.symbols.children.forEach(({ part, width: partWidth, height: partHeight, margin, marginTop }) => {
    const partX = panelDirection === "rtl"
      ? (cursor -= margin) - partWidth / 2
      : (cursor += margin) + partWidth / 2;
    const partY = symbolTop + (slotFree - marginTop - partHeight) / 2 + marginTop + partHeight / 2;
    drawSymbol(context, part, partX, partY, font);
    if (panelDirection === "rtl") cursor -= partWidth + margin + box.symbols.gap;
    else cursor += partWidth + margin + box.symbols.gap;
  });
  const labelLeft = panelDirection === "rtl" ? slotLeft - font * 0.36 - box.labelBoxWidth : slotLeft + box.symbols.width + font * 0.36;
  const labelRight = panelDirection === "rtl" ? slotLeft - font * 0.36 : labelLeft + box.labelBoxWidth;
  const textX = labelDirection === "rtl" ? labelRight : labelLeft;
  const lines = box.width >= innerPanelWidth
    ? wrapLabel(context, box.label, Math.max(1, innerPanelWidth - box.symbols.width - font * 0.36), font * 0.01)
    : [box.label || ""];
  drawLabel(context, lines, textX, top + font, font, labelDirection);
}

function drawGroup(context, group, startY, startX, groupWidth, height, font, direction) {
  const paddingX = font * 0.5;
  const innerLeft = startX + paddingX;
  const innerRight = startX + groupWidth - paddingX;
  const innerWidth = Math.max(1, innerRight - innerLeft);
  const titleFont = font * 0.55;
  const titleLine = titleFont * 1.35;
  const itemGap = font * 18 / 16;
  let y = startY;
  if (group.id !== "nli") {
    const titleDirection = textDirection(group.name, direction);
    const titleX = titleDirection === "rtl" ? innerRight : innerLeft;
    context.font = `600 ${titleFont}px ${FONT}`;
    context.fillStyle = SUB;
    context.direction = titleDirection;
    context.textAlign = titleDirection === "rtl" ? "right" : "left";
    context.textBaseline = "alphabetic";
    setShadow(context);
    context.fillText(group.name || "", titleX, startY + lineBoxBaseline(context, group.name || "", titleFont, titleLine));
    y = startY + titleLine + titleFont * 0.55;
  }
  const boxes = (group.items || []).map((item) => measureItem(context, item, font));
  let cursor = direction === "rtl" ? innerRight : innerLeft;
  let rowHeight = 0;
  const beginRow = () => {
    y += rowHeight;
    rowHeight = 0;
    cursor = direction === "rtl" ? innerRight : innerLeft;
  };
  for (const box of boxes) {
    const needed = Math.min(innerWidth, box.width);
    const remaining = direction === "rtl" ? cursor - innerLeft : innerRight - cursor;
    if (rowHeight > 0 && needed - remaining > 0.01) beginRow();
    const slotLeft = direction === "rtl" ? cursor - box.symbols.width : cursor;
    const top = y + font * 0.32;
    const painted = box.width > innerWidth
      ? { ...box, labelBoxWidth: Math.max(1, innerWidth - box.symbols.width - font * 0.36), width: innerWidth }
      : box;
    paintItem(context, painted, slotLeft, top, font, direction, innerWidth);
    const step = painted.width + itemGap;
    cursor = direction === "rtl" ? cursor - step : cursor + step;
    rowHeight = Math.max(rowHeight, painted.height + font * 0.64);
  }
  return Math.min(height, y + rowHeight + font * 0.35);
}

function groupNaturalWidth(context, group, font) {
  const paddingX = font * 0.5;
  const itemGap = font * 18 / 16;
  const boxes = (group.items || []).map((item) => measureItem(context, item, font));
  const itemsWidth = boxes.reduce((sum, box, index) => sum + box.width + (index ? itemGap : 0), 0);
  const titleWidth = group.id === "nli" ? 0 : Math.max(1, textWidth(context, group.name || "", (font * 0.55) * 0.01));
  return paddingX * 2 + Math.max(titleWidth, itemsWidth);
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

  const sync = (next = {}) => {
    if (disposed) return;
    snapshot = next.snapshot || next;
    layout = snapshot.layout || layout;
    const size = localSize(layout);
    const nextSignature = JSON.stringify([snapshot.language, snapshot.blocks, snapshot.pages, snapshot.pageIndex, Number(layout.fontPx) || 22, size.width, size.height]);
    if (nextSignature === signature) return;
    signature = nextSignature;
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
      const direction = snapshot.language === "en" ? "ltr" : "rtl";
      const groups = [];
      for (const block of snapshot.blocks || []) {
        const groupId = block.pack?.id || block.id;
        const prior = groups.at(-1);
        if (prior?.id === groupId) prior.items.push(...(block.layers || []).flatMap((layer) => layer.items || []));
        else groups.push({ id: groupId, name: block.pack?.name || "", items: (block.layers || []).flatMap((layer) => layer.items || []) });
      }
      const paddingX = font * 0.5;
      const packGap = font * 22 / 16;
      let y = font * 0.4;
      let x = direction === "rtl" ? canvas.width : 0;
      let rowHeight = 0;
      const rowStart = () => (direction === "rtl" ? canvas.width : 0);
      for (const group of groups) {
        const natural = Math.min(canvas.width, Math.max(paddingX * 2 + font, groupNaturalWidth(context, group, font)));
        const remaining = direction === "rtl" ? x : canvas.width - x;
        if (rowHeight > 0 && natural - remaining > 0.01) {
          y += rowHeight;
          rowHeight = 0;
          x = rowStart();
        }
        const groupWidth = Math.min(natural, direction === "rtl" ? x : canvas.width - x);
        const startX = direction === "rtl" ? x - groupWidth : x;
        const bottom = drawGroup(context, group, y, startX, groupWidth, canvas.height, font, direction);
        rowHeight = Math.max(rowHeight, bottom - y);
        x = direction === "rtl" ? startX - packGap : startX + groupWidth + packGap;
      }
      if ((snapshot.pages || []).length > 1) {
        context.fillStyle = SUB;
        context.font = "11px Arial";
        context.direction = "ltr";
        context.textAlign = direction === "rtl" ? "left" : "right";
        context.textBaseline = "alphabetic";
        context.shadowColor = "transparent";
        context.fillText(`${Number(snapshot.pageIndex || 0) + 1} / ${snapshot.pages.length}`, direction === "rtl" ? 5 : canvas.width - 5, canvas.height - 3);
      }
      dirty = false;
      contentVersion += 1;
    }
    return { source: canvas, contentVersion, matrix: projectionOverlayMatrix(layout) };
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
