// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createProjectionSurfaceCompositor } from "../../frontend/src/projection/projection-surface-compositor.js";
import { mapSourceUvToOutput, mapOutputToSourceUv } from "../../frontend/src/projection-config/clock-layout-geometry.js";
import { projectionOverlayMatrix } from "../../frontend/src/projection/projection-overlay-placement.js";

const rig = vi.hoisted(() => ({ map: null, surface: null, snapshot: vi.fn(), createSurface: vi.fn(), syncLayers: vi.fn(), timeline: vi.fn(),
  disposeTimeline: vi.fn(), disposeLayers: vi.fn(), init: vi.fn(), getGroups: vi.fn(), model: vi.fn(), live: vi.fn(() => { throw new Error("Live command used"); }) }));
vi.mock("../../frontend/src/projection/maplibre-projection.js", () => ({ createProjectionMap: vi.fn(() => rig.map) }));
vi.mock("../../frontend/src/projection/maplibre-projection-layers.js", () => ({ syncProjectionLayers: rig.syncLayers }));
vi.mock("../../frontend/src/map/maplibre-layer-manager.js", async (importOriginal) => ({ ...await importOriginal(), disposeLayerManagerForMap: rig.disposeLayers }));
vi.mock("../../frontend/src/shared/layer-registry.js", () => ({ default: { init: rig.init, getGroups: rig.getGroups, getLayerDataUrl: () => "/model.png" } }));
vi.mock("../../frontend/src/map/legend-model-builder.js", () => ({ buildLegendModel: rig.model, getDashBackground: () => "#123456" }));
vi.mock("../../frontend/src/shared/maplibre-investigation-timeline.js", () => ({ syncInvestigationTimelineToMap: rig.timeline,
  getInvestigationTimelineRenderSnapshot: rig.snapshot, disposeInvestigationTimelineForMap: rig.disposeTimeline }));
vi.mock("../../frontend/src/projection/projection-browser-route.js", () => ({ createProjectionBrowserSurface: rig.createSurface }));
vi.mock("../../frontend/src/shared/OTEFDataContext.js", () => ({ default: new Proxy({}, { get: () => rig.live }) }));

import { bootProjectionClockPreview } from "../../frontend/src/projection/projection-clock-preview.js";
import { getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";
import { releaseProjectionModelImage, syncProjectionModelImage } from "../../frontend/src/projection/projection-model-image.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { HOME_CUE } from "../../frontend/src/remote/nli-staff-script.js";

const mesh = { width: 1920, height: 1080, vertices: [{ x: 0.1, y: 0.05, u: 0, v: 0 }, { x: 0.9, y: 0.1, u: 1, v: 0 },
  { x: 0.85, y: 0.95, u: 1, v: 1 }, { x: 0.05, y: 0.9, u: 0, v: 1 }], triangles: [0, 1, 2, 0, 2, 3] };
const layout = { leftPct: 12, topPct: 22, widthPct: 30, heightPct: 10, fontPx: 24, rotateDeg: 30 };
const frameState = (requestId, patch = {}) => ({ type: "otef_clock_preview_state", sessionId: "clock-1", requestId,
  surface: "projection", sceneId: "home", output: "left", element: "clock", clockLayout: { ...layout },
  legendLayout: { ...layout, topPct: 60, dwellSeconds: 8 }, pageIndex: 0, ...patch });
let parent, dispose, fetchImpl, draws, contexts, pendingDraw;
const messages = (type) => parent.postMessage.mock.calls.map(([data]) => data).filter((data) => data.type === type);
function send(state) {
  const event = new MessageEvent("message", { origin: window.location.origin, data: state });
  Object.defineProperty(event, "source", { value: parent }); window.dispatchEvent(event);
}
beforeEach(() => {
  vi.clearAllMocks(); dispose = null; pendingDraw = null; contexts = []; draws = [];
  document.body.innerHTML = '<div id="displayContainer"><div id="projectionImageClip"><img id="displayedImage"></div><div id="projectionMap"></div><div id="mapLegend"></div></div>';
  window.history.replaceState({}, "", "/otef-interactive/projection.html?span=left&preview=1&clockPreview=1&previewSession=clock-1&mapPixelRatio=1&outputMode=browser");
  parent = { postMessage: vi.fn() }; Object.defineProperty(window, "parent", { configurable: true, value: parent });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function () {
    const context = new Proxy({ fillText: vi.fn(), measureText: (text) => ({ width: text.length * 7 }) }, { get: (target, key) => key in target ? target[key] : vi.fn() });
    contexts.push(context); return context;
  });
  window.proj4 = (_from, _to, point) => [point[0] / 10000, point[1] / 10000];
  const listeners = new Map();
  let zoom = 12;
  rig.map = { on: vi.fn((type, fn) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); }),
    off: vi.fn((type, fn) => listeners.get(type)?.delete(fn)), loaded: () => true, areTilesLoaded: () => true, getCanvas: () => document.createElement("canvas"),
    getContainer: () => document.getElementById("projectionMap"), getCenter: () => ({ lng: 34.5, lat: 31.4 }), getZoom: () => zoom,
    getBearing: () => 0, getPitch: () => 0, unproject: () => [34.5, 31.4], jumpTo: vi.fn((camera) => { if (Number.isFinite(camera.zoom)) zoom = camera.zoom; }), getMinZoom: () => 0, getMaxZoom: () => 24,
    project: (point) => ({ x: point[0], y: point[1] }), triggerRepaint: vi.fn(), remove: vi.fn(),
    emit: (type) => [...(listeners.get(type) || [])].forEach((fn) => fn()) };
  rig.init.mockResolvedValue();
  rig.getGroups.mockReturnValue([{ id: "nli", layers: [{ id: "investigation_polygons", enabled: false }, { id: "unused", enabled: true }] }]);
  rig.model.mockResolvedValue({ packs: [{ id: "nli", name: "NLI", layers: [{ id: "nli.investigation_polygons", items: [{ id: "real-entry", label: "Actual legend entry", shape: "line", stroke: "#123456" }] }] }] });
  rig.timeline.mockImplementation(async () => { if (pendingDraw) await pendingDraw; });
  rig.snapshot.mockReturnValue({ visible: true, model: { clockLabel: "06:29" } });
  rig.createSurface.mockImplementation(async (options) => {
    const compositor = createProjectionSurfaceCompositor({ renderer: { draw: ({ layers }) => { draws.push(layers); return true; } } });
    rig.surface = { getMesh: () => structuredClone(mesh), applyConfig: vi.fn(() => true), draw: vi.fn(() => { compositor.setScene(options.getScene()); return compositor.draw(); }),
      requestDraw: vi.fn(), dispose: vi.fn() }; return rig.surface;
  });
  fetchImpl = vi.fn(async (url) => ({ ok: true, json: async () => String(url).includes("projection-config")
    ? { revision: 7, config: structuredClone(DEFAULT_PROJECTION_CONFIG), presets: [{ config: {} }], selectedPresetId: "unused" }
    : String(url).includes("model-bounds") ? { west: 100, south: 100, east: 200, north: 200, model_image: "/model.png" }
      : { viewport: { zoom: 10 }, legend_settings: { language: "en", summarizedGroupIds: ["keep"], projection: { left: { ...layout, visible: true, dwellSeconds: 13 } } }, nli_clock_layout: { projection: { left: layout } } } }));
});
afterEach(async () => { await dispose?.(); vi.restoreAllMocks(); });

test("boots from one read per resource and draws Home clock plus real legend through the compositor", async () => {
  dispose = await bootProjectionClockPreview({ window, document, fetchImpl });
  expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(["/api/otef_viewport/by-table/otef/", "/api/otef/projection-config/?table=otef", "data/model-bounds.json"]);
  expect(rig.createSurface.mock.calls[0][0].initialConfig).toEqual(DEFAULT_PROJECTION_CONFIG);
  expect(rig.surface.applyConfig).toHaveBeenCalledWith(DEFAULT_PROJECTION_CONFIG);
  expect(rig.surface.draw).toHaveBeenCalledOnce();
  expect(messages("otef_clock_preview_ready")).toEqual([{ type: "otef_clock_preview_ready", sessionId: "clock-1", surface: "projection", output: "left" }]);
  send(frameState(1));
  await vi.waitFor(() => expect(messages("otef_clock_preview_rendered")).toHaveLength(1));
  const reply = messages("otef_clock_preview_rendered")[0];
  expect(reply).toMatchObject({ requestId: 1, sceneId: "home", output: "left", mesh, pageIndex: 0, pageCount: 1 });
  expect(reply).not.toHaveProperty("novaExplainerCamera");
  expect(reply).not.toHaveProperty("novaExplainerCards");
  expect(reply.meshIdentity).toBeTypeOf("string");
  const layers = draws.at(-1); expect(layers.map((layer) => layer.id)).toContain("caption"); expect(layers.map((layer) => layer.id)).toContain("legend");
  expect(layers.find((layer) => layer.id === "caption").matrix).toEqual(projectionOverlayMatrix(layout));
  expect(contexts.some((context) => context.fillText.mock.calls.some(([text]) => text === "06:29"))).toBe(true);
  expect(contexts.some((context) => context.fillText.mock.calls.some(([text]) => text === "Actual legend entry"))).toBe(true);
  expect(rig.timeline.mock.calls[0][3]).toMatchObject({ displayProfile: "projection", clockOnlyCaptionRelevantOverride: true });
  const groups = rig.syncLayers.mock.calls[0][1];
  expect(groups[0].layers.map((item) => item.enabled)).toEqual([HOME_CUE.layers.includes("nli.investigation_polygons"), false]);
  expect(rig.live).not.toHaveBeenCalled();
  expect(document.getElementById("displayedImage").getAttribute("src") || document.getElementById("displayedImage").src || "").not.toMatch(/model\.png/);
  expect(rig.createSurface.mock.calls[0][0].getScene().image ?? null).toBeNull();
  expect(fetchImpl.mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
  const uv = { u: 0.3, v: 0.4 }; expect(mapOutputToSourceUv(reply.mesh, mapSourceUvToOutput(reply.mesh, uv))).toEqual(expect.objectContaining({ u: expect.closeTo(0.3), v: expect.closeTo(0.4) }));
  send(frameState(2, { clockLayout: { ...layout, leftPct: 40 }, pageIndex: 99 }));
  await vi.waitFor(() => expect(messages("otef_clock_preview_rendered")).toHaveLength(2));
  expect(messages("otef_clock_preview_rendered")[1].meshIdentity).toBe(reply.meshIdentity);
  expect(messages("otef_clock_preview_rendered")[1].pageIndex).toBe(0);
});

test("read-only Home preview retains canvas names because it has no replacement name adapter", async () => {
  dispose = await bootProjectionClockPreview({ window, document, fetchImpl });
  expect(rig.syncLayers.mock.calls[0][0]).toBe(rig.map);
  expect(Array.isArray(rig.syncLayers.mock.calls[0][1])).toBe(true);
  expect(rig.syncLayers.mock.calls[0][2]).toEqual({ suppressCanvasNameSymbols: false });
  expect(rig.live).not.toHaveBeenCalled();
});

test("projection child reports measured clipping for both clock and legend without writes", async () => {
  dispose = await bootProjectionClockPreview({ window, document, fetchImpl });
  const host = document.getElementById("nliExplainerHost");
  const caption = host.querySelector(".nli-investigation-timeline-caption");
  for (const element of [host, document.getElementById("mapLegend")]) {
    Object.defineProperty(element, "clientWidth", { configurable: true, value: 38 });
    Object.defineProperty(element, "clientHeight", { configurable: true, value: 21 });
  }
  Object.defineProperty(caption, "scrollWidth", { configurable: true, value: 140 });
  Object.defineProperty(caption, "scrollHeight", { configurable: true, value: 80 });
  Object.defineProperty(document.getElementById("mapLegend"), "scrollWidth", { configurable: true, value: 160 });
  send(frameState(1)); await vi.waitFor(() => expect(messages("otef_clock_preview_rendered")).toHaveLength(1));
  expect(messages("otef_clock_preview_rendered")[0].warnings).toMatchObject({ clipped: true, mapping: "complete" });
  send(frameState(2, { element: "legend" })); await vi.waitFor(() => expect(messages("otef_clock_preview_rendered")).toHaveLength(2));
  expect(messages("otef_clock_preview_rendered")[1].warnings.clipped).toBe(false);
  rig.surface.getMesh = () => ({ ...mesh, triangles: [0, 1, 2] });
  send(frameState(3, { clockLayout: { ...layout, leftPct: 40, topPct: 40, rotateDeg: 0 } }));
  await vi.waitFor(() => expect(messages("otef_clock_preview_rendered")).toHaveLength(3));
  expect(messages("otef_clock_preview_rendered")[2].warnings.mapping).toBe("partial");
  send(frameState(4, { clockLayout: { ...layout, leftPct: 0, topPct: 80, widthPct: 2, heightPct: 2, rotateDeg: 0 } }));
  await vi.waitFor(() => expect(messages("otef_clock_preview_rendered")).toHaveLength(4));
  expect(messages("otef_clock_preview_rendered")[3].warnings.mapping).toBe("unavailable");
  expect(rig.live).not.toHaveBeenCalled(); expect(fetchImpl).toHaveBeenCalledTimes(3);
});

test("a newer local request supersedes a pending legend rebuild before layout or draw commit", async () => {
  dispose = await bootProjectionClockPreview({ window, document, fetchImpl });
  let resolveOld; rig.model.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  send(frameState(1)); await vi.waitFor(() => expect(resolveOld).toBeTypeOf("function"));
  send(frameState(2, { element: "legend", clockLayout: { ...layout, leftPct: 44 } }));
  await vi.waitFor(() => expect(messages("otef_clock_preview_rendered").map((item) => item.requestId)).toEqual([2]));
  const priorDrawCount = draws.length; resolveOld({ packs: [] }); await Promise.resolve(); await Promise.resolve();
  expect(draws).toHaveLength(priorDrawCount);
  expect(messages("otef_clock_preview_rendered").map((item) => item.requestId)).toEqual([2]);
});

test("a superseded legend rejection cannot erase a rendered request or schedule a stale redraw", async () => {
  dispose = await bootProjectionClockPreview({ window, document, fetchImpl });
  let rejectOld;
  rig.model.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
  send(frameState(1)); await vi.waitFor(() => expect(rejectOld).toBeTypeOf("function"));
  send(frameState(2, { element: "legend", clockLayout: { ...layout, leftPct: 44 } }));
  await vi.waitFor(() => expect(messages("otef_clock_preview_rendered").map((item) => item.requestId)).toEqual([2]));
  const redrawCount = rig.surface.requestDraw.mock.calls.length;
  const drawCount = draws.length;
  rejectOld(new Error("Superseded frame legend build failed")); await Promise.resolve(); await Promise.resolve();
  expect(rig.surface.requestDraw).toHaveBeenCalledTimes(redrawCount);
  expect(draws).toHaveLength(drawCount);
  expect(messages("otef_clock_preview_rendered").map((item) => item.requestId)).toEqual([2]);
  expect(messages("otef_clock_preview_error")).toEqual([]);
  rig.surface.draw();
  expect(draws.at(-1).map((item) => item.id)).toContain("legend");
});

test("home preview snaps the model with CSS transitions disabled", async () => {
  dispose = await bootProjectionClockPreview({ window, document, fetchImpl });
  const image = document.getElementById("displayedImage");
  expect(image.style.opacity).toBe("0");
  expect(image.style.transition).toBe("none");
});

test("preview disposal and style reset leave no model draw callbacks", async () => {
  dispose = await bootProjectionClockPreview({ window, document, fetchImpl });
  let time = 0;
  let frame = null;
  const hooks = {
    now: () => time,
    requestFrame(callback) { frame = { callback }; return 1; },
    cancelFrame() { frame = null; },
    setTimer() { return 1; },
    clearTimer() {},
  };
  getLayerLifecycleRuntime(rig.map)?.dispose();
  const runtime = getLayerLifecycleRuntime(rig.map, hooks);
  const image = document.getElementById("displayedImage");
  const requestDraw = vi.fn();
  const readyNow = ({ ready }) => { ready(); };
  runtime.setDesiredIds(["projector_base.model_base"], { durationMs: 600 });
  syncProjectionModelImage({
    map: rig.map,
    imageEl: image,
    layerGroups: [{ id: "projector_base", enabled: true, layers: [{ id: "model_base", enabled: true }] }],
    modelInfo: { durationMs: 600, fromSlideshowTick: false },
    requestDraw,
    subscribeReady: readyNow,
  });
  runtime.commitBatch();
  time = 300;
  frame.callback(time);
  expect(requestDraw).toHaveBeenCalled();
  const calls = requestDraw.mock.calls.length;
  image.style.opacity = "";
  image.style.transition = "";
  releaseProjectionModelImage(rig.map);
  time = 450;
  frame?.callback(time);
  expect(requestDraw).toHaveBeenCalledTimes(calls);
  runtime.setDesiredIds(["projector_base.model_base"], { durationMs: 600 });
  syncProjectionModelImage({
    map: rig.map,
    imageEl: image,
    layerGroups: [{ id: "projector_base", enabled: true, layers: [{ id: "model_base", enabled: true }] }],
    modelInfo: { durationMs: 600, fromSlideshowTick: false },
    requestDraw,
    subscribeReady: readyNow,
  });
  runtime.commitBatch();
  await dispose();
  time = 600;
  frame?.callback(time);
  expect(requestDraw).toHaveBeenCalledTimes(calls);
});

test("disposes bridge, map, adapters and asset abort signal on unload", async () => {
  dispose = await bootProjectionClockPreview({ window, document, fetchImpl });
  window.dispatchEvent(new Event("pagehide")); await dispose();
  expect(rig.surface.dispose).toHaveBeenCalledOnce(); expect(rig.map.remove).toHaveBeenCalledOnce();
  expect(rig.disposeTimeline).toHaveBeenCalledOnce(); expect(rig.disposeLayers).toHaveBeenCalledOnce();
  expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
  send(frameState(1)); await Promise.resolve(); expect(messages("otef_clock_preview_rendered")).toEqual([]);
});

test("reports failed compositor draw without a rendered acknowledgement", async () => {
  dispose = await bootProjectionClockPreview({ window, document, fetchImpl });
  rig.surface.draw.mockReturnValue(false); send(frameState(1));
  await vi.waitFor(() => expect(messages("otef_clock_preview_error")).toHaveLength(1));
  expect(messages("otef_clock_preview_error")[0]).toMatchObject({ requestId: 1, message: "Projection preview draw failed" });
  expect(messages("otef_clock_preview_rendered")).toEqual([]);
});

test("unload during snapshot bootstrap aborts assets without creating map or bridge", async () => {
  let resolveSnapshot;
  fetchImpl.mockImplementationOnce((_url, { signal }) => new Promise((resolve) => { resolveSnapshot = () => resolve({ ok: true, json: async () => ({}) }); expect(signal.aborted).toBe(false); }));
  const boot = bootProjectionClockPreview({ window, document, fetchImpl });
  window.dispatchEvent(new Event("pagehide")); resolveSnapshot(); dispose = await boot;
  expect(fetchImpl).toHaveBeenCalledOnce(); expect(fetchImpl.mock.calls[0][1].signal.aborted).toBe(true);
  expect(rig.createSurface).not.toHaveBeenCalled(); expect(messages("otef_clock_preview_ready")).toEqual([]);
  expect(messages("otef_clock_preview_error")).toEqual([]);
});

test("late browser surface resolves disposed when the frame closes during startup", async () => {
  let resolveSurface; const pendingSurface = new Promise((resolve) => { resolveSurface = resolve; });
  rig.createSurface.mockImplementationOnce(() => pendingSurface);
  const boot = bootProjectionClockPreview({ window, document, fetchImpl });
  await vi.waitFor(() => expect(rig.createSurface).toHaveBeenCalledOnce());
  window.dispatchEvent(new Event("pagehide"));
  const lateSurface = { dispose: vi.fn() }; resolveSurface(lateSurface); dispose = await boot;
  expect(lateSurface.dispose).toHaveBeenCalledOnce(); expect(rig.map.remove).toHaveBeenCalledOnce();
  expect(messages("otef_clock_preview_ready")).toEqual([]);
});

test("bootstrap errors report their session and release partially constructed resources", async () => {
  rig.createSurface.mockRejectedValueOnce(new Error("Asset decode failed"));
  await expect(bootProjectionClockPreview({ window, document, fetchImpl })).rejects.toThrow("Asset decode failed");
  expect(rig.map.remove).toHaveBeenCalledOnce(); expect(rig.disposeLayers).toHaveBeenCalledOnce();
  expect(messages("otef_clock_preview_error")).toEqual([{ type: "otef_clock_preview_error", sessionId: "clock-1", requestId: null, message: "Asset decode failed" }]);
});

test("the actual projection timeline supplies the Home 06:29 model to the caption painter", async () => {
  const actualTimeline = await vi.importActual("../../frontend/src/shared/maplibre-investigation-timeline.js");
  Object.assign(rig.map, { getStyle: () => ({ layers: [] }), getSource: () => null, getLayer: () => null,
    getPaintProperty: () => undefined, getLayoutProperty: () => undefined, setPaintProperty: vi.fn(), setLayoutProperty: vi.fn(),
    addSource: vi.fn(), addLayer: vi.fn(), removeSource: vi.fn(), removeLayer: vi.fn(), setFeatureState: vi.fn() });
  rig.timeline.mockImplementation(actualTimeline.syncInvestigationTimelineToMap);
  rig.snapshot.mockImplementation(actualTimeline.getInvestigationTimelineRenderSnapshot);
  try {
    dispose = await bootProjectionClockPreview({ window, document, fetchImpl });
    expect(actualTimeline.getInvestigationTimelineRenderSnapshot(rig.map)).toMatchObject({ visible: true, model: { clockLabel: "06:29" } });
    send(frameState(1)); await vi.waitFor(() => expect(messages("otef_clock_preview_rendered")).toHaveLength(1));
    expect(contexts.some((context) => context.fillText.mock.calls.some(([text]) => text === "06:29"))).toBe(true);
  } finally { actualTimeline.disposeInvestigationTimelineForMap(rig.map); }
});

test("projection entry chooses clock preview before live context, table switcher or warp setup", async () => {
  const previewBoot = vi.fn(async () => async () => {});
  const priorFetch = window.fetch;
  window.fetch = fetchImpl;
  vi.doMock("../../frontend/src/projection/projection-clock-preview.js", () => ({ bootProjectionClockPreview: previewBoot }));
  try {
    await import("../../frontend/src/entries/projection-main.js");
    await vi.waitFor(() => expect(previewBoot).toHaveBeenCalledOnce());
    expect(rig.live).not.toHaveBeenCalled(); expect(rig.createSurface).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  } finally {
    window.fetch = priorFetch;
    vi.doUnmock("../../frontend/src/projection/projection-clock-preview.js");
  }
});
