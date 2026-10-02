import { beforeEach, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ mount: null, getState: null, writeClock: null, writeLegend: null, socketCtor: null, socketDisconnect: null, traceFactory: () => ({ enabled: false, dispose() {} }) }));
vi.mock("../../frontend/src/shared/api-client.js", () => ({ OTEF_API: {
  getState: (...args) => harness.getState(...args),
  setNliClockLayout: (...args) => harness.writeClock(...args),
  setLegendSettings: (...args) => harness.writeLegend(...args),
} }));
vi.mock("../../frontend/src/shared/websocket-client.js", () => ({ OTEFWebSocketClient: class { constructor(...args) { harness.socketCtor(args); } disconnect() { harness.socketDisconnect?.(); } on() {} off() {} } }));
vi.mock("../../frontend/src/shared/layer-registry.js", () => ({ default: { init: async () => {} } }));
vi.mock("../../frontend/src/shared/projection-config-client.js", () => ({ createProjectionConfigClient: () => ({
  getState: () => ({ snapshot: { config: {} }, draft: {} }), setValidateCandidate() {}, start() {}, stop() {}, subscribe() { return () => {}; },
}) }));
vi.mock("../../frontend/src/projection-config/config-controller.js", () => ({ mountProjectionConfig: (...args) => harness.mount(...args) }));
vi.mock("../../frontend/src/projection-config/projection-trace.js", () => ({ createProjectionTrace: (...args) => harness.traceFactory(...args) }));
vi.mock("../../frontend/src/projection-config/output-window-controller.js", () => ({ createOutputWindowController: () => ({ dispose() {} }) }));
vi.mock("../../frontend/src/projection/projection-captured-baseline.js", () => ({ createProjectionBaselineCatalogLoader: () => ({}) }));
vi.mock("../../frontend/src/projection/projection-candidate-validation.js", () => ({ createProjectionGeometryValidator: () => ({ validateCandidate: async () => ({}), dispose() {} }), readProjectionCandidateInputs: async () => ({ datasetVersion: "release" }) }));
vi.mock("../../frontend/src/shared/nli-name-field-data.js", () => ({ disposeProjectionNameWallPreparation() {}, prepareProjectionNameWall() {} }));

import { bootProjectionConfig, readProjectionTraceSession, shareConfigUrl } from "../../frontend/src/entries/projection-config-main.js";

beforeEach(() => { harness.traceFactory = () => ({ enabled: false, dispose() {} }); });

test("projection trace opt-in requires exactly one valid UUID query value", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  expect(readProjectionTraceSession({ href: `https://example.test/config?projectionTrace=${id}` })).toBe(id);
  expect(readProjectionTraceSession({ href: "https://example.test/config?projectionTrace=00000000-0000-0000-0000-000000000000" })).toBe("00000000-0000-0000-0000-000000000000");
  expect(readProjectionTraceSession({ href: "https://example.test/config" })).toBeNull();
  expect(readProjectionTraceSession({ href: "https://example.test/config?projectionTrace=bad" })).toBeNull();
  expect(readProjectionTraceSession({ href: `https://example.test/config?projectionTrace=${id}&projectionTrace=bad` })).toBeNull();
  expect(readProjectionTraceSession({ href: "not a URL" })).toBeNull();
});

test("config share URL carries only the active diagnostic session", async () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const location = { href: "http://example.test/otef-interactive/projection-config.html?projectionTrace=ignored", origin: "http://example.test" };
  const document = { getElementById: () => null };
  const normal = await shareConfigUrl({ location, document, traceSessionId: null });
  const traced = await shareConfigUrl({ location, document, traceSessionId: id });
  expect(normal.href).toBe("http://example.test/otef-interactive/projection-config.html");
  expect(new URL(traced.href).searchParams.get("projectionTrace")).toBe(id);
});

test("config boot passes an opted-in trace the page window and disposes it before its owned socket", async () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const events = [];
  const trace = { enabled: true, dispose: () => events.push("trace.dispose") };
  harness.traceFactory = vi.fn(() => trace);
  harness.getState = vi.fn(async () => ({ nli_clock_layout: { gis: {}, projection: {} }, nli_clock_layout_revision: 1, legend_settings: { projection: {} }, legend_layout_revision: 1 }));
  harness.writeClock = vi.fn(); harness.writeLegend = vi.fn();
  harness.socketCtor = vi.fn();
  harness.socketDisconnect = () => events.push("socket.disconnect");
  let options;
  harness.mount = vi.fn((_root, value) => { options = value; return { dispose: () => events.push("mount.dispose") }; });
  const win = { location: { search: `?projectionTrace=${id}` } };
  const doc = { getElementById: () => ({}), defaultView: win };
  const dispose = await bootProjectionConfig({ document: doc, location: { href: `http://localhost/otef-interactive/projection-config.html?projectionTrace=${id}`, origin: "http://localhost" }, fetchImpl: vi.fn() });
  expect(harness.traceFactory).toHaveBeenCalledWith({ sessionId: id, socket: expect.anything(), window: win, document: doc });
  expect(options.trace).toBe(trace);
  dispose();
  expect(events.slice(-2)).toEqual(["trace.dispose", "socket.disconnect"]);
});

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
