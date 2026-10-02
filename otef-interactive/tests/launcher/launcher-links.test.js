import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import { initLauncher } from "../../frontend/src/entries/launcher-main.js";

const SHARE_MODE_KEY = "otef.share.mode";
const SHARE_QR_KEY = "otef.share.qr";
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
  expect(html).toContain('id="shareModeLocal"');
  expect(html).toContain('id="shareModeTailnet"');
  expect(html).toContain('id="shareQrRemote"');
  expect(html).toContain('id="shareQrNli"');
  expect(html).not.toContain('id="shareQrWifi"');
  expect(html).not.toContain('id="wifiPassword"');
  expect(html).toContain("Connect on the same Wi-Fi, or use Tailnet off-LAN.");
  expect(html).toContain("min-height: 44px");
  expect(html).toContain('button[aria-pressed="true"]');
  expect(html).not.toMatch(/button\[aria-pressed="true"\][^}]*background:\s*#d5e5ff/);
  expect(html.indexOf("<h1>")).toBeLessThan(html.indexOf('id="shareModeLocal"'));
  expect(html.indexOf('id="shareModeLocal"')).toBeLessThan(html.indexOf('aria-label="Exhibit surfaces"'));
  expect(html.indexOf('id="shareQrRemote"')).toBeLessThan(html.indexOf('id="remoteQr"'));
});

function makeElement(id, ownerDocument) {
  return {
    id,
    ownerDocument,
    attributes: {},
    dataset: {},
    children: [],
    listeners: new Map(),
    value: "",
    textContent: "",
    disabled: false,
    hidden: false,
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
  elements.set("shareModeLocal", makeElement("shareModeLocal", document));
  elements.set("shareModeTailnet", makeElement("shareModeTailnet", document));
  elements.set("shareQrRemote", makeElement("shareQrRemote", document));
  elements.set("shareQrNli", makeElement("shareQrNli", document));
  elements.set("localShareHint", makeElement("localShareHint", document));
  document.getElementById = (id) => elements.get(id);
  document.elements = elements;
  return document;
}

function makeStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    },
  };
}

function shareHosts(tailnetOrigin = "http://100.64.252.114") {
  return { localOrigin: "http://labpc.local", tailnetOrigin };
}

function fetchShare(hosts = shareHosts()) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => hosts });
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

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("share.json local origin keeps GIS on the page and remotes/QR on labpc", async () => {
  const document = makeDocument();
  const dispose = initLauncher({
    document,
    location: new URL("http://localhost/otef-interactive/launcher.html"),
    fetchImpl: fetchShare(),
    storage: makeStorage(),
  });
  await flush();
  expect(document.getElementById("gisOpen").href).toBe("http://localhost/otef-interactive/index.html");
  expect(document.getElementById("remoteOpen").href).toBe("http://labpc.local/otef-interactive/remote-controller.html");
  expect(document.getElementById("staffRemoteOpen").href).toBe("http://labpc.local/otef-interactive/nli-staff-remote.html");
  expect(document.getElementById("remoteUrl").textContent).toBe("http://labpc.local/otef-interactive/remote-controller.html");
  expect(document.getElementById("shareStatus").textContent).toBe("Ready to connect.");
  expect(document.getElementById("remoteQr").children).toHaveLength(1);
  expect(document.getElementById("shareModeLocal").attributes["aria-pressed"]).toBe("true");
  expect(document.getElementById("shareModeTailnet").attributes["aria-pressed"]).toBe("false");
  expect(document.getElementById("shareQrRemote").attributes["aria-pressed"]).toBe("true");
  expect(document.getElementById("shareQrNli").attributes["aria-pressed"]).toBe("false");
  dispose();
});

test("missing hotspot address defaults to Tailnet but keeps the unavailable local option", async () => {
  const document = makeDocument();
  const dispose = initLauncher({
    document,
    location: new URL("http://localhost/otef-interactive/launcher.html"),
    fetchImpl: fetchShare({ localOrigin: null, tailnetOrigin: "http://100.64.252.114", localKind: "hotspot", fromShareFile: true }),
    storage: makeStorage(),
  });
  await flush();
  expect(document.getElementById("remoteOpen").href).toBe("http://100.64.252.114/otef-interactive/remote-controller.html");
  expect(document.getElementById("staffRemoteOpen").href).toBe("http://100.64.252.114/otef-interactive/nli-staff-remote.html");
  expect(document.getElementById("shareModeTailnet").attributes["aria-pressed"]).toBe("true");
  expect(document.getElementById("localShareHint").textContent).toContain("PC hotspot address unavailable");
  expect(document.getElementById("localShareHint").textContent).toContain("reload this launcher");
  expect(document.getElementById("shareModeLocal").textContent).toBe("PC Hotspot");
  expect(document.getElementById("shareModeTailnet").hidden).toBe(false);
  await document.getElementById("shareModeLocal").dispatch("click");
  expect(document.getElementById("remoteOpen").attributes["aria-disabled"]).toBe("true");
  expect(document.getElementById("remoteOpen").dataset.url).toBe("");
  expect(document.getElementById("shareStatus").textContent).toContain("Turn on the PC hotspot");
  dispose();
});

test("active hotspot selects its local address on every load despite a saved Tailnet choice", async () => {
  const document = makeDocument();
  const storage = makeStorage({ [SHARE_MODE_KEY]: "tailnet" });
  const dispose = initLauncher({
    document,
    location: new URL("http://localhost/otef-interactive/launcher.html"),
    fetchImpl: fetchShare({ ...shareHosts(), localKind: "hotspot" }),
    storage,
  });
  await flush();
  expect(document.getElementById("shareModeLocal").textContent).toBe("PC Hotspot");
  expect(document.getElementById("shareModeLocal").attributes["aria-pressed"]).toBe("true");
  expect(document.getElementById("remoteOpen").href).toBe("http://labpc.local/otef-interactive/remote-controller.html");
  expect(document.getElementById("remoteUrl").textContent).toBe("http://labpc.local/otef-interactive/remote-controller.html");
  expect(document.getElementById("localShareHint").textContent).toContain("assumed and unverified");
  expect(document.getElementById("localShareHint").textContent).toContain("Turn on the PC hotspot before scanning");
  expect(document.getElementById("localShareHint").textContent).toContain("choose Tailnet");
  expect(document.getElementById("localShareHint").textContent).toContain("If its IP changes after a PC restart");
  expect(document.getElementById("localShareHint").textContent).toContain("update the saved hotspot IP");
  expect(document.getElementById("localShareHint").textContent).toContain("restart the OTEF helper");
  expect(document.getElementById("shareStatus").textContent).toContain("Saved hotspot address is unverified");
  expect(storage.getItem(SHARE_MODE_KEY)).toBe("local");
  await document.getElementById("shareModeTailnet").dispatch("click");
  expect(document.getElementById("remoteOpen").href).toBe("http://100.64.252.114/otef-interactive/remote-controller.html");
  dispose();
});

test("shareModeTailnet changes only remote and QR origins", async () => {
  const document = makeDocument();
  const storage = makeStorage();
  const dispose = initLauncher({
    document,
    location: new URL("http://localhost/otef-interactive/launcher.html"),
    fetchImpl: fetchShare(),
    storage,
  });
  await flush();
  await document.getElementById("shareModeTailnet").dispatch("click");
  expect(document.getElementById("gisOpen").href).toBe("http://localhost/otef-interactive/index.html");
  expect(document.getElementById("remoteOpen").href).toBe("http://100.64.252.114/otef-interactive/remote-controller.html");
  expect(document.getElementById("staffRemoteOpen").href).toBe("http://100.64.252.114/otef-interactive/nli-staff-remote.html");
  expect(document.getElementById("remoteUrl").textContent).toBe("http://100.64.252.114/otef-interactive/remote-controller.html");
  expect(document.getElementById("remoteQr").children).toHaveLength(1);
  expect(storage.getItem(SHARE_MODE_KEY)).toBe("tailnet");
  expect(document.getElementById("shareModeLocal").attributes["aria-pressed"]).toBe("false");
  expect(document.getElementById("shareModeTailnet").attributes["aria-pressed"]).toBe("true");
  dispose();
});

test("shareQrNli switches the QR and share URL to the staff remote", async () => {
  const document = makeDocument();
  const storage = makeStorage();
  const dispose = initLauncher({
    document,
    location: new URL("http://localhost/otef-interactive/launcher.html"),
    fetchImpl: fetchShare(),
    storage,
  });
  await flush();
  await document.getElementById("shareQrNli").dispatch("click");
  expect(document.getElementById("remoteOpen").href).toBe("http://labpc.local/otef-interactive/remote-controller.html");
  expect(document.getElementById("staffRemoteOpen").href).toBe("http://labpc.local/otef-interactive/nli-staff-remote.html");
  expect(document.getElementById("remoteUrl").textContent).toBe("http://labpc.local/otef-interactive/nli-staff-remote.html");
  expect(document.getElementById("remoteQr").children).toHaveLength(1);
  expect(document.getElementById("shareQrRemote").attributes["aria-pressed"]).toBe("false");
  expect(document.getElementById("shareQrNli").attributes["aria-pressed"]).toBe("true");
  expect(storage.getItem(SHARE_QR_KEY)).toBe("nli");
  dispose();
});

test("invalid stored share mode with a valid share.json load still enables remotes and QR on Local", async () => {
  const document = makeDocument();
  const storage = makeStorage({ [SHARE_MODE_KEY]: "nope" });
  const dispose = initLauncher({
    document,
    location: new URL("http://localhost/otef-interactive/launcher.html"),
    fetchImpl: fetchShare(),
    storage,
  });
  await flush();
  expect(document.getElementById("remoteOpen").href).toBe("http://labpc.local/otef-interactive/remote-controller.html");
  expect(document.getElementById("staffRemoteOpen").href).toBe("http://labpc.local/otef-interactive/nli-staff-remote.html");
  expect(document.getElementById("remoteQr").children).toHaveLength(1);
  expect(document.getElementById("shareStatus").textContent).toBe("Ready to connect.");
  expect(storage.getItem(SHARE_MODE_KEY)).toBe("local");
  dispose();
});

test("missing tailnetOrigin hides Tailnet and clamps stored tailnet to local", async () => {
  const document = makeDocument();
  const storage = makeStorage({ [SHARE_MODE_KEY]: "tailnet" });
  const dispose = initLauncher({
    document,
    location: new URL("http://localhost/otef-interactive/launcher.html"),
    fetchImpl: fetchShare(shareHosts(null)),
    storage,
  });
  await flush();
  expect(document.getElementById("shareModeTailnet").hidden).toBe(true);
  expect(document.getElementById("remoteOpen").href).toBe("http://labpc.local/otef-interactive/remote-controller.html");
  expect(document.getElementById("staffRemoteOpen").href).toBe("http://labpc.local/otef-interactive/nli-staff-remote.html");
  expect(storage.getItem(SHARE_MODE_KEY)).toBe("local");
  dispose();
});

test("hotspot guidance omits Tailnet when no fallback is available", async () => {
  for (const localOrigin of ["http://192.168.137.2", null]) {
    const document = makeDocument();
    const dispose = initLauncher({
      document,
      location: new URL("http://localhost/otef-interactive/launcher.html"),
      fetchImpl: fetchShare({ localOrigin, tailnetOrigin: null, localKind: "hotspot" }),
      storage: makeStorage(),
    });
    await flush();
    expect(document.getElementById("shareModeTailnet").hidden).toBe(true);
    expect(document.getElementById("localShareHint").textContent).not.toContain("Tailnet");
    expect(document.getElementById("shareStatus").textContent).not.toContain("Tailnet");
    dispose();
  }
});

test("loopback share miss leaves GIS on the page and remotes unavailable", async () => {
  const document = makeDocument();
  const dispose = initLauncher({
    document,
    location: new URL("http://127.0.0.1/otef-interactive/launcher.html"),
    fetchImpl: vi.fn().mockResolvedValue({ ok: false }),
    storage: makeStorage(),
  });
  await flush();
  expect(document.getElementById("gisOpen").href).toBe("http://127.0.0.1/otef-interactive/index.html");
  expect(document.getElementById("remoteOpen").href).toBeUndefined();
  expect(document.getElementById("staffRemoteOpen").href).toBeUndefined();
  expect(document.getElementById("remoteQr").children).toHaveLength(0);
  expect(document.getElementById("shareStatus").textContent).toContain("start-otef");
  expect(document.getElementById("shareStatus").textContent).not.toContain("Ready to connect.");
  dispose();
});

test("launcher reports copy failure while leaving the selected URL available", async () => {
  const document = makeDocument();
  document.createElement = () => ({ value: "", style: {}, setAttribute() {}, select() {} });
  document.body = { appendChild() {}, removeChild() {} };
  document.execCommand = vi.fn(() => false);
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
  const dispose = initLauncher({
    document,
    location: new URL("https://exhibit.example/launcher.html"),
    clock: clockHarness(),
    storage: makeStorage(),
  });
  const button = document.getElementById("gisCopy");
  await button.dispatch("click");
  expect(button.textContent).toBe("Copy failed");
  expect(document.getElementById("gisUrl").textContent).toBe("https://exhibit.example/otef-interactive/index.html");
  dispose();
  vi.unstubAllGlobals();
});
