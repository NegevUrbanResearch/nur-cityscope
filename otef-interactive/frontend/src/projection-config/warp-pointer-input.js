import { fitWarpViewport, warpPointFromClient } from "./warp-viewport.js";

const HIT_RADIUS = 22;

/** Bind one gesture at a time to the stable SVG, independent of its children. */
export function bindWarpPointerInput({ surface, readGeometry, onSelect, onStart, onMove, onEnd, onCancel }) {
  const doc = surface.ownerDocument;
  const win = doc?.defaultView;
  let active = null;

  const release = (gesture) => {
    try { surface.releasePointerCapture?.(gesture.pointerId); } catch { /* Capture may already have been lost. */ }
  };
  const cancel = ({ notify = true } = {}) => {
    if (!active) return false;
    const gesture = active;
    active = null;
    release(gesture);
    if (notify) onCancel({ output: gesture.output });
    return true;
  };
  const matches = (event) => active && event.pointerId === active.pointerId;
  const point = (event, gesture) => ({ ...warpPointFromClient(event, gesture.rect, gesture.viewBox), output: gesture.output });

  const down = (event) => {
    if (active || event.isPrimary === false || (event.pointerType === "mouse" && event.button !== 0) || (event.button !== undefined && event.button !== 0)) return;
    const geometry = readGeometry();
    if (!geometry?.rect || !geometry?.viewBox || !Array.isArray(geometry.handles)) return;
    const { left, top, width, height } = geometry.rect;
    const rect = { left, top, width, height };
    const { x, y, width: boxWidth, height: boxHeight } = geometry.viewBox;
    const viewBox = { x, y, width: boxWidth, height: boxHeight };
    const fit = fitWarpViewport(viewBox, rect.width, rect.height);
    let hit = null;
    geometry.handles.forEach((handle, index) => {
      if (!Number.isFinite(handle?.x) || !Number.isFinite(handle?.y)) return;
      const x = rect.left + fit.insetX + (handle.x * 1920 - viewBox.x) * fit.scale;
      const y = rect.top + fit.insetY + (handle.y * 1080 - viewBox.y) * fit.scale;
      const distance = Math.hypot(event.clientX - x, event.clientY - y);
      if (distance <= HIT_RADIUS && (!hit || distance < hit.distance || (distance === hit.distance && index < hit.index))) hit = { index, distance };
    });
    if (!hit) return;
    const output = geometry.side || geometry.output;
    const mode = geometry.mode || geometry.selection?.mode;
    const gesture = { pointerId: event.pointerId, rect, viewBox, output };
    active = gesture;
    event.preventDefault?.();
    if (!geometry.selection?.indices?.includes(hit.index)) onSelect({ output, selection: { mode, kind: mode === "grid" ? "point" : "corner", index: hit.index } });
    try { surface.setPointerCapture?.(gesture.pointerId); } catch { active = null; return; }
    onStart(point(event, gesture));
  };
  const move = (event) => { if (matches(event)) onMove(point(event, active)); };
  const up = (event) => {
    if (!matches(event)) return;
    const gesture = active;
    active = null;
    onEnd(point(event, gesture));
    release(gesture);
  };
  const lost = (event) => { if (matches(event)) cancel(); };
  const blur = () => { cancel(); };
  const visibility = () => { if (doc.visibilityState === "hidden") cancel(); };
  const listeners = [[surface, "pointerdown", down], [surface, "pointermove", move], [surface, "pointerup", up], [surface, "pointercancel", lost], [surface, "lostpointercapture", lost], [win, "blur", blur], [doc, "visibilitychange", visibility]];
  for (const [target, type, handler] of listeners) target?.addEventListener?.(type, handler);
  return {
    cancel,
    activeViewBox: () => active?.viewBox || null,
    dispose() { cancel(); for (const [target, type, handler] of listeners) target?.removeEventListener?.(type, handler); },
  };
}
