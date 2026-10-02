import http from "node:http";
import { pathToFileURL } from "node:url";
import { ARCHIVE_PAGE_SCROLL_EVAL } from "../frontend/src/shared/nli-archive-page-scroll.js";

const ORIGIN_PATTERN = /^http:\/\/localhost(?::\d+)?$/;
const BODY_LIMIT = 2048;
const EVALUATE_TIMEOUT_MS = 800;
const DEDUPE_MS = 2000;

export function selectNliPageTarget(targets) {
  if (!Array.isArray(targets)) return null;
  const matches = [];
  for (const target of targets) {
    if (!target || target.type !== "page" || typeof target.url !== "string") continue;
    try {
      if (new URL(target.url).host !== "www.nli.org.il") continue;
    } catch {
      continue;
    }
    matches.push(target);
  }
  return matches.length === 1 ? matches[0] : null;
}

function scrollExpression(direction) {
  return `(() => {\n  const direction = ${JSON.stringify(direction)};\n  return (${ARCHIVE_PAGE_SCROLL_EVAL});\n})()`;
}

function corsHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    vary: "Origin",
  };
}

function writeEmpty(res, status, headers = {}) {
  res.writeHead(status, headers);
  res.end();
}

function writeJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...headers,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function discard(req) {
  req.resume();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > BODY_LIMIT) {
      reject(new Error("invalid_json"));
      discard(req);
      return;
    }
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > BODY_LIMIT) {
        failed = true;
        reject(new Error("invalid_json"));
        discard(req);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!failed) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (error) => {
      if (!failed) {
        failed = true;
        reject(error);
      }
    });
  });
}

function claimRequest(recent, requestId) {
  const now = Date.now();
  for (const [key, at] of recent) {
    if (now - at > DEDUPE_MS) recent.delete(key);
  }
  const at = recent.get(requestId);
  if (at != null && now - at <= DEDUPE_MS) return false;
  recent.set(requestId, now);
  return true;
}

async function evaluateScroll(webSocketImpl, url, direction, ids) {
  const id = ids.next;
  ids.next += 1;
  let socket;
  const listeners = [];
  const listen = (type, listener) => {
    listeners.push([type, listener]);
    socket.addEventListener(type, listener);
  };
  try {
    socket = new webSocketImpl(url);
    await new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(() => reject(new Error("timeout"))), EVALUATE_TIMEOUT_MS);
      function finish(settle) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        settle();
      }
      let sent = false;
      const sendEvaluate = () => {
        if (sent || settled) return;
        sent = true;
        try {
          socket.send(JSON.stringify({
            id,
            method: "Runtime.evaluate",
            params: { expression: scrollExpression(direction), returnByValue: true },
          }));
        } catch (error) {
          finish(() => reject(error));
        }
      };
      listen("message", (event) => {
        const data = typeof event?.data === "string" ? event.data : null;
        if (!data) return;
        let message;
        try {
          message = JSON.parse(data);
        } catch {
          return;
        }
        if (message.id !== id) return;
        if (message.error || message.result?.exceptionDetails) finish(() => reject(new Error("protocol")));
        else finish(() => resolve(message));
      });
      listen("error", () => finish(() => reject(new Error("socket"))));
      listen("close", () => finish(() => reject(new Error("closed"))));
      listen("open", sendEvaluate);
      if (socket.readyState === 1) sendEvaluate();
    });
  } finally {
    if (socket) {
      for (const [type, listener] of listeners) {
        socket.removeEventListener?.(type, listener);
      }
      try { socket.close(); } catch {}
    }
  }
}

async function pageTarget({ cdpOrigin, fetchImpl, webSocketImpl, ids, direction }) {
  let response;
  try {
    response = await fetchImpl(`${cdpOrigin}/json/list`);
  } catch {
    throw new Error("cdp");
  }
  if (!response?.ok) throw new Error("cdp");
  let targets;
  try {
    targets = await response.json();
  } catch {
    throw new Error("cdp");
  }
  const target = selectNliPageTarget(targets);
  if (!target) return false;
  if (typeof target.webSocketDebuggerUrl !== "string" || !target.webSocketDebuggerUrl) throw new Error("cdp");
  await evaluateScroll(webSocketImpl, target.webSocketDebuggerUrl, direction, ids);
  return true;
}

async function route(req, res, context) {
  req.on("error", () => {});
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  const allowed = ORIGIN_PATTERN.test(origin);
  const headers = allowed ? corsHeaders(origin) : {};
  if (!allowed) {
    discard(req);
    writeEmpty(res, 403);
    return;
  }

  const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
  if (pathname !== "/page") {
    discard(req);
    writeEmpty(res, 404, headers);
    return;
  }
  if (req.method === "OPTIONS") {
    discard(req);
    writeEmpty(res, 204, headers);
    return;
  }
  if (req.method !== "POST") {
    discard(req);
    writeEmpty(res, 405, { ...headers, allow: "POST, OPTIONS" });
    return;
  }

  let text;
  try {
    text = await readBody(req);
  } catch {
    writeJson(res, 400, { ok: false, reason: "invalid_json" }, headers);
    return;
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    writeJson(res, 400, { ok: false, reason: "invalid_json" }, headers);
    return;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    writeJson(res, 400, { ok: false, reason: "invalid_json" }, headers);
    return;
  }
  const { direction, requestId } = payload;
  if (typeof requestId !== "string" || requestId.length === 0 || requestId.length > 128) {
    writeJson(res, 400, { ok: false, reason: "invalid_json" }, headers);
    return;
  }
  if (direction !== "up" && direction !== "down") {
    writeJson(res, 400, { ok: false, reason: "invalid_direction" }, headers);
    return;
  }
  if (!claimRequest(context.recent, requestId)) {
    writeJson(res, 200, { ok: true, reason: "duplicate" }, headers);
    return;
  }

  try {
    const evaluated = await pageTarget({ ...context, direction });
    writeJson(res, 200, evaluated ? { ok: true } : { ok: false, reason: "no_unique_target" }, headers);
  } catch {
    if (!res.headersSent) writeJson(res, 200, { ok: false, reason: "cdp_unavailable" }, headers);
  }
}

export async function createNliArchivePager({
  port = 7733,
  cdpOrigin = "http://127.0.0.1:9222",
  fetchImpl = globalThis.fetch,
  webSocketImpl = globalThis.WebSocket,
  listen = true,
} = {}) {
  const context = { cdpOrigin, fetchImpl, webSocketImpl, recent: new Map(), ids: { next: 1 } };
  const handle = (req, res) => {
    route(req, res, context).catch(() => {
      if (!res.headersSent) writeJson(res, 200, { ok: false, reason: "cdp_unavailable" });
    });
  };
  const server = http.createServer(handle);
  if (listen) {
    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      server.once("error", onError);
      server.listen({ host: "127.0.0.1", port }, () => {
        server.removeListener("error", onError);
        resolve();
      });
    });
  }
  const listening = listen ? server.address() : null;
  let closed = false;
  return {
    port: listening?.port ?? null,
    address: listening?.address ?? null,
    handle,
    async close() {
      if (closed || !listen) return;
      closed = true;
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createNliArchivePager().catch((error) => {
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  });
}
