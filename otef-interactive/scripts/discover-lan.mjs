import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import os from "node:os";
import { isIP } from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VIRTUAL_NAME = /tailscale|vpn|vmware|vethernet|hyper-v|virtual|wi-fi direct|local area connection\*|hotspot|bridge|docker|veth|utun/i;
const PROCESS_OPTIONS = { timeout: 10000, windowsHide: true };

export function isLanIpv4(ip) {
  if (typeof ip !== "string" || isIP(ip) !== 4) return false;
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function selectLanIpv4(records, interfaceAlias = null) {
  const candidates = (Array.isArray(records) ? records : [records]).filter(record =>
    record?.physical === true &&
    String(record.adapterStatus).toLowerCase() === "up" &&
    String(record.addressState).toLowerCase() === "preferred" &&
    !VIRTUAL_NAME.test(`${record.interfaceAlias} ${record.description || ""}`) &&
    isLanIpv4(record.ipAddress) &&
    (interfaceAlias ? record.interfaceAlias === interfaceAlias : isLanIpv4(record.gateway)),
  );
  const metric = record => (Number(record.routeMetric) || 0) + (Number(record.interfaceMetric) || 0);
  candidates.sort((a, b) => metric(a) - metric(b) || String(a.interfaceAlias).localeCompare(String(b.interfaceAlias)) || a.ipAddress.localeCompare(b.ipAddress));
  return candidates[0]?.ipAddress ?? null;
}

const WINDOWS_DISCOVERY = `
$ErrorActionPreference = 'Stop'
$records = @(foreach ($adapter in (Get-NetAdapter -Physical)) {
  if ($adapter.Status -ne 'Up') { continue }
  $iface = Get-NetIPInterface -AddressFamily IPv4 -InterfaceIndex $adapter.ifIndex
  $route = Get-NetRoute -AddressFamily IPv4 -InterfaceIndex $adapter.ifIndex -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1
  foreach ($ip in (Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $adapter.ifIndex)) {
    if ($ip.SkipAsSource) { continue }
    [pscustomobject]@{
      interfaceAlias = [string]$adapter.Name
      description = [string]$adapter.InterfaceDescription
      physical = [bool]$adapter.HardwareInterface
      adapterStatus = [string]$adapter.Status
      addressState = [string]$ip.AddressState
      ipAddress = [string]$ip.IPAddress
      gateway = [string]$route.NextHop
      routeMetric = $route.RouteMetric
      interfaceMetric = $iface.InterfaceMetric
    }
  }
})
ConvertTo-Json -InputObject $records -Compress
`;

function deviceRecords(interfaces, device, alias, gateway = null, routeMetric = 0) {
  return (interfaces[device] || []).filter(ip => ip.family === "IPv4" && !ip.internal).map(ip => ({
    interfaceAlias: alias, physical: true, adapterStatus: "Up", addressState: "Preferred",
    ipAddress: ip.address, gateway, routeMetric,
  }));
}

export async function discoverLanIpv4(interfaceAlias = null, {
  platform = process.platform, runner = execFileAsync, interfaces = os.networkInterfaces(),
  physicalDevice = async device => { try { await access(`/sys/class/net/${device}/device`); return true; } catch { return false; } },
} = {}) {
  const run = async (file, args) => (await runner(file, args, PROCESS_OPTIONS)).stdout;
  try {
    if (platform === "win32") {
      return selectLanIpv4(JSON.parse(await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_DISCOVERY])), interfaceAlias);
    }
    if (platform === "darwin") {
      const hardware = await run("networksetup", ["-listallhardwareports"]);
      const route = await run("route", ["-n", "get", "default"]).catch(() => "");
      const defaultDevice = route.match(/interface:\s*(\S+)/)?.[1];
      const gateway = route.match(/gateway:\s*(\S+)/)?.[1];
      const routes = (await run("netstat", ["-rn", "-f", "inet"]).catch(() => "")).split(/\r?\n/).map(line => line.trim().split(/\s+/));
      const records = [];
      for (const match of hardware.matchAll(/Hardware Port:\s*([^\n]+)\nDevice:\s*(\S+)/g)) {
        const [, label, device] = match;
        if (VIRTUAL_NAME.test(label) || (interfaceAlias && interfaceAlias !== device && interfaceAlias !== label.trim())) continue;
        const lanRoute = routes.find(row => row[0] === "default" && row.includes(device) && isLanIpv4(row[1]));
        records.push(...deviceRecords(interfaces, device, interfaceAlias || label.trim(), lanRoute?.[1] || (device === defaultDevice ? gateway : null), device === defaultDevice ? 0 : 1));
      }
      return selectLanIpv4(records, interfaceAlias);
    }
    if (platform === "linux") {
      const routes = JSON.parse(await run("ip", ["-json", "-4", "route", "show", "default"]));
      const links = JSON.parse(await run("ip", ["-json", "-4", "address", "show"]));
      const records = [];
      for (const link of links) {
        const device = link.ifname;
        if (link.operstate !== "UP") continue;
        if (!await physicalDevice(device)) continue;
        const route = routes.filter(item => item.dev === device && !item.flags?.includes("linkdown")).sort((a, b) => (a.metric || 0) - (b.metric || 0))[0];
        for (const ip of link.addr_info || []) {
          if (ip.family !== "inet" || ip.preferred_life_time === 0 || ip.tentative || ip.dadfailed) continue;
          records.push({ interfaceAlias: device, physical: true, adapterStatus: "Up", addressState: "Preferred", ipAddress: ip.local, gateway: route?.gateway, routeMetric: route?.metric });
        }
      }
      return selectLanIpv4(records, interfaceAlias);
    }
  } catch {
    // Never publish a guessed address if native discovery is unavailable.
  }
  return null;
}
