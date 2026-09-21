import { expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { initPrintableQr } from "../../frontend/src/entries/qr-main.js";

const SHARE_MODE_KEY = "otef.share.mode";
const SHARE_QR_KEY = "otef.share.qr";

function makeElement(id, ownerDocument) {
  return {
    id,
    ownerDocument,
    textContent: "",
    children: [],
    hidden: false,
    attributes: {},
    listeners: new Map(),
    setAttribute(key, value) { this.attributes[key] = String(value); },
    removeAttribute(key) { delete this.attributes[key]; },
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    removeEventListener(type) { this.listeners.delete(type); },
    async dispatch(type) { return this.listeners.get(type)?.({ currentTarget: this }); },
    replaceChildren(...children) { this.children = children; },
  };
}

function makeDocument() {
  const nodes = new Map();
  const document = {
    hidden: false,
    listeners: new Map(),
    createElementNS(_namespace, name) {
      return { nodeName: name, attributes: {}, children: [], setAttribute(key, value) { this.attributes[key] = String(value); }, appendChild(child) { this.children.push(child); } };
    },
    getElementById: (id) => nodes.get(id),
    addEventListener(type, cb) { this.listeners.set(type, cb); },
    removeEventListener(type) { this.listeners.delete(type); },
    nodes,
  };
  for (const id of ["targetUrl", "qrcode", "shareStatus", "shareModeLocal", "shareModeTailnet", "shareQrRemote", "shareQrNli"]) {
    nodes.set(id, makeElement(id, document));
  }
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
  };
}

function shareHosts(tailnetOrigin = "http://100.64.252.114") {
  return { localOrigin: "http://labpc.local", tailnetOrigin };
}

function fetchShare(hosts = shareHosts()) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => hosts });
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test("qr.html includes Local/Tailnet at the top and Regular/NLI near the QR", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../../frontend/qr.html"), "utf8");
  expect(html).toContain('id="shareModeLocal"');
  expect(html).toContain('id="shareModeTailnet"');
  expect(html).toContain('id="shareQrRemote"');
  expect(html).toContain('id="shareQrNli"');
  expect(html).toContain('button[aria-pressed="true"]');
  expect(html).not.toMatch(/aria-pressed="true"[^}]*background:\s*#d5e5ff/);
  expect(html.indexOf('id="shareModeLocal"')).toBeLessThan(html.indexOf('id="qrcode"'));
  expect(html.indexOf('id="shareQrRemote"')).toBeGreaterThan(html.indexOf('id="qrcode"'));
});

test("printable QR defaults to the local guest remote when share.json loads", async () => {
  const document = makeDocument();
  const storage = makeStorage();
  const dispose = initPrintableQr({
    document,
    location: new URL("http://localhost/otef-interactive/qr.html"),
    fetchImpl: fetchShare(),
    storage,
  });
  await flush();
  expect(document.nodes.get("targetUrl").textContent).toBe("http://labpc.local/otef-interactive/remote-controller.html");
  expect(document.nodes.get("qrcode").children).toHaveLength(1);
  expect(storage.getItem(SHARE_MODE_KEY)).toBe("local");
  expect(document.nodes.get("shareModeLocal").attributes["aria-pressed"]).toBe("true");
  expect(document.nodes.get("shareModeTailnet").attributes["aria-pressed"]).toBe("false");
  expect(document.nodes.get("shareQrRemote").attributes["aria-pressed"]).toBe("true");
  expect(document.nodes.get("shareQrNli").attributes["aria-pressed"]).toBe("false");
  dispose();
});

test("loopback share miss shows no QR", async () => {
  const document = makeDocument();
  const dispose = initPrintableQr({
    document,
    location: new URL("http://localhost/otef-interactive/qr.html"),
    fetchImpl: vi.fn().mockResolvedValue({ ok: false }),
    storage: makeStorage(),
  });
  await flush();
  expect(document.nodes.get("qrcode").children).toHaveLength(0);
  expect(document.nodes.get("targetUrl").textContent).toBe("—");
  dispose();
});

test("qr-main reads stored tailnet mode and Tailnet click persists and rebuilds the guest QR", async () => {
  const document = makeDocument();
  const storage = makeStorage({ [SHARE_MODE_KEY]: "tailnet" });
  const dispose = initPrintableQr({
    document,
    location: new URL("http://localhost/otef-interactive/qr.html"),
    fetchImpl: fetchShare(),
    storage,
  });
  await flush();
  expect(document.nodes.get("targetUrl").textContent).toBe("http://100.64.252.114/otef-interactive/remote-controller.html");
  expect(document.nodes.get("qrcode").children).toHaveLength(1);
  storage.setItem(SHARE_MODE_KEY, "local");
  await document.nodes.get("shareModeTailnet").dispatch("click");
  expect(storage.getItem(SHARE_MODE_KEY)).toBe("tailnet");
  expect(document.nodes.get("targetUrl").textContent).toBe("http://100.64.252.114/otef-interactive/remote-controller.html");
  expect(document.nodes.get("qrcode").children).toHaveLength(1);
  dispose();
});

test("shareQrNli switches the printable QR to the staff remote", async () => {
  const document = makeDocument();
  const storage = makeStorage();
  const dispose = initPrintableQr({
    document,
    location: new URL("http://localhost/otef-interactive/qr.html"),
    fetchImpl: fetchShare(),
    storage,
  });
  await flush();
  await document.nodes.get("shareQrNli").dispatch("click");
  expect(document.nodes.get("targetUrl").textContent).toBe("http://labpc.local/otef-interactive/nli-staff-remote.html");
  expect(document.nodes.get("qrcode").children).toHaveLength(1);
  expect(document.nodes.get("shareQrRemote").attributes["aria-pressed"]).toBe("false");
  expect(document.nodes.get("shareQrNli").attributes["aria-pressed"]).toBe("true");
  expect(storage.getItem(SHARE_QR_KEY)).toBe("nli");
  dispose();
});

test("invalid stored share mode with a valid share.json load still enables QR on Local", async () => {
  const document = makeDocument();
  const storage = makeStorage({ [SHARE_MODE_KEY]: "nope" });
  const dispose = initPrintableQr({
    document,
    location: new URL("http://localhost/otef-interactive/qr.html"),
    fetchImpl: fetchShare(),
    storage,
  });
  await flush();
  expect(document.nodes.get("targetUrl").textContent).toBe("http://labpc.local/otef-interactive/remote-controller.html");
  expect(document.nodes.get("qrcode").children).toHaveLength(1);
  expect(document.nodes.get("shareStatus").textContent).toBe("Ready to connect.");
  expect(storage.getItem(SHARE_MODE_KEY)).toBe("local");
  dispose();
});

test("missing tailnetOrigin clamps stored tailnet to local", async () => {
  const document = makeDocument();
  const storage = makeStorage({ [SHARE_MODE_KEY]: "tailnet" });
  const dispose = initPrintableQr({
    document,
    location: new URL("http://localhost/otef-interactive/qr.html"),
    fetchImpl: fetchShare(shareHosts(null)),
    storage,
  });
  await flush();
  expect(document.nodes.get("shareModeTailnet").hidden).toBe(true);
  expect(storage.getItem(SHARE_MODE_KEY)).toBe("local");
  expect(document.nodes.get("targetUrl").textContent).toBe("http://labpc.local/otef-interactive/remote-controller.html");
  expect(document.nodes.get("qrcode").children).toHaveLength(1);
  dispose();
});
