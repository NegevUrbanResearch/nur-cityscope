import { afterEach, expect, test } from "vitest";
import { EventEmitter } from "node:events";
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { ARCHIVE_PAGE_SCROLL_EVAL } from "../../frontend/src/shared/nli-archive-page-scroll.js";
import { createNliArchivePager, selectNliPageTarget } from "../../scripts/nli-archive-pager.mjs";

const NLI_SOCKET = "ws://127.0.0.1:9222/devtools/page/nli";
const pagers = [];

afterEach(async () => {
  await Promise.all(pagers.splice(0).map((pager) => pager.close()));
});

function boundScrollExpression(direction) {
  return `(() => {\n  const direction = ${JSON.stringify(direction)};\n  return (${ARCHIVE_PAGE_SCROLL_EVAL});\n})()`;
}

function nliPage(pathname = "/he/newspapers", webSocketDebuggerUrl = NLI_SOCKET) {
  return { type: "page", url: `https://www.nli.org.il${pathname}`, webSocketDebuggerUrl };
}

function fakeWebSocket({ open = true, onSend } = {}) {
  const sockets = [];
  function webSocketImpl(url) {
    const socket = new EventEmitter();
    socket.url = url;
    socket.sent = [];
    socket.closed = false;
    socket.addEventListener = (type, listener) => { socket.on(type, listener); };
    socket.removeEventListener = (type, listener) => { socket.off(type, listener); };
    socket.close = () => {
      if (socket.closed) return;
      socket.closed = true;
      socket.emit("close");
    };
    socket.send = (data) => {
      const message = JSON.parse(data);
      socket.sent.push(message);
      onSend?.(socket, message);
    };
    sockets.push(socket);
    queueMicrotask(() => {
      if (open && !socket.closed) socket.emit("open");
    });
    return socket;
  }
  return { sockets, webSocketImpl };
}

function replyOk(socket, message) {
  queueMicrotask(() => {
    if (socket.closed) return;
    socket.emit("message", {
      data: JSON.stringify({ id: message.id, result: { result: { type: "object", value: { scrolled: true } } } }),
    });
  });
}

function listFetch(targets) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    return { ok: true, json: async () => targets };
  };
  return { calls, fetchImpl };
}

async function start(options) {
  const pager = await createNliArchivePager({ port: 0, listen: true, ...options });
  pagers.push(pager);
  return pager;
}

function request(port, { method = "POST", path = "/page", origin = "http://localhost", body } = {}) {
  const payload = body === undefined
    ? (method === "POST" ? JSON.stringify({ direction: "down", requestId: "req-1" }) : null)
    : body;
  return new Promise((resolve, reject) => {
    const headers = {};
    if (origin != null) headers.origin = origin;
    if (payload != null) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload);
    }
    const req = http.request({ hostname: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        if (text) {
          try { json = JSON.parse(text); } catch { json = text; }
        }
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on("error", reject);
    req.end(payload ?? undefined);
  });
}

test("selectNliPageTarget keeps the single www.nli.org.il page", () => {
  const page = nliPage();
  expect(selectNliPageTarget([
    { type: "page", url: "https://example.com/" },
    { type: "iframe", url: "https://www.nli.org.il/embedded" },
    { type: "page", url: "not a url" },
    { type: "page", url: "https://nli.org.il/he" },
    { type: "browser", url: "https://www.nli.org.il/other" },
    page,
  ])).toBe(page);
  expect(selectNliPageTarget([nliPage("/a"), nliPage("/b")])).toBeNull();
  expect(selectNliPageTarget([])).toBeNull();
  expect(selectNliPageTarget(null)).toBeNull();
  expect(selectNliPageTarget([{ type: "page", url: "https://example.com/" }])).toBeNull();
});

test("selectNliPageTarget rejects explicit-port NLI URLs", () => {
  const explicit = [
    "https://www.nli.org.il:8443/he/newspapers",
    "http://www.nli.org.il:8080/he/newspapers",
    "https://www.nli.org.il:4430/he/newspapers",
  ];
  for (const url of explicit) {
    expect(selectNliPageTarget([{ type: "page", url }])).toBeNull();
  }
  const httpsPage = nliPage();
  const httpPage = { type: "page", url: "http://www.nli.org.il/he/newspapers" };
  const httpsDefaultPort = { type: "page", url: "https://www.nli.org.il:443/he/newspapers" };
  const httpDefaultPort = { type: "page", url: "http://www.nli.org.il:80/he/newspapers" };
  expect(selectNliPageTarget([httpsPage])).toBe(httpsPage);
  expect(selectNliPageTarget([httpPage])).toBe(httpPage);
  expect(selectNliPageTarget([httpsDefaultPort])).toBe(httpsDefaultPort);
  expect(selectNliPageTarget([httpDefaultPort])).toBe(httpDefaultPort);
});

test("unique NLI page target evaluates the bound scroll expression and closes the socket", async () => {
  const { sockets, webSocketImpl } = fakeWebSocket({ onSend: replyOk });
  const { calls, fetchImpl } = listFetch([
    { type: "page", url: "https://example.com/" },
    nliPage(),
    { type: "iframe", url: "https://www.nli.org.il/embedded", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/frame" },
  ]);
  const pager = await start({ fetchImpl, webSocketImpl });
  expect(pager.address).toBe("127.0.0.1");

  const down = await request(pager.port, { body: JSON.stringify({ direction: "down", requestId: "down-1" }) });
  expect(down.status).toBe(200);
  expect(down.json).toEqual({ ok: true });
  expect(down.headers["access-control-allow-origin"]).toBe("http://localhost");
  expect(calls).toEqual(["http://127.0.0.1:9222/json/list"]);
  expect(sockets).toHaveLength(1);
  expect(sockets[0].url).toBe(NLI_SOCKET);
  expect(sockets[0].closed).toBe(true);
  expect(sockets[0].sent).toEqual([{
    id: 1,
    method: "Runtime.evaluate",
    params: { expression: boundScrollExpression("down"), returnByValue: true },
  }]);
  expect(sockets[0].sent[0].params.expression).toContain("www.nli.org.il");
  expect(() => new Function(`return (${sockets[0].sent[0].params.expression});`)).not.toThrow();

  const up = await request(pager.port, { body: JSON.stringify({ direction: "up", requestId: "up-1" }) });
  expect(up.json).toEqual({ ok: true });
  expect(sockets[1].sent[0]).toMatchObject({
    id: 2,
    method: "Runtime.evaluate",
    params: { expression: boundScrollExpression("up") },
  });
  expect(sockets[1].closed).toBe(true);
});

test("two NLI pages do not open a websocket", async () => {
  const { sockets, webSocketImpl } = fakeWebSocket({ onSend: replyOk });
  const { fetchImpl } = listFetch([nliPage("/a", "ws://a"), nliPage("/b", "ws://b")]);
  const pager = await start({ fetchImpl, webSocketImpl });
  const response = await request(pager.port, { body: JSON.stringify({ direction: "down", requestId: "two" }) });
  expect(response.status).toBe(200);
  expect(response.json).toEqual({ ok: false, reason: "no_unique_target" });
  expect(sockets).toHaveLength(0);
});

test("zero NLI pages do not open a websocket", async () => {
  const { sockets, webSocketImpl } = fakeWebSocket({ onSend: replyOk });
  const { fetchImpl } = listFetch([]);
  const pager = await start({ fetchImpl, webSocketImpl });
  const response = await request(pager.port, { body: JSON.stringify({ direction: "up", requestId: "none" }) });
  expect(response.json).toEqual({ ok: false, reason: "no_unique_target" });
  expect(sockets).toHaveLength(0);
});

test("example.com does not count as an NLI target", async () => {
  const { sockets, webSocketImpl } = fakeWebSocket({ onSend: replyOk });
  const { fetchImpl } = listFetch([
    { type: "page", url: "https://example.com/article", webSocketDebuggerUrl: "ws://example" },
  ]);
  const pager = await start({ fetchImpl, webSocketImpl });
  const response = await request(pager.port, { body: JSON.stringify({ direction: "down", requestId: "example" }) });
  expect(response.json).toEqual({ ok: false, reason: "no_unique_target" });
  expect(sockets).toHaveLength(0);
});

test("invalid direction returns 400 invalid_direction", async () => {
  const { sockets, webSocketImpl } = fakeWebSocket({ onSend: replyOk });
  const { fetchImpl } = listFetch([nliPage()]);
  const pager = await start({ fetchImpl, webSocketImpl });
  const sideways = await request(pager.port, { body: JSON.stringify({ direction: "left", requestId: "bad-dir" }) });
  expect(sideways.status).toBe(400);
  expect(sideways.json).toEqual({ ok: false, reason: "invalid_direction" });
  const missing = await request(pager.port, { body: JSON.stringify({ requestId: "no-dir" }) });
  expect(missing.json).toEqual({ ok: false, reason: "invalid_direction" });
  expect(sockets).toHaveLength(0);
});

test("missing origin returns 403", async () => {
  const { sockets, webSocketImpl } = fakeWebSocket({ onSend: replyOk });
  const { calls, fetchImpl } = listFetch([nliPage()]);
  const pager = await start({ fetchImpl, webSocketImpl });
  const missing = await request(pager.port, { origin: null, body: JSON.stringify({ direction: "down", requestId: "no-origin" }) });
  expect(missing.status).toBe(403);
  const foreign = await request(pager.port, { origin: "http://127.0.0.1:5173", body: JSON.stringify({ direction: "down", requestId: "foreign" }) });
  expect(foreign.status).toBe(403);
  const secure = await request(pager.port, { origin: "https://localhost", body: JSON.stringify({ direction: "down", requestId: "secure" }) });
  expect(secure.status).toBe(403);
  expect(calls).toEqual([]);
  expect(sockets).toHaveLength(0);
});

test("duplicate requestId does not evaluate again", async () => {
  const { sockets, webSocketImpl } = fakeWebSocket({ onSend: replyOk });
  const { fetchImpl } = listFetch([nliPage()]);
  const pager = await start({ fetchImpl, webSocketImpl });
  const body = JSON.stringify({ direction: "down", requestId: "same" });
  expect((await request(pager.port, { body })).json).toEqual({ ok: true });
  const duplicate = await request(pager.port, { body });
  expect(duplicate.status).toBe(200);
  expect(duplicate.json).toEqual({ ok: true, reason: "duplicate" });
  expect(sockets).toHaveLength(1);
  expect(sockets[0].sent).toHaveLength(1);
});

test("same requestId evaluates again after 2 seconds", async () => {
  const { sockets, webSocketImpl } = fakeWebSocket({ onSend: replyOk });
  const { fetchImpl } = listFetch([nliPage()]);
  const pager = await start({ fetchImpl, webSocketImpl });
  const body = JSON.stringify({ direction: "down", requestId: "later" });
  expect((await request(pager.port, { body })).json).toEqual({ ok: true });
  await delay(2100);
  expect((await request(pager.port, { body })).json).toEqual({ ok: true });
  expect(sockets).toHaveLength(2);
  expect(sockets.map((socket) => socket.sent[0].id)).toEqual([1, 2]);
});

test("websocket error returns cdp_unavailable and closes the socket", async () => {
  const { sockets, webSocketImpl } = fakeWebSocket({
    onSend(socket) {
      socket.emit("error", new Error("reset"));
    },
  });
  const { fetchImpl } = listFetch([nliPage()]);
  const pager = await start({ fetchImpl, webSocketImpl });
  const response = await request(pager.port, { body: JSON.stringify({ direction: "down", requestId: "ws-error" }) });
  expect(response.status).toBe(200);
  expect(response.json).toEqual({ ok: false, reason: "cdp_unavailable" });
  expect(sockets[0].closed).toBe(true);
});

test("evaluate timeout returns cdp_unavailable and closes the socket", async () => {
  const { sockets, webSocketImpl } = fakeWebSocket();
  const { fetchImpl } = listFetch([nliPage()]);
  const pager = await start({ fetchImpl, webSocketImpl });
  const started = Date.now();
  const response = await request(pager.port, { body: JSON.stringify({ direction: "down", requestId: "slow" }) });
  expect(Date.now() - started).toBeGreaterThanOrEqual(700);
  expect(response.json).toEqual({ ok: false, reason: "cdp_unavailable" });
  expect(sockets[0].closed).toBe(true);
});

test("protocol error and premature close return cdp_unavailable and close the socket", async () => {
  const protocol = fakeWebSocket({
    onSend(socket, message) {
      queueMicrotask(() => {
        socket.emit("message", { data: JSON.stringify({ id: message.id, error: { message: "Inspected target closed" } }) });
      });
    },
  });
  const protocolPager = await start({ fetchImpl: listFetch([nliPage()]).fetchImpl, webSocketImpl: protocol.webSocketImpl });
  const protocolResponse = await request(protocolPager.port, { body: JSON.stringify({ direction: "down", requestId: "protocol" }) });
  expect(protocolResponse.json).toEqual({ ok: false, reason: "cdp_unavailable" });
  expect(protocol.sockets[0].closed).toBe(true);

  const closed = fakeWebSocket({
    onSend(socket) {
      queueMicrotask(() => socket.emit("close"));
    },
  });
  const closedPager = await start({ fetchImpl: listFetch([nliPage()]).fetchImpl, webSocketImpl: closed.webSocketImpl });
  const closedResponse = await request(closedPager.port, { body: JSON.stringify({ direction: "up", requestId: "premature" }) });
  expect(closedResponse.json).toEqual({ ok: false, reason: "cdp_unavailable" });
  expect(closed.sockets[0].closed).toBe(true);
});

test("json list failure returns cdp_unavailable", async () => {
  const { sockets, webSocketImpl } = fakeWebSocket({ onSend: replyOk });
  const pager = await start({
    fetchImpl: async () => { throw new Error("ECONNREFUSED"); },
    webSocketImpl,
  });
  const response = await request(pager.port, { body: JSON.stringify({ direction: "down", requestId: "no-cdp" }) });
  expect(response.status).toBe(200);
  expect(response.json).toEqual({ ok: false, reason: "cdp_unavailable" });
  expect(sockets).toHaveLength(0);
});

test("OPTIONS and POST echo the localhost origin", async () => {
  const origin = "http://localhost:5173";
  const { webSocketImpl } = fakeWebSocket({ onSend: replyOk });
  const pager = await start({ fetchImpl: listFetch([nliPage()]).fetchImpl, webSocketImpl });
  const preflight = await request(pager.port, { method: "OPTIONS", origin, body: null });
  expect(preflight.status).toBe(204);
  expect(preflight.headers["access-control-allow-origin"]).toBe(origin);
  expect(preflight.headers["access-control-allow-methods"]).toMatch(/POST/);
  expect(preflight.headers["access-control-allow-headers"]).toMatch(/content-type/i);
  const posted = await request(pager.port, { origin, body: JSON.stringify({ direction: "down", requestId: "cors" }) });
  expect(posted.status).toBe(200);
  expect(posted.headers["access-control-allow-origin"]).toBe(origin);
});

test("unknown path returns 404", async () => {
  const pager = await start({ fetchImpl: listFetch([]).fetchImpl, webSocketImpl: fakeWebSocket().webSocketImpl });
  const response = await request(pager.port, { method: "POST", path: "/scroll", body: "{}" });
  expect(response.status).toBe(404);
});

test("GET /page returns 405", async () => {
  const pager = await start({ fetchImpl: listFetch([]).fetchImpl, webSocketImpl: fakeWebSocket().webSocketImpl });
  const response = await request(pager.port, { method: "GET", body: null });
  expect(response.status).toBe(405);
});

test("oversized or invalid JSON returns invalid_json", async () => {
  const { sockets, webSocketImpl } = fakeWebSocket({ onSend: replyOk });
  const pager = await start({ fetchImpl: listFetch([nliPage()]).fetchImpl, webSocketImpl });
  const broken = await request(pager.port, { body: "{" });
  expect(broken.status).toBe(400);
  expect(broken.json).toEqual({ ok: false, reason: "invalid_json" });
  const oversized = await request(pager.port, { body: "x".repeat(2049) });
  expect(oversized.status).toBe(400);
  expect(oversized.json).toEqual({ ok: false, reason: "invalid_json" });
  expect(sockets).toHaveLength(0);
});

test("requestId is required and at most 128 characters", async () => {
  const { sockets, webSocketImpl } = fakeWebSocket({ onSend: replyOk });
  const pager = await start({ fetchImpl: listFetch([nliPage()]).fetchImpl, webSocketImpl });
  const missing = await request(pager.port, { body: JSON.stringify({ direction: "down" }) });
  expect(missing.status).toBe(400);
  expect(missing.json).toEqual({ ok: false, reason: "invalid_json" });
  const numeric = await request(pager.port, { body: JSON.stringify({ direction: "down", requestId: 12 }) });
  expect(numeric.json).toEqual({ ok: false, reason: "invalid_json" });
  const empty = await request(pager.port, { body: JSON.stringify({ direction: "down", requestId: "" }) });
  expect(empty.json).toEqual({ ok: false, reason: "invalid_json" });
  const tooLong = await request(pager.port, { body: JSON.stringify({ direction: "down", requestId: "r".repeat(129) }) });
  expect(tooLong.json).toEqual({ ok: false, reason: "invalid_json" });
  expect(sockets).toHaveLength(0);
  const accepted = await request(pager.port, { body: JSON.stringify({ direction: "down", requestId: "r".repeat(128) }) });
  expect(accepted.json).toEqual({ ok: true });
});
