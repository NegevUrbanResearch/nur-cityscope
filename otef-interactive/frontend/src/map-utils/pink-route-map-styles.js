/**
 * Colab-aligned Leaflet polyline options for curated pink routes.
 * Numeric tokens from nur-colab-map `mapLineStyles.ts` and off-road from `pinkDetourLeaflet.ts`.
 */

import {
  normalizeSubmissionDisplayColorHex,
  isAllowedSubmissionDisplayColor,
  secondaryHexForPrimaryNormalized,
} from "./submission-display-color.js";

/** @typedef {{ color?: string; weight?: number; opacity?: number; dashArray?: string; dashOffset?: string; lineCap?: string; lineJoin?: string; pane?: string }} LeafletPolylineLike */

/** Colab `OFFICIAL_NETWORK_GAP_METERS`: used only after **Google-routed** legs vs chord targets in `pinkLineRoute.ts`. */
export const OFFICIAL_NETWORK_GAP_METERS = 28;

/**
 * Stored `pink_line_route` LineStrings are **not** Google-routed vertex chains. Applying 28 m
 * between consecutive published vertices flags almost every leg as "off-road" and destroys
 * parity (red overlay + junction spam). Use a **heritage-scale** jump threshold instead so
 * only true discontinuities in stored geometry get connector styling.
 */
export const STORED_PINK_ROUTE_OFFROAD_GAP_METERS = 3500;

/** Colab `PROPOSED_DASH` */
const PROPOSED_DASH = "10 8";
/** Colab `PROPOSED_DASH_OFFSET_PRIMARY` — primary proposed polyline only. */
const PROPOSED_DASH_OFFSET_PRIMARY = "9";

/** Colab dual-stack caps for proposed primary + secondary. */
const PROPOSED_DUAL_CAP = "butt";
const PROPOSED_DUAL_JOIN = "miter";

const PROPOSED_DEFAULT_COLOR = "#ff587b";

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

/**
 * Colab `oldLineHaloStyle`.
 * @type {LeafletPolylineLike}
 */
const OLD_HALO = {
  color: "#ffffff",
  weight: 6,
  opacity: 0.22,
  lineCap: "round",
  lineJoin: "round",
};

/**
 * Colab `proposedLineHaloStyle`.
 * @type {LeafletPolylineLike}
 */
const PROPOSED_HALO = {
  color: "#e8eef5",
  weight: 8,
  opacity: 0.32,
  lineCap: "round",
  lineJoin: "round",
};

/** Colab `proposedLineStyle` — invalid/missing display color (no `proposedSecondary`). */
/** @type {LeafletPolylineLike} */
const PROPOSED_LINE_DEFAULT = {
  color: PROPOSED_DEFAULT_COLOR,
  weight: 6,
  opacity: 0.95,
  dashArray: PROPOSED_DASH,
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
 * and off-road connectors. Proposed stroke uses palette-valid `display_color` with Colab dual
 * dashes; otherwise default proposed pink (`proposedLineStyle`).
 *
 * When `proposedSecondary` is present, draw order is halo → secondary dashed → primary dashed
 * (primary uses `dashOffset` for interleave).
 *
 * @param {string | null | undefined} displayColorHex
 * @returns {{
 *   solidLine: LeafletPolylineLike;
 *   oldHalo: LeafletPolylineLike;
 *   oldLine: LeafletPolylineLike;
 *   proposedHalo: LeafletPolylineLike;
 *   proposedLine: LeafletPolylineLike;
 *   proposedSecondary?: LeafletPolylineLike;
 *   offroadLine: LeafletPolylineLike;
 * }}
 */
export function routeLineStylesForDisplayColor(displayColorHex) {
  const base = {
    solidLine: { ...SOLID_LINE },
    oldHalo: { ...OLD_HALO },
    oldLine: { ...OLD_LINE },
    proposedHalo: { ...PROPOSED_HALO },
    offroadLine: { ...OFFROAD_LINE },
  };

  if (!isAllowedSubmissionDisplayColor(displayColorHex)) {
    return {
      ...base,
      proposedLine: { ...PROPOSED_LINE_DEFAULT },
    };
  }

  const c = normalizeSubmissionDisplayColorHex(displayColorHex);
  const secondaryHex = secondaryHexForPrimaryNormalized(c);
  const proposedSecondary =
    secondaryHex != null
      ? {
          color: secondaryHex,
          weight: PROPOSED_LINE_DEFAULT.weight,
          opacity: 0.88,
          dashArray: PROPOSED_DASH,
          lineCap: PROPOSED_DUAL_CAP,
          lineJoin: PROPOSED_DUAL_JOIN,
        }
      : undefined;

  const out = {
    ...base,
    proposedLine: {
      color: c,
      weight: PROPOSED_LINE_DEFAULT.weight,
      opacity: PROPOSED_LINE_DEFAULT.opacity,
      dashArray: PROPOSED_DASH,
      dashOffset: PROPOSED_DASH_OFFSET_PRIMARY,
      lineCap: PROPOSED_DUAL_CAP,
      lineJoin: PROPOSED_DUAL_JOIN,
    },
  };
  if (proposedSecondary != null) {
    out.proposedSecondary = { ...proposedSecondary };
  }
  return out;
}
