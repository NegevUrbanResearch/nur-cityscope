import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createOutputControlBridge } from '../../frontend/src/projection-config/output-control-bridge.js';

const SOURCE = '11111111-1111-4111-8111-111111111111';
const HOST = '22222222-2222-4222-8222-222222222222';
const CONNECTION = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function harness(local) {
  const handlers = new Map(), sent = [];
  const socket = { getConnected: () => true, send: value => { sent.push(value); return true; }, on: (key, fn) => handlers.set(key, fn), off: key => handlers.delete(key) };
  const api = createOutputControlBridge({ socket, localController: local || { getState: () => ({ supported: false }), dispose() {} }, sourceId: SOURCE });
  const query = () => sent.filter(x => x.type === 'otef_output_query').at(-1);
  const report = (changes = {}) => handlers.get('otef_output_state')({ type: 'otef_output_state', table: 'otef', hostId: HOST, connectionId: CONNECTION, sequence: 1, queryId: query().queryId,
    state: { supported: true, screens: [], assignments: {}, resolutions: {}, reverseModel: false, ownedSpans: [], message: 'Ready', error: '' }, ...changes });
  return { api, sent, handlers, query, report, settle: () => vi.advanceTimersByTime(2000) };
}

test('tablet targets one discovered workstation and only accepts its exact receipt', async () => {
  const h = harness(); h.report(); h.settle();
  expect(h.api.getState().supported).toBe(true);
  const pending = h.api.openBoth();
  const command = h.sent.at(-1); expect(command).toMatchObject({ type: 'otef_output_command', hostId: HOST, connectionId: CONNECTION, action: 'open' });
  const ack = { type: 'otef_output_ack', table: 'otef', hostId: HOST, connectionId: CONNECTION, sourceId: SOURCE, requestId: command.requestId, success: true, error: null, sequence: 2, state: { ...h.api.getState(), message: 'Actually opened' } };
  h.handlers.get('otef_output_ack')({ ...ack, connectionId: OTHER });
  expect(h.api.getState().message).not.toBe('Actually opened');
  h.handlers.get('otef_output_ack')(ack); await pending;
  expect(h.api.getState().message).toBe('Actually opened'); h.api.dispose();
});

test('multiple workstations never receive a broadcast mutation', async () => {
  const h = harness(); h.report(); h.report({ hostId: OTHER }); h.settle();
  expect(h.api.getState().supported).toBe(false);
  await expect(h.api.openBoth()).rejects.toThrow(/multiple/i);
  expect(h.sent.some(x => x.type === 'otef_output_command')).toBe(false); h.api.dispose();
});

test('disconnect rejects pending work and reconnect ignores old discovery and receipts', async () => {
  const h = harness(); h.report(); h.settle(); const oldQuery = h.query().queryId;
  const pending = h.api.closeBoth(); const rejected = expect(pending).rejects.toThrow(/disconnect/i);
  h.handlers.get('disconnect')(); await rejected;
  h.handlers.get('connect')(); h.report({ queryId: oldQuery });
  expect(h.api.getState().supported).toBe(false); h.report(); h.settle(); expect(h.api.getState().supported).toBe(true); h.api.dispose();
});

test('host uses real controller and deduplicates a command until its operation finishes', async () => {
  let finish;
  const local = { getState: () => ({ supported: true, error: '', screens: [] }), openBoth: vi.fn(() => new Promise(resolve => { finish = resolve; })), dispose: vi.fn(), subscribe: fn => { fn(local.getState()); return () => {}; } };
  const h = harness(local), register = h.sent.find(x => x.type === 'otef_output_register');
  const command = { type: 'otef_output_command', table: 'otef', sourceId: OTHER, requestId: CONNECTION, hostId: SOURCE, connectionId: register.connectionId, action: 'open', value: null };
  h.handlers.get('otef_output_command')(command); h.handlers.get('otef_output_command')(command);
  expect(local.openBoth).toHaveBeenCalledTimes(1); finish(); await Promise.resolve(); await Promise.resolve();
  expect(h.sent.filter(x => x.type === 'otef_output_ack')).toHaveLength(1);
  h.api.dispose(); expect(local.dispose).toHaveBeenCalledTimes(1);
});

test('unconfirmed command times out without claiming output success', async () => {
  vi.useFakeTimers();
  try { const h = harness(); h.report(); h.settle(); const pending = h.api.openBoth(); const failure = expect(pending).rejects.toThrow(/not confirmed/i); await vi.advanceTimersByTimeAsync(16000); await failure; expect(h.api.getState().error).toMatch(/not confirmed/i); h.api.dispose(); }
  finally { vi.useRealTimers(); }
});

test('tablet propagates real host failure without optimistic success', async () => {
  const h = harness(); h.report(); h.settle(); const pending = h.api.openBoth();
  const command = h.sent.at(-1);
  h.handlers.get('otef_output_ack')({ type: 'otef_output_ack', table: 'otef', hostId: HOST, connectionId: CONNECTION,
    sourceId: SOURCE, requestId: command.requestId, success: false, error: 'Projector popup blocked', sequence: 2,
    state: { supported: true, screens: [], error: 'Projector popup blocked', message: 'No outputs opened' } });
  await expect(pending).rejects.toThrow('Projector popup blocked');
  expect(h.api.getState().message).toBe('No outputs opened'); expect(h.api.getState().error).toBe('Projector popup blocked'); h.api.dispose();
});

test('discovery waits for every workstation reply before permitting commands', async () => {
  const h = harness(); h.report();
  expect(h.api.getState().supported).toBe(false);
  await expect(h.api.closeBoth()).rejects.toThrow(/looking/i);
  h.report({ hostId: OTHER }); h.settle();
  await expect(h.api.closeBoth()).rejects.toThrow(/multiple/i);
  expect(h.sent.some(value => value.type === 'otef_output_command')).toBe(false);
  h.api.dispose();
});

test('a second workstation invalidates pending command receipts', async () => {
  const h = harness(); h.report(); h.settle();
  const pending = h.api.closeBoth();
  const rejected = expect(pending).rejects.toThrow(/multiple.*unconfirmed/i);
  const command = h.sent.at(-1);
  h.report({ hostId: OTHER }); await rejected;
  h.handlers.get('otef_output_ack')({ type: 'otef_output_ack', table: 'otef', hostId: HOST, connectionId: CONNECTION,
    sourceId: SOURCE, requestId: command.requestId, success: true, sequence: 2, state: { ...h.api.getState(), message: 'Closed' } });
  expect(h.api.getState().supported).toBe(false);
  expect(h.api.getState().message).toMatch(/multiple/i);
  h.api.dispose();
});
