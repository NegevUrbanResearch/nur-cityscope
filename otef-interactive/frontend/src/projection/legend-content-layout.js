import { OUTPUT_WIDTH, OUTPUT_HEIGHT } from "./projection-overlay-placement.js";

export const PROJECTION_LEGEND_FONT = '"Guttman Hatzvi", "Noto Sans Hebrew", Arial, sans-serif';

const PROJECTION_PADDING_X = 0.5;
const PROJECTION_PADDING_Y = 0.4;
const COLUMN_GAP = 0.75;
const ITEM_GAP = 0.3;
const PACK_GAP = 0.7;
const SYMBOL_LABEL_GAP = 0.36;
const FIT_EPSILON = 1e-6;

export function normalizeLegendComponents(item) {
  if (item?.components?.length) return item.components;
  if (item?.strokeSwatches?.length) {
    return item.strokeSwatches.map((swatch) => ({ ...item, ...swatch, stroke: swatch.color }));
  }
  return [item || {}];
}

function glyphWidth(shape, font) {
  return shape === "point" || shape === "square" ? font * 0.55 : shape === "diamond" ? font * 0.45 : font * 1.23;
}

function glyphHeight(part, font) {
  if (part.shape === "shelter") return font * 1.23 * .78;
  return part.shape === "line" ? Math.max(2, Number(part.strokeWidth) || 1) : part.shape === "point" || part.shape === "square" ? font * 0.55 : part.shape === "diamond" ? font * 0.45 : font * 0.68;
}

export function projectionLegendSymbolMetrics(parts, font) {
  const gap = font * 0.18;
  const children = parts.map((part) => {
    const shape = part.shape || "polygon";
    const margin = shape === "point" || shape === "square" ? font * 0.32 : shape === "diamond" ? font * 0.36 : 0;
    const marginTop = shape === "point" || shape === "square" ? font * 0.09 : shape === "diamond" ? font * 0.14 : shape === "line" ? font * 0.27 : 0;
    const width = glyphWidth(shape, font);
    const height = glyphHeight(part, font);
    // Diamond corners use the painter's default 90-degree miter join.
    const stroke = shape === "line"
      ? Math.max(2, (Number(part.strokeWidth) || 1) + (part.carrier ? 2 : 0)) / 2
      : part.captivityBleed ? Math.min(width, height) * 0.125 / 4 : Math.max(1, Number(part.strokeWidth) || 1) / (shape === "diamond" ? Math.SQRT2 : 2);
    const shockwaveRadius = part.alarmShockwave ? Math.max(width, height) / 2 + font * 0.28 + 0.8 : 0;
    const extentX = Math.max(stroke, shockwaveRadius - width / 2);
    const extentY = Math.max(stroke, shockwaveRadius - height / 2);
    const extent = Math.max(extentX, extentY);
    return { part, width, height, margin, marginTop, extent, extentX, extentY };
  });
  const naturalWidth = children.reduce((sum, child) => sum + child.width + child.margin * 2, 0)
    + Math.max(0, children.length - 1) * gap;
  const decoratedWidth = children.reduce((sum, child) => sum + child.width + child.margin * 2 + child.extentX * 2, 0)
    + Math.max(0, children.length - 1) * gap;
  const slotWidth = Math.max(font * 1.23, naturalWidth);
  const slotHeight = Math.max(0, ...children.map((child) => child.marginTop + child.height));
  const decoratedHeight = Math.max(0, ...children.map((child) => child.marginTop + child.height + child.extentY * 2));
  return { children, gap, width: slotWidth, outerWidth: Math.max(slotWidth, decoratedWidth), height: slotHeight, outerHeight: decoratedHeight };
}

function metricFor(text, measureText, font) {
  const value = String(text || "");
  const measured = measureText?.(value) || {};
  const width = Number.isFinite(measured.width) ? measured.width : [...value].length * font * 0.5;
  const left = Number.isFinite(measured.actualBoundingBoxLeft) ? measured.actualBoundingBoxLeft : 0;
  const right = Number.isFinite(measured.actualBoundingBoxRight) ? measured.actualBoundingBoxRight : width;
  const ascent = Number.isFinite(measured.actualBoundingBoxAscent) ? measured.actualBoundingBoxAscent : Number(measured.fontBoundingBoxAscent) || font;
  const descent = Number.isFinite(measured.actualBoundingBoxDescent) ? measured.actualBoundingBoxDescent : Number(measured.fontBoundingBoxDescent) || font * 0.3;
  return { width, left, right, ascent, descent, measured };
}

export function measureProjectionLegendLabel(text, measureText, fontPx) {
  return metricFor(text, measureText, fontPx);
}

function labelDirection(text, fallback) {
  for (const character of String(text || "")) {
    if (!/\p{Letter}/u.test(character)) continue;
    return /\p{Script=Hebrew}|\p{Script=Arabic}/u.test(character) ? "rtl" : "ltr";
  }
  return fallback;
}

// Metrics are measured with left alignment; right-aligned painting shifts ink by the advance width.
function labelEnvelope(metrics, direction = "ltr") {
  const left = Math.min(0, ...metrics.map((metric) => (direction === "rtl" ? -metric.width : 0) - metric.left));
  const right = Math.max(0, ...metrics.map((metric) => direction === "rtl" ? metric.right - metric.width : Math.max(metric.width, metric.right)));
  return { left, right, width: right - left };
}

function wrapLabel(text, maxWidth, measureLabel) {
  const words = String(text || "").split(/\s+/u).filter(Boolean);
  if (!words.length) return [""];
  const lines = [];
  let line = "";
  for (const word of words) {
    if (labelEnvelope([measureLabel(word)]).width > maxWidth + 1e-7) return null;
    const candidate = line ? `${line} ${word}` : word;
    if (line && labelEnvelope([measureLabel(candidate)]).width > maxWidth + 1e-7) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

function flattenBlocks(blocks) {
  const entries = [];
  let ordinal = 0;
  for (const block of blocks || []) {
    const packId = block?.pack?.id ?? block?.id ?? "";
    for (const layer of block?.layers || []) {
      for (const item of layer?.items || []) {
        const itemId = item?.id ?? item?.key ?? `${packId}:${layer?.id ?? "layer"}:${ordinal}`;
        entries.push({ item, itemId, packId, ordinal: ordinal++ });
      }
    }
  }
  return entries;
}

function measureItem(entry, fontPx, measureLabel) {
  const parts = normalizeLegendComponents(entry.item);
  const symbols = projectionLegendSymbolMetrics(parts, fontPx);
  const label = String(entry.item?.label || "");
  const labelMetrics = measureLabel(label);
  const unwrappedLabelWidth = labelEnvelope([labelMetrics]).width;
  const width = symbols.outerWidth + fontPx * SYMBOL_LABEL_GAP + unwrappedLabelWidth;
  const textHeight = Math.max(fontPx * 1.35, Math.max(fontPx, labelMetrics.ascent) + labelMetrics.descent);
  const height = Math.max(textHeight, symbols.outerHeight) + fontPx * 0.4;
  return { ...entry, parts, symbols, label, unwrappedLabelWidth, width, height };
}

function chunksFor(entries, columns) {
  const base = Math.floor(entries.length / columns);
  const extra = entries.length % columns;
  const chunks = [];
  let offset = 0;
  for (let column = 0; column < columns; column += 1) {
    const count = base + (column < extra ? 1 : 0);
    chunks.push(entries.slice(offset, offset + count));
    offset += count;
  }
  return chunks;
}

function placementFor(entry, column, x, y, columnWidth, lines, fontPx, panelDirection, measureLabel) {
  const labelMetrics = lines.map(measureLabel);
  const ascent = Math.max(fontPx, ...labelMetrics.map((metric) => metric.ascent));
  const descent = Math.max(0, ...labelMetrics.map((metric) => metric.descent));
  const lineHeight = Math.max(fontPx * 1.35, ascent + descent);
  const textHeight = lines.length * lineHeight;
  const contentHeight = Math.max(textHeight, entry.symbols.outerHeight);
  const height = contentHeight + fontPx * 0.4;
  const symbolX = panelDirection === "rtl" ? x + columnWidth - entry.symbols.outerWidth : x;
  const labelLeft = panelDirection === "rtl"
    ? x
    : symbolX + entry.symbols.outerWidth + fontPx * SYMBOL_LABEL_GAP;
  const labelMaxWidth = columnWidth - entry.symbols.outerWidth - fontPx * SYMBOL_LABEL_GAP;
  const direction = labelDirection(entry.label, panelDirection);
  const envelope = labelEnvelope(labelMetrics, direction);
  const labelX = direction === "rtl" ? labelLeft + labelMaxWidth - envelope.right : labelLeft - envelope.left;
  const baseline = y + fontPx * 0.2 + ascent;
  const components = [];
  let cursor = panelDirection === "rtl" ? symbolX + entry.symbols.outerWidth : symbolX;
  for (const child of entry.symbols.children) {
    let centerX;
    if (panelDirection === "rtl") {
      cursor -= child.margin + child.extentX;
      centerX = cursor - child.width / 2;
      cursor -= child.width + child.extentX + child.margin + entry.symbols.gap;
    } else {
      cursor += child.margin + child.extentX;
      centerX = cursor + child.width / 2;
      cursor += child.width + child.extentX + child.margin + entry.symbols.gap;
    }
    const centerY = y + fontPx * 0.2 + (contentHeight + child.marginTop) / 2;
    components.push({ part: child.part, x: centerX, y: centerY, width: child.width, height: child.height,
      extent: child.extent, extentX: child.extentX, extentY: child.extentY });
  }
  return {
    itemId: entry.itemId,
    packId: entry.packId,
    item: entry.item,
    column,
    x,
    y,
    width: columnWidth,
    height,
    labelLines: lines,
    labelDirection: direction,
    labelGeometry: {
      x: labelX,
      y: baseline,
      width: labelMaxWidth,
      height: textHeight,
      lineHeight,
      direction,
      align: direction === "rtl" ? "right" : "left",
      metrics: labelMetrics,
    },
    symbolGeometry: { x: symbolX, y: y + fontPx * 0.2, width: entry.symbols.outerWidth, height: entry.symbols.outerHeight, components },
  };
}

function paintedEdges(placement) {
  const label = placement.labelGeometry;
  const glyphs = label.metrics.map((metric, index) => {
    const offset = label.align === "right" ? -metric.width : 0;
    const baseline = label.y + index * label.lineHeight;
    return { left: label.x + offset - metric.left, right: label.x + offset + metric.right,
      top: baseline - metric.ascent, bottom: baseline + metric.descent };
  });
  const symbols = placement.symbolGeometry.components.map((component) => ({
    left: component.x - component.width / 2 - component.extentX,
    right: component.x + component.width / 2 + component.extentX,
    top: component.y - component.height / 2 - component.extentY,
    bottom: component.y + component.height / 2 + component.extentY,
  }));
  return [...glyphs, ...symbols];
}

function trial(entries, columns, width, height, fontPx, panelDirection, measureLabel) {
  const columnGap = fontPx * COLUMN_GAP;
  const paddingX = fontPx * PROJECTION_PADDING_X;
  const paddingY = fontPx * PROJECTION_PADDING_Y;
  const availableWidth = width - paddingX * 2 - columnGap * (columns - 1);
  const columnWidth = availableWidth / columns;
  if (!(columnWidth > 0)) return { fits: false };
  const chunks = chunksFor(entries, columns);
  const placements = [];
  let maxBottom = paddingY;
  const edges = [];
  for (let column = 0; column < columns; column += 1) {
    let y = paddingY;
    const x = panelDirection === "rtl"
      ? width - paddingX - columnWidth * (column + 1) - columnGap * column
      : paddingX + column * (columnWidth + columnGap);
    let priorPack = null;
    for (const entry of chunks[column]) {
      if (priorPack !== null && priorPack !== entry.packId) y += fontPx * PACK_GAP;
      const labelMaxWidth = columnWidth - entry.symbols.outerWidth - fontPx * SYMBOL_LABEL_GAP;
      if (labelMaxWidth < 0) return { fits: false };
      const lines = wrapLabel(entry.label, labelMaxWidth, measureLabel);
      if (!lines) return { fits: false };
      const placement = placementFor(entry, column, x, y, columnWidth, lines, fontPx, panelDirection, measureLabel);
      const painted = paintedEdges(placement);
      if (painted.some((edge) => edge.left < x - 1e-7 || edge.right > x + columnWidth + 1e-7
        || edge.top < y - 1e-7 || edge.bottom > y + placement.height + 1e-7)) return { fits: false };
      edges.push(...painted);
      placements.push(placement);
      y += placement.height + fontPx * ITEM_GAP;
      priorPack = entry.packId;
    }
    if (chunks[column].length) y -= fontPx * ITEM_GAP;
    maxBottom = Math.max(maxBottom, y);
  }
  const left = edges.length ? Math.min(...edges.map((edge) => edge.left)) : 0;
  const top = edges.length ? Math.min(...edges.map((edge) => edge.top)) : 0;
  const right = edges.length ? Math.max(...edges.map((edge) => edge.right)) : 0;
  const bottom = edges.length ? Math.max(...edges.map((edge) => edge.bottom)) : 0;
  const bounds = { x: left, y: top, width: right - left, height: bottom - top };
  return { fits: left >= -1e-7 && top >= -1e-7 && right <= width + 1e-7 && bottom <= height + 1e-7
    && maxBottom + paddingY <= height + 1e-7, placements, bounds, columnWidth };
}

function naturalBounds(entries, columns, fontPx) {
  const widest = Math.max(0, ...entries.map((entry) => entry.width));
  const naturalWidth = fontPx * PROJECTION_PADDING_X * 2 + columns * widest + (columns - 1) * fontPx * COLUMN_GAP;
  const chunks = chunksFor(entries, columns);
  const tallest = Math.max(0, ...chunks.map((chunk) => chunk.reduce((sum, entry, index) => {
    const packGap = index > 0 && entry.packId !== chunk[index - 1].packId ? fontPx * PACK_GAP : 0;
    return sum + entry.height + (index ? fontPx * ITEM_GAP : 0) + packGap;
  }, 0)));
  return { width: naturalWidth, height: fontPx * PROJECTION_PADDING_Y * 2 + tallest };
}

function layoutForCount(entries, columns, width, height, fontPx, panelDirection, measureLabel) {
  const first = trial(entries, columns, width, height, fontPx, panelDirection, measureLabel);
  if (first.fits) return { columns, scale: 1, placements: first.placements, paintBounds: first.bounds };
  const natural = naturalBounds(entries, columns, fontPx);
  let lower = Math.min(1, width / Math.max(1, natural.width), height / Math.max(1, natural.height)) * (1 - FIT_EPSILON);
  let lowerTrial = trial(entries, columns, width / lower, height / lower, fontPx, panelDirection, measureLabel);
  if (!lowerTrial.fits) {
    lower *= 0.5;
    lowerTrial = trial(entries, columns, width / lower, height / lower, fontPx, panelDirection, measureLabel);
  }
  if (!lowerTrial.fits) return null;
  let upper = 1;
  for (let count = 0; count < 10; count += 1) {
    const mid = (lower + upper) / 2;
    const candidate = trial(entries, columns, width / mid, height / mid, fontPx, panelDirection, measureLabel);
    if (candidate.fits) {
      lower = mid;
      lowerTrial = candidate;
    } else upper = mid;
  }
  return {
    columns,
    scale: lower,
    placements: lowerTrial.placements,
    paintBounds: {
      x: lowerTrial.bounds.x * lower,
      y: lowerTrial.bounds.y * lower,
      width: lowerTrial.bounds.width * lower,
      height: lowerTrial.bounds.height * lower,
    },
  };
}

// measureText must use left alignment, an alphabetic baseline, the shared font at fontPx, and zero letter spacing.
export function layoutProjectionLegend({ blocks, width, height, fontPx, columns = 0, language = "he", measureText }) {
  const boxWidth = Number(width);
  const boxHeight = Number(height);
  const font = Math.max(8, Math.min(64, Number(fontPx) || 22));
  const requestedColumns = Number(columns) === 1 || Number(columns) === 2 || Number(columns) === 3 ? Number(columns) : 0;
  if (!(boxWidth > 0) || !(boxHeight > 0)) throw new RangeError("projection legend box dimensions must be positive");
  const metrics = new Map();
  const measureLabel = (text) => {
    if (!metrics.has(text)) metrics.set(text, metricFor(text, measureText, font));
    return metrics.get(text);
  };
  const entries = flattenBlocks(blocks).map((entry) => measureItem(entry, font, measureLabel));
  const panelDirection = language === "en" ? "ltr" : "rtl";
  const counts = requestedColumns ? [requestedColumns] : [1, 2, 3];
  let best = null;
  for (const count of counts) {
    const result = layoutForCount(entries, count, boxWidth, boxHeight, font, panelDirection, measureLabel);
    if (result && (!best || result.scale > best.scale + 1e-12 || (Math.abs(result.scale - best.scale) <= 1e-12 && result.columns < best.columns))) best = result;
  }
  if (!best) throw new RangeError("projection legend items cannot fit the requested box");
  return { ...best, effectiveFontPx: font * best.scale };
}

export function resolveLegendRasterSize(layout) {
  return {
    width: Math.max(1, Math.floor(OUTPUT_WIDTH * (Number(layout?.widthPct) || 0) / 100)),
    height: Math.max(1, Math.floor(OUTPUT_HEIGHT * (Number(layout?.heightPct) || 0) / 100)),
  };
}
