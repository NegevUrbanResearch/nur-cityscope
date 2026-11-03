// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { emptyRoadSignSettings } from "../../frontend/src/shared/road-sign-settings.js";

function makeClient() {
  const state = { acknowledged: emptyRoadSignSettings(), draft: null, revision: 0, status: "Saved" };
  const listeners = new Set();
  return {
    unsubscribes: 0,
    getState: () => structuredClone(state),
    hasUnsavedWork: () => false,
    subscribe(listener) {
      listeners.add(listener);
      listener(structuredClone(state));
      return () => { listeners.delete(listener); this.unsubscribes++; };
    },
    replaceDraft: vi.fn(() => { throw new Error("read-only lifecycle test must not write settings"); }),
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("repeated real preview open/close removes each iframe and window listener", async () => {
  vi.doUnmock("../../frontend/src/projection-config/road-sign-preview.js");
  vi.resetModules();
  const { openRoadSignEditor } = await import("../../frontend/src/projection-config/road-sign-editor-dialog.js");
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("preview child networking is disabled in this test"); }));
  vi.stubGlobal("WebSocket", vi.fn(() => { throw new Error("preview child WebSocket is disabled in this test"); }));
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  for (let cycle = 0; cycle < 3; cycle++) {
    const client = makeClient();
    const editor = openRoadSignEditor({ document, settingsClient: client,
      getAppliedCalibration: () => ({ config: structuredClone(DEFAULT_PROJECTION_CONFIG), revision: 7 }),
      manageBeforeUnload: false });
    const frame = document.querySelector("iframe.road-sign-preview-frame");
    expect(frame).toBeTruthy();
    expect(document.querySelectorAll("iframe.road-sign-preview-frame")).toHaveLength(1);
    expect(client.replaceDraft).not.toHaveBeenCalled();
    expect(window.fetch).not.toHaveBeenCalled();
    expect(window.WebSocket).not.toHaveBeenCalled();
    expect(editor.close()).toBe(true);
    expect(document.querySelectorAll("iframe.road-sign-preview-frame")).toHaveLength(0);
    expect(client.unsubscribes).toBe(1);
    expect(frame.isConnected).toBe(false);
    const messageListener = add.mock.calls.filter(([type]) => type === "message").at(-1)?.[1];
    expect(messageListener).toBeTypeOf("function");
    expect(remove.mock.calls).toContainEqual(["message", messageListener]);
    expect(remove.mock.calls).toContainEqual(["resize", expect.any(Function)]);
  }
  expect(add.mock.calls.filter(([type]) => type === "message")).toHaveLength(3);
  expect(remove.mock.calls.filter(([type]) => type === "message")).toHaveLength(3);
});