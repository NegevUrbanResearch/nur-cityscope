import { describe, it, expect } from "vitest";
import { planPinkCuratedOverlayLayers } from "../../frontend/src/map/pink-curated-overlay-plan.js";

function polylineRoles(ops) {
  return ops.filter((o) => o.kind === "polyline").map((o) => o.role);
}

describe("planPinkCuratedOverlayLayers", () => {
  const base = {
    solid: [
      [
        [32.0, 34.0],
        [32.01, 34.01],
      ],
    ],
    removed: [
      [
        [32.01, 34.01],
        [32.02, 34.02],
      ],
    ],
    dashedPlanner: [
      [
        [32.02, 34.02],
        [32.03, 34.03],
      ],
    ],
    proposedPathsLatLng: [
      [
        [32.02, 34.02],
        [32.05, 34.05],
      ],
    ],
    offroadSegmentsLatLng: [
      [
        [32.04, 34.04],
        [32.05, 34.05],
      ],
    ],
    offroadJunctionsLatLng: [[32.04, 34.04]],
  };

  it("no detour points: only solid polylines", () => {
    const ops = planPinkCuratedOverlayLayers({
      hasDetourPoints: false,
      hasStoredPinkRoute: false,
      solid: base.solid,
      removed: [],
      dashedPlanner: [],
      proposedPathsLatLng: [],
      offroadSegmentsLatLng: [],
      offroadJunctionsLatLng: [],
    });
    expect(polylineRoles(ops)).toEqual(["solid"]);
  });

  it("detour + no stored route: solid, removed halo/stroke, dashed planner halo/stroke", () => {
    const ops = planPinkCuratedOverlayLayers({
      hasDetourPoints: true,
      hasStoredPinkRoute: false,
      ...base,
      proposedPathsLatLng: [],
      offroadSegmentsLatLng: [],
      offroadJunctionsLatLng: [],
    });
    expect(polylineRoles(ops)).toEqual([
      "solid",
      "removedHalo",
      "removedStroke",
      "dashedPlannerHalo",
      "dashedPlannerStroke",
    ]);
  });

  it("detour + stored route: no dashed planner; proposed + offroad + junction", () => {
    const ops = planPinkCuratedOverlayLayers({
      hasDetourPoints: true,
      hasStoredPinkRoute: true,
      ...base,
    });
    const roles = polylineRoles(ops);
    expect(roles.some((r) => r.startsWith("dashedPlanner"))).toBe(false);
    expect(roles).toContain("proposedHalo");
    expect(roles).toContain("proposedStroke");
    expect(roles).toContain("offroad");
    const junctions = ops.filter(
      (o) => o.kind === "circleMarker" && o.role === "offroadJunction",
    );
    expect(junctions.length).toBeGreaterThan(0);
  });
});
