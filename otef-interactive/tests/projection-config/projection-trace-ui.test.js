import { expect, test, vi } from "vitest";
import { createProjectionTraceUi } from "../../frontend/src/projection-config/projection-trace-ui.js";

function find(root, predicate) {
  return [root, ...(root.children || []).flatMap(function walk(node) { return [node, ...(node.children || []).flatMap(walk)]; })].find(predicate);
}

function documentHarness() {
  const doc = {
    createElement(tag) {
      const node = {
        tagName: tag.toUpperCase(), children: [], attributes: {}, style: {}, listeners: {}, textContent: "",
        setAttribute(key, value) { this.attributes[key] = value; },
        getAttribute(key) { return this.attributes[key] ?? null; },
        append(...children) { children.forEach((child) => this.appendChild(child)); },
        appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
        addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
        dispatchEvent(event) { for (const listener of this.listeners[event.type] || []) listener(event); return true; },
        click() { this.dispatchEvent(new Event("click")); },
        remove() { this.parentElement?.children.splice(this.parentElement.children.indexOf(this), 1); },
      };
      node.ownerDocument = doc;
      return node;
    },
    body: { appendChild() {} },
    defaultView: { navigator: {} },
  };
  return doc;
}

test("trace status UI is accessible, reflects delivery state, and exposes stop/copy/export actions", async () => {
  const doc = documentHarness();
  const trace = {
    getStatus: () => ({ recording: true, connected: true, queued: 3, pending: 1, acknowledged: 4, dropped: 2, sessionId: "123e4567-e89b-42d3-a456-426614174000" }),
    subscribe(listener) { this.listener = listener; listener(this.getStatus()); return () => { this.unsubscribed = true; }; },
    stop: vi.fn(), exportJson: vi.fn(() => '{"events":[]}'),
  };
  const ui = createProjectionTraceUi({ document: doc, trace });
  const liveStatus = find(ui.element, (node) => node.getAttribute?.("role") === "status");
  expect(liveStatus.getAttribute("aria-live")).toBe("polite");
  expect(liveStatus.textContent).toMatch(/4 PC acknowledged/i);
  expect(liveStatus.textContent).toMatch(/3 queued/i);
  const stop = find(ui.element, (node) => node.textContent === "Stop tracing");
  const copy = find(ui.element, (node) => node.textContent === "Copy trace");
  const exportButton = find(ui.element, (node) => node.textContent === "Export trace");
  stop.click();
  expect(trace.stop).toHaveBeenCalledOnce();
  expect(copy).toBeTruthy(); expect(exportButton).toBeTruthy();
  copy.dispatchEvent({ type: "click" });
  expect(trace.exportJson).toHaveBeenCalled();
  trace.listener({ ...trace.getStatus(), recording: false, connected: false, queued: 0, pending: 0 });
  expect(liveStatus.textContent).toMatch(/stopped/i);
  ui.dispose();
  expect(trace.unsubscribed).toBe(true);
});
