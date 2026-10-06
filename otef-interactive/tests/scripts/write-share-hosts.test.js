import { expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as writer from "../../scripts/write-share-hosts.mjs";

async function withRuntime(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "otef-share-"));
  try { await run(path.join(directory, "runtime", "share.json")); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("share file uses the current LAN IP and nginx port, with optional Tailscale", async () => {
  await withRuntime(async (runtimePath) => {
    for (const [ip, port, tailnetIp] of [["192.168.13.35", 80, "100.64.252.114"], ["10.0.0.12", 8512, null]]) {
      const payload = await writer.writeShareHosts({ runtimePath, port, tailnetIp, discoverIpv4: async () => ip });
      expect(payload).toEqual({ localOrigin: `http://${ip}${port === 80 ? "" : `:${port}`}`, tailnetOrigin: tailnetIp ? `http://${tailnetIp}` : null, localKind: "lan" });
      expect(JSON.parse(await readFile(runtimePath, "utf8"))).toEqual(payload);
    }
  });
});

test("legacy saved hotspot IP cannot override the discovered LAN", async () => {
  await withRuntime(async (runtimePath) => {
    expect(await writer.writeShareHosts({ runtimePath, hostname: "labpc", port: 80, tailnetIp: null,
      hotspotInterface: "Wi-Fi 2", hotspotIpv4: "192.168.137.2", discoverIpv4: async () => "192.168.13.35",
    })).toEqual({ localOrigin: "http://192.168.13.35", tailnetOrigin: null, localKind: "lan" });
  });
});

test("missing LAN clears the old origin and retains Tailscale", async () => {
  await withRuntime(async (runtimePath) => {
    await writer.writeShareHosts({ runtimePath, port: 8512, tailnetIp: null, discoverIpv4: async () => "192.168.13.35" });
    const payload = await writer.writeShareHosts({ runtimePath, port: 8512, tailnetIp: "100.64.0.1", discoverIpv4: async () => null });
    expect(payload).toEqual({ localOrigin: null, tailnetOrigin: "http://100.64.0.1:8512", localKind: "lan" });
    expect(JSON.parse(await readFile(runtimePath, "utf8"))).toEqual(payload);
  });
});

test("explicit LAN interface is passed to discovery rather than saving its IP", async () => {
  await withRuntime(async (runtimePath) => {
    const discoverIpv4 = vi.fn(async () => "10.0.0.12");
    await writer.writeShareHosts({ runtimePath, port: 80, tailnetIp: null, lanInterface: "Wi-Fi", discoverIpv4 });
    expect(discoverIpv4).toHaveBeenCalledWith("Wi-Fi");
  });
});

test("LAN interface flag is optional and rejects missing values", () => {
  expect(writer.resolveLanInterface([])).toBeNull();
  expect(writer.resolveLanInterface(["--lan-interface", " Ethernet "])).toBe("Ethernet");
  for (const args of [["--lan-interface"], ["--lan-interface", " "], ["--lan-interface", "--port"]]) {
    expect(() => writer.resolveLanInterface(args)).toThrow(/LAN interface/i);
  }
});

test("share writer rejects unusable IPs and invalid published ports", async () => {
  await withRuntime(async (runtimePath) => {
    for (const ip of ["127.0.0.1", "169.254.1.2", "100.64.0.1", "0.0.0.0", "bad"]) {
      expect((await writer.writeShareHosts({ runtimePath, port: 80, tailnetIp: null, discoverIpv4: async () => ip })).localOrigin).toBeNull();
    }
    for (const port of [0, 65536, 1.5, NaN]) {
      await expect(writer.writeShareHosts({ runtimePath, port, tailnetIp: null, discoverIpv4: async () => "10.0.0.12" })).rejects.toThrow(/port/i);
    }
  });
});
