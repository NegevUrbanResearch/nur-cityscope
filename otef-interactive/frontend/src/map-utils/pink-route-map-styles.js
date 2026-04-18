/**
 * Colab-aligned Leaflet polyline options for curated pink routes.
 * Numeric tokens from nur-colab-map `mapLineStyles.ts` and off-road from `pinkDetourLeaflet.ts`.
 */

/** @typedef {{ color?: string; weight?: number; opacity?: number; dashArray?: string; lineCap?: string; lineJoin?: string; pane?: string }} LeafletPolylineLike */

export const OFFICIAL_NETWORK_GAP_METERS = 28;

const VALID_CSS_HEX_6 = /^#[0-9A-Fa-f]{6}$/;

const PROPOSED_DEFAULT_COLOR = "#ff587b";

/** @param {string | null | undefined} displayColorHex */
function normalizedSixDigitHex(displayColorHex) {
  if (displayColorHex == null) return null;
  const raw = String(displayColorHex).trim();
  if (!VALID_CSS_HEX_6.test(raw)) return null;
  return `#${raw.slice(1).toUpperCase()}`;
}

/** @type {LeafletPolylineLike} */
const SOLID_LINE = {
  color: "#FF69B4",
  weight: 5,
  opacity: 0.9,
  lineCap: "round",
  lineJoin: "round",
};

/** @type {LeafletPolylineLike} */
const OLD_LINE = {
  color: "#ff69b4",
  weight: 4.5,
  opacity: 0.5,
  lineCap: "round",
  lineJoin: "round",
};

/** @type {LeafletPolylineLike} */
const OLD_HALO = {
  color: "#ffffff",
  weight: 6,
  opacity: 0.22,
  lineCap: "round",
  lineJoin: "round",
};

/** @type {LeafletPolylineLike} */
const PROPOSED_HALO = {
  color: "#ffffff",
  weight: 7,
  opacity: 0.22,
  lineCap: "round",
  lineJoin: "round",
};

/** @type {Omit<LeafletPolylineLike, "color">} */
const PROPOSED_LINE_BASE = {
  weight: 6,
  opacity: 0.95,
  dashArray: "3 7",
  lineCap: "round",
  lineJoin: "round",
};

/** @type {LeafletPolylineLike} */
const OFFROAD_LINE = {
  color: "#C62828",
  weight: 4,
  opacity: 0.95,
  dashArray: "6 10",
  lineCap: "round",
  lineJoin: "round",
};

/**
 * Leaflet-style stroke options for solid heritage, ghosted removed segments, proposed detour,
 * and off-road connectors. Proposed stroke color follows a valid 6-digit CSS `#` hex when given.
 *
 * @param {string | null | undefined} displayColorHex
 * @returns {{
 *   solidLine: LeafletPolylineLike;
 *   oldHalo: LeafletPolylineLike;
 *   oldLine: LeafletPolylineLike;
 *   proposedHalo: LeafletPolylineLike;
 *   proposedLine: LeafletPolylineLike;
 *   offroadLine: LeafletPolylineLike;
 * }}
 */
export function routeLineStylesForDisplayColor(displayColorHex) {
  const hex = normalizedSixDigitHex(displayColorHex);
  return {
    solidLine: { ...SOLID_LINE },
    oldHalo: { ...OLD_HALO },
    oldLine: { ...OLD_LINE },
    proposedHalo: { ...PROPOSED_HALO },
    proposedLine: {
      ...PROPOSED_LINE_BASE,
      color: hex ?? PROPOSED_DEFAULT_COLOR,
    },
    offroadLine: { ...OFFROAD_LINE },
  };
}
