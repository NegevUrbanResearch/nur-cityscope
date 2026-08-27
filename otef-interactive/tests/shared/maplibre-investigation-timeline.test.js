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
      { features: INVESTIGATION_FEATURES, getLayerDataUrl: () => null, now: () => 0 },
    );
    expect(map.setPaintProperty).toHaveBeenCalled();
    const fillCalls = map.setPaintProperty.mock.calls.filter((call) => call[1] === "fill-opacity");
    expect(fillCalls.length).toBeGreaterThan(0);
    expect(JSON.stringify(fillCalls[0][2])).toContain("timeline_minutes");
    const fillColor = map.setPaintProperty.mock.calls.find((call) => call[1] === "fill-color");
    expect(JSON.stringify(fillColor[2])).toContain("#f79009");

    await syncInvestigationTimelineToMap(map, { [INVESTIGATION_POLYGONS_FULL_ID]: false }, groups, {
      features: INVESTIGATION_FEATURES,
      getLayerDataUrl: () => null,
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
      { features: INVESTIGATION_FEATURES, getLayerDataUrl: () => null },
    );
    expect(map.setPaintProperty).not.toHaveBeenCalled();
  });

  it("plays lines with an Oct 7 line-gradient trail and hides the dim base", async () => {
    const map = makeMap();
    await syncInvestigationTimelineToMap(
      map,
      { [INVESTIGATION_LINES_FULL_ID]: true },
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
    await syncInvestigationTimelineToMap(map, { [INVESTIGATION_LINES_FULL_ID]: true }, bothGroups(), deps);
    const hiddenBefore = map.setPaintProperty.mock.calls.filter(
      (call) => call[0] === "nli__lines__line__0" && call[1] === "line-opacity" && call[2] === 0,
    );
    expect(hiddenBefore).toHaveLength(0);
    style.layers.push(route);
    await syncInvestigationTimelineToMap(map, { [INVESTIGATION_LINES_FULL_ID]: true }, bothGroups(), deps);
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
      { [INVESTIGATION_LINES_FULL_ID]: true },
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
      { [INVESTIGATION_LINES_FULL_ID]: true },
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

  it("keeps the same clock when the other layer joins", async () => {
    const map = makeMap();
    let now = 800;
    const deps = {
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES,
        [INVESTIGATION_LINES_FULL_ID]: LINE_FEATURES,
      },
      now: () => now,
    };
    await syncInvestigationTimelineToMap(
      map,
      { [INVESTIGATION_POLYGONS_FULL_ID]: true },
      bothGroups(),
      deps,
    );
    now = 1600;
    await syncInvestigationTimelineToMap(
      map,
      { [INVESTIGATION_POLYGONS_FULL_ID]: true, [INVESTIGATION_LINES_FULL_ID]: true },
      bothGroups(),
      deps,
    );
    expect(map.addSource).toHaveBeenCalled();
    const gradient = [...map.setPaintProperty.mock.calls].reverse().find((call) => call[1] === "line-gradient");
    expect(gradient).toBeDefined();
    expect(JSON.stringify(gradient[2])).toContain("line-progress");
    expect(JSON.stringify(gradient[2])).toContain(String(800 / TIMELINE_BEAT_MS));
    disposeInvestigationTimelineForMap(map);
  });

  it("starts playback when only nli.alarms is playing", async () => {
    const map = makeMap();
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    await syncInvestigationTimelineToMap(
      map,
      { [INVESTIGATION_ALARMS_FULL_ID]: true },
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

  it("does not reset startedAt when alarms join a playing polygon session", async () => {
    const map = makeMap();
    let now = 800;
    const groups = [
      {
        id: "nli",
        layers: [
          { id: "investigation_polygons", enabled: true },
          { id: "alarms", enabled: true },
        ],
      },
    ];
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
    await syncInvestigationTimelineToMap(map, { [INVESTIGATION_POLYGONS_FULL_ID]: true }, groups, deps);
    now = 800 + TIMELINE_BEAT_MS;
    await syncInvestigationTimelineToMap(
      map,
      { [INVESTIGATION_POLYGONS_FULL_ID]: true, [INVESTIGATION_ALARMS_FULL_ID]: true },
      groups,
      deps,
    );
    const fillOpacity = [...map.setPaintProperty.mock.calls]
      .reverse()
      .find((call) => call[0].includes("investigation_polygons") && call[1] === "fill-opacity");
    expect(JSON.stringify(fillOpacity[2])).toContain("410");
    cancelAnimationFrame.mockClear();
    await syncInvestigationTimelineToMap(
      map,
      { [INVESTIGATION_POLYGONS_FULL_ID]: false, [INVESTIGATION_ALARMS_FULL_ID]: true },
      groups,
      deps,
    );
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
      { [INVESTIGATION_POLYGONS_FULL_ID]: true, [INVESTIGATION_LINES_FULL_ID]: true },
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
});
