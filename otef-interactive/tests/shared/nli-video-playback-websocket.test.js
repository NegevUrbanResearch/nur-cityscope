import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createNliVideoPlaybackPublisher, subscribeNliVideoPlayback } from "../../frontend/src/shared/nli-video-playback-channel.js";

let clients;
class Client {
  constructor(url) { this.url = url; this.listeners = new Map(); this.connected = false; clients.push(this); }
  on(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  off(type, listener) {
    this.listeners.get(type)?.delete(listener);
    if (this.listeners.get(type)?.size === 0) this.listeners.delete(type);
  }
  emit(type, data) { for (const listener of this.listeners.get(type) || []) listener(data); }
  connect() { this.connected = true; this.emit("connect"); }
  getConnected() { return this.connected; }
  disconnect() { this.connected = false; }
  send(message) {
    for (const client of clients) if (client.connected && client.url === this.url) {
      client.emit(message.type, structuredClone(message));
      client.emit("message", structuredClone(message));
    }
    return true;
  }
}
// Each profile has a separate channel implementation; none can reach another.
function profile() {
  const channels = [];
  return class {
    constructor() { this.listeners = new Set(); channels.push(this); }
    addEventListener(type, listener) { this.listeners.add(listener); }
    removeEventListener(type, listener) { this.listeners.delete(listener); }
    postMessage(data) { for (const channel of channels) if (channel !== this) for (const listener of channel.listeners) listener({ data }); }
    close() { this.listeners.clear(); }
  };
}
const factory = (url) => new Client(url);
const options = () => ({ table: "otef", BroadcastChannelImpl: profile(), websocketClientFactory: factory, warn: vi.fn() });
beforeEach(() => { clients = []; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test("two outputs in another profile learn playback, late join, heartbeat and disposal", () => {
  const publisher = createNliVideoPlaybackPublisher(options());
  publisher.setActive(true);
  const states = [[], []];
  const stops = states.map((state) => subscribeNliVideoPlayback({ ...options(), onChange: (active) => state.push(active) }));
  expect(states).toEqual([[true], [true]]);
  vi.advanceTimersByTime(12000);
  expect(states).toEqual([[true], [true]]);
  publisher.dispose();
  expect(states).toEqual([[true, false], [true, false]]);
  stops.forEach((stop) => stop());
  expect(clients.every((client) => !client.connected && client.listeners.size === 0)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

test("receiver reconnect queries the publisher and source reconnect refreshes state", () => {
  const publisher = createNliVideoPlaybackPublisher(options());
  const states = [];
  const stop = subscribeNliVideoPlayback({ ...options(), onChange: (active) => states.push(active) });
  publisher.setActive(true);
  clients[1].disconnect();
  vi.advanceTimersByTime(6000);
  expect(states).toEqual([true, false]);
  clients[1].connect();
  expect(states).toEqual([true, false, true]);
  clients[0].disconnect();
  vi.advanceTimersByTime(6000);
  expect(states.at(-1)).toBe(false);
  clients[0].connect();
  expect(states.at(-1)).toBe(true);
  publisher.dispose(); stop();
});

test("WebSocket works without BroadcastChannel, and failed BroadcastChannel sends do not block it", () => {
  const badChannel = class { postMessage() { throw new Error("closed"); } close() {} };
  const publisher = createNliVideoPlaybackPublisher({ ...options(), BroadcastChannelImpl: badChannel });
  const states = [];
  const stop = subscribeNliVideoPlayback({ ...options(), BroadcastChannelImpl: null, onChange: (active) => states.push(active) });
  publisher.setActive(true);
  expect(states).toEqual([true]);
  publisher.setActive(false);
  expect(states).toEqual([true, false]);
  publisher.dispose(); stop();
});

test("both unavailable transports are harmless; stale and foreign messages are ignored", () => {
  const publisher = createNliVideoPlaybackPublisher({ ...options(), BroadcastChannelImpl: null, websocketClientFactory: null });
  publisher.setActive(true); publisher.dispose();
  expect(vi.getTimerCount()).toBe(0);
  const states = [];
  const stop = subscribeNliVideoPlayback({ ...options(), onChange: (active) => states.push(active) });
  const message = { type: "otef_nli_video_playback_state", table: "otef", sourceId: "a", sequence: 2, active: true };
  clients[0].emit(message.type, message);
  clients[0].emit(message.type, { ...message, sequence: 1, active: false });
  clients[0].emit(message.type, { ...message, table: "elsewhere", sequence: 3, active: false });
  vi.advanceTimersByTime(6000);
  expect(states).toEqual([true, false]);
  stop();
});

test("duplicate BroadcastChannel and WebSocket deliveries never forward or loop", () => {
  const sharedProfile = profile();
  const publisher = createNliVideoPlaybackPublisher({ ...options(), BroadcastChannelImpl: sharedProfile });
  const states = [];
  const stop = subscribeNliVideoPlayback({ ...options(), BroadcastChannelImpl: sharedProfile, onChange: (active) => states.push(active) });
  const sends = clients.map((client) => vi.spyOn(client, "send"));
  publisher.setActive(true);
  expect(states).toEqual([true]);
  expect(sends[0]).toHaveBeenCalledOnce();
  expect(sends[1]).not.toHaveBeenCalled();
  publisher.dispose(); stop();
});

test("failed WebSocket creation preserves BroadcastChannel delivery", () => {
  const sharedProfile = profile();
  const transport = { ...options(), BroadcastChannelImpl: sharedProfile, websocketClientFactory: () => { throw new Error("unavailable"); } };
  const publisher = createNliVideoPlaybackPublisher(transport);
  const states = [];
  const stop = subscribeNliVideoPlayback({ ...transport, onChange: (active) => states.push(active) });
  publisher.setActive(true);
  publisher.dispose();
  expect(states).toEqual([true, false]);
  stop();
});

test("pagehide releases remote outputs and pageshow restores active playback", () => {
  const windowRef = new EventTarget();
  const publisher = createNliVideoPlaybackPublisher({ ...options(), windowRef });
  const states = [];
  const stop = subscribeNliVideoPlayback({ ...options(), onChange: (active) => states.push(active) });
  publisher.setActive(true);
  windowRef.dispatchEvent(new Event("pagehide"));
  vi.advanceTimersByTime(12000);
  expect(states).toEqual([true, false]);
  windowRef.dispatchEvent(new Event("pageshow"));
  expect(states).toEqual([true, false, true]);
  publisher.dispose(); stop();
});

test("borrowed connected sockets synchronize late join and remain owned by the data context", () => {
  const sourceSocket = new Client("/ws/otef/");
  const outputSocket = new Client("/ws/otef/");
  const coreMessage = vi.fn();
  const coreConnect = vi.fn();
  sourceSocket.on("message", coreMessage);
  sourceSocket.on("connect", coreConnect);
  sourceSocket.connect(); outputSocket.connect();
  const sourceConnect = vi.spyOn(sourceSocket, "connect");
  const sourceDisconnect = vi.spyOn(sourceSocket, "disconnect");
  const outputConnect = vi.spyOn(outputSocket, "connect");
  const outputDisconnect = vi.spyOn(outputSocket, "disconnect");
  const unusedFactory = vi.fn(() => { throw new Error("must not create another socket"); });
  const publisher = createNliVideoPlaybackPublisher({ ...options(), socket: sourceSocket, websocketClientFactory: unusedFactory });
  publisher.setActive(true);
  const states = [];
  const stop = subscribeNliVideoPlayback({ ...options(), socket: outputSocket, websocketClientFactory: unusedFactory, onChange: (active) => states.push(active) });
  expect(states).toEqual([true]);
  expect(unusedFactory).not.toHaveBeenCalled();
  expect(sourceConnect).not.toHaveBeenCalled();
  expect(outputConnect).not.toHaveBeenCalled();
  publisher.dispose();
  expect(states).toEqual([true, false]);
  stop();
  expect(sourceDisconnect).not.toHaveBeenCalled();
  expect(outputDisconnect).not.toHaveBeenCalled();
  expect(sourceSocket.getConnected()).toBe(true);
  expect(outputSocket.getConnected()).toBe(true);
  expect(sourceSocket.listeners.get("message")).toEqual(new Set([coreMessage]));
  expect(sourceSocket.listeners.get("connect")).toEqual(new Set([coreConnect]));
  expect(outputSocket.listeners.size).toBe(0);
});

test("borrowed initially disconnected sockets refresh on connect and reconnect without interference", () => {
  const sourceSocket = new Client("/ws/otef/");
  const outputSocket = new Client("/ws/otef/");
  const publisher = createNliVideoPlaybackPublisher({ ...options(), socket: sourceSocket });
  const states = [];
  const stop = subscribeNliVideoPlayback({ ...options(), socket: outputSocket, onChange: (active) => states.push(active) });
  publisher.setActive(true);
  expect(states).toEqual([]);
  sourceSocket.connect(); outputSocket.connect();
  expect(states).toEqual([true]);
  outputSocket.disconnect();
  vi.advanceTimersByTime(6000);
  expect(states).toEqual([true, false]);
  outputSocket.connect();
  expect(states).toEqual([true, false, true]);
  publisher.dispose(); stop();
});
