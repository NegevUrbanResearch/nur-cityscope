import { DEFAULT_PROJECTION_CONFIG, validateProjectionConfig } from './projection-config-schema.js';

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
const isUuid = (value) => typeof value === 'string' && UUID.test(value);

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
      if (!preset.readOnly || preset.name !== 'Original calibration' || !equal(preset.config, DEFAULT_PROJECTION_CONFIG)) return false;
    } else if (!isUuid(preset.id) || preset.readOnly) return false;
  }
  if (originalCount !== 1 || typeof value.selectedPresetId !== 'string' || !ids.has(value.selectedPresetId)) return false;
  return true;
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
} = {}) {
  if (!isUuid(sourceId)) throw new Error('sourceId must be a UUID');
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');

  let started = false;
  let stopped = false;
  let connected = false;
  let snapshot = null;
  let draft = null;
  let hasLocalDraft = false;
  let live = true;
  let draftVersion = 0;
  let timer = null;
  let lastSendAt = -Infinity;
  let inFlight = null;
  let intent = null;
  let hydrationGeneration = 0;
  let hydrationPromise = null;
  let hydrating = false;
  let conflictGeneration = 0;
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
      pending: Boolean(inFlight || timer || intent),
      hasLocalDraft,
    };
  }

  function notify() {
    const state = getState();
    if (typeof onState === 'function') onState(state);
    for (const listener of subscribers) listener(getState());
  }

  function setConnected(value) {
    if (connected === value) return;
    connected = value;
    if (!connected) {
      if (timer !== null) { clearTimer(timer); timer = null; }
      queuedPreview = null;
      live = false;
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
    if (intent) {
      intent.reject(new Error('projection config conflict'));
      intent = null;
    }
    hasLocalDraft = Boolean(draft) || hasLocalDraft;
    if (typeof onConflict === 'function') onConflict(CONFLICT_MESSAGE);
    if (validSnapshot(next) && (!snapshot || next.revision > snapshot.revision)) snapshot = clone(next);
    notify();
  }

  function receiveSnapshot(next, { origin, fromHydrate = false } = {}) {
    if (!validSnapshot(next)) return false;
    if (snapshot && next.revision <= snapshot.revision) return false;
    const foreign = origin !== undefined && origin !== null && origin !== sourceId;
    if (foreign && (hasLocalDraft || inFlight || queuedPreview || intent)) markConflict(next);
    snapshot = clone(next);
    if (!hasLocalDraft) {
      draft = clone(next.config);
      hasLocalDraft = false;
    } else if (fromHydrate) {
      live = false;
    }
    notify();
    return true;
  }

  async function hydrate() {
    const generation = ++hydrationGeneration;
    hydrating = true;
    let body;
    try {
      const response = await fetchImpl(`${API_URL}?table=${encodeURIComponent(table)}`, { method: 'GET' });
      const status = response?.status ?? 200;
      const ok = response?.ok ?? (status >= 200 && status < 300);
      if (!ok) throw new Error(`projection config hydration failed (${status})`);
      body = await responseBody(response);
    } catch (error) {
      if (generation === hydrationGeneration) notify();
      return null;
    }
    if (generation !== hydrationGeneration || !validSnapshot(body)) {
      return null;
    }
    receiveSnapshot(body, { fromHydrate: true });
    hydrating = false;
    notify();
    return getState();
  }

  function socketMessage(message) {
    if (!message || message.type !== 'otef_projection_config_changed' || message.table !== table || !isUuid(message.sourceId)) return;
    receiveSnapshot(message.state, { origin: message.sourceId });
  }

  function schedulePreview() {
    if (!started || stopped || !connected || hydrating || !live || !draft || !snapshot || intent) return;
    queuedPreview = { config: clone(draft), version: draftVersion };
    scheduleDrain();
  }

  function postMutation(operation) {
    if (!snapshot || !connected || hydrating || stopped) {
      operation.reject(new Error(hydrating ? 'projection config is hydrating' : 'projection config is disconnected'));
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
    let fetchPromise;
    try {
      fetchPromise = fetchImpl(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (error) {
      fetchPromise = Promise.reject(error);
    }
    Promise.resolve(fetchPromise).then(async (response) => {
      const bodyResponse = await responseBody(response);
      if (request.retired) {
        if (validSnapshot(bodyResponse)) receiveSnapshot(bodyResponse, { origin: sourceId });
        return;
      }
      const status = response?.status ?? 200;
      const ok = response?.ok ?? (status >= 200 && status < 300);
      if (!ok || status === 409) {
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
      const adopted = receiveSnapshot(bodyResponse, { origin: sourceId });
      if (request.action === 'load' || request.action === 'revert') {
        const responseIsCurrent = equal(snapshot, bodyResponse);
        if ((adopted || responseIsCurrent) && conflictGeneration === request.conflictGeneration && draftVersion === sentVersion) {
          draft = clone(bodyResponse.config);
          hasLocalDraft = false;
        }
      } else if (draftVersion === sentVersion && snapshot && equal(draft, snapshot.config)) {
        hasLocalDraft = false;
      }
      request.resolve(getState());
    }).catch((error) => {
      if (request.retired) return;
      request.failed = true;
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

  function scheduleDrain() {
    if (timer !== null || inFlight || !started || stopped || !connected || hydrating || !snapshot) return;
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
    if (inFlight || !started || stopped || !connected || hydrating || !snapshot) return;
    const wait = WRITE_INTERVAL - (now() - lastSendAt);
    if (wait > 0) { scheduleDrain(); return; }
    if (intent) {
      const next = intent;
      intent = null;
      postMutation(next);
    } else if (queuedPreview && live) {
      const queued = queuedPreview;
      queuedPreview = null;
      postMutation({ action: 'preview', config: queued.config, version: queued.version, resolve: () => {}, reject: () => {} });
    }
  }

  function waitForMutation(operation) {
    cancelQueuedPreviews();
    if (intent) intent.reject(new Error('projection config operation superseded'));
    intent = operation;
    scheduleDrain();
    notify();
  }

  function setDraft(config) {
    if (!config || Object.keys(validateProjectionConfig(config)).length) throw new Error('invalid projection config');
    draft = clone(config);
    draftVersion += 1;
    hasLocalDraft = !snapshot || !equal(draft, snapshot.config);
    if (live) schedulePreview();
    notify();
  }

  function setLive(value) {
    live = Boolean(value);
    if (!live) { cancelQueuedPreviews(); scheduleDrain(); }
    else schedulePreview();
    notify();
  }

  function apply() {
    if (!draft || !snapshot || !connected || stopped || hydrating) return Promise.reject(new Error(hydrating ? 'projection config is hydrating' : 'projection config is disconnected'));
    return new Promise((resolve, reject) => waitForMutation({ action: 'preview', dynamicDraft: true, version: draftVersion, resolve, reject }));
  }

  function save({ presetId = null, name } = {}) {
    if (!draft || !snapshot || !connected || stopped || hydrating) return Promise.reject(new Error(hydrating ? 'projection config is hydrating' : 'projection config is disconnected'));
    return new Promise((resolve, reject) => waitForMutation({ action: 'save', dynamicDraft: true, version: draftVersion, presetId, name, resolve, reject }));
  }

  function load(presetId) {
    if (!snapshot || !connected || stopped || hydrating) return Promise.reject(new Error(hydrating ? 'projection config is hydrating' : 'projection config is disconnected'));
    return new Promise((resolve, reject) => waitForMutation({ action: 'load', presetId, version: draftVersion, resolve, reject }));
  }

  function revert() {
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

  function start() {
    if (started && !stopped) return Promise.resolve(getState());
    started = true;
    stopped = false;
    if (socket?.on) {
      for (const [event, handler] of [['connect', onConnect], ['disconnect', onDisconnect], ['otef_projection_config_changed', socketMessage], ['message', socketMessage]]) {
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
    if (timer !== null) { clearTimer(timer); timer = null; }
    queuedPreview = null;
    if (intent) {
      intent.reject(new Error('projection config client stopped'));
      intent = null;
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

  return { start, stop, setDraft, setLive, apply, save, load, revert, getState, subscribe };
}

export { validSnapshot as validateProjectionConfigSnapshot };
