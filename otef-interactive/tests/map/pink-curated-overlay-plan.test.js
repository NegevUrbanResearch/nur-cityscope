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

  it("no detour-points flag but non-empty removed: still emits ghost halo/stroke (not proposed)", () => {
    const ops = planPinkCuratedOverlayLayers({
      hasDetourPoints: false,
      hasStoredPinkRoute: true,
      solid: base.solid,
      removed: base.removed,
      proposedPathsLatLng: base.proposedPathsLatLng,
      offroadSegmentsLatLng: base.offroadSegmentsLatLng,
      offroadJunctionsLatLng: base.offroadJunctionsLatLng,
    });
    expect(polylineRoles(ops)).toEqual([
      "solid",
      "removedHalo",
      "removedStroke",
    ]);
  });

  it("detour + no stored route: solid, removed halo/stroke, proposed halo + stroke (planner segments)", () => {
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
      "proposedHalo",
      "proposedStroke",
    ]);
  });

  it("includeProposedSecondary: extra proposedSecondary between halo and primary", () => {
    const ops = planPinkCuratedOverlayLayers({
      hasDetourPoints: true,
      hasStoredPinkRoute: false,
      includeProposedSecondary: true,
      ...base,
      proposedPathsLatLng: [],
      offroadSegmentsLatLng: [],
      offroadJunctionsLatLng: [],
    });
    expect(polylineRoles(ops)).toEqual([
      "solid",
      "removedHalo",
      "removedStroke",
      "proposedHalo",
      "proposedSecondary",
      "proposedStroke",
    ]);
  });

  it("detour + stored route: no planner duplicate; proposed + offroad + junction", () => {
    const ops = planPinkCuratedOverlayLayers({
      hasDetourPoints: true,
      hasStoredPinkRoute: true,
      ...base,
    });
    const roles = polylineRoles(ops);
    expect(roles.filter((r) => r === "proposedHalo").length).toBe(1);
    expect(roles).toContain("proposedHalo");
    expect(roles).toContain("proposedStroke");
    expect(roles).toContain("offroad");
    const junctions = ops.filter(
      (o) => o.kind === "circleMarker" && o.role === "offroadJunction",
    );
    expect(junctions.length).toBeGreaterThan(0);
  });

  it("detour + stored route + includeProposedSecondary: halo → secondary → primary before offroad", () => {
    const ops = planPinkCuratedOverlayLayers({
      hasDetourPoints: true,
      hasStoredPinkRoute: true,
      includeProposedSecondary: true,
      ...base,
    });
    const roles = polylineRoles(ops);
    const iHalo = roles.indexOf("proposedHalo");
    const iSec = roles.indexOf("proposedSecondary");
    const iStroke = roles.indexOf("proposedStroke");
    const iOff = roles.indexOf("offroad");
    expect(iHalo).toBeGreaterThanOrEqual(0);
    expect(iSec).toBe(iHalo + 1);
    expect(iStroke).toBe(iSec + 1);
    expect(iOff).toBeGreaterThan(iStroke);
  });
});
