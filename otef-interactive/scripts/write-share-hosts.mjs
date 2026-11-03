import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { isIP } from "node:net";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { httpOrigin } from "../frontend/src/shared/share-origin.js";
import { discoverLanIpv4, isLanIpv4 } from "./discover-lan.mjs";

const execFileAsync = promisify(execFile);

function requirePort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("valid published port is required");
  return port;
}

function readFlag(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1] ?? null;
}

export function resolveLanInterface(args = []) {
  if (!args.includes("--lan-interface")) return null;
  const value = readFlag(args, "--lan-interface");
  if (!value?.trim() || value.startsWith("--")) throw new Error("missing LAN interface supplied to --lan-interface");
  return value.trim();
}

async function readTailnetIpv4() {
  try {
    const { stdout } = await execFileAsync("tailscale", ["ip", "-4"], { timeout: 5000, windowsHide: true });
    const ip = String(stdout || "").trim();
    return isIP(ip) === 4 ? ip : null;
  } catch { return null; }
}

export async function writeShareHosts({ runtimePath, port, tailnetIp, lanInterface = null, discoverIpv4 = discoverLanIpv4 }) {
  const publishedPort = requirePort(port);
  const lanIp = await discoverIpv4(lanInterface);
  const localOrigin = isLanIpv4(lanIp) ? httpOrigin(lanIp, publishedPort) : null;
  const tailnetOrigin = typeof tailnetIp === "string" && isIP(tailnetIp) === 4 ? httpOrigin(tailnetIp, publishedPort) : null;
  const payload = { localOrigin, tailnetOrigin, localKind: "lan" };
  await mkdir(path.dirname(runtimePath), { recursive: true });
  await writeFile(runtimePath, JSON.stringify(payload), "utf8");
  return payload;
}

async function main(args = process.argv.slice(2)) {
  const portText = readFlag(args, "--port");
  if (!portText) throw new Error("missing required --port");
  const repositoryRoot = readFlag(args, "--repository-root");
  if (!repositoryRoot) throw new Error("missing required --repository-root");
  const payload = await writeShareHosts({
    runtimePath: path.join(repositoryRoot, "otef-interactive", "frontend", "runtime", "share.json"),
    port: Number(portText), tailnetIp: await readTailnetIpv4(), lanInterface: resolveLanInterface(args),
  });
  console.log(`Remote LAN: ${payload.localOrigin || "unavailable"}; Tailscale: ${payload.tailnetOrigin || "unavailable"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error?.stack || error); process.exitCode = 1; });
}
