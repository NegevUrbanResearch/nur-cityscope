import { describe, expect, it } from "vitest";
import {
  buildInvestigationSettlementIndexes,
  buildInvestigationLineFeaturesForFrame,
  buildInvestigationSettlementOutlineIdsForFrame,
  createInvestigationTimelineData,
  ensureInvestigationLayerFeatures,
  getInvestigationTimelineDataDiagnostics,
  refreshInvestigationTimelineData,
} from "../../frontend/src/shared/nli-investigation-timeline-data.js";
import {
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
} from "../../frontend/src/shared/nli-investigation-beats.js";

describe("investigation timeline data store", () => {
  it("builds the same exact settlement indexes for locations and outlines", () => {
    const feature = { properties: { outlineObjectId: 42, locations: ["א", "ב"] } };
    const indexes = buildInvestigationSettlementIndexes([feature]);
    expect(indexes.locationToOutlineObjectId.get("א")).toBe(42);
    expect(indexes.settlementFeaturesByOutlineId.get("42")).toBe(feature);
  });

  it("does not retain a deferred layer result after its request becomes stale", async () => {
    let resolve;
    const pending = new Promise((done) => { resolve = done; });
    const data = createInvestigationTimelineData();
    const request = { generation: 1 };
    const promise = ensureInvestigationLayerFeatures(data, {
      getLayerDataUrl: () => "/lines.json",
      fetchJson: async () => pending,
    }, "lineFeatures", INVESTIGATION_LINES_FULL_ID, {
      request,
      isCurrent: () => false,
    });
    resolve({ features: [{ properties: { OBJECTID: 1 } }] });
    await promise;
    expect(data.lineFeatures).toBeNull();
  });

  it("invalidates injected feature bags when the data version changes", () => {
    const data = createInvestigationTimelineData({
      dataVersion: "v1",
      featuresById: { [INVESTIGATION_LINES_FULL_ID]: [{ properties: { OBJECTID: 1 } }] },
    });
    refreshInvestigationTimelineData(data, { dataVersion: "v2" });
    expect(data.dataVersion).toBe("v2");
    expect(data.lineFeatures).toBeNull();
  });

  it("reuses one line partition and frame cache across ambient reads", () => {
    const data = createInvestigationTimelineData({
      featuresById: {
        [INVESTIGATION_LINES_FULL_ID]: [
          { properties: { timeline_minutes: 400 } },
          { properties: { timeline_minutes: 405 } },
        ],
      },
    });
    const frame = { completedBeats: [400], activeBeat: 405, activeProgress: 0.5 };
    buildInvestigationLineFeaturesForFrame(data, frame);
    buildInvestigationLineFeaturesForFrame(data, frame);
    expect(getInvestigationTimelineDataDiagnostics(data)).toEqual({
      linePartitionBuilds: 1,
      linePartitionFrameBuilds: 1,
      collisionIndexBuilds: 0,
    });
  });

  it("builds the spatial collision index once per source identity", () => {
    const lines = [{
      properties: { OBJECTID: 1, timeline_minutes: 400 },
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] },
    }];
    const settlements = [{
      properties: { outlineObjectId: 20 },
      geometry: { type: "Polygon", coordinates: [[[4, -1], [6, -1], [6, 1], [4, 1], [4, -1]]] },
    }];
    const data = createInvestigationTimelineData({
      featuresById: { [INVESTIGATION_LINES_FULL_ID]: lines },
      settlementFeatures: settlements,
    });
    const frame = { achievedPolygonBeats: [], activeProgress: 0.5 };
    const lineFrame = { completedFeatures: [], activeFeatures: lines };

    buildInvestigationSettlementOutlineIdsForFrame(data, frame, lineFrame);
    buildInvestigationSettlementOutlineIdsForFrame(data, frame, lineFrame);
    expect(getInvestigationTimelineDataDiagnostics(data).collisionIndexBuilds).toBe(1);

    refreshInvestigationTimelineData(data, {
      featuresById: { [INVESTIGATION_POLYGONS_FULL_ID]: [{ properties: { OBJECTID: 99 } }] },
    });
    buildInvestigationSettlementOutlineIdsForFrame(data, frame, lineFrame);
    expect(getInvestigationTimelineDataDiagnostics(data).collisionIndexBuilds).toBe(1);

    const replacement = [{ ...lines[0] }];
    refreshInvestigationTimelineData(data, {
      featuresById: { [INVESTIGATION_LINES_FULL_ID]: replacement },
    });
    buildInvestigationSettlementOutlineIdsForFrame(data, frame, {
      completedFeatures: [], activeFeatures: replacement,
    });
    expect(getInvestigationTimelineDataDiagnostics(data).collisionIndexBuilds).toBe(2);
  });

  it("rebuilds the collision index when the settlement source is replaced", () => {
    const lines = [{
      properties: { OBJECTID: 1, timeline_minutes: 400 },
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] },
    }];
    const settlement = (outlineObjectId, left) => ({
      properties: { outlineObjectId },
      geometry: { type: "Polygon", coordinates: [[[left, -1], [left + 2, -1], [left + 2, 1], [left, 1], [left, -1]]] },
    });
    const first = [settlement(20, 4)];
    const data = createInvestigationTimelineData({
      featuresById: { [INVESTIGATION_LINES_FULL_ID]: lines },
      settlementFeatures: first,
    });
    const frame = { achievedPolygonBeats: [], activeProgress: 1 };
    const lineFrame = { completedFeatures: lines, activeFeatures: [] };
    expect(buildInvestigationSettlementOutlineIdsForFrame(data, frame, lineFrame)).toEqual(new Set(["20"]));

    const replacement = [settlement(30, 7)];
    refreshInvestigationTimelineData(data, { settlementFeatures: replacement });
    expect(buildInvestigationSettlementOutlineIdsForFrame(data, frame, lineFrame)).toEqual(new Set(["30"]));
    expect(getInvestigationTimelineDataDiagnostics(data).collisionIndexBuilds).toBe(2);
  });

  it("rebuilds the collision index after in-place mutation with a data-version bump", () => {
    const lines = [{
      properties: { OBJECTID: 1, timeline_minutes: 400 },
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] },
    }];
    const settlements = [{
      properties: { outlineObjectId: 20 },
      geometry: { type: "Polygon", coordinates: [[[4, -1], [6, -1], [6, 1], [4, 1], [4, -1]]] },
    }];
    const data = createInvestigationTimelineData({
      dataVersion: "v1",
      featuresById: { [INVESTIGATION_LINES_FULL_ID]: lines },
      settlementFeatures: settlements,
    });
    const frame = { achievedPolygonBeats: [], activeProgress: 1 };
    const lineFrame = { completedFeatures: lines, activeFeatures: [] };
    expect(buildInvestigationSettlementOutlineIdsForFrame(data, frame, lineFrame)).toEqual(new Set(["20"]));

    settlements[0].geometry.coordinates[0] = [[20, -1], [22, -1], [22, 1], [20, 1], [20, -1]];
    refreshInvestigationTimelineData(data, {
      dataVersion: "v2",
      featuresById: { [INVESTIGATION_LINES_FULL_ID]: lines },
      settlementFeatures: settlements,
    });
    expect(buildInvestigationSettlementOutlineIdsForFrame(data, frame, lineFrame)).toEqual(new Set());
    expect(getInvestigationTimelineDataDiagnostics(data).collisionIndexBuilds).toBe(2);
  });
});
