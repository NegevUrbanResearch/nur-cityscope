import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALARM_COUNT_COLOR_STOPS,
  ALARM_COUNT_RADIUS_STOPS,
  alarmCirclePaint,
  cityFlashedInWindow,
  collectAlarmTimelineBeats,
  countAlarmsAtClock,
  flashingCityNames,
  INVESTIGATION_ALARMS_FULL_ID,
  quantizeAlarmMinutes,
} from "../../frontend/src/shared/maplibre-investigation-alarms.js";
import { buildNliExplainerModel, nliExplainerInnerHtml } from "../../frontend/src/shared/nli-explainer-model.js";
import { flashPreviousClock, idleNliClock, playNliClock } from "../../frontend/src/shared/nli-investigation-clock.js";
import {
  collectPlaybackTimelineBeats,
  disposeInvestigationTimelineForMap,
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
  syncInvestigationTimelineToMap,
  TIMELINE_BEAT_MS,
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

describe("investigation alarm helpers", () => {
  it("does not import route-progress helpers", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.resolve(here, "../../frontend/src/shared/maplibre-investigation-alarms.js"),
      "utf8",
    );
    expect(src).not.toMatch(/maplibre-route-progress-overlay/);
    expect(src).not.toMatch(/syncRouteProgressOverlaysToMap/);
    expect(src).not.toMatch(/usesRouteProgressOverlay/);
    expect(src).not.toMatch(/maplibre-flow-animation/);
    expect(src).not.toMatch(/export function alarmCaptionHtml/);
  });

  it("quantizes alarm minutes to 5-minute bins", () => {
    expect(quantizeAlarmMinutes(389)).toBe(385);
    expect(quantizeAlarmMinutes(390)).toBe(390);
  });

  it("alarms-only beats flatten alarm_minutes only", () => {
    expect(
      collectAlarmTimelineBeats([
        { properties: { alarm_minutes: [389, 391] } },
        { properties: { alarm_minutes: [402] } },
        { properties: { timeline_minutes: 500 } },
      ]),
    ).toEqual([385, 390, 400]);
  });

  it("counts minutes at or before clock and full list on hold", () => {
    expect(countAlarmsAtClock([389, 390, 400], 389)).toBe(1);
    expect(countAlarmsAtClock([389, 390, 400], 400)).toBe(3);
    expect(countAlarmsAtClock([389, 390, 400], null)).toBe(3);
    expect(countAlarmsAtClock([389, 389], 389)).toBe(2);
  });

  it("flashes when any minute is in (previous, clock]", () => {
    expect(cityFlashedInWindow([389, 410], 400, null)).toBe(true);
    expect(cityFlashedInWindow([389, 410], 410, 400)).toBe(true);
    expect(cityFlashedInWindow([389], 410, 400)).toBe(false);
    expect(cityFlashedInWindow([389], null, null)).toBe(false);
  });

  it("flashingCityNames orders by window count, caps at 12, and returns leftover total", () => {
    const features = [
      { properties: { city: "ב", alarm_minutes: [400, 400] } },
      { properties: { city: "א", alarm_minutes: [400] } },
    ];
    expect(flashingCityNames(features, 400, null).rows.map((x) => x.city)).toEqual(["ב", "א"]);
    const many = Array.from({ length: 15 }, (_, i) => ({
      properties: { city: `עיר-${String(i).padStart(2, "0")}`, alarm_minutes: [400] },
    }));
    const capped = flashingCityNames(many, 400, null);
    expect(capped.rows).toHaveLength(12);
    expect(capped.totalFlashing).toBe(15);
    expect(capped.rows.every((row) => row.n === 1)).toBe(true);
    const html = nliExplainerInnerHtml(
      buildNliExplainerModel({
        polygonOn: false,
        lineOn: false,
        alarmPlay: true,
        polygonFeatures: [],
        lineFeatures: [],
        alarmFeatures: many,
        clock: 400,
        previousClock: null,
      }),
    );
    expect(html).toMatch(/ועוד 3/);
    expect(html).toMatch(/nli-tl-chip/);
  });

  it("paints overlay GeoJSON count interpolate expressions, not feature-state", () => {
    expect(ALARM_COUNT_COLOR_STOPS).toEqual([
      [1, "#1e3a8a"],
      [7, "#22d3ee"],
      [26, "#a3e635"],
      [77, "#7f1d1d"],
    ]);
    expect(ALARM_COUNT_RADIUS_STOPS).toEqual([
      [1, 4],
      [7, 7],
      [26, 12],
      [77, 16],
    ]);
    const settled = alarmCirclePaint(0, false);
    expect(JSON.stringify(settled.color)).toMatch(/"get","count"/);
    expect(JSON.stringify(settled.color)).not.toMatch(/feature-state/);
    expect(JSON.stringify(settled.color)).toMatch(/#1e3a8a/i);
    expect(JSON.stringify(settled.color)).toMatch(/#7f1d1d/i);
    expect(JSON.stringify(settled.color)).toMatch(/interpolate/i);
    expect(JSON.stringify(settled.color)).not.toMatch(/#ef4444/);
    expect(JSON.stringify(settled.color)).not.toMatch(/fde68a/i);
    expect(JSON.stringify(settled.opacity)).toMatch(/0\.55/);
    const hiddenBranch = JSON.stringify(settled.radius);
    expect(hiddenBranch).toMatch(/"case"/);
    const flash = alarmCirclePaint(0, true);
    expect(JSON.stringify(flash.color)).toMatch(/#fde68a/i);
    expect(JSON.stringify(flash.opacity)).toMatch(/0\.9/);
  });

  it("jump to later beat flashes only the native window", () => {
    const names = flashingCityNames(
      [
        { properties: { city: "A", alarm_minutes: [400], alarm_count_total: 1 } },
        { properties: { city: "B", alarm_minutes: [420], alarm_count_total: 1 } },
      ],
      420,
      flashPreviousClock([400, 420], 420, { isJump: true }),
    );
    expect(names.rows.map((r) => r.city)).toEqual(["B"]);
  });

  it("jump to first beat does not megawave", () => {
    const names = flashingCityNames(
      [{ properties: { city: "A", alarm_minutes: [400], alarm_count_total: 1 } }],
      400,
      flashPreviousClock([400, 420], 400, { isJump: true }),
    );
    expect(names.totalFlashing).toBe(0);
  });
});

describe("syncInvestigationTimelineToMap alarms", () => {
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

  const POLYGON_BEATS = [
    400, 410, 420, 435, 560, 570, 700, 740,
  ];

  function playClock(membership, beats, nowMs = 0) {
    return playNliClock(idleNliClock(), membership, beats, nowMs);
  }

  it("sync paints overlay alarm circles from GeoJSON count, not pack feature-state", async () => {
    const map = makeMap();
    const alarmId = "nli__alarms__circle__0";
    const groups = [
      {
        id: "nli",
        layers: [
          { id: "investigation_polygons", enabled: true },
          { id: "lines", enabled: true },
          { id: "alarms", enabled: true },
        ],
      },
    ];
    await syncInvestigationTimelineToMap(
      map,
      playClock(
        [INVESTIGATION_POLYGONS_FULL_ID, INVESTIGATION_LINES_FULL_ID, INVESTIGATION_ALARMS_FULL_ID],
        POLYGON_BEATS,
      ),
      groups,
      {
        featuresById: {
          [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES,
          [INVESTIGATION_LINES_FULL_ID]: LINE_FEATURES,
          [INVESTIGATION_ALARMS_FULL_ID]: [
            { id: "שדרות", properties: { alarm_minutes: [389], city: "שדרות" } },
            { id: "עוטף", properties: { alarm_minutes: [395], city: "עוטף" } },
          ],
        },
        now: () => 0,
      },
    );
    const overlayCircleId = "nli-investigation-alarm-circles";
    const expected = alarmCirclePaint(0, true);
    const overlayRadius = map.setPaintProperty.mock.calls.filter(
      (call) => call[0] === overlayCircleId && call[1] === "circle-radius",
    );
    const overlayColor = map.setPaintProperty.mock.calls.filter(
      (call) => call[0] === overlayCircleId && call[1] === "circle-color",
    );
    const overlayOpacity = map.setPaintProperty.mock.calls.filter(
      (call) => call[0] === overlayCircleId && call[1] === "circle-opacity",
    );
    expect(overlayRadius[0][2]).toEqual(expected.radius);
    expect(overlayColor[0][2]).toEqual(expected.color);
    expect(overlayOpacity[0][2]).toEqual(expected.opacity);
    expect(JSON.stringify(overlayColor[0][2])).toMatch(/"get","count"/);
    expect(JSON.stringify(overlayColor[0][2])).not.toMatch(/feature-state/);
    expect(JSON.stringify(overlayColor[0][2])).toMatch(/#1e3a8a/i);
    expect(JSON.stringify(overlayColor[0][2])).not.toMatch(/#ef4444/);
    const packHidden = map.setPaintProperty.mock.calls.filter(
      (call) => call[0] === alarmId && call[1] === "circle-opacity" && call[2] === 0,
    );
    expect(packHidden.length).toBeGreaterThan(0);
    expect(map.setFeatureState).not.toHaveBeenCalled();
    const overlaySource = map.getSource("nli-investigation-alarm-count");
    const overlayFc = overlaySource.setData.mock.calls.at(-1)[0];
    expect(overlayFc.features).toHaveLength(2);
    expect(overlayFc.features[0].properties).toEqual(
      expect.objectContaining({ city: "שדרות", count: 1, flash: true }),
    );
    const alarmMovedToTop = map.moveLayer.mock.calls.some(
      (call) => call[0] === alarmId && call.length === 1,
    );
    expect(alarmMovedToTop).toBe(false);
    const overlayMovedToTop = map.moveLayer.mock.calls.some(
      (call) =>
        (call[0] === overlayCircleId || call[0] === "nli-investigation-alarm-count") && call.length === 1,
    );
    expect(overlayMovedToTop).toBe(false);
    const lineOverlayRaised = map.moveLayer.mock.calls.some((call) =>
      String(call[0]).startsWith("nli-investigation-line-"),
    );
    expect(lineOverlayRaised).toBe(true);
    const overlayCircle = map.addLayer.mock.calls.find((call) => call[0]?.id === overlayCircleId);
    expect(overlayCircle).toBeDefined();
    expect(overlayCircle[0].type).toBe("circle");
    expect(JSON.stringify(overlayCircle[0])).not.toMatch(/feature-state/);
    const countLayer = map.addLayer.mock.calls.find((call) => call[0]?.id === "nli-investigation-alarm-count");
    expect(countLayer).toBeDefined();
    expect(countLayer[0].type).toBe("symbol");
    expect(JSON.stringify(countLayer[0].layout)).not.toMatch(/feature-state/);
    expect(JSON.stringify(countLayer[0].filter)).not.toMatch(/feature-state/);
    expect(JSON.stringify(countLayer[0])).toMatch(/15/);
    expect(JSON.stringify(countLayer[0].paint?.["text-color"] || countLayer[0])).toMatch(/#ffffff|#fff/i);
    const overlayCircleIndex = map.addLayer.mock.calls.findIndex(
      (call) => call[0]?.id === overlayCircleId,
    );
    const countIndex = map.addLayer.mock.calls.findIndex(
      (call) => call[0]?.id === "nli-investigation-alarm-count",
    );
    expect(overlayCircleIndex).toBeGreaterThanOrEqual(0);
    expect(countIndex).toBeGreaterThan(overlayCircleIndex);
    disposeInvestigationTimelineForMap(map);
  });

  it("restores alarm circle paints on stop", async () => {
    const map = makeMap();
    const alarmId = "nli__alarms__circle__0";
    const groups = [{ id: "nli", layers: [{ id: "alarms", enabled: true }] }];
    const deps = {
      featuresById: {
        [INVESTIGATION_ALARMS_FULL_ID]: [{ properties: { alarm_minutes: [389] } }],
      },
      getLayerDataUrl: () => null,
      now: () => 0,
    };
    await syncInvestigationTimelineToMap(
      map,
      playClock(
        [INVESTIGATION_ALARMS_FULL_ID],
        collectPlaybackTimelineBeats(false, false, true, [], [], deps.featuresById[INVESTIGATION_ALARMS_FULL_ID]),
      ),
      groups,
      deps,
    );
    await syncInvestigationTimelineToMap(
      map,
      idleNliClock(),
      [{ id: "nli", layers: [{ id: "alarms", enabled: false }] }],
      deps,
    );
    const restored = map.setPaintProperty.mock.calls.filter(
      (call) => call[0] === alarmId && call[1] === "circle-radius" && call[2] === 4,
    );
    expect(restored.length).toBeGreaterThan(0);
    expect(map.removeLayer).toHaveBeenCalledWith("nli-investigation-alarm-circles");
    expect(map.removeLayer).toHaveBeenCalledWith("nli-investigation-alarm-count");
    disposeInvestigationTimelineForMap(map);
  });

  it("count layer layout and filter use GeoJSON properties not feature-state", async () => {
    const map = makeMap();
    const alarmFeatures = [
      {
        id: "נתיב העשרה",
        properties: {
          city: "נתיב העשרה",
          alarm_minutes: Array.from({ length: 20 }, (_, i) => 389 + i),
        },
        geometry: { type: "Point", coordinates: [34.54, 31.37] },
      },
      {
        id: "שדרות",
        properties: { city: "שדרות", alarm_minutes: [389] },
        geometry: { type: "Point", coordinates: [34.59, 31.52] },
      },
    ];
    await syncInvestigationTimelineToMap(
      map,
      playClock(
        [INVESTIGATION_ALARMS_FULL_ID],
        collectPlaybackTimelineBeats(false, false, true, [], [], alarmFeatures),
      ),
      [{ id: "nli", layers: [{ id: "alarms", enabled: true }] }],
      {
        featuresById: {
          [INVESTIGATION_ALARMS_FULL_ID]: alarmFeatures,
        },
        now: () => 0,
      },
    );
    const overlayCircle = map.addLayer.mock.calls.find(
      (call) => call[0]?.id === "nli-investigation-alarm-circles",
    );
    const countLayer = map.addLayer.mock.calls.find((call) => call[0]?.id === "nli-investigation-alarm-count");
    expect(overlayCircle).toBeDefined();
    expect(overlayCircle[0].type).toBe("circle");
    expect(JSON.stringify(overlayCircle[0])).not.toMatch(/feature-state/);
    expect(countLayer).toBeDefined();
    expect(JSON.stringify(countLayer[0].layout)).not.toMatch(/feature-state/);
    expect(JSON.stringify(countLayer[0].filter)).not.toMatch(/feature-state/);
    expect(JSON.stringify(countLayer[0].layout["text-field"])).toMatch(/"get"/);
    expect(JSON.stringify(countLayer[0].filter)).toMatch(/15/);
    expect(JSON.stringify(countLayer[0].paint?.["text-color"])).toMatch(/#ffffff|#fff/i);
    const overlayMovedToTop = map.moveLayer.mock.calls.some(
      (call) =>
        (call[0] === "nli-investigation-alarm-circles" || call[0] === "nli-investigation-alarm-count") &&
        call.length === 1,
    );
    expect(overlayMovedToTop).toBe(false);
    const sourceId = countLayer[0].source;
    expect(overlayCircle[0].source).toBe(sourceId);
    expect(sourceId).not.toBe("nli__alarms");
    const setData = map.getSource(sourceId)?.setData;
    expect(setData).toHaveBeenCalled();
    const fc = setData.mock.calls.at(-1)[0];
    expect(fc.features).toHaveLength(2);
    expect(fc.features.every((f) => typeof f.properties.count === "number")).toBe(true);
    expect(fc.features.every((f) => typeof f.properties.flash === "boolean")).toBe(true);
    disposeInvestigationTimelineForMap(map);
  });

  it("caption lists flashing cities not amounts", async () => {
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
    await syncInvestigationTimelineToMap(
      map,
      playClock(
        [INVESTIGATION_POLYGONS_FULL_ID, INVESTIGATION_ALARMS_FULL_ID],
        POLYGON_BEATS,
      ),
      [
        {
          id: "nli",
          layers: [
            { id: "investigation_polygons", enabled: true },
            { id: "alarms", enabled: true },
          ],
        },
      ],
      {
        featuresById: {
          [INVESTIGATION_POLYGONS_FULL_ID]: INVESTIGATION_FEATURES,
          [INVESTIGATION_ALARMS_FULL_ID]: [
            { id: "שדרות", properties: { city: "שדרות", alarm_minutes: [389], alarm_count_total: 1 } },
            { id: "נתיבות", properties: { city: "נתיבות", alarm_minutes: [395], alarm_count_total: 1 } },
            { id: "עוטף", properties: { city: "עוטף", alarm_minutes: [500], alarm_count_total: 1 } },
          ],
        },
        now: () => 0,
      },
    );
    expect(captionEl).toBeTruthy();
    expect(captionEl.hidden).toBe(false);
    expect(captionEl.innerHTML).toMatch(/שדרות/);
    expect(captionEl.innerHTML).toMatch(/נתיבות/);
    expect(captionEl.innerHTML).not.toMatch(/אזעקות \d/);
    expect(captionEl.innerHTML).not.toMatch(/עוטף/);
    disposeInvestigationTimelineForMap(map);
  });

  it("caption caps twelve cities then ועוד remaining cities", async () => {
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
    const cities = Array.from({ length: 15 }, (_, i) => {
      const city = `עיר-${String(i).padStart(2, "0")}`;
      return { id: city, properties: { city, alarm_minutes: [385], alarm_count_total: 1 } };
    });
    await syncInvestigationTimelineToMap(
      map,
      playClock(
        [INVESTIGATION_ALARMS_FULL_ID],
        collectPlaybackTimelineBeats(false, false, true, [], [], cities),
      ),
      [{ id: "nli", layers: [{ id: "alarms", enabled: true }] }],
      {
        featuresById: { [INVESTIGATION_ALARMS_FULL_ID]: cities },
        now: () => 0,
      },
    );
    expect(captionEl.innerHTML).toMatch(/ועוד 3/);
    expect(captionEl.innerHTML).not.toMatch(/אזעקות \d/);
    disposeInvestigationTimelineForMap(map);
  });

  it("idle with alarms enabled paints full totals without flash or polygon restack", async () => {
    const map = makeMap();
    const raf = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", raf);
    await syncInvestigationTimelineToMap(
      map,
      idleNliClock(),
      [{ id: "nli", layers: [{ id: "alarms", enabled: true }] }],
      {
        featuresById: {
          [INVESTIGATION_ALARMS_FULL_ID]: [
            {
              id: "שדרות",
              properties: { city: "שדרות", alarm_minutes: [389, 400], alarm_count_total: 2 },
            },
          ],
        },
        getLayerDataUrl: () => null,
        now: () => 0,
      },
    );
    expect(raf).not.toHaveBeenCalled();
    expect(map.setFeatureState).not.toHaveBeenCalled();
    const overlayFc = map.getSource("nli-investigation-alarm-count").setData.mock.calls.at(-1)[0];
    expect(overlayFc.features[0].properties).toEqual(
      expect.objectContaining({ city: "שדרות", count: 2, flash: false }),
    );
    const expected = alarmCirclePaint(0, false);
    const color = map.setPaintProperty.mock.calls.find(
      (call) => call[0] === "nli-investigation-alarm-circles" && call[1] === "circle-color",
    );
    expect(color?.[2]).toEqual(expected.color);
    expect(JSON.stringify(color?.[2])).toMatch(/"get","count"/);
    expect(JSON.stringify(color?.[2])).not.toMatch(/feature-state/);
    expect(JSON.stringify(color?.[2])).not.toMatch(/fde68a/i);
    const polygonRestack = map.moveLayer.mock.calls.filter((call) =>
      String(call[0]).includes("investigation_polygons"),
    );
    expect(polygonRestack).toHaveLength(0);
    disposeInvestigationTimelineForMap(map);
  });

  it("hold clock sets full totals and no flash", async () => {
    const map = makeMap();
    let now = 0;
    let rafCb = null;
    vi.stubGlobal("requestAnimationFrame", (cb) => {
      rafCb = cb;
      return 1;
    });
    const alarmFeatures = [
      {
        id: "שדרות",
        properties: { city: "שדרות", alarm_minutes: [385, 410], alarm_count_total: 2 },
      },
    ];
    await syncInvestigationTimelineToMap(
      map,
      playClock(
        [INVESTIGATION_ALARMS_FULL_ID],
        collectPlaybackTimelineBeats(false, false, true, [], [], alarmFeatures),
      ),
      [{ id: "nli", layers: [{ id: "alarms", enabled: true }] }],
      {
        featuresById: {
          [INVESTIGATION_ALARMS_FULL_ID]: alarmFeatures,
        },
        now: () => now,
      },
    );
    const overlaySource = map.getSource("nli-investigation-alarm-count");
    const firstFc = overlaySource.setData.mock.calls.at(-1)[0];
    expect(firstFc.features[0].properties).toEqual(
      expect.objectContaining({ city: "שדרות", count: 1, flash: true }),
    );
    now = TIMELINE_BEAT_MS * 2;
    rafCb();
    const lastFc = overlaySource.setData.mock.calls.at(-1)[0];
    expect(lastFc.features[0].properties).toEqual(
      expect.objectContaining({ city: "שדרות", count: 2, flash: false }),
    );
    disposeInvestigationTimelineForMap(map);
  });

  it("unmounts idle alarm overlays when visibilityLayerGroups has nli off", async () => {
    const map = makeMap();
    const liveOn = [{ id: "nli", layers: [{ id: "alarms", enabled: true }] }];
    const slideshowOff = [{ id: "nli", layers: [{ id: "alarms", enabled: false }] }];
    const deps = {
      featuresById: {
        [INVESTIGATION_ALARMS_FULL_ID]: [
          {
            id: "שדרות",
            properties: { city: "שדרות", alarm_minutes: [389, 400], alarm_count_total: 2 },
          },
        ],
      },
      getLayerDataUrl: () => null,
      now: () => 0,
    };
    await syncInvestigationTimelineToMap(map, idleNliClock(), liveOn, deps);
    expect(map.getLayer("nli-investigation-alarm-circles")).toBeTruthy();
    expect(map.getSource("nli-investigation-alarm-count")).toBeTruthy();
    await syncInvestigationTimelineToMap(map, idleNliClock(), liveOn, {
      ...deps,
      visibilityLayerGroups: slideshowOff,
    });
    expect(map.getLayer("nli-investigation-alarm-circles")).toBeFalsy();
    expect(map.getSource("nli-investigation-alarm-count")).toBeFalsy();
    disposeInvestigationTimelineForMap(map);
  });
});
