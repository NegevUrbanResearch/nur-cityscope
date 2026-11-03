import { describe, expect, test } from "vitest";
import {
  SHARE_PATH,
  httpOrigin,
  loadShareHosts,
  mdnsLabelFromHostname,
  originForMode,
  parseShareHosts,
} from "../../frontend/src/shared/share-origin.js";

test("mdnsLabelFromHostname uses the first label and strips .local", () => {
  expect(mdnsLabelFromHostname("labpc")).toBe("labpc");
  expect(mdnsLabelFromHostname("Noams-MacBook-Pro.local")).toBe("noams-macbook-pro");
  expect(mdnsLabelFromHostname("LABPC.lan")).toBe("labpc");
});

test("httpOrigin omits port 80 and rejects ts.net and https", () => {
  expect(httpOrigin("labpc.local", 80)).toBe("http://labpc.local");
  expect(httpOrigin("100.64.252.114", 80)).toBe("http://100.64.252.114");
  expect(httpOrigin("labpc.local", 8512)).toBe("http://labpc.local:8512");
  expect(httpOrigin("labpc.tail62fa44.ts.net", 80)).toBeNull();
});

test("parseShareHosts rejects https and ts.net", () => {
  expect(parseShareHosts({
    localOrigin: "http://labpc.local",
    tailnetOrigin: "http://100.64.252.114",
  })).toEqual({ localOrigin: "http://labpc.local", tailnetOrigin: "http://100.64.252.114" });
  expect(parseShareHosts({ localOrigin: "http://labpc.local", tailnetOrigin: null })).toEqual({
    localOrigin: "http://labpc.local",
    tailnetOrigin: null,
  });
  expect(parseShareHosts({ localOrigin: "https://labpc.local", tailnetOrigin: null })).toBeNull();
  expect(parseShareHosts({ localOrigin: "http://labpc.tail62fa44.ts.net", tailnetOrigin: null })).toBeNull();
});

test("loadShareHosts flags whether share.json loaded", async () => {
  const hosts = { localOrigin: "http://labpc.local", tailnetOrigin: "http://100.64.252.114" };
  const fetchOk = async () => ({ ok: true, json: async () => hosts });
  expect(await loadShareHosts({
    location: new URL("http://localhost/otef-interactive/launcher.html"),
    fetchImpl: fetchOk,
  })).toEqual({ ...hosts, localKind: null, fromShareFile: true });
  expect(await loadShareHosts({
    location: new URL("http://localhost/otef-interactive/launcher.html"),
    fetchImpl: async () => ({ ok: false }),
  })).toEqual({ localOrigin: null, tailnetOrigin: null, localKind: null, fromShareFile: false });
  expect(await loadShareHosts({
    location: new URL("http://noams-macbook-pro.local/otef-interactive/launcher.html"),
    fetchImpl: async () => { throw new Error("offline"); },
  })).toEqual({ localOrigin: "http://noams-macbook-pro.local", tailnetOrigin: null, localKind: null, fromShareFile: false });
  expect(await loadShareHosts({
    location: new URL("https://labpc.tail62fa44.ts.net/otef-interactive/launcher.html"),
    fetchImpl: async () => ({ ok: false }),
  })).toEqual({ localOrigin: null, tailnetOrigin: null, localKind: null, fromShareFile: false });
});

test("loadShareHosts accepts an unavailable LAN without falling back to the page host", async () => {
  expect(await loadShareHosts({
    location: new URL("http://localhost/otef-interactive/launcher.html"),
    fetchImpl: async () => ({ ok: true, json: async () => ({ localOrigin: null, tailnetOrigin: "http://100.64.0.1", localKind: "lan" }) }),
  })).toEqual({ localOrigin: null, tailnetOrigin: "http://100.64.0.1", localKind: "lan", fromShareFile: true });
});

test("LAN metadata survives parsing; legacy hotspot shares cannot produce a stale QR", () => {
  expect(parseShareHosts({ localOrigin: "http://192.168.13.35", tailnetOrigin: null, localKind: "lan" })).toEqual({ localOrigin: "http://192.168.13.35", tailnetOrigin: null, localKind: "lan" });
  expect(parseShareHosts({ localOrigin: "http://192.168.137.2", tailnetOrigin: null, localKind: "hotspot" })).toBeNull();
});

test("originForMode uses local when tailnet is missing", () => {
  const hosts = { localOrigin: "http://labpc.local", tailnetOrigin: "http://100.64.252.114" };
  expect(originForMode("local", hosts)).toBe("http://labpc.local");
  expect(originForMode("tailnet", hosts)).toBe("http://100.64.252.114");
  expect(originForMode("tailnet", { localOrigin: "http://labpc.local", tailnetOrigin: null })).toBe("http://labpc.local");
});
