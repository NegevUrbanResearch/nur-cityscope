import { isProjectionMatchCommand, isProjectionMatchAck, CURSOR_EXPIRY_MS } from '../shared/projection-match-protocol.js';

/** Launch metadata describes this running window; saved reverse preferences are irrelevant. */
export function readProjectionMatchLaunch({ spanId, search = '' }) {
  if (!['left', 'right'].includes(spanId)) return null;
  const params = new URLSearchParams(search);
  if (!params.has('matchDisplaySide') && !params.has('matchReversed')) return { displaySide: spanId, reversed: false };
  const displaySide = params.get('matchDisplaySide');
  return params.get('matchReversed') === '1' && ['left', 'right'].includes(displaySide) && displaySide !== spanId
    ? { displaySide, reversed: true } : null;
}

/** Independent SVG in the final 1920 x 1080 output plane, outside the compositor. */
export function createProjectionMatchCursor({ document: doc, host, output, instanceId, readContext, sendAck,
  requestFrame, cancelFrame, clock } = {}) {
  let disposed = false, active = null, overlay = null, timer = null, frame = null, generation = 0;
  const seenSequences = new Map();
  const invalidSessions = new Map();
  const now = () => typeof clock.now === 'function' ? clock.now() : clock.Date?.now?.() ?? Date.now();
  const visible = () => doc.visibilityState !== 'hidden';
  const sameSession = (a, b) => a.sourceId === b.sourceId && a.sessionId === b.sessionId;
  const matches = (message, context) => context?.stable === true && context.route === 'browser' &&
    context.revision === message.revision && context.sourceFrameIdentity === message.sourceFrameIdentity &&
    typeof context.configIdentity === 'string' && ['left', 'right'].includes(context.displaySide) && typeof context.reversed === 'boolean';
  const sameContext = (a, b) => ['revision', 'configIdentity', 'sourceFrameIdentity', 'route', 'stable', 'displaySide', 'reversed'].every(key => a?.[key] === b?.[key]);
  const cancelPending = () => { generation += 1; if (frame !== null) cancelFrame(frame); frame = null; };
  const removeOverlay = () => { overlay?.remove(); overlay = null; };
  function clear() {
    cancelPending(); removeOverlay();
    if (timer !== null) clock.clearTimeout(timer);
    timer = null; active = null;
  }
  function renew() {
    if (timer !== null) clock.clearTimeout(timer);
    active.expiresAt = now() + CURSOR_EXPIRY_MS;
    timer = clock.setTimeout(clear, CURSOR_EXPIRY_MS);
  }
  function acknowledge(message, context, error = null) {
    sendAck({ type: 'otef_projection_match_ack', table: 'otef', output, instanceId,
      sourceId: message.sourceId, sessionId: message.sessionId, sequence: message.sequence,
      revision: message.revision, sourceFrameIdentity: message.sourceFrameIdentity,
      displaySide: context?.displaySide || output, reversed: context?.reversed === true, success: error === null, error });
  }
  function draw(message) {
    if (!overlay) {
      overlay = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      overlay.setAttribute('viewBox', '0 0 1920 1080');
      overlay.setAttribute('preserveAspectRatio', 'none');
      overlay.setAttribute('aria-hidden', 'true');
      overlay.classList.add('projection-match-cursor');
      Object.assign(overlay.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '3000' });
      // Hollow center preserves the landmark under the cursor; the number makes direction unambiguous.
      overlay.innerHTML = '<circle data-match-source r="10" fill="none" stroke="#00ffff" stroke-width="2"/>' +
        '<g data-match-target fill="none" stroke="#ffff00" stroke-width="3"><circle r="15"/>' +
        '<path d="M-28 0H-18M18 0H28M0-28V-18M0 18V28"/><text x="22" y="-22" fill="#ffff00" stroke="#000" stroke-width="1" font-size="28" font-family="sans-serif" paint-order="stroke"></text></g>';
      host.appendChild(overlay);
    }
    overlay.querySelector('[data-match-target]').setAttribute('transform', `translate(${message.targetPx.join(' ')})`);
    const source = overlay.querySelector('[data-match-source]');
    source.setAttribute('cx', message.sourcePx[0]); source.setAttribute('cy', message.sourcePx[1]);
    overlay.querySelector('text').textContent = String(message.pointId);
  }
  function contextChanged() {
    if (active && (!visible() || !matches(active.message, readContext()) || !sameContext(active.context, readContext()))) clear();
  }
  function invalidateSource(error) {
    if (active) {
      const reason = String(error || 'Effective source changed; restart point capture.').slice(0, 240);
      invalidSessions.set(`${active.message.sourceId}/${active.message.sessionId}`, reason);
      acknowledge(active.message, active.context, reason);
    }
    clear();
  }
  function receive(message) {
    if (disposed || !isProjectionMatchCommand(message) || message.output !== output || message.instanceId !== instanceId) return;
    if (active && now() >= active.expiresAt) clear();
    const sessionKey = `${message.sourceId}/${message.sessionId}`;
    if (message.mode !== 'off' && invalidSessions.has(sessionKey)) { acknowledge(message, readContext(), invalidSessions.get(sessionKey)); return; }
    if (message.mode === 'off') {
      const knownSequence = seenSequences.get(sessionKey);
      if (knownSequence !== undefined && message.sequence >= knownSequence) seenSequences.set(sessionKey, message.sequence);
      if (active && sameSession(active.message, message) && message.sequence >= active.message.sequence) clear();
      return;
    }
    if (active && !sameSession(active.message, message)) return;
    if (!active && message.sequence <= (seenSequences.get(sessionKey) ?? -1)) return;
    if (active && message.sequence < active.message.sequence) return;
    const context = { ...readContext() };
    if (!visible() || !matches(message, context)) {
      clear(); acknowledge(message, context, 'Output context is not stable or does not match'); return;
    }
    if (active && message.sequence === active.message.sequence) { renew(); return; }
    cancelPending();
    seenSequences.set(sessionKey, message.sequence);
    active = { message: { ...message, targetPx: message.targetPx?.slice() ?? null, sourcePx: message.sourcePx?.slice() ?? null }, context };
    renew();
    const token = generation;
    const current = () => !disposed && generation === token && active && visible() &&
      matches(message, readContext()) && sameContext(context, readContext());
    frame = requestFrame(() => {
      if (!current()) { if (generation === token) clear(); return; }
      frame = null;
      if (message.mode === 'cursor') draw(active.message); else removeOverlay();
      frame = requestFrame(() => {
        if (!current()) { if (generation === token) clear(); return; }
        frame = null; acknowledge(message, context);
      });
    });
  }
  doc.addEventListener('visibilitychange', contextChanged);
  return { receive, contextChanged, invalidateSource, clear, dispose() { if (disposed) return; clear(); disposed = true; doc.removeEventListener('visibilitychange', contextChanged); } };
}

/** Source readiness is provided by the evaluated scene task. Missing source context is deliberately unready. */
export function bindProjectionMatchCursor({ socket, runtime, launch, readSourceContext = () => null,
  onAck = () => {}, ...options } = {}) {
  const cursor = createProjectionMatchCursor({ ...options,
    readContext: () => {
      const geometry = runtime.getAppliedGeometryState(), source = readSourceContext();
      return { revision: geometry.revision, configIdentity: geometry.configIdentity,
        sourceFrameIdentity: source?.sourceFrameIdentity ?? null,
        stable: Boolean(source?.stable && geometry.revision >= 0 && geometry.configIdentity &&
          !geometry.pending && !geometry.failed && !geometry.suspended && !geometry.stopped),
        route: 'browser', ...launch };
    }, sendAck: message => socket.send(message) });
  const acknowledge = message => { if (isProjectionMatchAck(message)) onAck(message); };
  const handlers = [['otef_projection_match_cursor', cursor.receive], ['otef_projection_match_ack', acknowledge], ['disconnect', cursor.clear]];
  for (const [name, listener] of handlers) socket.on(name, listener);
  return { contextChanged: cursor.contextChanged, invalidateSource: cursor.invalidateSource, clear: cursor.clear, dispose() {
    for (const [name, listener] of handlers) socket.off(name, listener);
    cursor.dispose();
  } };
}
