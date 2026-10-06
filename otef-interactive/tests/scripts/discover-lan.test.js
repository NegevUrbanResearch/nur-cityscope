import { expect, test, vi } from "vitest";
import * as network from "../../scripts/discover-lan.mjs";

const ethernet = { interfaceAlias: "Ethernet", physical: true, adapterStatus: "Up", addressState: "Preferred", ipAddress: "192.168.13.35", gateway: "192.168.13.2", routeMetric: 0, interfaceMetric: 25 };

test("LAN selection accepts Ethernet and Wi-Fi and ranks by combined route metric", () => {
  const wifi = { ...ethernet, interfaceAlias: "Wi-Fi", ipAddress: "10.0.0.12", routeMetric: 10, interfaceMetric: 5 };
  expect(network.selectLanIpv4([ethernet, wifi])).toBe("10.0.0.12");
  expect(network.selectLanIpv4([wifi, ethernet], "Ethernet")).toBe("192.168.13.35");
  expect(network.selectLanIpv4(ethernet)).toBe("192.168.13.35");
});

test("LAN selection excludes virtual, hotspot, VPN, disconnected and deprecated addresses", () => {
  for (const rejected of [
    { ...ethernet, physical: false },
    { ...ethernet, adapterStatus: "Disconnected" },
    { ...ethernet, addressState: "Deprecated" },
    ...["Tailscale", "VMware Network Adapter VMnet1", "vEthernet (WSL)", "Local Area Connection* 2", "Wi-Fi Direct"].map(interfaceAlias => ({ ...ethernet, interfaceAlias })),
    ...["127.0.0.1", "169.254.2.3", "100.64.0.1", "0.0.0.0", "192.168.999.2", "203.0.113.5"].map(ipAddress => ({ ...ethernet, ipAddress })),
  ]) {
    expect(network.selectLanIpv4([rejected])).toBeNull();
    expect(network.selectLanIpv4([rejected, ethernet])).toBe("192.168.13.35");
  }
});

test("automatic selection requires a gateway, while explicit LAN interface permits an isolated LAN", () => {
  const isolated = { ...ethernet, gateway: null };
  expect(network.selectLanIpv4(isolated)).toBeNull();
  expect(network.selectLanIpv4(isolated, "Ethernet")).toBe("192.168.13.35");
  expect(network.selectLanIpv4(ethernet, "Other")).toBeNull();
  expect(network.selectLanIpv4([])).toBeNull();
});

test("Windows discovery parses native records and bounds process time", async () => {
  const runner = vi.fn(async () => ({ stdout: JSON.stringify([ethernet]) }));
  expect(await network.discoverLanIpv4(null, { platform: "win32", runner })).toBe("192.168.13.35");
  expect(runner.mock.calls[0][0]).toBe("powershell.exe");
  expect(runner.mock.calls[0][2]).toMatchObject({ timeout: 10000, windowsHide: true });
  for (const broken of [async () => { throw new Error("denied"); }, async () => ({ stdout: "garbage" }), async () => ({ stdout: "[]" })]) {
    expect(await network.discoverLanIpv4(null, { platform: "win32", runner: broken })).toBeNull();
  }
});

test("macOS discovery uses hardware Wi-Fi/Ethernet and ignores virtual devices", async () => {
  const runner = async (file) => ({ stdout: file === "networksetup"
    ? "Hardware Port: Wi-Fi\nDevice: en0\n\nHardware Port: Thunderbolt Bridge\nDevice: bridge0\n"
    : "gateway: 10.0.0.1\ninterface: en0\n" });
  const interfaces = { en0: [{ family: "IPv4", internal: false, address: "10.0.0.12" }], bridge0: [{ family: "IPv4", internal: false, address: "192.168.13.35" }] };
  expect(await network.discoverLanIpv4(null, { platform: "darwin", runner, interfaces })).toBe("10.0.0.12");
  expect(await network.discoverLanIpv4("bridge0", { platform: "darwin", runner, interfaces })).toBeNull();
});

test("Linux discovery requires a connected physical adapter and a preferred address", async () => {
  const interfaces = { eth0: [{ family: "IPv4", internal: false, address: "192.168.13.35" }] };
  for (const [operstate, lifetime, expected] of [["DOWN", 3600, null], ["UP", 0, null], ["UP", 3600, "192.168.13.35"]]) {
    const runner = async (_file, args) => ({ stdout: JSON.stringify(args.includes("address")
      ? [{ ifname: "eth0", operstate, addr_info: [{ family: "inet", local: "192.168.13.35", preferred_life_time: lifetime }] }]
      : [{ dev: "eth0", gateway: "192.168.13.2" }]) });
    expect(await network.discoverLanIpv4(null, { platform: "linux", runner, interfaces, physicalDevice: async () => true })).toBe(expected);
  }
});

test("Linux discovery excludes linkdown routes even when an old address remains", async () => {
  const runner = async (_file, args) => ({ stdout: JSON.stringify(args.includes("address")
    ? [{ ifname: "eth0", operstate: "DOWN", addr_info: [{ family: "inet", local: "192.168.13.35", preferred_life_time: 3600 }] }]
    : [{ dev: "eth0", gateway: "192.168.13.2", flags: ["linkdown"] }]) });
  const interfaces = { eth0: [{ family: "IPv4", internal: false, address: "192.168.13.35" }] };
  expect(await network.discoverLanIpv4(null, { platform: "linux", runner, interfaces, physicalDevice: async () => true })).toBeNull();
  expect(await network.discoverLanIpv4("eth0", { platform: "linux", runner, interfaces, physicalDevice: async () => true })).toBeNull();
});

test("macOS explicit hardware interface permits an isolated LAN without a default route", async () => {
  const runner = async file => {
    if (file === "route") throw new Error("no default route");
    return { stdout: "Hardware Port: Wi-Fi\nDevice: en0\n" };
  };
  const interfaces = { en0: [{ family: "IPv4", internal: false, address: "10.0.0.12" }] };
  expect(await network.discoverLanIpv4(null, { platform: "darwin", runner, interfaces })).toBeNull();
  expect(await network.discoverLanIpv4("en0", { platform: "darwin", runner, interfaces })).toBe("10.0.0.12");
});

test("macOS uses the physical LAN gateway when a VPN owns the default route", async () => {
  const runner = async file => ({ stdout: file === "networksetup"
    ? "Hardware Port: Wi-Fi\nDevice: en0\n"
    : file === "netstat" ? "Destination Gateway Flags Netif Expire\ndefault 10.0.0.1 UGScIg en0\ndefault link#12 UCSg utun3\n"
    : "gateway: 100.64.0.1\ninterface: utun3\n" });
  const interfaces = { en0: [{ family: "IPv4", internal: false, address: "10.0.0.12" }] };
  expect(await network.discoverLanIpv4(null, { platform: "darwin", runner, interfaces })).toBe("10.0.0.12");
});
