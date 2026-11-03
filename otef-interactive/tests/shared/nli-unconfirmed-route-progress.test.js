import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLinePathMetrics } from "../../frontend/src/shared/maplibre-line-progress-primitives.js";
import { collectTimelineBeats, timelineBeatDurationMs, timelineSpanMs } from "../../frontend/src/shared/nli-investigation-beats.js";
import { orientInvestigationLineFeature } from "../../frontend/src/shared/maplibre-investigation-lines.js";
import {
  UNCONFIRMED_CONFIDENCE,
  clipLineCoordinatesToProgress,
  composeRouteProgress,
  clipFeatureToProgress,
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

  it("keeps one synthetic child on its parent's beat and reveals the joined story in travel order", () => {
    const parent = feature(23, [[8, 0], [10, 0]], { timeline_minutes: 400, flow_direction: "forward" });
    const child = feature(1013, [[0, 0], [4, 0], [8, 0]], {
      timeline_minutes: 400, route_confidence: UNCONFIRMED_CONFIDENCE, parent_objectid: 23, flow_direction: "forward",
    });
    const reverseParent = feature(4, [[10, 2], [8, 2]], { timeline_minutes: 410, flow_direction: "reverse" });
    const forwardChild = feature(1014, [[0, 2], [8, 2]], {
      timeline_minutes: 410, route_confidence: UNCONFIRMED_CONFIDENCE, parent_objectid: 4, flow_direction: "forward",
    });
    const adjustedParent = feature(29, [[8, 4], [10, 4]], { timeline_minutes: 420, flow_direction: "forward" });
    const adjustedApproach = feature(1001, [[0, 4], [2, 4], [3, 3], [8, 4]], {
      timeline_minutes: 420, route_confidence: UNCONFIRMED_CONFIDENCE, parent_objectid: 29,
    });
    const unrelated = feature(9000, [[30, 30], [31, 31]], { timeline_minutes: 435 });
    const approaches = [child, forwardChild, adjustedApproach];

    expect(approaches.map((route) => route.properties.parent_objectid)).toEqual([23, 4, 29]);
    const parentAndUnrelatedBeats = collectTimelineBeats([parent, reverseParent, adjustedParent, unrelated]);
    const allStoryBeats = collectTimelineBeats([
      parent, child, reverseParent, forwardChild, adjustedParent, adjustedApproach, unrelated,
    ]);
    expect(parentAndUnrelatedBeats).toEqual([400, 410, 420, 435]);
    expect(allStoryBeats).toEqual(parentAndUnrelatedBeats);
    expect(timelineBeatDurationMs(400)).toBe(4000);
    expect(timelineSpanMs(parentAndUnrelatedBeats.slice(0, 2))).toBe(6500);

    const orientedParent = orientInvestigationLineFeature(reverseParent);
    expect(orientedParent.geometry.coordinates).toEqual([[8, 2], [10, 2]]);
    const reverseReveal = splitCompositeLineFrame({ activeFeatures: [orientedParent, forwardChild], activeProgress: 0.9 });
    expect(reverseReveal.unconfirmedCompleted).toEqual([forwardChild]);
    expect(reverseReveal.confirmedActive[0].progress).toBeCloseTo(0.5);
    expect(reverseReveal.headPoints[0].coordinates).toEqual([9, 2]);
    const reverseAtJoin = splitCompositeLineFrame({ activeFeatures: [orientedParent, forwardChild], activeProgress: 0.8 });
    expect(reverseAtJoin.headPoints[0].coordinates).toEqual([8, 2]);
    const beforeJoin = splitCompositeLineFrame({ activeFeatures: [parent, child], activeProgress: 0.4 });
    expect(beforeJoin.unconfirmedActive.map((item) => item.feature.properties.OBJECTID)).toEqual([1013]);
    expect(beforeJoin.confirmedActive).toEqual([]);
    expect(beforeJoin.headPoints[0].coordinates).toEqual([4, 0]);
    const afterJoin = splitCompositeLineFrame({ activeFeatures: [parent, child], activeProgress: 0.9 });
    expect(afterJoin.unconfirmedCompleted.map((route) => route.properties.OBJECTID)).toEqual([1013]);
    expect(afterJoin.confirmedActive[0].feature.properties.OBJECTID).toBe(23);
    expect(afterJoin.headPoints[0].coordinates).toEqual([9, 0]);
    const immediatelyBeforeJoin = splitCompositeLineFrame({ activeFeatures: [parent, child], activeProgress: 0.8 - 1e-6 });
    const exactlyAtJoin = splitCompositeLineFrame({ activeFeatures: [parent, child], activeProgress: 0.8 });
    const immediatelyAfterJoin = splitCompositeLineFrame({ activeFeatures: [parent, child], activeProgress: 0.8 + 1e-6 });
    expect(immediatelyBeforeJoin.headPoints[0].coordinates[0]).toBeCloseTo(7.99999, 5);
    expect(clipFeatureToProgress(
      immediatelyBeforeJoin.unconfirmedActive[0].feature,
      immediatelyBeforeJoin.unconfirmedActive[0].progress,
    ).geometry.coordinates.at(-1)[0]).toBeCloseTo(7.99999, 5);
    expect(exactlyAtJoin.headPoints[0].coordinates).toEqual([8, 0]);
    expect(exactlyAtJoin.unconfirmedCompleted[0].geometry.coordinates.at(-1)).toEqual([8, 0]);
    expect(immediatelyAfterJoin.headPoints[0].coordinates[0]).toBeCloseTo(8.00001, 5);
    expect(clipFeatureToProgress(
      immediatelyAfterJoin.confirmedActive[0].feature,
      immediatelyAfterJoin.confirmedActive[0].progress,
    ).geometry.coordinates[0]).toEqual([8, 0]);
    const complete = splitCompositeLineFrame({ activeFeatures: [parent, child], activeProgress: 1 });
    expect(complete.confirmedCompleted).toEqual([parent]);
    expect(complete.unconfirmedCompleted).toEqual([child]);
    const idle = splitCompositeLineFrame({ completedFeatures: [parent, child] });
    expect(idle.confirmedCompleted).toEqual([parent]);
    expect(idle.unconfirmedCompleted).toEqual([child]);
    const adjustedReveal = splitCompositeLineFrame({ activeFeatures: [adjustedParent, adjustedApproach], activeProgress: 0.9 });
    expect(adjustedReveal.unconfirmedCompleted).toEqual([adjustedApproach]);
    expect(adjustedReveal.confirmedActive[0].feature).toBe(adjustedParent);
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
