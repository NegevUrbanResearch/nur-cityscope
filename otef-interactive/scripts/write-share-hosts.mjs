import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { httpOrigin, mdnsLabelFromHostname } from "../frontend/src/shared/share-origin.js";

const execFileAsync = promisify(execFile);
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

function requirePort(port) {
  if (typeof port !== "number" || !Number.isFinite(port)) {
    throw new Error("port is required");
  }
  return port;
}

function readFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) return null;
  return args[index + 1];
}

async function readTailnetIpv4() {
  try {
    const { stdout } = await execFileAsync("tailscale", ["ip", "-4"]);
    const line = String(stdout || "").trim();
    return IPV4.test(line) ? line : null;
  } catch {
    return null;
  }
}

export function selectHotspotIpv4(records) {
  const candidates = Array.isArray(records) ? records : [records];
  const usable = candidates.find((record) =>
    String(record?.adapterStatus || "").toLowerCase() === "up" &&
    String(record?.addressState || "").toLowerCase() === "preferred" &&
    IPV4.test(record?.ipAddress),
  );
  return usable?.ipAddress ?? null;
}

async function discoverHotspotIpv4(alias) {
  if (process.platform !== "win32") return null;
  const script = `$ErrorActionPreference='Stop'; $a=Get-NetAdapter -IncludeHidden -Name $env:OTEF_HOTSPOT_INTERFACE -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1; if (-not $a) { '[]'; exit 0 }; Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $a.ifIndex -ErrorAction SilentlyContinue | Where-Object { $_.AddressState -eq 'Preferred' } | Select-Object @{Name='adapterStatus';Expression={[string]$a.Status}}, @{Name='addressState';Expression={[string]$_.AddressState}}, @{Name='ipAddress';Expression={[string]$_.IPAddress}} | ConvertTo-Json -Compress`;
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      env: { ...process.env, OTEF_HOTSPOT_INTERFACE: alias },
    });
    const addresses = JSON.parse(String(stdout || "null"));
    return selectHotspotIpv4(addresses);
  } catch {
    return null;
  }
}

async function readHotspotConfig(repositoryRoot) {
  const configPath = path.join(repositoryRoot, "otef-interactive", "scripts", "hotspot-config.local.json");
  let contents;
  try {
    contents = await readFile(configPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
  return JSON.parse(contents);
}

function flagValue(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? { present: false, value: null } : { present: true, value: args[index + 1] ?? null };
}

export function resolveHotspotOptions(config = {}, args = []) {
  if (Object.hasOwn(config, "ipv4") && (typeof config.ipv4 !== "string" || !IPV4.test(config.ipv4))) {
    throw new Error("invalid hotspot IPv4 in scripts/hotspot-config.local.json");
  }
  const interfaceFlag = flagValue(args, "--hotspot-interface");
  const ipFlag = flagValue(args, "--hotspot-ip");
  if (ipFlag.present && (typeof ipFlag.value !== "string" || !IPV4.test(ipFlag.value))) {
    throw new Error("invalid hotspot IPv4 supplied to --hotspot-ip");
  }
  if (interfaceFlag.present && (typeof interfaceFlag.value !== "string" || !interfaceFlag.value.trim())) {
    throw new Error("missing interface alias supplied to --hotspot-interface");
  }
  const configuredAlias = typeof config.interfaceAlias === "string" && config.interfaceAlias.trim() ? config.interfaceAlias.trim() : null;
  const interfaceAlias = interfaceFlag.present ? interfaceFlag.value.trim() : configuredAlias;
  const ipv4 = ipFlag.present ? ipFlag.value : interfaceFlag.present ? null : config.ipv4 ?? null;
  return { interfaceAlias, ipv4 };
}

export async function writeShareHosts({ runtimePath, hostname, port, tailnetIp, hotspotInterface = null, hotspotIpv4 = null, discoverIpv4 = discoverHotspotIpv4 }) {
  const publishedPort = requirePort(port);
  let localOrigin;
  let localKind;
  if (hotspotIpv4 && IPV4.test(hotspotIpv4)) {
    localOrigin = httpOrigin(hotspotIpv4, publishedPort);
    localKind = "hotspot";
  } else if (hotspotInterface) {
    const hotspotIp = await discoverIpv4(hotspotInterface);
    localOrigin = hotspotIp && IPV4.test(hotspotIp) ? httpOrigin(hotspotIp, publishedPort) : null;
    localKind = "hotspot";
  } else {
    localOrigin = httpOrigin(`${mdnsLabelFromHostname(hostname)}.local`, publishedPort);
    if (!localOrigin) throw new Error("unable to build local share origin");
  }
  const tailnetOrigin = tailnetIp == null ? null : httpOrigin(String(tailnetIp), publishedPort);
  const payload = { localOrigin, tailnetOrigin, ...(localKind ? { localKind } : {}) };
  await mkdir(path.dirname(runtimePath), { recursive: true });
  await writeFile(runtimePath, JSON.stringify(payload), "utf8");
  return payload;
}

async function main(args = process.argv.slice(2)) {
  const portText = readFlag(args, "--port");
  if (portText == null || portText === "") {
    throw new Error("missing required --port");
  }
  const port = Number(portText);
  if (!Number.isFinite(port)) {
    throw new Error("missing required --port");
  }
  const repositoryRoot = readFlag(args, "--repository-root");
  if (!repositoryRoot) {
    throw new Error("missing required --repository-root");
  }
  const runtimePath = path.join(repositoryRoot, "otef-interactive", "frontend", "runtime", "share.json");
  const hotspotOptions = resolveHotspotOptions(await readHotspotConfig(repositoryRoot), args);
  await writeShareHosts({
    runtimePath,
    hostname: os.hostname(),
    port,
    tailnetIp: await readTailnetIpv4(),
    hotspotInterface: hotspotOptions.interfaceAlias,
    hotspotIpv4: hotspotOptions.ipv4,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  });
}
