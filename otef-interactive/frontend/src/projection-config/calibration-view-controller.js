import { createUuid } from '../shared/uuid.js';
import { discoverOutputs as defaultDiscovery, monitorProjectionOutputs } from './projection-output-discovery.js';
import { isProjectionCalibrationAck, CALIBRATION_RENEW_MS, CALIBRATION_EXPIRY_MS } from '../shared/projection-match-protocol.js';

/** Owned by the enclosing warp editor, independent of mode, geometry and point matching. */
export function createCalibrationViewController({ socket, preview, discoverOutputs = defaultDiscovery, onState = () => {}, clock = globalThis } = {}) {
  const sourceId = createUuid();
  let sessionId = null, selected = null, checked = false, sequence = 0, timer = null, disposed = false;
  let epoch = 0, discoveryAbort = null, monitor = null, targets = new Map(), responders = new Map();
  let state = { phase: 'closed', sceneIdentity: null, missingIds: [], blackout: 'off', error: null, outputs: {} };
  const emit = () => onState(structuredClone(state));
  const now = () => clock.Date?.now?.() ?? Date.now();
  const key = row => `${row.output}/${row.instanceId}`;
  const send = (target, mode = 'landmarks') => {
    const command = { type: 'otef_projection_calibration_view', table: 'otef', output: target.output, instanceId: target.instanceId,
      sourceId, sessionId, sequence: ++sequence, mode, blackout: mode === 'landmarks' && checked && target.other };
    if (mode !== 'off') {
      target.sent = command.sequence; target.desiredBlackout = command.blackout;
      if (target.outstandingSince == null) target.outstandingSince = now();
    }
    try { socket?.send?.(command); } catch { target.error = 'Output transport failed'; }
  };
  function publish() {
    const selectedTarget = [...targets.values()].find(target => target.output === selected);
    state.outputs = Object.fromEntries(['left', 'right'].map(output => {
      const target = [...targets.values()].find(row => row.output === output);
      return [output, target ? { ready: target.ready === true, sceneIdentity: target.sceneIdentity || null, missingIds: target.missingIds || [], error: target.error || null, blackout: target.paintedBlackout === true } : { ready: false, error: state.outputs[output]?.error || 'Output unavailable' }];
    }));
    state.phase = selectedTarget?.error || !selectedTarget ? 'failed' : selectedTarget.ready ? 'active' : 'starting';
    state.sceneIdentity = selectedTarget?.sceneIdentity || null; state.missingIds = selectedTarget?.missingIds || [];
    const other = [...targets.values()].find(target => target.other);
    state.blackout = !checked ? 'off' : !other || other.error ? 'failed' : other.paintedBlackout === true ? 'active' : 'pending';
    state.error = Object.values(state.outputs).map(row => row.error).filter(Boolean).join('; ') || null;
    emit();
  }
  function tick() {
    for (const target of targets.values()) {
      if (target.error) continue;
      if (target.outstandingSince != null && now() - target.outstandingSince >= CALIBRATION_EXPIRY_MS) {
        target.error = 'No rendered acknowledgement for 3000 ms'; send(target, 'off'); continue;
      }
      send(target);
    }
    publish();
  }
  function receive(message) {
    if (disposed || !sessionId || !isProjectionCalibrationAck(message) || message.sourceId !== sourceId || message.sessionId !== sessionId) return;
    const target = targets.get(key(message));
    if (!target || target.error || message.displaySide !== target.displaySide || message.reversed !== target.reversed ||
      message.sequence > target.sent || message.sequence < (target.confirmed ?? -1)) return;
    // The same sequence can report preparation completion; only sequence progress advances the deadline.
    if (message.sequence > (target.confirmed ?? -1)) {
      target.confirmed = message.sequence; target.outstandingSince = message.sequence === target.sent ? null : now();
    }
    target.ready = message.ready; target.sceneIdentity = message.sceneIdentity; target.missingIds = [...message.missingIds];
    if (message.sequence === target.sent) target.paintedBlackout = message.blackout === target.desiredBlackout ? message.blackout : null;
    if (!message.success) target.error = message.error || 'Output rejected calibration view';
    publish();
  }
  function checkDuplicates(row) {
    if (!sessionId) return;
    responders.set(key(row), row);
    for (const target of targets.values()) {
      const conflicts = [...responders.values()].filter(other => (other.output === target.output || other.displaySide === target.displaySide) && other.instanceId !== target.instanceId);
      if (conflicts.length && !target.error) { target.error = 'Duplicate browser output or displayed route'; send(target, 'off'); }
    }
    if (targets.size) publish();
  }
  async function discover() {
    const token = ++epoch; discoveryAbort?.abort(); discoveryAbort = new AbortController();
    state.phase = 'starting'; state.sceneIdentity = null; state.error = null; emit();
    try {
      const fresh = await discoverOutputs({ socket, sourceId, timeoutMs: 1000, signal: discoveryAbort.signal });
      if (disposed || !sessionId || token !== epoch) return;
      responders = new Map([...fresh, ...monitor.getResponders()]);
      for (const output of ['left', 'right']) {
        const rows = [...responders.values()].filter(row => row.output === output);
        let error = rows.length !== 1 ? `${output}: ${rows.length ? 'duplicate outputs' : 'output unavailable'}` : null;
        const row = rows[0];
        if (!error && (row.route !== 'browser' || !['left', 'right'].includes(row.displaySide) || typeof row.reversed !== 'boolean')) error = `${output}: reopen or reload the browser output to report its display route`;
        if (!error && [...responders.values()].filter(other => other.displaySide === row.displaySide).length !== 1) error = `${output}: duplicate displayed routes`;
        if (error) { state.outputs[output] = { error }; continue; }
        targets.set(key(row), { ...row, ready: false, paintedBlackout: false, confirmed: -1, outstandingSince: null });
      }
      const selectedTarget = [...targets.values()].find(target => target.output === selected);
      for (const target of targets.values()) { target.other = Boolean(selectedTarget && target.displaySide !== selectedTarget.displaySide); send(target); }
      if (timer !== null) clock.clearInterval(timer); timer = clock.setInterval(tick, CALIBRATION_RENEW_MS);
      publish();
    } catch (error) {
      if (token !== epoch || !sessionId) return;
      state.phase = 'failed'; state.error = error.message || 'Output discovery failed'; state.blackout = checked ? 'failed' : 'off'; emit();
    }
  }
  function release() { for (const target of targets.values()) send(target, 'off'); targets.clear(); }
  function close() {
    ++epoch; discoveryAbort?.abort(); discoveryAbort = null;
    if (timer !== null) clock.clearInterval(timer); timer = null;
    release(); monitor?.dispose(); monitor = null; responders.clear(); sessionId = null; checked = false;
    preview?.setCalibrationView?.(false);
    state = { phase: 'closed', sceneIdentity: null, missingIds: [], blackout: 'off', error: null, outputs: {} }; emit();
  }
  const disconnect = () => { close(); state.phase = 'failed'; state.error = 'Projection outputs disconnected. Reopen the editor after reconnecting.'; emit(); };
  socket?.on?.('otef_projection_calibration_view_ack', receive); socket?.on?.('disconnect', disconnect);
  return {
    enter({ output }) {
      if (disposed || !['left', 'right'].includes(output)) return;
      if (sessionId) return selected === output ? undefined : this.switchOutput(output);
      selected = output; sessionId = createUuid(); checked = false;
      preview?.setCalibrationView?.(true);
      if (!socket?.on || !socket?.send) { state.phase = 'failed'; state.error = 'Projection outputs disconnected. The local landmark preview remains available.'; emit(); return; }
      monitor = monitorProjectionOutputs({ socket, onResponder: checkDuplicates });
      return discover();
    },
    setBlackout(enabled) { if (!sessionId) return; checked = enabled === true; for (const target of targets.values()) { target.paintedBlackout = null; send(target); } publish(); },
    switchOutput(output) { if (!sessionId || !['left', 'right'].includes(output) || selected === output) return; release(); selected = output; return discover(); },
    getState: () => structuredClone(state), close,
    dispose() { if (disposed) return; close(); disposed = true; socket?.off?.('otef_projection_calibration_view_ack', receive); socket?.off?.('disconnect', disconnect); },
  };
}
