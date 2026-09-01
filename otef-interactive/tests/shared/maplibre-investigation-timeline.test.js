import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const nliStylesPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public/processed/layers/nli/styles.json",
);
const nliStyles = fs.existsSync(nliStylesPath)
  ? JSON.parse(fs.readFileSync(nliStylesPath, "utf8"))
  : null;
import {
  collectPlaybackTimelineBeats,
  collectTimelineBeats,
  collectUnionTimelineBeats,
  disposeInvestigationTimelineForMap,
  INVESTIGATION_ALARMS_FULL_ID,
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
  lineProgressAt,
  objectIdsActiveAt,
  parseLocalTimelineToMinutes,
  previousTimelineBeat,
  syncInvestigationTimelineToMap,
  TIMELINE_BEAT_MS,
  timelinePhaseAt,
} from "../../frontend/src/shared/maplibre-investigation-timeline.js";
import {
  idleNliClock,
  pauseNliClock,
  playNliClock,
  seekNliClock,
} from "../../frontend/src/shared/nli-investigation-clock.js";

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
    if (!nliStyles) return;
    expect(nliStyles.investigation_polygons?.animation?.type).toBe("timeline");
    expect(nliStyles.lines?.animation?.type).toBe("timeline");
  });

  it("keeps the NLI timeline boundary separate from the legacy route driver", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.resolve(here, "../../frontend/src/shared/maplibre-investigation-timeline.js"),
      "utf8",
    );
    expect(src).not.toMatch(/maplibre-route-progress-overlay/);
    expect(src).not.toMatch(/syncRouteProgressOverlaysToMap/);
    expect(src).not.toMatch(/usesRouteProgressOverlay/);
    expect(src).not.toMatch(/maplibre-flow-animation/);
    expect(src).not.toMatch(/export function namesActiveAt/);
  });

  it("hold phase after last beat treats every polygon as past", () => {
    const beats = [400, 410, 420];
    const holdStart = beats.length * TIMELINE_BEAT_MS;
    expect(timelinePhaseAt(holdStart, beats)).toEqual({
      mode: "hold",
      clock: null,
      index: -1,
      beatElapsedMs: 0,
    });
    expect(timelinePhaseAt(0, beats)).toEqual({
      mode: "beat",
      clock: 400,
      index: 0,
      beatElapsedMs: 0,
    });
    expect(timelinePhaseAt(800, beats)).toEqual({
      mode: "beat",
      clock: 400,
      index: 0,
      beatElapsedMs: 800,
    });
  });

  it("unions polygon and line beats onto one clock", () => {
    const lines = [
      { properties: { OBJECTID: 1, timeline_minutes: 390 } },
      { properties: { OBJECTID: 2, timeline_minutes: 420 } },
    ];
    expect(collectUnionTimelineBeats(INVESTIGATION_FEATURES, lines)).toEqual([
      390, 400, 410, 420, 435, 560, 570, 700, 740,
    ]);
  });

  it("uses only the playing layer's beats when the other is off", () => {
    const lines = [
      { properties: { OBJECTID: 1, timeline_minutes: 390 } },
      { properties: { OBJECTID: 2, timeline_minutes: 420 } },
    ];
    expect(collectPlaybackTimelineBeats(true, false, false, INVESTIGATION_FEATURES, lines, [])).toEqual([
      400, 410, 420, 435, 560, 570, 700, 740,
    ]);
    expect(collectPlaybackTimelineBeats(false, true, false, INVESTIGATION_FEATURES, lines, [])).toEqual([
      390, 420,
    ]);
    expect(collectPlaybackTimelineBeats(true, true, false, INVESTIGATION_FEATURES, lines, [])).toEqual([
      390, 400, 410, 420, 435, 560, 570, 700, 740,
    ]);
  });

  it("hitchhikes polygon beats when polygons play with alarms", () => {
    expect(
      collectPlaybackTimelineBeats(true, false, true, INVESTIGATION_FEATURES, [], [
        { properties: { alarm_minutes: [389, 1200] } },
        { properties: { alarm_minutes: [401] } },
      ]),
    ).toEqual([400, 410, 420, 435, 560, 570, 700, 740]);
  });

  it("uses 5-minute bins from city minutes when only alarms play", () => {
    expect(
      collectPlaybackTimelineBeats(false, false, true, [], [], [
        { properties: { alarm_minutes: [389, 391] } },
        { properties: { alarm_minutes: [402] } },
      ]),
    ).toEqual([385, 390, 400]);
  });

  it("previousTimelineBeat is null on first beat and hold", () => {
    expect(previousTimelineBeat([400, 410], 400)).toBeNull();
    expect(previousTimelineBeat([400, 410], null)).toBeNull();
    expect(previousTimelineBeat([400, 410], 410)).toBe(400);
  });

  it("grows a line once during its beat and keeps it full afterward", () => {
    expect(lineProgressAt(420, 400, 0)).toBe(0);
    expect(lineProgressAt(420, 420, 0)).toBe(0);
    expect(lineProgressAt(420, 420, TIMELINE_BEAT_MS / 2)).toBeCloseTo(0.5);
    expect(lineProgressAt(420, 420, TIMELINE_BEAT_MS)).toBe(1);
    expect(lineProgressAt(420, 435, 0)).toBe(1);
    expect(lineProgressAt(420, null, 0)).toBe(1);
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
    const routeId = "nli__lines__line__0";
    const alarmId = "nli__alarms__circle__0";
    const paints = {
      [fillId]: { "fill-opacity": 0.4, "fill-color": "#f79009" },
      [lineId]: { "line-opacity": 1, "line-width": 1.6, "line-color": "#b54708" },
      [routeId]: { "line-opacity": 1, "line-width": 2, "line-color": "#c31f4f" },
      [alarmId]: {
        "circle-radius": 4,
        "circle-color": "#fbbf24",
        "circle-opacity": 0.4,
        "circle-stroke-width": 0.5,
      },
    };
    const layers = [
      { id: fillId, type: "fill", source: "nli__investigation_polygons" },
      { id: lineId, type: "line", source: "nli__investigation_polygons" },
      { id: routeId, type: "line", source: "nli__lines" },
      { id: alarmId, type: "circle", source: "nli__alarms" },
    ];
    const sources = {};
    return {
      getStyle: vi.fn(() => ({ layers })),
      getLayer: vi.fn((id) => layers.find((layer) => layer.id === id)),
      getSource: vi.fn((id) => sources[id] || null),
      addSource: vi.fn((id, spec) => {
        sources[id] = { ...spec, setData: vi.fn() };
      }),
      addLayer: vi.fn((layer) => {
        layers.push(layer);
      }),
      removeLayer: vi.fn((id) => {
        const index = layers.findIndex((layer) => layer.id === id);
        if (index >= 0) layers.splice(index, 1);
      }),
      removeSource: vi.fn((id) => {
        delete sources[id];
      }),
      setFeatureState: vi.fn(),
      getPaintProperty: vi.fn((id, key) => paints[id]?.[key]),
      moveLayer: vi.fn(),
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

  const LINE_FEATURES = [
    {
      properties: { OBJECTID: 9, Name: "כפר עזה - רחפנים", timeline_minutes: 400 },
      geometry: { type: "LineString", coordinates: [[34.4, 31.4], [34.5, 31.5]] },
    },
    {
      properties: { OBJECTID: 1, Name: "עלומים - ציר חדירה ראשון", timeline_minutes: 420 },
      geometry: { type: "LineString", coordinates: [[34.5, 31.3], [34.6, 31.4]] },
    },
    {
      properties: { OBJECTID: 5, Name: "עלומים - חדירה מהשער האבוקדו", timeline_minutes: 740 },
      geometry: { type: "LineString", coordinates: [[34.3, 31.4], [34.4, 31.5]] },
    },
  ];

  const POLYGON_BEATS = collectTimelineBeats(INVESTIGATION_FEATURES);
  const LINE_BEATS = collectTimelineBeats(LINE_FEATURES);

  function bothGroups() {
    return [
      {
        id: "nli",
        layers: [
          { id: "investigation_polygons", enabled: true },
          { id: "lines", enabled: true },
        ],
      },
    ];
  }

  function playClock(membership, beats, nowMs = 0) {
    return playNliClock(idleNliClock(), membership, beats, nowMs);
  }

  function featureBags() {
    return { [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES, [INVESTIGATION_LINES_FULL_ID]: LINE_FEATURES };
  }

  it("renders every visible route in the animated final state while idle and after Stop", async () => {
    const map = makeMap();
    const deps = {
      featuresById: { [INVESTIGATION_LINES_FULL_ID]: LINE_FEATURES },
      getLayerDataUrl: () => null,
      now: () => 1234,
    };
    await syncInvestigationTimelineToMap(
      map,
      idleNliClock(),
      [{ id: "nli", layers: [{ id: "lines", enabled: true }] }],
      deps,
    );
    expect(map.getPaintProperty("nli__lines__line__0", "line-color")).toBe("#c31f4f");
    expect(map.getPaintProperty("nli__lines__line__0", "line-opacity")).toBe(0);
    expect(map.getLayer("nli-investigation-line-completed-carrier-line")).toBeTruthy();
    expect(map.getLayer("nli-investigation-line-completed-motion-line")).toBeTruthy();
    expect(map.getSource("nli-investigation-line-completed-carrier").setData.mock.calls.at(-1)[0].features)
      .toHaveLength(LINE_FEATURES.length);
    expect(map.getSource("nli-investigation-line-completed-motion").setData.mock.calls.at(-1)[0].features)
      .toHaveLength(LINE_FEATURES.length);
    expect(map.setPaintProperty.mock.calls.some(
      ([id, key, value]) => id === "nli-investigation-line-completed-motion-line" &&
        key === "line-gradient" && JSON.stringify(value).includes("line-progress"),
    )).toBe(true);

    const projectionMap = makeMap();
    await syncInvestigationTimelineToMap(
      projectionMap,
      idleNliClock(),
      [{ id: "nli", layers: [{ id: "lines", enabled: true }] }],
      { ...deps, displayProfile: "projection" },
    );
    expect(projectionMap.getPaintProperty("nli-investigation-line-completed-motion-line", "line-width"))
      .toBeGreaterThan(map.getPaintProperty("nli-investigation-line-completed-motion-line", "line-width"));

    await syncInvestigationTimelineToMap(
      map,
      playClock([INVESTIGATION_LINES_FULL_ID], LINE_BEATS),
      bothGroups(),
      deps,
    );
    await syncInvestigationTimelineToMap(
      map,
      idleNliClock(),
      [{ id: "nli", layers: [{ id: "lines", enabled: true }] }],
      deps,
    );
    expect(map.getLayer("nli-investigation-line-completed-motion-line")).toBeTruthy();
    expect(map.getSource("nli-investigation-line-completed-motion").setData.mock.calls.at(-1)[0].features)
      .toHaveLength(LINE_FEATURES.length);
  });

  it("does not churn settlement sources across disabled polygon syncs", async () => {
    const map = makeMap();
    const groups = [{ id: "nli", layers: [{ id: "investigation_polygons", enabled: false }] }];
    const deps = {
      featuresById: { [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES },
      settlementFeatures: [{ type: "Feature", properties: { outlineObjectId: 20 }, geometry: { type: "Polygon", coordinates: [] } }],
      locationToOutlineObjectId: { עלומים: 20 },
      getLayerDataUrl: () => null,
    };
    await syncInvestigationTimelineToMap(map, idleNliClock(), groups, deps);
    await syncInvestigationTimelineToMap(map, idleNliClock(), groups, deps);
    expect(map.addSource.mock.calls.filter(([id]) => id === "nli-investigation-settlement-impact")).toEqual([]);
    expect(map.getSource("nli-investigation-settlement-impact")).toBeFalsy();
  });

  it("restores ordinary polygon paints after an idle sync follows hidden semantic playback", async () => {
    const map = makeMap();
    const visible = [{ id: "nli", layers: [{ id: "investigation_polygons", enabled: true }] }];
    const hidden = [{ id: "nli", layers: [{ id: "investigation_polygons", enabled: false }] }];
    const deps = { featuresById: { [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES }, now: () => 0 };
    const playing = playClock([INVESTIGATION_POLYGONS_FULL_ID], POLYGON_BEATS);

    await syncInvestigationTimelineToMap(map, playing, visible, deps);
    expect(JSON.stringify(map.getPaintProperty("nli__investigation_polygons__fill__0", "fill-color"))).toContain("#c31f4f");
    await syncInvestigationTimelineToMap(map, playing, hidden, deps);
    expect(JSON.stringify(map.getPaintProperty("nli__investigation_polygons__fill__0", "fill-color"))).toContain("#c31f4f");
    await syncInvestigationTimelineToMap(map, idleNliClock(), hidden, deps);
    expect(map.getPaintProperty("nli__investigation_polygons__fill__0", "fill-color")).toBe("#f79009");
    expect(map.getSource("nli-investigation-settlement-impact")).toBeFalsy();
  });

  it("refreshes semantic polygon paint while hidden non-idle membership remains active", async () => {
    const map = makeMap();
    const visible = [{ id: "nli", layers: [{ id: "investigation_polygons", enabled: true }] }];
    const hidden = [{ id: "nli", layers: [{ id: "investigation_polygons", enabled: false }] }];
    let now = 0;
    const deps = { featuresById: { [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES }, now: () => now };
    const playing = playClock([INVESTIGATION_POLYGONS_FULL_ID], POLYGON_BEATS);

    await syncInvestigationTimelineToMap(map, playing, visible, deps);
    await syncInvestigationTimelineToMap(map, playing, hidden, deps);
    now = TIMELINE_BEAT_MS * 2;
    await syncInvestigationTimelineToMap(map, playing, hidden, deps);

    const fillColor = map.getPaintProperty("nli__investigation_polygons__fill__0", "fill-color");
    expect(JSON.stringify(fillColor)).toContain("420");
  });

  it("stops playback and removes line overlays when visibilityLayerGroups has nli off", async () => {
    const map = makeMap();
    const liveOn = bothGroups();
    const slideshowOff = [
      {
        id: "nli",
        layers: [
          { id: "investigation_polygons", enabled: false },
          { id: "lines", enabled: false },
        ],
      },
    ];
    const deps = { featuresById: featureBags(), now: () => 0 };
    await syncInvestigationTimelineToMap(
      map,
      playClock([INVESTIGATION_LINES_FULL_ID], LINE_BEATS),
      liveOn,
      deps,
    );
    expect(map.getLayer("nli-investigation-line-active-line")).toBeTruthy();
    await syncInvestigationTimelineToMap(map, idleNliClock(), liveOn, {
      ...deps,
      visibilityLayerGroups: slideshowOff,
    });
    expect(map.getLayer("nli-investigation-line-active-line")).toBeFalsy();
    expect(map.getSource("nli-investigation-line-active")).toBeFalsy();
    expect(map.getPaintProperty("nli__lines__line__0", "line-color")).toBe("#c31f4f");
    expect(map.getPaintProperty("nli__lines__line__0", "line-opacity")).toBe(0);
    disposeInvestigationTimelineForMap(map);
    expect(map.getPaintProperty("nli__lines__line__0", "line-color")).toBe("#c31f4f");
    expect(map.getPaintProperty("nli__lines__line__0", "line-opacity")).toBe(0);
  });

  it("keeps host routes hidden when visibility is disabled during Pause", async () => {
    const map = makeMap();
    const slideshowOff = [{
      id: "nli",
      layers: [
        { id: "investigation_polygons", enabled: true },
        { id: "lines", enabled: false },
      ],
    }];
    const playing = playClock([INVESTIGATION_LINES_FULL_ID], LINE_BEATS);
    const paused = pauseNliClock(playing, 800);
    const deps = { featuresById: featureBags(), now: () => 800 };
    await syncInvestigationTimelineToMap(map, paused, bothGroups(), deps);
    expect(map.getLayer("nli-investigation-line-active-line")).toBeTruthy();

    await syncInvestigationTimelineToMap(map, paused, bothGroups(), {
      ...deps,
      visibilityLayerGroups: slideshowOff,
    });

    expect(map.getLayer("nli-investigation-line-active-line")).toBeFalsy();
    expect(map.getPaintProperty("nli__lines__line__0", "line-color")).toBe("#c31f4f");
    expect(map.getPaintProperty("nli__lines__line__0", "line-opacity")).toBe(0);
    disposeInvestigationTimelineForMap(map);
  });

  it("partitions future routes strictly and clears the active source at reveal completion", async () => {
    const map = makeMap();
    let now = 10_000;
    let rafCallback = null;
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      rafCallback = callback;
      return 1;
    });
    const clock = { ...playClock([INVESTIGATION_LINES_FULL_ID], LINE_BEATS, now), phase: "paused", seekKind: "jump" };
    await syncInvestigationTimelineToMap(map, clock, bothGroups(), {
      featuresById: { [INVESTIGATION_LINES_FULL_ID]: LINE_FEATURES },
      now: () => now,
    });
    const active = () => map.getSource("nli-investigation-line-active").setData.mock.calls.at(-1)[0].features;
    expect(map.getSource("nli-investigation-line-active")).toBeTruthy();
    now += TIMELINE_BEAT_MS;
    rafCallback();
    expect(active()).toEqual([]);
    expect(map.getSource("nli-investigation-line-completed-carrier").setData.mock.calls.at(-1)[0].features)
      .toHaveLength(1);
    disposeInvestigationTimelineForMap(map);
  });

  it("disposal invalidates a deferred line fetch before it can hide base routes", async () => {
    const map = makeMap();
    let release;
    const deferred = new Promise((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => {
      await deferred;
      return { ok: true, json: async () => ({ features: LINE_FEATURES }) };
    }));
    const pending = syncInvestigationTimelineToMap(
      map,
      { ...playClock([INVESTIGATION_LINES_FULL_ID], LINE_BEATS), revision: 1 },
      bothGroups(),
      { getLayerDataUrl: () => "https://example.test/lines.json", now: () => 0 },
    );
    disposeInvestigationTimelineForMap(map);
    release();
    await pending;
    const hiddenBase = map.setPaintProperty.mock.calls.filter(
      (call) => call[0] === "nli__lines__line__0" && call[1] === "line-opacity" && call[2] === 0,
    );
    expect(hiddenBase).toEqual([]);
  });

  it("explicit disposal restores resting red routes on a live map", async () => {
    const map = makeMap();
    await syncInvestigationTimelineToMap(
      map,
      playClock([INVESTIGATION_LINES_FULL_ID], LINE_BEATS),
      bothGroups(),
      { featuresById: featureBags(), now: () => 0 },
    );
    expect(map.getPaintProperty("nli__lines__line__0", "line-opacity")).toBe(0);
    expect(map.getLayer("nli-investigation-line-active-line")).toBeTruthy();

    disposeInvestigationTimelineForMap(map);

    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(map.getLayer("nli-investigation-line-active-line")).toBeFalsy();
    expect(map.getSource("nli-investigation-line-active")).toBeFalsy();
    expect(map.getPaintProperty("nli__lines__line__0", "line-color")).toBe("#c31f4f");
    expect(map.getPaintProperty("nli__lines__line__0", "line-opacity")).toBe(0.42);
  });

  it("hides base lines that appear after playback already started", async () => {
    const map = makeMap();
    const style = map.getStyle();
    const routeIndex = style.layers.findIndex((layer) => layer.id === "nli__lines__line__0");
    const [route] = style.layers.splice(routeIndex, 1);
    const deps = { featuresById: featureBags(), now: () => 0 };
    await syncInvestigationTimelineToMap(map, playClock([INVESTIGATION_LINES_FULL_ID], LINE_BEATS), bothGroups(), deps);
    const hiddenBefore = map.setPaintProperty.mock.calls.filter(
      (call) => call[0] === "nli__lines__line__0" && call[1] === "line-opacity" && call[2] === 0,
    );
    expect(hiddenBefore).toHaveLength(0);
    style.layers.push(route);
    await syncInvestigationTimelineToMap(map, playClock([INVESTIGATION_LINES_FULL_ID], LINE_BEATS), bothGroups(), deps);
    const hiddenAfter = map.setPaintProperty.mock.calls.filter(
      (call) => call[0] === "nli__lines__line__0" && call[1] === "line-opacity" && call[2] === 0,
    );
    expect(hiddenAfter.length).toBeGreaterThan(0);
    disposeInvestigationTimelineForMap(map);
  });

  it("hides the trail head after the line beat completes", async () => {
    const map = makeMap();
    let now = 0;
    let rafCb = null;
    vi.stubGlobal("requestAnimationFrame", (cb) => {
      rafCb = cb;
      return 1;
    });
    await syncInvestigationTimelineToMap(
      map,
      playClock([INVESTIGATION_LINES_FULL_ID], LINE_BEATS),
      bothGroups(),
      {
        featuresById: featureBags(),
        now: () => now,
      },
    );
    const headData = map.getSource("nli-investigation-line-head").setData;
    expect(headData.mock.calls.at(-1)[0].features).toHaveLength(1);
    now = Math.ceil(TIMELINE_BEAT_MS * 0.999);
    rafCb();
    expect(headData.mock.calls.at(-1)[0].features).toEqual([]);
    disposeInvestigationTimelineForMap(map);
  });

  it("skips the other layer's empty beats when playing lines alone", async () => {
    const map = makeMap();
    let now = 0;
    let rafCb = null;
    vi.stubGlobal("requestAnimationFrame", (cb) => {
      rafCb = cb;
      return 1;
    });
    await syncInvestigationTimelineToMap(
      map,
      playClock([INVESTIGATION_LINES_FULL_ID], LINE_BEATS),
      bothGroups(),
      {
        featuresById: featureBags(),
        now: () => now,
      },
    );
    now = TIMELINE_BEAT_MS;
    rafCb();
    const activeData = map.getSource("nli-investigation-line-active").setData;
    const drawn = activeData.mock.calls.at(-1)[0].features.map((f) => f.properties.OBJECTID);
    expect(drawn).toEqual([1]);
    disposeInvestigationTimelineForMap(map);
  });

  it("re-syncing a playing clock does not reset its anchor", async () => {
    const map = makeMap();
    let now = 800;
    const clock = playClock(
      [INVESTIGATION_POLYGONS_FULL_ID, INVESTIGATION_LINES_FULL_ID],
      collectUnionTimelineBeats(INVESTIGATION_FEATURES, LINE_FEATURES),
      0,
    );
    const deps = {
      featuresById: featureBags(),
      now: () => now,
    };
    await syncInvestigationTimelineToMap(map, clock, bothGroups(), deps);
    now = 1600;
    await syncInvestigationTimelineToMap(map, clock, bothGroups(), deps);
    expect(map.addSource).toHaveBeenCalled();
    const gradient = [...map.setPaintProperty.mock.calls].reverse().find((call) => call[1] === "line-gradient");
    expect(gradient).toBeDefined();
    expect(JSON.stringify(gradient[2])).toContain("line-progress");
    expect(JSON.stringify(gradient[2])).toContain(String(1600 / TIMELINE_BEAT_MS));
    disposeInvestigationTimelineForMap(map);
  });

  it("starts playback when only nli.alarms is playing", async () => {
    const map = makeMap();
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    await syncInvestigationTimelineToMap(
      map,
      playClock(
        [INVESTIGATION_ALARMS_FULL_ID],
        collectPlaybackTimelineBeats(false, false, true, [], [], [{ properties: { alarm_minutes: [389] } }]),
      ),
      [{ id: "nli", layers: [{ id: "alarms", enabled: true }] }],
      {
        featuresById: {
          [INVESTIGATION_ALARMS_FULL_ID]: [{ properties: { alarm_minutes: [389] } }],
        },
        getLayerDataUrl: () => null,
        now: () => 0,
      },
    );
    expect(raf).toHaveBeenCalled();
    disposeInvestigationTimelineForMap(map);
  });

  it("re-syncing a playing clock does not restart RAF or rebuild beats", async () => {
    const map = makeMap();
    let now = 800;
    const armedGroups = [
      {
        id: "nli",
        layers: [
          { id: "investigation_polygons", enabled: true },
          { id: "alarms", enabled: true },
        ],
      },
    ];
    const liveAlarmsOnlyGroups = [
      {
        id: "nli",
        layers: [
          { id: "investigation_polygons", enabled: false },
          { id: "alarms", enabled: true },
        ],
      },
    ];
    const clock = playClock([INVESTIGATION_POLYGONS_FULL_ID], POLYGON_BEATS, 0);
    const deps = {
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES,
        [INVESTIGATION_ALARMS_FULL_ID]: [
          { properties: { alarm_minutes: [389] } },
          { properties: { alarm_minutes: [401] } },
        ],
      },
      getLayerDataUrl: () => null,
      now: () => now,
    };
    await syncInvestigationTimelineToMap(map, clock, armedGroups, deps);
    now = 800 + TIMELINE_BEAT_MS;
    await syncInvestigationTimelineToMap(map, clock, liveAlarmsOnlyGroups, deps);
    const fillOpacity = [...map.setPaintProperty.mock.calls]
      .reverse()
      .find((call) => call[0].includes("investigation_polygons") && call[1] === "fill-opacity");
    expect(JSON.stringify(fillOpacity[2])).toContain("410");
    expect(JSON.stringify(fillOpacity[2])).not.toContain("385");
    cancelAnimationFrame.mockClear();
    await syncInvestigationTimelineToMap(map, clock, liveAlarmsOnlyGroups, deps);
    expect(cancelAnimationFrame).not.toHaveBeenCalled();
    disposeInvestigationTimelineForMap(map);
  });

  it("fetches layers missing from featuresById", async () => {
    const map = makeMap();
    const getLayerDataUrl = vi.fn((id) =>
      id === INVESTIGATION_LINES_FULL_ID ? "https://example.test/lines.json" : null,
    );
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ features: LINE_FEATURES }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    await syncInvestigationTimelineToMap(
      map,
      playClock(
        [INVESTIGATION_POLYGONS_FULL_ID, INVESTIGATION_LINES_FULL_ID],
        collectUnionTimelineBeats(INVESTIGATION_FEATURES, LINE_FEATURES),
      ),
      bothGroups(),
      {
        featuresById: {
          [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES,
        },
        getLayerDataUrl,
        now: () => 0,
      },
    );
    expect(getLayerDataUrl).toHaveBeenCalledWith(INVESTIGATION_LINES_FULL_ID);
    expect(getLayerDataUrl).not.toHaveBeenCalledWith(INVESTIGATION_ALARMS_FULL_ID);
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/lines.json");
    disposeInvestigationTimelineForMap(map);
  });

  it("pause freezes derived beat progress when deps.now advances 10s", async () => {
    let captionEl = null;
    vi.stubGlobal("document", {
      createElement: () => ({
        className: "",
        hidden: true,
        innerHTML: "",
        textContent: "",
        setAttribute() {},
      }),
    });
    const map = makeMap();
    map.getContainer = vi.fn(() => ({
      querySelector: () => captionEl,
      appendChild: (el) => {
        captionEl = el;
      },
    }));
    let now = 800;
    const playing = playNliClock(idleNliClock(), [INVESTIGATION_LINES_FULL_ID], [400, 420, 740], 0);
    const paused = pauseNliClock(playing, 800);
    const deps = {
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES,
        [INVESTIGATION_LINES_FULL_ID]: LINE_FEATURES,
      },
      now: () => now,
    };
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    await syncInvestigationTimelineToMap(map, paused, bothGroups(), deps);
    expect(raf).not.toHaveBeenCalled();
    const gradientAtPause = [...map.setPaintProperty.mock.calls]
      .reverse()
      .find((call) => call[1] === "line-gradient");
    expect(JSON.stringify(gradientAtPause[2])).toContain(String(800 / TIMELINE_BEAT_MS));
    expect(captionEl?.hidden).toBe(false);
    now += 10_000;
    await syncInvestigationTimelineToMap(map, paused, bothGroups(), deps);
    const gradientLater = [...map.setPaintProperty.mock.calls]
      .reverse()
      .find((call) => call[1] === "line-gradient");
    expect(JSON.stringify(gradientLater[2])).toContain(String(800 / TIMELINE_BEAT_MS));
    expect(captionEl?.hidden).toBe(false);
    disposeInvestigationTimelineForMap(map);
  });

  it("seek jump does RAF and progress 0 to 0.5 to 1 at same index", async () => {
    const map = makeMap();
    let now = 10_000;
    let rafCb = null;
    const raf = vi.fn((cb) => {
      rafCb = cb;
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", raf);
    const clock = seekNliClock(idleNliClock(), 1, now, {
      visibleMembership: [INVESTIGATION_LINES_FULL_ID],
      beats: [400, 420, 740],
    });
    const deps = {
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES,
        [INVESTIGATION_LINES_FULL_ID]: LINE_FEATURES,
      },
      now: () => now,
    };
    await syncInvestigationTimelineToMap(map, clock, bothGroups(), deps);
    expect(raf).toHaveBeenCalled();
    const lastGradient = () =>
      [...map.setPaintProperty.mock.calls].reverse().find((call) => call[1] === "line-gradient");
    const lastActiveIds = () =>
      map
        .getSource("nli-investigation-line-active")
        .setData.mock.calls.at(-1)[0]
        .features.map((f) => f.properties.OBJECTID);
    expect(lastActiveIds()).toEqual([1]);
    expect(JSON.stringify(lastGradient()[2])).not.toContain("0.5");

    now = 10_000 + 1600;
    rafCb();
    expect(lastActiveIds()).toEqual([1]);
    expect(JSON.stringify(lastGradient()[2])).toContain(String(1600 / TIMELINE_BEAT_MS));

    now = 10_000 + TIMELINE_BEAT_MS;
    rafCb();
    expect(lastActiveIds()).toEqual([]);
    expect(JSON.stringify(lastGradient()[2])).toContain(String(1 - 0.00015));

    now = 10_000 + 10_000;
    raf.mockClear();
    await syncInvestigationTimelineToMap(map, clock, bothGroups(), deps);
    expect(raf).not.toHaveBeenCalled();
    expect(lastActiveIds()).toEqual([]);
    disposeInvestigationTimelineForMap(map);
  });

  it("jump flash stays native previous-beat for the whole one-shot", async () => {
    const map = makeMap();
    let now = 10_000;
    let rafCb = null;
    vi.stubGlobal("requestAnimationFrame", (cb) => {
      rafCb = cb;
      return 1;
    });
    const clock = {
      ...seekNliClock(idleNliClock(), 1, now, {
        visibleMembership: [INVESTIGATION_ALARMS_FULL_ID],
        beats: [400, 420, 740],
      }),
      revision: 7,
    };
    const groups = [{ id: "nli", layers: [{ id: "alarms", enabled: true }] }];
    const deps = {
      featuresById: {
        [INVESTIGATION_ALARMS_FULL_ID]: [
          {
            properties: { city: "A", alarm_minutes: [400], alarm_count_total: 1 },
            geometry: { type: "Point", coordinates: [34.4, 31.5] },
          },
          {
            properties: { city: "B", alarm_minutes: [420], alarm_count_total: 1 },
            geometry: { type: "Point", coordinates: [34.5, 31.5] },
          },
        ],
      },
      getLayerDataUrl: () => null,
      now: () => now,
    };

    function flashingCities() {
      const source = map.getSource("nli-investigation-alarm-points");
      const fc = source?.setData?.mock.calls.at(-1)?.[0];
      return (fc?.features || [])
        .filter((feature) => feature.properties.onset)
        .map((feature) => feature.properties.city);
    }

    await syncInvestigationTimelineToMap(map, clock, groups, deps);
    expect(flashingCities()).toEqual(["B"]);

    now = 10_000 + 1600;
    rafCb();
    expect(flashingCities()).toEqual([]);

    now = 10_000 + TIMELINE_BEAT_MS;
    rafCb();
    expect(flashingCities()).toEqual([]);

    disposeInvestigationTimelineForMap(map);
    await syncInvestigationTimelineToMap(map, clock, groups, deps);
    expect(flashingCities()).toEqual([]);
  });

  it("explainer alarm cities stay after jump one-shot animation ends", async () => {
    const injected = { className: "", hidden: true, innerHTML: "", textContent: "", setAttribute() {} };
    const map = makeMap();
    let now = 10_000;
    let rafCb = null;
    vi.stubGlobal("requestAnimationFrame", (cb) => {
      rafCb = cb;
      return 1;
    });
    const clock = {
      ...seekNliClock(idleNliClock(), 1, now, {
        visibleMembership: [INVESTIGATION_ALARMS_FULL_ID],
        beats: [400, 420, 740],
      }),
      revision: 11,
    };
    const groups = [{ id: "nli", layers: [{ id: "alarms", enabled: true }] }];
    const deps = {
      captionEl: injected,
      allowMapCaption: false,
      featuresById: {
        [INVESTIGATION_ALARMS_FULL_ID]: [
          {
            properties: { city: "B", alarm_minutes: [420], alarm_count_total: 1 },
            geometry: { type: "Point", coordinates: [34.5, 31.5] },
          },
        ],
      },
      getLayerDataUrl: () => null,
      now: () => now,
    };
    await syncInvestigationTimelineToMap(map, clock, groups, deps);
    expect(injected.innerHTML).toMatch(/B/);
    now = 10_000 + TIMELINE_BEAT_MS;
    rafCb();
    expect(injected.hidden).toBe(false);
    expect(injected.innerHTML).toMatch(/B/);
    expect(injected.innerHTML).toMatch(/nli-tl-row--alarms/);
    disposeInvestigationTimelineForMap(map);
  });

  it("explainer keeps the last timestep after pack hold", async () => {
    const injected = { className: "", hidden: true, innerHTML: "", textContent: "", setAttribute() {} };
    const map = makeMap();
    const start = 10_000;
    let now = start;
    let rafCb = null;
    vi.stubGlobal("requestAnimationFrame", (cb) => {
      rafCb = cb;
      return 1;
    });
    const clock = playNliClock(idleNliClock(), [INVESTIGATION_ALARMS_FULL_ID], [420], start);
    const groups = [{ id: "nli", layers: [{ id: "alarms", enabled: true }] }];
    await syncInvestigationTimelineToMap(map, clock, groups, {
      captionEl: injected,
      allowMapCaption: false,
      featuresById: {
        [INVESTIGATION_ALARMS_FULL_ID]: [
          {
            properties: { city: "B", alarm_minutes: [420], alarm_count_total: 1 },
            geometry: { type: "Point", coordinates: [34.5, 31.5] },
          },
        ],
      },
      getLayerDataUrl: () => null,
      now: () => now,
    });
    now = start + TIMELINE_BEAT_MS + 50;
    rafCb();
    expect(injected.hidden).toBe(false);
    expect(injected.innerHTML).toMatch(/07:00/);
    expect(injected.innerHTML).toMatch(/B/);
    disposeInvestigationTimelineForMap(map);
  });

  it("clock-only projection caption stays visible without rows during playback and hold", async () => {
    const injected = { className: "", hidden: true, innerHTML: "", textContent: "", setAttribute() {} };
    const map = makeMap();
    const start = 10_000;
    let now = start;
    let rafCb = null;
    vi.stubGlobal("requestAnimationFrame", (cb) => {
      rafCb = cb;
      return 1;
    });
    const clock = playNliClock(idleNliClock(), [INVESTIGATION_LINES_FULL_ID], [420], start);
    const groups = [{ id: "nli", layers: [{ id: "lines", enabled: true }] }];
    const deps = {
      captionEl: injected,
      allowMapCaption: false,
      nliCaptionMode: "clock-only",
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [],
        [INVESTIGATION_LINES_FULL_ID]: [
          { properties: { Name: "ציר", timeline_minutes: 420 } },
        ],
      },
      getLayerDataUrl: () => null,
      now: () => now,
    };

    await syncInvestigationTimelineToMap(map, clock, groups, deps);
    expect(injected.hidden).toBe(false);
    expect(injected.innerHTML).toContain("07:00");
    expect(injected.innerHTML).not.toContain("nli-tl-row");

    now = start + TIMELINE_BEAT_MS + 50;
    rafCb();
    expect(injected.hidden).toBe(false);
    expect(injected.innerHTML).toContain("07:00");
    expect(injected.innerHTML).not.toContain("nli-tl-row");
    disposeInvestigationTimelineForMap(map);
  });

  it("jump flash is not re-fired after dispose remount at the same revision", async () => {
    const map = makeMap();
    let now = 0;
    const clock = {
      ...seekNliClock(idleNliClock(), 1, 0, {
        visibleMembership: [INVESTIGATION_ALARMS_FULL_ID],
        beats: [400, 420, 740],
      }),
      revision: 7,
    };
    const groups = [{ id: "nli", layers: [{ id: "alarms", enabled: true }] }];
    const deps = {
      featuresById: {
        [INVESTIGATION_ALARMS_FULL_ID]: [
          {
            properties: { city: "A", alarm_minutes: [400], alarm_count_total: 1 },
            geometry: { type: "Point", coordinates: [34.4, 31.5] },
          },
          {
            properties: { city: "B", alarm_minutes: [420], alarm_count_total: 1 },
            geometry: { type: "Point", coordinates: [34.5, 31.5] },
          },
        ],
      },
      getLayerDataUrl: () => null,
      now: () => now,
    };

    function flashingCities() {
      const source = map.getSource("nli-investigation-alarm-points");
      const fc = source?.setData?.mock.calls.at(-1)?.[0];
      return (fc?.features || [])
        .filter((feature) => feature.properties.onset)
        .map((feature) => feature.properties.city);
    }

    await syncInvestigationTimelineToMap(map, clock, groups, deps);
    expect(flashingCities()).toEqual(["B"]);

    now = TIMELINE_BEAT_MS;
    await syncInvestigationTimelineToMap(map, clock, groups, deps);

    disposeInvestigationTimelineForMap(map);
    await syncInvestigationTimelineToMap(map, clock, groups, deps);
    expect(flashingCities()).toEqual([]);
  });

  it("late client does not replay a completed paused jump after fetch", async () => {
    const map = makeMap();
    let now = 10_000;
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (url === "https://example.test/lines.json") {
          now += 3500;
          return { ok: true, json: async () => ({ features: LINE_FEATURES }) };
        }
        return { ok: true, json: async () => ({ features: [] }) };
      }),
    );
    const clock = {
      ...seekNliClock(idleNliClock(), 1, 10_000, {
        visibleMembership: [INVESTIGATION_LINES_FULL_ID],
        beats: [400, 420, 740],
      }),
      revision: 11,
    };
    await syncInvestigationTimelineToMap(map, clock, bothGroups(), {
      getLayerDataUrl: (id) =>
        id === INVESTIGATION_LINES_FULL_ID ? "https://example.test/lines.json" : null,
      now: () => now,
    });
    expect(now).toBe(13_500);
    expect(raf).toHaveBeenCalled(); // ambient completed-route flow remains active
    const lastGradient = [...map.setPaintProperty.mock.calls]
      .reverse()
      .find((call) => call[1] === "line-gradient");
    expect(JSON.stringify(lastGradient[2])).toContain(String(1 - 0.00015));
    disposeInvestigationTimelineForMap(map);
  });

  it("paused jump uses its serialized anchor instead of local receipt time", async () => {
    const map = makeMap();
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    const clock = {
      ...seekNliClock(idleNliClock(), 1, 10_000, {
        visibleMembership: [INVESTIGATION_LINES_FULL_ID],
        beats: [400, 420, 740],
      }),
      revision: 12,
    };
    await syncInvestigationTimelineToMap(map, clock, bothGroups(), {
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES,
        [INVESTIGATION_LINES_FULL_ID]: LINE_FEATURES,
      },
      now: () => 11_000,
    });
    expect(raf).toHaveBeenCalled();
    const lastGradient = [...map.setPaintProperty.mock.calls]
      .reverse()
      .find((call) => call[1] === "line-gradient");
    expect(JSON.stringify(lastGradient[2])).toContain(String(1000 / TIMELINE_BEAT_MS));
    disposeInvestigationTimelineForMap(map);
  });

  it("starts ambient route flow for idle clock with leftover nli anim unused arg", async () => {
    const map = makeMap();
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    const leftover = {
      [INVESTIGATION_POLYGONS_FULL_ID]: true,
      [INVESTIGATION_LINES_FULL_ID]: true,
      [INVESTIGATION_ALARMS_FULL_ID]: true,
    };
    await syncInvestigationTimelineToMap(
      map,
      idleNliClock(),
      bothGroups(),
      {
        featuresById: {
          [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES,
          [INVESTIGATION_LINES_FULL_ID]: LINE_FEATURES,
        },
        now: () => 0,
      },
      leftover,
    );
    expect(raf).toHaveBeenCalledTimes(1);
    expect(map.getSource("nli-investigation-line-completed-motion").setData.mock.calls.at(-1)[0].features)
      .toHaveLength(LINE_FEATURES.length);
    disposeInvestigationTimelineForMap(map);
  });

  it("overlapping sync(play) then sync(idle) must not restart RAF", async () => {
    const map = makeMap();
    let releaseFetch;
    const fetchGate = new Promise((resolve) => {
      releaseFetch = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        await fetchGate;
        return { ok: true, json: async () => ({ features: LINE_FEATURES }) };
      }),
    );
    const raf = vi.fn(() => 7);
    vi.stubGlobal("requestAnimationFrame", raf);
    const playing = {
      ...playClock([INVESTIGATION_LINES_FULL_ID], LINE_BEATS),
      revision: 1,
    };
    const stopped = { ...idleNliClock(), revision: 2 };
    const playSync = syncInvestigationTimelineToMap(map, playing, bothGroups(), {
      featuresById: {},
      getLayerDataUrl: () => "https://example.test/lines.json",
      now: () => 0,
    });
    const idleSync = syncInvestigationTimelineToMap(map, stopped, bothGroups(), {
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES,
        [INVESTIGATION_LINES_FULL_ID]: LINE_FEATURES,
      },
      now: () => 0,
    });
    await idleSync;
    releaseFetch();
    await playSync;
    expect(raf).toHaveBeenCalledTimes(1);
    disposeInvestigationTimelineForMap(map);
  });

  it("empty-name beat still shows the clock", async () => {
    let captionEl = null;
    vi.stubGlobal("document", {
      createElement: () => ({
        className: "",
        hidden: true,
        innerHTML: "",
        textContent: "",
        dir: "",
        setAttribute() {},
      }),
    });
    const map = makeMap();
    map.getContainer = vi.fn(() => ({
      querySelector: () => captionEl,
      appendChild: (el) => {
        captionEl = el;
      },
    }));
    const clock = playNliClock(idleNliClock(), [INVESTIGATION_LINES_FULL_ID], [400], 0);
    await syncInvestigationTimelineToMap(map, clock, bothGroups(), {
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [],
        [INVESTIGATION_LINES_FULL_ID]: [{ properties: { OBJECTID: 1, timeline_minutes: 400 } }],
      },
      now: () => 0,
    });
    expect(captionEl.hidden).toBe(false);
    expect(captionEl.innerHTML).toMatch(/06:40/);
    expect(captionEl.innerHTML).toMatch(/nli-tl-clock/);
    disposeInvestigationTimelineForMap(map);
  });

  it("injected captionEl is not appended to the map container", async () => {
    const appended = [];
    const injected = { className: "", hidden: true, innerHTML: "", textContent: "", setAttribute() {} };
    const map = makeMap();
    map.getContainer = vi.fn(() => ({
      querySelector: () => null,
      appendChild: (el) => appended.push(el),
    }));
    const clock = playNliClock(idleNliClock(), [INVESTIGATION_LINES_FULL_ID], [400], 0);
    await syncInvestigationTimelineToMap(map, clock, bothGroups(), {
      captionEl: injected,
      allowMapCaption: false,
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [],
        [INVESTIGATION_LINES_FULL_ID]: [{ properties: { Name: "ציר", timeline_minutes: 400 } }],
      },
      now: () => 0,
    });
    expect(appended).toEqual([]);
    expect(injected.hidden).toBe(false);
    expect(injected.innerHTML).toMatch(/nli-tl-row--lines/);
    disposeInvestigationTimelineForMap(map);
    expect(appended).toEqual([]);
  });

  it("dispose does not removeChild an injected captionEl", async () => {
    const host = { children: [] };
    host.removeChild = vi.fn();
    const injected = {
      className: "",
      hidden: true,
      innerHTML: "",
      textContent: "",
      setAttribute() {},
      parentNode: host,
    };
    host.children.push(injected);
    const appended = [];
    const map = makeMap();
    map.getContainer = vi.fn(() => ({
      querySelector: () => null,
      appendChild: (el) => appended.push(el),
    }));
    const clock = playNliClock(idleNliClock(), [INVESTIGATION_LINES_FULL_ID], [400], 0);
    await syncInvestigationTimelineToMap(map, clock, bothGroups(), {
      captionEl: injected,
      allowMapCaption: false,
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [],
        [INVESTIGATION_LINES_FULL_ID]: [{ properties: { Name: "ציר", timeline_minutes: 400 } }],
      },
      now: () => 0,
    });
    disposeInvestigationTimelineForMap(map);
    expect(host.removeChild).not.toHaveBeenCalled();
    expect(injected.parentNode).toBe(host);
    expect(appended).toEqual([]);
  });

  it("removes leftover map-container caption when captionEl is injected", async () => {
    const leftover = { className: "nli-investigation-timeline-caption", hidden: false, innerHTML: "old" };
    const appended = [];
    const injected = { className: "", hidden: true, innerHTML: "", textContent: "", dir: "", setAttribute() {} };
    const container = {
      _node: leftover,
      querySelector(sel) {
        if (sel.includes("nli-investigation-timeline-caption")) return this._node;
        return null;
      },
      appendChild(el) {
        appended.push(el);
      },
      removeChild(el) {
        if (el === this._node) this._node = null;
      },
    };
    const map = makeMap();
    map.getContainer = vi.fn(() => container);
    const clock = playNliClock(idleNliClock(), [INVESTIGATION_LINES_FULL_ID], [400], 0);
    await syncInvestigationTimelineToMap(map, clock, bothGroups(), {
      captionEl: injected,
      allowMapCaption: false,
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [],
        [INVESTIGATION_LINES_FULL_ID]: [{ properties: { Name: "ציר", timeline_minutes: 400 } }],
      },
      now: () => 0,
    });
    expect(container.querySelector(".nli-investigation-timeline-caption")).toBe(null);
    expect(appended).toEqual([]);
    expect(injected.innerHTML).toMatch(/nli-tl-clock/);
    disposeInvestigationTimelineForMap(map);
  });

  it("idle + explainerDebugVisible paints the sample, not the last beat", async () => {
    const injected = { className: "", hidden: true, innerHTML: "LAST_BEAT", textContent: "", dir: "", setAttribute() {} };
    const map = makeMap();
    map.getContainer = vi.fn(() => ({
      querySelector: () => null,
      appendChild: () => {
        throw new Error("must not append");
      },
      removeChild() {},
    }));
    await syncInvestigationTimelineToMap(map, idleNliClock(), bothGroups(), {
      captionEl: injected,
      allowMapCaption: false,
      explainerDebugVisible: true,
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [],
        [INVESTIGATION_LINES_FULL_ID]: [],
      },
      now: () => 0,
    });
    expect(injected.hidden).toBe(false);
    expect(injected.innerHTML).toMatch(/nli-tl-clock/);
    expect(injected.innerHTML).not.toBe("LAST_BEAT");
    expect(injected.innerHTML).toMatch(/nli-tl-row--polygons/);
    await syncInvestigationTimelineToMap(map, idleNliClock(), bothGroups(), {
      captionEl: injected,
      allowMapCaption: false,
      explainerDebugVisible: true,
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [],
        [INVESTIGATION_LINES_FULL_ID]: [],
      },
      now: () => 0,
    });
    expect(injected.innerHTML).toMatch(/nli-tl-row--polygons/);
    disposeInvestigationTimelineForMap(map);
  });

  it("second sync rebinds captionEl after a no-caption first sync", async () => {
    const appended = [];
    const injected = { className: "", hidden: true, innerHTML: "", textContent: "", setAttribute() {} };
    const map = makeMap();
    map.getContainer = vi.fn(() => ({
      querySelector: () => null,
      appendChild: (el) => appended.push(el),
    }));
    const clock = playNliClock(idleNliClock(), [INVESTIGATION_LINES_FULL_ID], [400], 0);
    const depsBase = {
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [],
        [INVESTIGATION_LINES_FULL_ID]: [{ properties: { Name: "ציר", timeline_minutes: 400 } }],
      },
      now: () => 0,
    };
    await syncInvestigationTimelineToMap(map, clock, bothGroups(), {
      ...depsBase,
      allowMapCaption: false,
    });
    expect(appended).toEqual([]);
    await syncInvestigationTimelineToMap(map, clock, bothGroups(), {
      ...depsBase,
      captionEl: injected,
      allowMapCaption: false,
    });
    expect(appended).toEqual([]);
    expect(injected.innerHTML).toMatch(/nli-tl-row--lines/);
    disposeInvestigationTimelineForMap(map);
  });

  it("allowMapCaption false without captionEl does not append to the map", async () => {
    const appended = [];
    const map = makeMap();
    map.getContainer = vi.fn(() => ({
      querySelector: () => null,
      appendChild: (el) => appended.push(el),
    }));
    const clock = playNliClock(idleNliClock(), [INVESTIGATION_LINES_FULL_ID], [400], 0);
    await syncInvestigationTimelineToMap(map, clock, bothGroups(), {
      allowMapCaption: false,
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [],
        [INVESTIGATION_LINES_FULL_ID]: [{ properties: { Name: "ציר", timeline_minutes: 400 } }],
      },
      now: () => 0,
    });
    expect(appended).toEqual([]);
    disposeInvestigationTimelineForMap(map);
  });

  it("GIS caption and injected caption paint the same innerHTML", async () => {
    let gisEl = null;
    vi.stubGlobal("document", {
      createElement: () => ({
        className: "",
        hidden: true,
        innerHTML: "",
        textContent: "",
        dir: "",
        setAttribute() {},
      }),
    });
    const injected = { className: "", hidden: true, innerHTML: "", textContent: "", setAttribute() {} };
    const features = {
      [INVESTIGATION_POLYGONS_FULL_ID]: [
        { properties: { Name: "גן הדר\nהמשך סיפור", timeline_minutes: 400 } },
      ],
      [INVESTIGATION_LINES_FULL_ID]: [{ properties: { Name: "ציר", timeline_minutes: 400 } }],
    };
    const clock = playNliClock(idleNliClock(), [INVESTIGATION_POLYGONS_FULL_ID, INVESTIGATION_LINES_FULL_ID], [400], 0);
    const gisMap = makeMap();
    gisMap.getContainer = vi.fn(() => ({
      querySelector: () => gisEl,
      appendChild: (el) => {
        gisEl = el;
      },
    }));
    const projMap = makeMap();
    projMap.getContainer = vi.fn(() => ({
      querySelector: () => null,
      appendChild: () => {
        throw new Error("must not append");
      },
    }));
    await syncInvestigationTimelineToMap(gisMap, clock, bothGroups(), { featuresById: features, now: () => 0 });
    await syncInvestigationTimelineToMap(projMap, clock, bothGroups(), {
      featuresById: features,
      now: () => 0,
      captionEl: injected,
      allowMapCaption: false,
    });
    expect(gisEl.innerHTML).toBe(injected.innerHTML);
    expect(gisEl.innerHTML).toMatch(/nli-tl-row--polygons/);
    expect(gisEl.innerHTML).toContain("גן הדר\nהמשך סיפור");
    expect(gisEl.innerHTML).not.toMatch(/nli-tl-names/);
    expect(gisEl.dir).toBe("rtl");
    disposeInvestigationTimelineForMap(gisMap);
    disposeInvestigationTimelineForMap(projMap);
  });

  it("allowMapCaption false without captionEl removes owned GIS caption from the map", async () => {
    let captionEl = null;
    vi.stubGlobal("document", {
      createElement: () => ({
        className: "",
        hidden: true,
        innerHTML: "",
        textContent: "",
        dir: "",
        setAttribute() {},
      }),
    });
    const container = {
      querySelector(sel) {
        if (sel.includes("nli-investigation-timeline-caption")) return captionEl;
        return null;
      },
      appendChild(el) {
        captionEl = el;
      },
      removeChild(el) {
        if (el === captionEl) captionEl = null;
      },
    };
    const map = makeMap();
    map.getContainer = vi.fn(() => container);
    const clock = playNliClock(idleNliClock(), [INVESTIGATION_LINES_FULL_ID], [400], 0);
    const depsBase = {
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [],
        [INVESTIGATION_LINES_FULL_ID]: [{ properties: { Name: "ציר", timeline_minutes: 400 } }],
      },
      now: () => 0,
    };
    await syncInvestigationTimelineToMap(map, clock, bothGroups(), depsBase);
    expect(container.querySelector(".nli-investigation-timeline-caption")).toBeTruthy();
    await syncInvestigationTimelineToMap(map, clock, bothGroups(), {
      ...depsBase,
      allowMapCaption: false,
    });
    expect(container.querySelector(".nli-investigation-timeline-caption")).toBe(null);
    disposeInvestigationTimelineForMap(map);
  });

  it("GIS-allowed sync without captionEl rebinds off a prior injected host", async () => {
    let gisEl = null;
    vi.stubGlobal("document", {
      createElement: () => ({
        className: "",
        hidden: true,
        innerHTML: "",
        textContent: "",
        dir: "",
        setAttribute() {},
      }),
    });
    const injected = { className: "", hidden: true, innerHTML: "", textContent: "", dir: "", setAttribute() {} };
    const container = {
      querySelector(sel) {
        if (sel.includes("nli-investigation-timeline-caption")) return gisEl;
        return null;
      },
      appendChild(el) {
        gisEl = el;
      },
      removeChild(el) {
        if (el === gisEl) gisEl = null;
      },
    };
    const map = makeMap();
    map.getContainer = vi.fn(() => container);
    const clock = playNliClock(idleNliClock(), [INVESTIGATION_LINES_FULL_ID], [400], 0);
    await syncInvestigationTimelineToMap(map, clock, bothGroups(), {
      captionEl: injected,
      allowMapCaption: false,
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [],
        [INVESTIGATION_LINES_FULL_ID]: [{ properties: { Name: "ציר", timeline_minutes: 400 } }],
      },
      now: () => 0,
    });
    expect(injected.innerHTML).toMatch(/nli-tl-row--lines/);
    expect(gisEl).toBe(null);
    injected.innerHTML = "STALE_INJECTED";
    await syncInvestigationTimelineToMap(map, clock, bothGroups(), {
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [],
        [INVESTIGATION_LINES_FULL_ID]: [{ properties: { Name: "ציר", timeline_minutes: 400 } }],
      },
      now: () => 0,
    });
    expect(gisEl).toBeTruthy();
    expect(gisEl).not.toBe(injected);
    expect(gisEl.innerHTML).toMatch(/nli-tl-row--lines/);
    expect(injected.innerHTML).toBe("STALE_INJECTED");
    disposeInvestigationTimelineForMap(map);
  });
});

function subscribeCallbackName(src, topic) {
  const match = src.match(new RegExp(`subscribe\\("${topic}",\\s*(\\w+)\\)`));
  expect(match).toBeTruthy();
  return match[1];
}

function namedArrowFunctionBody(src, name) {
  const match = src.match(new RegExp(`const ${name} = \\(\\) => \\{([\\s\\S]*?)\\n    \\};`));
  expect(match).toBeTruthy();
  return match[1];
}

describe("maps ignore leftover nli animation booleans", () => {
  it("map-main animations subscribe does not re-enter investigation sync", () => {
    const src = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/src/entries/map-main.js"),
      "utf8",
    );
    const animCb = subscribeCallbackName(src, "animations");
    const clockCb = subscribeCallbackName(src, "investigationClock");
    expect(animCb).not.toBe("syncContextFlowAnimations");
    expect(namedArrowFunctionBody(src, animCb)).not.toContain("syncContextInvestigation");
    expect(namedArrowFunctionBody(src, animCb)).not.toContain("syncInvestigationTimelineToMap");
    expect(namedArrowFunctionBody(src, clockCb)).toContain("syncInvestigationTimelineToMap");
  });

  it("projection-main animations subscribe does not re-enter investigation sync", () => {
    const src = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/src/entries/projection-main.js"),
      "utf8",
    );
    const animCb = subscribeCallbackName(src, "animations");
    const clockCb = subscribeCallbackName(src, "investigationClock");
    expect(animCb).not.toBe("syncContextFlowAnimations");
    expect(namedArrowFunctionBody(src, animCb)).not.toContain("syncContextInvestigation");
    expect(namedArrowFunctionBody(src, animCb)).not.toContain("syncInvestigationTimelineToMap");
    expect(namedArrowFunctionBody(src, clockCb)).toContain("syncInvestigationTimelineToMap");
    expect(namedArrowFunctionBody(src, clockCb)).toContain("idleNliClock");
  });
});
