/**
 * Colab-aligned Leaflet polyline options for curated pink routes.
 * Numeric tokens from nur-colab-map `mapLineStyles.ts` and off-road from `pinkDetourLeaflet.ts`.
 *
 * **Multiple pink strokes are intentional** (GIS + projector both stack these):
 * 1. **Regional axis** — `resolvePinkLinePackStyleBundle` / `pink_line_base`; full-opacity pack styling
 *    merged from `axisPackLine` (`PINK_AXIS_PACK_LINE`), **not** overlay `solidLine`.
 * 2. **Kept heritage** — `solidLine` (`SOLID_LINE`): hot pink ~0.9 opacity on segments that **stay** on the
 *    published axis after detour integration. **Not** controlled by `GHOST_REMOVED_*`.
 * 3. **Replaced heritage (ghost)** — `oldHalo` + `oldLine`: white fringe + softer pink; **only** on
 *    `integrated_route.removed` / `buildIntegratedRoute.removed`. **`GHOST_REMOVED_*` applies here only.**
 * 4. **Proposed detour** — `proposedHalo` / `proposedLine` / optional secondary: dashed route, often **bright**
 *    pink (`#ff587b` or submission `display_color`). Also **not** `GHOST_REMOVED_*`.
 *
 * If you zero out ghost opacity and still see a strong pink, you are almost certainly looking at
 * **(2) kept solid** and/or **(4) proposed**, not the removed ghost stroke.
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

/**
 * Ghosted “removed heritage” stroke opacities — **only** the replaced / superseded segments
 * drawn as `oldHalo` + `oldLine` in the curated overlay (`planPinkCuratedOverlayLayers` /
 * `buildColabAlignedCuratedOverlayGeoJSON`).
 *
 * **These constants do not control:**
 * - **Kept** heritage segments in the overlay (`solidLine`).
 * - **Regional axis** pack merge (`axisPackLine` / `PINK_AXIS_PACK_LINE`).
 * - **Proposed** detour strokes (`proposedHalo` / `proposedLine` / …).
 *
 * The **regional pink axis** (`pink_line_base`) uses `axisPackLine` via `resolvePinkLinePackStyleBundle`
 * when there is **no** removed heritage. When there **is** `removed` heritage, CityScope **omits**
 * `pink_line_base` (Colab MapPage never draws a full pack under integrated solid/removed) and only
 * the overlay draws `solidLine` on kept segments plus ghost strokes — so the ghost can read at
 * `GHOST_REMOVED_*` opacity over the basemap.
 */
export const GHOST_REMOVED_LINE_OPACITY = 0.5;
export const GHOST_REMOVED_HALO_OPACITY = 0.22;

/**
 * Kept heritage overlay segments (`planPinkCuratedOverlayLayers`). **Not** `GHOST_REMOVED_*`.
 * Independent from `PINK_AXIS_PACK_LINE` so tuning overlay solid does not affect the regional axis pack.
 * @type {LeafletPolylineLike}
 */
const SOLID_LINE = {
  color: "#FF69B4",
  weight: 5,
  opacity: 0.9,
  lineCap: "round",
  lineJoin: "round",
};

/**
 * Regional network axis / pack merge (`resolvePinkLinePackStyleBundle` → `pink_line_base`).
 * Same default numbers as {@link SOLID_LINE} (Colab parity) but a **separate** object reference.
 * @type {LeafletPolylineLike}
 */
const PINK_AXIS_PACK_LINE = { ...SOLID_LINE };

/**
 * Heritage “removed route” stack — same structure as Colab `mapLineStyles.ts`
 * (`oldLineStyle` / `oldLineHaloStyle`): wide white underlay, then softer pink on top.
 * Values here are **more ghostly** than Colab’s defaults (0.5 / 0.22): see `GHOST_REMOVED_*`
 * constants so replaced segments read clearly as background, not competing with solid pink.
 * Legibility is **two Leaflet polylines** (no CSS shadow). Projection canvas adds a **white**
 * stroke fringe on the pink line only (see `_removedPinkStrokeShadow` in curated-layer-service).
 */

/** @type {LeafletPolylineLike} */
const OLD_LINE = {
  color: "#ff69b4",
  weight: 4.5,
  opacity: GHOST_REMOVED_LINE_OPACITY,
  lineCap: "round",
  lineJoin: "round",
};

/**
 * Soft white fringe under the ghost pink (Colab `oldLineHaloStyle` pattern; slightly wider
 * at lower alpha so the halo still separates from the basemap).
 * @type {LeafletPolylineLike}
 */
const OLD_HALO = {
  color: "#ffffff",
  weight: 5,
  opacity: GHOST_REMOVED_HALO_OPACITY,
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

/**
 * Stroke tokens for the MapLibre curated **pink projection** fallback (stored line GeoJSON,
 * no detour routing points): same Colab proposed dash and weight as {@link PROPOSED_LINE_DEFAULT}.
 * Consumed via `leafletStyleToMapLibre` in `maplibre-curated-layer-loader.js` only —
 * not a commitment to keep Leaflet rendering in sync during the MapLibre migration.
 *
 * @param {string | null | undefined} lineColor - layer accent hex (e.g. from UI curated color)
 * @returns {LeafletPolylineLike}
 */
export function pinkProjectionFallbackLineStyle(lineColor) {
  return {
    color: lineColor || PROPOSED_DEFAULT_COLOR,
    weight: PROPOSED_LINE_DEFAULT.weight,
    opacity: PROPOSED_LINE_DEFAULT.opacity,
    dashArray: PROPOSED_DASH,
    lineCap: PROPOSED_LINE_DEFAULT.lineCap,
    lineJoin: PROPOSED_LINE_DEFAULT.lineJoin,
  };
}

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
 *   axisPackLine: LeafletPolylineLike;
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
    axisPackLine: { ...PINK_AXIS_PACK_LINE },
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
