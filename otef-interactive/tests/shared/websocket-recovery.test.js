import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { OTEFWebSocketClient } from "../../frontend/src/shared/websocket-client.js";

let sockets;
class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  constructor() { this.readyState = 0; sockets.push(this); }
  close() { this.readyState = 3; }
  open() { this.readyState = 1; this.onopen(); }
}
beforeEach(() => {
  sockets = [];
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("window", { location: { protocol: "http:", host: "remote.test" } });
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

test.each(["open", "connecting"])("restart replaces a stale %s socket and ignores retired events", (state) => {
  const onDisconnect = vi.fn();
  const client = new OTEFWebSocketClient("/ws/otef/", { onDisconnect });
  const message = vi.fn();
  client.on("message", message);
  client.connect();
  const old = sockets[0];
  if (state === "open") old.open();
  const late = { close: old.onclose, open: old.onopen, error: old.onerror, message: old.onmessage };
  client.restart();
  expect(sockets).toHaveLength(2);
  expect(onDisconnect).toHaveBeenCalledOnce();
  sockets[1].open();
  late.close(); late.open(); late.error({}); late.message({ data: '{"type":"old"}' });
  expect(client.getConnected()).toBe(true);
  expect(message).not.toHaveBeenCalled();
  expect(onDisconnect).toHaveBeenCalledOnce();
  vi.runAllTimers();
  expect(sockets).toHaveLength(2);
});

test("restart cancels pending backoff and later failures still retry", () => {
  const client = new OTEFWebSocketClient("/ws/otef/");
  client.connect(); sockets[0].open(); sockets[0].close(); sockets[0].onclose();
  client.restart(); sockets[1].open();
  vi.advanceTimersByTime(30000);
  expect(sockets).toHaveLength(2);
  sockets[1].close(); sockets[1].onclose();
  vi.advanceTimersByTime(3000);
  expect(sockets).toHaveLength(3);
});

test("intentional disconnect does not reconnect from a delayed close", () => {
  const client = new OTEFWebSocketClient("/ws/otef/");
  client.connect(); sockets[0].open();
  const lateClose = sockets[0].onclose;
  client.disconnect(); lateClose(); vi.runAllTimers();
  expect(sockets).toHaveLength(1);
});

test("context recovery restores fresh shared state through the replacement socket", async () => {
  const { default: context } = await import("../../frontend/src/shared/OTEFDataContext.js");
  const { OTEF_API } = await import("../../frontend/src/shared/api-client.js");
  const getState = vi.spyOn(OTEF_API, "getState").mockResolvedValue({
    viewport: { zoom: 7, bbox: [1, 2, 3, 4] },
  });
  context._tableName = "otef";
  const statuses = [];
  const unsubscribe = context.subscribe("connectionStatus", (status) => statuses.push(status));
  context._setupWebSocket();
  expect(statuses.at(-1)).toBe("connecting");
  sockets[0].open();
  context.reconnect();
  expect(context.isConnected()).toBe(false);
  expect(statuses.at(-1)).toBe("connecting");
  sockets[1].open();
  await Promise.resolve();
  expect(context.isConnected()).toBe(true);
  expect(statuses.at(-1)).toBe("connected");
  expect(getState).toHaveBeenCalledWith("otef", { forceFresh: true });
  expect(context.getViewport().zoom).toBe(7);
  sockets[1].close(); sockets[1].onclose();
  expect(statuses.at(-1)).toBe("connecting");
  expect(context.isConnected()).toBe(false);
  unsubscribe();
  context._wsClient.disconnect();
});
