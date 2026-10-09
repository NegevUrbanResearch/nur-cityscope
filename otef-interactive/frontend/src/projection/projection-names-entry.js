import { createUuid } from '../shared/uuid.js';
import { LAYER_FADE_MS } from '../shared/layer-lifecycle-fade.js';
import { nliSceneStructuralKey } from '../shared/nli-scene-transition.js';

const CHANNEL = 'otef-projection-names-entry-v1';
const abortError = () => Object.assign(new Error('Names entry cancelled'), { name: 'AbortError' });

export function projectionNamesEntryKey(snapshot, language = 'he') {
  return JSON.stringify([snapshot.narrativeState?.revision ?? 0, language,
    nliSceneStructuralKey({ ...snapshot, personSelection: null })]);
}

/** Coordinate the two same-origin projector documents on the exhibit computer.
 * Tablet commands still arrive through the existing server scene state.
 */
export function createProjectionNamesEntry({ output, instanceId = createUuid(), attempt = 0,
  createChannel = () => new BroadcastChannel(CHANNEL), onFailure = () => {},
  now = Date.now, timeoutMs = 12000, startDelayMs = LAYER_FADE_MS + 200,
  setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  const peer = output === 'left' ? 'right' : 'left';
  let channel, active = null, disposed = false;
  const failed = new Map();
  try { channel = createChannel(); } catch { /* Fail closed when pairing is unavailable. */ }
  const send = (state, type, extra = {}) => channel?.postMessage({ type, output, instanceId,
    attempt: state.attempt, key: state.key, nonce: state.nonce, ...extra });
  const clean = state => { clearTimer(state.timer); state.signal?.removeEventListener('abort', state.onAbort); };
  const fail = (state, reason, notify = true, cancelled = false) => {
    if (state.failed) return;
    state.failed = true; state.cancel.abort(); clean(state);
    if (notify) send(state, cancelled ? 'cancel' : 'failed', { reason, targetNonce: state.peerNonce });
    if (!state.settled && state.prepared) { state.discard(state.prepared); state.prepared = null; }
    if (!cancelled) {
      failed.set(state.key, reason);
      while (failed.size > 20) failed.delete(failed.keys().next().value);
      onFailure(state.key, reason, state.attempt);
    }
    const error = cancelled ? abortError() : new Error(reason);
    state.reject(error); state.displayReject?.(error);
  };
  const announce = state => send(state, state.ready ? 'ready' : 'preparing', { wall: state.wall });
  const propose = state => {
    if (output !== 'left' || !state.ready || !state.peerReady || state.startAtMs || state.failed) return;
    if (state.wall !== state.peerWall) { fail(state, 'Projection Names wall identities differ'); return; }
    state.startAtMs = now() + startDelayMs;
    send(state, 'start', { startAtMs: state.startAtMs, participants: [state.nonce, state.peerNonce] });
  };
  const accept = state => {
    if (state.failed || state.settled) return;
    state.settled = true; clearTimer(state.timer);
    state.resolve({ ...state.prepared, namesEntry: { key: state.key, startAtMs: state.startAtMs, signal: state.cancel.signal } });
  };
  const show = (state, showAtMs) => {
    if (state.shown || state.failed) return;
    state.shown = true; clearTimer(state.timer);
    waitForProjectionNamesStart({ namesEntry: { startAtMs: showAtMs, signal: state.cancel.signal } })
      .then(() => state.displayResolve?.(true), error => state.displayReject?.(error));
  };
  const proposeShow = state => {
    if (output !== 'left' || !state.rendered || !state.peerRendered || state.shown || state.failed) return;
    const showAtMs = now() + 100;
    send(state, 'show', { showAtMs, participants: [state.nonce, state.peerNonce] }); show(state, showAtMs);
  };
  const receive = ({ data: message }) => {
    const state = active;
    if (!state || disposed || !message || message.output !== peer || message.key !== state.key ||
        message.attempt !== state.attempt || typeof message.nonce !== 'string') return;
    if (state.failed) {
      if (message.type === 'hello' && failed.has(state.key)) send(state, 'failed', { reason: failed.get(state.key) });
      return;
    }
    if (message.type === 'failed' || message.type === 'cancel') {
      if (message.targetNonce && message.targetNonce !== state.nonce || state.peerNonce && state.peerNonce !== message.nonce) return;
      fail(state, `${peer} projector: ${String(message.reason || 'Names entry cancelled').slice(0, 500)}`, false, message.type === 'cancel'); return;
    }
    if (['hello', 'preparing', 'ready'].includes(message.type)) {
      if (state.settled && message.nonce !== state.peerNonce) return;
      if (state.peerNonce && state.peerNonce !== message.nonce) { fail(state, `Multiple ${peer} projector pages requested Names`); return; }
      state.peerNonce = message.nonce;
      if (message.type === 'hello') announce(state);
      if (message.type === 'ready') {
        state.peerReady = true; state.peerWall = message.wall;
        if (state.ready && state.wall !== state.peerWall) { fail(state, 'Projection Names wall identities differ'); return; }
        propose(state);
      }
    } else if (message.type === 'start' && output === 'right' && state.ready && state.peerReady &&
        message.participants?.[0] === state.peerNonce && message.participants?.[1] === state.nonce &&
        Number.isFinite(message.startAtMs) && message.startAtMs > now() && message.startAtMs <= now() + startDelayMs + 1000) {
      state.startAtMs = message.startAtMs;
      send(state, 'ack', { startAtMs: state.startAtMs, participants: message.participants });
    } else if (message.type === 'ack' && output === 'left' && state.startAtMs === message.startAtMs &&
        message.participants?.[0] === state.nonce && message.participants?.[1] === state.peerNonce) {
      send(state, 'commit', { startAtMs: state.startAtMs, participants: message.participants }); accept(state);
    } else if (message.type === 'commit' && output === 'right' && state.startAtMs === message.startAtMs &&
        message.participants?.[0] === state.peerNonce && message.participants?.[1] === state.nonce) accept(state);
    else if (message.type === 'rendered' && message.nonce === state.peerNonce && state.settled) {
      state.peerRendered = true; proposeShow(state);
    } else if (message.type === 'show' && output === 'right' && state.rendered && state.peerRendered &&
        message.participants?.[0] === state.peerNonce && message.participants?.[1] === state.nonce &&
        Number.isFinite(message.showAtMs) && message.showAtMs <= now() + 1100) show(state, message.showAtMs);
  };
  if (channel) channel.onmessage = receive;
  return {
    prepare(key, produce, { signal, discard = () => {} } = {}) {
      if (disposed || signal?.aborted) return Promise.reject(abortError());
      if (failed.has(key)) return Promise.reject(new Error(failed.get(key)));
      if (active?.settled) { clean(active); active.cancel.abort(); active.displayReject?.(abortError()); }
      else if (active && !active.failed) fail(active, 'Names entry superseded', true, true);
      return new Promise((resolve, reject) => {
        const state = { key, nonce: createUuid(), resolve, reject, signal, discard, attempt: typeof attempt === 'function' ? attempt(key) : attempt, cancel: new AbortController() };
        active = state;
        state.onAbort = () => fail(state, 'Names entry superseded', true, true);
        signal?.addEventListener('abort', state.onAbort, { once: true });
        state.timer = setTimer(() => fail(state, `Names preparation timed out (${state.ready ? peer : output} projector not ready)`), timeoutMs);
        if (!channel) { fail(state, 'Projection Names pairing channel unavailable'); return; }
        send(state, 'hello');
        Promise.resolve().then(() => produce(state.cancel.signal)).then(prepared => {
          if (active !== state || state.failed) { discard(prepared); return; }
          const field = prepared?.display?.field;
          if (!field?.datasetVersion || !field.digest) throw new Error('Names preparation produced no validated wall');
          state.prepared = prepared;
          state.wall = JSON.stringify([field.datasetVersion, field.digest, field.language || 'he']);
          state.ready = true; announce(state); propose(state);
        }).catch(error => { if (active === state) fail(state, `${output} projector: ${error?.message || error}`); });
      });
    },
    displayed(key) {
      const state = active;
      if (!state || state.key !== key || !state.settled || state.failed) return Promise.reject(abortError());
      if (state.displayPromise) return state.displayPromise;
      state.displayPromise = new Promise((resolve, reject) => { state.displayResolve = resolve; state.displayReject = reject; });
      state.rendered = true;
      state.timer = setTimer(() => fail(state, `Names final draw timed out (${peer} projector)`), timeoutMs);
      send(state, 'rendered'); proposeShow(state);
      return state.displayPromise;
    },
    fail(key, reason) { if (active?.key === key) fail(active, reason); },
    cancel() { if (active && !active.failed) fail(active, 'Names entry superseded', true, true); },
    dispose() { this.cancel(); disposed = true; channel?.close(); },
  };
}

export function waitForProjectionNamesStart(prepared, { signal } = {}) {
  const entry = prepared?.namesEntry;
  if (!entry) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const signals = [signal, entry.signal].filter(Boolean);
    const cleanup = () => { clearTimeout(timer); signals.forEach(value => value.removeEventListener('abort', cancel)); };
    const cancel = () => { cleanup(); reject(abortError()); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, Math.max(0, entry.startAtMs - Date.now()));
    signals.forEach(value => value.addEventListener('abort', cancel, { once: true }));
    if (signals.some(value => value.aborted)) cancel();
  });
}
