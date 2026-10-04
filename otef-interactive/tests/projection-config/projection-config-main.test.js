import { beforeEach, expect, test, vi } from "vitest";

const harness = vi.hoisted(() => ({ fetches: [], catalogs: [], registries: [], mounted: [], socket: null, getState: vi.fn(), failClient: false }));
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

vi.mock("../../frontend/src/shared/api-client.js", () => ({ OTEF_API: {
  baseUrl: "/api", getState: (...args) => harness.getState(...args), setNliClockLayout: vi.fn(), setLegendSettings: vi.fn(), setSettlementNames: vi.fn(),
} }));
vi.mock("../../frontend/src/shared/websocket-client.js", () => ({ OTEFWebSocketClient: class { on() {} off() {} disconnect() { harness.socket?.disconnect?.(); } } }));
vi.mock("../../frontend/src/shared/layer-registry.js", () => ({ default: {}, LayerRegistry: class {
  constructor(options) { this.options = options; harness.registries.push(this); }
  async init() {
    const root = await this.options.fetchImpl("/otef-interactive/public/processed/layers/layers-manifest.json");
    if (!root.ok) return;
    const manifest = await root.json();
    await Promise.all((manifest.packs || []).map(async (pack) => {
      await this.options.fetchImpl(`/otef-interactive/public/processed/layers/${pack}/manifest.json`);
      await this.options.fetchImpl(`/otef-interactive/public/processed/layers/${pack}/styles.json`);
    }));
  }
} }));
vi.mock("../../frontend/src/shared/settlement-name-catalog.js", () => ({ loadSettlementNameCatalog: (...args) => {
  const item = deferred(); harness.catalogs.push({ args, item }); return item.promise;
} }));
vi.mock("../../frontend/src/shared/projection-config-client.js", () => ({ createProjectionConfigClient: () => {
  if (harness.failClient) { harness.failClient = false; throw new Error("core unavailable"); }
  return { getState: () => ({ snapshot: { config: {} }, draft: {} }), setValidateCandidate() {}, start() {}, stop() {}, subscribe() { return () => {}; } };
} }));
vi.mock("../../frontend/src/projection-config/config-controller.js", () => ({ mountProjectionConfig: (...args) => {
  const record = { args, catalogUpdates: [], dispose: vi.fn(), setSettlementCatalog(catalog, status) { this.catalogUpdates.push({ catalog, status }); } };
  harness.mounted.push(record); return record;
} }));
vi.mock("../../frontend/src/projection-config/projection-trace.js", () => ({ createProjectionTrace: () => ({ enabled: false, dispose: vi.fn() }) }));
vi.mock("../../frontend/src/projection-config/output-window-controller.js", () => ({ createOutputWindowController: () => ({ dispose() {} }) }));
vi.mock("../../frontend/src/projection/projection-captured-baseline.js", () => ({ createProjectionBaselineCatalogLoader: () => ({}) }));
vi.mock("../../frontend/src/projection/projection-candidate-validation.js", () => ({ createProjectionGeometryValidator: () => ({ dispose() {} }), readProjectionCandidateInputs: async () => ({}) }));
vi.mock("../../frontend/src/shared/nli-name-field-data.js", () => ({ disposeProjectionNameWallPreparation() {}, prepareProjectionNameWall() {} }));

import { bootProjectionConfig } from "../../frontend/src/entries/projection-config-main.js";

const snapshot = {
  nli_clock_layout: { gis: { start: { leftPct: 10, topPct: 20, widthPct: 30, heightPct: 15, fontPx: 20, rotateDeg: 0 } }, projection: { left: { leftPct: 12, topPct: 14, widthPct: 24, heightPct: 12, fontPx: 18, rotateDeg: 0 } } }, nli_clock_layout_revision: 1,
  legend_settings: { projection: { left: { leftPct: 20, topPct: 12, widthPct: 50, heightPct: 12, fontPx: 18, rotateDeg: 0, dwellSeconds: 8 } } }, legend_layout_revision: 1,
  settlement_name_settings: { baseline: { captureId: "fixture", captureDigest: "a".repeat(64), sourceDigest: "b".repeat(64), catalogDigest: "c".repeat(64), predecessor: { revision: 1, configDigest: "d".repeat(64) }, successor: { revision: 2, configDigest: "e".repeat(64) }, outputs: { left: { "0067": { x: 1, y: 2 } }, right: {} } }, style: { fontFamily: "Arial", fontPx: 12, rotateDeg: 0 }, outputs: { left: {}, right: {} } }, settlement_name_revision: 1,
};
const response = (body) => ({ ok: true, json: async () => structuredClone(body) });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => { harness.fetches = []; harness.catalogs = []; harness.registries = []; harness.mounted = []; harness.getState.mockReset(); harness.failClient = false; });

test("mounts core before optional reads resolve and publishes each hydration and catalog independently", async () => {
  const fetchImpl = vi.fn((url, options) => {
    if (url === "/api/otef/") { const item = deferred(); harness.fetches.push({ item, options }); return item.promise; }
    return Promise.resolve(response({ packs: [] }));
  });
  const root = {};
  const dispose = await bootProjectionConfig({ document: { getElementById: () => root }, location: { href: "http://localhost/config" }, fetchImpl, socket: { on() {}, off() {} } });
  await vi.waitFor(() => expect(harness.fetches).toHaveLength(2));
  expect(harness.mounted).toHaveLength(1);
  expect(harness.mounted[0].args[1].catalog).toEqual({ entries: [] });
  expect(harness.getState).not.toHaveBeenCalled();
  expect(harness.fetches.every(({ options }) => options.signal instanceof AbortSignal)).toBe(true);
  harness.fetches[1].item.resolve(response(snapshot));
  await vi.waitFor(() => expect(harness.mounted[0].args[1].settlementClient.getHydrationState().status).toBe("Saved"));
  expect(harness.mounted[0].args[1].layoutClient.getHydrationState().status).toBe("Loading");
  harness.catalogs[0].item.resolve({ entries: [{ citycode: "0067", text: "Nirim" }] });
  await vi.waitFor(() => expect(harness.mounted[0].catalogUpdates.some((update) => update.status.status === "ready")).toBe(true));
  expect(harness.mounted[0].catalogUpdates.at(-1).status.status).toBe("ready");
  harness.fetches[0].item.resolve(response(snapshot));
  await vi.waitFor(() => expect(harness.mounted[0].args[1].layoutClient.getHydrationState().status).toBe("Saved"));
  dispose();
});

test("disposal aborts optional reads and blocks late catalog publication", async () => {
  const fetchImpl = vi.fn((url, options) => {
    if (url === "/api/otef/") { const item = deferred(); harness.fetches.push({ item, options }); return item.promise; }
    return Promise.resolve(response({ packs: [] }));
  });
  const dispose = await bootProjectionConfig({ document: { getElementById: () => ({}) }, location: { href: "http://localhost/config" }, fetchImpl, socket: { on() {}, off() {} } });
  await vi.waitFor(() => expect(harness.fetches).toHaveLength(2));
  await vi.waitFor(() => expect(harness.catalogs).toHaveLength(1));
  const mounted = harness.mounted[0];
  dispose();
  expect(mounted.dispose).toHaveBeenCalledOnce();
  expect(harness.fetches.every(({ item }) => item.promise)).toBe(true);
  harness.catalogs[0].item.resolve({ entries: [] });
  harness.fetches.forEach(({ item }) => item.resolve(response(snapshot)));
  await tick();
  expect(mounted.catalogUpdates).toHaveLength(1);
  expect(mounted.catalogUpdates[0].status.status).toBe("loading");
  expect(harness.fetches.every(({ options }) => options.signal.aborted)).toBe(true);
  expect(mounted.args[1].layoutClient.getHydrationState().status).toBe("Loading");
});

test("timed-out optional reads cannot replace a successful Retry or its local edits", async () => {
  vi.useFakeTimers();
  const fetchImpl = vi.fn((url) => {
    if (url === "/api/otef/") { const item = deferred(); harness.fetches.push({ item }); return item.promise; }
    return Promise.resolve(response({ packs: [] }));
  });
  try {
    await bootProjectionConfig({ document: { getElementById: () => ({}) }, location: { href: "http://localhost/config" }, fetchImpl, socket: { on() {}, off() {} } });
    await vi.waitFor(() => expect(harness.fetches).toHaveLength(2));
    const { layoutClient, settlementClient } = harness.mounted[0].args[1];
    await vi.advanceTimersByTimeAsync(15000);
    expect(layoutClient.getHydrationState().status).toBe("Failed");
    expect(settlementClient.getHydrationState().status).toBe("Failed");
    const retryLayout = layoutClient.hydrate({ forceFresh: true });
    const retrySettlement = settlementClient.hydrate({ forceFresh: true });
    await vi.waitFor(() => expect(harness.fetches).toHaveLength(4));
    harness.fetches[2].item.resolve(response(snapshot));
    harness.fetches[3].item.resolve(response(snapshot));
    await Promise.all([retryLayout, retrySettlement]);
    const layoutDraft = { ...snapshot.nli_clock_layout.gis.start, leftPct: 77 };
    const pendingLayoutWrite = layoutClient.commit("gisClock", "start", layoutDraft);
    await vi.waitFor(() => expect(layoutClient.getSlot("gisClock", "start").draft).toEqual(layoutDraft));
    harness.fetches[0].item.resolve(response({ ...snapshot, nli_clock_layout_revision: 99 }));
    harness.fetches[1].item.resolve(response({ ...snapshot, settlement_name_revision: 99 }));
    await Promise.resolve(); await Promise.resolve();
    expect(layoutClient.getHydrationState().status).toBe("Saved");
    expect(settlementClient.getHydrationState().status).toBe("Saved");
    expect(layoutClient.getSlot("gisClock", "start").draft).toEqual(layoutDraft);
    layoutClient.destroy(); settlementClient.destroy();
    await pendingLayoutWrite.catch(() => {});
  } finally { vi.useRealTimers(); }
});

test("core boot failure renders a retry action on the existing root", async () => {
  harness.failClient = true;
  const created = [];
  const element = () => { const node = { setAttribute() {}, addEventListener(_type, handler) { this.handler = handler; }, append() {} }; created.push(node); return node; };
  const root = { replaceChildren: vi.fn(), ownerDocument: { createElement: element } };
  const doc = { getElementById: () => root, createElement: element };
  await bootProjectionConfig({ document: doc, location: { href: "http://localhost/config" }, fetchImpl: vi.fn(), socket: { on() {}, off() {} } });
  expect(root.replaceChildren).toHaveBeenCalled();
  expect(created.some((node) => node.textContent === "Retry calibration")).toBe(true);
  created.find((node) => node.textContent === "Retry calibration").handler();
  expect(harness.mounted).toHaveLength(1);
});

test("catalog Retry starts a fresh attempt on the mounted core", async () => {
  const fetchImpl = vi.fn(async () => response({ packs: [] }));
  await bootProjectionConfig({ document: { getElementById: () => ({}) }, location: { href: "http://localhost/config" }, fetchImpl, socket: { on() {}, off() {} } });
  await vi.waitFor(() => expect(harness.catalogs).toHaveLength(1));
  harness.catalogs[0].item.reject(new Error("catalog offline"));
  await vi.waitFor(() => expect(harness.mounted[0].catalogUpdates.at(-1).status.status).toBe("error"));
  const retry = harness.mounted[0].args[1].retrySettlementCatalog;
  retry();
  await vi.waitFor(() => expect(harness.catalogs).toHaveLength(2));
  expect(harness.registries).toHaveLength(2);
  harness.catalogs[1].item.resolve({ entries: [{ citycode: "0067", text: "Nirim" }] });
  await vi.waitFor(() => expect(harness.mounted[0].catalogUpdates.at(-1).status.status).toBe("ready"));
  expect(harness.mounted).toHaveLength(1);
});

test("a stalled catalog styles fetch times out and Retry uses a fresh registry", async () => {
  vi.useFakeTimers();
  let stalledStyles;
  let styleAttempts = 0;
  const fetchImpl = vi.fn((url) => {
    if (url === "/api/otef/") return Promise.resolve(response(snapshot));
    if (url.endsWith("layers-manifest.json")) return Promise.resolve(response({ packs: styleAttempts === 0 ? ["pack-a"] : [] }));
    if (url.endsWith("/manifest.json")) return Promise.resolve(response({ name: "Pack A", layers: [] }));
    if (url.endsWith("/styles.json")) {
      styleAttempts += 1;
      stalledStyles = deferred();
      return stalledStyles.promise;
    }
    return Promise.resolve(response({}));
  });
  try {
    await bootProjectionConfig({ document: { getElementById: () => ({}) }, location: { href: "http://localhost/config" }, fetchImpl, socket: { on() {}, off() {} } });
    for (let index = 0; index < 10; index += 1) await Promise.resolve();
    expect(styleAttempts).toBe(1);
    await vi.advanceTimersByTimeAsync(15000);
    await vi.waitFor(() => expect(harness.mounted[0].catalogUpdates.at(-1).status.status).toBe("error"));
    const retry = harness.mounted[0].args[1].retrySettlementCatalog;
    retry();
    await vi.waitFor(() => expect(harness.catalogs).toHaveLength(1));
    expect(harness.registries).toHaveLength(2);
    harness.catalogs[0].item.resolve({ entries: [{ citycode: "0067", text: "Nirim" }] });
    await vi.waitFor(() => expect(harness.mounted[0].catalogUpdates.at(-1).status.status).toBe("ready"));
    stalledStyles.resolve(response({}));
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    expect(harness.mounted[0].catalogUpdates.at(-1).status.status).toBe("ready");
  } finally { vi.useRealTimers(); }
});
