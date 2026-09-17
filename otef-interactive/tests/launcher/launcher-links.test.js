import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import { allowsLoopbackRemoteFallback, initLauncher } from "../../frontend/src/entries/launcher-main.js";

const read = (file) => fs.readFileSync(path.resolve(__dirname, "../../frontend", file), "utf8");

test("launcher includes all local entries and the shared remote resolver entry", () => {
  const html = read("launcher.html");
  const main = read("src/entries/launcher-main.js");
  for (const pathname of [
    "index.html",
    "remote-controller.html",
    "nli-staff-remote.html",
    "projection.html",
    "projection-config.html",
    "curation.html",
  ]) expect(main).toContain(pathname);
  expect(main).toContain("projection.html?span=left");
  expect(main).toContain("projection.html?span=right");
  expect(html).toContain('src="./src/entries/launcher-main.js"');
  expect(html).not.toContain("qrcodejs");
});

test("launcher exposes remote open/copy/QR controls and required mobile copy", () => {
  const html = read("launcher.html");
  expect(html).toMatch(/id=["']remoteOpen["'][^>]*target=["']_blank["'][^>]*rel=["']noopener["'][^>]*aria-disabled=["']true["']/);
  expect(html).toMatch(/id=["']staffRemoteOpen["'][^>]*target=["']_blank["'][^>]*rel=["']noopener["'][^>]*aria-disabled=["']true["']/);
  expect(html).toContain('id="remoteCopy"');
  expect(html).toContain('id="staffRemoteOpen"');
  expect(html).toContain('id="staffRemoteCopy"');
  expect(html).toContain('id="staffRemoteUrl"');
  expect(html).toContain('id="remoteQr"');
  expect(html).toContain('id="remoteCardUrl"');
  expect(html).toContain("Connect your phone to the same network as this PC.");
  expect(html).toContain("min-height: 44px");
});

function makeElement(id, ownerDocument) {
  return {
    id,
    ownerDocument,
    attributes: {},
    dataset: {},
    children: [],
    listeners: new Map(),
    textContent: "",
    disabled: false,
    setAttribute(key, value) { this.attributes[key] = String(value); },
    removeAttribute(key) { delete this.attributes[key]; },
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    removeEventListener(type) { this.listeners.delete(type); },
    async dispatch(type) { return this.listeners.get(type)?.({ currentTarget: this }); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
  };
}

function makeDocument() {
  const document = {
    hidden: false,
    listeners: new Map(),
    createElementNS(_namespace, name) {
      return { nodeName: name, attributes: {}, children: [], setAttribute(key, value) { this.attributes[key] = String(value); }, appendChild(child) { this.children.push(child); } };
    },
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    removeEventListener(type) { this.listeners.delete(type); },
  };
  const ids = ["gis", "remote", "staffRemote", "projection", "projectionLeft", "projectionRight", "config", "curation"];
  const elements = new Map();
  for (const id of ids) {
    elements.set(`${id}Open`, makeElement(`${id}Open`, document));
    elements.set(`${id}Copy`, makeElement(`${id}Copy`, document));
    elements.set(`${id}Url`, makeElement(`${id}Url`, document));
  }
  elements.set("remoteCardUrl", makeElement("remoteCardUrl", document));
  elements.set("remoteUrl", makeElement("remoteUrl", document));
  elements.set("shareStatus", makeElement("shareStatus", document));
  elements.set("remoteQr", makeElement("remoteQr", document));
  document.getElementById = (id) => elements.get(id);
  document.elements = elements;
  return document;
}

function runtime(origin, generatedAt = "2026-09-13T10:00:00.000Z") {
  return { version: 1, remoteOrigin: origin, generatedAt, status: "ready" };
}

function clockHarness() {
  let next = 0;
  const timers = new Map();
  return {
    setTimeout(callback) { const id = ++next; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    timers,
  };
}

test("loopback remote fallback is macOS-only", () => {
  expect(allowsLoopbackRemoteFallback({ platform: "MacIntel" })).toBe(true);
  expect(allowsLoopbackRemoteFallback({ platform: "MacARM" })).toBe(true);
  expect(allowsLoopbackRemoteFallback({ userAgentData: { platform: "macOS" } })).toBe(true);
  expect(allowsLoopbackRemoteFallback({ platform: "Win32" })).toBe(false);
  expect(allowsLoopbackRemoteFallback({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" })).toBe(false);
  expect(allowsLoopbackRemoteFallback({
    platform: "iPhone",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
  })).toBe(false);
  expect(allowsLoopbackRemoteFallback({ platform: "Linux x86_64" })).toBe(false);
  expect(allowsLoopbackRemoteFallback({})).toBe(false);
  expect(allowsLoopbackRemoteFallback(null)).toBe(false);
});

test("Mac loopback enables remotes locally, then upgrades them to a fresh share origin", async () => {
  const document = makeDocument();
  let resolveFetch;
  const fetchImpl = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
  const clock = clockHarness();
  const dispose = initLauncher({
    document,
    location: new URL("http://localhost:8500/launcher.html"),
    fetchImpl,
    now: () => Date.parse("2026-09-13T10:00:00.000Z"),
    clock,
    navigator: { platform: "MacIntel" },
  });
  expect(document.getElementById("remoteOpen").href).toBe("http://localhost:8500/otef-interactive/remote-controller.html");
  expect(document.getElementById("staffRemoteOpen").href).toBe("http://localhost:8500/otef-interactive/nli-staff-remote.html");
  expect(document.getElementById("remoteCopy").disabled).toBe(false);
  expect(document.getElementById("remoteUrl").textContent).toBe("");
  resolveFetch({ ok: true, json: () => Promise.resolve(runtime("http://192.0.2.10:8500")) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.getElementById("remoteOpen").href).toBe("http://192.0.2.10:8500/otef-interactive/remote-controller.html");
  expect(document.getElementById("staffRemoteOpen").href).toBe("http://192.0.2.10:8500/otef-interactive/nli-staff-remote.html");
  expect(document.getElementById("remoteCardUrl").textContent).toContain("192.0.2.10");
  expect(document.getElementById("staffRemoteUrl").textContent).toContain("192.0.2.10");
  expect(document.getElementById("remoteQr").children).toHaveLength(1);
  dispose();
});

test("Windows loopback keeps remotes disabled until a fresh share origin resolves", async () => {
  const document = makeDocument();
  let resolveFetch;
  const fetchImpl = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
  const clock = clockHarness();
  const dispose = initLauncher({
    document,
    location: new URL("http://localhost:8500/launcher.html"),
    fetchImpl,
    now: () => Date.parse("2026-09-13T10:00:00.000Z"),
    clock,
    navigator: { platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
  });
  expect(document.getElementById("remoteOpen").href).toBeUndefined();
  expect(document.getElementById("staffRemoteOpen").href).toBeUndefined();
  expect(document.getElementById("remoteOpen").attributes["aria-disabled"]).toBe("true");
  expect(document.getElementById("staffRemoteOpen").attributes["aria-disabled"]).toBe("true");
  expect(document.getElementById("remoteCopy").disabled).toBe(true);
  expect(document.getElementById("staffRemoteCopy").disabled).toBe(true);
  expect(document.getElementById("gisOpen").href).toBe("http://localhost:8500/otef-interactive/index.html");
  resolveFetch({ ok: true, json: () => Promise.resolve(runtime("http://192.0.2.10:8500")) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.getElementById("remoteOpen").href).toBe("http://192.0.2.10:8500/otef-interactive/remote-controller.html");
  expect(document.getElementById("staffRemoteOpen").href).toBe("http://192.0.2.10:8500/otef-interactive/nli-staff-remote.html");
  expect(document.getElementById("remoteCopy").disabled).toBe(false);
  expect(document.getElementById("remoteQr").children).toHaveLength(1);
  dispose();
});

test("Windows loopback does not fall back to localhost when share origin is missing", async () => {
  const document = makeDocument();
  const fetchImpl = vi.fn().mockResolvedValue({ ok: false });
  const dispose = initLauncher({
    document,
    location: new URL("http://127.0.0.1:8500/otef-interactive/launcher.html"),
    fetchImpl,
    now: () => Date.parse("2026-09-13T10:00:00.000Z"),
    clock: clockHarness(),
    navigator: { platform: "Win32" },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.getElementById("remoteOpen").href).toBeUndefined();
  expect(document.getElementById("staffRemoteOpen").href).toBeUndefined();
  expect(document.getElementById("remoteCopy").disabled).toBe(true);
  expect(document.getElementById("remoteCardUrl").textContent).toBe("—");
  expect(document.getElementById("staffRemoteUrl").textContent).toBe("—");
  expect(document.getElementById("remoteUrl").textContent).toBe("—");
  expect(document.getElementById("shareStatus").textContent).toBe("Network address unavailable.");
  expect(document.getElementById("remoteQr").children).toHaveLength(0);
  dispose();
});

test("Mac loopback keeps remotes on localhost when share origin is missing", async () => {
  const document = makeDocument();
  const fetchImpl = vi.fn().mockResolvedValue({ ok: false });
  const dispose = initLauncher({
    document,
    location: new URL("http://127.0.0.1:8500/otef-interactive/launcher.html"),
    fetchImpl,
    now: () => Date.parse("2026-09-13T10:00:00.000Z"),
    clock: clockHarness(),
    navigator: { platform: "MacIntel" },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.getElementById("remoteOpen").href).toBe("http://127.0.0.1:8500/otef-interactive/remote-controller.html");
  expect(document.getElementById("staffRemoteOpen").href).toBe("http://127.0.0.1:8500/otef-interactive/nli-staff-remote.html");
  expect(document.getElementById("remoteCopy").disabled).toBe(false);
  expect(document.getElementById("remoteUrl").textContent).toBe("—");
  expect(document.getElementById("shareStatus").textContent).toBe("Network address unavailable.");
  expect(document.getElementById("remoteQr").children).toHaveLength(0);
  dispose();
});

test("launcher ignores out-of-order refreshes and late completion after disposal", async () => {
  const document = makeDocument();
  const pending = [];
  const fetchImpl = vi.fn(() => new Promise((resolve) => pending.push(resolve)));
  const clock = clockHarness();
  const listeners = new Map();
  vi.stubGlobal("addEventListener", (type, callback) => listeners.set(type, callback));
  vi.stubGlobal("removeEventListener", (type) => listeners.delete(type));
  const dispose = initLauncher({
    document,
    location: new URL("http://localhost:8500/launcher.html"),
    fetchImpl,
    now: () => Date.parse("2026-09-13T10:00:00.000Z"),
    clock,
    navigator: { platform: "Win32" },
  });
  await listeners.get("focus")();
  pending[1]({ ok: true, json: () => Promise.resolve(runtime("http://192.0.2.12:8500")) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  pending[0]({ ok: true, json: () => Promise.resolve(runtime("http://192.0.2.11:8500")) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.getElementById("remoteUrl").textContent).toContain("192.0.2.12");
  await listeners.get("focus")();
  expect(pending).toHaveLength(3);
  dispose();
  const late = pending[2];
  late({ ok: true, json: () => Promise.resolve(runtime("http://192.0.2.13:8500")) });
  expect(document.getElementById("remoteUrl").textContent).toContain("192.0.2.12");
  vi.unstubAllGlobals();
});

test("launcher reports copy failure while leaving the selected URL available", async () => {
  const document = makeDocument();
  document.createElement = () => ({ value: "", style: {}, setAttribute() {}, select() {} });
  document.body = { appendChild() {}, removeChild() {} };
  document.execCommand = vi.fn(() => false);
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
  const dispose = initLauncher({ document, location: new URL("https://exhibit.example/launcher.html"), clock: clockHarness() });
  const button = document.getElementById("gisCopy");
  await button.dispatch("click");
  expect(button.textContent).toBe("Copy failed");
  expect(document.getElementById("gisUrl").textContent).toBe("https://exhibit.example/otef-interactive/index.html");
  dispose();
  vi.unstubAllGlobals();
});
