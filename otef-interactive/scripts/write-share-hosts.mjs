import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
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

export async function writeShareHosts({ runtimePath, hostname, port, tailnetIp }) {
  const publishedPort = requirePort(port);
  const localOrigin = httpOrigin(`${mdnsLabelFromHostname(hostname)}.local`, publishedPort);
  if (!localOrigin) {
    throw new Error("unable to build local share origin");
  }
  const tailnetOrigin = tailnetIp == null ? null : httpOrigin(String(tailnetIp), publishedPort);
  const payload = { localOrigin, tailnetOrigin };
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
  await writeShareHosts({
    runtimePath,
    hostname: os.hostname(),
    port,
    tailnetIp: await readTailnetIpv4(),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  });
}
