import { resolveProjectionCalibrationScene } from '../shared/projection-calibration-scene.js';
import { isProjectionCalibrationCommand, CALIBRATION_EXPIRY_MS } from '../shared/projection-match-protocol.js';

/** One addressed local effect. Renewal and cover changes never restart scene preparation. */
export function createProjectionCalibrationView({ readNormalScene, applyScene, sendAck, clock = globalThis,
  output, instanceId, readRoute = () => ({ displaySide: output, reversed: false }),
  setBlackout = () => {}, onState = () => {}, requestFrame = fn => clock.setTimeout(fn, 16), isVisible = () => true } = {}) {
  let active = null, disposed = false, timer = null, generation = 0, preparation = null;
  let drawn = { active: false, ready: false, sceneIdentity: null, missingIds: [], error: null, generation: 0 };
  let effectiveIdentity = null;
  const seen = new Map();
  const retired = new Set();
  const ownerKey = command => `${command.sourceId}/${command.sessionId}`;
  const normal = () => readNormalScene() || { groups: [] };
  const current = token => !disposed && active && generation === token;
  const getState = () => ({ ...drawn, missingIds: [...drawn.missingIds], blackout: active?.blackout === true });
  const emit = () => onState(getState());
  function acknowledge(command, token, off = false) {
    // Two animation frames provide a paint opportunity independently of asset readiness.
    requestFrame(() => requestFrame(() => {
      if (disposed || generation !== token || (!off && !active)) return;
      const route = readRoute();
      const error = !isVisible() ? 'Output is hidden' : active?.blackout ? null : drawn.error;
      const ready = off || (!drawn.error && !error && drawn.ready);
      sendAck({ type: 'otef_projection_calibration_view_ack', table: 'otef', output, instanceId,
        sourceId: command.sourceId, sessionId: command.sessionId, sequence: command.sequence,
        displaySide: route.displaySide, reversed: route.reversed,
        sceneIdentity: !off && ready ? drawn.sceneIdentity : null, ready,
        missingIds: off ? [] : [...drawn.missingIds], blackout: off ? false : active.blackout,
        success: !error, error: error ? String(error).slice(0, 240) : null });
    }));
  }
  function refresh({ force = false } = {}) {
    if (!active || disposed) return;
    const source = normal(), resolved = resolveProjectionCalibrationScene(source.groups);
    const identity = JSON.stringify({ ...source, groups: resolved.groups });
    if (!force && identity === effectiveIdentity) return;
    effectiveIdentity = identity;
    preparation?.abort(); preparation = new AbortController(); const token = ++generation;
    drawn = { active: true, ready: false, sceneIdentity: null, missingIds: resolved.missingIds, error: null, generation: token };
    emit();
    let operation;
    try { operation = applyScene({ ...source, groups: resolved.groups, active: true, signal: preparation.signal, generation: token, isCurrent: () => current(token) }); }
    catch (error) { operation = Promise.reject(error); }
    Promise.resolve(operation).then(result => {
      if (!current(token) || !result) return;
      drawn = { ...drawn, ...result, active: true, missingIds: result.missingIds || resolved.missingIds,
        ready: result.ready === true && resolved.missingIds.length === 0, generation: token };
      emit();
      acknowledge(active, token);
    }).catch(error => {
      if (!current(token)) return;
      drawn = { ...drawn, error: String(error?.message || error).slice(0, 240), ready: false };
      emit();
      // Asset failure keeps an independently painted black cover available.
      acknowledge(active, token);
    });
  }
  function release() {
    const wasActive = active !== null;
    ++generation; preparation?.abort(); preparation = null; effectiveIdentity = null;
    if (timer !== null) clock.clearTimeout(timer); timer = null; active = null;
    setBlackout(false);
    drawn = { active: false, ready: false, sceneIdentity: null, missingIds: [], error: null, generation };
    emit();
    if (wasActive && !disposed) {
      const token = generation;
      Promise.resolve(applyScene({ ...normal(), active: false, generation: token, isCurrent: () => generation === token && !active })).catch(() => {});
    }
  }
  // Lease loss is terminal for its owner; explicit off separately permits deliberate side rebind.
  const clear = () => { for (const key of seen.keys()) retired.add(key); release(); };
  function receive(command) {
    if (disposed || !isProjectionCalibrationCommand(command) || command.output !== output || command.instanceId !== instanceId) return;
    const key = ownerKey(command);
    if (retired.has(key) || command.sequence <= (seen.get(key) ?? -1) || (active && ownerKey(active) !== key)) return;
    seen.set(key, command.sequence);
    if (command.mode === 'off') { release(); acknowledge(command, generation, true); return; }
    active = { ...command };
    if (timer !== null) clock.clearTimeout(timer); timer = clock.setTimeout(clear, CALIBRATION_EXPIRY_MS);
    setBlackout(command.blackout);
    refresh(); emit(); acknowledge(command, generation);
  }
  return { receive, normalSceneChanged: refresh, getState, clear,
    dispose() { if (disposed) return; clear(); disposed = true; } };
}

export function createProjectionCalibrationCover({ document: doc, host }) {
  const cover = doc.createElement('div'); cover.className = 'projection-calibration-blackout'; cover.hidden = true;
  cover.setAttribute('aria-hidden', 'true');
  Object.assign(cover.style, { position: 'absolute', inset: '0', background: '#000', zIndex: '2147483647', pointerEvents: 'none' });
  host.appendChild(cover);
  return { setBlackout: value => { cover.hidden = !value; }, dispose: () => cover.remove() };
}
