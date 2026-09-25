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
  prepareInvestigationTimelineForStyleReload,
  previousTimelineBeat,
  syncInvestigationTimelineToMap,
  timelinePhaseAt,
  wakeInvestigationTimelinePersonGlow,
  setEscapeImpactOrientationIds,
} from "../../frontend/src/shared/maplibre-investigation-timeline.js";
import { PEOPLE_HALO_LAYER_ID } from "../../frontend/src/map/maplibre-person-selection.js";
import {
  formatMinutesAsLocalClock,
  timelineBeatDurationMs,
  timelineSpanMs,
} from "../../frontend/src/shared/nli-investigation-beats.js";
import { NLI_NARRATIVES } from "../../frontend/src/shared/nli-narratives.js";
import {
  endNliClock,
  idleNliClock,
  pauseNliClock,
  playNliClock,
  seekNliClock,
  stopNliClock,
} from "../../frontend/src/shared/nli-investigation-clock.js";
import { NLI_NOVA_STORY } from "../../frontend/src/shared/nli-nova-story.js";

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
    const holdStart = timelineSpanMs(beats);
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
    expect(lineProgressAt(420, 420, timelineBeatDurationMs(420) / 2)).toBeCloseTo(0.5);
    expect(lineProgressAt(420, 420, timelineBeatDurationMs(420))).toBe(1);
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
      { id: fillId, type: "fill", source: "nli__investigation_polygons", layout: { visibility: "visible" } },
      { id: lineId, type: "line", source: "nli__investigation_polygons", layout: { visibility: "visible" } },
      { id: routeId, type: "line", source: "nli__lines", layout: { visibility: "visible" } },
      { id: alarmId, type: "circle", source: "nli__alarms", layout: { visibility: "visible" } },
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
      getLayoutProperty: vi.fn((id, key) => {
        const layer = layers.find((entry) => entry.id === id);
        if (!layer) return undefined;
        return layer.layout?.[key] ?? (key === "visibility" ? "visible" : undefined);
      }),
      setLayoutProperty: vi.fn((id, key, value) => {
        const layer = layers.find((entry) => entry.id === id);
        if (layer) layer.layout = { ...layer.layout, [key]: value };
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

  it("suppresses national line and alarm rows throughout Nova playback when all chips are enabled", async () => {
    const map = makeMap();
    const groups = [{ id: "nli", layers: [
      { id: "investigation_polygons", enabled: true },
      { id: "lines", enabled: true },
      { id: "alarms", enabled: true },
    ] }];
    const playing = playNliClock(
      idleNliClock(),
      [INVESTIGATION_POLYGONS_FULL_ID, INVESTIGATION_LINES_FULL_ID, INVESTIGATION_ALARMS_FULL_ID],
      NLI_NOVA_STORY.representativeMinutes,
      0,
      { narrativeId: "nova" },
    );
    const deps = withProcessedPolygons({
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [STORY_POLYGON_A, STORY_POLYGON_B],
        [INVESTIGATION_LINES_FULL_ID]: LINE_FEATURES,
        [INVESTIGATION_ALARMS_FULL_ID]: [{
          type: "Feature",
          properties: { city: "City A", alarm_minutes: [492, 506, 540], alarm_count_total: 3 },
          geometry: { type: "Point", coordinates: [34.4, 31.4] },
        }],
      },
      narrativeFocus: { id: "nova" },
      captionEl: { hidden: true, innerHTML: "", setAttribute: vi.fn() },
      now: () => 0,
    });

    for (let index = 0; index < NLI_NOVA_STORY.beats.length; index += 1) {
      await syncInvestigationTimelineToMap(map, {
        ...playing,
        phase: "paused",
        positionMs: index * NLI_NOVA_STORY.beatDurationMs + 1500,
      }, groups, deps);
      const lineRows = map.getSource("nli-investigation-line-completed-carrier")
        ?.setData?.mock?.calls?.at(-1)?.[0]?.features || [];
      const activeLineRows = map.getSource("nli-investigation-line-active")
        ?.setData?.mock?.calls?.at(-1)?.[0]?.features || [];
      const alarmRows = map.getSource("nli-investigation-alarm-points")
        ?.setData?.mock?.calls?.at(-1)?.[0]?.features || [];
      expect(lineRows).toEqual([]);
      expect(activeLineRows).toEqual([]);
      expect(alarmRows).toEqual([]);
      expect(deps.captionEl.innerHTML).not.toContain("nli-tl-row--alarms");
    }

    disposeInvestigationTimelineForMap(map);
  });

  it("resolves a cold ended Nova clock-only caption to beat five", async () => {
    const map = makeMap();
    const captionEl = { hidden: true, innerHTML: "", setAttribute: vi.fn() };
    const playing = playNliClock(
      idleNliClock(),
      [INVESTIGATION_POLYGONS_FULL_ID],
      NLI_NOVA_STORY.representativeMinutes,
      0,
      { narrativeId: "nova" },
    );
    await syncInvestigationTimelineToMap(map, endNliClock(playing), polygonOnlyGroups(), withProcessedPolygons({
      featuresById: { [INVESTIGATION_POLYGONS_FULL_ID]: [STORY_POLYGON_A] },
      narrativeFocus: { id: "nova" },
      captionEl,
      nliCaptionMode: "clock-only",
      now: () => 0,
    }));

    expect(captionEl.hidden).toBe(false);
    expect(captionEl.innerHTML).toContain("12:00");
    expect(captionEl.innerHTML).not.toContain("00:00");
    disposeInvestigationTimelineForMap(map);
  });

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
        key === "line-dasharray" && Array.isArray(value) && value.length >= 2,
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

  it("loads the processed polygon style and sidecar before rendering the timeline", async () => {
    const map = makeMap();
    const battle = { ...INVESTIGATION_FEATURES[0], properties: { ...INVESTIGATION_FEATURES[0].properties, Notes: "מרחב לחימה - קרב" }, geometry: { type: "Polygon", coordinates: [[[34, 31], [34.01, 31], [34.01, 31.01], [34, 31]]] } };
    const style = {
      renderer: "uniqueValue",
      uniqueValues: { field: "Notes", classes: [{ value: "מרחב לחימה - קרב", symbol: { symbolLayers: [
        { type: "fill", fillType: "gradient", interval: 1, resolvedColors: ["#123456"], opacity: 0.4 },
        { type: "stroke", color: "#654321", width: 2, opacity: 0.8 },
      ] } }] },
    };
    const sidecar = { type: "FeatureCollection", features: [{ ...battle, properties: { ...battle.properties, __cim_gradient_band: 0 } }] };
    await syncInvestigationTimelineToMap(map, idleNliClock(), [{ id: "nli", layers: [{ id: "investigation_polygons", enabled: true }] }], {
      featuresById: { [INVESTIGATION_POLYGONS_FULL_ID]: [battle] },
      getLayerStyle: () => style,
      getLayerConfig: () => ({ groupId: "nli", resources: { bufferedGradient: { file: "gradient.geojson", format: "geojson" } } }),
      fetchJson: async () => sidecar,
      getLayerDataUrl: () => null,
      now: () => 0,
    });
    expect(map.getSource("nli-investigation-polygon-buffered-gradient")).toBeTruthy();
    expect(map.getSource("nli-investigation-polygon-buffered-gradient").setData.mock.calls.at(-1)[0].features).toHaveLength(1);
    const fill = map.getLayer("nli-investigation-polygon-category-fill-battle");
    expect(fill.paint["fill-color"]).toBe("#123456");
    expect(map.getLayer("nli-investigation-polygon-category-line-battle").paint["line-color"]).toBe("#654321");
  });

  it("does not schedule polygon RAF for invalid-only ready sidecars, but does for mixed sidecars", async () => {
    const style = {
      renderer: "uniqueValue",
      uniqueValues: { field: "Notes", classes: [{
        value: "מרחב לחימה - קרב",
        symbol: { symbolLayers: [{
          type: "fill", fillType: "gradient", interval: 1, resolvedColors: ["#123456"], opacity: 0.4,
        }] },
      }] },
    };
    const invalid = {
      properties: { Notes: "מרחב לחימה - קרב" },
      geometry: null,
    };
    const valid = {
      properties: { Notes: "מרחב לחימה - קרב", __cim_gradient_band: 0, timeline_minutes: 400 },
      geometry: { type: "Polygon", coordinates: [[[34, 31], [34.01, 31], [34, 31.01], [34, 31]]] },
    };
    const sync = async (map, sidecar) => syncInvestigationTimelineToMap(
      map,
      idleNliClock(),
      [{ id: "nli", layers: [{ id: "investigation_polygons", enabled: true }] }],
      {
        featuresById: { [INVESTIGATION_POLYGONS_FULL_ID]: [valid] },
        polygonStyle: style,
        bufferedGradientFeatures: sidecar,
        bufferedGradientSidecarStatus: "ready",
        settlementFeatures: [],
        getLayerDataUrl: () => null,
        now: () => 0,
      },
    );

    const invalidOnlyRaf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", invalidOnlyRaf);
    await sync(makeMap(), [invalid]);
    expect(invalidOnlyRaf).not.toHaveBeenCalled();

    const mixedRaf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", mixedRaf);
    await sync(makeMap(), [invalid, valid]);
    expect(mixedRaf).toHaveBeenCalled();
  });

  it("keeps the authored Be'eri outline visible during narrative focus even when ordinary investigation layers are hidden", async () => {
    const map = makeOrientationMap();
    const hidden = [{ id: "nli", layers: [
      { id: "investigation_polygons", enabled: false },
      { id: "lines", enabled: false },
    ] }];
    const beeriOutline = {
      type: "Feature",
      properties: { outlineObjectId: 19, OBJECTID: 19, locations: ["בארי"] },
      geometry: { type: "Polygon", coordinates: [[[34.45, 31.42], [34.46, 31.42], [34.46, 31.43], [34.45, 31.42]]] },
    };
    const labelsSourceId = map.getStyle().layers.find((layer) => layer.id === SHEMOT_LABEL_ID).source;
    map.getSource(labelsSourceId).data = {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { cityname: beeriOutline.properties.locations[0] },
        geometry: { type: "Point", coordinates: [34.45, 31.42] },
      }],
    };
    const deps = {
      settlementFeatures: [beeriOutline],
      narrativeFocus: { focusSettlement: "בארי", focusSettlementOutlineId: 19 },
      now: () => 0,
    };

    await syncInvestigationTimelineToMap(map, idleNliClock(), hidden, deps);

    expect(map.getSource("nli-investigation-settlement-impact")).toBeTruthy();
    expect(map.getSource("nli-investigation-settlement-impact").setData.mock.calls.at(-1)[0]).toEqual({
      type: "FeatureCollection",
      features: [beeriOutline],
    });
    expect(map.getLayer("nli-investigation-settlement-impact-outline")).toBeTruthy();
    expect(map.getPaintProperty(YISHUVIM_FILL_ID, "fill-opacity")).toEqual(
      ["case", ["==", ["get", "OBJECTID"], 19], 1, 0.28],
    );
    expect(map.getPaintProperty(SHEMOT_LABEL_ID, "text-opacity")).toEqual(
      ["case", ["==", ["get", "cityname"], "בארי"], 1, 0.35],
    );

    await syncInvestigationTimelineToMap(map, idleNliClock(), hidden, { ...deps, narrativeFocus: null });

    expect(map.getSource("nli-investigation-settlement-impact")).toBeFalsy();
    expect(map.getPaintProperty(YISHUVIM_FILL_ID, "fill-opacity")).toBe(1);
    expect(map.getPaintProperty(SHEMOT_LABEL_ID, "text-opacity")).toBe(1);
  });

  it("keeps the Nova yeshuv outline 43 red during narrative focus even when ordinary investigation layers are hidden", async () => {
    const map = makeOrientationMap();
    const hidden = [{ id: "nli", layers: [
      { id: "investigation_polygons", enabled: false },
      { id: "lines", enabled: false },
    ] }];
    const novaOutline = {
      type: "Feature",
      properties: { outlineObjectId: 43, OBJECTID: 43, locations: ["נובה"] },
      geometry: { type: "Polygon", coordinates: [[[34.46, 31.39], [34.47, 31.39], [34.47, 31.40], [34.46, 31.39]]] },
    };
    const labelsSourceId = map.getStyle().layers.find((layer) => layer.id === SHEMOT_LABEL_ID).source;
    map.getSource(labelsSourceId).data = {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { cityname: novaOutline.properties.locations[0] },
        geometry: { type: "Point", coordinates: [34.46, 31.39] },
      }],
    };
    await syncInvestigationTimelineToMap(map, idleNliClock(), hidden, {
      settlementFeatures: [novaOutline],
      narrativeFocus: NLI_NARRATIVES.nova,
      now: () => 0,
    });

    expect(map.getSource("nli-investigation-settlement-impact").setData.mock.calls.at(-1)[0]).toEqual({
      type: "FeatureCollection",
      features: [novaOutline],
    });
    expect(map.getPaintProperty("nli-investigation-settlement-impact-outline", "line-color")).toBe("#c31f4f");
  });

  it("paints Segev, Sderot, and Hostages place outlines white during narrative focus", async () => {
    const hidden = [{ id: "nli", layers: [
      { id: "investigation_polygons", enabled: false },
      { id: "lines", enabled: false },
    ] }];
    const whitePaint = (outlineId) => [
      "case",
      [
        "any",
        ["==", ["to-string", ["get", "outlineObjectId"]], String(outlineId)],
        ["==", ["to-string", ["get", "OBJECTID"]], String(outlineId)],
      ],
      "#ffffff",
      "#c31f4f",
    ];
    for (const { focus, city, outlineId } of [
      { focus: NLI_NARRATIVES.segev, city: "בארי", outlineId: 19 },
      { focus: NLI_NARRATIVES.sderot, city: "שדרות", outlineId: 32 },
      { focus: NLI_NARRATIVES.hostages, city: "ניר עוז", outlineId: 14 },
    ]) {
      const map = makeOrientationMap();
      const outline = {
        type: "Feature",
        properties: { outlineObjectId: outlineId, OBJECTID: outlineId, locations: [city] },
        geometry: { type: "Polygon", coordinates: [[[34.45, 31.42], [34.46, 31.42], [34.46, 31.43], [34.45, 31.42]]] },
      };
      const labelsSourceId = map.getStyle().layers.find((layer) => layer.id === SHEMOT_LABEL_ID).source;
      map.getSource(labelsSourceId).data = {
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: { cityname: city },
          geometry: { type: "Point", coordinates: [34.45, 31.42] },
        }],
      };
      await syncInvestigationTimelineToMap(map, idleNliClock(), hidden, {
        settlementFeatures: [outline],
        narrativeFocus: focus,
        now: () => 0,
      });
      expect(map.getPaintProperty("nli-investigation-settlement-impact-outline", "line-color")).toEqual(
        whitePaint(outlineId),
      );
    }
  });

  it("does not remount the polygon overlay when the polygons row is off after Stop", async () => {
    const map = makeMap();
    const visible = [{ id: "nli", layers: [{ id: "investigation_polygons", enabled: true }] }];
    const hidden = [{ id: "nli", layers: [{ id: "investigation_polygons", enabled: false }] }];
    const deps = withProcessedPolygons({ featuresById: { [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES }, now: () => 0 });
    const playing = playClock([INVESTIGATION_POLYGONS_FULL_ID], POLYGON_BEATS);

    await syncInvestigationTimelineToMap(map, playing, visible, deps);
    await syncInvestigationTimelineToMap(map, playing, hidden, deps);
    map.setPaintProperty.mockClear();
    await syncInvestigationTimelineToMap(map, idleNliClock(), hidden, deps);
    expect(map.getSource("nli-investigation-polygon-category")).toBeFalsy();
    expect(map.getSource("nli-investigation-settlement-impact")).toBeFalsy();
    expect(map.setPaintProperty.mock.calls.some(
      ([id, , value]) => String(id).startsWith("nli__investigation_polygons") && value === "#f79009",
    )).toBe(false);
  });

  const STORY_POLYGON_A = {
    type: "Feature",
    properties: {
      OBJECTID: 1,
      timeline_minutes: 400,
      Notes: "מרחב לחימה - קרב",
      מיקום: "עיר א",
    },
    geometry: { type: "Polygon", coordinates: [[[34, 31], [34.1, 31], [34.1, 31.1], [34, 31]]] },
  };
  const STORY_POLYGON_B = {
    type: "Feature",
    properties: {
      OBJECTID: 2,
      timeline_minutes: 420,
      Notes: "מוקד חטיפה",
      מיקום: "עיר א",
    },
    geometry: { type: "Polygon", coordinates: [[[34.2, 31], [34.3, 31], [34.3, 31.1], [34.2, 31]]] },
  };
  const STORY_SETTLEMENT = {
    type: "Feature",
    id: "nli-settlement-outline-42",
    properties: { outlineObjectId: 42, locations: ["עיר א"] },
    geometry: { type: "Polygon", coordinates: [[[34, 31], [34.1, 31], [34.1, 31.1], [34, 31]]] },
  };

  function polygonOnlyGroups() {
    return [{ id: "nli", layers: [{ id: "investigation_polygons", enabled: true }] }];
  }

  function processedPolygonStyle() {
    const fill = (color) => ({
      type: "fill",
      fillType: "gradient",
      interval: 1,
      resolvedColors: [color],
      resolvedOpacities: [0.55],
      opacity: 0.55,
    });
    const stroke = { type: "stroke", color: "#6e6e6e", width: 1.8, opacity: 0.95 };
    return {
      renderer: "uniqueValue",
      uniqueValues: {
        field: "Notes",
        classes: [
          { value: "מרחב לחימה - קרב", symbol: { symbolLayers: [fill("#8e0912"), stroke] } },
          { value: "מוקד חטיפה", symbol: { symbolLayers: [fill("#ffff73"), stroke] } },
          { value: "שריפה", symbol: { symbolLayers: [fill("#7b5622"), stroke] } },
        ],
      },
    };
  }

  function withProcessedPolygons(deps = {}) {
    const features = deps.featuresById?.[INVESTIGATION_POLYGONS_FULL_ID] || [];
    return {
      ...deps,
      polygonStyle: deps.polygonStyle ?? processedPolygonStyle(),
      bufferedGradientFeatures: deps.bufferedGradientFeatures ?? features.map((feature) => ({
        ...feature,
        properties: { ...feature.properties, __cim_gradient_band: 0 },
      })),
      bufferedGradientSidecarStatus: deps.bufferedGradientSidecarStatus ?? "ready",
    };
  }

  it("idle Stop with polygons visible paints the complete category story", async () => {
    const map = makeMap();
    const polygons = [STORY_POLYGON_A, STORY_POLYGON_B];
    const playing = playClock([INVESTIGATION_POLYGONS_FULL_ID], [400, 420]);
    const deps = withProcessedPolygons({
      featuresById: { [INVESTIGATION_POLYGONS_FULL_ID]: polygons },
      settlementFeatures: [STORY_SETTLEMENT],
      now: () => 0,
    });
    await syncInvestigationTimelineToMap(map, playing, polygonOnlyGroups(), deps);
    map.setPaintProperty.mockClear();
    await syncInvestigationTimelineToMap(map, stopNliClock(playing), polygonOnlyGroups(), deps);

    const overlay = map.getSource("nli-investigation-polygon-category").setData.mock.calls.at(-1)[0].features;
    expect(overlay.map((feature) => feature.properties.timeline_minutes).sort((a, b) => a - b)).toEqual([400, 420]);
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      "nli__investigation_polygons__fill__0",
      "visibility",
      "none",
    );
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      "nli__investigation_polygons__line__1",
      "visibility",
      "none",
    );
    expect(map.getSource("nli-investigation-settlement-impact").setData.mock.calls.at(-1)[0].features)
      .toHaveLength(1);
    expect(map.setPaintProperty.mock.calls.some(
      ([id, , value]) => String(id).startsWith("nli__investigation_polygons") && value === "#f79009",
    )).toBe(false);
  });

  it("reasserts raw polygon suppression across Nova, general, and disabled transitions", async () => {
    const map = makeMap();
    const fillId = "nli__investigation_polygons__fill__0";
    const lineId = "nli__investigation_polygons__line__1";
    const playingNova = playClock([INVESTIGATION_POLYGONS_FULL_ID], [400]);
    const polygonsOffGroups = [{
      id: "nli",
      layers: [{ id: "investigation_polygons", enabled: false }],
    }];
    const baseDeps = withProcessedPolygons({
      featuresById: { [INVESTIGATION_POLYGONS_FULL_ID]: [STORY_POLYGON_A] },
      now: () => 0,
    });
    const novaDeps = { ...baseDeps, narrativeFocus: { id: "nova" } };
    const generalDeps = { ...baseDeps, narrativeFocus: null };

    await syncInvestigationTimelineToMap(map, playingNova, polygonOnlyGroups(), novaDeps);
    map.setLayoutProperty(fillId, "visibility", "visible");
    map.setLayoutProperty(lineId, "visibility", "visible");
    await syncInvestigationTimelineToMap(map, idleNliClock(), polygonOnlyGroups(), generalDeps);
    const lastVisibilityWrite = (id) => [...map.setLayoutProperty.mock.calls]
      .reverse()
      .find(([layerId, property]) => layerId === id && property === "visibility");
    expect(lastVisibilityWrite(fillId)).toEqual([fillId, "visibility", "none"]);
    expect(lastVisibilityWrite(lineId)).toEqual([lineId, "visibility", "none"]);
    expect(map.getLayoutProperty(fillId, "visibility")).toBe("none");
    expect(map.getLayoutProperty(lineId, "visibility")).toBe("none");
    expect(map.getLayer("nli-investigation-polygon-category-fill-battle")).toBeTruthy();
    expect(map.getLayer("nli-investigation-polygon-category-line-battle")).toBeTruthy();
    expect(map.getLayoutProperty("nli-investigation-polygon-category-fill-battle", "visibility")).toBe("visible");
    expect(map.getLayoutProperty("nli-investigation-polygon-category-line-battle", "visibility")).toBe("visible");

    map.setLayoutProperty(fillId, "visibility", "visible");
    map.setLayoutProperty(lineId, "visibility", "visible");
    await syncInvestigationTimelineToMap(map, idleNliClock(), polygonsOffGroups, generalDeps);
    await syncInvestigationTimelineToMap(map, idleNliClock(), polygonOnlyGroups(), generalDeps);
    expect(lastVisibilityWrite(fillId)).toEqual([fillId, "visibility", "none"]);
    expect(lastVisibilityWrite(lineId)).toEqual([lineId, "visibility", "none"]);
    expect(map.getLayoutProperty(fillId, "visibility")).toBe("none");
    expect(map.getLayoutProperty(lineId, "visibility")).toBe("none");
    expect(map.getLayer("nli-investigation-polygon-category-fill-battle")).toBeTruthy();
    expect(map.getLayer("nli-investigation-polygon-category-line-battle")).toBeTruthy();
    expect(map.getLayoutProperty("nli-investigation-polygon-category-fill-battle", "visibility")).toBe("visible");
    expect(map.getLayoutProperty("nli-investigation-polygon-category-line-battle", "visibility")).toBe("visible");
  });

  it("idle storyBeats unions polygon and line timeline minutes", async () => {
    const map = makeMap();
    const polygons = [STORY_POLYGON_A, STORY_POLYGON_B];
    const lines = [
      LINE_FEATURES[0],
      { ...LINE_FEATURES[2], properties: { ...LINE_FEATURES[2].properties, timeline_minutes: 740 } },
    ];
    await syncInvestigationTimelineToMap(map, idleNliClock(), bothGroups(), withProcessedPolygons({
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: polygons,
        [INVESTIGATION_LINES_FULL_ID]: lines,
      },
      settlementFeatures: [STORY_SETTLEMENT],
      now: () => 0,
    }));
    const overlayMinutes = map.getSource("nli-investigation-polygon-category")
      .setData.mock.calls.at(-1)[0].features
      .map((feature) => feature.properties.timeline_minutes);
    const completedMinutes = map.getSource("nli-investigation-line-completed-carrier")
      .setData.mock.calls.at(-1)[0].features
      .map((feature) => feature.properties.timeline_minutes);
    expect([...new Set([...overlayMinutes, ...completedMinutes])].sort((a, b) => a - b)).toEqual(
      collectUnionTimelineBeats(polygons, lines),
    );
  });

  it("idle complete-story does not replace the clock with an ended ambient clock", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.resolve(here, "../../frontend/src/shared/maplibre-investigation-timeline.js"),
      "utf8",
    );
    expect(src).toMatch(/storyBeats:\s*state\.storyBeats/);
    expect(src).toMatch(/polygonMotionActive:\s*state\.polygonMotionActive/);
    expect(src).toMatch(/personGlowActive:\s*state\.personGlowActive === true/);
    expect(src).not.toMatch(/state\.clock\s*=\s*ambientClock/);
    expect(src).toMatch(/syncPersonHaloPaint/);
    expect(src).toMatch(/getPersonSelection/);
  });

  it("idle lines-off still RAF-paints person glow via the shared frame", async () => {
    const map = makeMap();
    map.addLayer({ id: PEOPLE_HALO_LAYER_ID, type: "circle", source: "otef-person-selection" });
    const queued = [];
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      queued.push(callback);
      return queued.length;
    });
    await syncInvestigationTimelineToMap(
      map,
      idleNliClock(),
      [{
        id: "nli",
        layers: [
          { id: "investigation_polygons", enabled: false },
          { id: "lines", enabled: false },
        ],
      }],
      {
        now: () => 1000,
        motionMode: "full",
        getPersonSelection: () => ({ personId: "11", datasetVersion: "v1", revision: 1 }),
      },
    );
    expect(queued.length).toBeGreaterThan(0);
    map.setPaintProperty.mockClear();
    queued[0]();
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      PEOPLE_HALO_LAYER_ID,
      "circle-opacity",
      expect.any(Number),
    );
    disposeInvestigationTimelineForMap(map);
  });

  it("selecting a person after idle lines-off wakes shared glow RAF", async () => {
    const map = makeMap();
    map.addLayer({ id: PEOPLE_HALO_LAYER_ID, type: "circle", source: "otef-person-selection" });
    const queued = [];
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      queued.push(callback);
      return queued.length;
    });
    let selection = { personId: null, datasetVersion: null, revision: 0 };
    const offGroups = [{
      id: "nli",
      layers: [
        { id: "investigation_polygons", enabled: false },
        { id: "lines", enabled: false },
      ],
    }];
    const deps = {
      now: () => 1000,
      motionMode: "full",
      getPersonSelection: () => selection,
    };
    await syncInvestigationTimelineToMap(map, idleNliClock(), offGroups, deps);
    expect(queued).toHaveLength(0);
    selection = { personId: "11", datasetVersion: "v1", revision: 1 };
    wakeInvestigationTimelinePersonGlow(map);
    expect(queued.length).toBeGreaterThan(0);
    map.setPaintProperty.mockClear();
    queued[0]();
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      PEOPLE_HALO_LAYER_ID,
      "circle-opacity",
      expect.any(Number),
    );
    disposeInvestigationTimelineForMap(map);
  });

  it("refreshes semantic polygon paint while hidden non-idle membership remains active", async () => {
    const map = makeMap();
    const visible = [{ id: "nli", layers: [{ id: "investigation_polygons", enabled: true }] }];
    const hidden = [{ id: "nli", layers: [{ id: "investigation_polygons", enabled: false }] }];
    let now = 0;
    const deps = withProcessedPolygons({ featuresById: { [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES }, now: () => now });
    const playing = playClock([INVESTIGATION_POLYGONS_FULL_ID], POLYGON_BEATS);

    await syncInvestigationTimelineToMap(map, playing, visible, deps);
    await syncInvestigationTimelineToMap(map, playing, hidden, deps);
    now = timelineSpanMs(POLYGON_BEATS, 0, 2);
    await syncInvestigationTimelineToMap(map, playing, hidden, deps);

    expect(map.getSource("nli-investigation-polygon-category")).toBeFalsy();
    expect(JSON.stringify(map.getPaintProperty("nli__investigation_polygons__fill__0", "fill-color"))).not.toContain("420");
  });

  it("keeps host pack polygons hidden when the polygons row turns off (NLI→other-slide)", async () => {
    const map = makeMap();
    const visible = [{ id: "nli", layers: [{ id: "investigation_polygons", enabled: true }] }];
    const hidden = [{ id: "nli", layers: [{ id: "investigation_polygons", enabled: false }] }];
    const deps = withProcessedPolygons({ featuresById: { [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES }, now: () => 0 });
    await syncInvestigationTimelineToMap(map, idleNliClock(), visible, deps);
    expect(map.setLayoutProperty).toHaveBeenCalledWith(
      "nli__investigation_polygons__fill__0",
      "visibility",
      "none",
    );
    map.setLayoutProperty.mockClear();
    await syncInvestigationTimelineToMap(map, idleNliClock(), visible, {
      ...deps,
      visibilityLayerGroups: hidden,
    });
    expect(map.setLayoutProperty).not.toHaveBeenCalledWith(
      "nli__investigation_polygons__fill__0",
      "visibility",
      "visible",
    );
    expect(map.getSource("nli-investigation-polygon-category")).toBeFalsy();
    disposeInvestigationTimelineForMap(map);
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
    now += timelineBeatDurationMs(400);
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
    now = Math.ceil(timelineBeatDurationMs(LINE_BEATS[0]) * 0.999);
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
    now = timelineBeatDurationMs(LINE_BEATS[0]);
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
    expect(JSON.stringify(gradient[2])).toContain(String(1600 / timelineBeatDurationMs(400)));
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
    now = 800 + timelineBeatDurationMs(POLYGON_BEATS[0]);
    await syncInvestigationTimelineToMap(map, clock, liveAlarmsOnlyGroups, deps);
    expect(map.getSource("nli-investigation-polygon-category")).toBeFalsy();
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
    expect(JSON.stringify(gradientAtPause[2])).toContain(String(800 / timelineBeatDurationMs(400)));
    expect(captionEl?.hidden).toBe(false);
    now += 10_000;
    await syncInvestigationTimelineToMap(map, paused, bothGroups(), deps);
    const gradientLater = [...map.setPaintProperty.mock.calls]
      .reverse()
      .find((call) => call[1] === "line-gradient");
    expect(JSON.stringify(gradientLater[2])).toContain(String(800 / timelineBeatDurationMs(400)));
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

    now = 10_000 + timelineBeatDurationMs(420) / 2;
    rafCb();
    expect(lastActiveIds()).toEqual([1]);
    expect(JSON.stringify(lastGradient()[2])).toContain(String(0.5));

    now = 10_000 + timelineBeatDurationMs(420);
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

    now = 10_000 + timelineBeatDurationMs(420);
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
    now = 10_000 + timelineBeatDurationMs(420);
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
    now = start + timelineBeatDurationMs(420) + 50;
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

    now = start + timelineBeatDurationMs(420) + 50;
    rafCb();
    expect(injected.hidden).toBe(false);
    expect(injected.innerHTML).toContain("07:00");
    expect(injected.innerHTML).not.toContain("nli-tl-row");
    disposeInvestigationTimelineForMap(map);
  });

  it("idle clock-only caption hides and clears stale HTML when no narrative is active", async () => {
    const injected = { className: "", hidden: false, innerHTML: "stale caption", textContent: "", setAttribute() {} };
    const map = makeMap();
    const idleSync = syncInvestigationTimelineToMap(map, idleNliClock(), [{ id: "nli", layers: [] }], {
      captionEl: injected,
      allowMapCaption: false,
      nliCaptionMode: "clock-only",
      featuresById: {},
      getLayerDataUrl: () => null,
      now: () => 0,
    });
    expect(injected.hidden).toBe(true);
    expect(injected.innerHTML).toBe("");
    await idleSync;
    expect(injected.hidden).toBe(true);
    expect(injected.innerHTML).toBe("");
    expect(injected.innerHTML).not.toContain("nli-tl-row");
    disposeInvestigationTimelineForMap(map);
  });

  it("Segev idle clock-only caption paints 06:41", async () => {
    const injected = { className: "", hidden: true, innerHTML: "", textContent: "", setAttribute() {} };
    const map = makeMap();
    await syncInvestigationTimelineToMap(map, idleNliClock(), [{ id: "nli", layers: [] }], {
      captionEl: injected,
      allowMapCaption: false,
      nliCaptionMode: "clock-only",
      featuresById: {},
      getLayerDataUrl: () => null,
      narrativeFocus: { id: "segev" },
      now: () => 0,
    });
    expect(injected.hidden).toBe(false);
    expect(injected.innerHTML).toContain("06:41");
    expect(injected.innerHTML).not.toContain("nli-tl-row");
    disposeInvestigationTimelineForMap(map);
  });

  it("Nova idle clock-only caption paints 08:03", async () => {
    const injected = { className: "", hidden: true, innerHTML: "", textContent: "", setAttribute() {} };
    const map = makeMap();
    await syncInvestigationTimelineToMap(map, idleNliClock(), [{ id: "nli", layers: [] }], {
      captionEl: injected,
      allowMapCaption: false,
      nliCaptionMode: "clock-only",
      featuresById: {},
      getLayerDataUrl: () => null,
      narrativeFocus: { id: "nova" },
      now: () => 0,
    });
    expect(injected.hidden).toBe(false);
    expect(injected.innerHTML).toContain("08:03");
    expect(injected.innerHTML).toContain(
      formatMinutesAsLocalClock(NLI_NARRATIVES.nova.idleClockMinutes),
    );
    expect(injected.innerHTML).not.toContain("06:29");
    disposeInvestigationTimelineForMap(map);
  });

  it("clock-only relevance follows enabled direct playable IDs, not aliases or style presence", async () => {
    const cases = [
      { name: "alarms", layerId: "alarms", visible: true },
      { name: "lines", layerId: "lines", visible: true },
      { name: "investigation polygons", layerId: "investigation_polygons", visible: true },
      { name: "people names", layerId: "people_names", visible: false },
      { name: "people", layerId: "people", visible: false },
      { name: "relevant disabled", layerId: "lines", enabled: false, visible: false },
      {
        name: "fullLayerIds alias alone",
        layerId: "settlement_names",
        fullLayerIds: [INVESTIGATION_LINES_FULL_ID],
        visible: false,
      },
      { name: "physical style without effective enablement", layerId: null, visible: false },
    ];

    for (const testCase of cases) {
      const injected = { className: "", hidden: true, innerHTML: "", textContent: "", setAttribute() {} };
      const map = makeMap();
      const layers = testCase.layerId == null
        ? []
        : [{
            id: testCase.layerId,
            enabled: testCase.enabled !== false,
            ...(testCase.fullLayerIds ? { fullLayerIds: testCase.fullLayerIds } : {}),
          }];
      await syncInvestigationTimelineToMap(map, idleNliClock(), [{ id: "nli", layers }], {
        captionEl: injected,
        allowMapCaption: false,
        nliCaptionMode: "clock-only",
        featuresById: {
          [INVESTIGATION_POLYGONS_FULL_ID]: [],
          [INVESTIGATION_LINES_FULL_ID]: [],
          [INVESTIGATION_ALARMS_FULL_ID]: [],
        },
        settlementFeatures: [],
        getLayerDataUrl: () => null,
        now: () => 0,
      });
      expect(injected.hidden, testCase.name).toBe(!testCase.visible);
      if (testCase.visible) expect(injected.innerHTML, testCase.name).toContain("nli-tl-clock");
      else expect(injected.innerHTML, testCase.name).toBe("");
      disposeInvestigationTimelineForMap(map);
    }
  });

  it("clock-only relevance clears stale caption synchronously when effective groups turn unrelated", async () => {
    const injected = { className: "", hidden: true, innerHTML: "", textContent: "", setAttribute() {} };
    const map = makeMap();
    const playing = playClock([INVESTIGATION_LINES_FULL_ID], [420], 0);
    const deps = {
      captionEl: injected,
      allowMapCaption: false,
      nliCaptionMode: "clock-only",
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [],
        [INVESTIGATION_LINES_FULL_ID]: [{ properties: { Name: "ציר", timeline_minutes: 420 } }],
        [INVESTIGATION_ALARMS_FULL_ID]: [],
      },
      settlementFeatures: [],
      getLayerDataUrl: () => null,
      now: () => 0,
    };
    await syncInvestigationTimelineToMap(
      map,
      playing,
      [{ id: "nli", layers: [{ id: "lines", enabled: true }] }],
      deps,
    );
    expect(injected.hidden).toBe(false);
    expect(injected.innerHTML).toContain("07:00");

    const unrelatedSync = syncInvestigationTimelineToMap(
      map,
      playing,
      [{ id: "nli", layers: [{ id: "people_names", enabled: true }] }],
      deps,
    );
    expect(injected.hidden).toBe(true);
    expect(injected.innerHTML).toBe("");
    await unrelatedSync;

    await syncInvestigationTimelineToMap(
      map,
      playing,
      [{ id: "nli", layers: [{ id: "lines", enabled: true }] }],
      deps,
    );
    expect(injected.hidden).toBe(false);
    expect(injected.innerHTML).toContain("07:00");
    disposeInvestigationTimelineForMap(map);
  });

  it("clock-only unrelated groups stay hidden across idle, playing, paused, and ended phases", async () => {
    const seedClock = playClock([INVESTIGATION_LINES_FULL_ID], [420], 0);
    const cases = [
      { name: "idle", clock: idleNliClock() },
      { name: "playing", clock: seedClock },
      { name: "paused", clock: pauseNliClock(seedClock, 0) },
      { name: "ended", clock: endNliClock(seedClock) },
    ];
    for (const testCase of cases) {
      const injected = { className: "", hidden: true, innerHTML: "", textContent: "", setAttribute() {} };
      const map = makeMap();
      const deps = {
        captionEl: injected,
        allowMapCaption: false,
        nliCaptionMode: "clock-only",
        featuresById: {
          [INVESTIGATION_POLYGONS_FULL_ID]: [],
          [INVESTIGATION_LINES_FULL_ID]: [{ properties: { Name: "ציר", timeline_minutes: 420 } }],
          [INVESTIGATION_ALARMS_FULL_ID]: [],
        },
        settlementFeatures: [],
        getLayerDataUrl: () => null,
        now: () => 0,
      };
      await syncInvestigationTimelineToMap(map, seedClock, [{ id: "nli", layers: [{ id: "lines", enabled: true }] }], deps);
      expect(injected.hidden, `${testCase.name} seed`).toBe(false);
      const staleSync = syncInvestigationTimelineToMap(
        map,
        testCase.clock,
        [{ id: "nli", layers: [{ id: "people", enabled: true }] }],
        deps,
      );
      expect(injected.hidden, testCase.name).toBe(true);
      expect(injected.innerHTML, testCase.name).toBe("");
      await staleSync;
      expect(injected.hidden, `${testCase.name} settled`).toBe(true);
      expect(injected.innerHTML, `${testCase.name} settled`).toBe("");
      disposeInvestigationTimelineForMap(map);
    }
  });

  it("cold ended clock-only caption reconstructs the final finite beat", async () => {
    const injected = { className: "", hidden: true, innerHTML: "", textContent: "", setAttribute() {} };
    const map = makeMap();
    const ended = endNliClock(playNliClock(idleNliClock(), [INVESTIGATION_LINES_FULL_ID], [420, 440], 0));
    await syncInvestigationTimelineToMap(map, ended, [{ id: "nli", layers: [{ id: "lines", enabled: true }] }], {
      captionEl: injected,
      allowMapCaption: false,
      nliCaptionMode: "clock-only",
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [],
        [INVESTIGATION_LINES_FULL_ID]: [
          { properties: { Name: "ציר ראשון", timeline_minutes: 420 } },
          { properties: { Name: "ציר אחרון", timeline_minutes: 440 } },
        ],
        [INVESTIGATION_ALARMS_FULL_ID]: [],
      },
      settlementFeatures: [],
      getLayerDataUrl: () => null,
      now: () => 0,
    });
    expect(injected.hidden).toBe(false);
    expect(injected.innerHTML).toContain("07:20");
    expect(injected.innerHTML).not.toContain("06:29");
    disposeInvestigationTimelineForMap(map);
  });

  it("only recognized narratives or explicit debug make an empty-group clock-only caption relevant", async () => {
    const cases = [
      { name: "unknown", narrativeFocus: { id: "unknown" }, visible: false, clock: null },
      { name: "Segev", narrativeFocus: { id: "segev" }, visible: true, clock: "06:41" },
      { name: "Nova", narrativeFocus: { id: "nova" }, visible: true, clock: "08:03" },
      { name: "debug", narrativeFocus: null, explainerDebugVisible: true, visible: true, clock: "07:00" },
    ];
    for (const testCase of cases) {
      const injected = { className: "", hidden: true, innerHTML: "", textContent: "", setAttribute() {} };
      const map = makeMap();
      await syncInvestigationTimelineToMap(map, idleNliClock(), [{ id: "nli", layers: [] }], {
        captionEl: injected,
        allowMapCaption: false,
        nliCaptionMode: "clock-only",
        featuresById: {},
        getLayerDataUrl: () => null,
        narrativeFocus: testCase.narrativeFocus,
        explainerDebugVisible: testCase.explainerDebugVisible === true,
        now: () => 0,
      });
      expect(injected.hidden, testCase.name).toBe(!testCase.visible);
      if (testCase.clock) expect(injected.innerHTML, testCase.name).toContain(testCase.clock);
      else expect(injected.innerHTML, testCase.name).toBe("");
      disposeInvestigationTimelineForMap(map);
    }
  });

  it("a stale deferred feature request cannot revive an irrelevant clock-only caption", async () => {
    const injected = { className: "", hidden: true, innerHTML: "", textContent: "", setAttribute() {} };
    const map = makeMap();
    let rafCallback = null;
    vi.stubGlobal("requestAnimationFrame", (callback) => {
      rafCallback = callback;
      return 1;
    });
    const playing = playClock([INVESTIGATION_LINES_FULL_ID], [420], 0);
    const baseDeps = {
      captionEl: injected,
      allowMapCaption: false,
      nliCaptionMode: "clock-only",
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [],
        [INVESTIGATION_LINES_FULL_ID]: [{ properties: { Name: "ציר", timeline_minutes: 420 } }],
        [INVESTIGATION_ALARMS_FULL_ID]: [],
      },
      settlementFeatures: [],
      getLayerDataUrl: () => null,
      now: () => 0,
    };
    await syncInvestigationTimelineToMap(
      map,
      playing,
      [{ id: "nli", layers: [{ id: "lines", enabled: true }] }],
      baseDeps,
    );
    expect(injected.hidden).toBe(false);
    expect(rafCallback).toEqual(expect.any(Function));

    let resolveLines;
    const deferredLines = new Promise((resolve) => { resolveLines = resolve; });
    const lineUrl = "https://example.test/deferred-lines.geojson";
    const oldSync = syncInvestigationTimelineToMap(
      map,
      { ...playing, revision: 2 },
      [{ id: "nli", layers: [{ id: "lines", enabled: true }] }],
      {
        ...baseDeps,
        dataVersion: "deferred-v2",
        featuresById: {},
        getLayerDataUrl: (id) => id === INVESTIGATION_LINES_FULL_ID ? lineUrl : null,
        fetchJson: (url) => url === lineUrl ? deferredLines : Promise.resolve({ features: [] }),
      },
    );
    await Promise.resolve();

    const newerIrrelevantSync = syncInvestigationTimelineToMap(
      map,
      { ...playing, revision: 3 },
      [{ id: "nli", layers: [{ id: "people_names", enabled: true }] }],
      {
        ...baseDeps,
        dataVersion: "deferred-v2",
        featuresById: {},
        getLayerDataUrl: (id) => id === INVESTIGATION_LINES_FULL_ID ? lineUrl : null,
        fetchJson: (url) => url === lineUrl ? deferredLines : Promise.resolve({ features: [] }),
      },
    );
    expect(injected.hidden).toBe(true);
    expect(injected.innerHTML).toBe("");

    resolveLines({
      type: "FeatureCollection",
      features: [{ properties: { Name: "ציר", timeline_minutes: 420 } }],
    });
    await oldSync;
    await newerIrrelevantSync;
    rafCallback();
    expect(injected.hidden).toBe(true);
    expect(injected.innerHTML).toBe("");
    disposeInvestigationTimelineForMap(map);
  });

  it("style reload keeps an irrelevant clock-only caption hidden before and after remount", async () => {
    const injected = { className: "", hidden: true, innerHTML: "", textContent: "", setAttribute() {} };
    const map = makeMap();
    const listeners = new Map();
    map.on = vi.fn((type, callback) => listeners.set(type, callback));
    map.off = vi.fn((type, callback) => {
      if (listeners.get(type) === callback) listeners.delete(type);
    });
    map.fire = (type) => listeners.get(type)?.();
    const playing = playClock([INVESTIGATION_LINES_FULL_ID], [420], 0);
    const deps = {
      captionEl: injected,
      allowMapCaption: false,
      nliCaptionMode: "clock-only",
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [],
        [INVESTIGATION_LINES_FULL_ID]: [{ properties: { Name: "ציר", timeline_minutes: 420 } }],
        [INVESTIGATION_ALARMS_FULL_ID]: [],
      },
      settlementFeatures: [],
      getLayerDataUrl: () => null,
      now: () => 0,
    };
    await syncInvestigationTimelineToMap(
      map,
      playing,
      [{ id: "nli", layers: [{ id: "lines", enabled: true }] }],
      deps,
    );
    expect(injected.hidden).toBe(false);
    expect(listeners.get("style.load")).toEqual(expect.any(Function));

    prepareInvestigationTimelineForStyleReload(map);
    const beforeStyleLoad = syncInvestigationTimelineToMap(
      map,
      playing,
      [{ id: "nli", layers: [{ id: "people_names", enabled: true }] }],
      deps,
    );
    expect(injected.hidden).toBe(true);
    expect(injected.innerHTML).toBe("");
    await beforeStyleLoad;

    map.fire("style.load");
    await syncInvestigationTimelineToMap(
      map,
      playing,
      [{ id: "nli", layers: [{ id: "people_names", enabled: true }] }],
      deps,
    );
    expect(injected.hidden).toBe(true);
    expect(injected.innerHTML).toBe("");
    disposeInvestigationTimelineForMap(map);
  });

  it("stop after deferred playback keeps the recognized idle clock immediately and after resolution", async () => {
    const narratives = [
      { name: "ordinary", narrativeFocus: null, expected: "06:29" },
      { name: "Segev", narrativeFocus: { id: "segev" }, expected: "06:41" },
      { name: "Nova", narrativeFocus: { id: "nova" }, expected: "08:03" },
    ];
    for (const narrative of narratives) {
      const injected = { className: "", hidden: true, innerHTML: "", textContent: "", setAttribute() {} };
      const map = makeMap();
      const lineUrl = `https://example.test/${narrative.name}-deferred-lines.geojson`;
      let resolveLines;
      const deferredLines = new Promise((resolve) => { resolveLines = resolve; });
      const baseDeps = {
        captionEl: injected,
        allowMapCaption: false,
        nliCaptionMode: "clock-only",
        featuresById: {
          [INVESTIGATION_POLYGONS_FULL_ID]: [],
          [INVESTIGATION_LINES_FULL_ID]: [{ properties: { Name: "ציר", timeline_minutes: 420 } }],
          [INVESTIGATION_ALARMS_FULL_ID]: [],
        },
        settlementFeatures: [],
        narrativeFocus: narrative.narrativeFocus,
        now: () => 0,
      };
      const playing = playClock([INVESTIGATION_LINES_FULL_ID], [420], 0);
      await syncInvestigationTimelineToMap(
        map,
        playing,
        [{ id: "nli", layers: [{ id: "lines", enabled: true }] }],
        baseDeps,
      );
      expect(injected.hidden, `${narrative.name} seed`).toBe(false);

      const deferredDeps = {
        ...baseDeps,
        dataVersion: `${narrative.name}-deferred-v2`,
        featuresById: {},
        getLayerDataUrl: (id) => id === INVESTIGATION_LINES_FULL_ID ? lineUrl : null,
        fetchJson: (url) => url === lineUrl ? deferredLines : Promise.resolve({ features: [] }),
      };
      const playingSync = syncInvestigationTimelineToMap(
        map,
        { ...playing, revision: 2 },
        [{ id: "nli", layers: [{ id: "lines", enabled: true }] }],
        deferredDeps,
      );
      await Promise.resolve();

      const stopped = stopNliClock(playing);
      const stopSync = syncInvestigationTimelineToMap(
        map,
        stopped,
        [{ id: "nli", layers: [{ id: "lines", enabled: true }] }],
        deferredDeps,
      );
      expect(injected.hidden, `${narrative.name} immediate`).toBe(false);
      expect(injected.innerHTML, `${narrative.name} immediate`).toContain(narrative.expected);

      resolveLines({ type: "FeatureCollection", features: [] });
      await playingSync;
      await stopSync;
      expect(injected.hidden, `${narrative.name} resolved`).toBe(false);
      expect(injected.innerHTML, `${narrative.name} resolved`).toContain(narrative.expected);
      disposeInvestigationTimelineForMap(map);
    }
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

    now = timelineBeatDurationMs(420);
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
    expect(JSON.stringify(lastGradient[2])).toContain(String(1000 / timelineBeatDurationMs(420)));
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
      settlementFeatures: [],
      getLayerDataUrl: () => "https://example.test/lines.json",
      now: () => 0,
    });
    const idleSync = syncInvestigationTimelineToMap(map, stopped, bothGroups(), {
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES,
        [INVESTIGATION_LINES_FULL_ID]: LINE_FEATURES,
      },
      settlementFeatures: [],
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

  const YISHUVIM_FILL_ID = "projector_base__ישובים__fill__0";
  const YISHUVIM_LINE_ID = "projector_base__ישובים__line__0";
  const SHEMOT_LABEL_ID = "projector_base__שמות_יישובים__labels";
  const LOCATIONS_LINE_ID = "projector_base__Locations_Lines__line__0";
  const DOTTED_ORIENTATION_IDS = [
    "projector_base.ישובים",
    "projector_base.שמות_יישובים",
    "projector_base.Locations_Lines",
  ];

  function makeOrientationMap() {
    const map = makeMap();
    const layers = map.getStyle().layers;
    layers.push(
      { id: YISHUVIM_FILL_ID, type: "fill", source: "projector_base.ישובים" },
      { id: YISHUVIM_LINE_ID, type: "line", source: "projector_base.ישובים" },
      { id: SHEMOT_LABEL_ID, type: "symbol", source: "projector_base.שמות_יישובים" },
      { id: LOCATIONS_LINE_ID, type: "line", source: "projector_base.Locations_Lines" },
    );
    map.addSource("projector_base.שמות_יישובים", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: { cityname: "עיר א" }, geometry: { type: "Point", coordinates: [34.4, 31.4] } }],
      },
    });
    return map;
  }

  function orientationDeps() {
    return withProcessedPolygons({
      featuresById: { [INVESTIGATION_POLYGONS_FULL_ID]: [STORY_POLYGON_A] },
      settlementFeatures: [STORY_SETTLEMENT],
      now: () => 0,
    });
  }

  function dottedOrientationPaintCalls(map) {
    return map.setPaintProperty.mock.calls.filter(([id]) => DOTTED_ORIENTATION_IDS.includes(id));
  }

  it("dims mangled orientation layers while playing and lights achieved שמות names", async () => {
    const map = makeOrientationMap();
    await syncInvestigationTimelineToMap(
      map,
      playClock([INVESTIGATION_POLYGONS_FULL_ID], [400]),
      polygonOnlyGroups(),
      orientationDeps(),
    );

    expect(map.setPaintProperty).toHaveBeenCalledWith(YISHUVIM_FILL_ID, "fill-opacity", 0.28);
    expect(map.setPaintProperty).toHaveBeenCalledWith(YISHUVIM_LINE_ID, "line-opacity", 0.28);
    expect(map.setPaintProperty).toHaveBeenCalledWith(LOCATIONS_LINE_ID, "line-opacity", 0.28);
    const textCall = [...map.setPaintProperty.mock.calls]
      .reverse()
      .find(([id, key]) => id === SHEMOT_LABEL_ID && key === "text-opacity");
    expect(textCall).toBeDefined();
    const expression = JSON.stringify(textCall[2]);
    expect(expression).toContain("0.35");
    expect(expression).toContain("1");
    expect(expression).toContain("עיר א");
    expect(dottedOrientationPaintCalls(map)).toEqual([]);
    disposeInvestigationTimelineForMap(map);
  });

  it("idle restores orientation opacity 1 without a dim expression", async () => {
    const map = makeOrientationMap();
    const deps = orientationDeps();
    const playing = playClock([INVESTIGATION_POLYGONS_FULL_ID], [400]);
    await syncInvestigationTimelineToMap(map, playing, polygonOnlyGroups(), deps);
    map.setPaintProperty.mockClear();
    await syncInvestigationTimelineToMap(map, idleNliClock(), polygonOnlyGroups(), deps);

    expect(map.setPaintProperty).toHaveBeenCalledWith(YISHUVIM_FILL_ID, "fill-opacity", 1);
    expect(map.setPaintProperty).toHaveBeenCalledWith(YISHUVIM_LINE_ID, "line-opacity", 1);
    expect(map.setPaintProperty).toHaveBeenCalledWith(LOCATIONS_LINE_ID, "line-opacity", 1);
    expect(map.setPaintProperty).toHaveBeenCalledWith(SHEMOT_LABEL_ID, "text-opacity", 1);
    const textCalls = map.setPaintProperty.mock.calls.filter(
      ([id, key]) => id === SHEMOT_LABEL_ID && key === "text-opacity",
    );
    expect(textCalls.every(([, , value]) => value === 1)).toBe(true);
    expect(dottedOrientationPaintCalls(map)).toEqual([]);
    disposeInvestigationTimelineForMap(map);
  });

  it("unions escape-impact outline ids into dim-all orientation citynames", async () => {
    const map = makeOrientationMap();
    await syncInvestigationTimelineToMap(map, idleNliClock(), polygonOnlyGroups(), {
      ...orientationDeps(),
      narrativeFocus: NLI_NARRATIVES.nova,
      settlementFeatures: [{
        type: "Feature",
        properties: { outlineObjectId: 19, locations: ["עיר א"] },
        geometry: STORY_SETTLEMENT.geometry,
      }],
    });
    setEscapeImpactOrientationIds(map, ["19", "100"]);
    expect(map.getPaintProperty(SHEMOT_LABEL_ID, "text-opacity"))
      .toEqual(["case", ["in", ["get", "cityname"], ["literal", ["נובה", "עיר א"]]], 1, 0.35]);
    expect(JSON.stringify(map.getPaintProperty(SHEMOT_LABEL_ID, "text-opacity"))).not.toMatch(/רעים/);
    disposeInvestigationTimelineForMap(map);
  });

  it("keepFocusLabelWithAchieved is taken from narrativeFocus.keepFocusLabelWithAchieved", async () => {
    const impactSettlement = {
      type: "Feature",
      properties: { outlineObjectId: 19, locations: ["עיר א"] },
      geometry: STORY_SETTLEMENT.geometry,
    };

    const nova = makeOrientationMap();
    await syncInvestigationTimelineToMap(nova, idleNliClock(), polygonOnlyGroups(), {
      ...orientationDeps(),
      narrativeFocus: NLI_NARRATIVES.nova,
      settlementFeatures: [impactSettlement],
    });
    setEscapeImpactOrientationIds(nova, ["19"]);
    expect(nova.getPaintProperty(SHEMOT_LABEL_ID, "text-opacity"))
      .toEqual(["case", ["in", ["get", "cityname"], ["literal", ["נובה", "עיר א"]]], 1, 0.35]);
    disposeInvestigationTimelineForMap(nova);

    const sderot = makeOrientationMap();
    await syncInvestigationTimelineToMap(sderot, idleNliClock(), polygonOnlyGroups(), {
      ...orientationDeps(),
      narrativeFocus: NLI_NARRATIVES.sderot,
      settlementFeatures: [impactSettlement],
    });
    setEscapeImpactOrientationIds(sderot, ["19"]);
    expect(sderot.getPaintProperty(SHEMOT_LABEL_ID, "text-opacity"))
      .toEqual(["case", ["==", ["get", "cityname"], "שדרות"], 1, 0.35]);
    disposeInvestigationTimelineForMap(sderot);

    const flagged = makeOrientationMap();
    await syncInvestigationTimelineToMap(flagged, idleNliClock(), polygonOnlyGroups(), {
      ...orientationDeps(),
      narrativeFocus: { ...NLI_NARRATIVES.sderot, keepFocusLabelWithAchieved: true },
      settlementFeatures: [impactSettlement],
    });
    setEscapeImpactOrientationIds(flagged, ["19"]);
    expect(flagged.getPaintProperty(SHEMOT_LABEL_ID, "text-opacity"))
      .toEqual(["case", ["in", ["get", "cityname"], ["literal", ["שדרות", "עיר א"]]], 1, 0.35]);
    disposeInvestigationTimelineForMap(flagged);
  });

  it("Nova idle lights the existing נובה place name on projection", async () => {
    const map = makeOrientationMap();
    await syncInvestigationTimelineToMap(map, idleNliClock(), polygonOnlyGroups(), {
      ...orientationDeps(),
      narrativeFocus: NLI_NARRATIVES.nova,
      displayProfile: "projection",
    });
    expect(map.getPaintProperty(SHEMOT_LABEL_ID, "text-opacity"))
      .toEqual(["case", ["in", ["get", "cityname"], ["literal", ["נובה"]]], 1, 0.35]);
    expect(map.getPaintProperty(YISHUVIM_FILL_ID, "fill-opacity"))
      .toEqual(["case", ["==", ["get", "OBJECTID"], 43], 1, 0.28]);
    expect(map.getPaintProperty(YISHUVIM_LINE_ID, "line-opacity"))
      .toEqual(["case", ["==", ["get", "OBJECTID"], 43], 1, 0.28]);
    expect(map.getLayer("nli-nova-site-outline")).toBeFalsy();
    disposeInvestigationTimelineForMap(map);
  });

  it("idle nova GIS has no fills, persistent nova-site battle line, and no complete-story lines", async () => {
    const map = makeMap();
    await syncInvestigationTimelineToMap(map, idleNliClock(), polygonOnlyGroups(), withProcessedPolygons({
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [{
          type: "Feature",
          properties: {
            OBJECTID: 100,
            timeline_minutes: 500,
            Notes: "מרחב לחימה - קרב",
            מיקום: "נובה",
          },
          geometry: STORY_POLYGON_A.geometry,
        }],
      },
      narrativeFocus: { id: "nova" },
      displayProfile: "gis",
      motionMode: "reduced",
      now: () => 0,
    }));
    const fills = map.getSource("nli-investigation-polygon-category")?.setData?.mock?.calls?.at(-1)?.[0]?.features
      ?? map.getSource("nli-investigation-polygon-category")?.data?.features
      ?? [];
    expect(fills).toEqual([]);
    expect(map.getLayer("nli-nova-site-outline")).toBeFalsy();
    disposeInvestigationTimelineForMap(map);
  });

  it("GIS polygons chip off plus nova still mounts overlay and outline 100 without enabling the chip", async () => {
    const map = makeMap();
    const groups = [{
      id: "nli",
      layers: [
        { id: "investigation_polygons", enabled: false },
        { id: "lines", enabled: false },
      ],
    }];
    await syncInvestigationTimelineToMap(map, idleNliClock(), groups, withProcessedPolygons({
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [{
          type: "Feature",
          properties: {
            OBJECTID: 100,
            timeline_minutes: 500,
            Notes: "מרחב לחימה - קרב",
            מיקום: "נובה",
          },
          geometry: STORY_POLYGON_A.geometry,
        }],
      },
      narrativeFocus: { id: "nova" },
      displayProfile: "gis",
      motionMode: "reduced",
      now: () => 0,
    }));
    expect(map.getLayer("nli-nova-site-outline")).toBeFalsy();
    expect(groups[0].layers[0].enabled).toBe(false);
    disposeInvestigationTimelineForMap(map);
  });

  it("GIS nova idle chip off fetches polygon 100 without featuresById", async () => {
    const map = makeMap();
    const groups = [{
      id: "nli",
      layers: [
        { id: "investigation_polygons", enabled: false },
        { id: "lines", enabled: false },
      ],
    }];
    const getLayerDataUrl = vi.fn((id) => (
      id === INVESTIGATION_POLYGONS_FULL_ID
        ? "https://example.test/investigation_polygons.geojson"
        : null
    ));
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          properties: {
            OBJECTID: 100,
            timeline_minutes: 500,
            Notes: "מרחב לחימה - קרב",
            מיקום: "נובה",
          },
          geometry: STORY_POLYGON_A.geometry,
        }],
      }),
    })));
    await syncInvestigationTimelineToMap(map, idleNliClock(), groups, withProcessedPolygons({
      getLayerDataUrl,
      narrativeFocus: { id: "nova" },
      displayProfile: "gis",
      motionMode: "reduced",
      now: () => 0,
    }));
    expect(getLayerDataUrl).toHaveBeenCalledWith(INVESTIGATION_POLYGONS_FULL_ID);
    expect(map.getLayer("nli-nova-site-outline")).toBeFalsy();
    expect(groups[0].layers[0].enabled).toBe(false);
    disposeInvestigationTimelineForMap(map);
  });

  it("projection nova play with both chips off still paints polygons and lines without enabling chips", async () => {
    const map = makeMap();
    const groups = [{
      id: "nli",
      layers: [
        { id: "investigation_polygons", enabled: false },
        { id: "lines", enabled: false },
        { id: "alarms", enabled: false },
      ],
    }];
    const playing = playNliClock(
      idleNliClock(),
      [],
      [400, 492],
      0,
    );
    const at492 = { ...playing, positionMs: timelineBeatDurationMs(400), phase: "paused", seekKind: "none" };
    await syncInvestigationTimelineToMap(map, at492, groups, withProcessedPolygons({
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [{
          type: "Feature",
          properties: {
            OBJECTID: 99,
            timeline_minutes: 492,
            Notes: "מרחב לחימה - קרב",
            מיקום: "נובה",
          },
          geometry: STORY_POLYGON_B.geometry,
        }],
        [INVESTIGATION_LINES_FULL_ID]: LINE_FEATURES,
      },
      narrativeFocus: { id: "nova" },
      displayProfile: "projection",
      motionMode: "reduced",
      now: () => 0,
    }));
    expect(map.getSource("nli-investigation-line-completed-carrier")?.setData?.mock?.calls?.length
      ?? map.getSource("nli-investigation-line-completed-carrier")?.data?.features?.length
      ?? 0).toBeGreaterThan(0);
    expect(map.getLayer("nli-investigation-polygon-category-fill-battle")).toBeTruthy();
    expect(groups[0].layers.map((layer) => layer.enabled)).toEqual([false, false, false]);
    expect(map.getLayer("nli-nova-site-outline")).toBeFalsy();
    disposeInvestigationTimelineForMap(map);
  });

  it("GIS and projection nova both light yeshuv 43 and skip callouts", async () => {
    const site = {
      type: "Feature",
      properties: {
        OBJECTID: 100,
        timeline_minutes: 500,
        Notes: "מרחב לחימה - קרב",
        מיקום: "נובה",
        Name: "שם 100",
      },
      geometry: STORY_POLYGON_A.geometry,
    };
    const playing = playClock([INVESTIGATION_POLYGONS_FULL_ID], [500]);
    const deps = withProcessedPolygons({
      ...orientationDeps(),
      featuresById: { [INVESTIGATION_POLYGONS_FULL_ID]: [site] },
      narrativeFocus: NLI_NARRATIVES.nova,
      motionMode: "reduced",
      now: () => 0,
    });
    for (const displayProfile of ["gis", "projection"]) {
      const map = makeOrientationMap();
      await syncInvestigationTimelineToMap(map, playing, polygonOnlyGroups(), {
        ...deps,
        displayProfile,
      });
      expect(map.getLayer("nli-nova-site-outline")).toBeFalsy();
      expect(map.getPaintProperty(YISHUVIM_LINE_ID, "line-opacity"))
        .toEqual(["case", ["==", ["get", "OBJECTID"], 43], 1, 0.28]);
      expect(map.getLayer("nli-nova-gis-callout-leader")).toBeFalsy();
      disposeInvestigationTimelineForMap(map);
    }
  });

  it("projection nova idle lights yeshuv 43 instead of cloning polygon 100", async () => {
    const map = makeOrientationMap();
    await syncInvestigationTimelineToMap(map, idleNliClock(), polygonOnlyGroups(), withProcessedPolygons({
      ...orientationDeps(),
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [{
          type: "Feature",
          properties: {
            OBJECTID: 100,
            timeline_minutes: 500,
            Notes: "מרחב לחימה - קרב",
            מיקום: "נובה",
          },
          geometry: STORY_POLYGON_A.geometry,
        }],
      },
      narrativeFocus: NLI_NARRATIVES.nova,
      displayProfile: "projection",
      motionMode: "reduced",
      now: () => 0,
    }));
    expect(map.getLayer("nli-nova-site-outline")).toBeFalsy();
    expect(map.getPaintProperty(YISHUVIM_LINE_ID, "line-opacity"))
      .toEqual(["case", ["==", ["get", "OBJECTID"], 43], 1, 0.28]);
    disposeInvestigationTimelineForMap(map);
  });

  it("projection nova stays faded until fleeing contact and re-dims when individual turns off", async () => {
    const map = makeMap();
    const site100 = {
      type: "Feature",
      properties: {
        OBJECTID: 100,
        timeline_minutes: 500,
        Notes: "מרחב לחימה - קרב",
        מיקום: "נובה",
      },
      geometry: STORY_POLYGON_A.geometry,
    };
    const neighbor99 = {
      type: "Feature",
      properties: {
        OBJECTID: 99,
        timeline_minutes: 492,
        Notes: "מרחב לחימה - קרב",
        מיקום: "נובה",
      },
      geometry: STORY_POLYGON_B.geometry,
    };
    const playing = playNliClock(
      idleNliClock(),
      [INVESTIGATION_POLYGONS_FULL_ID],
      [492, 500],
      0,
    );
    const novaPolyDeps = (impactIds) => withProcessedPolygons({
      featuresById: { [INVESTIGATION_POLYGONS_FULL_ID]: [site100, neighbor99] },
      narrativeFocus: { id: "nova" },
      displayProfile: "projection",
      parallelImpactIds: new Set(impactIds),
      motionMode: "reduced",
      now: () => 0,
    });
    const at500 = { ...playing, positionMs: timelineBeatDurationMs(492), phase: "paused", seekKind: "none" };
    await syncInvestigationTimelineToMap(map, at500, polygonOnlyGroups(), novaPolyDeps([]));
    expect(map.getPaintProperty("nli-investigation-polygon-category-fill-battle", "fill-opacity"))
      .toEqual(["case", ["in", ["to-string", ["get", "OBJECTID"]], ["literal", []]], 0.55, ["*", 0.55, 0.28]]);
    expect(map.getLayer("nli-nova-site-outline")).toBeFalsy();
    await syncInvestigationTimelineToMap(map, at500, polygonOnlyGroups(), novaPolyDeps(["polygon:99"]));
    expect(map.getPaintProperty("nli-investigation-polygon-category-fill-battle", "fill-opacity"))
      .toEqual(["case", ["in", ["to-string", ["get", "OBJECTID"]], ["literal", ["99"]]], 0.55, ["*", 0.55, 0.28]]);
    await syncInvestigationTimelineToMap(map, at500, polygonOnlyGroups(), novaPolyDeps(["polygon:100"]));
    expect(map.getLayer("nli-nova-site-outline")).toBeFalsy();
    await syncInvestigationTimelineToMap(map, at500, polygonOnlyGroups(), novaPolyDeps([]));
    expect(map.getPaintProperty("nli-investigation-polygon-category-fill-battle", "fill-opacity"))
      .toEqual(["case", ["in", ["to-string", ["get", "OBJECTID"]], ["literal", []]], 0.55, ["*", 0.55, 0.28]]);
    expect(map.getLayer("nli-nova-site-outline")).toBeFalsy();
    disposeInvestigationTimelineForMap(map);
  });

  it("GIS nova at500 keeps battle fill-opacity without projection dim", async () => {
    const map = makeMap();
    const site100 = {
      type: "Feature",
      properties: {
        OBJECTID: 100,
        timeline_minutes: 500,
        Notes: "מרחב לחימה - קרב",
        מיקום: "נובה",
      },
      geometry: STORY_POLYGON_A.geometry,
    };
    const neighbor99 = {
      type: "Feature",
      properties: {
        OBJECTID: 99,
        timeline_minutes: 492,
        Notes: "מרחב לחימה - קרב",
        מיקום: "נובה",
      },
      geometry: STORY_POLYGON_B.geometry,
    };
    const playing = playNliClock(
      idleNliClock(),
      [INVESTIGATION_POLYGONS_FULL_ID],
      [492, 500],
      0,
    );
    const at500 = { ...playing, positionMs: timelineBeatDurationMs(492), phase: "paused", seekKind: "none" };
    await syncInvestigationTimelineToMap(map, at500, polygonOnlyGroups(), withProcessedPolygons({
      featuresById: { [INVESTIGATION_POLYGONS_FULL_ID]: [site100, neighbor99] },
      narrativeFocus: { id: "nova" },
      displayProfile: "gis",
      parallelImpactIds: new Set(),
      motionMode: "reduced",
      now: () => 0,
    }));
    const paint = map.getPaintProperty("nli-investigation-polygon-category-fill-battle", "fill-opacity");
    expect(JSON.stringify(paint)).not.toContain("0.28");
    expect(paint === 0.55 || JSON.stringify(paint).includes("0.55")).toBe(true);
    disposeInvestigationTimelineForMap(map);
  });

  it("projection nova shared OBJECTID lights only the namespaced kind", async () => {
    const map = makeMap();
    const poly1 = {
      type: "Feature",
      properties: {
        OBJECTID: 1,
        timeline_minutes: 400,
        Notes: "מרחב לחימה - קרב",
        מיקום: "נובה",
      },
      geometry: STORY_POLYGON_A.geometry,
    };
    const line1 = {
      type: "Feature",
      properties: { OBJECTID: 1, Name: "כפר עזה - רחפנים", timeline_minutes: 400 },
      geometry: { type: "LineString", coordinates: [[34.4, 31.4], [34.5, 31.5]] },
    };
    const playing = playNliClock(
      idleNliClock(),
      [INVESTIGATION_POLYGONS_FULL_ID, INVESTIGATION_LINES_FULL_ID],
      [400],
      0,
    );
    const at400 = { ...playing, positionMs: 0, phase: "paused", seekKind: "none" };
    await syncInvestigationTimelineToMap(map, at400, bothGroups(), withProcessedPolygons({
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [poly1],
        [INVESTIGATION_LINES_FULL_ID]: [line1],
      },
      narrativeFocus: { id: "nova" },
      displayProfile: "projection",
      parallelImpactIds: new Set(["polygon:1"]),
      motionMode: "reduced",
      now: () => 0,
    }));
    expect(map.getPaintProperty("nli-investigation-polygon-category-fill-battle", "fill-opacity"))
      .toEqual(["case", ["in", ["to-string", ["get", "OBJECTID"]], ["literal", ["1"]]], 0.55, ["*", 0.55, 0.28]]);
    expect(map.getPaintProperty("nli-investigation-line-completed-carrier-line", "line-opacity"))
      .toEqual(["case", ["in", ["to-string", ["get", "OBJECTID"]], ["literal", []]], 1, 0.28]);
    await syncInvestigationTimelineToMap(map, at400, bothGroups(), withProcessedPolygons({
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [poly1],
        [INVESTIGATION_LINES_FULL_ID]: [line1],
      },
      narrativeFocus: { id: "nova" },
      displayProfile: "projection",
      parallelImpactIds: new Set(["line:1"]),
      motionMode: "reduced",
      now: () => 0,
    }));
    expect(map.getPaintProperty("nli-investigation-polygon-category-fill-battle", "fill-opacity"))
      .toEqual(["case", ["in", ["to-string", ["get", "OBJECTID"]], ["literal", []]], 0.55, ["*", 0.55, 0.28]]);
    expect(map.getPaintProperty("nli-investigation-line-completed-carrier-line", "line-opacity"))
      .toEqual(["case", ["in", ["to-string", ["get", "OBJECTID"]], ["literal", ["1"]]], 1, 0.28]);
    disposeInvestigationTimelineForMap(map);
  });

  it("projection nova infiltration lines dim then light from parallelImpactIds including off→on→off", async () => {
    const map = makeMap();
    const line9 = {
      type: "Feature",
      properties: { OBJECTID: 9, Name: "כפר עזה - רחפנים", timeline_minutes: 400 },
      geometry: { type: "LineString", coordinates: [[34.4, 31.4], [34.5, 31.5]] },
    };
    const playing = playNliClock(idleNliClock(), [INVESTIGATION_LINES_FULL_ID], [400], 0);
    const at400 = { ...playing, positionMs: 0, phase: "paused", seekKind: "none" };
    const lineGroups = [{
      id: "nli",
      layers: [{ id: "lines", enabled: true }],
    }];
    const faded = ["case", ["in", ["to-string", ["get", "OBJECTID"]], ["literal", []]], 1, 0.28];
    const lit = ["case", ["in", ["to-string", ["get", "OBJECTID"]], ["literal", ["9"]]], 1, 0.28];
    await syncInvestigationTimelineToMap(map, at400, lineGroups, {
      featuresById: { [INVESTIGATION_LINES_FULL_ID]: [line9] },
      narrativeFocus: { id: "nova" },
      displayProfile: "projection",
      parallelImpactIds: new Set(),
      motionMode: "reduced",
      now: () => 0,
    });
    expect(map.getPaintProperty("nli-investigation-line-completed-carrier-line", "line-opacity")).toEqual(faded);
    expect(map.getPaintProperty("nli-investigation-line-completed-motion-line", "line-opacity")).toEqual(faded);
    expect(map.getPaintProperty("nli-investigation-line-active-line", "line-opacity")).toEqual(faded);
    expect(map.getPaintProperty("nli-investigation-line-head-circle", "circle-opacity")).toEqual(faded);
    await syncInvestigationTimelineToMap(map, at400, lineGroups, {
      featuresById: { [INVESTIGATION_LINES_FULL_ID]: [line9] },
      narrativeFocus: { id: "nova" },
      displayProfile: "projection",
      parallelImpactIds: new Set(["line:9"]),
      motionMode: "reduced",
      now: () => 0,
    });
    expect(map.getPaintProperty("nli-investigation-line-completed-carrier-line", "line-opacity")).toEqual(lit);
    expect(map.getPaintProperty("nli-investigation-line-active-line", "line-opacity")).toEqual(lit);
    expect(map.getPaintProperty("nli-investigation-line-head-circle", "circle-opacity")).toEqual(lit);
    await syncInvestigationTimelineToMap(map, playing, lineGroups, {
      featuresById: { [INVESTIGATION_LINES_FULL_ID]: [line9] },
      narrativeFocus: { id: "nova" },
      displayProfile: "projection",
      parallelImpactIds: new Set(["line:9"]),
      motionMode: "reduced",
      now: () => 800,
    });
    const heads = map.getSource("nli-investigation-line-head")?.setData?.mock?.calls?.at(-1)?.[0]?.features
      ?? map.getSource("nli-investigation-line-head")?.data?.features
      ?? [];
    expect(heads.some((feature) => String(feature.properties?.OBJECTID) === "9")).toBe(true);
    await syncInvestigationTimelineToMap(map, at400, lineGroups, {
      featuresById: { [INVESTIGATION_LINES_FULL_ID]: [line9] },
      narrativeFocus: { id: "nova" },
      displayProfile: "projection",
      parallelImpactIds: new Set(),
      motionMode: "reduced",
      now: () => 0,
    });
    expect(map.getPaintProperty("nli-investigation-line-completed-carrier-line", "line-opacity")).toEqual(faded);
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
    expect(namedArrowFunctionBody(src, clockCb)).toContain("getPersonSelection");
    expect(src).toMatch(/subscribe\("personSelection",\s*syncContextPersonSelection\)/);
    expect(src).toMatch(/const syncContextPersonSelection = \(selection\) => \{[\s\S]*wakeInvestigationTimelinePersonGlow\(map\)/);
    expect(src).toMatch(/const syncContextPersonSelection = \(selection\) => \{[\s\S]*handlePersonSelection/);
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
    expect(namedArrowFunctionBody(src, clockCb)).toContain("getPersonSelection");
    expect(src).toMatch(/subscribe\("personSelection",\s*syncContextInvestigation\)|subscribe\("personSelection",\s*wakeProjectionPersonGlow\)/);
    expect(src).toMatch(/wakeInvestigationTimelinePersonGlow/);
  });
});
