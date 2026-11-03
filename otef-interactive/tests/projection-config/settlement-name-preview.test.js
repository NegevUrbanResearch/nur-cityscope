import { expect, test, vi } from "vitest";
import { mountSettlementNamePreview } from "../../frontend/src/projection-config/settlement-name-preview.js";

const settings = () => ({
  baseline: {
    captureId: "fixture-settlement-name", captureDigest: "a".repeat(64), sourceDigest: "b".repeat(64), catalogDigest: "c".repeat(64),
    predecessor: { revision: 1, configDigest: "d".repeat(64) }, successor: { revision: 2, configDigest: "e".repeat(64) },
    outputs: { left: { "0067": { x: 510, y: 350 } }, right: { "0067": { x: 1200, y: 350 } } },
  },
  style: { fontFamily: "Guttman Hatzvi", fontPx: 14, rotateDeg: 35 },
  outputs: { left: {}, right: {} },
});

const mesh = { width: 1920, height: 1080, vertices: [
  { u: 0, v: 0, x: 0, y: 0 }, { u: 1, v: 0, x: 1, y: 0 }, { u: 1, v: 1, x: 1, y: 1 }, { u: 0, v: 1, x: 0, y: 1 },
], triangles: [0, 1, 2, 0, 2, 3] };

function harness() {
  const listeners = new Map();
  const makeElement = (tag) => ({
    tagName: tag.toUpperCase(), children: [], style: {}, attributes: {}, className: "",
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
    replaceChildren(...children) { this.children = []; children.forEach((child) => this.appendChild(child)); },
    remove() { this.removed = true; this.parentElement && (this.parentElement.children = this.parentElement.children.filter((child) => child !== this)); },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(type, handler) { (this.listeners ||= {})[type] = [...(this.listeners[type] || []), handler]; },
    removeEventListener(type, handler) { this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== handler); },
    dispatch(type) { for (const handler of this.listeners?.[type] || []) handler(); },
  });
  const win = {
    location: { href: "http://127.0.0.1:5173/frontend/projection-config.html", origin: "http://127.0.0.1:5173" },
    addEventListener(type, handler) { listeners.set(type, handler); },
    removeEventListener(type, handler) { if (listeners.get(type) === handler) listeners.delete(type); },
    dispatch(type, event) { listeners.get(type)?.(event); },
  };
  const doc = { defaultView: win, createElement: makeElement };
  const container = makeElement("section");
  container.ownerDocument = doc;
  return { win, container };
}

function ready(win, frame, sessionId, output) {
  win.dispatch("message", { origin: win.location.origin, source: frame.contentWindow, data: { type: "otef_settlement_preview_ready", sessionId, output } });
}

test.each(["left", "right"])("settlement preview keeps a 16:9 %s frame and rejects a stale rendered request", (output) => {
  const { win, container } = harness();
  const onRendered = vi.fn();
  const preview = mountSettlementNamePreview({ container, output, sessionId: "session-a", onRendered });
  const frame = container.children[0];
  const sent = [];
  frame.contentWindow = { postMessage: (message, origin) => sent.push({ message, origin }) };
  expect(frame.src).toContain("settlementPreview=1");
  expect(frame.src).toContain(`span=${output}`);
  expect(frame.src).toContain("outputMode=browser");
  expect(frame.src).toContain("previewSession=session-a");
  expect(frame.className).toContain("settlement-preview-frame");
  preview.setState({ settings: settings(), selectedCitycode: "0067" });
  win.dispatch("message", { origin: "http://evil.example", source: frame.contentWindow, data: { type: "otef_settlement_preview_ready", sessionId: "session-a", output } });
  expect(sent).toHaveLength(0);
  ready(win, frame, "session-a", output);
  expect(sent[0].message).toMatchObject({ type: "otef_settlement_preview_state", sessionId: "session-a", requestId: 1, output, selectedCitycode: "0067" });
  expect(sent[0].origin).toBe(win.location.origin);
  const reply = { type: "otef_settlement_preview_rendered", sessionId: "session-a", output, calibrationRevision: 4, meshIdentity: "mesh-1", mesh, labels: [], warnings: { clipped: false, overlap: false, outOfView: false, mapping: "complete" } };
  win.dispatch("message", { origin: win.location.origin, source: frame.contentWindow, data: { ...reply, requestId: 0 } });
  expect(onRendered).not.toHaveBeenCalled();
  win.dispatch("message", { origin: win.location.origin, source: frame.contentWindow, data: { ...reply, requestId: 1 } });
  expect(onRendered).toHaveBeenCalledWith(expect.objectContaining({ requestId: 1, output, meshIdentity: "mesh-1" }));
  preview.setState({ settings: settings(), selectedCitycode: "0067" });
  win.dispatch("message", { origin: win.location.origin, source: frame.contentWindow, data: { ...reply, requestId: 1 } });
  expect(onRendered).toHaveBeenCalledTimes(1);
  preview.destroy();
  expect(frame.removed).toBe(true);
  expect(container.children).toHaveLength(0);
});

test("reload starts a new session and ignores the previous frame", () => {
  const { win, container } = harness();
  const onRendered = vi.fn();
  const preview = mountSettlementNamePreview({ container, output: "left", sessionId: "old", onRendered });
  preview.setState({ settings: settings(), selectedCitycode: "0067" });
  const oldFrame = container.children[0];
  oldFrame.contentWindow = { postMessage: vi.fn() };
  preview.reload({ output: "right" });
  const active = container.children.at(-1);
  expect(active.src).toContain("span=right");
  expect(active.src).not.toContain("previewSession=old");
  active.contentWindow = { postMessage: vi.fn() };
  const session = new URL(active.src).searchParams.get("previewSession");
  win.dispatch("message", { origin: win.location.origin, source: oldFrame.contentWindow, data: { type: "otef_settlement_preview_ready", sessionId: "old", output: "left" } });
  expect(active.contentWindow.postMessage).not.toHaveBeenCalled();
  ready(win, active, session, "right");
  expect(active.contentWindow.postMessage).toHaveBeenCalledWith(expect.objectContaining({ output: "right", sessionId: session }), win.location.origin);
  preview.destroy();
});

test.each([[1,1,1,1,0,0],[NaN,0,0,1,0,0],[1,0,0]].map(matrix=>[matrix]))('rejects an unusable position matrix: %j', positionMatrix => {
  const {win,container}=harness(); const onRendered=vi.fn(),onError=vi.fn();
  const preview=mountSettlementNamePreview({container,output:'left',sessionId:'session-a',onRendered,onError});
  preview.setState({settings:settings(),selectedCitycode:'0067'});
  const frame=container.children[0]; frame.contentWindow={postMessage:vi.fn()};
  ready(win,frame,'session-a','left');
  win.dispatch('message',{origin:win.location.origin,source:frame.contentWindow,data:{type:'otef_settlement_preview_rendered',sessionId:'session-a',output:'left',requestId:1,calibrationRevision:4,meshIdentity:'mesh',mesh,labels:[],positionMatrix}});
  expect(onRendered).not.toHaveBeenCalled();
  preview.destroy();
});
