import { expect, test, vi } from "vitest";
import { initPrintableQr } from "../../frontend/src/entries/qr-main.js";

function makeDocument() {
  const nodes = new Map();
  const node = (id) => {
    const value = { id, textContent: "", children: [], replaceChildren(...children) { this.children = children; } };
    nodes.set(id, value);
    return value;
  };
  node("targetUrl"); node("qrcode"); node("shareStatus");
  const document = { hidden: false, listeners: new Map(), createElementNS(_namespace, name) { return { nodeName: name, attributes: {}, children: [], setAttribute(key, value) { this.attributes[key] = String(value); }, appendChild(child) { this.children.push(child); } }; }, getElementById: (id) => nodes.get(id), addEventListener(type, cb) { this.listeners.set(type, cb); }, removeEventListener(type) { this.listeners.delete(type); }, nodes };
  nodes.get("qrcode").ownerDocument = document;
  return document;
}

function clockHarness() {
  let next = 0;
  const timers = new Map();
  return { setTimeout(callback) { const id = ++next; timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); }, timers };
}

const metadata = (origin, generatedAt = "2026-09-13T10:00:00.000Z") => ({ version: 1, remoteOrigin: origin, generatedAt, status: "ready" });

test("printable QR refreshes on focus, clears stale/unavailable output, and disposes late work", async () => {
  const document = makeDocument();
  const pending = [];
  const fetchImpl = vi.fn(() => new Promise((resolve) => pending.push(resolve)));
  const clock = clockHarness();
  const listeners = new Map();
  vi.stubGlobal("addEventListener", (type, callback) => listeners.set(type, callback));
  vi.stubGlobal("removeEventListener", (type) => listeners.delete(type));
  const dispose = initPrintableQr({ document, location: new URL("http://localhost:8500/qr.html"), fetchImpl, now: () => Date.parse("2026-09-13T10:00:00.000Z"), clock });
  pending[0]({ ok: true, json: () => Promise.resolve(metadata("http://192.0.2.10:8500")) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.nodes.get("targetUrl").textContent).toContain("192.0.2.10");
  expect(clock.timers.size).toBe(1);
  await listeners.get("focus")();
  pending[1]({ ok: true, json: () => Promise.resolve(metadata("http://192.0.2.11:8500", "2026-09-13T09:58:00.000Z")) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.nodes.get("targetUrl").textContent).toBe("—");
  expect(document.nodes.get("shareStatus").textContent).toBe("Network address unavailable.");
  expect(document.nodes.get("qrcode").children).toHaveLength(0);
  await listeners.get("focus")();
  expect(pending).toHaveLength(3);
  dispose();
  expect(clock.timers.size).toBe(0);
  const before = document.nodes.get("targetUrl").textContent;
  pending[2]({ ok: true, json: () => Promise.resolve(metadata("http://192.0.2.12:8500")) });
  expect(document.nodes.get("targetUrl").textContent).toBe(before);
  vi.unstubAllGlobals();
});
