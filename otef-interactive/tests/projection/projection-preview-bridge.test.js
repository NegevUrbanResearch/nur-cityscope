import { expect, test, vi } from "vitest";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { installProjectionPreviewBridge } from "../../frontend/src/projection/projection-preview-bridge.js";

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
