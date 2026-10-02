import { clampNliExplainerLayout } from "./nli-explainer-overlay.js";

export const LEGEND_LAYOUT_DEFAULT = Object.freeze({
  leftPct: 26,
  topPct: 84,
  widthPct: 48,
  heightPct: 14,
  fontPx: 16,
  rotateDeg: 0,
  dwellSeconds: 8,
  columns: 0,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function normalizeLegendColumns(value) {
  return Number.isInteger(value) && value >= 0 && value <= 3 ? value : 0;
}

export function legendSpanKey(span) {
  return span === "left" || span === "right" ? span : "full";
}

export function clampLegendLayout(raw, fallback = LEGEND_LAYOUT_DEFAULT) {
  const base = fallback && typeof fallback === "object" ? fallback : LEGEND_LAYOUT_DEFAULT;
  const source = raw && typeof raw === "object" ? raw : {};
  const layout = clampNliExplainerLayout(source, base);
  const dwell = Number(source.dwellSeconds);
  return {
    ...layout,
    dwellSeconds: clamp(Number.isFinite(dwell) ? dwell : Number(base.dwellSeconds) || 8, 4, 30),
    columns: normalizeLegendColumns(source.columns),
  };
}

export function resolveLegendLayout({ settings, span = "full" } = {}) {
  const projection = settings?.projection && typeof settings.projection === "object"
    ? settings.projection
    : {};
  const key = legendSpanKey(span);
  const saved = projection[key] || (key === "full" ? null : projection.full);
  return clampLegendLayout(saved || LEGEND_LAYOUT_DEFAULT, LEGEND_LAYOUT_DEFAULT);
}
