import { expect, test, vi } from "vitest";
import { mountClockLayoutPreview } from "../../frontend/src/projection-config/clock-layout-preview.js";

function harness() {
  const listeners = new Map();
  const makeElement = (tag) => ({
    tagName: tag.toUpperCase(), children: [], style: {}, attributes: {},
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
    remove() { this.removed = true; },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(type, handler) { (this.listeners ||= {})[type] = [...(this.listeners?.[type] || []), handler]; },
    removeEventListener(type, handler) { this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== handler); },
  });
  const win = {
    location: { href: "http://localhost/otef-interactive/projection-config.html", origin: "http://localhost" },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
    dispatch(type, event) { listeners.get(type)?.(event); },
  };
  const doc = { defaultView: win, createElement: makeElement };
  const container = makeElement("section");
  container.ownerDocument = doc;
  return { win, container };
}

test("clock preview accepts only the active frame session and latest rendered request", () => {
  const { win, container } = harness();
  const onRendered = vi.fn();
  const preview = mountClockLayoutPreview({ container, surface: "gis", sessionId: "session-a", onRendered });
  const frame = container.children[0];
  const sent = [];
  frame.contentWindow = { postMessage: (message, origin) => sent.push({ message, origin }) };
  const scene = { surface: "gis", sceneId: "nova", output: null, element: "clock", clockLayout: { leftPct: 1, topPct: 2, widthPct: 20, heightPct: 20, fontPx: 22, rotateDeg: 0 }, legendLayout: null, pageIndex: 0 };
  preview.setState(scene);
  win.dispatch("message", { origin: win.location.origin, source: {}, data: { type: "otef_clock_preview_ready", sessionId: "session-a", surface: "gis", output: null } });
  expect(sent).toHaveLength(0);
  win.dispatch("message", { origin: win.location.origin, source: frame.contentWindow, data: { type: "otef_clock_preview_ready", sessionId: "session-a", surface: "gis", output: null } });
  expect(sent).toHaveLength(1);
  const request = sent[0].message;
  expect(request).toMatchObject({ type: "otef_clock_preview_state", sessionId: "session-a", requestId: 1, sceneId: "nova" });
  win.dispatch("message", { origin: win.location.origin, source: frame.contentWindow, data: { type: "otef_clock_preview_rendered", sessionId: "session-a", requestId: 0, surface: "gis", sceneId: "nova", output: null, mesh: null, meshIdentity: null, pageIndex: 0, pageCount: 1 } });
  expect(onRendered).not.toHaveBeenCalled();
  win.dispatch("message", { origin: win.location.origin, source: frame.contentWindow, data: { type: "otef_clock_preview_rendered", sessionId: "session-a", requestId: 1, surface: "gis", sceneId: "nova", output: null, mesh: null, meshIdentity: null, pageIndex: 0, pageCount: 1 } });
  expect(onRendered).toHaveBeenCalledWith(expect.objectContaining({ sceneId: "nova", pageCount: 1 }));
  preview.destroy();
});

test("reload rejects ready and rendered messages from the previous frame", () => {
  const { win, container } = harness();
  const onRendered = vi.fn();
  const preview = mountClockLayoutPreview({ container, surface: "gis", sessionId: "session-old", onRendered });
  const oldFrame = container.children[0];
  oldFrame.contentWindow = { postMessage: vi.fn() };
  preview.reload();
  const activeFrame = container.children[1];
  activeFrame.contentWindow = { postMessage: vi.fn() };
  const staleEvent = (data) => win.dispatch("message", { origin: win.location.origin, source: oldFrame.contentWindow, data });
  staleEvent({ type: "otef_clock_preview_ready", sessionId: "session-old", surface: "gis", output: null });
  staleEvent({ type: "otef_clock_preview_rendered", sessionId: "session-old", requestId: 1, surface: "gis", sceneId: "nova", output: null, mesh: null, meshIdentity: null, pageIndex: 0, pageCount: 1 });
  expect(activeFrame.contentWindow.postMessage).not.toHaveBeenCalled();
  expect(onRendered).not.toHaveBeenCalled();
  preview.destroy();
});

test.each(["bootstrap", "render", "iframe"])("%s failure reports unavailable and reload gives a fresh recoverable session", async (failure) => {
  vi.useFakeTimers();
  const { win, container } = harness();
  const onError = vi.fn(); const onRendered = vi.fn();
  const preview = mountClockLayoutPreview({ container, surface: "gis", sessionId: "timed", onError, onRendered });
  const frame = container.children[0]; frame.contentWindow = { postMessage: vi.fn() };
  preview.setState({ surface: "gis", sceneId: "home", output: null, clockLayout: { leftPct: 8, topPct: 8, widthPct: 35, heightPct: 28, fontPx: 22, rotateDeg: 0 }, legendLayout: null, pageIndex: 0 });
  if (failure === "render") win.dispatch("message", { origin: win.location.origin, source: frame.contentWindow, data: { type: "otef_clock_preview_ready", sessionId: "timed", surface: "gis", output: null } });
  if (failure === "iframe") frame.listeners.error[0]();
  else await vi.advanceTimersByTimeAsync(30000);
  expect(onError).toHaveBeenCalledTimes(1);
  preview.reload();
  const fresh = container.children[1]; fresh.contentWindow = { postMessage: vi.fn() };
  const sessionId = new URL(fresh.src).searchParams.get("previewSession");
  expect(sessionId).not.toBe("timed");
  win.dispatch("message", { origin: win.location.origin, source: fresh.contentWindow, data: { type: "otef_clock_preview_ready", sessionId, surface: "gis", output: null } });
  expect(fresh.contentWindow.postMessage).toHaveBeenCalledWith(expect.objectContaining({ sceneId: "home" }), win.location.origin);
  preview.destroy(); vi.useRealTimers();
});

test("projection validates and defensively copies meshes; malformed active replies fail without throwing", () => {
  const { win, container } = harness(); const onRendered = vi.fn(); const onError = vi.fn();
  const preview = mountClockLayoutPreview({ container, surface: "projection", sessionId: "projection", onRendered, onError });
  const frame = container.children[0]; frame.contentWindow = { postMessage: vi.fn() };
  const layout = { leftPct: 8, topPct: 8, widthPct: 35, heightPct: 28, fontPx: 22, rotateDeg: 0 };
  preview.setState({ surface: "projection", sceneId: "home", output: "left", element: "clock", clockLayout: layout, legendLayout: { ...layout, dwellSeconds: 8 }, pageIndex: 0 });
  const dispatch = (data) => win.dispatch("message", { origin: win.location.origin, source: frame.contentWindow, data: { sessionId: "projection", ...data } });
  dispatch({ type: "otef_clock_preview_ready", surface: "projection", output: "left" });
  const mesh = { width: 1920, height: 1080, vertices: [{ u: 0, v: 0, x: 0, y: 0 }, { u: 1, v: 0, x: 1920, y: 0 }, { u: 0, v: 1, x: 0, y: 1080 }], triangles: [0, 1, 2] };
  const rendered = { type: "otef_clock_preview_rendered", requestId: 1, surface: "projection", sceneId: "home", output: "left", pageIndex: 0, pageCount: 1, meshIdentity: "mesh-1", mesh };
  dispatch(rendered);
  expect(onRendered).toHaveBeenCalledTimes(1);
  expect(onRendered.mock.calls[0][0].mesh).not.toBe(mesh);
  expect(() => dispatch({ ...rendered, mesh: { ...mesh, vertices: [{ u: NaN }] } })).not.toThrow();
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onRendered).toHaveBeenCalledTimes(1);
  preview.destroy();
});
