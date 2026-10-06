import { createUuid } from '../shared/uuid.js';
import { pickProjectionLandmark, measureProjectionLandmarks } from '../shared/projection-point-fit.js';
import { isProjectionMatchAck, CURSOR_EXPIRY_MS, CURSOR_RENEW_MS, MAX_CURSOR_HZ } from '../shared/projection-match-protocol.js';

const clone = value => structuredClone(value);
const pixels = value => Array.isArray(value) && value.length === 2 && value.every((n, i) => Number.isFinite(n) && n >= 0 && n <= (i ? 1080 : 1920));
const editable = phase => ['capture', 'checking'].includes(phase);
const contextKeys = ['output', 'instanceId', 'revision', 'configIdentity', 'baselineIdentity', 'sourceFrameIdentity', 'displaySide', 'reversed'];
const projectedRadii = { small: 4, medium: 8, large: 15 };

/** Ephemeral measurements in one acknowledged output context. No editor or publication writes. */
export function createPointMatchSession({ context, sendCursor, onChange = () => {}, clock = globalThis,
  initialAnchors = [], initialPhase = 'capture', initialSelectedId = 1, initialDisplayPrefs = {} } = {}) {
  let bound = clone(context), phase = initialPhase, selectedId = initialSelectedId, anchors = clone(initialAnchors), sequence = 0, confirmed = -1;
  let pending = false, lastSend = -Infinity, outstandingSince = null, scheduled = null, candidate = null;
  let candidateIdentity = null, installedCandidateIdentity = null, expectedTransition = null, error = null;
  let probed = !context.requireProbe, previewReady = true, deadline = null, identification = false, cursorPaused = false;
  const displayPrefs = {
    previewMarkerSize: Object.hasOwn(projectedRadii, initialDisplayPrefs.previewMarkerSize) ? initialDisplayPrefs.previewMarkerSize : 'medium',
    projectedMarkerSize: Object.hasOwn(projectedRadii, initialDisplayPrefs.projectedMarkerSize) ? initialDisplayPrefs.projectedMarkerSize : 'medium',
  };
  bound.sourceId ||= createUuid(); bound.sessionId ||= createUuid();
  const now = () => clock.Date?.now?.() ?? Date.now();
  const active = () => !['closed', 'invalid'].includes(phase);
  const selected = () => anchors.find(point => point.id === selectedId);
  const getState = () => clone({ phase, selectedId, anchors, pendingSequence: sequence,
    canRecord: active() && editable(phase) && previewReady && probed && !pending && confirmed === sequence && Boolean(selected()),
    canFit: phase === 'capture' && previewReady && [1, 2, 3, 4].every(id => anchors.some(point => point.id === id && point.recorded)),
    candidate, candidateIdentity, installedCandidateIdentity, previewReady, probed, context: bound, error, displayPrefs });
  const emit = () => onChange(getState());
  const cancelScheduled = () => { if (scheduled !== null) clock.clearTimeout(scheduled); scheduled = null; };
  function setDeadline(since) {
    outstandingSince = since;
    if (deadline !== null) clock.clearTimeout(deadline); deadline = null;
    if (since !== null) deadline = clock.setTimeout(() => { deadline=null;invalidate('No output acknowledgement progress for 3000 ms; reopen the output and retry.'); }, Math.max(0,CURSOR_EXPIRY_MS-(now()-since)));
  }
  function send(mode) {
    const point = selected();
    if (mode === 'cursor' && !point && !identification) mode = 'probe';
    const sourcePx = mode === 'cursor' ? identification ? [240,180] : measureProjectionLandmarks({ preparedMesh: bound.evaluatedMesh, anchors: [point] })[0].renderedPx : null;
    const message = { type: 'otef_projection_match_cursor', table: 'otef', output: bound.output, instanceId: bound.instanceId,
      sourceId: bound.sourceId, sessionId: bound.sessionId, sequence: ++sequence, revision: bound.revision,
      sourceFrameIdentity: bound.sourceFrameIdentity, mode, pointId: mode === 'cursor' ? identification ? 1 : selectedId : 0,
      targetPx: mode === 'cursor' ? identification ? [480,270] : [...point.targetPx] : null, sourcePx };
    if (mode === 'cursor') message.markerRadiusPx = projectedRadii[displayPrefs.projectedMarkerSize];
    pending = false; cancelScheduled(); lastSend = now();
    if (mode !== 'off' && outstandingSince === null) setDeadline(now());
    try { sendCursor(message); } catch { if (mode !== 'off') invalidate('Output transport failed; restart Match points.'); }
    emit();
  }
  function flush() { if (pending && active()) send(probed ? 'cursor' : 'probe'); }
  function queue() {
    pending = true;
    const delay = Math.max(0, 1000 / MAX_CURSOR_HZ - (now() - lastSend));
    if (!delay) flush();
    else if (scheduled === null) scheduled = clock.setTimeout(() => { scheduled = null; flush(); }, delay);
    emit();
  }
  function invalidate(reason) {
    if (!active()) return;
    phase = 'invalid'; error = String(reason || 'Capture context changed; restart Match points.');
    cancelScheduled(); setDeadline(null); clock.clearInterval(renewal); send('off');
  }
  const renewal = clock.setInterval(() => {
    if (!active()) return;
    if (outstandingSince !== null && now() - outstandingSince >= CURSOR_EXPIRY_MS) {
      invalidate('No output acknowledgement progress for 3000 ms; reopen the output and retry.'); return;
    }
    queue();
  }, CURSOR_RENEW_MS);
  return {
    setMarkerSize(kind, size) {
      if (!active() || !['preview', 'projected'].includes(kind) || typeof size !== 'string' || !Object.hasOwn(projectedRadii, size)) return false;
      const key = `${kind}MarkerSize`;
      if (displayPrefs[key] === size) return true;
      displayPrefs[key] = size;
      if (kind === 'projected' && probed && !cursorPaused && (selected() || identification)) queue();
      else emit();
      return true;
    },
    probe() { if (active()) send('probe'); },
    showIdentification() { if (!active() || !probed) return false;identification=true;send('cursor');return true; },
    clearIdentification() { identification=false; },
    pauseCursor() { if (cursorPaused) return;cursorPaused=true;setDeadline(null);cancelScheduled();clock.clearInterval(renewal);send('off'); },
    pick(id, outputPointPx, evaluatedMesh = bound.evaluatedMesh) {
      if (!active() || !editable(phase) || !probed || !Number.isInteger(id) || id < 1 || id > 6 || !pixels(outputPointPx)) return false;
      const result = pickProjectionLandmark({ evaluatedMesh, outputPointPx });
      if (!result.ok) { error = `Cannot pick this landmark: ${result.reason}. Choose an unambiguous image feature.`; emit(); return false; }
      selectedId = id; anchors = anchors.filter(point => point.id !== id);
      anchors.push({ id, s: result.s, t: result.t, targetPx: [...outputPointPx], recorded: false });
      anchors.sort((a, b) => a.id - b.id); error = null; queue(); return true;
    },
    select(id) { if (!active() || !Number.isInteger(id) || id < 1 || id > 6) return false; cancelScheduled(); pending = false; selectedId = id; queue(); return true; },
    moveTarget(targetPx) {
      if (!editable(phase) || !active() || !pixels(targetPx) || !selected()) return false;
      if (selected().targetPx.every((n, i) => n === targetPx[i])) return true;
      selected().targetPx = [...targetPx]; selected().recorded = false; queue(); return true;
    },
    acknowledge(message) {
      if (!active() || cursorPaused || !isProjectionMatchAck(message) || ['output', 'instanceId', 'sourceId', 'sessionId', 'revision', 'sourceFrameIdentity'].some(k => message[k] !== bound[k]) || message.sequence > sequence) return false;
      if (probed && (message.displaySide !== bound.displaySide || message.reversed !== bound.reversed)) return false;
      // Source retirement can report failure again for the last confirmed command.
      if (!message.success) { invalidate(message.error); return true; }
      if (message.sequence <= confirmed) return false;
      if (!probed) { bound.displaySide = message.displaySide; bound.reversed = message.reversed; probed = true; }
      confirmed = message.sequence;
      setDeadline(confirmed === sequence ? null : now()); emit(); return true;
    },
    record() { flush(); if (!getState().canRecord) return false; selected().recorded = true; emit(); return true; },
    remove(id) { if (!editable(phase) || !active()) return false; cancelScheduled(); pending = false; anchors = anchors.filter(point => point.id !== id); queue(); return true; },
    setCandidate(result) {
      if (!active() || !result?.ok) return false;
      candidate = clone(result); candidateIdentity = JSON.stringify(result.config); phase = 'candidate-preview'; previewReady = false; emit(); return true;
    },
    setPreviewReady(ready) { previewReady = ready === true; emit(); },
    setError(message) { error=message || null;emit(); },
    resumeCapture() { if (phase!=='candidate-preview') return false;phase='capture';candidate=null;candidateIdentity=null;previewReady=false;emit();return true; },
    transition(next, expected = null) {
      const allowed = { 'candidate-preview': ['candidate-installed'], 'candidate-installed': ['publishing'], publishing: ['checking', 'candidate-installed'], checking: ['candidate-installed'] };
      if (!allowed[phase]?.includes(next)) return false;
      phase = next; expectedTransition = expected && clone(expected);
      if (next === 'candidate-installed') installedCandidateIdentity = candidateIdentity;
      if (next === 'publishing') this.pauseCursor();
      emit(); return true;
    },
    contextChanged(next) {
      if (!active()) return false;
      if (phase === 'publishing' && expectedTransition && next.configIdentity === expectedTransition.configIdentity && next.revision === expectedTransition.revision &&
        contextKeys.filter(k => !['revision', 'configIdentity'].includes(k)).every(k => next[k] === bound[k])) {
        bound = { ...bound, ...clone(next) }; phase = 'checking'; expectedTransition = null; emit(); return true;
      }
      if (contextKeys.some(k => next?.[k] !== bound[k])) { invalidate('Output, source frame or calibration changed; restart Match points.'); return false; }
      return true;
    },
    invalidate,
    getState,
    dispose() { if (phase === 'closed') return; clock.clearInterval(renewal); setDeadline(null); cancelScheduled(); phase = 'closed'; send('off'); },
  };
}
