import { beforeEach, expect, test, vi } from 'vitest';
import { DEFAULT_PROJECTION_CONFIG as DEFAULTS } from '../../frontend/src/shared/projection-config-schema.js';
import { createProjectionConfigClient, validateProjectionConfigSnapshot } from '../../frontend/src/shared/projection-config-client.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const stateFor = (revision, config = DEFAULTS) => ({
  revision,
  config: clone(config),
  presets: [{ id: 'original', name: 'Original calibration', config: clone(DEFAULTS), readOnly: true }],
  selectedPresetId: 'original',
});

function harness({ revision = 0, config = DEFAULTS } = {}) {
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const requests = [];
  const events = new Map();
  let connected = false;
  const socket = {
    on(event, callback) { if (!events.has(event)) events.set(event, new Set()); events.get(event).add(callback); },
    off(event, callback) { events.get(event)?.delete(callback); },
    connect() { connected = true; for (const callback of events.get('connect') || []) callback(); },
    getConnected() { return connected; },
    emit(payload) { for (const callback of events.get('otef_projection_config_changed') || []) callback(payload); for (const callback of events.get('message') || []) callback(payload); },
  };
  const fetchImpl = vi.fn((url, options = {}) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })));
  const clock = {
    now: () => now,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  const client = createProjectionConfigClient({ fetchImpl, socket, clock, sourceId: '00000000-0000-4000-8000-00000000000a' });
  const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));
  const advance = async (amount) => {
    now += amount;
    while (true) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      due[1].callback();
      await flushPromises();
    }
  };
  const resolveNext = (body, status = 200) => {
    const request = requests.shift();
    if (!request) throw new Error('no pending request');
    request.resolve({ status, ok: status >= 200 && status < 300, json: async () => clone(body) });
  };
  const rejectNext = (error) => {
    const request = requests.shift();
    if (!request) throw new Error('no pending request');
    request.reject(error);
  };
  const resolveAt = (index, body, status = 200) => {
    const request = requests[index];
    if (!request) throw new Error('no request at index');
    requests.splice(index, 1);
    request.resolve({ status, ok: status >= 200 && status < 300, json: async () => clone(body) });
  };
  return {
    client, socket, requests, fetchImpl, stateFor, flushPromises, advance,
    setNow: (value) => { now = value; },
    resolveNext, resolveAt, rejectNext, pendingRequests: () => requests, lastRequest: () => requests[requests.length - 1],
    disconnect: () => { connected = false; for (const callback of events.get('disconnect') || []) callback(); },
    reconnect: () => { connected = true; for (const callback of events.get('connect') || []) callback(); },
};
}

beforeEach(() => vi.restoreAllMocks());

test('hydrates revision zero from a full snapshot', async () => {
  const h = harness();
  const started = h.client.start();
  h.resolveNext(h.stateFor(0));
  await started;
  expect(h.client.getState().snapshot.revision).toBe(0);
  expect(h.client.getState().draft).toEqual(DEFAULTS);
});

test('failed initial GET keeps writes blocked until an explicit fresh retry succeeds', async () => {
  const h = harness();
  const started = h.client.start();
  h.rejectNext(new Error('temporary network failure'));
  await started;
  h.socket.emit({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000b', state: h.stateFor(1) });
  expect(h.client.getState().hydrationError).toMatch(/temporary network failure/);
  await expect(h.client.apply()).rejects.toThrow(/hydrating/);
  const retry = h.client.retryHydration();
  expect(h.client.getState().hydrationError).toBeNull();
  h.resolveNext(h.stateFor(2));
  await retry;
  expect(h.client.getState()).toMatchObject({ hydrating: false, hydrationError: null });
  const applied = h.client.apply();
  h.resolveNext(h.stateFor(3));
  await applied;
});

test('reconnect retry ignores stale GET responses and preserves a local draft without replay', async () => {
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  h.client.setLive(false);
  const draft = { ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.4 } };
  h.client.setDraft(draft);
  h.disconnect(); h.reconnect();
  h.rejectNext(new Error('GET unavailable'));
  await h.flushPromises();
  expect(h.client.getState()).toMatchObject({ hydrating: true, hydrationError: 'GET unavailable', live: false });
  await expect(h.client.apply()).rejects.toThrow(/hydrating/);
  const oldRetry = h.client.retryHydration();
  const currentRetry = h.client.retryHydration();
  h.resolveAt(1, h.stateFor(4));
  await currentRetry;
  h.resolveAt(0, h.stateFor(3));
  await oldRetry;
  expect(h.client.getState().snapshot.revision).toBe(4);
  expect(h.client.getState().draft).toEqual(draft);
  expect(h.client.getState().live).toBe(false);
  expect(h.fetchImpl.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
});

test('GET revision six cannot replace a websocket revision seven', async () => {
  const h = harness({ revision: 6 });
  const started = h.client.start();
  h.socket.emit({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000b', state: h.stateFor(7) });
  h.resolveNext(h.stateFor(6));
  await started;
  expect(h.client.getState().snapshot.revision).toBe(7);
  expect(h.client.getState().live).toBe(true);
});

test('queued drag is canceled and local draft preserved by a foreign update', async () => {
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  const draft = { ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.3 } };
  h.client.setDraft(draft); h.client.setLive(true);
  h.socket.emit({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000b', state: h.stateFor(1) });
  await h.advance(1000);
  expect(h.pendingRequests()).toHaveLength(0);
  expect(h.client.getState().draft).toEqual(draft);
  expect(h.client.getState().live).toBe(false);
});

test('foreign update during an in-flight preview cancels trailing work and preserves the draft', async () => {
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  const first = { ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.1 } };
  const latest = { ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.2 } };
  h.client.setDraft(first); await h.advance(100);
  h.client.setDraft(latest);
  h.socket.emit({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000b', state: h.stateFor(2) });
  h.resolveNext(h.stateFor(1, first));
  await h.flushPromises();
  await h.advance(1000);
  expect(h.pendingRequests()).toHaveLength(0);
  expect(h.client.getState().draft).toEqual(latest);
  expect(h.client.getState().live).toBe(false);
});

test('save waits for preview and saves newest draft', async () => {
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  h.client.setDraft({ ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.02 } });
  await h.advance(100);
  h.client.setDraft({ ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.03 } });
  const saved = h.client.save({ presetId: null, name: 'Coast' });
  expect(h.pendingRequests()).toHaveLength(1);
  h.resolveNext(h.stateFor(1, { ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.02 } }));
  await h.flushPromises();
  await h.flushPromises();
  await h.advance(100);
  expect(h.lastRequest().options.body).toContain('"action":"save"');
  const body = JSON.parse(h.lastRequest().options.body);
  expect(body.config.pre.tx).toBe(0.03);
  expect(body.baseRevision).toBe(1);
  h.resolveNext(h.stateFor(2, { ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.03 } }));
  await saved;
});

test('save reads a draft edited while it waits for the preview response', async () => {
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  h.client.setDraft({ ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.1 } });
  await h.advance(100);
  const saved = h.client.save({ presetId: null, name: 'Newest' });
  h.client.setDraft({ ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.2 } });
  h.resolveNext(h.stateFor(1, { ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.1 } }));
  await h.flushPromises();
  await h.advance(100);
  expect(JSON.parse(h.lastRequest().options.body).config.pre.tx).toBe(0.2);
  h.resolveNext(h.stateFor(2, { ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.2 } }));
  await saved;
});

test('409 reports conflict, turns Live off, and does not retry', async () => {
  const onConflict = vi.fn();
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  const client = createProjectionConfigClient({ fetchImpl: h.fetchImpl, socket: h.socket, clock: { now: () => 0, setTimeout: setTimeout, clearTimeout }, sourceId: '00000000-0000-4000-8000-00000000000a', onConflict });
  const start2 = client.start(); h.resolveNext(h.stateFor(0)); await start2;
  client.setDraft({ ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.3 } });
  const applied = client.apply();
  h.resolveNext({ error: 'conflict', state: h.stateFor(1) }, 409);
  await expect(applied).rejects.toThrow(/conflict/i);
  expect(onConflict).toHaveBeenCalledWith('Calibration changed on another screen; latest settings loaded.');
  expect(client.getState().live).toBe(false);
  expect(h.pendingRequests()).toHaveLength(0);
});

test('stop removes handlers without closing borrowed socket', async () => {
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  h.client.stop();
  h.socket.emit({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000b', state: h.stateFor(2) });
  expect(h.client.getState().snapshot.revision).toBe(0);
  expect(h.socket.getConnected()).toBe(true);
});

test('queued preview keeps only the newest immutable draft and respects the interval', async () => {
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  h.client.setDraft({ ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.1 } });
  await h.advance(100);
  h.client.setDraft({ ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.2 } });
  h.client.setDraft({ ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.3 } });
  h.resolveNext(h.stateFor(1, { ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.1 } }));
  await h.flushPromises();
  expect(h.pendingRequests()).toHaveLength(0);
  await h.advance(99);
  expect(h.pendingRequests()).toHaveLength(0);
  await h.advance(1);
  expect(JSON.parse(h.lastRequest().options.body).config.pre.tx).toBe(0.3);
});

test('own websocket notification advances revision without overwriting the in-flight draft', async () => {
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  const draft = { ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.4 } };
  h.client.setDraft(draft);
  const applied = h.client.apply();
  const next = h.stateFor(1, draft);
  h.socket.emit({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000a', state: next });
  expect(h.client.getState().snapshot.revision).toBe(1);
  h.resolveNext(next);
  await applied;
  expect(h.client.getState().draft).toEqual(draft);
  expect(h.client.getState().hasLocalDraft).toBe(false);
});

test('load includes the preset id and applies its returned full snapshot', async () => {
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  const loading = h.client.load('preset-1');
  expect(JSON.parse(h.lastRequest().options.body)).toMatchObject({ action: 'load', presetId: 'preset-1', baseRevision: 0 });
  const loaded = h.stateFor(1, { ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: -0.2 } });
  h.resolveNext(loaded);
  await loading;
  expect(h.client.getState().draft.pre.tx).toBe(-0.2);
  expect(h.client.getState().hasLocalDraft).toBe(false);
});

test('subscription receives state changes and unsubscribes cleanly', async () => {
  const h = harness();
  const states = [];
  const unsubscribe = h.client.subscribe((state) => states.push(state));
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  const count = states.length;
  unsubscribe();
  h.socket.emit({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000b', state: h.stateFor(1) });
  expect(states.length).toBe(count);
});

test('disconnect preserves a draft and reconnect hydrates without replaying an uncertain POST', async () => {
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  const draft = { ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.5 } };
  h.client.setDraft(draft);
  const applied = h.client.apply();
  h.disconnect();
  h.rejectNext(new Error('socket closed before response'));
  await expect(applied).rejects.toThrow(/connection/);
  expect(h.client.getState().draft).toEqual(draft);
  expect(h.client.getState().live).toBe(false);
  h.reconnect();
  expect(h.pendingRequests()).toHaveLength(1);
  h.resolveNext(h.stateFor(1));
  await h.flushPromises();
  expect(h.pendingRequests()).toHaveLength(0);
  expect(h.client.getState().hasLocalDraft).toBe(true);
  expect(h.client.getState().live).toBe(false);
});

test('failed preview rejects and cancels a Save waiting behind it', async () => {
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  h.client.setDraft({ ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.1 } });
  await h.advance(100);
  const saving = h.client.save({ presetId: null, name: 'Blocked' });
  h.rejectNext(new Error('preview outcome uncertain'));
  await expect(saving).rejects.toThrow(/uncertain|connection/i);
  await h.flushPromises();
  expect(h.pendingRequests()).toHaveLength(0);
  expect(h.client.getState().previewError).toMatch(/uncertain/);
});

test('late Load response cannot overwrite a draft preserved by a foreign update', async () => {
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  const loading = h.client.load('preset-1');
  const preserved = clone(h.client.getState().draft);
  h.socket.emit({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000b', state: h.stateFor(2, { ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.2 } }) });
  h.resolveNext(h.stateFor(1, { ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.7 } }));
  await loading;
  expect(h.client.getState().snapshot.revision).toBe(2);
  expect(h.client.getState().draft).toEqual(preserved);
  expect(h.client.getState().hasLocalDraft).toBe(true);
});

test('late Revert response cannot overwrite a draft preserved by a foreign update', async () => {
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  const reverting = h.client.revert();
  const preserved = clone(h.client.getState().draft);
  h.socket.emit({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000b', state: h.stateFor(2, { ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.2 } }) });
  h.resolveNext(h.stateFor(1, { ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.7 } }));
  await reverting;
  expect(h.client.getState().snapshot.revision).toBe(2);
  expect(h.client.getState().draft).toEqual(preserved);
  expect(h.client.getState().hasLocalDraft).toBe(true);
});

test('superseded waiting control operation rejects its promise', async () => {
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  h.client.setDraft({ ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.1 } });
  await h.advance(100);
  const saving = h.client.save({ presetId: null, name: 'Superseded' });
  const loading = h.client.load('preset-1');
  await expect(saving).rejects.toThrow(/superseded/i);
  h.resolveNext(h.stateFor(1));
  await h.flushPromises();
  await h.advance(100);
  h.resolveNext(h.stateFor(2));
  await loading;
});

test('reconnect hydrates before Apply and retires a never-settling old POST', async () => {
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  h.client.setDraft({ ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.6 } });
  const oldApply = h.client.apply();
  h.disconnect();
  await expect(oldApply).rejects.toThrow(/connection/i);
  h.reconnect();
  const duringHydrate = h.client.apply();
  await expect(duringHydrate).rejects.toThrow(/hydrating|disconnected/i);
  h.resolveAt(1, h.stateFor(1));
  await h.flushPromises();
  const nextApply = h.client.apply();
  await h.advance(100);
  expect(h.pendingRequests()).toHaveLength(2);
  const current = h.pendingRequests()[1];
  current.resolve({ status: 200, ok: true, json: async () => h.stateFor(2, h.client.getState().draft) });
  await nextApply;
});

test('out-of-order reconnect hydrations keep the highest accepted revision', async () => {
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  h.disconnect(); h.reconnect();
  h.disconnect(); h.reconnect();
  expect(h.pendingRequests()).toHaveLength(2);
  h.resolveAt(1, h.stateFor(3));
  h.resolveAt(0, h.stateFor(2));
  await h.flushPromises();
  expect(h.client.getState().snapshot.revision).toBe(3);
});

test('Save works with Live off and equal-revision reconnect preserves the local draft', async () => {
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  h.client.setLive(false);
  const draft = { ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.8 } };
  h.client.setDraft(draft);
  const saving = h.client.save({ presetId: null, name: 'Live off' });
  expect(h.pendingRequests()).toHaveLength(1);
  h.resolveNext(h.stateFor(1, draft));
  await saving;
  h.client.setDraft({ ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.9 } });
  h.disconnect(); h.reconnect();
  h.resolveNext(h.stateFor(1, draft));
  await h.flushPromises();
  expect(h.client.getState().draft.pre.tx).toBe(0.9);
  expect(h.client.getState().hasLocalDraft).toBe(true);
  expect(h.client.getState().live).toBe(false);
});

test('explicit Apply observes the same 100ms send interval as previews', async () => {
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  h.client.setDraft({ ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.1 } });
  await h.advance(100);
  h.resolveNext(h.stateFor(1, { ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.1 } }));
  await h.flushPromises();
  const applied = h.client.apply();
  expect(h.pendingRequests()).toHaveLength(0);
  await h.advance(99);
  expect(h.pendingRequests()).toHaveLength(0);
  await h.advance(1);
  expect(h.pendingRequests()).toHaveLength(1);
  h.resolveNext(h.stateFor(1, h.client.getState().draft));
  await applied;
});

test('malformed snapshots and websocket envelopes are ignored', async () => {
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  h.socket.emit({ type: 'otef_projection_config_changed', table: 'otef', state: h.stateFor(3) });
  h.socket.emit({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000b', state: { ...h.stateFor(3), presets: [] } });
  expect(h.client.getState().snapshot.revision).toBe(0);
  const malformed = { ...h.stateFor(4), presets: [{ id: 'original', name: 'Original calibration', config: clone(DEFAULTS), readOnly: false }] };
  h.socket.emit({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000b', state: malformed });
  expect(h.client.getState().snapshot.revision).toBe(0);
});

test('error-status hydration does not adopt a structurally valid body', async () => {
  const h = harness();
  const started = h.client.start();
  h.resolveNext(h.stateFor(0), 500);
  await started;
  expect(h.client.getState().snapshot).toBe(null);
});

test('hydrates a JSONB-ordered full snapshot and treats reordered configs as equal', async () => {
  const reverseKeys = (value) => Array.isArray(value)
    ? value.map(reverseKeys)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]))
      : value;
  const h = harness();
  const persisted = h.stateFor(0);
  persisted.config = reverseKeys(persisted.config);
  persisted.presets[0].config = reverseKeys(persisted.presets[0].config);
  expect(validateProjectionConfigSnapshot(persisted)).toBe(true);
  const started = h.client.start(); h.resolveNext(persisted); await started;
  expect(h.client.getState().snapshot.revision).toBe(0);
  h.client.setDraft(clone(DEFAULTS));
  expect(h.client.getState().hasLocalDraft).toBe(false);
});

for (const [action, args] of [['load', ['original']], ['revert', []]]) {
  test(`own websocket before ${action} response synchronizes the unchanged draft`, async () => {
    const h = harness();
    const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
    h.client.setLive(false);
    h.client.setDraft({ ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.4 } });
    const operation = h.client[action](...args);
    const returned = h.stateFor(1);
    h.socket.emit({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000a', state: returned });
    h.resolveNext(returned);
    await operation;
    expect(h.client.getState().draft).toEqual(DEFAULTS);
    expect(h.client.getState().hasLocalDraft).toBe(false);
  });
}

for (const [label, body, status] of [
  ['error status', stateFor(1), 500],
  ['malformed body', { ...stateFor(1), presets: [] }, 200],
]) {
  test(`failed reconnect hydration (${label}) keeps Apply and Live writes gated`, async () => {
    const h = harness();
    const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
    h.disconnect(); h.reconnect();
    h.resolveNext(body, status);
    await h.flushPromises();
    h.client.setDraft({ ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.4 } });
    h.client.setLive(true);
    await h.advance(1000);
    expect(h.pendingRequests()).toHaveLength(0);
    await expect(h.client.apply()).rejects.toThrow(/hydrating|disconnected/i);
    h.disconnect(); h.reconnect();
    h.resolveNext(h.stateFor(1));
    await h.flushPromises();
    const applied = h.client.apply();
    await h.advance(100);
    expect(h.pendingRequests()).toHaveLength(1);
    h.resolveNext(h.stateFor(2, h.client.getState().draft));
    await applied;
  });
}

test('a deferred control timer cannot start a second POST during Apply', async () => {
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  h.client.setDraft({ ...clone(DEFAULTS), pre: { ...DEFAULTS.pre, tx: 0.1 } });
  await h.advance(0);
  h.resolveNext(h.stateFor(1, h.client.getState().draft));
  await h.flushPromises();
  const saving = h.client.save({ name: 'Superseded' });
  const savingResult = saving.catch((error) => error);
  h.setNow(100);
  const applying = h.client.apply();
  expect(h.pendingRequests()).toHaveLength(1);
  await h.advance(100);
  expect(h.pendingRequests()).toHaveLength(1);
  expect((await savingResult).message).toMatch(/superseded/i);
  h.resolveNext(h.stateFor(2, h.client.getState().draft));
  await applying;
});
