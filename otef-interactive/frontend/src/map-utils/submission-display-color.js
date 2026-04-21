/**
 * Canonical allowlist (24 saturated hues). Order is stable API surface.
 * Must stay in sync with `supabase/migrations/20260419203000_submission_display_color_palette_v5_readability.sql`
 * (CHECK constraint + `submit_unified_submission_write` palette array + legacy row migration map).
 */
export const SUBMISSION_DISPLAY_COLOR_PALETTE = [
  "#DC2626",
  "#EA580C",
  "#EAB308",
  "#65A30D",
  "#16A34A",
  "#059669",
  "#0D9488",
  "#06B6D4",
  "#0284C7",
  "#2563EB",
  "#4338CA",
  "#6D28D9",
  "#A855F7",
  "#C026D3",
  "#F472B6",
  "#FB923C",
  "#0C4A6E",
  "#3F3F46",
  "#B45309",
  "#15803D",
  "#581C87",
  "#1E40AF",
  "#155E75",
  "#78716C",
];

/**
 * Cross-hue partners for dual-dash proposed lines (not tints of the primary). Index aligns with
 * `SUBMISSION_DISPLAY_COLOR_PALETTE`. DB stores primary only; secondaries need not be unique across
 * slots and may repeat a palette primary as the partner stroke.
 */
export const SUBMISSION_DISPLAY_COLOR_SECONDARY = [
  "#22D3EE",
  "#2563EB",
  "#DB2777",
  "#C026D3",
  "#9333EA",
  "#EA580C",
  "#FB923C",
  "#F97316",
  "#FBBF24",
  "#FB7185",
  "#84CC16",
  "#FACC15",
  "#CA8A04",
  "#14B8A6",
  "#FDE047",
  "#6366F1",
  "#38BDF8",
  "#FBBF24",
  "#3B82F6",
  "#EC4899",
  "#34D399",
  "#FDE047",
  "#F472B6",
  "#F59E0B",
];

const ALLOW = new Set(SUBMISSION_DISPLAY_COLOR_PALETTE.map((h) => h.toUpperCase()));

/** Canonical CSS `#RRGGBB` (six hex digits, leading `#`). */
export const CSS_HEX_6_RE = /^#[0-9A-Fa-f]{6}$/;

/**
 * Normalize a submission display color to uppercase `#RRGGBB`, or null if invalid.
 * `null` / `undefined` yield null; other values are coerced with `String` (never throws on trim).
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function normalizeSubmissionDisplayColorHex(raw) {
  if (raw == null) return null;
  const t = String(raw).trim();
  if (!CSS_HEX_6_RE.test(t)) return null;
  return `#${t.slice(1).toUpperCase()}`;
}

/**
 * True when `raw` normalizes to a value in {@link SUBMISSION_DISPLAY_COLOR_PALETTE}.
 * `null` / `undefined` yield false.
 *
 * @param {unknown} raw
 * @returns {boolean}
 */
export function isAllowedSubmissionDisplayColor(raw) {
  if (raw == null) return false;
  const n = normalizeSubmissionDisplayColorHex(raw);
  return n !== null && ALLOW.has(n);
}

/**
 * Secondary (partner) stroke hex for a palette primary, or null if `raw` is not a palette primary.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
export function secondaryHexForPrimaryNormalized(raw) {
  const n = normalizeSubmissionDisplayColorHex(raw);
  if (n === null) return null;
  const i = SUBMISSION_DISPLAY_COLOR_PALETTE.findIndex((h) => h.toUpperCase() === n);
  if (i < 0) return null;
  return SUBMISSION_DISPLAY_COLOR_SECONDARY[i].toUpperCase();
}
