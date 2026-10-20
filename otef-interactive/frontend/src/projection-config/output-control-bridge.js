import { createUuid } from '../shared/uuid.js';

const prefix = 'otef_output_';
const TIMEOUT_MS = 15000;
const actions = new Set(['refresh', 'identify', 'assign', 'reverse-model', 'resolution', 'open', 'close']);
const message = (kind, value = {}) => ({ type: prefix + kind, table: 'otef', ...value });
const failure = error => String(error?.message || error || 'Display action failed').slice(0, 500);

export function createOutputControlBridge({ socket, localController, sourceId = createUuid(), timers = globalThis, document: doc = globalThis.document } = {}) {
  const host = localController?.getState?.().supported === true;
  const listeners = new Set(), bindings = [], hosts = new Map(), pending = new Map(), receipts = new Map();
  let connected = socket?.getConnected?.() === true, disposed = false, connectionId = null, queryId = null, sequence = 0;
  let discoveryTimer = null, renewalTimer = null;
  let remoteState = { supported: false, screens: [], assignments: {}, resolutions: {}, reverseModel: false, ownedSpans: [], error: '', message: 'Looking for the workstation…' };
  const emit = () => { if (!disposed) for (const listener of listeners) listener(getState()); };
  const send = value => !disposed && connected && socket?.send?.(value) === true;
  const bind = (kind, fn) => { socket?.on?.(kind, fn); bindings.push([kind, fn]); };
  function stateForWire() {
    const state = localController.getState();
    return { supported: state.supported === true, screens: state.screens || [], assignments: state.assignments || {}, resolutions: state.resolutions || {}, reverseModel: state.reverseModel === true, ownedSpans: state.ownedSpans || [], error: String(state.error || '').slice(0, 500), message: String(state.message || '').slice(0, 500) };
  }
  function getState() { return host ? localController.getState() : { ...remoteState, remoteControl: true }; }
  function publish(query = null) {
    if (host && connectionId) send(message('state', { hostId: sourceId, connectionId, sequence: ++sequence, queryId: query, state: stateForWire() }));
  }
  function rejectPending(reason) {
    for (const request of pending.values()) { timers.clearTimeout(request.timer); request.reject(new Error(reason)); }
    pending.clear();
  }
  function selectHost() {
    if (hosts.size !== 1) return null;
    return hosts.values().next().value;
  }
  function showHosts() {
    if (hosts.size > 1) rejectPending('Multiple workstation config pages are connected; the display action is unconfirmed.');
    const discovering = discoveryTimer !== null;
    const target = discovering ? null : selectHost();
    remoteState = target ? { ...target.state, supported: true } : { ...remoteState, supported: false, error: '', message: hosts.size > 1 ? 'Multiple workstation config pages are connected. Close the extra workstation config pages, then Refresh.' : discovering ? 'Looking for the workstation…' : 'No workstation config page is connected. Keep projection config open on the workstation, then Refresh.' };
    emit();
  }
  function discover() {
    if (host || disposed || !connected) return;
    timers.clearTimeout(discoveryTimer);
    queryId = createUuid(); hosts.clear();
    rejectPending('Workstation discovery changed; the previous display action is unconfirmed.');
    remoteState = { ...remoteState, supported: false, error: '', message: 'Looking for the workstation…' }; emit();
    send(message('subscribe', { sourceId }));
    send(message('query', { sourceId, queryId }));
    discoveryTimer = timers.setTimeout(() => { discoveryTimer = null; showHosts(); }, 2000);
  }
  function acceptState(value) {
    if (host || !connected || value?.table !== 'otef' || value.type !== prefix + 'state' || !value.state || value.state.supported !== true || !Number.isSafeInteger(value.sequence)) return;
    const existing = hosts.get(value.hostId);
    if (value.queryId !== queryId && !(value.queryId === null && existing?.connectionId === value.connectionId)) return;
    if (existing?.connectionId === value.connectionId && value.sequence <= existing.sequence) return;
    hosts.set(value.hostId, { hostId: value.hostId, connectionId: value.connectionId, sequence: value.sequence, state: value.state });
    showHosts();
  }
  function acceptAck(value) {
    if (host || !connected || value?.table !== 'otef' || value.sourceId !== sourceId) return;
    const request = pending.get(value.requestId);
    if (!request || request.hostId !== value.hostId || request.connectionId !== value.connectionId || typeof value.success !== 'boolean') return;
    pending.delete(value.requestId); timers.clearTimeout(request.timer);
    const existing = hosts.get(value.hostId);
    if (existing?.connectionId === value.connectionId && value.sequence > existing.sequence && value.state) {
      hosts.set(value.hostId, { ...existing, sequence: value.sequence, state: value.state }); showHosts();
    }
    if (value.success) request.resolve(value.state);
    else { remoteState = { ...remoteState, error: value.error || 'Workstation display action failed' }; emit(); request.reject(new Error(remoteState.error)); }
  }
  function runLocal(action, value) {
    if (action === 'refresh') return localController.refreshDisplays();
    if (action === 'identify') return localController.identifyDisplays();
    if (action === 'assign') return localController.assignDisplays(value);
    if (action === 'reverse-model') return localController.setReverseModel(value);
    if (action === 'resolution') return localController.setResolution(value.side, value.resolution);
    if (action === 'open') return localController.openBoth();
    if (action === 'close') return localController.closeBoth();
    throw new Error('Unknown display action');
  }
  function execute(value) {
    if (!host || !connected || value?.table !== 'otef' || value.hostId !== sourceId || value.connectionId !== connectionId || !actions.has(value.action)) return;
    const key = `${value.sourceId}:${value.requestId}`;
    if (receipts.has(key)) { const receipt = receipts.get(key); if (receipt) send(receipt); return; }
    if (receipts.size >= 256) { const completed = [...receipts].find(([, receipt]) => receipt); if (completed) receipts.delete(completed[0]); else return; }
    receipts.set(key, null);
    const epoch = connectionId;
    const complete = error => {
      if (disposed || epoch !== connectionId) return;
      const state = stateForWire(), detail = error ? failure(error) : state.error || null;
      const receipt = message('ack', { hostId: sourceId, connectionId, sourceId: value.sourceId, requestId: value.requestId, success: !detail, error: detail, sequence: ++sequence, state });
      receipts.set(key, receipt); send(receipt);
    };
    try { Promise.resolve(runLocal(value.action, value.value)).then(() => complete(null), complete); }
    catch (error) { complete(error); }
  }
  function request(action, value = null) {
    if (host) return runLocal(action, value);
    const target = selectHost();
    if (!connected || !target || !remoteState.supported) return Promise.reject(new Error(connected ? remoteState.message : 'Workstation connection is disconnected.'));
    const requestId = createUuid();
    return new Promise((resolve, reject) => {
      const timer = timers.setTimeout(() => {
        pending.delete(requestId);
        remoteState = { ...remoteState, error: 'Workstation action not confirmed. Refresh display status before retrying.' }; emit();
        reject(new Error(remoteState.error));
      }, TIMEOUT_MS);
      pending.set(requestId, { ...target, timer, resolve, reject });
      if (!send(message('command', { sourceId, requestId, hostId: target.hostId, connectionId: target.connectionId, action, value }))) {
        timers.clearTimeout(timer); pending.delete(requestId); reject(new Error('Workstation action was not sent.'));
      }
    });
  }
  function connect() {
    connected = true;
    if (host) { connectionId = createUuid(); sequence = 0; receipts.clear(); send(message('register', { hostId: sourceId, connectionId })); publish(); }
    else discover();
  }
  function disconnect() {
    timers.clearTimeout(discoveryTimer); discoveryTimer = null;
    connected = false; connectionId = null; queryId = null; hosts.clear();
    rejectPending('Workstation disconnected; the display action is unconfirmed.');
    remoteState = { ...remoteState, supported: false, error: '', message: 'Workstation connection is disconnected.' }; emit();
  }
  bind('connect', connect); bind('disconnect', disconnect);
  bind(prefix + 'state', acceptState); bind(prefix + 'ack', acceptAck); bind(prefix + 'command', execute);
  bind(prefix + 'query', value => { if (host && value?.table === 'otef') publish(value.queryId); });
  bind(prefix + 'hosts_changed', () => { if (!host) discover(); });
  bind(prefix + 'disconnected', value => {
    if (hosts.get(value?.hostId)?.connectionId !== value.connectionId) return;
    hosts.delete(value.hostId); rejectPending('Workstation disconnected; the display action is unconfirmed.'); showHosts();
  });
  const unsubscribe = host ? localController.subscribe?.(() => { publish(); emit(); }) : null;
  const visible = () => { if (doc?.visibilityState === 'visible' && !host) discover(); };
  doc?.addEventListener?.('visibilitychange', visible);
  if (connected) connect();
  renewalTimer = timers.setInterval(() => { if (connected) send(host ? message('register', { hostId: sourceId, connectionId }) : message('subscribe', { sourceId })); }, 60000);
  return {
    getState,
    subscribe(listener) { listeners.add(listener); listener(getState()); return () => listeners.delete(listener); },
    refreshDisplays() { if (!host && !selectHost()) { discover(); return Promise.resolve([]); } return Promise.resolve(request('refresh')); },
    identifyDisplays: () => request('identify'), assignDisplays: value => request('assign', value),
    setReverseModel: value => request('reverse-model', value), setResolution: (side, resolution) => request('resolution', { side, resolution }),
    openBoth: () => request('open'), closeBoth: () => request('close'),
    dispose() {
      if (disposed) return;
      disposed = true; rejectPending('Display controls closed before the action was confirmed.');
      timers.clearTimeout(discoveryTimer); timers.clearInterval(renewalTimer);
      unsubscribe?.(); listeners.clear(); bindings.forEach(([kind, fn]) => socket?.off?.(kind, fn));
      doc?.removeEventListener?.('visibilitychange', visible); localController?.dispose?.();
    },
  };
}
