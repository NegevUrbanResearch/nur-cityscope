// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { createWarpEditorDialog } from "../../frontend/src/projection-config/warp-editor-dialog.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });

function setup(options = {}) {
  const host = document.createElement("main");
  const home = document.createElement("div");
  const panel = document.createElement("section");
  const overlay = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  home.append(panel, overlay); host.append(home); document.body.append(host);
  const opener = document.createElement("button"); host.append(opener); opener.focus();
  const dialog = createWarpEditorDialog({ document, host, editorPanel: panel, overlay, ...options });
  return { host, home, panel, overlay, opener, dialog };
}

test("one disposable frame exists only for an explicitly open warp editor", () => {
  const { dialog, opener, home, panel, overlay } = setup();
  dialog.update(DEFAULT_PROJECTION_CONFIG);
  expect(document.querySelectorAll("iframe")).toHaveLength(0);
  dialog.open({ side: "left", mode: "keystone", opener });
  const leftFrame = document.querySelector("iframe");
  expect(leftFrame.src).toContain("span=left&preview=1&mapPixelRatio=1&outputMode=browser");
  expect(panel.parentElement).not.toBe(home);
  expect(overlay.parentElement).not.toBe(home);
  expect(document.querySelectorAll("iframe")).toHaveLength(1);
  dialog.open({ side: "left", mode: "grid", opener });
  expect(document.querySelector("iframe")).toBe(leftFrame);
  dialog.open({ side: "right", mode: "grid", opener });
  expect(document.querySelectorAll("iframe")).toHaveLength(1);
  expect(document.querySelector("iframe")).not.toBe(leftFrame);
  dialog.close();
  expect(document.querySelectorAll("iframe")).toHaveLength(0);
  expect(panel.parentElement).toBe(home);
  expect(overlay.parentElement).toBe(home);
  expect(document.activeElement).toBe(opener);
  dialog.dispose();
});

test("resize and orientation changes cancel an active edit before refitting", () => {
  const onBeforeResize = vi.fn();
  const { dialog, opener } = setup({ onBeforeResize });
  window.dispatchEvent(new Event("resize"));
  expect(onBeforeResize).not.toHaveBeenCalled();
  dialog.open({ side: "left", mode: "grid", opener });
  window.dispatchEvent(new Event("resize"));
  window.dispatchEvent(new Event("orientationchange"));
  expect(onBeforeResize).toHaveBeenCalledTimes(1);
  dialog.close();
  window.dispatchEvent(new Event("resize"));
  expect(onBeforeResize).toHaveBeenCalledTimes(1);
  dialog.dispose();
});

test("orientation callback runs independently from ordinary resize while the editor remains open", () => {
  const onBeforeResize = vi.fn();
  const onOrientationChange = vi.fn();
  const { dialog, opener } = setup({ onBeforeResize, onOrientationChange });
  dialog.open({ side: "left", mode: "grid", opener });
  window.dispatchEvent(new Event("resize"));
  expect(onBeforeResize).toHaveBeenCalledTimes(1);
  expect(onOrientationChange).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("orientationchange"));
  expect(onBeforeResize).toHaveBeenCalledTimes(1);
  expect(onOrientationChange).toHaveBeenCalledTimes(1);
  expect(dialog.isOpen()).toBe(true);
  dialog.dispose();
});

test("navigation controls are appended to the private header without replacing dialog actions", () => {
  const navigationControls = document.createElement("div");
  navigationControls.className = "warp-view-controls";
  const { dialog, opener } = setup({ navigationControls });
  dialog.open({ side: "left", mode: "grid", opener });
  expect(document.querySelector(".warp-editor-header .warp-view-controls")).toBe(navigationControls);
  expect(document.querySelector("[data-action=warp-editor-close]")).not.toBeNull();
  expect(document.querySelector(".warp-editor-footer input[aria-label='Editor Live']")).not.toBeNull();
  expect(document.querySelector(".warp-editor-footer button").textContent).toBe("Apply once");
  dialog.dispose();
});

test("only trusted ready sends the latest draft once and stale frames cannot reply", () => {
  const { dialog, opener } = setup();
  const first = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const latest = structuredClone(first); latest.pre.tx = 0.01;
  dialog.open({ side: "left", mode: "keystone", opener });
  const old = document.querySelector("iframe");
  const oldSend = vi.spyOn(old.contentWindow, "postMessage");
  dialog.update(first); dialog.update(latest);
  const ready = { type: "otef_projection_preview_ready", output: "left" };
  window.dispatchEvent(new MessageEvent("message", { origin: "https://wrong.example", source: old.contentWindow, data: ready }));
  expect(oldSend).not.toHaveBeenCalled();
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: old.contentWindow, data: ready }));
  expect(oldSend).toHaveBeenCalledTimes(1);
  expect(oldSend.mock.calls[0][0]).toMatchObject({ type: "otef_projection_preview_config", config: latest });
  dialog.update(latest);
  expect(oldSend).toHaveBeenCalledTimes(1);
  dialog.close(); dialog.open({ side: "left", mode: "grid", opener });
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: old.contentWindow, data: ready }));
  expect(oldSend).toHaveBeenCalledTimes(1);
  dialog.dispose();
});

test("bridge ignores wrong source, side, and outdated applied request", () => {
  const { dialog, opener } = setup();
  dialog.open({ side: "right", mode: "grid", opener });
  const frame = document.querySelector("iframe");
  const send = vi.spyOn(frame.contentWindow, "postMessage");
  dialog.update(DEFAULT_PROJECTION_CONFIG);
  const ready = { type: "otef_projection_preview_ready", output: "right" };
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: window, data: ready }));
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: frame.contentWindow, data: { ...ready, output: "left" } }));
  expect(send).not.toHaveBeenCalled();
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: frame.contentWindow, data: ready }));
  const previousRequest = send.mock.calls[0][0].requestId;
  const changed = structuredClone(DEFAULT_PROJECTION_CONFIG); changed.pre.tx += 0.01;
  dialog.update(changed);
  const currentRequest = send.mock.calls[1][0].requestId;
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: frame.contentWindow, data: { type: "otef_projection_preview_applied", output: "right", requestId: previousRequest, success: false, error: "stale" } }));
  expect(document.querySelector(".warp-editor-message").textContent).not.toContain("stale");
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: frame.contentWindow, data: { type: "otef_projection_preview_applied", output: "right", requestId: currentRequest, success: true } }));
  expect(document.querySelector(".warp-editor-message").textContent).toBe("Current draft");
  dialog.dispose();
});

test("readiness timeout exposes retry without discarding the draft", () => {
  vi.useFakeTimers();
  const { dialog, opener } = setup();
  dialog.update(DEFAULT_PROJECTION_CONFIG);
  dialog.open({ side: "right", mode: "grid", opener });
  const first = document.querySelector("iframe");
  vi.advanceTimersByTime(30000);
  expect(document.querySelector(".warp-editor-message").textContent).toMatch(/unavailable/i);
  document.querySelector('[data-action="warp-editor-retry"]').click();
  const second = document.querySelector("iframe");
  expect(second).not.toBe(first);
  expect(document.querySelectorAll("iframe")).toHaveLength(1);
  dialog.dispose();
});

test("retry refits the replacement frame to the current navigated viewport immediately", () => {
  vi.useFakeTimers();
  const { dialog, opener, overlay } = setup();
  const viewport = document.querySelector(".warp-editor-viewport");
  Object.defineProperties(viewport, { clientWidth: { configurable: true, value: 600 }, clientHeight: { configurable: true, value: 400 } });
  dialog.open({ side: "left", mode: "grid", opener });
  dialog.setViewBox({ x: -240, y: -90, width: 2400, height: 1260 });
  const first = document.querySelector(".warp-editor-frame");
  const fittedTransform = first.style.transform;
  expect(fittedTransform).not.toBe("");
  expect(overlay.getAttribute("viewBox")).toBe("-240 -90 2400 1260");

  vi.advanceTimersByTime(30000);
  document.querySelector('[data-action="warp-editor-retry"]').click();
  const replacement = document.querySelector(".warp-editor-frame");
  expect(replacement).not.toBe(first);
  expect(replacement.style.transform).toBe(fittedTransform);
  expect(overlay.getAttribute("viewBox")).toBe("-240 -90 2400 1260");
  dialog.dispose();
});

test("a ready reply after the deadline cannot revive the timed-out frame", () => {
  vi.useFakeTimers();
  const { dialog, opener } = setup();
  dialog.update(DEFAULT_PROJECTION_CONFIG);
  dialog.open({ side: "left", mode: "grid", opener });
  const frame = document.querySelector("iframe");
  const send = vi.spyOn(frame.contentWindow, "postMessage");
  vi.advanceTimersByTime(30000);
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: frame.contentWindow, data: { type: "otef_projection_preview_ready", output: "left" } }));
  expect(send).not.toHaveBeenCalled();
  expect(document.querySelector('[data-action="warp-editor-retry"]').hidden).toBe(false);
  dialog.dispose();
});

test("failed preview application offers retry for the selected frame", () => {
  const { dialog, opener } = setup();
  dialog.update(DEFAULT_PROJECTION_CONFIG);
  dialog.open({ side: "left", mode: "keystone", opener });
  const frame = document.querySelector("iframe");
  const send = vi.spyOn(frame.contentWindow, "postMessage");
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: frame.contentWindow, data: { type: "otef_projection_preview_ready", output: "left" } }));
  const requestId = send.mock.calls[0][0].requestId;
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: frame.contentWindow, data: { type: "otef_projection_preview_applied", output: "left", requestId, success: false, error: "mesh unavailable" } }));
  expect(document.querySelector(".warp-editor-message").textContent).toContain("mesh unavailable");
  expect(document.querySelector('[data-action="warp-editor-retry"]').hidden).toBe(false);
  dialog.dispose();
});

test("Run names cannot replace the first pending geometry acknowledgement", () => {
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const { dialog, opener } = setup();
  dialog.update(config);
  dialog.open({ side: "left", mode: "keystone", opener });
  const frame = document.querySelector("iframe");
  const send = vi.spyOn(frame.contentWindow, "postMessage");
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: frame.contentWindow,
    data: { type: "otef_projection_preview_ready", output: "left" } }));
  const geometryRequest = send.mock.calls[0][0];
  expect(dialog.sendRunNamesPreview(config)).toBe(false);
  expect(send).toHaveBeenCalledOnce();
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: frame.contentWindow,
    data: { type: "otef_projection_preview_applied", output: "left", requestId: geometryRequest.requestId, success: true } }));
  expect(frame.style.visibility).toBe("visible");
  expect(document.querySelector(".warp-editor-message").textContent).toBe("Current draft");
  dialog.dispose();
});

test("Run names for older applied geometry cannot replace a newer pending draft acknowledgement", () => {
  const appliedConfig = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const pendingConfig = structuredClone(appliedConfig); pendingConfig.pre.tx += 0.01;
  const { dialog, opener } = setup();
  dialog.update(appliedConfig);
  dialog.open({ side: "right", mode: "grid", opener });
  const frame = document.querySelector("iframe");
  const send = vi.spyOn(frame.contentWindow, "postMessage");
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: frame.contentWindow,
    data: { type: "otef_projection_preview_ready", output: "right" } }));
  const firstRequest = send.mock.calls[0][0];
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: frame.contentWindow,
    data: { type: "otef_projection_preview_applied", output: "right", requestId: firstRequest.requestId, success: true } }));
  dialog.update(pendingConfig);
  const latestRequest = send.mock.calls[1][0];
  expect(dialog.sendRunNamesPreview(appliedConfig)).toBe(false);
  expect(send).toHaveBeenCalledTimes(2);
  window.dispatchEvent(new MessageEvent("message", { origin: location.origin, source: frame.contentWindow,
    data: { type: "otef_projection_preview_applied", output: "right", requestId: latestRequest.requestId, success: true } }));
  expect(frame.style.visibility).toBe("visible");
  expect(document.querySelector(".warp-editor-message").textContent).toBe("Current draft");
  dialog.dispose();
});

test("warp controls remain visible without a Fine adjustment toggle", () => {
  const { dialog, opener } = setup();
  dialog.open({ side: "left", mode: "keystone", opener });
  const panel = document.querySelector(".warp-editor-fine-panel");
  expect(panel.hidden).toBe(false);
  expect(document.querySelector('[data-action="warp-editor-fine"]')).toBeNull();
  dialog.close(); dialog.open({ side: "left", mode: "grid", opener });
  expect(panel.hidden).toBe(false);
  dialog.dispose();
});

test("modal contains focus, restores page interaction on Escape, and forwards Apply and Live", () => {
  const onApply = vi.fn(); const onLive = vi.fn();
  const { dialog, host, opener } = setup({ onApply, onLive });
  const background = host.firstElementChild;
  document.body.style.overflow = "auto";
  dialog.open({ side: "left", mode: "keystone", opener });
  expect(background.inert).toBe(true);
  expect(document.body.style.overflow).toBe("hidden");
  const first = document.querySelector('[data-action="warp-editor-close"]');
  expect(document.querySelector('[data-action="projection-names-run"]')).toBeNull();
  const last = document.querySelector('.warp-editor-footer button:not([hidden])');
  first.focus(); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
  expect(document.activeElement).toBe(last);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  expect(document.activeElement).toBe(first);
  Array.from(document.querySelectorAll(".warp-editor-footer button")).find((button) => button.textContent === "Apply once").click();
  expect(onApply).toHaveBeenCalledTimes(1);
  const live = document.querySelector('.warp-editor-footer input[type="checkbox"]');
  live.checked = true; live.dispatchEvent(new Event("change", { bubbles: true }));
  expect(onLive).toHaveBeenCalledWith(true);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(document.querySelector(".warp-editor-dialog").hidden).toBe(true);
  expect(background.inert).not.toBe(true);
  expect(document.body.style.overflow).toBe("auto");
  expect(document.activeElement).toBe(opener);
  dialog.dispose();
});

test("iframe and overlay share the same out-of-bounds viewport fit", () => {
  const { dialog, opener, overlay } = setup();
  const viewport = document.querySelector(".warp-editor-viewport");
  Object.defineProperties(viewport, { clientWidth: { configurable: true, value: 960 }, clientHeight: { configurable: true, value: 540 } });
  dialog.open({ side: "right", mode: "grid", opener });
  dialog.setViewBox({ x: -240, y: -90, width: 2400, height: 1260 });
  expect(document.querySelector("iframe").style.transform).toBe("translate(96px, 54px) scale(0.4)");
  expect(overlay.getAttribute("viewBox")).toBe("-240 -90 2400 1260");
  dialog.dispose();
});

test("fullscreen is requested in the opening gesture and late success exits after close", async () => {
  const { dialog, opener } = setup();
  const modal = document.querySelector(".warp-editor-dialog");
  let resolve;
  const request = vi.fn(() => new Promise((done) => { resolve = done; }));
  modal.requestFullscreen = request;
  const exit = vi.fn(() => Promise.resolve()); document.exitFullscreen = exit;
  dialog.open({ side: "left", mode: "grid", opener });
  expect(request).toHaveBeenCalledTimes(1);
  dialog.close();
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: modal });
  resolve(); await Promise.resolve(); await Promise.resolve();
  expect(exit).toHaveBeenCalledTimes(1);
  dialog.dispose();
  delete document.fullscreenElement;
});

test("late fullscreen success is adopted by a newer session on the same host", async () => {
  const { dialog, opener } = setup();
  const modal = document.querySelector(".warp-editor-dialog");
  let resolve;
  const request = vi.fn(() => new Promise((done) => { resolve = done; }));
  modal.requestFullscreen = request;
  const exit = vi.fn(() => Promise.resolve()); document.exitFullscreen = exit;
  dialog.open({ side: "left", mode: "grid", opener });
  dialog.close(); dialog.open({ side: "right", mode: "grid", opener });
  expect(request).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: modal });
  resolve(); await Promise.resolve(); await Promise.resolve();
  expect(exit).not.toHaveBeenCalled();
  dialog.close(); expect(exit).toHaveBeenCalledTimes(1);
  dialog.dispose();
  delete document.fullscreenElement;
});

test("closing owned fullscreen restores opener focus after exit settles", async () => {
  const { dialog, opener } = setup();
  const modal = document.querySelector(".warp-editor-dialog");
  let finishRequest;
  modal.requestFullscreen = () => new Promise((resolve) => { finishRequest = resolve; });
  let finishExit;
  document.exitFullscreen = vi.fn(() => new Promise((resolve) => { finishExit = resolve; }));
  dialog.open({ side: "left", mode: "keystone", opener });
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: modal });
  finishRequest();
  await Promise.resolve(); await Promise.resolve();
  dialog.close();
  document.body.tabIndex = -1; document.body.focus();
  finishExit(); await Promise.resolve(); await Promise.resolve();
  expect(document.activeElement).toBe(opener);
  dialog.dispose(); delete document.fullscreenElement;
});

test("late fullscreen success after Close does not exit another element's fullscreen", async () => {
  const { dialog, opener } = setup();
  const modal = document.querySelector(".warp-editor-dialog");
  let finishRequest;
  modal.requestFullscreen = () => new Promise((resolve) => { finishRequest = resolve; });
  const exit = vi.fn(() => Promise.resolve()); document.exitFullscreen = exit;
  dialog.open({ side: "left", mode: "grid", opener });
  dialog.close();
  const other = document.createElement("div"); other.tabIndex = 0; document.body.append(other); other.focus();
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: other });
  finishRequest(); await Promise.resolve(); await Promise.resolve();
  expect(exit).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(other);
  dialog.dispose(); delete document.fullscreenElement;
});

test("an old fullscreen exit cannot return focus during a newer editor session", async () => {
  const { dialog, opener } = setup();
  const modal = document.querySelector(".warp-editor-dialog");
  let finishRequest;
  modal.requestFullscreen = () => new Promise((resolve) => { finishRequest = resolve; });
  let finishExit;
  document.exitFullscreen = () => new Promise((resolve) => { finishExit = resolve; });
  dialog.open({ side: "left", mode: "grid", opener });
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: modal });
  finishRequest(); await Promise.resolve(); await Promise.resolve();
  dialog.close();
  dialog.open({ side: "right", mode: "grid", opener });
  const currentFocus = document.activeElement;
  finishExit(); await Promise.resolve(); await Promise.resolve();
  expect(document.activeElement).toBe(currentFocus);
  dialog.dispose(); delete document.fullscreenElement;
});

test("fullscreen denial retains the viewport dialog", async () => {
  const { dialog, opener } = setup();
  const modal = document.querySelector(".warp-editor-dialog");
  modal.requestFullscreen = () => Promise.reject(new Error("denied"));
  dialog.open({ side: "left", mode: "keystone", opener });
  await Promise.resolve(); await Promise.resolve();
  expect(modal.hidden).toBe(false);
  expect(document.querySelectorAll("iframe")).toHaveLength(1);
  dialog.dispose();
});

test("close detaches the active bridge listener and reopening installs one listener", () => {
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const { dialog, opener } = setup();
  dialog.open({ side: "left", mode: "keystone", opener });
  const bridge = add.mock.calls.find(([type]) => type === "message")?.[1];
  expect(bridge).toBeTypeOf("function");
  dialog.close();
  expect(remove).toHaveBeenCalledWith("message", bridge);
  dialog.open({ side: "right", mode: "grid", opener });
  expect(add.mock.calls.filter(([type]) => type === "message")).toHaveLength(2);
  dialog.dispose(); add.mockRestore(); remove.mockRestore();
});
