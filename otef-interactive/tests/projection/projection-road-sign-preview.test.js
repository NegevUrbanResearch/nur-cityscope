import { expect, test, vi } from "vitest";
const previewBootMocks = vi.hoisted(() => ({ span: vi.fn(), descriptor: vi.fn(), surface: vi.fn(), map: null }));
vi.mock("../../frontend/src/projection/maplibre-projection.js", () => ({ createProjectionMap: vi.fn(() => previewBootMocks.map) }));
vi.mock("../../frontend/src/shared/layer-registry.js", () => ({ default: {
  init: vi.fn(async () => {}), getGroups: vi.fn(() => [{ id: "nli", enabled: false, layers: [{ id: "׳¦׳™׳¨_232", enabled: false }] }]),
} }));
vi.mock("../../frontend/src/projection/maplibre-projection-layers.js", () => ({ syncProjectionLayers: vi.fn() }));
vi.mock("../../frontend/src/map/maplibre-layer-manager.js", () => ({ disposeLayerManagerForMap: vi.fn() }));
vi.mock("../../frontend/src/projection/projection-span-view.js", () => ({
  applyProjectionSpanView: previewBootMocks.span, createProjectionMapDescriptor: previewBootMocks.descriptor,
}));
vi.mock("../../frontend/src/projection/projection-browser-route.js", () => ({ createProjectionBrowserSurface: previewBootMocks.surface }));
vi.mock("../../frontend/src/projection/projection-road-sign-adapter.js", () => ({ createProjectionRoadSignAdapter: vi.fn(() => ({
  ready: vi.fn(async () => {}), setState: vi.fn(), descriptor: vi.fn(() => ({ signs: [] })), dispose: vi.fn(),
})) }));
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { emptyRoadSignSettings } from "../../frontend/src/shared/road-sign-settings.js";
import { installProjectionRoadSignPreviewBridge } from "../../frontend/src/projection/projection-preview-bridge.js";
import { bootProjectionRoadSignPreview } from "../../frontend/src/projection/projection-road-sign-preview.js";

function mesh() { return { width: 1920, height: 1080, vertices: [
  { u: 0, v: 0, x: 0, y: 0 }, { u: 1, v: 0, x: 1, y: 0 }, { u: 1, v: 1, x: 1, y: 1 }, { u: 0, v: 1, x: 0, y: 1 },
], triangles: [0, 1, 2, 0, 2, 3] }; }

function bridgeHarness(renderState = vi.fn(async () => ({ mesh: mesh(), meshIdentity: "mesh:1" }))) {
  const listeners = new Map(), sent = [];
  const parent = { postMessage: (message, origin) => sent.push({ message, origin }) };
  const win = { parent, location: { origin: "http://preview.test" }, addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); },
    dispatch: (event) => listeners.get("message")?.(event) };
  const dispose = installProjectionRoadSignPreviewBridge({ win, sessionId: "11111111-1111-4111-8111-111111111111", output: "right", renderState });
  const state = (requestId, calibrationRevision = 4) => ({ type: "otef_road_sign_preview_state", sessionId: "11111111-1111-4111-8111-111111111111",
    requestId, output: "right", settings: emptyRoadSignSettings(), config: structuredClone(DEFAULT_PROJECTION_CONFIG), calibrationRevision });
  return { win, parent, sent, renderState, dispose, state };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("child bridge rejects wrong source, origin, session, output, and malformed settings", async () => {
  const h = bridgeHarness();
  expect(h.sent[0].message).toMatchObject({ type: "otef_road_sign_preview_ready", output: "right" });
  const valid = h.state(1);
  for (const event of [
    { origin: "http://evil.test", source: h.parent, data: valid },
    { origin: "http://preview.test", source: {}, data: valid },
    { origin: "http://preview.test", source: h.parent, data: { ...valid, sessionId: "wrong" } },
    { origin: "http://preview.test", source: h.parent, data: { ...valid, output: "left" } },
  ]) h.win.dispatch(event);
  expect(h.renderState).not.toHaveBeenCalled();
  h.win.dispatch({ origin: "http://preview.test", source: h.parent, data: { ...valid, settings: { version: 2 } } });
  expect(h.sent.at(-1).message).toMatchObject({ type: "otef_road_sign_preview_error", requestId: 1, calibrationRevision: 4 });
  expect(h.renderState).not.toHaveBeenCalled();
  h.dispose();
});

test("newer request and calibration revision suppress an obsolete drawn mesh", async () => {
  let releaseOld;
  const h = bridgeHarness(vi.fn((state) => state.requestId === 1
    ? new Promise((resolve) => { releaseOld = resolve; })
    : Promise.resolve({ mesh: mesh(), meshIdentity: "mesh:new" })));
  h.win.dispatch({ origin: "http://preview.test", source: h.parent, data: h.state(1, 4) });
  h.win.dispatch({ origin: "http://preview.test", source: h.parent, data: h.state(2, 5) });
  await tick();
  releaseOld({ mesh: mesh(), meshIdentity: "mesh:old" });
  await tick();
  const rendered = h.sent.filter(({ message }) => message.type === "otef_road_sign_preview_rendered");
  expect(rendered).toHaveLength(1);
  expect(rendered[0].message).toMatchObject({ requestId: 2, calibrationRevision: 5, meshIdentity: "mesh:new" });
  h.dispose();
});

test("disposal stops accepting state messages", () => {
  const h = bridgeHarness();
  h.dispose();
  h.win.dispatch({ origin: "http://preview.test", source: h.parent, data: h.state(1) });
  expect(h.renderState).not.toHaveBeenCalled();
});

test.each([
  "?roadSignsPreview=1&clockPreview=1&span=right&outputMode=browser&previewSession=11111111-1111-4111-8111-111111111111",
  "?roadSignsPreview=1&settlementPreview=1&span=right&outputMode=browser&previewSession=11111111-1111-4111-8111-111111111111",
  "?roadSignsPreview=1&preview=1&span=right&outputMode=browser&previewSession=11111111-1111-4111-8111-111111111111",
])("child boot rejects mixed preview route %s", async (search) => {
  await expect(bootProjectionRoadSignPreview({ window: { location: { search }, parent: {} }, document: {}, fetchImpl: vi.fn() })).rejects.toThrow(/session is missing or invalid/);
});
test("first parent applied calibration drives the initial camera and browser surface", async () => {
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG); config.pre.scale = 1.23;
  previewBootMocks.span.mockReset(); previewBootMocks.descriptor.mockReset(); previewBootMocks.surface.mockReset(); previewBootMocks.span.mockReturnValue(true);
  const eventListeners = new Map(), replies = [];
  const parent = { postMessage: (message, origin) => replies.push({ message, origin }) };
  const win = { parent, proj4: (_from, _to, point) => point, location: {
    search: "?roadSignsPreview=1&span=right&outputMode=browser&previewSession=11111111-1111-4111-8111-111111111111",
    origin: "http://preview.test",
  }, addEventListener: (type, fn) => eventListeners.set(type, fn), removeEventListener: (type) => eventListeners.delete(type) };
  const image = { style: {}, removeAttribute: vi.fn(), parentElement: null };
  const host = { style: {}, appendChild: vi.fn(), getBoundingClientRect: () => ({ width: 1920, height: 1080 }) };
  const doc = { getElementById: (id) => id === "displayContainer" ? host : id === "displayedImage" ? image : null };
  previewBootMocks.map = { loaded: () => true, areTilesLoaded: () => true, on: vi.fn(), off: vi.fn(), remove: vi.fn(),
    getCanvas: () => ({}), getContainer: () => ({ clientWidth: 1920, clientHeight: 1080 }) };
  const surface = { draw: vi.fn(() => true), getMesh: vi.fn(() => mesh()), requestDraw: vi.fn(), applyConfig: vi.fn(() => true), dispose: vi.fn() };
  previewBootMocks.surface.mockImplementation(async (args) => { args.getScene(); return surface; });
  const dispose = await bootProjectionRoadSignPreview({ window: win, document: doc,
    fetchImpl: vi.fn(async () => ({ ok: true, json: async () => ({ west: 1, south: 2, east: 3, north: 4, image_width: 100, image_height: 100 }) })) });
  const state = { type: "otef_road_sign_preview_state", sessionId: "11111111-1111-4111-8111-111111111111",
    requestId: 1, output: "right", settings: emptyRoadSignSettings(), config, calibrationRevision: 9 };
  eventListeners.get("message")({ origin: "http://preview.test", source: parent, data: state });
  await tick(); await tick();
  expect(previewBootMocks.span.mock.calls[0][0].config).toEqual(config);
  expect(previewBootMocks.surface.mock.calls[0][0].initialConfig).toEqual(config);
  expect(previewBootMocks.descriptor.mock.calls[0][0].config).toEqual(config);
  expect(surface.applyConfig).not.toHaveBeenCalled();
  expect(replies.at(-1).message).toMatchObject({ type: "otef_road_sign_preview_rendered", calibrationRevision: 9 });
  dispose();
});


test("newer calibration during initial surface setup disposes the obsolete surface without a receipt", async () => {
  previewBootMocks.span.mockReset().mockReturnValue(true); previewBootMocks.descriptor.mockReset(); previewBootMocks.surface.mockReset();
  const pending = [], eventListeners = new Map(), replies = [];
  const parent = { postMessage: (message, origin) => replies.push({ message, origin }) };
  const win = { parent, proj4: (_from, _to, point) => point, location: {
    search: "?roadSignsPreview=1&span=right&outputMode=browser&previewSession=11111111-1111-4111-8111-111111111111", origin: "http://preview.test",
  }, addEventListener: (type, fn) => eventListeners.set(type, fn), removeEventListener: (type) => eventListeners.delete(type) };
  const image = { style: {}, removeAttribute: vi.fn(), parentElement: null };
  const host = { style: {}, appendChild: vi.fn(), getBoundingClientRect: () => ({ width: 1920, height: 1080 }) };
  const doc = { getElementById: (id) => id === "displayContainer" ? host : id === "displayedImage" ? image : null };
  previewBootMocks.map = { loaded: () => true, areTilesLoaded: () => true, on: vi.fn(), off: vi.fn(), remove: vi.fn(),
    getCanvas: () => ({}), getContainer: () => ({ clientWidth: 1920, clientHeight: 1080 }) };
  previewBootMocks.surface.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const dispose = await bootProjectionRoadSignPreview({ window: win, document: doc,
    fetchImpl: vi.fn(async () => ({ ok: true, json: async () => ({ west: 1, south: 2, east: 3, north: 4, image_width: 100, image_height: 100 }) })) });
  const state = (requestId, scale) => { const config = structuredClone(DEFAULT_PROJECTION_CONFIG); config.pre.scale = scale; return {
    type: "otef_road_sign_preview_state", sessionId: "11111111-1111-4111-8111-111111111111", requestId, output: "right",
    settings: emptyRoadSignSettings(), config, calibrationRevision: requestId + 8 }; };
  eventListeners.get("message")({ origin: "http://preview.test", source: parent, data: state(1, 1.2) });
  await tick();
  eventListeners.get("message")({ origin: "http://preview.test", source: parent, data: state(2, 1.3) });
  await tick();
  expect(pending).toHaveLength(2);
  const current = { draw: vi.fn(() => true), getMesh: vi.fn(() => mesh()), requestDraw: vi.fn(), applyConfig: vi.fn(() => true), dispose: vi.fn() };
  const obsolete = { draw: vi.fn(() => true), getMesh: vi.fn(() => mesh()), requestDraw: vi.fn(), applyConfig: vi.fn(() => true), dispose: vi.fn() };
  pending[1](current); await tick(); await tick();
  pending[0](obsolete); await tick(); await tick();
  expect(obsolete.dispose).toHaveBeenCalledOnce();
  expect(current.dispose).not.toHaveBeenCalled();
  expect(replies.filter(({ message }) => message.type === "otef_road_sign_preview_rendered").map(({ message }) => message.requestId)).toEqual([2]);
  dispose();
});
