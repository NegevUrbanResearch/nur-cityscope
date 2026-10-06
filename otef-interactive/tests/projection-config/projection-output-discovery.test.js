import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { discoverOutputs, monitorProjectionOutputs } from '../../frontend/src/projection-config/projection-output-discovery.js';
const SOURCE = '22222222-2222-4222-8222-222222222222';
const INSTANCE = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const responder = (overrides = {}) => ({ type: 'otef_projection_applied', table: 'otef', output: 'left',
  instanceId: INSTANCE, revision: 12, success: true, route: 'browser', displaySide: 'right', reversed: true, ...overrides });
function socket() {
  const listeners = new Map();
  return { send: vi.fn(), on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    off(name, fn) { listeners.get(name)?.delete(fn); }, emit(name, message) { for (const fn of listeners.get(name) || []) fn(message); },
    count: () => [...listeners.values()].reduce((n, set) => n + set.size, 0) };
}
beforeEach(() => vi.useFakeTimers()); afterEach(() => vi.useRealTimers());
test('subscribes before requesting and retains independent responders on the same logical output', async () => {
  const ws = socket(); ws.send.mockImplementation(() => {
    ws.emit('otef_projection_applied', responder()); ws.emit('otef_projection_applied', responder({ instanceId: OTHER }));
  });
  const pending = discoverOutputs({ socket: ws, sourceId: SOURCE }); vi.advanceTimersByTime(1000);
  const result = await pending;
  expect(ws.send).toHaveBeenCalledWith({ type: 'otef_projection_status_request', table: 'otef', sourceId: SOURCE });
  expect(result).toBeInstanceOf(Map); expect(result.size).toBe(2);
  expect(result.get(`left/${INSTANCE}`)).toEqual(responder()); expect(ws.count()).toBe(0);
});
test('empty discovery contains no historical or deduplicated status rows', async () => {
  const ws = socket(); ws.statusRows = [responder()]; const pending = discoverOutputs({ socket: ws, sourceId: SOURCE, timeoutMs: 50 });
  vi.advanceTimersByTime(50); expect((await pending).size).toBe(0); expect(ws.count()).toBe(0);
});
test('cancellation rejects with AbortError and releases subscriptions, including pre-aborted calls', async () => {
  const ws = socket(); const controller = new AbortController();
  const pending = discoverOutputs({ socket: ws, sourceId: SOURCE, signal: controller.signal });
  controller.abort(); await expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(ws.count()).toBe(0);
  await expect(discoverOutputs({ socket: ws, sourceId: SOURCE, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(ws.send).toHaveBeenCalledTimes(1);
});
test('explicit monitor delivers late responders and updated launch metadata until disposal', () => {
  const ws = socket(), seen = [];
  const monitor = monitorProjectionOutputs({ socket: ws, onResponder: row => seen.push(row) });
  ws.emit('otef_projection_applied', responder()); vi.advanceTimersByTime(5000);
  ws.emit('otef_projection_applied', responder({ instanceId: OTHER }));
  ws.emit('otef_projection_applied', responder({ table: 'nli' }));
  expect(seen).toHaveLength(2); expect(monitor.getResponders().size).toBe(2);
  expect(monitor.getResponders().get(`left/${INSTANCE}`)).toMatchObject({ displaySide: 'right', reversed: true });
  monitor.dispose(); ws.emit('otef_projection_applied', responder({ output: 'right' })); expect(seen).toHaveLength(2); expect(ws.count()).toBe(0);
});
