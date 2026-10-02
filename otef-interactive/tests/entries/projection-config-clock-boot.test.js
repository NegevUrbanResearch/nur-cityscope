import { expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ mount: null, getState: null, writeClock: null, writeLegend: null, socketCtor: null }));
vi.mock("../../frontend/src/shared/api-client.js", () => ({ OTEF_API: {
  getState: (...args) => harness.getState(...args),
  setNliClockLayout: (...args) => harness.writeClock(...args),
  setLegendSettings: (...args) => harness.writeLegend(...args),
} }));
vi.mock("../../frontend/src/shared/websocket-client.js", () => ({ OTEFWebSocketClient: class { constructor(...args) { harness.socketCtor(args); } } }));
vi.mock("../../frontend/src/shared/layer-registry.js", () => ({ default: { init: async () => {} } }));
vi.mock("../../frontend/src/shared/projection-config-client.js", () => ({ createProjectionConfigClient: () => ({
  getState: () => ({ snapshot: { config: {} }, draft: {} }), setValidateCandidate() {}, start() {}, stop() {}, subscribe() { return () => {}; },
}) }));
vi.mock("../../frontend/src/projection-config/config-controller.js", () => ({ mountProjectionConfig: (...args) => harness.mount(...args) }));
vi.mock("../../frontend/src/projection-config/output-window-controller.js", () => ({ createOutputWindowController: () => ({ dispose() {} }) }));
vi.mock("../../frontend/src/projection/projection-captured-baseline.js", () => ({ loadCapturedProjectionAsset: async () => ({}), loadCapturedProjectionFraming: async () => ({}) }));
vi.mock("../../frontend/src/projection/projection-candidate-validation.js", () => ({ createProjectionGeometryValidator: () => ({ validateCandidate: async () => ({}), dispose() {} }), readProjectionCandidateInputs: async () => ({ datasetVersion: "release" }) }));
vi.mock("../../frontend/src/shared/nli-name-field-data.js", () => ({ disposeProjectionNameWallPreparation() {}, prepareProjectionNameWall() {} }));

import { bootProjectionConfig } from "../../frontend/src/entries/projection-config-main.js";

test("config boot owns one layout client backed by OTEF_API and the existing socket", async () => {
  const initial = { leftPct: 8, topPct: 8, widthPct: 35, heightPct: 28, fontPx: 22, rotateDeg: 0 };
  const snapshot = { nli_clock_layout: { gis: { start: initial }, projection: { left: initial } }, nli_clock_layout_revision: 2,
    legend_settings: { projection: { left: { ...initial, dwellSeconds: 8 } } }, legend_layout_revision: 3 };
  harness.getState = vi.fn(async () => structuredClone(snapshot));
  harness.writeClock = vi.fn(async (_table, _surface, slot, layout) => ({ status: "ok", nliClockLayout: { gis: { [slot]: layout }, projection: { left: initial } }, nliClockLayoutRevision: 3 }));
  harness.writeLegend = vi.fn(async (_table, patch) => ({ changeKind: "layout", legendProjection: { left: patch.layout }, legendLayoutRevision: 4 }));
  harness.socketCtor = vi.fn();
  const mounted = [];
  harness.mount = vi.fn((_root, options) => { mounted.push(options); return { dispose: vi.fn() }; });
  const root = {};
  const doc = { getElementById: () => root };
  const socket = { on: vi.fn(), off: vi.fn() };
  const dispose = await bootProjectionConfig({ document: doc, location: { href: "http://localhost/otef-interactive/projection-config.html", origin: "http://localhost" }, fetchImpl: vi.fn(), socket });
  expect(harness.socketCtor).not.toHaveBeenCalled();
  expect(harness.getState).toHaveBeenCalledWith("otef", { forceFresh: true });
  const layoutClient = mounted[0].layoutClient;
  expect(layoutClient.getSlot("gisClock", "start").acknowledged).toEqual(initial);
  const changed = { ...initial, leftPct: 13 };
  await layoutClient.commit("gisClock", "start", changed);
  expect(harness.writeClock).toHaveBeenCalledWith("otef", "gis", "start", changed, expect.objectContaining({ baseRevision: 2, sourceId: expect.any(String) }));
  await layoutClient.commit("projectionLegend", "left", { ...initial, dwellSeconds: 9 });
  expect(harness.writeLegend).toHaveBeenCalledWith("otef", { span: "left", layout: expect.objectContaining({ dwellSeconds: 9 }) }, expect.objectContaining({ baseRevision: 3 }));
  const clientDestroy = vi.spyOn(layoutClient, "destroy");
  dispose();
  expect(clientDestroy).toHaveBeenCalledOnce();
  expect(socket.on).toHaveBeenCalled();
});

test("config boot exposes failed layout hydration, blocks writes, and recovers with a fresh read", async () => {
  const snapshot = { nli_clock_layout: { gis: {}, projection: {} }, nli_clock_layout_revision: 2,
    legend_settings: { projection: {} }, legend_layout_revision: 3 };
  harness.getState = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(snapshot);
  harness.writeClock = vi.fn(); harness.writeLegend = vi.fn(); harness.socketCtor = vi.fn();
  let layoutClient;
  harness.mount = vi.fn((_root, options) => { layoutClient = options.layoutClient; return { dispose() {} }; });
  const dispose = await bootProjectionConfig({ document: { getElementById: () => ({}) },
    location: { href: "http://localhost/otef-interactive/projection-config.html" }, fetchImpl: vi.fn(), socket: { on() {}, off() {} } });
  expect(layoutClient.getHydrationState()).toMatchObject({ status: "Failed", error: "Offline" });
  await expect(layoutClient.commit("gisClock", "start", { leftPct: 12 })).rejects.toThrow("not loaded");
  expect(harness.writeClock).not.toHaveBeenCalled();
  await layoutClient.hydrate({ forceFresh: true });
  expect(layoutClient.getHydrationState().status).toBe("Saved");
  expect(harness.getState.mock.calls.at(-1)).toEqual(["otef", { forceFresh: true }]);
  dispose();
});
