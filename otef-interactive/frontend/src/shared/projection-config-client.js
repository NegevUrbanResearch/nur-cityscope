import {
  DEFAULT_PROJECTION_CONFIG,
  LEGACY_DEFAULT_PROJECTION_CONFIG,
  TD_MIGRATION_PRESET_ID,
  TD_MIGRATION_PRESET_NAME,
  migrateProjectionConfigToV7,
  validateProjectionConfig,
} from './projection-config-schema.js';
import { migrateNamesWallToV5, migrateNamesWallToV6 } from './nli-name-wall-config.js';
import { migrateProjectionConfigToV2 } from './projection-warp-schema.js';
import { withRequestDeadline } from './request-deadline.js';

const API_URL = '/api/otef/projection-config/';
const TABLE = 'otef';
const WRITE_INTERVAL = 100;
const CONFLICT_MESSAGE = 'Calibration changed on another screen; latest settings loaded.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const clone = (value) => {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

export function equalProjectionConfig(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length || aKeys.some((key) => !Object.hasOwn(b, key))) return false;
  return aKeys.every((key) => equalProjectionConfig(a[key], b[key]));
}
const equal = equalProjectionConfig;
const V2_DEFAULT_PROJECTION_CONFIG = migrateProjectionConfigToV2(LEGACY_DEFAULT_PROJECTION_CONFIG);
const V5_DEFAULT_PROJECTION_CONFIG = migrateNamesWallToV5(LEGACY_DEFAULT_PROJECTION_CONFIG);
const isUuid = (value) => typeof value === 'string' && UUID.test(value);

function withoutRotation(config) {
  const copy = clone(config);
  if (copy?.namesWall) delete copy.namesWall.rotateDeg;
  return copy;
}

function originalConfigOk(config) {
  if (config?.schemaVersion === 7) {
    const angle = config.namesWall?.rotateDeg;
    if (typeof angle !== 'number' || !Number.isFinite(angle) || angle < -180 || angle > 180) return false;
    return equal(withoutRotation(migrateProjectionConfigToV7(config, angle)), withoutRotation(DEFAULT_PROJECTION_CONFIG));
  }
  if (config?.schemaVersion === 6) {
    const angle = config.namesWall?.rotateDeg;
    if (typeof angle !== 'number' || !Number.isFinite(angle) || angle < -180 || angle > 180) return false;
    return equal(withoutRotation(migrateNamesWallToV6(config, angle)), withoutRotation(migrateNamesWallToV6(LEGACY_DEFAULT_PROJECTION_CONFIG, 35)));
  }
  return [V5_DEFAULT_PROJECTION_CONFIG, V2_DEFAULT_PROJECTION_CONFIG, LEGACY_DEFAULT_PROJECTION_CONFIG].some((baseline) => equal(migrateNamesWallToV5(config), migrateNamesWallToV5(baseline)));
}

function validSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = ['revision', 'config', 'presets', 'selectedPresetId'];
  if (Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !Object.hasOwn(value, key))) return false;
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || Object.keys(validateProjectionConfig(value.config)).length) return false;
  if (!Array.isArray(value.presets) || value.presets.length < 1 || value.presets.length > 50) return false;
  const ids = new Set();
  let originalCount = 0;
  for (const preset of value.presets) {
    if (!preset || typeof preset !== 'object' || Array.isArray(preset)) return false;
    if (Object.keys(preset).some((key) => !['id', 'name', 'config', 'readOnly'].includes(key))) return false;
    if (!['id', 'name', 'config', 'readOnly'].every((key) => Object.hasOwn(preset, key))) return false;
    if (typeof preset.id !== 'string' || !preset.id || ids.has(preset.id) || typeof preset.name !== 'string' || !preset.name.trim() || preset.name !== preset.name.trim() || preset.name.length > 80 || typeof preset.readOnly !== 'boolean') return false;
    if (Object.keys(validateProjectionConfig(preset.config)).length) return false;
    ids.add(preset.id);
    if (preset.id === 'original') {
      originalCount += 1;
      if (!preset.readOnly || preset.name !== 'Original calibration' || !originalConfigOk(preset.config)) return false;
    } else if (preset.id === TD_MIGRATION_PRESET_ID) {
      if (!preset.readOnly || preset.name !== TD_MIGRATION_PRESET_NAME) return false;
    } else if (!isUuid(preset.id) || preset.readOnly) return false;
  }
  if (originalCount !== 1 || typeof value.selectedPresetId !== 'string' || !ids.has(value.selectedPresetId)) return false;
  return true;
}

function normalizeSnapshot(value, warnings = []) {
  const normalizeConfig = (config) => migrateProjectionConfigToV7(config, config?.namesWall?.rotateDeg ?? 35, warnings);
  return {
    ...clone(value),
    config: normalizeConfig(value.config),
    presets: value.presets.map((preset) => ({ ...clone(preset), config: normalizeConfig(preset.config) })),
  };
}

function responseBody(response) {
  if (!response || typeof response.json !== 'function') return Promise.reject(new Error('invalid projection config response'));
  return response.json();
}

export function createProjectionConfigClient({
  table = TABLE,
  sourceId,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  socket,
  clock = globalThis,
  onState,
  onConflict,
  onConnection,
  validateCandidate = null,
} = {}) {
  if (!isUuid(sourceId)) throw new Error('sourceId must be a UUID');
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');

  let started = false;
  let stopped = false;
  let connected = false;
  let snapshot = null;
  let installedSchemaVersion = null;
  let draft = null;
  let hasLocalDraft = false;
  let live = true;
  let draftVersion = 0;
  let timer = null;
  let lastSendAt = -Infinity;
  let inFlight = null;
  let preflighting = null;
  let intent = null;
  let hydrationGeneration = 0;
  let hydrationPromise = null;
  let hydrating = false;
  let hydrationError = null;
  let reconciliation = null;
  let reconciliationGeneration = 0;
  let reconciliationController = null;
  let hydrationController = null;
  let previewError = null;
  let migrationWarnings = [];
  let conflictGeneration = 0;
  let schemaChanged = false;
  const subscribers = new Set();
  const handlers = [];

  const now = () => (typeof clock.now === 'function' ? clock.now() : Date.now());
  const setTimer = (callback, delay) => (typeof clock.setTimeout === 'function' ? clock.setTimeout(callback, delay) : setTimeout(callback, delay));
  const clearTimer = (id) => (typeof clock.clearTimeout === 'function' ? clock.clearTimeout(id) : clearTimeout(id));

  function getState() {
    return {
      snapshot: snapshot ? clone(snapshot) : null,
      draft: draft ? clone(draft) : null,
      live,
      connected,
      pending: Boolean(inFlight || preflighting || timer || intent),
      hasLocalDraft,
      hydrating,
      hydrationError,
      reconciliation: reconciliation ? { ...reconciliation } : null,
      previewError,
      migrationWarnings: [...migrationWarnings],
      initializationRequired: Boolean(snapshot?.config && installedSchemaVersion < 7),
      schemaChanged,
    };
  }

  function setupRequired() {
    return Boolean(snapshot?.config && installedSchemaVersion < 7);
  }

  function notify(receipt) {
    const state = getState();
    if (typeof onState === 'function') onState(state);
    for (const listener of subscribers) listener(getState(), receipt);
  }

  function setConnected(value) {
    if (connected === value) return;
    connected = value;
    if (!connected) {
      if (timer !== null) { clearTimer(timer); timer = null; }
      queuedPreview = null;
      live = false;
      cancelPreflight('projection config connection lost');
      if (intent) {
        intent.reject(new Error('projection config connection lost'));
        intent = null;
      }
      if (inFlight) {
        const uncertain = inFlight;
        uncertain.retired = true;
        uncertain.failed = true;
        inFlight = null;
        uncertain.controller?.abort();
        uncertain.reject(new Error('projection config connection lost'));
      }
      hydrationController?.abort();
    }
    if (typeof onConnection === 'function') onConnection(connected);
    notify();
  }

  function cancelQueuedPreviews() {
    if (timer !== null) { clearTimer(timer); timer = null; }
    queuedPreview = null;
  }

  let queuedPreview = null;

  function markConflict(next) {
    cancelQueuedPreviews();
    live = false;
    conflictGeneration += 1;
    cancelPreflight('projection config conflict');
    if (intent) {
      intent.reject(new Error('projection config conflict'));
      intent = null;
    }
    hasLocalDraft = Boolean(draft) || hasLocalDraft;
    if (typeof onConflict === 'function') onConflict(CONFLICT_MESSAGE);
    if (validSnapshot(next) && (!snapshot || next.revision > snapshot.revision)) {
      const warnings = [];
      installedSchemaVersion = next.config.schemaVersion;
      snapshot = normalizeSnapshot(next, warnings);
      migrationWarnings = [...new Set(warnings)];
    }
    notify();
  }

  function receiveSnapshot(next, { origin, fromHydrate = false, preserveLive = false } = {}) {
    if (!validSnapshot(next)) return false;
    if (snapshot && next.revision < snapshot.revision) return false;
    if (snapshot && next.revision === snapshot.revision) {
      // Installation migrations preserve calibration revisions. An authoritative
      // hydration may therefore refresh the write gate without replacing the
      // normalized snapshot, unsaved draft, or its edit history.
      if (!fromHydrate) return false;
      installedSchemaVersion = next.config.schemaVersion;
      notify();
      return true;
    }
    const foreign = origin !== undefined && origin !== null && origin !== sourceId;
    if (foreign && (hasLocalDraft || inFlight || queuedPreview || intent)) markConflict(next);
    const warnings = [];
    installedSchemaVersion = next.config.schemaVersion;
    snapshot = normalizeSnapshot(next, warnings);
    migrationWarnings = [...new Set(warnings)];
    if (!hasLocalDraft) {
      draft = clone(snapshot.config);
      hasLocalDraft = false;
    } else if (fromHydrate && !preserveLive) {
      live = false;
    }
    // Receipt context lasts only for this adoption. An own checkpoint Save
    // changes preset selection without replacing the editing session.
    notify(origin === sourceId && matchesSaveAcknowledgement(inFlight, next)
      ? { origin, action: 'save' } : undefined);
    return true;
  }

  function matchesSaveAcknowledgement(request, next) {
    if (request?.action !== 'save' || request.retired || next.revision !== request.sentRevision + 1) return false;
    const checkpoint = next.presets.find((preset) => preset.id === next.selectedPresetId);
    return Boolean(checkpoint && !checkpoint.readOnly && checkpoint.name === String(request.body.name ?? '').trim() &&
      (!request.body.presetId || checkpoint.id === request.body.presetId) &&
      equalProjectionConfig(next.config, request.body.config) && equalProjectionConfig(checkpoint.config, request.body.config));
  }

  async function hydrate() {
    const generation = ++hydrationGeneration;
    hydrationController?.abort();
    const controller = new AbortController();
    hydrationController = controller;
    hydrating = true;
    hydrationError = null;
    notify();
    let body;
    try {
      const { response, body: hydratedBody } = await withRequestDeadline(async (signal) => {
        const response = await fetchImpl(`${API_URL}?table=${encodeURIComponent(table)}`, { method: 'GET', signal });
        const body = await responseBody(response);
        return { response, body };
      }, { signal: controller.signal, setTimer, clearTimer });
      const status = response?.status ?? 200;
      const ok = response?.ok ?? (status >= 200 && status < 300);
      if (!ok) throw new Error(`projection config hydration failed (${status})`);
      body = hydratedBody;
    } catch (error) {
      if (generation === hydrationGeneration) {
        hydrationError = error?.message || 'projection config hydration failed';
        notify();
      }
      return null;
    }
    if (generation !== hydrationGeneration) return null;
    if (!validSnapshot(body)) {
      hydrationError = 'invalid projection config response';
      notify();
      return null;
    }
    receiveSnapshot(body, { fromHydrate: true });
    hydrating = false;
    if (hydrationController === controller) hydrationController = null;
    notify();
    return getState();
  }

  function socketMessage(message) {
    if (!message || message.type !== 'otef_projection_config_changed' || message.table !== table || !isUuid(message.sourceId)) return;
    receiveSnapshot(message.state, { origin: message.sourceId });
  }

  function schedulePreview() {
    if (!started || stopped || !connected || hydrating || reconciliation || !live || !draft || !snapshot || intent || setupRequired()) return;
    queuedPreview = { config: clone(draft), version: draftVersion };
    scheduleDrain();
  }

  function postMutation(operation) {
    if (!snapshot || !connected || hydrating || reconciliation || stopped) {
      operation.reject(new Error(reconciliation ? 'resolve uncertain projection config write first' : hydrating ? 'projection config is hydrating' : 'projection config is disconnected'));
      return;
    }
    if (inFlight) {
      if (intent) intent.reject(new Error('projection config operation superseded'));
      intent = operation;
      notify();
      return;
    }
    const sentRevision = snapshot.revision;
    const sentVersion = draftVersion;
    const operationConfig = operation.dynamicDraft ? clone(draft) : operation.config;
    const body = {
      table,
      baseRevision: sentRevision,
      sourceId,
      action: operation.action,
    };
    if (operation.action === 'preview' || operation.action === 'save') body.config = clone(operationConfig);
    if (operation.action === 'save') {
      body.presetId = operation.presetId ?? null;
      body.name = operation.name;
    }
    if (operation.action === 'load') body.presetId = operation.presetId;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const request = { ...operation, sentRevision, sentVersion, body, conflictGeneration, controller };
    inFlight = request;
    lastSendAt = now();
    notify();
    withRequestDeadline(async (signal) => {
      const response = await fetchImpl(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      const bodyResponse = await responseBody(response);
      return { response, bodyResponse };
    }, { signal: controller?.signal, setTimer, clearTimer }).then(({ response, bodyResponse }) => {
      if (request.retired || inFlight !== request || stopped) return;
      const status = response?.status ?? 200;
      const ok = response?.ok ?? (status >= 200 && status < 300);
      if (!ok || status === 409) {
        if (status === 409 && bodyResponse?.error === 'schema_changed') {
          live = false;
          schemaChanged = true;
          cancelQueuedPreviews();
          const error = new Error('projection schema changed');
          error.schemaChanged = true;
          error.status = status;
          throw error;
        }
        const conflict = status === 409 && bodyResponse?.error === 'conflict';
        if (conflict) {
          if (validSnapshot(bodyResponse.state)) markConflict(bodyResponse.state);
          else {
            cancelQueuedPreviews();
            live = false;
            if (typeof onConflict === 'function') onConflict(CONFLICT_MESSAGE);
          }
          const error = new Error('projection config conflict');
          error.status = status;
          throw error;
        }
        const error = new Error(bodyResponse?.error || 'projection config request failed');
        error.status = status;
        if (bodyResponse?.fields) error.fields = bodyResponse.fields;
        throw error;
      }
      if (!validSnapshot(bodyResponse)) throw new Error('invalid projection config response');
      previewError = null;
      const adopted = receiveSnapshot(bodyResponse, { origin: sourceId });
      let draftReplaced = false;
      let savedPresetId = null;
      const responseIsCurrent = equal(snapshot, normalizeSnapshot(bodyResponse));
      if (request.action === 'load' || request.action === 'revert') {
        if ((adopted || responseIsCurrent) && conflictGeneration === request.conflictGeneration && draftVersion === sentVersion) {
          draft = migrateProjectionConfigToV7(bodyResponse.config, bodyResponse.config?.namesWall?.rotateDeg ?? 35);
          hasLocalDraft = false;
          draftReplaced = true;
        }
      } else if (request.action === 'save') {
        if (responseIsCurrent && conflictGeneration === request.conflictGeneration && draftVersion === sentVersion && matchesSaveAcknowledgement(request, bodyResponse)) {
          savedPresetId = bodyResponse.selectedPresetId;
          hasLocalDraft = false;
        }
      } else if (draftVersion === sentVersion && snapshot && equal(draft, snapshot.config)) {
        hasLocalDraft = false;
      }
      // Persistence callers need this request's accepted outcome, not just
      // HTTP success. Keep receipt/outcome fields out of the shared state.
      request.resolve(request.action === 'load' || request.action === 'revert'
        ? { ...getState(), draftReplaced } : request.action === 'save' ? { ...getState(), savedPresetId } : getState());
    }).catch((error) => {
      if (request.retired || inFlight !== request || stopped) return;
      if (error?.code === 'request_timeout') {
        request.retired = true;
        request.failed = true;
        inFlight = null;
        cancelQueuedPreviews();
        hasLocalDraft = Boolean(draft) || hasLocalDraft;
        const uncertain = new Error('projection config write outcome is uncertain; review the latest accepted settings');
        uncertain.code = 'uncertain_write';
        if (intent) { intent.reject(uncertain); intent = null; }
        request.reject(uncertain);
        notify();
        beginReconciliation();
        return;
      }
      request.failed = true;
      if (request.action === 'preview' && !request.dynamicDraft) previewError = error?.message || 'automatic preview failed';
      cancelQueuedPreviews();
      live = false;
      if (intent) {
        intent.reject(error);
        intent = null;
      }
      notify();
      request.reject(error);
    }).finally(() => {
      if (inFlight !== request) return;
      inFlight = null;
      notify();
      if (!request.failed && !request.retired) scheduleDrain();
    });
  }

  async function beginReconciliation() {
    const generation = ++reconciliationGeneration;
    reconciliationController?.abort();
    const controller = new AbortController();
    reconciliationController = controller;
    reconciliation = { status: 'reading', message: 'Checking the latest accepted settings…' };
    notify();
    try {
      const { response, body } = await withRequestDeadline(async (signal) => {
        const response = await fetchImpl(`${API_URL}?table=${encodeURIComponent(table)}`, { method: 'GET', signal });
        const body = await responseBody(response);
        return { response, body };
      }, { signal: controller.signal, setTimer, clearTimer });
      const status = response?.status ?? 200;
      const ok = response?.ok ?? (status >= 200 && status < 300);
      if (!ok) throw new Error(`accepted settings check failed (${status})`);
      if (!validSnapshot(body)) throw new Error('invalid accepted settings response');
      if (generation !== reconciliationGeneration || stopped) return;
      receiveSnapshot(body, { fromHydrate: true, preserveLive: true });
      reconciliation = { status: 'needs-choice', message: 'The write may have reached the server. Choose which settings to keep.' };
      reconciliationController = null;
      notify();
    } catch (error) {
      if (generation !== reconciliationGeneration || stopped || controller.signal.aborted) return;
      reconciliation = { status: 'read-error', message: error?.message || 'Could not check accepted settings.' };
      reconciliationController = null;
      notify();
    }
  }

  function retryReconciliation() {
    if (reconciliation?.status !== 'read-error' || !started || stopped || !connected) return Promise.reject(new Error('reconciliation retry unavailable'));
    return beginReconciliation();
  }

  function resolveReconciliation(choice) {
    if (reconciliation?.status !== 'needs-choice') throw new Error('accepted settings choice is not ready');
    if (choice !== 'keep-local' && choice !== 'use-accepted') throw new TypeError('invalid accepted settings choice');
    cancelQueuedPreviews();
    cancelPreflight('uncertain projection config write resolved');
    if (intent) { intent.reject(new Error('uncertain projection config write resolved')); intent = null; }
    live = false;
    if (choice === 'use-accepted') {
      draft = snapshot ? clone(snapshot.config) : null;
      hasLocalDraft = false;
      draftVersion += 1;
    } else {
      hasLocalDraft = Boolean(draft && snapshot && !equal(draft, snapshot.config));
    }
    reconciliation = null;
    notify();
    return getState();
  }

  function scheduleDrain() {
    if (timer !== null || inFlight || preflighting || !started || stopped || !connected || hydrating || reconciliation || !snapshot) return;
    if (!intent && (!queuedPreview || !live)) return;
    const wait = Math.max(0, WRITE_INTERVAL - (now() - lastSendAt));
    if (wait === 0 && intent) {
      drain();
      return;
    }
    timer = setTimer(() => { timer = null; drain(); }, wait);
    notify();
  }

  function drain() {
    if (inFlight || preflighting || !started || stopped || !connected || hydrating || reconciliation || !snapshot) return;
    const wait = WRITE_INTERVAL - (now() - lastSendAt);
    if (wait > 0) { scheduleDrain(); return; }
    if (intent) {
      const next = intent;
      intent = null;
      if (typeof validateCandidate === 'function') preflightMutation(next);
      else postMutation(next);
    } else if (queuedPreview && live) {
      const queued = queuedPreview;
      queuedPreview = null;
      const operation = { action: 'preview', config: queued.config, version: queued.version, resolve: () => {}, reject: () => {} };
      if (typeof validateCandidate === 'function') preflightMutation(operation);
      else postMutation(operation);
    }
  }

  function cancelPreflight(reason) {
    if (!preflighting) return;
    const pending = preflighting;
    preflighting = null;
    pending.controller.abort();
    pending.operation.reject(new Error(reason));
  }

  function preflightMutation(operation) {
    const target = operation.action === 'load'
      ? snapshot.presets.find((preset) => preset.id === operation.presetId)?.config
      : operation.action === 'revert' ? snapshot.config : operation.dynamicDraft ? draft : operation.config;
    if (!target) { operation.reject(new Error('projection preset unavailable')); scheduleDrain(); return; }
    const config = clone(target);
    const identity = JSON.stringify(config);
    const revision = snapshot.revision;
    const check = { operation, version: operation.version, revision, conflictGeneration, identity, controller: new AbortController() };
    preflighting = check;
    notify();
    Promise.resolve().then(() => typeof validateCandidate === 'function'
      ? validateCandidate({ config: clone(config), generation: operation.version, identity, revision: revision + 1, signal: check.controller.signal })
      : { identity, valid: true }).then((result) => {
      if (preflighting !== check) return;
      preflighting = null;
      const stale = stopped || !connected || hydrating || snapshot?.revision !== revision ||
        conflictGeneration !== check.conflictGeneration || draftVersion !== check.version || intent ||
        (operation.action === 'preview' && !live && operation.explicitApply !== true);
      if (stale) {
        operation.reject(new Error('projection config operation superseded'));
        if (live) schedulePreview();
      } else if (!result?.valid || result.identity !== identity) {
        const message = result?.reason || 'projection geometry preflight unavailable';
        previewError = message;
        operation.reject(new Error(message));
      } else {
        previewError = null;
        postMutation({ ...operation, config, dynamicDraft: false });
      }
      notify();
      scheduleDrain();
    }).catch((error) => {
      if (preflighting !== check) return;
      preflighting = null;
      previewError = error?.message || 'projection geometry preflight unavailable';
      operation.reject(error);
      notify();
      scheduleDrain();
    });
  }

  function waitForMutation(operation) {
    cancelQueuedPreviews();
    cancelPreflight('projection config operation superseded');
    if (intent) intent.reject(new Error('projection config operation superseded'));
    intent = operation;
    scheduleDrain();
    notify();
  }

  function setDraft(config) {
    if (!config || Object.keys(validateProjectionConfig(config)).length) throw new Error('invalid projection config');
    const nextDraft = migrateProjectionConfigToV7(config, config?.namesWall?.rotateDeg ?? 35);
    if (draft && equal(draft, nextDraft)) return;
    cancelPreflight('projection config operation superseded');
    draft = clone(nextDraft);
    draftVersion += 1;
    hasLocalDraft = !snapshot || !equal(draft, snapshot.config);
    if (live) schedulePreview();
    notify();
  }

  function setLive(value) {
    if (reconciliation) { if (!value) live = false; notify(); return Promise.resolve(getState()); }
    live = Boolean(value);
    if (!live) { cancelQueuedPreviews(); scheduleDrain(); }
    else schedulePreview();
    notify();
  }

  function apply() {
    if (reconciliation) return Promise.reject(new Error('resolve uncertain projection config write first'));
    if (setupRequired()) return Promise.reject(new Error('initialization required'));
    if (!draft || !snapshot || !connected || stopped || hydrating) return Promise.reject(new Error(hydrating ? 'projection config is hydrating' : 'projection config is disconnected'));
    return new Promise((resolve, reject) => waitForMutation({ action: 'preview', dynamicDraft: true, explicitApply: true, version: draftVersion, resolve, reject }));
  }

  function save({ presetId = null, name } = {}) {
    if (reconciliation) return Promise.reject(new Error('resolve uncertain projection config write first'));
    if (setupRequired()) return Promise.reject(new Error('initialization required'));
    if (!draft || !snapshot || !connected || stopped || hydrating) return Promise.reject(new Error(hydrating ? 'projection config is hydrating' : 'projection config is disconnected'));
    return new Promise((resolve, reject) => waitForMutation({ action: 'save', dynamicDraft: true, version: draftVersion, presetId, name, resolve, reject }));
  }

  function load(presetId) {
    if (reconciliation) return Promise.reject(new Error('resolve uncertain projection config write first'));
    if (setupRequired()) return Promise.reject(new Error('initialization required'));
    if (!snapshot || !connected || stopped || hydrating) return Promise.reject(new Error(hydrating ? 'projection config is hydrating' : 'projection config is disconnected'));
    return new Promise((resolve, reject) => waitForMutation({ action: 'load', presetId, version: draftVersion, resolve, reject }));
  }

  function revert() {
    if (reconciliation) return Promise.reject(new Error('resolve uncertain projection config write first'));
    if (setupRequired()) return Promise.reject(new Error('initialization required'));
    if (!snapshot || !connected || stopped || hydrating) return Promise.reject(new Error(hydrating ? 'projection config is hydrating' : 'projection config is disconnected'));
    return new Promise((resolve, reject) => waitForMutation({ action: 'revert', version: draftVersion, resolve, reject }));
  }

  function onConnect() {
    setConnected(true);
    if (hasLocalDraft) live = false;
    hydrationPromise = hydrate().finally(() => { hydrationPromise = null; });
  }
  function onDisconnect() {
    setConnected(false);
  }

  function retryHydration() {
    if (!started || stopped || !connected) return Promise.reject(new Error('projection config is disconnected'));
    return hydrate();
  }

  function start() {
    if (started && !stopped) return Promise.resolve(getState());
    started = true;
    stopped = false;
    if (socket?.on) {
      for (const [event, handler] of [['connect', onConnect], ['disconnect', onDisconnect], ['otef_projection_config_changed', socketMessage]]) {
        socket.on(event, handler); handlers.push([event, handler]);
      }
    }
    const alreadyConnected = typeof socket?.getConnected === 'function' ? socket.getConnected() : Boolean(socket?.isConnected);
    if (alreadyConnected) {
      setConnected(true);
      hydrationPromise = hydrate().finally(() => { hydrationPromise = null; });
      return hydrationPromise;
    }
    if (socket?.connect) socket.connect();
    else {
      hydrationPromise = hydrate().finally(() => { hydrationPromise = null; });
      return hydrationPromise;
    }
    return hydrationPromise || Promise.resolve(getState());
  }

  function stop() {
    stopped = true;
    started = false;
    hydrationGeneration += 1;
    reconciliationGeneration += 1;
    hydrationController?.abort(); hydrationController = null;
    reconciliationController?.abort(); reconciliationController = null;
    reconciliation = null;
    if (timer !== null) { clearTimer(timer); timer = null; }
    queuedPreview = null;
    cancelPreflight('projection config client stopped');
    if (intent) {
      intent.reject(new Error('projection config client stopped'));
      intent = null;
    }
    if (inFlight) {
      const pending = inFlight;
      pending.retired = true;
      inFlight = null;
      pending.controller?.abort();
      pending.reject(new Error('projection config client stopped'));
    }
    if (socket?.off) for (const [event, handler] of handlers) socket.off(event, handler);
    handlers.length = 0;
    notify();
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    subscribers.add(listener);
    listener(getState());
    return () => subscribers.delete(listener);
  }

  function setValidateCandidate(callback) {
    if (callback !== null && typeof callback !== 'function') throw new TypeError('candidate validator must be a function');
    validateCandidate = callback;
  }

  return { start, stop, retryHydration, retryReconciliation, resolveReconciliation, setDraft, setLive, apply, save, load, revert, getState, subscribe, setValidateCandidate };
}

export { TD_MIGRATION_PRESET_ID, TD_MIGRATION_PRESET_NAME, validSnapshot as validateProjectionConfigSnapshot };
