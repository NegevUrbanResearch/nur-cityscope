// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createProjectionSurfaceCompositor } from "../../frontend/src/projection/projection-surface-compositor.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";

const rig = vi.hoisted(() => ({ map: null, surface: null, createSurface: vi.fn(), syncLayers: vi.fn(), init: vi.fn(), getGroups: vi.fn(),
  getLayerDataUrl: vi.fn(() => "/settlements.geojson"), live: vi.fn(() => { throw new Error("Live command used"); }), timeline: vi.fn(async () => {}),
  snapshot: vi.fn(() => ({ visible: true, model: { clockLabel: "06:29" } })), model: vi.fn(async () => ({ packs: [] })) }));
vi.mock("../../frontend/src/projection/maplibre-projection.js", () => ({ createProjectionMap: vi.fn(() => rig.map) }));
vi.mock("../../frontend/src/projection/maplibre-projection-layers.js", () => ({ syncProjectionLayers: rig.syncLayers }));
vi.mock("../../frontend/src/map/maplibre-layer-manager.js", async (importOriginal) => ({ ...await importOriginal(), disposeLayerManagerForMap: vi.fn() }));
vi.mock("../../frontend/src/shared/layer-registry.js", () => ({ default: { init: rig.init, getGroups: rig.getGroups, getLayerDataUrl: rig.getLayerDataUrl } }));
vi.mock("../../frontend/src/map/legend-model-builder.js", () => ({ buildLegendModel: rig.model, getDashBackground: () => "#123456" }));
vi.mock("../../frontend/src/shared/maplibre-investigation-timeline.js", () => ({ syncInvestigationTimelineToMap: rig.timeline, getInvestigationTimelineRenderSnapshot: rig.snapshot, disposeInvestigationTimelineForMap: vi.fn() }));
vi.mock("../../frontend/src/projection/projection-browser-route.js", () => ({ createProjectionBrowserSurface: rig.createSurface }));
vi.mock("../../frontend/src/shared/OTEFDataContext.js", () => ({ default: new Proxy({}, { get: () => rig.live }) }));

import { createProjectionSettlementNameAdapter } from "../../frontend/src/projection/projection-settlement-name-adapter.js";
import { bootProjectionSettlementNamePreview, measureSettlementPreviewWarnings } from "../../frontend/src/projection/projection-settlement-name-preview.js";

const mesh = { width: 1920, height: 1080, vertices: [
  { u: 0, v: 0, x: 0, y: 0 }, { u: 1, v: 0, x: 1, y: 0 }, { u: 1, v: 1, x: 1, y: 1 }, { u: 0, v: 1, x: 0, y: 1 },
], triangles: [0, 1, 2, 0, 2, 3] };
const settings = {
  baseline: {
    captureId: "fixture-settlement-name", captureDigest: "a".repeat(64), sourceDigest: "b".repeat(64), catalogDigest: "c".repeat(64),
    predecessor: { revision: 1, configDigest: "d".repeat(64) }, successor: { revision: 2, configDigest: "e".repeat(64) },
    outputs: { left: { "0067": { x: 510, y: 350 } }, right: { "0067": { x: 1200, y: 360 } } },
  },
  style: { fontFamily: "Guttman Hatzvi", fontPx: 14, rotateDeg: 35 },
  outputs: { left: {}, right: {} },
};
let parent;
let dispose;
let fetchImpl;
const messages = (type) => parent.postMessage.mock.calls.map(([data]) => data).filter((data) => data.type === type);
function send(state) {
  const event = new MessageEvent("message", { origin: window.location.origin, data: state });
  Object.defineProperty(event, "source", { value: parent });
  window.dispatchEvent(event);
}

beforeEach(() => {
  vi.clearAllMocks();
  dispose = null;
  document.body.innerHTML = '<div id="displayContainer"><div id="projectionImageClip"><img id="displayedImage"></div><div id="projectionMap"></div><div id="mapLegend"></div></div>';
  const displayed = document.getElementById("displayedImage");
  Object.defineProperty(displayed, "complete", { configurable: true, value: true });
  Object.defineProperty(displayed, "naturalWidth", { configurable: true, value: 1534 });
  Object.defineProperty(displayed, "naturalHeight", { configurable: true, value: 1046 });
  displayed.decode = () => Promise.resolve();
  document.fonts = { load: async () => ["Guttman Hatzvi"] };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => new Proxy({
    font: "", measureText: () => ({ width: 20, actualBoundingBoxLeft: 10, actualBoundingBoxRight: 10, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 4 }),
    clearRect() {}, translate() {}, rotate() {}, strokeText() {}, fillText: vi.fn(), drawImage() {}, save() {}, restore() {},
    getImageData: () => ({ data: new Uint8ClampedArray(16) }),
  }, { get: (target, key) => (key in target ? target[key] : vi.fn()) }));
  window.proj4 = (_from, _to, point) => [point[0] / 10000, point[1] / 10000];
  const listeners = new Map();
  rig.map = { on: vi.fn((type, fn) => { listeners.set(type, fn); if (type === "load" || type === "idle") fn(); }), off: vi.fn(), loaded: () => true, areTilesLoaded: () => true,
    getCanvas: () => document.createElement("canvas"), getContainer: () => document.getElementById("projectionMap"),
    getCenter: () => ({ lng: 34.5, lat: 31.4 }), getZoom: () => 12, getBearing: () => 0, getPitch: () => 0, jumpTo: vi.fn(),
    getMinZoom: () => 0, getMaxZoom: () => 24, project: (point) => ({ x: point[0], y: point[1] }), triggerRepaint: vi.fn(), remove: vi.fn(),
    getStyle: () => ({ layers: [] }) };
  rig.init.mockResolvedValue();
  rig.model.mockResolvedValue({ packs: [{ id: "nli", name: "NLI", layers: [{ id: "nli.investigation_polygons", items: [{ id: "real-entry", label: "Actual legend entry", shape: "line", stroke: "#123456" }] }] }] });
  rig.getGroups.mockReturnValue([{ id: "projector_base", enabled: true, layers: [{ id: "שמות_יישובים", enabled: true }, { id: "model_base", enabled: true, file: "model.png" }] }]);
  rig.createSurface.mockImplementation(async (options) => {
    const adapter = createProjectionSettlementNameAdapter({ document, output: options.spanId });
    const compositor = createProjectionSurfaceCompositor({ renderer: { draw: () => true } });
    rig.surface = { getMesh: () => structuredClone(mesh), applyConfig: vi.fn(() => true),
      draw: vi.fn(() => { compositor.setScene({ ...options.getScene(), settlements: adapter.descriptor() }); return compositor.draw(); }),
      requestDraw: vi.fn(), dispose: vi.fn(), getSettlementAdapter: () => adapter };
    return rig.surface;
  });
  parent = { postMessage: vi.fn() };
  Object.defineProperty(window, "parent", { configurable: true, value: parent });
  fetchImpl = vi.fn(async (url) => ({ ok: true, json: async () => {
    const value = String(url);
    if (value.includes("projection-config")) return { revision: 9, config: structuredClone(DEFAULT_PROJECTION_CONFIG), presets: [], selectedPresetId: null };
    if (value.includes("model-bounds")) return { west: 100, south: 100, east: 200, north: 200, model_image: "/model.png" };
    if (value.includes("settlements")) return { type: "FeatureCollection", features: [{ type: "Feature", properties: { citycode: "0067", cityname: "נירים" }, geometry: { type: "Point", coordinates: [34.4, 31.3] } }] };
    return { settlement_name_settings: structuredClone(settings), settlement_name_revision: 4, nli_clock_layout: { projection: { left: { leftPct: 8, topPct: 8, widthPct: 20, heightPct: 10, fontPx: 22, rotateDeg: 0 } } }, legend_settings: { projection: { left: { leftPct: 8, topPct: 40, widthPct: 20, heightPct: 10, fontPx: 18, rotateDeg: 0 } } } };
  } }));
});
afterEach(async () => { await dispose?.(); vi.restoreAllMocks(); });

test.each(["left", "right"])("read-only %s preview draws that output's labels and suppresses duplicate settlement symbols", async (output) => {
  window.history.replaceState({}, "", `/frontend/projection.html?settlementPreview=1&span=${output}&outputMode=browser&previewSession=settle-1`);
  dispose = await bootProjectionSettlementNamePreview({ window, document, fetchImpl });
  expect(fetchImpl.mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
  expect(rig.syncLayers.mock.calls[0][2]).toMatchObject({ suppressSettlementSymbols: true });
  expect(rig.live).not.toHaveBeenCalled();
  expect(messages("otef_settlement_preview_ready")[0]).toMatchObject({ output, sessionId: "settle-1" });
  send({ type: "otef_settlement_preview_state", sessionId: "settle-1", requestId: 1, output, selectedCitycode: "0067", settings });
  await vi.waitFor(() => expect(messages("otef_settlement_preview_rendered")).toHaveLength(1));
  const reply = messages("otef_settlement_preview_rendered")[0];
  expect(reply.labels.find((item) => item.citycode === "0067")).toMatchObject({ x: output === "left" ? 510 : 1200, text: "נירים" });
  expect(reply.mesh).toEqual(mesh);
  expect(reply.output).toBe(output);
  expect(rig.createSurface.mock.calls[0][0].spanId).toBe(output);
  expect(document.getElementById("displayedImage").getAttribute("src") || document.getElementById("displayedImage").src || "").not.toMatch(/model\.png/);
  const synced = rig.syncLayers.mock.calls[0][1];
  expect(synced.find((group) => group.id === "projector_base")?.layers?.find((layer) => layer.id === "model_base")?.enabled).toBe(false);
  const scene = rig.createSurface.mock.calls[0][0].getScene();
  expect(scene.image ?? null).toBeNull();
  expect(scene.map?.source).toBeTruthy();
  if (output === "left") {
    expect(scene.caption?.source).toBeTruthy();
    expect(scene.legend?.source).toBeTruthy();
  } else {
    expect(scene.caption ?? null).toBeNull();
    expect(scene.legend ?? null).toBeNull();
  }
  const onRender = rig.map.on.mock.calls.find(([type]) => type === "render")?.[1];
  expect(onRender).toEqual(expect.any(Function));
  rig.surface.requestDraw.mockClear();
  onRender();
  expect(rig.surface.requestDraw).toHaveBeenCalled();
});

test("preview waits for map readiness before the first frame", async () => {
  window.history.replaceState({}, "", "/frontend/projection.html?settlementPreview=1&span=left&outputMode=browser&previewSession=settle-wait");
  let releaseLoad;
  rig.map.loaded = () => false;
  rig.map.areTilesLoaded = () => false;
  rig.map.on = vi.fn((type, fn) => {
    if (type === "load") releaseLoad = fn;
    if (type === "idle") fn();
  });
  const pending = bootProjectionSettlementNamePreview({ window, document, fetchImpl });
  await vi.waitFor(() => expect(releaseLoad).toEqual(expect.any(Function)));
  expect(rig.createSurface).not.toHaveBeenCalled();
  releaseLoad();
  dispose = await pending;
  expect(rig.createSurface).toHaveBeenCalled();
});

test("clipping and overlap follow the rendered rotation", () => {
  const label = (x, y, rotateDeg) => ({ x, y, rotateDeg, inkBox: { left: x - 50, right: x + 50, top: y - 5, bottom: y + 5 } });
  expect(measureSettlementPreviewWarnings([label(100, 100, 0), label(100, 130, 0)]).overlap).toBe(false);
  expect(measureSettlementPreviewWarnings([label(100, 100, 90), label(100, 130, 90)]).overlap).toBe(true);
  const edge = { x: 10, y: 100, rotateDeg: 0, inkBox: { left: -40, right: 60, top: 95, bottom: 105 } };
  expect(measureSettlementPreviewWarnings([edge]).clipped).toBe(true);
  expect(measureSettlementPreviewWarnings([{ ...edge, rotateDeg: 90 }]).clipped).toBe(false);
});

test("V5 and uninitialized settings stop at a visible setup error", async () => {
  window.history.replaceState({}, "", "/frontend/projection.html?settlementPreview=1&span=left&outputMode=browser&previewSession=settle-v5");
  fetchImpl.mockImplementation(async (url) => ({ ok: true, json: async () => {
    if (String(url).includes("projection-config")) return { revision: 3, config: { ...structuredClone(DEFAULT_PROJECTION_CONFIG), schemaVersion: 5 }, presets: [] };
    return { settlement_name_settings: {}, settlement_name_revision: 0 };
  } }));
  dispose = await bootProjectionSettlementNamePreview({ window, document, fetchImpl });
  expect(rig.createSurface).not.toHaveBeenCalled();
  expect(document.body.textContent).toMatch(/Initialization required/);
  expect(messages("otef_settlement_preview_error")[0].message).toMatch(/Initialization required/);
  expect(rig.live).not.toHaveBeenCalled();
});

test("a font failure is visible and does not invent coordinates", async () => {
  window.history.replaceState({}, "", "/frontend/projection.html?settlementPreview=1&span=right&outputMode=browser&previewSession=settle-font");
  document.fonts = { load: async () => { throw new Error("font failed"); } };
  dispose = await bootProjectionSettlementNamePreview({ window, document, fetchImpl });
  expect(document.body.textContent).toMatch(/font/i);
  expect(messages("otef_settlement_preview_error")[0].message).toMatch(/font/i);
  expect(JSON.stringify(messages("otef_settlement_preview_error"))).not.toMatch(/"x":0/);
  expect(rig.live).not.toHaveBeenCalled();
});
