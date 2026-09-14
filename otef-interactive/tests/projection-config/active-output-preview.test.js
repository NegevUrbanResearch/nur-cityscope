import { expect, test, vi } from "vitest";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { createActiveOutputPreview } from "../../frontend/src/projection-config/active-output-preview.js";

function element(width = 260) {
  return {
    children: [], style: {}, clientWidth: width, textContent: "",
    appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((child) => child !== this); },
    addEventListener() {},
    setAttribute() {},
  };
}

test("one output frame receives latest local draft only after its trusted ready message", () => {
  const listeners = new Map();
  const win = { location: { origin: "http://localhost" }, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const frames = [];
  const document = { defaultView: win, createElement: (tag) => {
    const node = element();
    if (tag === "iframe") { node.contentWindow = { postMessage: vi.fn() }; frames.push(node); }
    return node;
  } };
  const hosts = new Map([["left", element()], ["right", element()]]);
  const preview = createActiveOutputPreview({ document, hosts, mobileHost: element(), mobileQuery: { matches: false, addEventListener() {}, removeEventListener() {} } });
  const draft = structuredClone(DEFAULT_PROJECTION_CONFIG);
  preview.update(draft);
  preview.show("left");
  expect(frames[0].src).toContain("span=left&preview=1&mapPixelRatio=1");
  expect(frames[0].contentWindow.postMessage).not.toHaveBeenCalled();
  const ready = { type: "otef_projection_preview_ready", output: "left" };
  listeners.get("message")({ source: {}, origin: "http://localhost", data: ready });
  listeners.get("message")({ source: frames[0].contentWindow, origin: "http://other", data: ready });
  expect(frames[0].contentWindow.postMessage).not.toHaveBeenCalled();
  listeners.get("message")({ source: frames[0].contentWindow, origin: "http://localhost", data: ready });
  expect(frames[0].contentWindow.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "otef_projection_preview_config", output: "left", config: draft }), "http://localhost");
  draft.pre.tx = 0.02;
  preview.update(draft); // Local draft changes send even when the editor's Live switch is off.
  expect(frames[0].contentWindow.postMessage).toHaveBeenCalledTimes(2);
  preview.show("right");
  expect(frames).toHaveLength(2);
  expect(hosts.get("left").children).toHaveLength(0);
  preview.dispose();
  expect(listeners.has("message")).toBe(false);
});
