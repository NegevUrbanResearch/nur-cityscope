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
