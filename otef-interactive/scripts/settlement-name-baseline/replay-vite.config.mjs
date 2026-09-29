import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeConfig } from "vite";
import baseConfig from "../../vite.config.mjs";

const interactiveRoot = fileURLToPath(new URL("../..", import.meta.url));
const replayRoot = path.join(interactiveRoot, ".settlement-name-replay");
const publicRoot = path.join(interactiveRoot, "public");
const dataRoot = path.join(interactiveRoot, "frontend", "data");

const STAGED_FILES = new Set([
  "input.json",
  "viewport.json",
  "projection.json",
  "artifacts/font.ttf",
  "artifacts/processed.geojson",
  "artifacts/left-live.geojson",
  "artifacts/right-live.geojson",
  "artifacts/left-mesh.json",
  "artifacts/right-mesh.json",
]);

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.statusCode = status;
  res.setHeader?.("content-type", type);
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readIfSafe(root, relative) {
  const target = path.resolve(root, relative);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(prefix)) return null;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return null;
  return fs.readFileSync(target);
}

export async function handleReplayApi(req, res, { root = replayRoot, publicDir = publicRoot, dataDir = dataRoot } = {}) {
  const method = String(req.method || "GET").toUpperCase();
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith("/api/")) {
    if (method !== "GET") {
      send(res, 405, { error: "replay api is read-only" });
      return true;
    }
    const viewport = pathname === "/api/otef_viewport/by-table/otef" || pathname === "/api/otef_viewport/by-table/otef/";
    const projection = pathname === "/api/otef/projection-config" || pathname === "/api/otef/projection-config/";
    if (!viewport && !projection) {
      send(res, 404, { error: "replay api path is not available" });
      return true;
    }
    const fileName = viewport ? "viewport.json" : "projection.json";
    const bytes = readIfSafe(root, fileName);
    if (!bytes) {
      send(res, 404, { error: `${fileName} is not staged` });
      return true;
    }
    send(res, 200, bytes);
    return true;
  }
  if (method !== "GET" && method !== "HEAD") return false;
  if (pathname.startsWith("/.settlement-name-replay/")) {
    const relative = pathname.slice("/.settlement-name-replay/".length);
    if (!STAGED_FILES.has(relative)) {
      send(res, 404, { error: "replay artifact is not available" });
      return true;
    }
    const bytes = readIfSafe(root, relative);
    if (!bytes) {
      send(res, 404, { error: "replay artifact is not staged" });
      return true;
    }
    const type = relative.endsWith(".json") || relative.endsWith(".geojson") ? "application/json; charset=utf-8" : "application/octet-stream";
    send(res, 200, bytes, type);
    return true;
  }
  if (pathname.startsWith("/otef-interactive/public/")) {
    const bytes = readIfSafe(publicDir, pathname.slice("/otef-interactive/public/".length));
    if (!bytes) {
      send(res, 404, { error: "public asset is not available" });
      return true;
    }
    send(res, 200, bytes, "application/octet-stream");
    return true;
  }
  if (pathname.startsWith("/otef-interactive/data/")) {
    const bytes = readIfSafe(dataDir, pathname.slice("/otef-interactive/data/".length));
    if (!bytes) {
      send(res, 404, { error: "data asset is not available" });
      return true;
    }
    send(res, 200, bytes, pathname.endsWith(".json") ? "application/json; charset=utf-8" : "application/octet-stream");
    return true;
  }
  return false;
}

export function handleReplayUpgrade(req, socket) {
  const url = req?.url || "";
  if (url.startsWith("/ws/")) socket.destroy();
}

export function applyReplayViteConfig(base) {
  const merged = mergeConfig(base, {
    plugins: [
      {
        name: "settlement-name-replay",
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            handleReplayApi(req, res).then((handled) => {
              if (!handled) next();
            }).catch(next);
          });
          server.httpServer?.on("upgrade", (req, socket) => {
            handleReplayUpgrade(req, socket);
          });
        },
      },
    ],
  });
  merged.server = { ...(merged.server || {}), proxy: {} };
  return merged;
}

export default applyReplayViteConfig(baseConfig);
