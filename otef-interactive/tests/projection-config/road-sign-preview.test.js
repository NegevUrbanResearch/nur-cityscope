import { expect, test, vi } from "vitest";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { emptyRoadSignSettings } from "../../frontend/src/shared/road-sign-settings.js";
import { mountRoadSignPreview } from "../../frontend/src/projection-config/road-sign-preview.js";

const mesh = { width: 1920, height: 1080, vertices: [
  { u: 0, v: 0, x: 0, y: 0 }, { u: 1, v: 0, x: 1, y: 0 }, { u: 1, v: 1, x: 1, y: 1 }, { u: 0, v: 1, x: 0, y: 1 },
], triangles: [0, 1, 2, 0, 2, 3] };

function harness() {
  const listeners = new Map();
  const makeElement = (tag) => ({ tagName: tag.toUpperCase(), children: [], style: {}, className: "",
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
    replaceChildren(...children) { this.children = []; children.forEach((child) => this.appendChild(child)); },
    remove() { this.removed = true; this.parentElement && (this.parentElement.children = this.parentElement.children.filter((child) => child !== this)); },
    setAttribute() {}, addEventListener(type, handler) { (this.handlers ||= {})[type] = handler; },
    removeEventListener(type, handler) { if (this.handlers?.[type] === handler) delete this.handlers[type]; },
  });
  const win = { location: { href: "http://example.test/frontend/projection-config.html", origin: "http://example.test" },
    addEventListener(type, fn) { listeners.set(type, fn); }, removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    dispatch(event) { listeners.get("message")?.(event); } };
  const doc = { defaultView: win, createElement: makeElement };
  const container = makeElement("div"); container.ownerDocument = doc;
  return { win, container };
}

function ready(win, frame, sessionId, output) {
  win.dispatch({ origin: win.location.origin, source: frame.contentWindow,
    data: { type: "otef_road_sign_preview_ready", sessionId, output } });
}

test("GIS placement uses a Home GIS frame and switching back retains projection routing", () => {
  const { win, container } = harness();
  container.clientWidth = 960; container.clientHeight = 540;
  const onRendered = vi.fn();
  const preview = mountRoadSignPreview({ container, output: "gis", onRendered });
  const frame = container.children[0], posted = [];
  expect(frame.style.width).toBe("1920px");
  expect(frame.style.height).toBe("1080px");
  expect(frame.style.transform).toBe("scale(0.5)");
  frame.contentWindow = { postMessage: message => posted.push(message) };
  const url = new URL(frame.src);
  expect(url.pathname).toBe("/frontend/index.html");
  expect(url.searchParams.has("span")).toBe(false);
  expect(url.searchParams.has("outputMode")).toBe(false);
  const settings = { ...emptyRoadSignSettings(), outputs: { left: [], right: [], gis: [] } };
  preview.setState({ settings, config: structuredClone(DEFAULT_PROJECTION_CONFIG), calibrationRevision: 7 });
  ready(win, frame, url.searchParams.get("previewSession"), "gis");
  expect(posted[0]).toMatchObject({ output: "gis", sceneId: "home", settings });
  win.dispatch({ origin: win.location.origin, source: frame.contentWindow, data: {
    type: "otef_road_sign_preview_rendered", sessionId: posted[0].sessionId, output: "gis", requestId: 1,
    calibrationRevision: 7, meshIdentity: "gis", mesh,
  } });
  expect(onRendered).toHaveBeenCalledOnce();
  preview.setOutput("right");
  const projectionUrl = new URL(container.children[0].src);
  expect(container.children[0].style.transform).toBeUndefined();
  expect(projectionUrl.pathname).toBe("/frontend/projection.html");
  expect(projectionUrl.searchParams.get("span")).toBe("right");
  expect(projectionUrl.searchParams.get("outputMode")).toBe("browser");
  preview.dispose();
});

test("sends only the current acknowledged-calibration request and accepts its drawn mesh receipt", () => {
  const { win, container } = harness();
  const onRendered = vi.fn(), onError = vi.fn();
  const preview = mountRoadSignPreview({ container, output: "left", onRendered, onError });
  const frame = container.children[0], posted = [];
  frame.contentWindow = { postMessage: (message, origin) => posted.push({ message, origin }) };
  expect(frame.src).toContain("roadSignsPreview=1");
  expect(frame.src).toContain("span=left");
  expect(frame.src).toContain("outputMode=browser");
  const settings = emptyRoadSignSettings();
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  preview.setState({ settings, config, calibrationRevision: 7 });
  ready(win, frame, new URL(frame.src).searchParams.get("previewSession"), "left");
  expect(posted).toHaveLength(1);
  expect(posted[0].message).toMatchObject({ type: "otef_road_sign_preview_state", output: "left", calibrationRevision: 7, config });
  const sessionId = posted[0].message.sessionId;
  const reply = { type: "otef_road_sign_preview_rendered", sessionId, output: "left", requestId: 1,
    calibrationRevision: 7, meshIdentity: "mesh:7", mesh };
  win.dispatch({ origin: win.location.origin, source: frame.contentWindow, data: { ...reply, requestId: 0 } });
  expect(onRendered).not.toHaveBeenCalled();
  win.dispatch({ origin: win.location.origin, source: frame.contentWindow, data: reply });
  expect(onRendered).toHaveBeenCalledWith(expect.objectContaining({ meshIdentity: "mesh:7", calibrationRevision: 7 }));
  const nextConfig = structuredClone(config); nextConfig.outputs.left.post.tx = 0.01;
  preview.setState({ settings, config: nextConfig, calibrationRevision: 8 });
  expect(onRendered).toHaveBeenCalledTimes(1);
  preview.dispose();
  expect(container.children).toHaveLength(0);
});

test("rejects replies from the wrong source or origin and invalid mesh data", () => {
  const { win, container } = harness();
  const onRendered = vi.fn(), onError = vi.fn();
  const preview = mountRoadSignPreview({ container, output: "right", onRendered, onError });
  const frame = container.children[0]; frame.contentWindow = { postMessage: vi.fn() };
  preview.setState({ settings: emptyRoadSignSettings(), config: structuredClone(DEFAULT_PROJECTION_CONFIG), calibrationRevision: 3 });
  const sessionId = new URL(frame.src).searchParams.get("previewSession");
  ready(win, frame, sessionId, "right");
  const data = { type: "otef_road_sign_preview_rendered", sessionId, output: "right", requestId: 1,
    calibrationRevision: 3, meshIdentity: "mesh", mesh: { ...mesh, triangles: [0, 99, 2] } };
  win.dispatch({ origin: "http://evil.test", source: frame.contentWindow, data });
  win.dispatch({ origin: win.location.origin, source: {}, data });
  win.dispatch({ origin: win.location.origin, source: frame.contentWindow, data });
  expect(onRendered).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalled();
  preview.dispose();
});

test("refresh replaces the preview session and ignores receipts from the retired iframe", () => {
  const { win, container } = harness();
  const onRendered = vi.fn();
  const preview = mountRoadSignPreview({ container, output: "left", onRendered });
  const oldFrame = container.children[0], oldPosted = [];
  oldFrame.contentWindow = { postMessage: (message) => oldPosted.push(message) };
  const settings = emptyRoadSignSettings(), config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  preview.setState({ settings, config, calibrationRevision: 2 });
  const oldSession = new URL(oldFrame.src).searchParams.get("previewSession");
  ready(win, oldFrame, oldSession, "left");
  const oldRequest = oldPosted.at(-1);
  win.dispatch({ origin: win.location.origin, source: oldFrame.contentWindow, data: {
    type: "otef_road_sign_preview_rendered", sessionId: oldSession, output: "left", requestId: oldRequest.requestId,
    calibrationRevision: 2, meshIdentity: "old", mesh,
  } });
  expect(onRendered).toHaveBeenCalledTimes(1);

  preview.refresh();
  const currentFrame = container.children[0], currentSession = new URL(currentFrame.src).searchParams.get("previewSession");
  expect(oldFrame.removed).toBe(true);
  expect(currentFrame).not.toBe(oldFrame);
  expect(currentSession).not.toBe(oldSession);
  expect(container.children).toEqual([currentFrame]);
  const currentPosted = [];
  currentFrame.contentWindow = { postMessage: (message) => currentPosted.push(message) };
  ready(win, currentFrame, currentSession, "left");
  const currentRequest = currentPosted.at(-1);
  win.dispatch({ origin: win.location.origin, source: currentFrame.contentWindow, data: {
    type: "otef_road_sign_preview_rendered", sessionId: currentSession, output: "left", requestId: currentRequest.requestId,
    calibrationRevision: 2, meshIdentity: "fresh", mesh,
  } });
  expect(onRendered).toHaveBeenCalledTimes(2);
  expect(onRendered.mock.calls.at(-1)[0]).toMatchObject({ sessionId: currentSession, meshIdentity: "fresh" });
  win.dispatch({ origin: win.location.origin, source: oldFrame.contentWindow, data: {
    type: "otef_road_sign_preview_rendered", sessionId: oldSession, output: "left", requestId: oldRequest.requestId,
    calibrationRevision: 2, meshIdentity: "stale", mesh,
  } });
  expect(onRendered).toHaveBeenCalledTimes(2);
  preview.dispose();
});
test("calibration and source-output changes replace one iframe and rotate its session", () => {
  const { win, container } = harness();
  const preview = mountRoadSignPreview({ container, output: "left" });
  const oldFrame = container.children[0], oldSession = new URL(oldFrame.src).searchParams.get("previewSession");
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  preview.setState({ settings: emptyRoadSignSettings(), config, calibrationRevision: 2 });
  const accepted = structuredClone(config); accepted.outputs.left.post.tx = 0.01;
  preview.setState({ settings: emptyRoadSignSettings(), config: accepted, calibrationRevision: 3 });
  const calibratedFrame = container.children[0];
  const calibrationSession = new URL(calibratedFrame.src).searchParams.get("previewSession");
  expect(oldFrame.removed).toBe(true);
  expect(calibrationSession).not.toBe(oldSession);
  preview.setOutput("right");
  expect(container.children).toHaveLength(1);
  expect(container.children[0].src).toContain("span=right");
  expect(new URL(container.children[0].src).searchParams.get("previewSession")).not.toBe(calibrationSession);
  preview.dispose();
});

test("rejects malformed state and reports a loading timeout; disposal removes its iframe", () => {
  vi.useFakeTimers();
  const { container } = harness();
  const onError = vi.fn();
  const preview = mountRoadSignPreview({ container, output: "left", onError });
  expect(() => preview.setState({ settings: { version: 1 }, config: structuredClone(DEFAULT_PROJECTION_CONFIG), calibrationRevision: 1 })).toThrow(/Invalid Road 232 preview state/);
  vi.advanceTimersByTime(30000);
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/timed out/) }), expect.objectContaining({ requestId: 0 }));
  const frame = container.children[0];
  preview.dispose();
  expect(frame.removed).toBe(true);
  expect(container.children).toHaveLength(0);
  vi.useRealTimers();
});
