import { expect, test } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveHotspotOptions, selectHotspotIpv4, writeShareHosts } from "../../scripts/write-share-hosts.mjs";

test("writeShareHosts records hostname.local and optional tailnet IP", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "otef-share-"));
  const runtimePath = path.join(directory, "runtime", "share.json");
  try {
    await writeShareHosts({ runtimePath, hostname: "labpc", port: 80, tailnetIp: "100.64.252.114" });
    expect(JSON.parse(await readFile(runtimePath, "utf8"))).toEqual({
      localOrigin: "http://labpc.local",
      tailnetOrigin: "http://100.64.252.114",
    });
    await writeShareHosts({ runtimePath, hostname: "Noams-MacBook-Pro.local", port: 8512, tailnetIp: null });
    expect(JSON.parse(await readFile(runtimePath, "utf8"))).toEqual({
      localOrigin: "http://noams-macbook-pro.local:8512",
      tailnetOrigin: null,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("writeShareHosts uses the configured hotspot address and clears it when inactive", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "otef-share-hotspot-"));
  const runtimePath = path.join(directory, "runtime", "share.json");
  try {
    const discoverIpv4 = async (alias) => alias === "Wi-Fi 2" ? "192.168.137.2" : null;
    await writeShareHosts({ runtimePath, hostname: "labpc", port: 80, tailnetIp: "100.64.0.1", hotspotInterface: "Wi-Fi 2", discoverIpv4 });
    expect(JSON.parse(await readFile(runtimePath, "utf8"))).toEqual({
      localOrigin: "http://192.168.137.2", tailnetOrigin: "http://100.64.0.1", localKind: "hotspot",
    });
    await writeShareHosts({ runtimePath, hostname: "labpc", port: 80, tailnetIp: null, hotspotInterface: "Wi-Fi 2", discoverIpv4: async () => null });
    expect(JSON.parse(await readFile(runtimePath, "utf8"))).toEqual({ localOrigin: null, tailnetOrigin: null, localKind: "hotspot" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("writeShareHosts prefers an explicit hotspot IPv4 override over adapter discovery", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "otef-share-hotspot-override-"));
  const runtimePath = path.join(directory, "runtime", "share.json");
  try {
    const payload = await writeShareHosts({
      runtimePath, hostname: "labpc", port: 80, tailnetIp: "100.64.0.1",
      hotspotInterface: "Wi-Fi 2", hotspotIpv4: "192.168.137.2",
      discoverIpv4: async () => { throw new Error("override should bypass discovery"); },
    });
    expect(payload).toEqual({ localOrigin: "http://192.168.137.2", tailnetOrigin: "http://100.64.0.1", localKind: "hotspot" });
    expect(JSON.parse(await readFile(runtimePath, "utf8"))).toEqual(payload);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("selectHotspotIpv4 rejects a disconnected adapter and deprecated address", () => {
  expect(selectHotspotIpv4([
    { adapterStatus: "Disconnected", addressState: "Preferred", ipAddress: "192.168.137.2" },
    { adapterStatus: "Up", addressState: "Deprecated", ipAddress: "192.168.137.3" },
  ])).toBeNull();
  expect(selectHotspotIpv4([
    { adapterStatus: "Up", addressState: "Preferred", ipAddress: "192.168.137.2" },
  ])).toBe("192.168.137.2");
});

test("selectHotspotIpv4 accepts the JSON shape emitted by hotspot discovery", () => {
  const records = JSON.parse('[{"adapterStatus":"Up","addressState":"Preferred","ipAddress":"192.168.137.2"}]');
  expect(selectHotspotIpv4(records)).toBe("192.168.137.2");
});

test("resolveHotspotOptions rejects invalid explicit IPv4 and honors CLI precedence", () => {
  expect(() => resolveHotspotOptions({ ipv4: "192.168.999.2" }, [])).toThrow(/invalid hotspot IPv4/i);
  expect(() => resolveHotspotOptions({}, ["--hotspot-ip", "not-an-ip"])).toThrow(/invalid hotspot IPv4/i);
  expect(resolveHotspotOptions({ interfaceAlias: "Wi-Fi 2", ipv4: "192.168.137.2" }, ["--hotspot-interface", "Wi-Fi 5"])).toEqual({
    interfaceAlias: "Wi-Fi 5", ipv4: null,
  });
  expect(resolveHotspotOptions({ interfaceAlias: "Wi-Fi 2", ipv4: "192.168.137.2" }, [])).toEqual({
    interfaceAlias: "Wi-Fi 2", ipv4: "192.168.137.2",
  });
});
