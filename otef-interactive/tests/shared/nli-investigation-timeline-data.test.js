import { describe, expect, it } from "vitest";
import {
  buildInvestigationSettlementIndexes,
  buildInvestigationLineFeaturesForFrame,
  buildInvestigationSettlementOutlineIdsForFrame,
  createInvestigationTimelineData,
  ensureInvestigationLayerFeatures,
  ensureInvestigationPolygonStyle,
  ensureInvestigationBufferedGradient,
  ensureInvestigationSettlementFeatures,
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

  it("loads the processed polygon style and declared sidecar through registry data", async () => {
    const style = { renderer: "uniqueValue", uniqueValues: { classes: [{ value: "שריפה", symbol: { symbolLayers: [{ type: "fill", fillType: "gradient", resolvedColors: ["#f00"], interval: 1, opacity: 1 }] } }] } };
    const sidecar = { type: "FeatureCollection", features: [{ properties: { __cim_gradient_band: 0 } }] };
    const data = createInvestigationTimelineData({ dataVersion: "v1" });
    const fetchJson = async (url) => url.endsWith(".geojson") ? sidecar : null;
    await ensureInvestigationPolygonStyle(data, {
      getLayerStyle: () => style,
      getLayerConfig: () => ({ resources: { bufferedGradient: { file: "gradient.geojson", format: "geojson" } }, groupId: "nli" }),
      fetchJson,
    }, { request: { generation: 1 } });
    await ensureInvestigationBufferedGradient(data, {
      getLayerConfig: () => ({ resources: { bufferedGradient: { file: "gradient.geojson", format: "geojson" } }, groupId: "nli" }),
      fetchJson,
    }, { request: { generation: 1 } });
    expect(data.polygonStyle).toBe(style);
    expect(data.bufferedGradientSidecarStatus).toBe("ready");
    expect(data.bufferedGradientFeatures).toEqual(sidecar.features);
  });

  it("resets style and sidecar state and ignores stale sidecar completion", async () => {
    let resolveSidecar;
    const pending = new Promise((resolve) => { resolveSidecar = resolve; });
    const data = createInvestigationTimelineData({ dataVersion: "v1", polygonStyle: { renderer: "uniqueValue" } });
    const promise = ensureInvestigationBufferedGradient(data, {
      getLayerConfig: () => ({ resources: { bufferedGradient: { file: "gradient.geojson", format: "geojson" } }, groupId: "nli" }),
      fetchJson: () => pending,
    }, { request: { generation: 1 }, isCurrent: () => true });
    refreshInvestigationTimelineData(data, { dataVersion: "v2" });
    resolveSidecar({ features: [{ properties: { OBJECTID: 1 } }] });
    await promise;
    expect(data.polygonStyle).toBeNull();
    expect(data.bufferedGradientFeatures).toBeNull();
    expect(data.bufferedGradientSidecarStatus).toBe("not-required");
  });

  it("treats failed sidecar state as terminal until the data version changes", async () => {
    const style = { renderer: "uniqueValue", uniqueValues: { classes: [{ value: "שריפה", symbol: { symbolLayers: [{ type: "fill", fillType: "gradient", resolvedColors: ["#f00"], interval: 1 }] } }] } };
    const data = createInvestigationTimelineData({ polygonStyle: style, dataVersion: "v1" });
    let calls = 0;
    const deps = {
      getLayerConfig: () => ({ resources: { bufferedGradient: { file: "gradient.geojson" } }, groupId: "nli" }),
      fetchJson: async () => { calls += 1; return null; },
    };
    await ensureInvestigationBufferedGradient(data, deps);
    await ensureInvestigationBufferedGradient(data, deps);
    expect(calls).toBe(1);
    expect(data.bufferedGradientSidecarStatus).toBe("failed");
  });

  it("accepts explicit status-only sidecar injections and rejects malformed GeoJSON", async () => {
    const style = { renderer: "uniqueValue", uniqueValues: { classes: [{ value: "שריפה", symbol: { symbolLayers: [{ type: "fill", fillType: "gradient", resolvedColors: ["#f00"], interval: 1 }] } }] } };
    const data = createInvestigationTimelineData({ polygonStyle: style });
    refreshInvestigationTimelineData(data, { bufferedGradientSidecarStatus: "loading" });
    expect(data.bufferedGradientStatus).toBe("loading");
    await ensureInvestigationBufferedGradient(data, {
      getLayerConfig: () => ({ resources: { bufferedGradient: { file: "gradient.geojson" } }, groupId: "nli" }),
      fetchJson: async () => ({}),
    });
    expect(data.bufferedGradientSidecarStatus).toBe("failed");
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

  it("lights the Nova yeshuv outline 43 from a נובה polygon, not sidecar site 100", () => {
    const site = {
      properties: { outlineObjectId: 100, locations: ["נובה"] },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    };
    const yeshuv = {
      properties: { outlineObjectId: 43, OBJECTID: 43, locations: ["נובה"] },
      geometry: { type: "Polygon", coordinates: [[[2, 2], [4, 2], [4, 4], [2, 2]]] },
    };
    const data = createInvestigationTimelineData({
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [{ properties: { timeline_minutes: 500, מיקום: "נובה" } }],
      },
      settlementFeatures: [site, yeshuv],
    });
    const ids = buildInvestigationSettlementOutlineIdsForFrame(data, { achievedPolygonBeats: [500] });
    expect(ids.has("43")).toBe(true);
    expect(ids.has("100")).toBe(false);
  });

  it("merges yeshuv outline 43 when the settlement sidecar only has Nova site 100", async () => {
    const site = {
      properties: { outlineObjectId: 100, locations: ["נובה"] },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    };
    const yeshuv = {
      properties: { OBJECTID: 43 },
      geometry: { type: "Polygon", coordinates: [[[2, 2], [4, 2], [4, 4], [2, 2]]] },
    };
    const data = createInvestigationTimelineData();
    await ensureInvestigationSettlementFeatures(data, {
      investigationSettlementsUrl: "/settlements.json",
      getLayerDataUrl: (id) => (id === "projector_base.ישובים" ? "/yeshuvim.json" : null),
      fetchJson: async (url) => {
        if (url === "/settlements.json") return { features: [site] };
        if (url === "/yeshuvim.json") return { features: [yeshuv] };
        return null;
      },
    });
    expect(data.settlementFeaturesByOutlineId.get("43")?.geometry).toEqual(yeshuv.geometry);
    expect(data.settlementFeaturesByOutlineId.get("100")?.geometry).toEqual(site.geometry);
  });

  it("falls back to the pack yeshuvim URL when the layer registry is not initialized", async () => {
    const site = {
      properties: { outlineObjectId: 100, locations: ["נובה"] },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    };
    const yeshuv = {
      properties: { OBJECTID: 43 },
      geometry: { type: "Polygon", coordinates: [[[2, 2], [4, 2], [4, 4], [2, 2]]] },
    };
    const yeshuvimUrl = `/otef-interactive/public/processed/layers/projector_base/${encodeURIComponent("ישובים.geojson")}`;
    const data = createInvestigationTimelineData();
    await ensureInvestigationSettlementFeatures(data, {
      investigationSettlementsUrl: "/settlements.json",
      fetchJson: async (url) => {
        if (url === "/settlements.json") return { features: [site] };
        if (url === yeshuvimUrl) return { features: [yeshuv] };
        return null;
      },
    });
    expect(data.settlementFeaturesByOutlineId.get("43")?.geometry).toEqual(yeshuv.geometry);
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
