import { OUTPUT_HEIGHT, OUTPUT_WIDTH, projectionOverlayMatrix } from "./projection-overlay-placement.js";

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

function drawGroup(context, group, startY, width, height, font, direction) {
  const paddingX = font * 0.5;
  const columnGap = font * 0.64;
  const columnWidth = (width - paddingX * 2 - columnGap) / 2;
  const titleFont = font * 0.55;
  const titleLine = titleFont * 1.35;
  const titleDirection = textDirection(group.name, direction);
  const titleX = titleDirection === "rtl" ? width - paddingX : paddingX;
  context.font = `600 ${titleFont}px ${FONT}`;
  context.fillStyle = SUB;
  context.direction = titleDirection;
  context.textAlign = titleDirection === "rtl" ? "right" : "left";
  context.textBaseline = "alphabetic";
  setShadow(context);
  context.fillText(group.name || "", titleX, startY + lineBoxBaseline(context, group.name || "", titleFont, titleLine));
  let y = startY + titleLine + titleFont * 0.55;
  const items = group.items || [];
  for (let index = 0; index < items.length; index += 2) {
    const row = items.slice(index, index + 2);
    const measured = row.map((item) => {
      const parts = components(item);
      const symbols = symbolMetrics(parts, font);
      const labelWidth = Math.max(1, columnWidth - symbols.width - font * 0.36);
      context.font = `${font}px ${FONT}`;
      const label = String(item.label || "");
      const labelBoxWidth = Math.min(labelWidth, Math.max(1, textWidth(context, label, font * 0.01)));
      return { item, parts, symbols, lines: wrapLabel(context, label, labelWidth, font * 0.01), labelBoxWidth };
    });
    const rowHeight = Math.max(font * 1.14, ...measured.map(({ lines }) => lines.length * font * 1.35)) + font * 0.64;
    measured.forEach(({ item, parts, symbols, lines, labelBoxWidth }, rowIndex) => {
      const visualColumn = direction === "rtl" ? 1 - rowIndex : rowIndex;
      const columnLeft = paddingX + visualColumn * (columnWidth + columnGap);
      const top = y + font * 0.32;
      const labelDirection = textDirection(item.label, direction);
      const slotLeft = direction === "rtl" ? columnLeft + columnWidth - symbols.width : columnLeft;
      const labelLeft = direction === "rtl" ? slotLeft - font * 0.36 - labelBoxWidth : slotLeft + symbols.width + font * 0.36;
      const labelRight = direction === "rtl" ? slotLeft - font * 0.36 : labelLeft + labelBoxWidth;
      const textX = labelDirection === "rtl" ? labelRight : labelLeft;
      let cursor = direction === "rtl" ? slotLeft + symbols.width : slotLeft;
      const symbolTop = top + font * 0.18;
      const slotFree = symbols.height;
      symbols.children.forEach(({ part, width: partWidth, height: partHeight, margin, marginTop }) => {
        const partX = direction === "rtl"
          ? (cursor -= margin) - partWidth / 2
          : (cursor += margin) + partWidth / 2;
        const partY = symbolTop + (slotFree - marginTop - partHeight) / 2 + marginTop + partHeight / 2;
        drawSymbol(context, part, partX, partY, font);
        if (direction === "rtl") cursor -= partWidth + margin + symbols.gap;
        else cursor += partWidth + margin + symbols.gap;
      });
      drawLabel(context, lines, textX, top + font, font, labelDirection);
    });
    y += rowHeight;
  }
  return Math.min(height, y + font * 0.35);
}

export function createProjectionLegendAdapter({ canvasFactory } = {}) {
  const canvas = makeCanvas(canvasFactory);
  const context = canvas.getContext?.("2d");
  if (!context) throw new Error("projection legend adapter requires a 2d canvas");
  let snapshot = null;
  let layout = {};
  let dirty = true;
  let disposed = false;

  const sync = (next = {}) => {
    if (disposed) return;
    snapshot = next.snapshot || next;
    layout = snapshot.layout || layout;
    const size = localSize(layout);
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
      let y = font * 0.4;
      for (const group of groups) y = drawGroup(context, group, y, canvas.width, canvas.height, font, direction);
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
    }
    return { source: canvas, matrix: projectionOverlayMatrix(layout) };
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
