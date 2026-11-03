import { afterEach, expect, test, vi } from "vitest";
import { createProjectionTrace } from "../../frontend/src/projection-config/projection-trace.js";

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const listeners = new Set();
function socketHarness() {
  const handlers = new Map();
  const socket = {
    sent: [], handlers,
    on: vi.fn((name, fn) => { handlers.set(name, fn); }),
    off: vi.fn((name) => handlers.delete(name)),
    getConnected: vi.fn(() => true),
    send: vi.fn((message) => { socket.sent.push(message); return true; }),
    emit(name, value) { handlers.get(name)?.(value); },
  };
  return socket;
}
function setup({ sessionId = UUID, connected = true } = {}) {
  vi.useFakeTimers();
  const socket = socketHarness(); socket.getConnected.mockReturnValue(connected);
  const win = { location: { search: `?projectionTrace=${sessionId}` }, performance: { now: vi.fn(() => 12) }, setTimeout, clearTimeout, crypto: { randomUUID: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } };
  const doc = new EventTarget();
  const trace = createProjectionTrace({ sessionId, socket, window: win, document: doc });
  listeners.add(trace);
  return { trace, socket, win, doc };
}
afterEach(() => { listeners.forEach((trace) => trace.dispose()); listeners.clear(); vi.useRealTimers(); });

test("missing or malformed opt-in is inert and installs no socket listeners or timers", () => {
  vi.useFakeTimers();
  const socket = socketHarness();
  const trace = createProjectionTrace({ sessionId: "bad", socket, window: { location: { search: "?projectionTrace=bad" } }, document: new EventTarget() });
  expect(trace.enabled).toBe(false);
  expect(socket.on).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  const subscriber = vi.fn();
  trace.subscribe(subscriber);
  expect(subscriber).not.toHaveBeenCalled();
  trace.record("pointer", { phase: "down" });
  expect(trace.getStatus().queued).toBe(0);
  trace.dispose();
});

test("accepts stable caller reason labels from the instrumentation contract", () => {
  const { trace } = setup();
  expect(trace.record("gesture", { reason: "baseline_unavailable", phase: "pointerup" })).toBe(true);
  expect(JSON.parse(trace.exportJson()).events[0].detail.reason).toBe("baseline_unavailable");
});

test("records bounded archive and queue, validates detail, reports discarded newest events", () => {
  const { trace } = setup();
  for (let i = 0; i < 1100; i += 1) trace.record("pointer", { phase: "move", index: i % 100 });
  expect(trace.getStatus().queued).toBeLessThanOrEqual(1000);
  expect(trace.getStatus().dropped).toBeGreaterThan(0);
  expect(() => trace.record("pointer", { surprise: "text" })).not.toThrow();
  expect(trace.getStatus().dropped).toBeGreaterThan(0);
  const parsed = JSON.parse(trace.exportJson());
  expect(parsed.events.length).toBeLessThanOrEqual(2000);
  expect(Object.isFrozen(trace.getStatus())).toBe(true);
});

test("sends one immutable bounded batch and retries identical sequence until matching ACK", async () => {
  const { trace, socket } = setup();
  trace.record("pointer", { phase: "down", clientX: 5 });
  await vi.advanceTimersByTimeAsync(100);
  expect(socket.send).toHaveBeenCalledTimes(1);
  const first = socket.sent[0];
  expect(first).toMatchObject({ type: "otef_projection_trace", table: "otef", version: 1, sessionId: UUID, seq: 1 });
  expect(first.events).toHaveLength(1);
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first.events)).toBe(true);
  expect(new TextEncoder().encode(JSON.stringify(first)).length).toBeLessThanOrEqual(48 * 1024);
  await vi.advanceTimersByTimeAsync(3000);
  expect(socket.send).toHaveBeenCalledTimes(2);
  expect(socket.sent[1]).toBe(first);
  socket.emit("otef_projection_trace_ack", { type: "otef_projection_trace_ack", version: 1, sessionId: UUID, clientId: "wrong", seq: 1 });
  expect(trace.getStatus().acknowledged).toBe(0);
  socket.emit("otef_projection_trace_ack", { type: "otef_projection_trace_ack", version: 1, sessionId: UUID, clientId: first.clientId, seq: 1 });
  expect(trace.getStatus().acknowledged).toBe(1);
  expect(trace.getStatus().pending).toBe(0);
});

test("caps a transport batch at 64 events and starts the next sequence only after its ACK", async () => {
  const { trace, socket } = setup();
  for (let i = 0; i < 65; i += 1) trace.record("pointer", { phase: "move", index: i });
  await vi.advanceTimersByTimeAsync(100);
  expect(socket.sent[0].events).toHaveLength(64);
  expect(socket.sent[0].seq).toBe(1);
  const first = socket.sent[0];
  socket.emit("otef_projection_trace_ack", { type: "otef_projection_trace_ack", version: 1, sessionId: UUID, clientId: first.clientId, seq: first.seq });
  await vi.advanceTimersByTimeAsync(0);
  expect(socket.sent[1].events).toHaveLength(1);
  expect(socket.sent[1].seq).toBe(2);
});

test("stop drains retained records and remains pending until ACK; dispose removes listeners and timers", async () => {
  const { trace, socket } = setup();
  trace.record("lifecycle", { phase: "resize" });
  trace.stop();
  expect(trace.getStatus().recording).toBe(false);
  expect(trace.getStatus().queued).toBeGreaterThan(0);
  await vi.advanceTimersByTimeAsync(100);
  expect(trace.getStatus().pending).toBeGreaterThan(0);
  const batch = socket.sent[0];
  socket.emit("otef_projection_trace_ack", { type: "otef_projection_trace_ack", version: 1, sessionId: UUID, clientId: batch.clientId, seq: batch.seq });
  expect(trace.getStatus().pending).toBe(0);
  trace.dispose();
  expect(socket.handlers.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

test('archive rollover retains the latest event independently of transport drops', () => {
  const { trace } = setup({ connected: false });
  for (let i = 0; i < 2010; i++) trace.record('pointer', { clientX: i });
  const exported = JSON.parse(trace.exportJson());
  expect(exported.events).toHaveLength(2000);
  expect(exported.events.at(-1).detail.clientX).toBe(2009);
  expect(exported.archiveTruncated).toBe(10);
  trace.stop();
  expect(JSON.parse(trace.exportJson()).events.at(-1).detail.phase).toBe('stop');
});

test('disconnect retains pending and reconnect resends exactly that batch before newer records', async () => {
  const { trace, socket } = setup(); trace.record('pointer', { phase: 'pointerdown' });
  await vi.advanceTimersByTimeAsync(100); const first = socket.sent[0];
  socket.emit('disconnect'); trace.record('pointer', { phase: 'pointermove' });
  await vi.advanceTimersByTimeAsync(4000); expect(socket.sent).toHaveLength(1);
  socket.emit('connect'); expect(socket.sent.at(-1)).toBe(first);
  socket.emit('otef_projection_trace_ack', { type: 'otef_projection_trace_ack', version: 1, sessionId: UUID, clientId: first.clientId, seq: first.seq + 1 });
  expect(trace.getStatus().pending).toBe(1);
  socket.emit('otef_projection_trace_ack', { type: 'otef_projection_trace_ack', version: 1, sessionId: UUID, clientId: first.clientId, seq: first.seq });
  await vi.advanceTimersByTimeAsync(0); expect(socket.sent.at(-1).seq).toBe(2);
  expect(socket.sent.at(-1).events[0].detail.phase).toBe('pointermove');
});
