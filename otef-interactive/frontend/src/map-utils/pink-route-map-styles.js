/**
 * Colab-aligned Leaflet polyline options for curated pink routes.
 * Numeric tokens from nur-colab-map `mapLineStyles.ts` and off-road from `pinkDetourLeaflet.ts`.
 */

/** @typedef {{ color?: string; weight?: number; opacity?: number; dashArray?: string; lineCap?: string; lineJoin?: string; pane?: string }} LeafletPolylineLike */

/** Colab `OFFICIAL_NETWORK_GAP_METERS`: used only after **Google-routed** legs vs chord targets in `pinkLineRoute.ts`. */
export const OFFICIAL_NETWORK_GAP_METERS = 28;

/**
 * Stored `pink_line_route` LineStrings are **not** Google-routed vertex chains. Applying 28 m
 * between consecutive published vertices flags almost every leg as "off-road" and destroys
 * parity (red overlay + junction spam). Use a **heritage-scale** jump threshold instead so
 * only true discontinuities in stored geometry get connector styling.
 */
export const STORED_PINK_ROUTE_OFFROAD_GAP_METERS = 3500;

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
  opacity: 0.4,
  lineCap: "round",
  lineJoin: "round",
};

/** @type {LeafletPolylineLike} */
const OLD_HALO = {
  color: "#ffffff",
  weight: 6.5,
  opacity: 0.32,
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
