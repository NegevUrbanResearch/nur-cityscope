/**
 * Pure overlay plan for curated pink-line Leaflet stack (Colab draw order).
 * No Leaflet — returns ordered draw ops for the host to materialize.
 *
 * Path B: `proposedPathsLatLng` is expected to be pre-clipped (see
 * `clipProposedPathsLatLngExcludingOffroadGaps`) so off-road gaps are not double-stacked
 * under full-opacity proposed halo/stroke.
 */

/**
 * Polyline ops use `styleKey` for Leaflet style lookup. Proposed path keys: `proposedHalo` (underlay),
 * optional `proposedSecondary` (dual-stack dashed, no offset), `proposedLine` (primary dashed, may
 * carry dash offset).
 *
 * @typedef {{ kind: "polyline"; role: string; latLngs: Array<[number, number]>; styleKey: string }} PinkOverlayPolylineOp
 * @typedef {{ kind: "circleMarker"; role: "offroadJunction"; latLng: [number, number]; styleKey: string }} PinkOverlayCircleMarkerOp
 * @typedef {PinkOverlayPolylineOp | PinkOverlayCircleMarkerOp} PinkOverlayOp
 */

/**
 * Push one proposed path’s polylines: halo → optional secondary → primary (Colab draw order).
 * @param {PinkOverlayOp[]} ops
 * @param {Array<[number, number]>} latLngs
 * @param {boolean} includeProposedSecondary — when true, host will supply `styles.proposedSecondary`.
 */
function pushProposedPathOverlayOps(ops, latLngs, includeProposedSecondary) {
  if (!Array.isArray(latLngs) || latLngs.length < 2) return;
  ops.push({
    kind: "polyline",
    role: "proposedHalo",
    latLngs,
    styleKey: "proposedHalo",
  });
  if (includeProposedSecondary) {
    ops.push({
      kind: "polyline",
      role: "proposedSecondary",
      latLngs,
      styleKey: "proposedSecondary",
    });
  }
  ops.push({
    kind: "polyline",
    role: "proposedStroke",
    latLngs,
    styleKey: "proposedLine",
  });
}

/**
 * Colab unified order: solid → removed (halo, stroke) → proposed paths (each: halo → optional
 * secondary dashed → primary dashed). Stored `pink_line_route` geometry and the no-stored-route
 * integrated `dashedPlanner` segments use the **same** op sequence (dual-stack parity).
 * When `hasStoredPinkRoute === true`, planner detour segments are not drawn as proposed here;
 * offroad connectors and junction markers follow proposed paths.
 *
 * @param {{
 *   hasDetourPoints: boolean;
 *   hasStoredPinkRoute: boolean;
 *   includeProposedSecondary?: boolean;
 *   solid?: Array<Array<[number, number]>>;
 *   removed?: Array<Array<[number, number]>>;
 *   dashedPlanner?: Array<Array<[number, number]>>;
 *   proposedPathsLatLng?: Array<Array<[number, number]>>;
 *   offroadSegmentsLatLng?: Array<Array<[number, number]>>;
 *   offroadJunctionsLatLng?: Array<[number, number]>;
 * }} input
 * @returns {PinkOverlayOp[]}
 */
export function planPinkCuratedOverlayLayers(input) {
  const {
    hasDetourPoints,
    hasStoredPinkRoute,
    includeProposedSecondary = false,
    solid = [],
    removed = [],
    dashedPlanner = [],
    proposedPathsLatLng = [],
    offroadSegmentsLatLng = [],
    offroadJunctionsLatLng = [],
  } = input;

  /** @type {PinkOverlayOp[]} */
  const ops = [];

  for (const latLngs of solid) {
    if (Array.isArray(latLngs) && latLngs.length >= 2) {
      ops.push({
        kind: "polyline",
        role: "solid",
        latLngs,
        styleKey: "solidLine",
      });
    }
  }

  if (!hasDetourPoints) {
    return ops;
  }

  for (const latLngs of removed) {
    if (!Array.isArray(latLngs) || latLngs.length < 2) continue;
    ops.push({
      kind: "polyline",
      role: "removedHalo",
      latLngs,
      styleKey: "oldHalo",
    });
    ops.push({
      kind: "polyline",
      role: "removedStroke",
      latLngs,
      styleKey: "oldLine",
    });
  }

  if (hasStoredPinkRoute) {
    for (const latLngs of proposedPathsLatLng) {
      pushProposedPathOverlayOps(ops, latLngs, includeProposedSecondary);
    }
    for (const latLngs of offroadSegmentsLatLng) {
      if (!Array.isArray(latLngs) || latLngs.length < 2) continue;
      ops.push({
        kind: "polyline",
        role: "offroad",
        latLngs,
        styleKey: "offroadLine",
      });
    }
    for (const latLng of offroadJunctionsLatLng) {
      if (Array.isArray(latLng) && latLng.length === 2) {
        ops.push({
          kind: "circleMarker",
          role: "offroadJunction",
          latLng,
          styleKey: "offroadJunction",
        });
      }
    }
  } else {
    for (const latLngs of dashedPlanner) {
      pushProposedPathOverlayOps(ops, latLngs, includeProposedSecondary);
    }
  }

  return ops;
}
