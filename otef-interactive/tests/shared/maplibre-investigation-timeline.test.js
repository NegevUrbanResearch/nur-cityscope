import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nliStyles from "../../public/processed/layers/nli/styles.json";
import {
  collectPlaybackTimelineBeats,
  collectTimelineBeats,
  collectUnionTimelineBeats,
  disposeInvestigationTimelineForMap,
  INVESTIGATION_ALARMS_FULL_ID,
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
  lineHeadCoordinatesAt,
  lineProgressAt,
  orientLineCoordinatesTowardIsrael,
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
    expect(nliStyles.investigation_polygons?.animation?.type).toBe("timeline");
    expect(nliStyles.lines?.animation?.type).toBe("timeline");
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

  it("reverses westward lines so they travel from the sea/Gaza into Israel", () => {
    const westward = [
      [34.5054, 31.6145],
      [34.5021, 31.6163],
    ];
    expect(orientLineCoordinatesTowardIsrael(westward)).toEqual([
      [34.5021, 31.6163],
      [34.5054, 31.6145],
    ]);
    const eastward = [
      [34.5007, 31.6145],
      [34.5042, 31.6127],
    ];
    expect(orientLineCoordinatesTowardIsrael(eastward)).toEqual(eastward);
  });

  it("places a trail head on the moving line and hides it when the beat ends", () => {
    const feature = {
      properties: { OBJECTID: 1, timeline_minutes: 420 },
      geometry: { type: "LineString", coordinates: [[0, 0], [1, 0]] },
    };
    expect(lineHeadCoordinatesAt([feature], 400, 0)).toEqual([]);
    expect(lineHeadCoordinatesAt([feature], 420, 0)[0][0]).toBeCloseTo(0);
    expect(lineHeadCoordinatesAt([feature], 420, TIMELINE_BEAT_MS / 2)[0][0]).toBeCloseTo(0.5, 1);
    expect(lineHeadCoordinatesAt([feature], 420, TIMELINE_BEAT_MS)).toEqual([]);
    expect(lineHeadCoordinatesAt([feature], 435, 0)).toEqual([]);
    expect(lineHeadCoordinatesAt([feature], null, 0)).toEqual([]);
  });

  it("starts a reversed sea line from the western end", () => {
    const feature = {
      properties: { OBJECTID: 16, timeline_minutes: 420 },
      geometry: { type: "LineString", coordinates: [[34.5054, 31.6145], [34.5021, 31.6163]] },
    };
    const head = lineHeadCoordinatesAt([feature], 420, 0);
    expect(head[0][0]).toBeCloseTo(34.5021);
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
      playClock([INVESTIGATION_POLYGONS_FULL_ID], POLYGON_BEATS),
      groups,
      { features: INVESTIGATION_FEATURES, getLayerDataUrl: () => null, now: () => 0 },
    );
    expect(map.setPaintProperty).toHaveBeenCalled();
    const fillCalls = map.setPaintProperty.mock.calls.filter((call) => call[1] === "fill-opacity");
    expect(fillCalls.length).toBeGreaterThan(0);
    expect(JSON.stringify(fillCalls[0][2])).toContain("timeline_minutes");
    const fillColor = map.setPaintProperty.mock.calls.find((call) => call[1] === "fill-color");
    expect(JSON.stringify(fillColor[2])).toContain("#f79009");

    await syncInvestigationTimelineToMap(map, idleNliClock(), groups, {
      features: INVESTIGATION_FEATURES,
      getLayerDataUrl: () => null,
    });
    const restored = map.setPaintProperty.mock.calls.filter(
      (call) => call[0].includes("investigation_polygons") && call[1] === "fill-opacity" && call[2] === 0.4,
    );
    expect(restored.length).toBeGreaterThan(0);
    disposeInvestigationTimelineForMap(map);
  });

  it("skips when the clock is idle", async () => {
    const map = makeMap();
    await syncInvestigationTimelineToMap(
      map,
      idleNliClock(),
      [{ id: "nli", layers: [{ id: "investigation_polygons", enabled: true }] }],
      { features: INVESTIGATION_FEATURES, getLayerDataUrl: () => null },
    );
    expect(map.setPaintProperty).not.toHaveBeenCalled();
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
    const deps = {
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES,
        [INVESTIGATION_LINES_FULL_ID]: LINE_FEATURES,
      },
      now: () => 0,
    };
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
    disposeInvestigationTimelineForMap(map);
  });

  it("plays lines with an Oct 7 line-gradient trail and hides the dim base", async () => {
    const map = makeMap();
    await syncInvestigationTimelineToMap(
      map,
      playClock([INVESTIGATION_LINES_FULL_ID], LINE_BEATS),
      bothGroups(),
      {
        featuresById: {
          [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES,
          [INVESTIGATION_LINES_FULL_ID]: LINE_FEATURES,
        },
        now: () => 0,
      },
    );
    expect(map.addSource).toHaveBeenCalled();
    expect(map.addLayer).toHaveBeenCalled();
    const activeSource = map.addSource.mock.calls.find((call) => call[1].lineMetrics === true);
    expect(activeSource).toBeDefined();
    const hiddenBase = map.setPaintProperty.mock.calls.filter(
      (call) => call[0] === "nli__lines__line__0" && call[1] === "line-opacity" && call[2] === 0,
    );
    expect(hiddenBase.length).toBeGreaterThan(0);
    const gradient = map.setPaintProperty.mock.calls.find((call) => call[1] === "line-gradient");
    expect(gradient).toBeDefined();
    expect(JSON.stringify(gradient[2])).toContain("line-progress");
    const activeData = map.getSource("nli-investigation-line-active").setData;
    expect(activeData).toHaveBeenCalled();
    const drawn = activeData.mock.calls.at(-1)[0].features.map((f) => f.properties.OBJECTID);
    expect(drawn).toEqual([9]);
    const headLayer = map.addLayer.mock.calls.find((call) => call[0].type === "circle");
    expect(headLayer).toBeDefined();
    const headData = map.getSource("nli-investigation-line-head").setData;
    expect(headData).toHaveBeenCalled();
    expect(headData.mock.calls.at(-1)[0].features).toHaveLength(1);
    disposeInvestigationTimelineForMap(map);
  });

  it("hides base lines that appear after playback already started", async () => {
    const map = makeMap();
    const style = map.getStyle();
    const routeIndex = style.layers.findIndex((layer) => layer.id === "nli__lines__line__0");
    const [route] = style.layers.splice(routeIndex, 1);
    const deps = {
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES,
        [INVESTIGATION_LINES_FULL_ID]: LINE_FEATURES,
      },
      now: () => 0,
    };
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
        featuresById: {
          [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES,
          [INVESTIGATION_LINES_FULL_ID]: LINE_FEATURES,
        },
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
        featuresById: {
          [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES,
          [INVESTIGATION_LINES_FULL_ID]: LINE_FEATURES,
        },
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

  it("re-syncing a playing clock does not reset playEpoch", async () => {
    const map = makeMap();
    let now = 800;
    const clock = playClock(
      [INVESTIGATION_POLYGONS_FULL_ID, INVESTIGATION_LINES_FULL_ID],
      collectUnionTimelineBeats(INVESTIGATION_FEATURES, LINE_FEATURES),
      0,
    );
    const deps = {
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES,
        [INVESTIGATION_LINES_FULL_ID]: LINE_FEATURES,
      },
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

  it("pause freezes beatElapsedMs when deps.now advances 10s", async () => {
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
    expect(lastActiveIds()).toEqual([1]);
    expect(JSON.stringify(lastGradient()[2])).toContain(String(1 - 0.00015));

    now = 10_000 + 10_000;
    raf.mockClear();
    await syncInvestigationTimelineToMap(map, clock, bothGroups(), deps);
    expect(raf).not.toHaveBeenCalled();
    expect(lastActiveIds()).toEqual([1]);
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
      const source = map.getSource("nli-investigation-alarm-count");
      const fc = source?.setData?.mock.calls.at(-1)?.[0];
      return (fc?.features || [])
        .filter((feature) => feature.properties.flash)
        .map((feature) => feature.properties.city);
    }

    await syncInvestigationTimelineToMap(map, clock, groups, deps);
    expect(flashingCities()).toEqual(["B"]);

    now = 10_000 + 1600;
    rafCb();
    expect(flashingCities()).toEqual(["B"]);

    now = 10_000 + TIMELINE_BEAT_MS;
    rafCb();
    expect(flashingCities()).toEqual([]);

    disposeInvestigationTimelineForMap(map);
    await syncInvestigationTimelineToMap(map, clock, groups, deps);
    expect(flashingCities()).toEqual([]);
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
      const source = map.getSource("nli-investigation-alarm-count");
      const fc = source?.setData?.mock.calls.at(-1)?.[0];
      return (fc?.features || [])
        .filter((feature) => feature.properties.flash)
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

  it("paused jump still RAFs when fetch advances now past the clock epoch window", async () => {
    const map = makeMap();
    let now = 10_000;
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        now += 3500;
        return { ok: true, json: async () => ({ features: LINE_FEATURES }) };
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
    expect(raf).toHaveBeenCalled();
    const lastGradient = [...map.setPaintProperty.mock.calls]
      .reverse()
      .find((call) => call[1] === "line-gradient");
    expect(JSON.stringify(lastGradient[2])).not.toContain(String(1 - 0.00015));
    disposeInvestigationTimelineForMap(map);
  });

  it("paused jump RAFs from first paint even when playEpochMs is null", async () => {
    const map = makeMap();
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    const clock = {
      phase: "paused",
      membership: [INVESTIGATION_LINES_FULL_ID],
      beats: [400, 420, 740],
      loop: false,
      beatIndex: 1,
      beatElapsedMs: 0,
      playEpochMs: null,
      seekKind: "jump",
      revision: 12,
    };
    await syncInvestigationTimelineToMap(map, clock, bothGroups(), {
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES,
        [INVESTIGATION_LINES_FULL_ID]: LINE_FEATURES,
      },
      now: () => 10_000,
    });
    expect(raf).toHaveBeenCalled();
    disposeInvestigationTimelineForMap(map);
  });

  it("does not start RAF for idle clock even with leftover nli anim unused arg", async () => {
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
    expect(raf).not.toHaveBeenCalled();
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
    expect(raf).not.toHaveBeenCalled();
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
