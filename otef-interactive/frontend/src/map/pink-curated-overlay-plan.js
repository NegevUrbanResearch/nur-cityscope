/**
 * Pure overlay plan for curated pink-line Leaflet stack (Colab draw order).
 * No Leaflet — returns ordered draw ops for the host to materialize.
 *
 * Path B: `proposedPathsLatLng` is expected to be pre-clipped (see
 * `clipProposedPathsLatLngExcludingOffroadGaps`) so off-road gaps are not double-stacked
 * under full-opacity proposed halo/stroke.
 */

/**
 * @typedef {{ kind: "polyline"; role: string; latLngs: Array<[number, number]>; styleKey: string }} PinkOverlayPolylineOp
 * @typedef {{ kind: "circleMarker"; role: "offroadJunction"; latLng: [number, number]; styleKey: string }} PinkOverlayCircleMarkerOp
 * @typedef {PinkOverlayPolylineOp | PinkOverlayCircleMarkerOp} PinkOverlayOp
 */

/**
 * Colab unified order: solid → removed (halo, stroke) → proposed (halo, stroke)
 * or dashed planner (halo, stroke) when no stored route → offroad polylines → offroad junction markers.
 * When `hasStoredPinkRoute === true`, dashed planner roles are omitted.
 *
 * @param {{
 *   hasDetourPoints: boolean;
 *   hasStoredPinkRoute: boolean;
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
      if (!Array.isArray(latLngs) || latLngs.length < 2) continue;
      ops.push({
        kind: "polyline",
        role: "proposedHalo",
        latLngs,
        styleKey: "proposedHalo",
      });
      ops.push({
        kind: "polyline",
        role: "proposedStroke",
        latLngs,
        styleKey: "proposedLine",
      });
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
      if (!Array.isArray(latLngs) || latLngs.length < 2) continue;
      ops.push({
        kind: "polyline",
        role: "dashedPlannerHalo",
        latLngs,
        styleKey: "dashedPlannerHalo",
      });
      ops.push({
        kind: "polyline",
        role: "dashedPlannerStroke",
        latLngs,
        styleKey: "dashedPlannerStroke",
      });
    }
  }

  return ops;
}
