import { beforeEach, expect, test, vi } from 'vitest';
import { DEFAULT_PROJECTION_CONFIG as DEFAULTS, LEGACY_DEFAULT_PROJECTION_CONFIG } from '../../frontend/src/shared/projection-config-schema.js';
import { migrateProjectionConfigToV2 } from '../../frontend/src/shared/projection-warp-schema.js';
import { migrateNamesWallToV3, migrateNamesWallToV5 } from '../../frontend/src/shared/nli-name-wall-config.js';
import { createProjectionConfigClient, TD_MIGRATION_PRESET_ID, validateProjectionConfigSnapshot } from '../../frontend/src/shared/projection-config-client.js';
import { waitForProjectionConfigStartup } from '../../frontend/src/projection/projection-config-startup.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const stateFor = (revision, config = DEFAULTS) => ({
  revision,
  config: clone(config),
  presets: [{ id: 'original', name: 'Original calibration', config: clone(DEFAULTS), readOnly: true }],
  selectedPresetId: 'original',
});

function harness({ revision = 0, config = DEFAULTS, validateCandidate, connectOnStart = true, serviceFetch } = {}) {
  let now = 0;
  let timerId = 0;
  const timers = new Map();
  const requests = [];
  const events = new Map();
  let connected = false;
  const socket = {
    on(event, callback) { if (!events.has(event)) events.set(event, new Set()); events.get(event).add(callback); },
    off(event, callback) { events.get(event)?.delete(callback); },
    connect() { if (!connectOnStart) return; connected = true; for (const callback of events.get('connect') || []) callback(); },
    getConnected() { return connected; },
    emit(payload) { for (const callback of events.get('otef_projection_config_changed') || []) callback(payload); for (const callback of events.get('message') || []) callback(payload); },
  };
  const fetchImpl = serviceFetch || vi.fn((url, options = {}) => new Promise((resolve, reject) => requests.push({ url, options, resolve, reject })));
  const clock = {
    now: () => now,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { at: now + delay, callback }); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  const client = createProjectionConfigClient({ fetchImpl, socket, clock, validateCandidate, sourceId: '00000000-0000-4000-8000-00000000000a' });
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
    captureHandlers: (event) => [...(events.get(event) || [])],
    disconnect: () => { connected = false; for (const callback of events.get('disconnect') || []) callback(); },
    reconnect: () => { connected = true; for (const callback of events.get('connect') || []) callback(); },
    connect: () => { connected = true; for (const callback of events.get('connect') || []) callback(); },
  };
}

test('uncertain POST times out once, ignores late receipt, and requires a fresh-revision explicit publish choice', async () => {
  const h = harness();
  const starting = h.client.start(); h.resolveNext(stateFor(0)); await starting;
  const draft = clone(DEFAULTS); draft.pre.tx = 0.41;
  h.client.setDraft(draft);
  const applying = h.client.apply();
  const applyError = applying.then(() => null, error => error);
  const queuedSave = h.client.save({ name: 'queued checkpoint' });
  const queuedError = queuedSave.then(() => null, error => error);
  await h.flushPromises();
  expect(h.pendingRequests()).toHaveLength(1);
  const latePost = h.pendingRequests()[0];

  await h.advance(15000);
  expect(await applyError).toMatchObject({ code: 'uncertain_write', message: expect.stringMatching(/uncertain/i) });
  expect(await queuedError).toMatchObject({ code: 'uncertain_write', message: expect.stringMatching(/uncertain/i) });
  expect(h.client.getState()).toMatchObject({ live: true, draft, reconciliation: { status: 'reading' } });
  expect(h.pendingRequests()).toHaveLength(2);
  expect(h.pendingRequests()[1].options.method).toBe('GET');

  h.resolveAt(1, stateFor(3));
  await h.flushPromises();
  expect(h.client.getState()).toMatchObject({
    snapshot: { revision: 3 }, draft, hasLocalDraft: true, live: true,
    reconciliation: { status: 'needs-choice' },
  });
  const duringRecoveryEdit = clone(draft); duringRecoveryEdit.pre.tx = 0.47;
  h.client.setDraft(duringRecoveryEdit);
  await h.advance(30000);
  expect(h.pendingRequests()).toHaveLength(1);
  h.resolveAt(0, stateFor(9));
  expect(latePost.options.signal.aborted).toBe(true);
  await h.flushPromises();
  expect(h.client.getState().snapshot.revision).toBe(3);

  h.client.resolveReconciliation('keep-local');
  expect(h.client.getState().live).toBe(false);
  const editedWhileLiveOff = clone(duringRecoveryEdit); editedWhileLiveOff.pre.tx = 0.52;
  h.client.setDraft(editedWhileLiveOff);
  await h.advance(30000);
  expect(h.pendingRequests()).toHaveLength(0);
  const nextApply = h.client.apply();
  await h.flushPromises();
  expect(h.pendingRequests()).toHaveLength(1);
  expect(JSON.parse(h.pendingRequests()[0].options.body).baseRevision).toBe(3);
  h.resolveNext(stateFor(4, editedWhileLiveOff));
  await nextApply; await h.flushPromises();
  expect(h.client.getState()).toMatchObject({ reconciliation: null, snapshot: { revision: 4 } });

  const presetId = '22222222-2222-4222-8222-222222222222';
  const saving = h.client.save({ name: 'Fresh revision' });
  await h.advance(100);
  expect(JSON.parse(h.pendingRequests()[0].options.body)).toMatchObject({ action: 'save', baseRevision: 4 });
  const checkpoint = { ...stateFor(5, editedWhileLiveOff), selectedPresetId: presetId,
    presets: [...stateFor(5).presets, { id: presetId, name: 'Fresh revision', config: editedWhileLiveOff, readOnly: false }] };
  h.resolveNext(checkpoint); expect(await saving).toMatchObject({ savedPresetId: presetId }); await h.flushPromises();

  await h.client.setLive(true);
  const liveDraft = clone(editedWhileLiveOff); liveDraft.pre.tx = 0.61; h.client.setDraft(liveDraft);
  await h.advance(100);
  expect(JSON.parse(h.pendingRequests()[0].options.body)).toMatchObject({ action: 'preview', baseRevision: 5 });
  h.resolveNext(stateFor(6, liveDraft));
  await h.flushPromises();
  h.client.stop();
});

test('failed uncertain-write read exposes retry and Use accepted replaces draft', async () => {
  const h = harness();
  const starting = h.client.start(); h.resolveNext(stateFor(0)); await starting;
  const draft = clone(DEFAULTS); draft.pre.tx = 0.3; h.client.setDraft(draft);
  const applying = h.client.apply(); const applyError = applying.then(() => null, error => error); await h.flushPromises();
  await h.advance(15000);
  expect(await applyError).toMatchObject({ code: 'uncertain_write' });
  expect(h.client.getState().reconciliation.status).toBe('reading');
  expect(h.pendingRequests()[1].options.method).toBe('GET');
  h.resolveAt(1, {}, 503); await h.flushPromises();
  expect(h.client.getState().reconciliation.status).toBe('read-error');
  const retry = h.client.retryReconciliation();
  expect(h.pendingRequests()[1].options.method).toBe('GET');
  h.resolveAt(1, stateFor(2)); await retry;
  expect(h.client.getState().reconciliation.status).toBe('needs-choice');
  h.client.resolveReconciliation('use-accepted');
  expect(h.client.getState()).toMatchObject({ draft: DEFAULTS, hasLocalDraft: false, live: false, reconciliation: null });
  h.client.stop();
});

test('POST deadline includes a stalled response body and stop aborts an active request', async () => {
  const h = harness();
  const starting = h.client.start(); h.resolveNext(stateFor(0)); await starting;
  const draft = clone(DEFAULTS); draft.pre.tx = 0.25; h.client.setDraft(draft);
  const applying = h.client.apply(); const applyError = applying.then(() => null, error => error);
  await h.flushPromises();
  const post = h.pendingRequests()[0];
  post.resolve({ status: 200, ok: true, json: () => new Promise(() => {}) });
  await h.advance(15000);
  expect(await applyError).toMatchObject({ code: 'uncertain_write' });
  expect(h.client.getState().reconciliation.status).toBe('reading');

  h.client.stop();
  expect(h.pendingRequests()[0].options.signal.aborted).toBe(true);
  expect(h.client.getState().reconciliation).toBe(null);

  const h2 = harness();
  const started = h2.client.start(); h2.resolveNext(stateFor(0)); await started;
  const stopping = h2.client.apply(); const stoppedError = stopping.then(() => null, error => error);
  const queued = h2.client.save({ name: 'stopped queued intent' }); const queuedError = queued.then(() => null, error => error);
  await h2.flushPromises();
  const inFlight = h2.pendingRequests()[0];
  h2.client.stop();
  expect(await stoppedError).toMatchObject({ message: expect.stringMatching(/stopped/i) });
  expect(await queuedError).toMatchObject({ message: expect.stringMatching(/stopped/i) });
  expect(inFlight.options.signal.aborted).toBe(true);
  await h2.flushPromises();
  expect(h2.client.getState().pending).toBe(false);
});

beforeEach(() => vi.restoreAllMocks());

test('does not schedule Live or disturb preflight for an identical draft', async () => {
  const h = harness();
  const starting = h.client.start(); h.resolveNext(stateFor(0)); await starting;
  const before = h.client.getState();
  const listener = vi.fn(); const unsubscribe = h.client.subscribe(listener); listener.mockClear();
  h.client.setDraft(structuredClone(before.draft));
  expect(h.client.getState()).toEqual(before);
  expect(listener).not.toHaveBeenCalled();
  await h.advance(1000); expect(h.requests).toHaveLength(0);
  unsubscribe(); h.client.stop();
});

test('identical draft leaves the actual deferred candidate preflight alive', async () => {
  const checks = [];
  const h = harness({ validateCandidate: args => new Promise(resolve => checks.push({ ...args, resolve })) });
  const starting = h.client.start(); h.resolveNext(stateFor(0)); await starting; h.client.setLive(false);
  const candidate = clone(DEFAULTS); candidate.pre.scale = 1.5; h.client.setDraft(candidate);
  const applying = h.client.apply(); const result = applying.catch(error => error);
  await h.flushPromises(); expect(checks).toHaveLength(1);
  const before = h.client.getState();
  h.client.setDraft(structuredClone(candidate));
  expect(checks[0].signal?.aborted).toBe(false);
  expect(h.client.getState()).toEqual(before);
  checks[0].resolve({ identity: checks[0].identity, valid: true }); await h.flushPromises();
  expect(h.requests).toHaveLength(1); expect(JSON.parse(h.requests[0].options.body).config).toEqual(candidate);
  h.resolveNext(stateFor(1, candidate)); await expect(result).resolves.not.toBeInstanceOf(Error);
  h.client.stop();
});

test.each(['http', 'own websocket'])('Save returns its accepted checkpoint identity after %s and keeps receipt context out of state', async (ack) => {
  const h = harness(); const starting = h.client.start(); h.resolveNext(stateFor(0)); await starting; h.client.setLive(false);
  const notifications = []; const receipts = []; const unsubscribe = h.client.subscribe((state, receipt) => { notifications.push(state); receipts.push(receipt); });
  const id = '11111111-1111-4111-8111-111111111111';
  const saved = { ...stateFor(1), selectedPresetId: id, presets: [...stateFor(1).presets, { id, name: 'Desk', config: clone(DEFAULTS), readOnly: false }] };
  const saving = h.client.save({ name: 'Desk' });
  if (ack === 'own websocket') h.socket.emit({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000a', state: saved });
  h.resolveNext(saved); expect(await saving).toMatchObject({ savedPresetId: id }); await h.flushPromises();
  await h.advance(15000);
  expect(h.client.getState().reconciliation).toBe(null);
  expect(receipts.filter(Boolean)).toEqual([{ origin: '00000000-0000-4000-8000-00000000000a', action: 'save' }]);
  expect(receipts.at(-1)).toBeUndefined(); expect(h.client.getState()).not.toHaveProperty('savedPresetId');
  expect(notifications.every((state) => !Object.hasOwn(state, 'savedPresetId') && !Object.hasOwn(state, 'receipt'))).toBe(true);
  unsubscribe(); h.client.stop();
});

test('matching own Save acknowledgment settles a stalled HTTP request before its deadline', async () => {
  const h = harness(); const starting = h.client.start(); h.resolveNext(stateFor(0)); await starting; h.client.setLive(false);
  const id = '11111111-1111-4111-8111-111111111111';
  const saved = { ...stateFor(1), selectedPresetId: id, presets: [...stateFor(1).presets, { id, name: 'Desk', config: clone(DEFAULTS), readOnly: false }] };
  const receipts = []; const unsubscribe = h.client.subscribe((_state, receipt) => { if (receipt) receipts.push(receipt); });
  const saving = h.client.save({ name: 'Desk' });
  const applying = h.client.apply();
  const applyError = applying.then(() => null, error => error);
  await h.flushPromises();
  expect(h.pendingRequests()).toHaveLength(1);
  const stalledPost = h.pendingRequests()[0];
  h.socket.emit({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000a', state: saved });
  await expect(saving).resolves.toMatchObject({ savedPresetId: id, snapshot: { revision: 1 } });
  await h.advance(100);
  expect(h.pendingRequests()).toHaveLength(2);
  expect(JSON.parse(h.pendingRequests()[1].options.body)).toMatchObject({ action: 'preview', baseRevision: 1 });
  h.resolveAt(1, stateFor(2));
  await expect(applyError).resolves.toBe(null);
  await h.advance(15001);
  expect(h.client.getState()).toMatchObject({ snapshot: { revision: 2 }, reconciliation: null, hasLocalDraft: false });
  expect(h.pendingRequests()).toHaveLength(1);
  expect(h.pendingRequests()[0]).toBe(stalledPost);
  expect(receipts).toEqual([{ origin: '00000000-0000-4000-8000-00000000000a', action: 'save' }]);
  h.resolveAt(0, saved);
  await h.flushPromises();
  expect(h.client.getState()).toMatchObject({ snapshot: { revision: 2 }, reconciliation: null, hasLocalDraft: false });
  expect(h.pendingRequests()).toHaveLength(0);
  unsubscribe(); h.client.stop();
});

test('matching own Save acknowledgment settles without replacing a newer local draft or its identity', async () => {
  const h = harness(); const starting = h.client.start(); h.resolveNext(stateFor(0)); await starting; h.client.setLive(false);
  const sentDraft = clone(DEFAULTS); sentDraft.pre.tx = 0.31; h.client.setDraft(sentDraft);
  const saving = h.client.save({ name: 'Desk' });
  await h.flushPromises();
  const newerDraft = clone(sentDraft); newerDraft.pre.tx = 0.42; h.client.setDraft(newerDraft);
  const id = '11111111-1111-4111-8111-111111111111';
  const saved = { ...stateFor(1, sentDraft), selectedPresetId: id, presets: [...stateFor(1).presets, { id, name: 'Desk', config: sentDraft, readOnly: false }] };
  h.socket.emit({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000a', state: saved });
  await expect(saving).resolves.toMatchObject({ savedPresetId: null, draft: newerDraft, hasLocalDraft: true });
  await h.advance(15001);
  expect(h.client.getState()).toMatchObject({ snapshot: { revision: 1 }, draft: newerDraft, hasLocalDraft: true, reconciliation: null });
  expect(h.pendingRequests()).toHaveLength(1);
  h.client.stop();
});

test('socket callbacks captured before stop cannot mutate or resurrect work after stop or restart', async () => {
  const h = harness(); const starting = h.client.start(); h.resolveNext(stateFor(0)); await starting;
  const oldMessage = h.captureHandlers('otef_projection_config_changed')[0];
  const oldConnect = h.captureHandlers('connect')[0];
  const oldDisconnect = h.captureHandlers('disconnect')[0];
  const revisions = [];
  const unsubscribe = h.client.subscribe((state) => revisions.push(state.snapshot?.revision ?? null));
  revisions.length = 0;
  h.client.stop();
  revisions.length = 0;
  const revisionBefore = h.client.getState().snapshot.revision;
  const requestCount = h.pendingRequests().length;
  oldMessage({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000b', state: stateFor(99) });
  oldConnect(); oldDisconnect();
  expect(h.client.getState()).toMatchObject({ snapshot: { revision: revisionBefore }, hydrating: false });
  expect(h.pendingRequests()).toHaveLength(requestCount);
  expect(revisions).toEqual([]);

  const restarted = h.client.start();
  expect(h.pendingRequests()).toHaveLength(requestCount + 1);
  h.resolveNext(stateFor(1)); await restarted;
  revisions.length = 0;
  oldMessage({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000b', state: stateFor(99) });
  oldConnect(); oldDisconnect();
  expect(h.client.getState()).toMatchObject({ snapshot: { revision: 1 }, hydrating: false, connected: true });
  expect(h.pendingRequests()).toHaveLength(requestCount);
  expect(revisions).toEqual([]);
  unsubscribe(); h.client.stop();
});

test.each(['foreign update', 'local edit'])('Save identity is null when its successful response is protected by a %s', async (race) => {
  const h = harness(); const starting = h.client.start(); h.resolveNext(stateFor(0)); await starting; h.client.setLive(false);
  const id = '11111111-1111-4111-8111-111111111111';
  const saved = { ...stateFor(1), selectedPresetId: id, presets: [...stateFor(1).presets, { id, name: 'Desk', config: clone(DEFAULTS), readOnly: false }] };
  const saving = h.client.save({ name: 'Desk' });
  if (race === 'foreign update') h.socket.emit({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000b', state: stateFor(2) });
  else { const edited = clone(DEFAULTS); edited.pre.tx = 0.2; h.client.setDraft(edited); }
  const protectedDraft = h.client.getState().draft; h.resolveNext(saved);
  expect(await saving).toMatchObject({ savedPresetId: null, hasLocalDraft: true, draft: protectedDraft });
  await h.flushPromises(); h.client.stop();
});

test.each([
  ["HTTP failure", (h) => h.resolveNext({}, 503), /503/],
  ["network failure", (h) => h.rejectNext(new Error("offline")), /offline/],
  ["invalid response", (h) => h.resolveNext({ invalid: true }), /invalid projection config response/],
])("terminal %s settles the actual browser startup waiter with actionable client error", async (_label, failHydration, error) => {
  const h = harness();
  let unsubscribeCount = 0;
  const subscribe = h.client.subscribe.bind(h.client);
  vi.spyOn(h.client, 'subscribe').mockImplementation((listener) => {
    const unsubscribe = subscribe(listener);
    return () => { unsubscribeCount += 1; unsubscribe(); };
  });
  const starting = waitForProjectionConfigStartup(h.client);
  failHydration(h);
  const state = await starting;
  expect(state.hydrationError).toMatch(error);
  expect(h.client.getState().hydrationError).toMatch(error);
  expect(unsubscribeCount).toBe(0);
  expect(h.pendingRequests()).toHaveLength(0);
});

test("a disconnected start hydrates once after asynchronous connect and returns the accepted snapshot", async () => {
  const h = harness({ connectOnStart: false });
  let unsubscribeCount = 0;
  const subscribe = h.client.subscribe.bind(h.client);
  vi.spyOn(h.client, 'subscribe').mockImplementation((listener) => {
    const unsubscribe = subscribe(listener);
    return () => { unsubscribeCount += 1; unsubscribe(); };
  });
  const starting = waitForProjectionConfigStartup(h.client);
  expect(h.fetchImpl).not.toHaveBeenCalled();
  h.connect();
  expect(h.fetchImpl).toHaveBeenCalledOnce();
  h.resolveNext(stateFor(12));
  await expect(starting).resolves.toMatchObject({ snapshot: { revision: 12 } });
  await h.flushPromises();
  expect(h.client.getState().snapshot?.revision).toBe(12);
  expect(unsubscribeCount).toBe(1);
  expect(h.fetchImpl).toHaveBeenCalledOnce();
  expect(h.client.getState()).toMatchObject({ hydrating: false, snapshot: { revision: 12 } });
});

test("disposing a pending startup waiter unsubscribes and settles it", async () => {
  const h = harness({ connectOnStart: false });
  const controller = new AbortController();
  let unsubscribeCount = 0;
  const subscribe = h.client.subscribe.bind(h.client);
  vi.spyOn(h.client, 'subscribe').mockImplementation((listener) => {
    const unsubscribe = subscribe(listener);
    return () => { unsubscribeCount += 1; unsubscribe(); };
  });
  const starting = waitForProjectionConfigStartup(h.client, { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await expect(starting).rejects.toMatchObject({ name: 'AbortError' });
  expect(unsubscribeCount).toBe(1);
  h.client.stop();
});

test('hydration converts historical working and preset configs to V4', async () => {
  const h = harness();
  const historical = migrateNamesWallToV3(migrateProjectionConfigToV2(LEGACY_DEFAULT_PROJECTION_CONFIG));
  historical.namesWall.profiles.wall.seamGapPx = 3;
  const saved = stateFor(9, historical);
  saved.presets.push({ id: '11111111-1111-4111-8111-111111111111', name: 'Old', config: clone(historical), readOnly: false });
  const starting = h.client.start(); h.resolveNext(saved); await starting;
  const state = h.client.getState();
  expect(state.snapshot.revision).toBe(9);
  expect(state.snapshot.config.schemaVersion).toBe(7);
  expect(state.snapshot.presets[1].config.schemaVersion).toBe(7);
  expect(state.draft.namesWall.innerEdgeInsetPx).toEqual({ left: 0, right: 0 });
  expect(state.draft.namesWall.profiles.wall).not.toHaveProperty('seamGapPx');
  expect(state.draft.pre).toEqual(historical.pre);
  expect(state.migrationWarnings).toContain('The wall seam gap needs readjustment in final-output pixels.');
  h.client.stop();
});

test('hydration normalizes old V6 configs and preserves the reserved Original calibration', async () => {
  const h = harness();
  const old = (await import('../../frontend/src/shared/nli-name-wall-config.js')).migrateNamesWallToV6(LEGACY_DEFAULT_PROJECTION_CONFIG, 35);
  delete old.namesWall.profiles.wall.strokeWidthPx;
  delete old.namesWall.profiles.model.strokeWidthPx;
  const saved = stateFor(12, old);
  saved.presets[0].config = clone(old);
  saved.presets.push({ id: '11111111-1111-4111-8111-111111111111', name: 'Old profile', config: clone(old), readOnly: false });
  const starting = h.client.start(); h.resolveNext(saved); await starting;
  const state = h.client.getState();
  expect(state.snapshot.config.namesWall.profiles).toMatchObject({ wall: { strokeWidthPx: 3 }, model: { strokeWidthPx: 2 } });
  expect(state.snapshot.presets[0].config.namesWall.profiles).toMatchObject({ wall: { strokeWidthPx: 3 }, model: { strokeWidthPx: 2 } });
  expect(state.snapshot.presets[1].config.namesWall.profiles).toMatchObject({ wall: { strokeWidthPx: 3 }, model: { strokeWidthPx: 2 } });
  expect(state.draft.namesWall.profiles).toMatchObject({ wall: { strokeWidthPx: 3 }, model: { strokeWidthPx: 2 } });
  h.client.stop();
});

test.each(['live', 'apply', 'save', 'load', 'revert'])(
  '%s waits for matching asynchronous wall preflight and never posts a newer draft under an older result', async (action) => {
    const checks = [];
    const h = harness({ validateCandidate: (candidate) => new Promise((resolve) => checks.push({ candidate, resolve })) });
    const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
    const a = clone(DEFAULTS); a.pre.tx = 0.011;
    const b = clone(DEFAULTS); b.pre.tx = 0.02;
    const c = clone(DEFAULTS); c.pre.tx = 0.03;
    if (action !== 'live') h.client.setLive(false);
    if (action === 'load') {
      h.socket.emit({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000a', state: {
        ...h.stateFor(1), presets: [...h.stateFor(1).presets, { id: '11111111-1111-4111-8111-111111111111', name: 'Candidate', config: a, readOnly: false }],
      } });
    } else if (action === 'revert') {
      h.socket.emit({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000a', state: h.stateFor(1, a) });
    }
    if (action !== 'load' && action !== 'revert') h.client.setDraft(a);
    const first = action === 'apply' ? h.client.apply() : action === 'save' ? h.client.save({ name: 'Draft' })
      : action === 'load' ? h.client.load('11111111-1111-4111-8111-111111111111') : action === 'revert' ? h.client.revert() : null;
    const firstResult = first?.catch((error) => error);
    await h.advance(0);
    await h.flushPromises();
    expect(checks).toHaveLength(1);
    h.client.setDraft(b);
    checks[0].resolve({ identity: checks[0].candidate.identity, valid: true });
    await h.flushPromises();
    expect(h.pendingRequests()).toHaveLength(0);
    if (firstResult) expect(await firstResult).toBeInstanceOf(Error);
    if (action !== 'live') h.client.setLive(true);
    await h.advance(0);
    await h.flushPromises();
    expect(checks).toHaveLength(2);
    checks[1].resolve({ identity: checks[1].candidate.identity, valid: false, reason: 'incomplete wall' });
    await h.flushPromises();
    expect(h.pendingRequests()).toHaveLength(0);
    expect(h.client.getState().draft).toEqual(b);
    h.client.setDraft(c);
    await h.advance(0);
    await h.flushPromises();
    expect(checks).toHaveLength(3);
    checks[2].resolve({ identity: checks[2].candidate.identity, valid: true });
    await h.flushPromises();
    expect(JSON.parse(h.lastRequest().options.body).config).toEqual(c);
    h.client.stop();
  },
);

test('candidate preflight fallback reports geometry validation rather than name placement', async () => {
  const h = harness({ validateCandidate: async ({ identity }) => ({ identity, valid: false }) });
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  const candidate = clone(DEFAULTS); candidate.pre.tx = 0.025;
  h.client.setDraft(candidate);
  const applied = h.client.apply().then(() => null, (error) => error.message);
  await h.advance(0); await h.flushPromises();
  expect(await applied).toBe('projection geometry preflight unavailable');
  expect(h.client.getState().previewError).toBe('projection geometry preflight unavailable');
  h.client.stop();
});

test('explicit Apply with Live off still preflights and posts exactly once', async () => {
  const validateCandidate = vi.fn(async ({ identity }) => ({ identity, valid: true }));
  const h = harness({ validateCandidate });
  const started = h.client.start(); h.resolveNext(h.stateFor(4)); await started;
  h.client.setLive(false);
  const candidate = clone(DEFAULTS); candidate.pre.tx = 0.125;
  h.client.setDraft(candidate);
  const applied = h.client.apply().then((value) => ({ value }), (error) => ({ error }));
  await h.advance(0); await h.flushPromises();
  expect(validateCandidate).toHaveBeenCalledOnce();
  expect(h.pendingRequests()).toHaveLength(1);
  expect(JSON.parse(h.lastRequest().options.body).config).toEqual(candidate);
  h.resolveNext(stateFor(5, candidate));
  expect((await applied).error).toBeUndefined();
  expect(h.client.getState()).toMatchObject({ live: false, snapshot: { revision: 5, config: candidate } });
  expect(h.pendingRequests()).toHaveLength(0);
  h.client.stop();
});

test('an abandoned wall check cannot block a newer valid Live edit', async () => {
  const checks = [];
  const h = harness({ validateCandidate: (candidate) => new Promise((resolve) => checks.push({ candidate, resolve })) });
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  const a = clone(DEFAULTS); a.pre.tx = 0.011;
  const b = clone(DEFAULTS); b.pre.tx = 0.02;
  h.client.setDraft(a); await h.advance(0); await h.flushPromises();
  expect(checks).toHaveLength(1);
  h.client.setDraft(b); await h.advance(0); await h.flushPromises();
  expect(checks).toHaveLength(2);
  checks[1].resolve({ identity: checks[1].candidate.identity, valid: true });
  await h.flushPromises();
  expect(JSON.parse(h.lastRequest().options.body).config).toEqual(b);
  checks[0].resolve({ identity: checks[0].candidate.identity, valid: true });
  await h.flushPromises();
  expect(h.pendingRequests()).toHaveLength(1);
  h.client.stop();
});

test('hydrates revision zero from a full snapshot', async () => {
  const h = harness();
  const started = h.client.start();
  h.resolveNext(h.stateFor(0));
  await started;
  expect(h.client.getState().snapshot.revision).toBe(0);
  expect(h.client.getState().draft).toEqual(DEFAULTS);
});

test('accepts a legacy Original alongside the v2 reserved TD migration preset', () => {
  const legacy = {
    schemaVersion: 1,
    pre: clone(DEFAULTS.pre),
    outputs: Object.fromEntries(['left', 'right'].map((side) => [side, {
      crop: clone(DEFAULTS.outputs[side].crop),
      post: clone(DEFAULTS.outputs[side].post),
    }])),
  };
  const baseline = {
    ...legacy,
    pre: { ...legacy.pre, scale: 1.25 },
  };
  const snapshot = {
    revision: 1,
    config: legacy,
    presets: [
      { id: 'original', name: 'Original calibration', config: legacy, readOnly: true },
      { id: TD_MIGRATION_PRESET_ID, name: 'TD migration baseline', config: baseline, readOnly: true },
    ],
    selectedPresetId: 'original',
  };
  expect(validateProjectionConfigSnapshot(snapshot)).toBe(true);
});

test('accepts a historical V2 Original and rejects a modified V3 Original', () => {
  const v2Original = migrateProjectionConfigToV2({
    schemaVersion: 1,
    pre: clone(DEFAULTS.pre),
    outputs: Object.fromEntries(['left', 'right'].map((side) => [side, {
      crop: clone(DEFAULTS.outputs[side].crop), post: clone(DEFAULTS.outputs[side].post),
    }])),
  });
  const snapshot = stateFor(4);
  snapshot.presets[0].config = v2Original;
  expect(validateProjectionConfigSnapshot(snapshot)).toBe(true);
  snapshot.presets[0].config = clone(DEFAULTS);
  snapshot.presets[0].config.namesWall.profiles.wall.spacingPx = 3;
  expect(validateProjectionConfigSnapshot(snapshot)).toBe(false);
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

test('accepted foreign revisions carry private origin metadata while own revisions remain ordinary acknowledgments', async () => {
  const h = harness();
  const started = h.client.start(); h.resolveNext(h.stateFor(0)); await started;
  const receipts = [];
  const unsubscribe = h.client.subscribe((_state, receipt) => receipts.push(receipt));
  h.socket.emit({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000b', state: h.stateFor(1) });
  expect(receipts.at(-1)).toEqual({ origin: '00000000-0000-4000-8000-00000000000b', foreign: true });
  h.socket.emit({ type: 'otef_projection_config_changed', table: 'otef', sourceId: '00000000-0000-4000-8000-00000000000a', state: h.stateFor(2) });
  expect(receipts.at(-1)).toBeUndefined();
  expect(h.client.getState()).not.toHaveProperty('receipt');
  unsubscribe(); h.client.stop();
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

test('automatic Live working geometry and named checkpoints survive a shared service across fresh clients', async () => {
  const presetId = '11111111-1111-4111-8111-111111111111';
  let stored = stateFor(0);
  const writes = [];
  const serviceFetch = async (_url, options = {}) => {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      writes.push(clone(body));
      if (body.baseRevision !== stored.revision) return { status: 409, ok: false, json: async () => ({ error: 'conflict', state: clone(stored) }) };
      const next = clone(stored);
      if (body.action === 'preview' || body.action === 'save') next.config = clone(body.config);
      if (body.action === 'save') {
        const id = body.presetId || presetId;
        next.presets = next.presets.filter((preset) => preset.id !== id);
        next.presets.push({ id, name: body.name, config: clone(body.config), readOnly: false });
        next.selectedPresetId = id;
      }
      if (body.action === 'load') {
        next.config = clone(next.presets.find((preset) => preset.id === body.presetId).config);
        next.selectedPresetId = body.presetId;
      }
      next.revision += 1;
      stored = next;
    }
    const response = clone(stored);
    return { status: 200, ok: true, json: async () => response };
  };
  const h = harness({ serviceFetch }); await h.client.start();
  expect(h.client.getState().live).toBe(true);
  const working = clone(DEFAULTS); working.pre.tx = 0.17; working.outputs.left.crop.x0 = 0.04;
  h.client.setDraft(working);
  await h.advance(100); await h.flushPromises();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ action: 'preview', config: working });
  expect(h.client.getState().pending).toBe(false);
  const workingHydration = harness({ serviceFetch }); await workingHydration.client.start();
  expect(workingHydration.client.getState().snapshot.config).toEqual(working);
  expect(workingHydration.client.getState().snapshot.presets).toEqual(stateFor(0).presets);

  const checkpoint = clone(working); checkpoint.pre.tx = 0.23; checkpoint.outputs.right.crop.y0 = 0.06;
  await h.client.setLive(false); h.client.setDraft(checkpoint);
  const saving = h.client.save({ presetId: null, name: 'Coast' });
  await h.advance(100); await saving; await h.flushPromises();
  expect(writes[1]).toMatchObject({ action: 'save', config: checkpoint, presetId: null, name: 'Coast' });
  expect(h.client.getState().snapshot.presets.find((preset) => preset.id === presetId).config).toEqual(checkpoint);

  const laterEdit = clone(checkpoint); laterEdit.pre.tx = 0.31; h.client.setDraft(laterEdit);
  await h.advance(100); expect(writes).toHaveLength(2);
  const savedHydration = harness({ serviceFetch }); await savedHydration.client.start();
  expect(savedHydration.client.getState().snapshot.config).toEqual(checkpoint);
  expect(savedHydration.client.getState().snapshot.presets.find((preset) => preset.id === presetId).config).toEqual(checkpoint);
  const loading = h.client.load(presetId); await h.advance(100); const loaded = await loading;
  expect(writes[2]).toMatchObject({ action: 'load', presetId });
  expect(loaded).toMatchObject({ draft: checkpoint, hasLocalDraft: false, draftReplaced: true });

  const reload = harness({ serviceFetch }); await reload.client.start();
  expect(reload.client.getState().snapshot.config).toEqual(checkpoint);
  expect(reload.client.getState().snapshot.presets.find((preset) => preset.id === presetId).config).toEqual(checkpoint);
  expect(reload.client.getState().snapshot.selectedPresetId).toBe(presetId);
  for (const instance of [h, workingHydration, savedHydration, reload]) instance.client.stop();
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
  expect((await loading).draftReplaced).toBe(false);
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
  expect((await reverting).draftReplaced).toBe(false);
  expect(h.client.getState().snapshot.revision).toBe(2);
  expect(h.client.getState().draft).toEqual(preserved);
  expect(h.client.getState().hasLocalDraft).toBe(true);
});

test.each(['load', 'revert'])('%s replacement outcomes belong to each request and never appear in subscribed state', async (operation) => {
  const h = harness(); const starting = h.client.start(); h.resolveNext(stateFor(0)); await starting;
  h.client.setLive(false);
  const notifications = []; const unsubscribe = h.client.subscribe((state) => notifications.push(state));
  const replace = () => operation === 'load' ? h.client.load('original') : h.client.revert();
  const accepted = replace(); h.resolveNext(stateFor(1));
  expect(await accepted).toMatchObject({ draftReplaced: true, draft: DEFAULTS });
  await h.flushPromises();
  const pending = replace(); await h.advance(100);
  const edited = clone(DEFAULTS); edited.pre.tx = 0.19; h.client.setDraft(edited);
  h.resolveNext(stateFor(2));
  expect(await pending).toMatchObject({ draftReplaced: false, draft: edited, hasLocalDraft: true });
  await h.flushPromises();
  expect(h.client.getState()).not.toHaveProperty('draftReplaced');
  expect(notifications.every((state) => !Object.hasOwn(state, 'draftReplaced'))).toBe(true);
  expect(notifications.at(-1)).toMatchObject({ draft: edited, hasLocalDraft: true, pending: false });
  unsubscribe(); h.client.stop();
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

test('a V5 snapshot requires initialization, normalizes to v7, and does not write', async () => {
  const h = harness();
  const v5 = migrateNamesWallToV5(LEGACY_DEFAULT_PROJECTION_CONFIG);
  const snapshot = h.stateFor(4, v5);
  snapshot.presets[0].config = clone(v5);
  const started = h.client.start();
  h.resolveNext(snapshot);
  await started;
  const state = h.client.getState();
  expect(state.initializationRequired).toBe(true);
  expect(state.snapshot.config.schemaVersion).toBe(7);
  expect(state.draft?.namesWall?.rotateDeg).toBe(35);
  expect(h.pendingRequests()).toHaveLength(0);
  await expect(h.client.apply()).rejects.toThrow(/initialization/i);
  expect(h.pendingRequests()).toHaveLength(0);
  h.client.stop();
});

test('a V6 snapshot normalizes locally but stays gated by the installed schema version', async () => {
  const h = harness();
  const v6 = (await import('../../frontend/src/shared/nli-name-wall-config.js')).migrateNamesWallToV6(LEGACY_DEFAULT_PROJECTION_CONFIG, 35);
  const snapshot = h.stateFor(4, v6);
  snapshot.presets[0].config = clone(v6);
  const started = h.client.start(); h.resolveNext(snapshot); await started;
  expect(h.client.getState()).toMatchObject({ initializationRequired: true, snapshot: { config: { schemaVersion: 7 } } });
  await expect(h.client.apply()).rejects.toThrow(/initialization/i);
  expect(h.pendingRequests()).toHaveLength(0);
  h.client.stop();
});

test('same-revision authoritative hydration refreshes installed schema while preserving draft and history', async () => {
  const h = harness();
  const { migrateNamesWallToV6 } = await import('../../frontend/src/shared/nli-name-wall-config.js');
  const v6 = migrateNamesWallToV6(migrateNamesWallToV5(migrateProjectionConfigToV2(LEGACY_DEFAULT_PROJECTION_CONFIG)), 35);
  const oldSnapshot = h.stateFor(4, v6); oldSnapshot.presets[0].config = clone(v6);
  const started = h.client.start(); h.resolveNext(oldSnapshot); await started;
  const draft = clone(DEFAULTS); draft.pre.tx = 0.27; h.client.setDraft(draft);
  const upgraded = h.stateFor(4, DEFAULTS);
  h.disconnect(); h.reconnect(); h.resolveNext(upgraded); await h.flushPromises();
  expect(h.client.getState()).toMatchObject({ initializationRequired: false, snapshot: { revision: 4, config: { schemaVersion: 7 } }, draft, hasLocalDraft: true });
  h.disconnect(); h.reconnect();
  const authoritativeOld = h.stateFor(4, v6); authoritativeOld.presets[0].config = clone(v6);
  h.resolveNext(authoritativeOld); await h.flushPromises();
  expect(h.client.getState()).toMatchObject({ initializationRequired: true, snapshot: { revision: 4, config: { schemaVersion: 7 } }, draft, hasLocalDraft: true });
  await expect(h.client.apply()).rejects.toThrow(/initialization/i);
  expect(h.pendingRequests()).toHaveLength(0);
});

test('v7 snapshots preserve custom knot axes and reserve Original for canonical uniform topology', async () => {
  const h = harness();
  const snapshot = h.stateFor(8);
  const custom = clone(DEFAULTS);
  custom.outputs.left.warp.grid.columnPositions[1] = 0.1;
  snapshot.presets.push({ id: '11111111-1111-4111-8111-111111111111', name: 'Custom grid', config: custom, readOnly: false });
  expect(validateProjectionConfigSnapshot(snapshot)).toBe(true);
  const started = h.client.start(); h.resolveNext(snapshot); await started;
  expect(h.client.getState().snapshot.presets[1].config.outputs.left.warp.grid.columnPositions[1]).toBe(0.1);
  const invalidOriginal = clone(snapshot);
  invalidOriginal.presets[0].config.outputs.left.warp.grid.columnPositions[1] = 0.1;
  expect(validateProjectionConfigSnapshot(invalidOriginal)).toBe(false);
  h.client.stop();
});

test('schema_changed keeps the unsaved draft and does not retry', async () => {
  const h = harness();
  const started = h.client.start();
  h.resolveNext(h.stateFor(0));
  await started;
  h.client.setLive(false);
  const edited = clone(DEFAULTS);
  edited.pre = { ...edited.pre, tx: 0.44 };
  h.client.setDraft(edited);
  const pending = h.client.apply();
  const result = pending.catch((error) => error);
  await h.advance(100);
  expect(h.pendingRequests()).toHaveLength(1);
  h.resolveNext({ error: 'schema_changed', requiredSchemaVersion: 7, state: h.stateFor(1) }, 409);
  await h.flushPromises();
  const error = await result;
  expect(error.schemaChanged).toBe(true);
  const state = h.client.getState();
  expect(state.schemaChanged).toBe(true);
  expect(state.hasLocalDraft).toBe(true);
  expect(state.draft.pre.tx).toBe(0.44);
  await h.advance(1000);
  expect(h.pendingRequests()).toHaveLength(0);
  h.client.stop();
});

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
