import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nliStyles from "../../public/processed/layers/nli/styles.json";
import {
  collectTimelineBeats,
  disposeInvestigationTimelineForMap,
  INVESTIGATION_POLYGONS_FULL_ID,
  objectIdsActiveAt,
  parseLocalTimelineToMinutes,
  syncInvestigationTimelineToMap,
  TIMELINE_BEAT_MS,
  timelinePhaseAt,
} from "../../frontend/src/shared/maplibre-investigation-timeline.js";

const INVESTIGATION_FEATURES = [
  { properties: { OBJECTID: 1, Name: "מרחב כניסה לקיבוץ", timeline: "local 07:15", timeline_minutes: 435 } },
  { properties: { OBJECTID: 2, Name: "קרב בבית פרטי", timeline: "local 12:20", timeline_minutes: 740 } },
  { properties: { OBJECTID: 3, Name: "גן הדר ובריכה", timeline: "local 09:20", timeline_minutes: 560 } },
  { properties: { OBJECTID: 4, Name: "מגורי תושבים זרים, רפתות ומוסכים", timeline: "local 07:00", timeline_minutes: 420 } },
  { properties: { OBJECTID: 5, Name: "מרחב הנחיתות", timeline: "local 11:40", timeline_minutes: 700 } },
  { properties: { OBJECTID: 6, Name: "חדירה דרך השער הקדמי", timeline: "local 09:30", timeline_minutes: 570 } },
  { properties: { OBJECTID: 7, Name: "חדירה ליישוב מהשער האחורי שליד שכונת שדות", timeline: "local 07:00", timeline_minutes: 420 } },
  { properties: { OBJECTID: 8, Name: "חדירה מדרום, מכיוון הרפתות", timeline: "local 09:30", timeline_minutes: 570 } },
  { properties: { OBJECTID: 9, Name: "מוקד חטיפה", timeline: "local 09:30", timeline_minutes: 570 } },
  { properties: { OBJECTID: 12, Name: "השכונה הצפונית", timeline: "local 06:40", timeline_minutes: 400 } },
  { properties: { OBJECTID: 13, Name: 'שכונת "דור צעיר"', timeline: "local 09:30", timeline_minutes: 570 } },
  { properties: { OBJECTID: 14, Name: "השכונה הדרומית", timeline: "local 07:00", timeline_minutes: 420 } },
  { properties: { OBJECTID: 15, Name: "שכונת ההרחבה", timeline: "local 06:50", timeline_minutes: 410 } },
];

describe("investigation polygon timeline", () => {
  it("parses local 07:15 to 435 minutes", () => {
    expect(parseLocalTimelineToMinutes("local 07:15")).toBe(435);
  });

  it("collects eight sorted beats and OBJECTIDs 4,7,14 at 07:00", () => {
    const beats = collectTimelineBeats(INVESTIGATION_FEATURES);
    expect(beats).toEqual([400, 410, 420, 435, 560, 570, 700, 740]);
    expect(objectIdsActiveAt(INVESTIGATION_FEATURES, 420)).toEqual([4, 7, 14]);
  });

  it("processed investigation style animation is timeline", () => {
    expect(nliStyles.investigation_polygons?.animation?.type).toBe("timeline");
  });

  it("does not import route-progress helpers", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.resolve(here, "../../frontend/src/shared/maplibre-investigation-timeline.js"),
      "utf8",
    );
    expect(src).not.toMatch(/maplibre-route-progress-overlay/);
    expect(src).not.toMatch(/syncRouteProgressOverlaysToMap/);
    expect(src).not.toMatch(/usesRouteProgressOverlay/);
    expect(src).not.toMatch(/maplibre-flow-animation/);
  });

  it("hold phase after last beat treats every polygon as past", () => {
    const beats = [400, 410, 420];
    const holdStart = beats.length * TIMELINE_BEAT_MS;
    expect(timelinePhaseAt(holdStart, beats)).toEqual({ mode: "hold", clock: null, index: -1 });
    expect(timelinePhaseAt(0, beats)).toEqual({ mode: "beat", clock: 400, index: 0 });
  });
});

describe("syncInvestigationTimelineToMap", () => {
  beforeEach(() => {
    let id = 0;
    vi.stubGlobal("requestAnimationFrame", (cb) => {
      return ++id;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function makeMap() {
    const fillId = "nli__investigation_polygons__fill__0";
    const lineId = "nli__investigation_polygons__line__1";
    const paints = {
      [fillId]: { "fill-opacity": 0.4, "fill-color": "#f79009" },
      [lineId]: { "line-opacity": 1, "line-width": 1.6, "line-color": "#b54708" },
    };
    const layers = [
      { id: fillId, type: "fill", source: "nli__investigation_polygons" },
      { id: lineId, type: "line", source: "nli__investigation_polygons" },
    ];
    return {
      getStyle: vi.fn(() => ({ layers })),
      getLayer: vi.fn((id) => layers.find((layer) => layer.id === id)),
      getPaintProperty: vi.fn((id, key) => paints[id]?.[key]),
      setPaintProperty: vi.fn((id, key, value) => {
        if (!paints[id]) paints[id] = {};
        paints[id][key] = value;
      }),
      getContainer: vi.fn(() => {
        const el = { querySelector: () => null, appendChild: vi.fn() };
        return el;
      }),
    };
  }

  it("sets fill/line paint from timeline_minutes and restores on stop", async () => {
    const map = makeMap();
    const groups = [
      {
        id: "nli",
        layers: [{ id: "investigation_polygons", enabled: true }],
      },
    ];
    await syncInvestigationTimelineToMap(
      map,
      { [INVESTIGATION_POLYGONS_FULL_ID]: true },
      groups,
      { features: INVESTIGATION_FEATURES, now: () => 0 },
    );
    expect(map.setPaintProperty).toHaveBeenCalled();
    const fillCalls = map.setPaintProperty.mock.calls.filter((call) => call[1] === "fill-opacity");
    expect(fillCalls.length).toBeGreaterThan(0);
    expect(JSON.stringify(fillCalls[0][2])).toContain("timeline_minutes");

    await syncInvestigationTimelineToMap(map, { [INVESTIGATION_POLYGONS_FULL_ID]: false }, groups, {
      features: INVESTIGATION_FEATURES,
    });
    const restored = map.setPaintProperty.mock.calls.filter(
      (call) => call[0].includes("investigation_polygons") && call[1] === "fill-opacity" && call[2] === 0.4,
    );
    expect(restored.length).toBeGreaterThan(0);
    disposeInvestigationTimelineForMap(map);
  });

  it("skips when the polygon layer is not enabled", async () => {
    const map = makeMap();
    await syncInvestigationTimelineToMap(
      map,
      { [INVESTIGATION_POLYGONS_FULL_ID]: true },
      [{ id: "nli", layers: [{ id: "investigation_polygons", enabled: false }] }],
      { features: INVESTIGATION_FEATURES },
    );
    expect(map.setPaintProperty).not.toHaveBeenCalled();
  });
});
