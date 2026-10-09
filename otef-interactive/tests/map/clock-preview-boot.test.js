// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rig = vi.hoisted(() => ({
  map: null,
  registry: {
    init: vi.fn(),
    getGroups: vi.fn(),
    getLayerConfig: vi.fn(),
    getLayerDataUrl: vi.fn(),
    getLayerPMTilesUrl: vi.fn(),
    getPackStyleJsonForLayer: vi.fn(),
  },
  irToLayers: vi.fn(),
}));

vi.mock("../../frontend/src/shared/layer-registry.js", () => ({ default: rig.registry }));
vi.mock("../../frontend/src/shared/maplibre-style-bridge.js", () => ({
  irToMapLibreLayers: rig.irToLayers,
}));
vi.mock("../../frontend/src/map/maplibre-map.js", () => ({
  createGISMap: vi.fn(() => rig.map),
  setGISBasemap: vi.fn(() => true),
}));

import { bootClockPreview } from "../../frontend/src/map/clock-preview.js";
import { getNliNarrative } from "../../frontend/src/shared/nli-narratives.js";
import { NLI_NOVA_STORY } from "../../frontend/src/shared/nli-nova-story.js";
import { getLayerLifecycleRuntime, peekLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";
import { applySettlementOrientationPaint } from "../../frontend/src/shared/nli-settlement-orientation.js";
import { NLI_VISUAL_TOKENS } from "../../frontend/src/shared/nli-investigation-theme.js";
import { getInvestigationTimelineRenderSnapshot } from "../../frontend/src/shared/maplibre-investigation-timeline.js";
import { HOME_CUE, TIMELINE } from "../../frontend/src/remote/nli-staff-script.js";
import { createGISMap, setGISBasemap } from "../../frontend/src/map/maplibre-map.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { createRoadSign } from "../../frontend/src/shared/road-sign-settings.js";

const PREVIEW_CUE_LAYER_IDS = [...new Set([
  ...HOME_CUE.layers,
  ...TIMELINE.steps.at(-1).cue.layers,
])];
const PREVIEW_GROUPS = new Map();
for (const fullId of PREVIEW_CUE_LAYER_IDS) {
  const [groupId, id] = fullId.split(".");
  if (!PREVIEW_GROUPS.has(groupId)) PREVIEW_GROUPS.set(groupId, []);
  PREVIEW_GROUPS.get(groupId).push({ id, enabled: true });
}
const GROUPS = [
  ...[...PREVIEW_GROUPS].map(([id, layers]) => ({ id, layers })),
  { id: "projector_base", layers: [{ id: "unused", enabled: true }] },
];

function createMapMock() {
  const sources = new Map();
  const layers = new Map();
  const listeners = new Map();
  const mapContainer = document.getElementById("map");
  const map = {
    on: vi.fn((name, callback) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(callback);
    }),
    off: vi.fn((name, callback) => listeners.get(name)?.delete(callback)),
    once: vi.fn((name, callback) => {
      const wrapped = (...args) => {
        map.off(name, wrapped);
        callback(...args);
      };
      map.on(name, wrapped);
    }),
    emit(name, value) {
      for (const callback of [...(listeners.get(name) || [])]) callback(value);
    },
    listenerCount(name) { return listeners.get(name)?.size || 0; },
    listenersFor(name) { return [...(listeners.get(name) || [])]; },
    addSource: vi.fn((id, spec) => sources.set(id, { ...spec, setData: vi.fn() })),
    getSource: vi.fn((id) => sources.get(id)),
    removeSource: vi.fn((id) => sources.delete(id)),
    addLayer: vi.fn((layer) => layers.set(layer.id, { ...layer, layout: { ...(layer.layout || {}) } })),
    getLayer: vi.fn((id) => layers.get(id)),
    removeLayer: vi.fn((id) => layers.delete(id)),
    getStyle: vi.fn(() => ({ layers: [...layers.values()] })),
    setLayoutProperty: vi.fn((id, key, value) => {
      const layer = layers.get(id);
      if (layer) layer.layout[key] = value;
    }),
    getLayoutProperty: vi.fn((id, key) => layers.get(id)?.layout?.[key]),
    setPaintProperty: vi.fn(),
    getPaintProperty: vi.fn(() => undefined),
    setFilter: vi.fn(),
    moveLayer: vi.fn(),
    setFeatureState: vi.fn(),
    getContainer: vi.fn(() => mapContainer),
    hasImage: vi.fn(() => false),
    addImage: vi.fn(),
    removeImage: vi.fn(),
    triggerRepaint: vi.fn(),
    stop: vi.fn(),
    flyTo: vi.fn(),
    jumpTo: vi.fn(),
    easeTo: vi.fn(),
    fitBounds: vi.fn(),
    setStyle: vi.fn(() => {
      sources.clear();
      layers.clear();
      queueMicrotask(() => map.emit("style.load"));
    }),
    remove: vi.fn(() => {
      map.emit("remove");
      sources.clear();
      layers.clear();
      listeners.clear();
    }),
    _sources: sources,
    _layers: layers,
  };
  return map;
}

function postState(parent, state, { source = parent, origin = window.location.origin } = {}) {
  const event = new MessageEvent("message", { origin, data: state });
  Object.defineProperty(event, "source", { value: source });
  window.dispatchEvent(event);
}

function messages(parent, type) {
  return parent.postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === type);
}

async function waitForListener(map, name = "idle") {
  await vi.waitFor(() => expect(map.listenerCount(name)).toBeGreaterThan(0));
}

function frameState(requestId, sceneId, layout = {}) {
  return {
    type: "otef_clock_preview_state",
    sessionId: "session-1",
    requestId,
    surface: "gis",
    sceneId,
    output: null,
    element: sceneId === "home" || sceneId === "timeline" ? "gis.start" : `gis.${sceneId}`,
    clockLayout: {
      leftPct: 12,
      topPct: 22,
      widthPct: 50,
      heightPct: 10,
      fontPx: 24,
      rotateDeg: 0,
      ...layout,
    },
    legendLayout: null,
    pageIndex: null,
  };
}

describe("bootClockPreview frame behavior", () => {
  let parent;
  let dispose;
  let priorFetch;

  beforeEach(() => {
    document.body.innerHTML = '<div id="map"></div><div id="mapLegend"></div>';
    parent = { postMessage: vi.fn() };
    Object.defineProperty(window, "parent", { configurable: true, value: parent });
    window.history.replaceState({}, "", "/otef-interactive/index.html?clockPreview=1&previewSession=session-1");
    rig.map = createMapMock();
    rig.registry.init.mockReset().mockResolvedValue(undefined);
    rig.registry.getGroups.mockReset().mockReturnValue(structuredClone(GROUPS));
    rig.registry.getLayerConfig.mockReset().mockReturnValue({ format: "geojson", geometryType: "line" });
    rig.registry.getLayerDataUrl.mockReset().mockReturnValue("/fixture.geojson");
    rig.registry.getLayerPMTilesUrl.mockReset().mockReturnValue(null);
    rig.registry.getPackStyleJsonForLayer.mockReset().mockReturnValue(null);
    rig.irToLayers.mockReset().mockImplementation((fullId, sourceId) => [{
      id: `${fullId}-line`,
      type: "line",
      source: sourceId,
      paint: { "line-color": "#c00", "line-opacity": 1 },
    }]);
    setGISBasemap.mockClear();
    setGISBasemap.mockImplementation(() => true);
    priorFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ type: "FeatureCollection", features: [] }),
    }));
  });

  afterEach(async () => {
    if (dispose) await dispose();
    dispose = null;
    globalThis.fetch = priorFetch;
    delete window.matchMedia;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function boot() {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ viewport: { bbox: [34, 31, 35, 32], zoom: 10 }, basemap: "osm" }),
    }));
    dispose = await bootClockPreview({
      window,
      document,
      fetchImpl,
    });
    rig.map.emit("load");
    await vi.waitFor(() => expect(messages(parent, "otef_clock_preview_ready")).toHaveLength(1));
    return fetchImpl;
  }

  async function render(requestId, sceneId, layout) {
    postState(parent, frameState(requestId, sceneId, layout));
    await waitForListener(rig.map);
    rig.map.emit("idle");
    await vi.waitFor(() => expect(messages(parent, "otef_clock_preview_rendered").some((message) => message.requestId === requestId)).toBe(true));
  }

  it("Road 232 preview draws the GIS Home scene and reports an unwarped placement receipt", async () => {
    window.history.replaceState({}, "", "/otef-interactive/index.html?roadSignsPreview=1&previewSession=session-1");
    const calls = [];
    const context = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]) });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(524);
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.stubGlobal("proj4", vi.fn(() => [35, 31]));
    const container = document.getElementById("map");
    Object.defineProperty(container, "clientWidth", { value: 1920 });
    Object.defineProperty(container, "clientHeight", { value: 1080 });
    rig.map.project = vi.fn(([lng, lat]) => ({ x: 960 + (lng - 35) * 512 * 2 ** 10 / 360,
      y: 540 - (Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) - Math.log(Math.tan(Math.PI / 4 + 31 * Math.PI / 360))) * 512 * 2 ** 10 / (2 * Math.PI) }));
    dispose = await bootClockPreview({ window, document, fetchImpl: async () => ({ ok: true, json: async () => ({ basemap: "dark", viewport: { zoom: 17 },
      bounds_polygon: [{ x: 100, y: 200 }, { x: 300, y: 200 }, { x: 300, y: 400 }, { x: 100, y: 400 }] }) }) });
    expect(createGISMap.mock.calls.at(-1)[1]).toMatchObject({ center: [35, 31], zoom: 10 });
    rig.map.emit("load");
    await vi.waitFor(() => expect(messages(parent, "otef_road_sign_preview_ready")).toHaveLength(1));
    const settings = { version: 1, outputs: { left: [], right: [], gis: [createRoadSign({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", x: 800, y: 400 })] } };
    const state = { type: "otef_road_sign_preview_state", sessionId: "session-1", requestId: 1,
      output: "gis", sceneId: "home", settings, config: structuredClone(DEFAULT_PROJECTION_CONFIG), calibrationRevision: 7 };
    postState(parent, state, { origin: "http://wrong.test" });
    expect(calls).not.toContainEqual(["translate", 800, 400]);
    postState(parent, state);
    await waitForListener(rig.map);
    rig.map.emit("idle");
    await vi.waitFor(() => expect(messages(parent, "otef_road_sign_preview_rendered")).toHaveLength(1));
    const receipt = messages(parent, "otef_road_sign_preview_rendered")[0];
    expect(receipt).toMatchObject({ output: "gis", sceneId: "home", requestId: 1, calibrationRevision: 7,
      mesh: { triangles: [0, 1, 2, 0, 2, 3], vertices: [
        { u: 0, v: 0, x: 0, y: 0 }, { u: 1, v: 0, x: 1, y: 0 },
        { u: 1, v: 1, x: 1, y: 1 }, { u: 0, v: 1, x: 0, y: 1 },
      ] } });
    expect(rig.map.getLayer("nli.ציר_232-line")).toBeDefined();
    const translation = calls.find(call => call[0] === "translate");
    expect(translation[1]).toBeCloseTo(800);
    expect(translation[2]).toBeCloseTo(400);
    expect(rig.map.jumpTo).toHaveBeenCalledWith({ center: [35, 31], zoom: 10 });
    postState(parent, { ...state, requestId: 2, sceneId: "nova" });
    await vi.waitFor(() => expect(messages(parent, "otef_road_sign_preview_error")).toHaveLength(1));
    expect(messages(parent, "otef_road_sign_preview_rendered")).toHaveLength(1);
  });

  it("boots with the persisted ITM viewport converted to a geographic map center", async () => {
    const proj4 = vi.fn(() => [34.5, 31.4]); vi.stubGlobal("proj4", proj4);
    dispose = await bootClockPreview({ window, document, fetchImpl: vi.fn(async () => ({ ok: true,
      json: async () => ({ viewport: { bbox: [78890.64352836908, 557641.692567489, 204756.11077856852, 625046.277711076], zoom: 10 } }),
    })) });
    expect(proj4).toHaveBeenCalledWith("EPSG:2039", "EPSG:4326", [141823.37715346878, 591343.9851392824]);
    const center = createGISMap.mock.calls.at(-1)[1].center;
    expect(center[0]).toBeGreaterThan(34); expect(center[0]).toBeLessThan(36);
    expect(center[1]).toBeGreaterThan(30); expect(center[1]).toBeLessThan(33);
  });

  it("renders the Home clock locally and preserves common layer ownership through basemap swaps", async () => {
    await boot();
    const layout = { leftPct: 7, topPct: 19, widthPct: 61, heightPct: 12, fontPx: 27 };
    await render(1, "home", layout);

    const caption = document.querySelector("#nliGisClockHost .nli-investigation-timeline-caption");
    expect(caption.hidden).toBe(false);
    expect(caption.textContent).toContain("06:29");
    expect(document.getElementById("nliGisClockHost").style.left).toBe("7%");
    expect(document.getElementById("nliGisClockHost").style.top).toBe("19%");
    expect(HOME_CUE.layers).not.toContain("nli.investigation_polygons");
    expect(getInvestigationTimelineRenderSnapshot(rig.map)).toMatchObject({ visible: true, model: { clockLabel: "06:29" } });
    expect(rig.map.getSource("projector_base.ישובים")).toBeTruthy();
    expect(rig.map.getLayer("projector_base.ישובים-line")).toBeTruthy();
    expect(rig.map.getSource("projector_base.unused")).toBeFalsy();
    expect(rig.map.getLayer("projector_base.unused-line")).toBeFalsy();

    await render(2, "segev");
    await vi.waitFor(() => expect(rig.map.getSource("projector_base.ישובים")).toBeTruthy());
    expect(rig.map.getLayer("projector_base.ישובים-line")).toBeTruthy();
    expect(caption.hidden).toBe(false);
    expect(caption.textContent).toContain("06:41");
    expect(rig.map.getSource("projector_base.ישובים")).toBeTruthy();
    expect(rig.map.getSource("projector_base.unused")).toBeFalsy();

    await render(3, "home");
    await vi.waitFor(() => expect(rig.map.getSource("projector_base.ישובים")).toBeTruthy());
    expect(rig.map.getLayer("projector_base.ישובים-line")).toBeTruthy();
    expect(getInvestigationTimelineRenderSnapshot(rig.map)).toMatchObject({ visible: true, model: { clockLabel: "06:29" } });

    const expected = [
      [4, "timeline", "06:29"],
      [5, "nova", "08:03"],
      [6, "sderot", "06:29"],
      [7, "hostages", "06:29"],
      [8, "hostages_all", "06:29"],
    ];
    for (const [requestId, sceneId, clockLabel] of expected) {
      await render(requestId, sceneId);
      expect(caption.hidden).toBe(false);
      expect(caption.textContent).toContain(clockLabel);
      expect(getInvestigationTimelineRenderSnapshot(rig.map)).toMatchObject({
        visible: true,
        model: { clockLabel },
      });
    }
  });

  it("renders exact Home and Timeline overview clocks without writes or cue mutations", async () => {
    const fetchImpl = await boot();
    const caption = document.querySelector("#nliGisClockHost .nli-investigation-timeline-caption");
    const beforeHome = structuredClone(HOME_CUE);
    const beforeTimeline = structuredClone(TIMELINE.steps.at(-1).cue);
    await render(1, "home");
    expect(caption.hidden).toBe(false);
    expect(caption.textContent).toContain("06:29");
    await render(2, "timeline");
    expect(caption.hidden).toBe(false);
    expect(caption.textContent).toContain("06:29");
    expect(HOME_CUE).toEqual(beforeHome);
    expect(TIMELINE.steps.at(-1).cue).toEqual(beforeTimeline);
    expect(rig.map.setStyle).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(messages(parent, "otef_clock_preview_rendered").map(({ sceneId }) => sceneId)).toEqual([
      "home", "timeline",
    ]);
    expect(parent.postMessage.mock.calls.map(([message]) => message.type)).toEqual([
      "otef_clock_preview_ready", "otef_clock_preview_rendered", "otef_clock_preview_rendered",
    ]);
  });

  it("measures rendered clock clipping in the child and reports pixel-correct rotated out-of-view without writes", async () => {
    const fetchImpl = await boot();
    const host = document.getElementById("nliGisClockHost");
    const caption = host.querySelector(".nli-investigation-timeline-caption");
    Object.defineProperty(host, "clientWidth", { configurable: true, value: 38 });
    Object.defineProperty(host, "clientHeight", { configurable: true, value: 21 });
    Object.defineProperty(caption, "scrollWidth", { configurable: true, value: 140 });
    Object.defineProperty(caption, "scrollHeight", { configurable: true, value: 80 });
    await render(1, "home", { leftPct: 0, topPct: 0, widthPct: 2, heightPct: 2, fontPx: 64, rotateDeg: 45 });
    expect(messages(parent, "otef_clock_preview_rendered").at(-1).warnings).toEqual({ clipped: true, outOfView: true, mapping: "complete" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid senders and requests, ignores duplicate IDs, and renders only the latest draw", async () => {
    await boot();
    postState(parent, frameState(1, "home"), { source: window, origin: "https://wrong.example" });
    postState(parent, frameState(1, "home"), { source: window });
    postState(parent, { ...frameState(1, "home"), sessionId: "old-session" });
    postState(parent, { ...frameState(1, "home"), clockLayout: { ...frameState(1, "home").clockLayout, leftPct: NaN } });
    expect(messages(parent, "otef_clock_preview_rendered")).toHaveLength(0);

    postState(parent, frameState(1, "home"));
    await waitForListener(rig.map);
    postState(parent, frameState(2, "segev"));
    await waitForListener(rig.map);
    postState(parent, frameState(3, "nova"));
    await waitForListener(rig.map);
    rig.map.emit("idle");
    await vi.waitFor(() => expect(messages(parent, "otef_clock_preview_rendered").some((message) => message.requestId === 3)).toBe(true));
    postState(parent, frameState(2, "home"));
    await Promise.resolve();
    expect(messages(parent, "otef_clock_preview_rendered").map((message) => message.requestId)).toEqual([3]);

    postState(parent, frameState(4, "home"));
    await waitForListener(rig.map);
    await dispose();
    dispose = null;
    expect(rig.map.listenerCount("idle")).toBe(0);
    expect(rig.map.listenerCount("load")).toBe(0);
    expect(rig.map.listenerCount("style.load")).toBe(0);
    expect(rig.map.remove).toHaveBeenCalledTimes(1);
    expect(messages(parent, "otef_clock_preview_rendered").map((message) => message.requestId)).toEqual([3]);
  });

  it("reports a draw timeout instead of inventing a rendered acknowledgement and removes the idle listener", async () => {
    vi.useFakeTimers();
    await boot();
    postState(parent, frameState(1, "home"));
    await Promise.resolve();
    await Promise.resolve();
    expect(rig.map.listenerCount("idle")).toBe(1);

    await vi.advanceTimersByTimeAsync(6000);
    expect(messages(parent, "otef_clock_preview_rendered")).toHaveLength(0);
    expect(messages(parent, "otef_clock_preview_error")).toHaveLength(1);
    expect(messages(parent, "otef_clock_preview_error")[0].requestId).toBe(1);
    expect(rig.map.listenerCount("idle")).toBe(0);
  });

  it("changes a narrative basemap without clearing overlays or registering another style.load listener", async () => {
    await boot();
    await render(1, "home");
    const initialListeners = rig.map.listenersFor("style.load");
    expect(initialListeners.length).toBeGreaterThan(0);
    expect(rig.map.getSource("projector_base.ישובים")).toBeTruthy();
    expect(rig.map.getLayer("projector_base.ישובים-line")).toBeTruthy();

    await render(2, "segev");

    expect(setGISBasemap).toHaveBeenCalledWith(
      rig.map,
      "satellite_bw",
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );
    expect(rig.map.listenersFor("style.load")).toEqual(initialListeners);
    expect(rig.map.setStyle).not.toHaveBeenCalled();
    expect(rig.map.getSource("projector_base.ישובים")).toBeTruthy();
    expect(rig.map.getLayer("projector_base.ישובים-line")).toBeTruthy();
  });

  it("keeps failed basemap intent across repeated renders until a different scene requests it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await boot();
    setGISBasemap.mockImplementation((map, id, options = {}) => {
      options.onSettled?.({ status: "failed", basemapId: "osm" });
      return true;
    });
    await render(1, "segev");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("satellite_bw"));
    const callsAfterSyncFailure = setGISBasemap.mock.calls.length;

    setGISBasemap.mockImplementation(() => true);
    await render(2, "segev");
    expect(setGISBasemap.mock.calls.length).toBe(callsAfterSyncFailure);

    await render(3, "home");
    await render(4, "segev");
    expect(setGISBasemap.mock.calls.length).toBe(callsAfterSyncFailure + 2);
    expect(setGISBasemap.mock.calls.at(-1)[1]).toBe("satellite_bw");
    const settle = setGISBasemap.mock.calls.at(-1)[2]?.onSettled;
    expect(settle).toEqual(expect.any(Function));

    settle({ status: "failed", basemapId: "osm" });
    expect(warn).toHaveBeenCalledWith(
      "[gis-basemap] failed to show satellite_bw; retaining osm; reason=unknown",
    );
    await render(5, "segev");
    expect(setGISBasemap.mock.calls.at(-1)[1]).toBe("satellite_bw");
    expect(setGISBasemap.mock.calls.length).toBe(callsAfterSyncFailure + 2);
    warn.mockRestore();
  });

  it("uses one deliberate timeout retry across repeated renders and cancels a pending retry on disposal", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await boot();
    vi.useFakeTimers();
    setGISBasemap.mockImplementation((map, id, options) => {
      options.onSettled({ status: "failed", basemapId: "osm", reason: "source-timeout" });
      return true;
    });
    await render(1, "segev");
    await vi.advanceTimersByTimeAsync(500);
    expect(setGISBasemap).toHaveBeenCalledTimes(2);
    await render(2, "segev");
    await vi.advanceTimersByTimeAsync(2000);
    expect(setGISBasemap).toHaveBeenCalledTimes(2);

    setGISBasemap.mockImplementation(() => true);
    await render(3, "home");
    await render(4, "segev");
    const pending = setGISBasemap.mock.calls.at(-1)[2].onSettled;
    pending({ status: "failed", basemapId: "osm", reason: "source-timeout" });
    const callsBeforeDispose = setGISBasemap.mock.calls.length;
    await dispose();
    dispose = null;
    await vi.advanceTimersByTimeAsync(500);
    expect(setGISBasemap.mock.calls.length).toBe(callsBeforeDispose);
  });

  it("restores the prior basemap when the setter returns false and ignores superseded or disposed settlements", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await boot();
    await render(1, "segev");
    const accepted = setGISBasemap.mock.calls.at(-1)[2]?.onSettled;
    expect(accepted).toEqual(expect.any(Function));
    const callsAfterSegev = setGISBasemap.mock.calls.length;

    setGISBasemap.mockImplementationOnce(() => false);
    await render(2, "home");
    expect(setGISBasemap.mock.calls.at(-1)[1]).toBe("osm");
    expect(setGISBasemap.mock.calls.length).toBe(callsAfterSegev + 1);

    await render(3, "segev");
    expect(setGISBasemap.mock.calls.length).toBe(callsAfterSegev + 1);

    accepted({ status: "failed", basemapId: "osm" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("satellite_bw"));
    await render(4, "segev");
    expect(setGISBasemap.mock.calls.length).toBe(callsAfterSegev + 1);
    const superseded = accepted;

    await render(5, "home");
    expect(setGISBasemap.mock.calls.at(-1)[1]).toBe("osm");
    const callsAfterHome = setGISBasemap.mock.calls.length;

    superseded({ status: "completed", basemapId: "satellite_bw" });
    await render(6, "home");
    expect(setGISBasemap.mock.calls.length).toBe(callsAfterHome);

    await render(7, "segev");
    expect(setGISBasemap.mock.calls.at(-1)[1]).toBe("satellite_bw");
    const pending = setGISBasemap.mock.calls.at(-1)[2].onSettled;
    const callsBeforeDispose = setGISBasemap.mock.calls.length;

    await dispose();
    dispose = null;
    warn.mockClear();
    pending({ status: "failed", basemapId: "osm" });
    expect(setGISBasemap.mock.calls.length).toBe(callsBeforeDispose);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("awaits the supplied frame document font before creating the map", async () => {
    let releaseFonts = () => {};
    const pendingFontLoads = [];
    let fontsReleased = false;
    const fontsLoad = vi.fn(() => {
      if (fontsReleased) return Promise.resolve([]);
      return new Promise((resolve) => pendingFontLoads.push(resolve));
    });
    releaseFonts = () => {
      fontsReleased = true;
      for (const resolve of pendingFontLoads.splice(0)) resolve([]);
    };
    const globalLoad = vi.fn(() => Promise.resolve([]));
    Object.defineProperty(document, "fonts", { configurable: true, value: { load: globalLoad } });
    const frameDocument = {
      getElementById: (id) => document.getElementById(id),
      fonts: { load: fontsLoad },
    };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ viewport: { bbox: [34, 31, 35, 32], zoom: 10 }, basemap: "osm" }),
    }));
    createGISMap.mockClear();

    const bootPromise = bootClockPreview({ window, document: frameDocument, fetchImpl });
    for (let step = 0; step < 20; step += 1) await Promise.resolve();

    expect(fontsLoad).toHaveBeenCalledWith("14px 'Guttman Hatzvi'");
    expect(globalLoad).not.toHaveBeenCalled();
    expect(createGISMap).not.toHaveBeenCalled();

    releaseFonts();
    dispose = await bootPromise;
    expect(createGISMap).toHaveBeenCalledTimes(1);
  });

  it("logs a frame-document font preload rejection and still creates the map", async () => {
    const fontError = new Error("missing face");
    const fontsLoad = vi.fn(() => Promise.reject(fontError));
    const globalLoad = vi.fn(() => Promise.resolve([]));
    Object.defineProperty(document, "fonts", { configurable: true, value: { load: globalLoad } });
    const frameDocument = {
      getElementById: (id) => document.getElementById(id),
      fonts: { load: fontsLoad },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createGISMap.mockClear();

    dispose = await bootClockPreview({
      window,
      document: frameDocument,
      fetchImpl: vi.fn(async () => ({
        ok: true,
        json: async () => ({ viewport: { bbox: [34, 31, 35, 32], zoom: 10 }, basemap: "osm" }),
      })),
    });

    expect(fontsLoad).toHaveBeenCalledWith("14px 'Guttman Hatzvi'");
    expect(globalLoad).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Guttman Hatzvi"), fontError);
    expect(createGISMap).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("attaches settlement orientation before apply, replays it on style reconstruction, and clears it on removal", async () => {
    const paint = new Map();
    const opacityWrites = [];
    const priorAdd = rig.map.addLayer.getMockImplementation();
    const priorRemove = rig.map.removeLayer.getMockImplementation();
    rig.map.addLayer.mockImplementation((layer) => {
      priorAdd(layer);
      paint.set(layer.id, new Map(Object.entries(layer.paint || {})));
    });
    rig.map.removeLayer.mockImplementation((id) => {
      priorRemove(id);
      paint.delete(id);
    });
    rig.map.setPaintProperty.mockImplementation((id, key, value) => {
      if (id === "projector_base__ישובים-fill" && key === "fill-opacity") opacityWrites.push(value);
      if (!paint.has(id)) paint.set(id, new Map());
      paint.get(id).set(key, value);
    });
    rig.map.getPaintProperty.mockImplementation((id, key) => paint.get(id)?.get(key));
    const yishuvId = "projector_base.ישובים";
    const layerId = "projector_base__ישובים-fill";
    rig.irToLayers.mockImplementation((fullId, sourceId) => [{
      id: fullId === yishuvId ? layerId : `${fullId}-line`,
      type: fullId === yishuvId ? "fill" : "line",
      source: sourceId,
      paint: fullId === yishuvId ? { "fill-opacity": 1 } : { "line-opacity": 1 },
    }]);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return false; },
      }),
    });

    dispose = await bootClockPreview({
      window,
      document,
      fetchImpl: vi.fn(async () => ({
        ok: true,
        json: async () => ({ viewport: { bbox: [34, 31, 35, 32], zoom: 10 }, basemap: "osm" }),
      })),
    });
    applySettlementOrientationPaint(rig.map, { phase: "playing" });
    rig.map.emit("load");

    expect(opacityWrites).toContain(NLI_VISUAL_TOKENS.dimOpacity);
    expect(peekLayerLifecycleRuntime(rig.map)?.hasPaintChannel?.(yishuvId, "fill-opacity")).toBe(true);

    applySettlementOrientationPaint(rig.map, { phase: "playing" });
    opacityWrites.length = 0;
    rig.map.emit("style.load");
    expect(opacityWrites).toContain(NLI_VISUAL_TOKENS.dimOpacity);

    await dispose();
    dispose = null;
    opacityWrites.length = 0;
    rig.map.addLayer({ id: layerId, type: "fill", source: yishuvId, paint: { "fill-opacity": 1 } });
    const runtime = getLayerLifecycleRuntime(rig.map);
    runtime.setDesiredIds([yishuvId], { durationMs: 0 });
    runtime.stageMapLayer(yishuvId, { id: layerId, type: "fill", paint: { "fill-opacity": 1 } });
    runtime.commitBatch();
    expect(opacityWrites).not.toContain(NLI_VISUAL_TOKENS.dimOpacity);
    expect(rig.map.getPaintProperty(layerId, "fill-opacity")).toBe(1);
  });

  const STORY_IDS = NLI_NOVA_STORY.beats.flatMap((beat) => beat.polygonObjectIds);

  function storyFeatures() {
    return STORY_IDS.map((objectId) => ({
      type: "Feature",
      properties: { OBJECTID: objectId, Name: `Polygon ${objectId}` },
      geometry: {
        type: "Polygon",
        coordinates: [[[34.47, 31.39], [34.471, 31.39], [34.471, 31.391], [34.47, 31.39]]],
      },
    }));
  }

  function savedExplainerLayout() {
    const close = {};
    const wide = {};
    for (const id of STORY_IDS) {
      close[String(id)] = { leftPct: 10, topPct: 20 };
      wide[String(id)] = { leftPct: 60, topPct: 30 };
    }
    return { close, wide };
  }

  function installCardMetrics(container) {
    Object.defineProperty(container, "clientWidth", { configurable: true, value: 1000 });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 500 });
    const prototypes = [HTMLElement.prototype, Element.prototype];
    const saved = [];
    for (const prototype of prototypes) {
      for (const key of ["offsetLeft", "offsetTop", "offsetWidth", "offsetHeight"]) {
        saved.push([prototype, key, Object.getOwnPropertyDescriptor(prototype, key)]);
      }
    }
    const pixels = (element, prop) => Number.parseFloat(element.style?.[prop]) || 0;
    const card = (element) => element.classList?.contains("nli-nova-explainer-card");
    Object.defineProperty(HTMLElement.prototype, "offsetLeft", {
      configurable: true,
      get() { return card(this) ? pixels(this, "left") : 0; },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetTop", {
      configurable: true,
      get() { return card(this) ? pixels(this, "top") : 0; },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() { return card(this) ? 80 : 0; },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() { return card(this) ? 40 : 0; },
    });
    return () => {
      for (const [prototype, key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(prototype, key, descriptor);
        else delete prototype[key];
      }
    };
  }

  async function renderExplainer(requestId, camera, layout, language) {
    postState(parent, {
      ...frameState(requestId, "nova"),
      element: "novaExplainers",
      novaExplainerCamera: camera,
      novaExplainerLayout: layout,
      ...(language ? { language } : {}),
    });
    await waitForListener(rig.map);
    rig.map.emit("idle");
    await vi.waitFor(() => expect(
      messages(parent, "otef_clock_preview_rendered").some((message) => message.requestId === requestId),
    ).toBe(true));
    return messages(parent, "otef_clock_preview_rendered").find((message) => message.requestId === requestId);
  }

  it("rejects explainer requests with the wrong scene, camera, or layout", async () => {
    await boot();
    const layout = { close: {}, wide: {} };
    postState(parent, { ...frameState(1, "segev"), element: "novaExplainers", novaExplainerCamera: "close", novaExplainerLayout: layout });
    postState(parent, { ...frameState(2, "nova"), element: "novaExplainers", novaExplainerCamera: "zoom", novaExplainerLayout: layout });
    postState(parent, { ...frameState(3, "nova"), element: "novaExplainers", novaExplainerCamera: "close", novaExplainerLayout: null });
    postState(parent, { ...frameState(4, "nova"), element: "novaExplainers", novaExplainerCamera: "wide", novaExplainerLayout: [] });
    await vi.waitFor(() => expect(messages(parent, "otef_clock_preview_error")).toHaveLength(4));
    expect(messages(parent, "otef_clock_preview_error").map((message) => message.requestId)).toEqual([1, 2, 3, 4]);
    expect(messages(parent, "otef_clock_preview_rendered")).toHaveLength(0);
  });

  it("renders both explainer cameras from an ended Nova clock with measured card geometry and no exhibit writes", async () => {
    const fetchImpl = await boot();
    const storageWrites = vi.spyOn(Storage.prototype, "setItem");
    rig.registry.getLayerDataUrl.mockImplementation((fullId) => (
      fullId === "nli.investigation_polygons" ? "/nova-polygons.geojson" : "/fixture.geojson"
    ));
    rig.map.project = vi.fn(() => ({ x: -40, y: -40 }));
    globalThis.fetch = vi.fn(async (url) => ({
      ok: true,
      json: async () => (
        String(url).includes("nova-polygons")
          ? { type: "FeatureCollection", features: storyFeatures() }
          : { type: "FeatureCollection", features: [] }
      ),
    }));
    const restoreMetrics = installCardMetrics(document.getElementById("map"));
    const layout = savedExplainerLayout();
    const nova = getNliNarrative("nova");

    const close = await renderExplainer(1, "close", layout);
    const wide = await renderExplainer(2, "wide", layout);

    expect(document.querySelectorAll("#nliNovaExplainerHost")).toHaveLength(1);
    expect(close.novaExplainerCamera).toBe("close");
    expect(wide.novaExplainerCamera).toBe("wide");
    expect(close.novaExplainerCards.map((card) => card.objectId)).toEqual(STORY_IDS);
    expect(wide.novaExplainerCards.map((card) => card.objectId)).toEqual(STORY_IDS);
    expect(close.novaExplainerCards).toEqual(STORY_IDS.map((objectId) => ({
      objectId,
      name: `Polygon ${objectId}`,
      box: { leftPct: 10, topPct: 20, widthPct: 8, heightPct: 8 },
    })));
    expect(wide.novaExplainerCards).toEqual(STORY_IDS.map((objectId) => ({
      objectId,
      name: `Polygon ${objectId}`,
      box: { leftPct: 60, topPct: 30, widthPct: 8, heightPct: 8 },
    })));
    const wideCard = document.querySelector('.nli-nova-explainer-card[data-object-id="100"]');
    expect(wideCard.style.left).toBe("600px");
    expect(wideCard.style.top).toBe("150px");
    expect(rig.map.jumpTo).toHaveBeenNthCalledWith(1, expect.objectContaining({
      center: nova.center, zoom: nova.zoom, duration: 0,
    }));
    expect(rig.map.jumpTo).toHaveBeenNthCalledWith(2, expect.objectContaining({
      center: nova.center, zoom: nova.beat4Zoom, duration: 0,
    }));
    expect(rig.map.jumpTo.mock.invocationCallOrder[0]).toBeGreaterThan(rig.map.flyTo.mock.invocationCallOrder[0]);
    expect(rig.map.easeTo).not.toHaveBeenCalled();
    const urls = [...fetchImpl.mock.calls, ...globalThis.fetch.mock.calls].map(([url]) => String(url));
    expect(urls.some((url) => url.includes("/command/") || url.includes("investigation_clock"))).toBe(false);
    expect(parent.postMessage.mock.calls.every(([message]) => String(message.type).startsWith("otef_clock_preview_"))).toBe(true);
    expect(storageWrites).not.toHaveBeenCalled();
    const english = await renderExplainer(3, 'wide', layout, 'en');
    expect(english.language).toBe('en');
    expect(english.novaExplainerCards[0].name).toBe('Fighting — Highway 232');
    expect(rig.map.getLayoutProperty('nli-narrative-focus-label', 'text-font')).toEqual(['Arial']);
    const focusSource = rig.map.getSource('nli-narrative-focus');
    expect((focusSource.setData.mock.calls.at(-1)?.[0] || focusSource.data).features[0].properties.label).toBe('Nova');
    expect(english.novaExplainerCards.every(card => !/[\u0590-\u05ff]/.test(card.name))).toBe(true);
    expect(wideCard.textContent).toBe('Fighting — Nova site');
    expect(wideCard.getAttribute('dir')).toBe('ltr');
    expect(wideCard.style.left).toBe('600px');
    expect(wideCard.style.top).toBe('150px');
    restoreMetrics();
    storageWrites.mockRestore();
  });

  it("returns a null box for each achieved named polygon that has no rendered card", async () => {
    await boot();
    rig.registry.getLayerDataUrl.mockImplementation((fullId) => (
      fullId === "nli.investigation_polygons" ? "/nova-polygons.geojson" : "/fixture.geojson"
    ));
    rig.map.project = vi.fn(() => ({ x: -40, y: -40 }));
    globalThis.fetch = vi.fn(async (url) => ({
      ok: true,
      json: async () => (
        String(url).includes("nova-polygons")
          ? { type: "FeatureCollection", features: storyFeatures() }
          : { type: "FeatureCollection", features: [] }
      ),
    }));
    const rendered = await renderExplainer(1, "close", { close: {}, wide: {} });
    expect(rendered.novaExplainerCards).toHaveLength(14);
    expect(rendered.novaExplainerCards.every((card) => card.box === null)).toBe(true);
    expect(document.querySelectorAll(".nli-nova-explainer-card")).toHaveLength(0);
  });

  it("keeps ordinary Nova preview on the idle 08:03 clock without explainer cards", async () => {
    await boot();
    await render(1, "nova");
    const rendered = messages(parent, "otef_clock_preview_rendered").at(-1);
    expect(document.getElementById("nliNovaExplainerHost")).not.toBeNull();
    expect(document.querySelectorAll(".nli-nova-explainer-card")).toHaveLength(0);
    expect(rendered).not.toHaveProperty("novaExplainerCamera");
    expect(rendered).not.toHaveProperty("novaExplainerCards");
    expect(document.querySelector("#nliGisClockHost .nli-investigation-timeline-caption").textContent).toContain("08:03");
    expect(rig.map.jumpTo).not.toHaveBeenCalled();
  });

  it("disposes the single explainer overlay with the preview", async () => {
    await boot();
    expect(document.querySelectorAll("#nliNovaExplainerHost")).toHaveLength(1);
    const moveListeners = rig.map.listenerCount("move");
    await dispose();
    dispose = null;
    expect(document.getElementById("nliNovaExplainerHost")).toBeNull();
    expect(rig.map.listenerCount("move")).toBeLessThan(moveListeners);
  });

  it("preloads Hadassah Friedlaender when that face is not already loaded", async () => {
    let releaseFonts = () => {};
    const pendingFontLoads = [];
    let fontsReleased = false;
    const fontsLoad = vi.fn(() => {
      if (fontsReleased) return Promise.resolve([]);
      return new Promise((resolve) => pendingFontLoads.push(resolve));
    });
    releaseFonts = () => {
      fontsReleased = true;
      for (const resolve of pendingFontLoads.splice(0)) resolve([]);
    };
    const fontsCheck = vi.fn((spec) => !String(spec).includes("Hadassah"));
    const frameDocument = {
      getElementById: (id) => document.getElementById(id),
      fonts: { load: fontsLoad, check: fontsCheck },
    };
    createGISMap.mockClear();
    const bootPromise = bootClockPreview({
      window,
      document: frameDocument,
      fetchImpl: vi.fn(async () => ({
        ok: true,
        json: async () => ({ viewport: { bbox: [34, 31, 35, 32], zoom: 10 }, basemap: "osm" }),
      })),
    });
    for (let step = 0; step < 20; step += 1) await Promise.resolve();
    expect(fontsLoad).toHaveBeenCalledWith("14px 'Hadassah Friedlaender'");
    expect(createGISMap).not.toHaveBeenCalled();
    releaseFonts();
    dispose = await bootPromise;
    expect(createGISMap).toHaveBeenCalledTimes(1);
  });
});
