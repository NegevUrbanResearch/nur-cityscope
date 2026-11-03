/** Diagnostics must never interrupt an exhibit interaction. */
export function recordProjectionTrace(trace, kind, detail) {
  if (!trace?.enabled) return;
  try { trace.record(kind, detail); } catch { /* Diagnostic failure is isolated. */ }
}

export function projectionTraceTime(trace) {
  return trace?.enabled ? (globalThis.performance?.now?.() || 0) : 0;
}

/** Observe input without changing default handling or pointer ownership. */
export function bindProjectionTraceInput({ surface, surfaceName, trace, readGeometry = () => null }) {
  if (!trace?.enabled) return () => {};
  const pointers = new Map();
  const target = surface.ownerDocument || surface;
  const observe = (event) => {
    try {
      if (event.target !== surface && !surface.contains?.(event.target) && !pointers.has(event.pointerId)) return;
      if (event.type === 'pointermove' && !pointers.has(event.pointerId)) return;
      let geometry = pointers.get(event.pointerId) || {};
      if (event.type === 'pointerdown') {
        const rect = surface.getBoundingClientRect();
        const current = readGeometry() || {};
        const box = current.viewBox;
        geometry = { rectX: rect.left, rectY: rect.top, rectWidth: rect.width, rectHeight: rect.height };
        if (box) Object.assign(geometry, { viewX: box.x, viewY: box.y, viewWidth: box.width, viewHeight: box.height });
        if (current.mode) geometry.mode = current.mode;
        if (current.side) geometry.output = current.side;
        if (current.selection) Object.assign(geometry, { index: current.selection.index ?? 0, indices: current.selection.indices || [], role: current.selection.kind || 'point' });
        pointers.set(event.pointerId, geometry);
      }
      const capture = event.type.includes('capture');
      recordProjectionTrace(trace, capture ? 'capture' : 'pointer', {
        ...geometry, phase: event.type, surface: surfaceName,
        role: event.target?.classList?.contains('warp-handle') ? 'handle' : event.target?.closest?.('input,select,textarea') ? 'input' : event.target?.closest?.('button') ? 'button' : event.target?.closest?.('.config-node h3') ? 'node_header' : surfaceName,
        pointerId: event.pointerId, pointerType: ['mouse', 'touch', 'pen'].includes(event.pointerType) ? event.pointerType : 'unknown',
        primary: Boolean(event.isPrimary), buttons: event.buttons ?? 0, button: event.button ?? -1,
        clientX: event.clientX, clientY: event.clientY, captured: Boolean(surface.hasPointerCapture?.(event.pointerId)),
      });
      if (event.type === 'pointerup' || event.type === 'pointercancel') pointers.delete(event.pointerId);
    } catch { /* DOM teardown or instrumentation must not affect gestures. */ }
  };
  const types = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture'];
  for (const type of types) target.addEventListener(type, observe, { capture: true, passive: true });
  return () => { for (const type of types) target.removeEventListener(type, observe, true); pointers.clear(); };
}

export function bindProjectionTracePage({ document: doc, trace }) {
  if (!trace?.enabled) return () => {};
  const win = doc.defaultView;
  const observe = (event) => recordProjectionTrace(trace, 'viewport', {
    surface: 'page', phase: event.type, width: win.innerWidth || 0, height: win.innerHeight || 0,
    visible: doc.visibilityState !== 'hidden', visibilityState: doc.visibilityState || 'unknown',
  });
  const listeners = [[win, 'resize'], [win, 'orientationchange'], [win, 'blur'], [doc, 'visibilitychange'], [doc, 'fullscreenchange']];
  for (const [target, type] of listeners) target?.addEventListener?.(type, observe, { passive: true });
  recordProjectionTrace(trace, 'lifecycle', { phase: 'page_ready', surface: 'page', width: win.innerWidth || 0, height: win.innerHeight || 0, devicePixelRatio: win.devicePixelRatio || 1 });
  return () => { for (const [target, type] of listeners) target?.removeEventListener?.(type, observe); };
}
