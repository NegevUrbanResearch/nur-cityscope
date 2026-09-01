import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildInvestigationSettlementIndexes,
  getInvestigationTimelineDiagnostics,
  prepareInvestigationTimelineForStyleReload,
  syncInvestigationTimelineToMap,
} from "../../frontend/src/shared/maplibre-investigation-timeline.js";
import { playNliClock, idleNliClock, stopNliClock } from "../../frontend/src/shared/nli-investigation-clock.js";
import {
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
  INVESTIGATION_ALARMS_FULL_ID,
  TIMELINE_BEAT_MS,
} from "../../frontend/src/shared/nli-investigation-beats.js";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import * as telemetry from "../../frontend/src/map/perf-telemetry.js";

const groups = [{
  id: "nli",
  layers: [
    { id: "investigation_polygons", enabled: true },
    { id: "lines", enabled: true },
    { id: "alarms", enabled: true },
  ],
}];

const features = {
  [INVESTIGATION_POLYGONS_FULL_ID]: [{
    properties: { OBJECTID: 1, timeline_minutes: 400 },
    geometry: { type: "Polygon", coordinates: [] },
  }],
  [INVESTIGATION_LINES_FULL_ID]: [{
    properties: { OBJECTID: 2, timeline_minutes: 400, flow_direction: "east" },
    geometry: { type: "LineString", coordinates: [[34, 31], [35, 32]] },
  }],
};

const SETTLEMENT_URL = "/otef-interactive/public/processed/layers/nli/investigation_settlements.geojson";

function settlementFeature(outlineObjectId = 42, locations = ["עיר א"]) {
  return {
    type: "Feature",
    id: `nli-settlement-outline-${outlineObjectId}`,
    properties: { outlineObjectId, locations },
    geometry: { type: "Polygon", coordinates: [[[34, 31], [34.1, 31], [34.1, 31.1], [34, 31]]] },
  };
}

function mapWithHostLayers() {
  return createFakeMapLibreMap({
    layers: [
      { id: "host__people_names", type: "symbol", source: "host" },
      { id: "nli__investigation_polygons__fill__0", type: "fill", source: "nli__investigation_polygons" },
      { id: "nli__investigation_polygons__line__1", type: "line", source: "nli__investigation_polygons" },
      { id: "nli__lines__line__0", type: "line", source: "nli__lines" },
      { id: "nli__alarms__circle__0", type: "circle", source: "nli__alarms" },
    ],
    paints: {
      "nli__investigation_polygons__fill__0": { "fill-opacity": 0.4, "fill-color": "#f79009" },
      "nli__lines__line__0": { "line-opacity": 1 },
      "nli__alarms__circle__0": { "circle-opacity": 0.4 },
    },
  });
}

describe("Task 8 investigation timeline coordinator", () => {
  it("records complete scheduler callback duration through the telemetry seam", async () => {
    telemetry.reset();
    const map = mapWithHostLayers();
    const monotonic = [0, 7];
    const clock = playNliClock(idleNliClock(), [INVESTIGATION_LINES_FULL_ID], [400], 0);
    await syncInvestigationTimelineToMap(map, clock, groups, {
      featuresById: features,
      now: () => 0,
      monotonicNow: () => monotonic.shift() ?? 7,
    });
    expect(map.driveAnimationFrame(16)).toBe(true);
    expect(telemetry.summary().nliSchedulerMs).toMatchObject({ count: 1, max: 7 });
  });

  it("models duplicate rejection, before-layer order, and manual RAF", () => {
    const map = createFakeMapLibreMap({ layers: [{ id: "anchor", type: "symbol" }] });
    expect(() => map.addLayer({ id: "anchor", type: "line" })).toThrow();
    map.addSource("s", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "overlay", type: "line", source: "s" }, "anchor");
    expect(map.getStyle().layers.map((layer) => layer.id)).toEqual(["overlay", "anchor"]);
    let timestamp = null;
    map.requestAnimationFrame((value) => { timestamp = value; });
    expect(map.driveAnimationFrame(123)).toBe(true);
    expect(timestamp).toBe(123);
  });

  it("exports the style reload preparation hook", () => {
    expect(prepareInvestigationTimelineForStyleReload).toEqual(expect.any(Function));
  });

  it("intersects semantic membership with visible NLI layers and keeps one RAF", async () => {
    const map = mapWithHostLayers();
    const clock = playNliClock(
      idleNliClock(),
      [INVESTIGATION_POLYGONS_FULL_ID, INVESTIGATION_LINES_FULL_ID],
      [400],
      0,
    );
    await syncInvestigationTimelineToMap(map, clock, [{
      id: "nli",
      layers: [
        { id: "investigation_polygons", enabled: true },
        { id: "lines", enabled: false },
      ],
    }], { featuresById: features, now: () => 0, displayProfile: "gis" });
    expect(map.pendingAnimationFrameCount()).toBe(1);
    expect(map.getLayer("nli-investigation-line-future")).toBeNull();
    expect(map.getLayer("nli-investigation-settlement-impact-outline")).not.toBeNull();
  });

  it("uses the selected profile anchor and preserves shared semantic beats", async () => {
    const map = mapWithHostLayers();
    await syncInvestigationTimelineToMap(map, playNliClock(
      idleNliClock(),
      [INVESTIGATION_LINES_FULL_ID],
      [400],
      0,
    ), groups, {
      featuresById: features,
      beforeId: "host__people_names",
      displayProfile: "projection",
      now: () => 0,
    });
    const order = map.getStyle().layers.map((layer) => layer.id);
    expect(order.indexOf("nli-investigation-line-future-line")).toBeLessThan(order.indexOf("host__people_names"));
    const width = map.getLayer("nli-investigation-line-future-line").paint["line-width"];
    expect(width).toBeCloseTo(1.2 * 1.2);
  });

  it("keeps completed route flow alive at the 15 fps cadence in full motion", async () => {
    const map = mapWithHostLayers();
    let now = 3200;
    const clock = {
      phase: "paused",
      membership: [INVESTIGATION_LINES_FULL_ID],
      beats: [400],
      loop: false,
      positionMs: 3200,
      anchorMs: 3200,
      seekKind: "none",
      revision: 1,
    };
    await syncInvestigationTimelineToMap(map, clock, groups, {
      featuresById: features,
      now: () => now,
      motionMode: "full",
    });
    const styleScans = map.getStyleCallCount();
    expect(map.pendingAnimationFrameCount()).toBe(1);
    expect(map.listenerCount("style.load")).toBe(1);
    const flowPaintWrites = () => map.calls.filter(
      (call) => call.method === "setPaintProperty" &&
        call.id === "nli-investigation-line-completed-motion-line" &&
        call.key === "line-gradient",
    ).length;
    const before = flowPaintWrites();
    now += 16;
    expect(map.driveAnimationFrame(16)).toBe(true);
    const at16 = flowPaintWrites();
    expect(at16).toBe(before);
    now += 66;
    expect(map.driveAnimationFrame(82)).toBe(true);
    const at82 = flowPaintWrites();
    expect(at82).toBeGreaterThan(before);
    expect(map.getStyleCallCount()).toBe(styleScans);
    expect(map.calls.filter((call) => call.method === "moveLayer")).toEqual([]);
  });

  it("does not schedule ambient completed flow in reduced motion", async () => {
    const map = mapWithHostLayers();
    await syncInvestigationTimelineToMap(map, {
      phase: "paused",
      membership: [INVESTIGATION_LINES_FULL_ID],
      beats: [400],
      loop: false,
      positionMs: 3200,
      anchorMs: 3200,
      seekKind: "none",
      revision: 2,
    }, groups, { featuresById: features, now: () => 3200, motionMode: "reduced" });
    expect(map.pendingAnimationFrameCount()).toBe(0);
  });

  it("keeps idle final-state route flow static in reduced motion", async () => {
    const map = mapWithHostLayers();
    const lineGroups = [{ id: "nli", layers: [{ id: "lines", enabled: true }] }];
    await syncInvestigationTimelineToMap(map, idleNliClock(), lineGroups, {
      featuresById: features,
      now: () => 3200,
      motionMode: "reduced",
    });
    expect(map.pendingAnimationFrameCount()).toBe(0);
    expect(map.getSource("nli-investigation-line-completed-motion")).not.toBeNull();
    expect(map.getSource("nli-investigation-line-completed-motion").data.features).toHaveLength(1);
  });

  it("keeps ambient completed flow and schedules its frame on Stop", async () => {
    const map = mapWithHostLayers();
    const clock = {
      phase: "paused",
      membership: [INVESTIGATION_LINES_FULL_ID],
      beats: [400],
      loop: false,
      positionMs: TIMELINE_BEAT_MS,
      anchorMs: TIMELINE_BEAT_MS,
      seekKind: "none",
      revision: 31,
    };
    await syncInvestigationTimelineToMap(map, clock, groups, {
      featuresById: features,
      now: () => TIMELINE_BEAT_MS,
      motionMode: "full",
    });

    const flowPaintWrites = () => map.calls.filter(
      (call) => call.method === "setPaintProperty" &&
        call.id === "nli-investigation-line-completed-motion-line" &&
        call.key === "line-gradient",
    ).length;
    expect(map.getLayer("nli-investigation-line-completed-motion-line")).toBeTruthy();
    expect(map.getSource("nli-investigation-line-completed-motion")).toBeTruthy();
    expect(map.pendingAnimationFrameCount()).toBe(1);
    const writesBeforeStop = flowPaintWrites();

    await syncInvestigationTimelineToMap(map, stopNliClock(clock), groups, {
      featuresById: features,
      now: () => TIMELINE_BEAT_MS,
      motionMode: "full",
    });

    expect(map.getLayer("nli-investigation-line-completed-motion-line")).not.toBeNull();
    expect(map.getSource("nli-investigation-line-completed-motion")).not.toBeNull();
    expect(map.pendingAnimationFrameCount()).toBe(1);
    expect(map.driveAnimationFrame(TIMELINE_BEAT_MS + 66)).toBe(true);
    expect(flowPaintWrites()).toBeGreaterThan(writesBeforeStop);
  });

  it("does not remount settlement outlines on a post-Stop ambient route tick", async () => {
    const map = mapWithHostLayers();
    let now = 0;
    const settlement = settlementFeature(42);
    const clock = playNliClock(
      idleNliClock(),
      [INVESTIGATION_LINES_FULL_ID],
      [400],
      0,
    );
    await syncInvestigationTimelineToMap(map, clock, groups, {
      featuresById: features,
      settlementFeatures: [settlement],
      now: () => now,
    });
    await syncInvestigationTimelineToMap(map, stopNliClock(clock), groups, {
      featuresById: features,
      settlementFeatures: [settlement],
      now: () => now,
    });

    expect(map.getSource("nli-investigation-settlement-impact")).toBeNull();
    now = 66;
    expect(map.driveAnimationFrame(66)).toBe(true);
    expect(map.getSource("nli-investigation-settlement-impact")).toBeNull();
  });

  it("does not remount old renderer handles after style preparation", async () => {
    const map = mapWithHostLayers();
    const clock = playNliClock(idleNliClock(), [INVESTIGATION_POLYGONS_FULL_ID], [400], 0);
    await syncInvestigationTimelineToMap(map, clock, groups, { featuresById: features, now: () => 0 });
    prepareInvestigationTimelineForStyleReload(map);
    map.wipeStyle();
    map.emit("style.load");
    expect(map.getStyle().layers).toEqual([]);
  });

  it("remounts idle final-state route flow after a style reload", async () => {
    const map = mapWithHostLayers();
    const lineGroups = [{ id: "nli", layers: [{ id: "lines", enabled: true }] }];
    const deps = { featuresById: features, now: () => 3200, motionMode: "full" };
    await syncInvestigationTimelineToMap(map, idleNliClock(), lineGroups, deps);
    expect(map.getLayer("nli-investigation-line-completed-motion-line")).not.toBeNull();

    prepareInvestigationTimelineForStyleReload(map);
    map.wipeStyle();
    map.addLayer({ id: "host__people_names", type: "symbol", source: "host" });
    map.addLayer({ id: "nli__lines__line__0", type: "line", source: "nli__lines" });
    map.emit("style.load");
    await syncInvestigationTimelineToMap(map, idleNliClock(), lineGroups, deps);

    expect(map.getLayer("nli-investigation-line-completed-motion-line")).not.toBeNull();
    expect(map.getSource("nli-investigation-line-completed-motion").data.features).toHaveLength(1);
  });

  it("preserves completed alarm onset history across a two-phase style reload", async () => {
    const map = mapWithHostLayers();
    const clock = playNliClock(idleNliClock(), ["nli.alarms"], [400], 0);
    const stableClock = { ...clock, revision: 17 };
    const alarmFeatures = [{
      id: "A",
      properties: { city: "A", alarm_minutes: [400], alarm_count_total: 1 },
      geometry: { type: "Point", coordinates: [34, 31] },
    }];
    await syncInvestigationTimelineToMap(map, stableClock, groups, {
      featuresById: { "nli.alarms": alarmFeatures },
      now: () => 900,
    });
    const first = map.getSource("nli-investigation-alarm-points").data.features;
    expect(first[0].properties.onset).toBe(false);
    prepareInvestigationTimelineForStyleReload(map);
    map.wipeStyle();
    map.addLayer({ id: "host__people_names", type: "symbol", source: "host" });
    map.addLayer({ id: "nli__investigation_polygons__fill__0", type: "fill", source: "nli__investigation_polygons" });
    map.addLayer({ id: "nli__investigation_polygons__line__1", type: "line", source: "nli__investigation_polygons" });
    map.addLayer({ id: "nli__alarms__circle__0", type: "circle", source: "nli__alarms" });
    map.emit("style.load");
    await syncInvestigationTimelineToMap(map, stableClock, groups, {
      featuresById: { "nli.alarms": alarmFeatures },
      now: () => 900,
    });
    const after = map.getSource("nli-investigation-alarm-points").data.features;
    expect(after[0].properties.onset).toBe(false);
  });

  it("keeps one alarm onset through manual RAF samples until 900ms, then ends it once", async () => {
    const map = mapWithHostLayers();
    let now = 0;
    const clock = playNliClock(idleNliClock(), [INVESTIGATION_ALARMS_FULL_ID], [400], 0);
    const alarmFeatures = [{
      id: "alarm-a",
      properties: { city: "עיר א", alarm_minutes: [400], alarm_count_total: 1 },
      geometry: { type: "Point", coordinates: [34, 31] },
    }];
    const deps = {
      featuresById: { [INVESTIGATION_ALARMS_FULL_ID]: alarmFeatures },
      now: () => now,
      monotonicNow: () => 0,
    };
    const onset = () => map.getSource("nli-investigation-alarm-points")?.data?.features?.[0]?.properties?.onset;

    await syncInvestigationTimelineToMap(map, clock, groups, deps);
    expect(onset()).toBe(true);
    now = 66;
    expect(map.driveAnimationFrame(66)).toBe(true);
    expect(onset()).toBe(true);
    now = 899;
    expect(map.driveAnimationFrame(899)).toBe(true);
    expect(onset()).toBe(true);
    now = 900;
    expect(map.driveAnimationFrame(900)).toBe(true);
    expect(onset()).toBe(false);
    const rowsAtEnd = map.calls.filter((call) => call.method === "setData" && call.id === "nli-investigation-alarm-points").length;
    now = 966;
    expect(map.driveAnimationFrame(966)).toBe(true);
    expect(onset()).toBe(false);
    expect(map.calls.filter((call) => call.method === "setData" && call.id === "nli-investigation-alarm-points").length).toBe(rowsAtEnd);
  });

  it("renders the terminal frame for an ordinary paused alarm ripple before stopping RAF", async () => {
    const map = mapWithHostLayers();
    let now = 400;
    const clock = {
      phase: "paused",
      membership: [INVESTIGATION_ALARMS_FULL_ID],
      beats: [400],
      loop: false,
      positionMs: 0,
      anchorMs: 400,
      alarmOnsetOriginMs: 0,
      seekKind: "none",
      revision: 19,
    };
    const alarmFeatures = [{
      id: "paused-alarm",
      properties: { city: "עיר א", alarm_minutes: [400], alarm_count_total: 1 },
      geometry: { type: "Point", coordinates: [34, 31] },
    }];
    const onset = () => map.getSource("nli-investigation-alarm-points")?.data?.features?.[0]?.properties?.onset;
    const ringOpacity = () => map.getPaintProperty("nli-investigation-alarm-ripple", "circle-stroke-opacity");

    await syncInvestigationTimelineToMap(map, clock, groups, {
      featuresById: { [INVESTIGATION_ALARMS_FULL_ID]: alarmFeatures },
      now: () => now,
    });
    expect(onset()).toBe(true);
    expect(ringOpacity()).toBeGreaterThan(0);
    expect(map.pendingAnimationFrameCount()).toBe(1);

    now = 899;
    expect(map.driveAnimationFrame(899)).toBe(true);
    expect(onset()).toBe(true);
    expect(ringOpacity()).toBeGreaterThan(0);

    now = 900;
    expect(map.driveAnimationFrame(900)).toBe(true);
    expect(onset()).toBe(false);
    expect(ringOpacity()).toBe(0);
    expect(map.pendingAnimationFrameCount()).toBe(0);

    now = 966;
    expect(map.driveAnimationFrame(966)).toBe(false);
    expect(onset()).toBe(false);
    expect(ringOpacity()).toBe(0);
    expect(map.pendingAnimationFrameCount()).toBe(0);
  });

  it("rehydrates an active alarm onset through style remount without a false edge", async () => {
    const map = mapWithHostLayers();
    let now = 400;
    const clock = {
      phase: "paused",
      membership: [INVESTIGATION_ALARMS_FULL_ID],
      beats: [400],
      loop: false,
      positionMs: 0,
      anchorMs: 400,
      alarmOnsetOriginMs: 0,
      seekKind: "none",
      revision: 20,
    };
    const alarmFeatures = [{
      id: "remount-alarm",
      properties: { city: "עיר א", alarm_minutes: [400], alarm_count_total: 1 },
      geometry: { type: "Point", coordinates: [34, 31] },
    }];
    const deps = {
      featuresById: { [INVESTIGATION_ALARMS_FULL_ID]: alarmFeatures },
      now: () => now,
    };
    const onset = () => map.getSource("nli-investigation-alarm-points")?.data?.features?.[0]?.properties?.onset;

    await syncInvestigationTimelineToMap(map, clock, groups, deps);
    expect(onset()).toBe(true);
    const remountCallStart = map.calls.length;

    prepareInvestigationTimelineForStyleReload(map);
    map.wipeStyle();
    map.addLayer({ id: "host__people_names", type: "symbol", source: "host" });
    map.addLayer({ id: "nli__investigation_polygons__fill__0", type: "fill", source: "nli__investigation_polygons" });
    map.addLayer({ id: "nli__investigation_polygons__line__1", type: "line", source: "nli__investigation_polygons" });
    map.addLayer({ id: "nli__alarms__circle__0", type: "circle", source: "nli__alarms" });
    map.emit("style.load");
    await syncInvestigationTimelineToMap(map, clock, groups, deps);
    expect(onset()).toBe(true);
    const remountOnsets = () => map.calls
      .slice(remountCallStart)
      .filter((call) => call.method === "setData" && call.id === "nli-investigation-alarm-points")
      .map((call) => call.data.features[0]?.properties?.onset);
    expect(remountOnsets()).toEqual([true]);

    now = 899;
    expect(map.driveAnimationFrame(899)).toBe(true);
    expect(onset()).toBe(true);
    expect(remountOnsets()).toEqual([true]);

    now = 900;
    expect(map.driveAnimationFrame(900)).toBe(true);
    expect(onset()).toBe(false);
    expect(remountOnsets()).toEqual([true, false]);
    expect(map.pendingAnimationFrameCount()).toBe(0);

    now = 966;
    expect(map.driveAnimationFrame(966)).toBe(false);
    expect(onset()).toBe(false);
    expect(remountOnsets()).toEqual([true, false]);
  });

  it("builds exact settlement location and outline indexes from sidecar properties", () => {
    const feature = settlementFeature(42, ["עיר א", "עיר ב"]);
    const indexes = buildInvestigationSettlementIndexes([feature]);
    expect(indexes.locationToOutlineObjectId.get("עיר א")).toBe(42);
    expect(indexes.locationToOutlineObjectId.get("עיר ב")).toBe(42);
    expect(indexes.settlementFeaturesByOutlineId.get("42")).toBe(feature);
  });

  it.each(["gis", "projection"])("loads production settlement sidecar for the %s profile", async (displayProfile) => {
    const map = mapWithHostLayers();
    const polygonFeatures = [{
      properties: { OBJECTID: 1, timeline_minutes: 400, מיקום: "עיר א" },
      geometry: { type: "Polygon", coordinates: [[[34, 31], [34.1, 31], [34.1, 31.1], [34, 31]]] },
    }];
    const calls = [];
    await syncInvestigationTimelineToMap(
      map,
      playNliClock(idleNliClock(), [INVESTIGATION_POLYGONS_FULL_ID], [400], 0),
      groups,
      {
        displayProfile,
        featuresById: { [INVESTIGATION_POLYGONS_FULL_ID]: polygonFeatures },
        getLayerDataUrl: () => null,
        fetchJson: async (url) => {
          calls.push(url);
          return { type: "FeatureCollection", features: [settlementFeature()] };
        },
        now: () => 0,
      },
    );
    expect(calls).toContain(SETTLEMENT_URL);
    expect(map.getSource("nli-investigation-settlement-impact").data.features).toHaveLength(1);
    expect(map.getSource("nli-investigation-settlement-impact").data.features[0].properties.outlineObjectId).toBe(42);
  });

  it("renders route-triggered settlement outlines with lines on and polygons off", async () => {
    const map = createFakeMapLibreMap({
      layers: [
        { id: "host__people_names", type: "symbol", source: "host" },
        { id: "nli__lines__line__0", type: "line", source: "nli__lines" },
        { id: "nli__alarms__circle__0", type: "circle", source: "nli__alarms" },
      ],
      paints: { "nli__lines__line__0": { "line-opacity": 1 } },
    });
    const route = {
      properties: { OBJECTID: 2, timeline_minutes: 400, flow_direction: "forward" },
      geometry: { type: "LineString", coordinates: [[33.9, 31], [34.2, 31]] },
    };
    const settlement = settlementFeature(42, ["עיר א"]);
    const calls = [];
    await syncInvestigationTimelineToMap(
      map,
      {
        phase: "paused",
        membership: [INVESTIGATION_LINES_FULL_ID],
        beats: [400],
        loop: false,
        positionMs: TIMELINE_BEAT_MS,
        anchorMs: TIMELINE_BEAT_MS,
        seekKind: "none",
        revision: 1,
      },
      [{ id: "nli", layers: [{ id: "lines", enabled: true }, { id: "investigation_polygons", enabled: false }] }],
      {
        featuresById: { [INVESTIGATION_LINES_FULL_ID]: [route] },
        getLayerDataUrl: () => null,
        fetchJson: async (url) => {
          calls.push(url);
          return { type: "FeatureCollection", features: [settlement] };
        },
        now: () => TIMELINE_BEAT_MS,
      },
    );

    expect(calls).toContain(SETTLEMENT_URL);
    expect(map.getSource("nli-investigation-settlement-impact").data.features).toEqual([settlement]);
    expect(map.getLayer("nli-investigation-polygon-future-fill")).toBeNull();
  });

  it("fails closed when the production settlement sidecar is missing or blocked", async () => {
    const map = mapWithHostLayers();
    const calls = [];
    await expect(syncInvestigationTimelineToMap(
      map,
      playNliClock(idleNliClock(), [INVESTIGATION_POLYGONS_FULL_ID], [400], 0),
      groups,
      {
        featuresById: { [INVESTIGATION_POLYGONS_FULL_ID]: features[INVESTIGATION_POLYGONS_FULL_ID] },
        getLayerDataUrl: () => null,
        fetchJson: async (url) => { calls.push(url); return null; },
        now: () => 0,
      },
    )).resolves.toBeUndefined();
    expect(calls).toContain(SETTLEMENT_URL);
    expect(map.getSource("nli-investigation-settlement-impact").data.features).toEqual([]);
  });

  it("refetches all feature bags and the settlement sidecar when dataVersion changes", async () => {
    const map = mapWithHostLayers();
    const calls = [];
    const dataFor = (url) => {
      calls.push(url);
      if (url === SETTLEMENT_URL) return { features: [settlementFeature()] };
      if (url.includes("lines")) return { features: features[INVESTIGATION_LINES_FULL_ID] };
      if (url.includes("alarms")) return { features: [{ properties: { city: "עיר א", alarm_minutes: [400] }, geometry: { type: "Point", coordinates: [34, 31] } }] };
      return { features: features[INVESTIGATION_POLYGONS_FULL_ID] };
    };
    const getLayerDataUrl = (id) => `/processed/${id}`;
    const clock = playNliClock(
      idleNliClock(),
      [INVESTIGATION_POLYGONS_FULL_ID, INVESTIGATION_LINES_FULL_ID, INVESTIGATION_ALARMS_FULL_ID],
      [400],
      0,
    );
    await syncInvestigationTimelineToMap(map, clock, groups, {
      dataVersion: "v1",
      getLayerDataUrl,
      fetchJson: dataFor,
      now: () => 0,
    });
    await syncInvestigationTimelineToMap(map, { ...clock, revision: 2 }, groups, {
      dataVersion: "v2",
      getLayerDataUrl,
      fetchJson: dataFor,
      now: () => 0,
    });
    expect(calls.filter((url) => url === SETTLEMENT_URL)).toHaveLength(2);
    expect(calls.filter((url) => url.includes("investigation_polygons"))).toHaveLength(2);
    expect(calls.filter((url) => url.includes("nli.lines"))).toHaveLength(2);
    expect(calls.filter((url) => url.includes("nli.alarms"))).toHaveLength(2);
  });

  it("does not rebuild line partitions or alarm structural rows on ambient ticks", async () => {
    const map = mapWithHostLayers();
    let now = 3200;
    let linePartitionBuilds = 0;
    let alarmStructuralRowsBuilds = 0;
    const clock = {
      phase: "paused",
      membership: [INVESTIGATION_LINES_FULL_ID, INVESTIGATION_ALARMS_FULL_ID],
      beats: [400],
      loop: false,
      positionMs: TIMELINE_BEAT_MS,
      anchorMs: TIMELINE_BEAT_MS,
      seekKind: "none",
      revision: 7,
    };
    await syncInvestigationTimelineToMap(map, clock, groups, {
      featuresById: {
        [INVESTIGATION_LINES_FULL_ID]: features[INVESTIGATION_LINES_FULL_ID],
        [INVESTIGATION_ALARMS_FULL_ID]: [{ properties: { city: "עיר א", alarm_minutes: [400] }, geometry: { type: "Point", coordinates: [34, 31] } }],
      },
      onLinePartitionBuild: () => { linePartitionBuilds += 1; },
      onAlarmStructuralRowsBuild: () => { alarmStructuralRowsBuilds += 1; },
      now: () => now,
    });
    const first = getInvestigationTimelineDiagnostics(map);
    now += 66;
    expect(map.driveAnimationFrame(now)).toBe(true);
    now += 66;
    expect(map.driveAnimationFrame(now)).toBe(true);
    const second = getInvestigationTimelineDiagnostics(map);
    expect(linePartitionBuilds).toBe(1);
    expect(alarmStructuralRowsBuilds).toBe(1);
    expect(second.linePartitionBuilds).toBe(first.linePartitionBuilds);
    expect(second.alarmStructuralRowsBuilds).toBe(first.alarmStructuralRowsBuilds);
  });

  it("GIS basemap style-load delegates refresh ordering to the map-main lifecycle seam", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const mapMain = fs.readFileSync(path.resolve(here, "../../frontend/src/entries/map-main.js"), "utf8");
    const lifecycle = fs.readFileSync(path.resolve(here, "../../frontend/src/entries/map-main-style-lifecycle.js"), "utf8");
    expect(mapMain).toContain('import { installGisStyleReload } from "./map-main-style-lifecycle.js";');
    expect(mapMain).toContain("installGisStyleReload({");
    expect(mapMain).toContain("refreshLayers: reapplyAfterStyleLoad");
    expect(lifecycle).toContain("syncFlow: false");
    expect(lifecycle.indexOf("await refreshLayers")).toBeLessThan(lifecycle.indexOf("personVisual?.bringToFront?."));
  });
});
