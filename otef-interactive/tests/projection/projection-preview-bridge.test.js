import { expect, test, vi } from "vitest";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { installProjectionPreviewBridge } from "../../frontend/src/projection/projection-preview-bridge.js";
import * as previewBridge from "../../frontend/src/projection/projection-preview-bridge.js";

const clockLayout = { leftPct: 12, topPct: 22, widthPct: 30, heightPct: 10, fontPx: 24, rotateDeg: 30 };
const clockRequest = (requestId, patch = {}) => ({ type: "otef_clock_preview_state", sessionId: "clock-1", requestId,
  surface: "projection", sceneId: "home", output: "left", element: "clock", clockLayout,
  legendLayout: { ...clockLayout, dwellSeconds: 8 }, pageIndex: 0, ...patch });

test("clock bridge validates parent, session, increasing requests and finite local layouts", async () => {
  expect(previewBridge.installProjectionClockPreviewBridge).toBeTypeOf("function");
  const listeners = new Map(); const parent = { postMessage: vi.fn() };
  const win = { parent, location: { origin: "http://localhost" }, addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: (type) => listeners.delete(type) };
  const renderState = vi.fn(async () => ({ meshIdentity: "mesh-1", mesh: {}, pageIndex: 0, pageCount: 1 }));
  const dispose = previewBridge.installProjectionClockPreviewBridge({ win, sessionId: "clock-1", renderState });
  const send = (data, source = parent, origin = "http://localhost") => listeners.get("message")({ data, source, origin });
  send(clockRequest(1), {}); send(clockRequest(1), parent, "http://other"); send(clockRequest(1, { sessionId: "old" }));
  send(clockRequest(1, { sceneId: "nova" })); send(clockRequest(1, { element: "projection.left" }));
  send(clockRequest(1, { clockLayout: { ...clockLayout, fontPx: NaN } }));
  send(clockRequest(1, { pageIndex: -1 }));
  expect(renderState).not.toHaveBeenCalled();
  send(clockRequest(3)); send(clockRequest(3)); send(clockRequest(2));
  await vi.waitFor(() => expect(renderState).toHaveBeenCalledOnce());
  expect(parent.postMessage).toHaveBeenLastCalledWith({ type: "otef_clock_preview_rendered", sessionId: "clock-1", requestId: 3,
    surface: "projection", sceneId: "home", output: "left", meshIdentity: "mesh-1", mesh: {}, pageIndex: 0, pageCount: 1 }, "http://localhost");
  dispose(); expect(listeners.has("message")).toBe(false);
});

test("clock bridge aborts older draws and cannot reply after disposal", async () => {
  expect(previewBridge.installProjectionClockPreviewBridge).toBeTypeOf("function");
  const listeners = new Map(); const parent = { postMessage: vi.fn() }; const pending = [];
  const win = { parent, location: { origin: "http://localhost" }, addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: (type) => listeners.delete(type) };
  const dispose = previewBridge.installProjectionClockPreviewBridge({ win, sessionId: "clock-1",
    renderState: (state, context) => new Promise((resolve) => pending.push({ state, context, resolve })) });
  const send = (data) => listeners.get("message")({ data, source: parent, origin: "http://localhost" });
  send(clockRequest(1)); send(clockRequest(2, { element: "legend" }));
  expect(pending[0].context.signal.aborted).toBe(true);
  expect(pending[0].context.isCurrent()).toBe(false);
  pending[0].resolve({}); await Promise.resolve();
  expect(parent.postMessage.mock.calls.filter(([data]) => data.requestId === 1)).toHaveLength(0);
  dispose(); expect(pending[1].context.signal.aborted).toBe(true);
  pending[1].resolve({}); await Promise.resolve();
  expect(parent.postMessage.mock.calls.filter(([data]) => data.type === "otef_clock_preview_rendered")).toHaveLength(0);
});

test("preview accepts only its same-origin parent and applies a validated draft locally", () => {
  const listeners = new Map();
  const parent = { postMessage: vi.fn() };
  const win = {
    parent, location: { origin: "http://localhost" },
    addEventListener: (type, callback) => listeners.set(type, callback),
    removeEventListener: (type) => listeners.delete(type),
  };
  const map = { setEffectiveProjectionConfig: vi.fn(() => true) };
  const names = { setProjectionConfig: vi.fn(() => true) };
  const sync = vi.fn();
  const dispose = installProjectionPreviewBridge({ win, output: "left", map, nameFieldController: names, syncContextInvestigation: sync });
  expect(parent.postMessage).toHaveBeenCalledWith({ type: "otef_projection_preview_ready", output: "left" }, "http://localhost");
  const message = { type: "otef_projection_preview_config", output: "left", requestId: 3, config: structuredClone(DEFAULT_PROJECTION_CONFIG) };
  listeners.get("message")({ source: {}, origin: "http://localhost", data: message });
  listeners.get("message")({ source: parent, origin: "http://other", data: message });
  listeners.get("message")({ source: parent, origin: "http://localhost", data: { ...message, config: { pre: {} } } });
  expect(map.setEffectiveProjectionConfig).not.toHaveBeenCalled();
  listeners.get("message")({ source: parent, origin: "http://localhost", data: message });
  expect(map.setEffectiveProjectionConfig).toHaveBeenCalledWith(message.config);
  expect(names.setProjectionConfig).toHaveBeenCalledWith(message.config);
  expect(sync).toHaveBeenCalledOnce();
  expect(parent.postMessage).toHaveBeenLastCalledWith({ type: "otef_projection_preview_applied", output: "left", requestId: 3, success: true }, "http://localhost");
  dispose();
  expect(listeners.has("message")).toBe(false);
});

test("preview exposes the candidate apply hook before local camera consumers", () => {
  const listeners = new Map();
  const parent = { postMessage: vi.fn() };
  const win = { parent, location: { origin: "http://localhost" }, addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener: () => {} };
  const order = [];
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const dispose = installProjectionPreviewBridge({
    win, output: "right", map: { setEffectiveProjectionConfig: vi.fn(() => { order.push("map"); return true; }) },
    nameFieldController: { setProjectionConfig: vi.fn(() => { order.push("names"); return true; }) },
    syncContextInvestigation: () => order.push("sync"),
    applyProjectionConfig: (candidate) => { expect(candidate).toEqual(config); order.push("warp"); return true; },
  });
  listeners.get("message")({ source: parent, origin: "http://localhost", data: { type: "otef_projection_preview_config", output: "right", requestId: 4, config } });
  expect(order).toEqual(["warp", "map", "names", "sync"]);
  dispose();
});

test('an asynchronous paired preview apply uses the prepared wall and ignores a stale reply', async () => {
  const listeners = new Map(); const parent = { postMessage: vi.fn() };
  const win = { parent, location: { origin: 'http://localhost' },
    addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener() {} };
  const pending = [];
  const applyProjectionConfig = vi.fn((_config, context) => new Promise((resolve) => pending.push({ resolve, context })));
  const map = { setEffectiveProjectionConfig: vi.fn() };
  const names = { setProjectionConfig: vi.fn() };
  installProjectionPreviewBridge({ win, output: 'left', map, nameFieldController: names,
    syncContextInvestigation: vi.fn(), applyProjectionConfig });
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const send = (requestId) => listeners.get('message')({ source: parent, origin: 'http://localhost', data: {
    type: 'otef_projection_preview_config', output: 'left', requestId, config,
  } });
  send(1); send(2);
  expect(pending[0].context.signal.aborted).toBe(true);
  pending[0].resolve({ committed: true });
  pending[1].resolve({ committed: true });
  await vi.waitFor(() => expect(parent.postMessage).toHaveBeenLastCalledWith({
    type: 'otef_projection_preview_applied', output: 'left', requestId: 2, success: true,
  }, 'http://localhost'));
  expect(parent.postMessage.mock.calls.filter(([message]) => message.requestId === 1)).toHaveLength(0);
  expect(map.setEffectiveProjectionConfig).not.toHaveBeenCalled();
  expect(names.setProjectionConfig).not.toHaveBeenCalled();
});

test('preview validation replies with exact identity and complete wall without applying the renderer', async () => {
  const listeners = new Map(); const parent = { postMessage: vi.fn() };
  const win = { parent, location: { origin: 'http://localhost' }, addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener() {} };
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const wall = { datasetVersion: 'release', mode: 'wall', digest: 'a'.repeat(64), expected: 1228, placed: 1228 };
  const map = { setEffectiveProjectionConfig: vi.fn() };
  const validateWall = vi.fn(async () => wall);
  installProjectionPreviewBridge({ win, output: 'left', map, nameFieldController: {}, syncContextInvestigation() {}, validateWall });
  listeners.get('message')({ source: parent, origin: 'http://localhost', data: { type: 'otef_projection_preview_validate', output: 'left', requestId: 2, identity: JSON.stringify(config), config } });
  await vi.waitFor(() => expect(parent.postMessage).toHaveBeenLastCalledWith({ type: 'otef_projection_preview_validated', output: 'left', requestId: 2, identity: JSON.stringify(config), valid: true, wall }, 'http://localhost'));
  expect(map.setEffectiveProjectionConfig).not.toHaveBeenCalled();
  expect(validateWall).toHaveBeenCalledWith(config, expect.any(Object));
});

test('preview validation preserves bounded diagnostics for an incomplete candidate without marking it valid', async () => {
  const listeners = new Map(); const parent = { postMessage: vi.fn() };
  const win = { parent, location: { origin: 'http://localhost' }, addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener() {} };
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const diagnostics = { state: 'invalid', datasetVersion: 'nli-1', mode: 'model', requestedFontPx: 6, effectiveFontPx: null, expected: 1228, placed: 1201, left: 600, right: 601, reason: 'capacity through 1px' };
  installProjectionPreviewBridge({ win, output: 'right', map: {}, nameFieldController: {}, syncContextInvestigation() {},
    validateWall: async () => ({ ...diagnostics }) });
  const identity = JSON.stringify(config);
  listeners.get('message')({ source: parent, origin: 'http://localhost', data: { type: 'otef_projection_preview_validate', output: 'right', requestId: 9, identity, config } });
  await vi.waitFor(() => expect(parent.postMessage).toHaveBeenLastCalledWith({ type: 'otef_projection_preview_validated', output: 'right', requestId: 9, identity, valid: false, diagnostics, error: 'capacity through 1px' }, 'http://localhost'));
});
