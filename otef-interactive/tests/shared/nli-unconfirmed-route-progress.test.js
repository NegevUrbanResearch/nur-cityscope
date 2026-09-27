import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLinePathMetrics } from "../../frontend/src/shared/maplibre-line-progress-primitives.js";
import {
  UNCONFIRMED_CONFIDENCE,
  clipLineCoordinatesToProgress,
  composeRouteProgress,
  isUnconfirmedRoute,
  splitCompositeLineFrame,
} from "../../frontend/src/shared/nli-unconfirmed-route-progress.js";

function feature(objectId, coordinates, extra = {}) {
  return {
    type: "Feature",
    properties: { OBJECTID: objectId, ...extra },
    geometry: { type: "LineString", coordinates },
  };
}

describe("composeRouteProgress", () => {
  it("maps global beat progress onto the unconfirmed prefix then the confirmed suffix", () => {
    expect(composeRouteProgress({ unconfirmedLength: 8, confirmedLength: 2, progress: 0 }))
      .toEqual({ unconfirmedProgress: 0, confirmedProgress: 0, phase: "unconfirmed", joinFraction: 0.8 });
    expect(composeRouteProgress({ unconfirmedLength: 8, confirmedLength: 2, progress: 0.4 }))
      .toEqual({ unconfirmedProgress: 0.5, confirmedProgress: 0, phase: "unconfirmed", joinFraction: 0.8 });
    expect(composeRouteProgress({ unconfirmedLength: 8, confirmedLength: 2, progress: 0.8 }))
      .toEqual({ unconfirmedProgress: 1, confirmedProgress: 0, phase: "confirmed", joinFraction: 0.8 });
    expect(composeRouteProgress({ unconfirmedLength: 8, confirmedLength: 2, progress: 0.9 }))
      .toEqual({ unconfirmedProgress: 1, confirmedProgress: 0.5, phase: "confirmed", joinFraction: 0.8 });
    expect(composeRouteProgress({ unconfirmedLength: 8, confirmedLength: 2, progress: 1 }))
      .toEqual({ unconfirmedProgress: 1, confirmedProgress: 1, phase: "complete", joinFraction: 0.8 });
  });

  it("treats a missing unconfirmed tail as a confirmed-only route", () => {
    expect(composeRouteProgress({ unconfirmedLength: 0, confirmedLength: 5, progress: 0.4 }))
      .toMatchObject({ unconfirmedProgress: 1, confirmedProgress: 0.4, phase: "confirmed", joinFraction: 0 });
  });
});

describe("clipLineCoordinatesToProgress", () => {
  it("returns a prefix that ends on the progress point", () => {
    const coords = [[0, 0], [10, 0]];
    const metrics = buildLinePathMetrics(coords);
    expect(clipLineCoordinatesToProgress(coords, metrics, 0)).toEqual([]);
    expect(clipLineCoordinatesToProgress(coords, metrics, 0.5)).toEqual([[0, 0], [5, 0]]);
    expect(clipLineCoordinatesToProgress(coords, metrics, 1)).toEqual(coords);
  });
});

describe("splitCompositeLineFrame", () => {
  const confirmed = feature(10, [[8, 0], [10, 0]]);
  const unconfirmed = feature(1001, [[0, 0], [8, 0]], {
    route_confidence: UNCONFIRMED_CONFIDENCE,
    parent_objectid: 10,
  });
  const connector = feature(1002, [[8, 0], [8, 2]], {
    route_confidence: UNCONFIRMED_CONFIDENCE,
    parent_objectid: 10,
    route_role: "connector",
  });

  it("detects unconfirmed approach features", () => {
    expect(isUnconfirmedRoute(unconfirmed)).toBe(true);
    expect(isUnconfirmedRoute(confirmed)).toBe(false);
  });

  it("draws only the Gaza tail before the join, then continues into the confirmed line", () => {
    const beforeJoin = splitCompositeLineFrame({
      activeFeatures: [confirmed, unconfirmed],
      completedFeatures: [],
      activeProgress: 0.4,
    });
    expect(beforeJoin.unconfirmedActive).toHaveLength(1);
    expect(beforeJoin.unconfirmedActive[0].progress).toBeCloseTo(0.5);
    expect(beforeJoin.confirmedActive).toEqual([]);
    expect(beforeJoin.unconfirmedCompleted).toEqual([]);
    expect(beforeJoin.headPoints[0].coordinates).toEqual([4, 0]);
    expect(beforeJoin.headPoints[0].properties.headKind).toBe("comet");

    const afterJoin = splitCompositeLineFrame({
      activeFeatures: [confirmed, unconfirmed],
      completedFeatures: [],
      activeProgress: 0.9,
    });
    expect(afterJoin.unconfirmedCompleted).toEqual([unconfirmed]);
    expect(afterJoin.confirmedActive).toHaveLength(1);
    expect(afterJoin.confirmedActive[0].progress).toBeCloseTo(0.5);
    expect(afterJoin.confirmedActive[0].clipGeometry).toBe(true);
    expect(afterJoin.headPoints[0].coordinates).toEqual([9, 0]);
    expect(afterJoin.headPoints[0].properties.headKind).toBe("meteor");
  });

  it("keeps a connector on its own progress and does not steal the parent approach", () => {
    const split = splitCompositeLineFrame({
      activeFeatures: [confirmed, unconfirmed, connector],
      completedFeatures: [],
      activeProgress: 0.4,
    });
    expect(split.unconfirmedActive.map((item) => item.feature.properties.OBJECTID).sort())
      .toEqual([1001, 1002]);
    const connectorItem = split.unconfirmedActive.find((item) => item.feature.properties.OBJECTID === 1002);
    expect(connectorItem.progress).toBeCloseTo(0.4);
  });

  it("leaves a confirmed-only active route on the shared gradient layer", () => {
    const solo = feature(3, [[0, 0], [10, 0]]);
    const split = splitCompositeLineFrame({
      activeFeatures: [solo],
      completedFeatures: [],
      activeProgress: 0.5,
    });
    expect(split.confirmedActive).toEqual([{
      feature: solo,
      progress: 0.5,
      clipGeometry: false,
    }]);
    expect(split.headPoints[0].coordinates).toEqual([5, 0]);
    expect(split.headPoints[0].properties.headKind).toBe("meteor");
  });
});

describe("Magen confirmed line orientation", () => {
  it("stays forward so the unconfirmed approach can draw into it", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const lines = JSON.parse(fs.readFileSync(
      path.resolve(here, "../../public/processed/layers/nli/lines.geojson"),
      "utf8",
    ));
    const magen = lines.features.find((item) => Number(item?.properties?.OBJECTID) === 63);
    const approach = lines.features.find((item) => Number(item?.properties?.OBJECTID) === 1004);
    expect(magen.properties.flow_direction).toBe("forward");
    expect(approach.geometry.coordinates.at(-1)).toEqual(magen.geometry.coordinates[0]);
  });
});
