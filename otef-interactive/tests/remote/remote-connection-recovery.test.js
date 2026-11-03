import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { bindRemoteConnectionRecovery } from "../../frontend/src/remote/remote-connection-recovery.js";

let doc, win, reconnect, dispose;
beforeEach(() => {
  vi.useFakeTimers();
  doc = new EventTarget(); doc.visibilityState = "visible";
  win = new EventTarget();
  vi.stubGlobal("document", doc); vi.stubGlobal("window", win);
  reconnect = vi.fn();
  dispose = bindRemoteConnectionRecovery(reconnect);
});
afterEach(() => { dispose(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function visibility(state) { doc.visibilityState = state; doc.dispatchEvent(new Event("visibilitychange")); }

test("foreground and nearby restoration events produce one recovery, not an initial reload", () => {
  win.dispatchEvent(new Event("pageshow")); vi.runAllTimers();
  expect(reconnect).not.toHaveBeenCalled();
  visibility("hidden"); visibility("visible");
  const restored = new Event("pageshow"); restored.persisted = true;
  win.dispatchEvent(restored); win.dispatchEvent(new Event("online"));
  vi.runAllTimers(); expect(reconnect).toHaveBeenCalledOnce();
  visibility("hidden"); visibility("visible");
  vi.runAllTimers(); expect(reconnect).toHaveBeenCalledTimes(2);
});
test("network return recovers while visible but never while hidden", () => {
  visibility("hidden"); win.dispatchEvent(new Event("online"));
  vi.runAllTimers(); expect(reconnect).not.toHaveBeenCalled();
  visibility("visible"); vi.runAllTimers();
  win.dispatchEvent(new Event("online")); vi.runAllTimers();
  expect(reconnect).toHaveBeenCalledTimes(2);
});
test("hiding again or disposing cancels queued recovery", () => {
  visibility("hidden"); visibility("visible"); visibility("hidden");
  vi.runAllTimers(); expect(reconnect).not.toHaveBeenCalled();
  visibility("visible"); dispose(); vi.runAllTimers();
  win.dispatchEvent(new Event("online")); vi.runAllTimers();
  expect(reconnect).not.toHaveBeenCalled();
});
