import { clampWarpViewBox, fitWarpViewport, transformWarpViewBox, warpPointFromClient } from "./warp-viewport.js";
import { recordProjectionTrace } from './projection-trace-input.js';

const HIT_RADIUS = 24;

/** Convert a grid handle index into the active point, row, or column selection. */
export function gridSelectionForHandle(selection, index, columns) {
  const columnCount = Math.max(1, Math.floor(Number(columns) || 1));
  const handleIndex = Math.max(0, Math.floor(Number(index) || 0));
  if (selection?.kind === "row") return { mode: "grid", kind: "row", index: Math.floor(handleIndex / columnCount) };
  if (selection?.kind === "column") return { mode: "grid", kind: "column", index: handleIndex % columnCount };
  return { mode: "grid", kind: "point", index: handleIndex };
}

/** Bind one geometry gesture or a two-touch navigation gesture to the stable SVG. */
export function bindWarpPointerInput({ surface, readGeometry, onSelect, onStart, onMove, onEnd, onCancel, onNavigate, trace }) {
  const doc = surface.ownerDocument;
  const win = doc?.defaultView;
  let active = null;
  let navigation = null;
  let pan = null;
  let interactionMode = null;
  const touches = new Map();
  const ignoredCaptureLoss = new Set();

  const release = (gesture) => {
    if (touches.has(gesture.pointerId)) ignoredCaptureLoss.add(gesture.pointerId);
    try { surface.releasePointerCapture?.(gesture.pointerId); } catch { ignoredCaptureLoss.delete(gesture.pointerId); }
  };
  const cancelGeometry = ({ notify = true, reason = 'cancel' } = {}) => {
    if (!active) return false;
    const gesture = active;
    active = null;
    recordProjectionTrace(trace, 'gesture', { surface: 'warp', phase: 'cancel', reason, output: gesture.output, pointerId: gesture.pointerId });
    release(gesture);
    if (notify && gesture.dragStarted) onCancel({ output: gesture.output });
    if (gesture.selectionChanged && gesture.previousSelection) {
      const { mode, kind, index } = gesture.previousSelection;
      onSelect({ output: gesture.output, selection: { mode, kind, index } });
    }
    return true;
  };
  const cancelNavigation = () => {
    if (!navigation) return false;
    const gesture = navigation;
    navigation = null;
    for (const pointerId of gesture.capturedPointerIds) release({ pointerId });
    onNavigate?.({ viewBox: gesture.startViewBox });
    return true;
  };
  const cancelPan = () => {
    if (!pan) return false;
    const gesture = pan;
    pan = null;
    release(gesture);
    onNavigate?.({ viewBox: gesture.startViewBox });
    return true;
  };
  const cancel = ({ notify = true, reason = 'cancel' } = {}) => {
    const hadNavigation = cancelNavigation();
    const hadPan = cancelPan();
    const hadGeometry = cancelGeometry({ notify, reason });
    touches.clear();
    ignoredCaptureLoss.clear();
    return hadNavigation || hadPan || hadGeometry;
  };
  const matches = (event) => active && event.pointerId === active.pointerId;
  const point = (event, gesture) => ({ ...warpPointFromClient(event, gesture.rect, gesture.viewBox), output: gesture.output });
  const distanceToSegment = (point, from, to) => {
    const dx = to.x - from.x, dy = to.y - from.y;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length)) : 0;
    return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
  };
  const beginDrag = (event, gesture) => {
    if (!gesture.canEdit || gesture.dragStarted || Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY) < 6) return false;
    gesture.dragStarted = true;
    const outputPoint = { x: gesture.startPoint.x, y: gesture.startPoint.y };
    onStart({ ...outputPoint, outputPoint, clientX: gesture.clientX, clientY: gesture.clientY, output: gesture.output });
    recordProjectionTrace(trace, 'gesture', { surface: 'warp', phase: 'start', output: gesture.output, pointerId: gesture.pointerId });
    return true;
  };
  const editMove = (event, gesture) => {
    beginDrag(event, gesture);
    if (gesture.dragStarted) onMove(point(event, gesture));
  };
  const mid = (a, b) => ({ clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 });
  const distance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

  const beginNavigation = () => {
    if (navigation) return;
    if (active) return;
    const pair = [...touches.entries()].slice(0, 2);
    if (pair.length < 2 || !onNavigate) return;
    let rect;
    let viewBox;
    let baseViewBox;
    let capturedPointerIds = [];
    if (pan) {
      if (!pair.some(([id]) => id === pan.pointerId)) return;
      rect = pan.rect;
      viewBox = { ...pan.viewBox };
      baseViewBox = pan.baseViewBox;
      capturedPointerIds = [pan.pointerId];
      pan = null;
    } else {
      const geometry = readGeometry();
      if (!geometry?.rect || !geometry?.viewBox) return;
      rect = { left: geometry.rect.left, top: geometry.rect.top, width: geometry.rect.width, height: geometry.rect.height };
      viewBox = { x: geometry.viewBox.x, y: geometry.viewBox.y, width: geometry.viewBox.width, height: geometry.viewBox.height };
      baseViewBox = geometry.baseViewBox || viewBox;
    }
    const [first, second] = pair.map(([, point]) => point);
    navigation = { ids: pair.map(([id]) => id), capturedPointerIds, rect, startViewBox: viewBox, viewBox, baseViewBox, midpoint: mid(first, second), distance: distance(first, second) };
  };
  const updateNavigation = () => {
    if (!navigation) return;
    const a = touches.get(navigation.ids[0]);
    const b = touches.get(navigation.ids[1]);
    if (!a || !b) return;
    const midpoint = mid(a, b);
    const nextDistance = distance(a, b);
    const factor = navigation.distance > 0 && nextDistance > 0 ? nextDistance / navigation.distance : 1;
    navigation.viewBox = clampWarpViewBox(transformWarpViewBox(navigation.viewBox, navigation.rect, { from: navigation.midpoint, to: midpoint, factor }), navigation.baseViewBox, { anchor: midpoint, rect: navigation.rect });
    navigation.midpoint = midpoint;
    navigation.distance = nextDistance;
    onNavigate({ viewBox: navigation.viewBox });
  };

  const down = (event) => {
    ignoredCaptureLoss.delete(event.pointerId);
    if (event.pointerType === "touch") {
      touches.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
      if (touches.size >= 2) {
        if (active) cancelGeometry({ notify: active.dragStarted, reason: 'second-touch' });
        beginNavigation();
        event.preventDefault?.();
        return;
      }
    }
    if (active || navigation || event.isPrimary === false || (event.pointerType === "mouse" && event.button !== 0) || (event.button !== undefined && event.button !== 0)) return;
    const geometry = readGeometry();
    if (!geometry?.rect || !geometry?.viewBox || !Array.isArray(geometry.handles)) return;
    const { left, top, width, height } = geometry.rect;
    const rect = { left, top, width, height };
    if ((interactionMode || (geometry.panMode ? "move" : "edit")) === "move" && onNavigate) {
      pan = { pointerId: event.pointerId, rect, baseViewBox: geometry.baseViewBox || geometry.viewBox, startViewBox: { ...geometry.viewBox }, viewBox: { ...geometry.viewBox }, previous: { clientX: event.clientX, clientY: event.clientY } };
      event.preventDefault?.();
      try { surface.setPointerCapture?.(event.pointerId); recordProjectionTrace(trace, 'capture', { surface: 'warp', phase: 'request', pointerId: event.pointerId, accepted: true }); } catch { recordProjectionTrace(trace, 'capture', { surface: 'warp', phase: 'request', pointerId: event.pointerId, accepted: false, reason: 'capture_failed' }); pan = null; }
      return;
    }
    const { x, y, width: boxWidth, height: boxHeight } = geometry.viewBox;
    const viewBox = { x, y, width: boxWidth, height: boxHeight };
    const fit = fitWarpViewport(viewBox, rect.width, rect.height);
    const screenPoints = geometry.handles.map((handle) => {
      if (!Number.isFinite(handle?.x) || !Number.isFinite(handle?.y)) return null;
      return { x: rect.left + fit.insetX + (handle.x * 1920 - viewBox.x) * fit.scale, y: rect.top + fit.insetY + (handle.y * 1080 - viewBox.y) * fit.scale };
    });
    let hit = null;
    const selection = geometry.selection;
    const columns = Math.max(1, Math.floor(Number(geometry.columns) || 1));
    const rows = Math.max(1, Math.floor(Number(geometry.rows) || Math.ceil(geometry.handles.length / columns)));
    if (geometry.mode === "grid" && selection?.kind === "row") {
      const row = Math.max(0, Math.min(rows - 1, Math.floor(Number(selection.index) || 0)));
      const indices = Array.from({ length: columns }, (_, column) => row * columns + column).filter((index) => screenPoints[index]);
      const closest = indices.reduce((best, index) => !best || Math.hypot(event.clientX - screenPoints[index].x, event.clientY - screenPoints[index].y) < best.distance ? { index, distance: Math.hypot(event.clientX - screenPoints[index].x, event.clientY - screenPoints[index].y) } : best, null);
      const lineDistance = indices.slice(1).reduce((best, index, offset) => Math.min(best, distanceToSegment({ x: event.clientX, y: event.clientY }, screenPoints[indices[offset]], screenPoints[index])), Infinity);
      if (closest && lineDistance <= HIT_RADIUS) hit = { ...closest, selection: { mode: "grid", kind: "row", index: row } };
    } else if (geometry.mode === "grid" && selection?.kind === "column") {
      const column = Math.max(0, Math.min(columns - 1, Math.floor(Number(selection.index) || 0)));
      const indices = Array.from({ length: rows }, (_, row) => row * columns + column).filter((index) => screenPoints[index]);
      const closest = indices.reduce((best, index) => !best || Math.hypot(event.clientX - screenPoints[index].x, event.clientY - screenPoints[index].y) < best.distance ? { index, distance: Math.hypot(event.clientX - screenPoints[index].x, event.clientY - screenPoints[index].y) } : best, null);
      const lineDistance = indices.slice(1).reduce((best, index, offset) => Math.min(best, distanceToSegment({ x: event.clientX, y: event.clientY }, screenPoints[indices[offset]], screenPoints[index])), Infinity);
      if (closest && lineDistance <= HIT_RADIUS) hit = { ...closest, selection: { mode: "grid", kind: "column", index: column } };
    }
    if (!hit) geometry.handles.forEach((handle, index) => {
      if (!Number.isFinite(handle?.x) || !Number.isFinite(handle?.y)) return;
      const hitDistance = Math.hypot(event.clientX - screenPoints[index].x, event.clientY - screenPoints[index].y);
      if (hitDistance <= HIT_RADIUS && (!hit || hitDistance < hit.distance || (hitDistance === hit.distance && index < hit.index))) hit = { index, distance: hitDistance };
    });
    if (!hit) return;
    const output = geometry.side || geometry.output;
    const mode = geometry.mode || geometry.selection?.mode;
    const selectionChanged = !geometry.selection?.indices?.includes(hit.index);
    const previousSelection = geometry.selection ? { mode: geometry.selection.mode, kind: geometry.selection.kind, index: geometry.selection.index } : null;
    const gesture = { pointerId: event.pointerId, rect, viewBox, output, selectionChanged, previousSelection, clientX: event.clientX, clientY: event.clientY, lastClientX: event.clientX, lastClientY: event.clientY, startPoint: warpPointFromClient(event, rect, viewBox), canEdit: geometry.editable !== false, dragStarted: false };
    active = gesture;
    recordProjectionTrace(trace, 'selection', { surface: 'warp', output, mode, index: hit.index, accepted: selectionChanged });
    event.preventDefault?.();
    if (selectionChanged) {
      const selected = hit.selection || (mode === "grid"
        ? gridSelectionForHandle(geometry.selection, hit.index, geometry.columns)
        : { mode, kind: "corner", index: hit.index });
      onSelect({ output, selection: selected });
    }
    try { surface.setPointerCapture?.(gesture.pointerId); recordProjectionTrace(trace, 'capture', { surface: 'warp', phase: 'request', pointerId: gesture.pointerId, accepted: true }); } catch { recordProjectionTrace(trace, 'capture', { surface: 'warp', phase: 'request', pointerId: gesture.pointerId, accepted: false, reason: 'capture_failed' }); active = null; return; }
    recordProjectionTrace(trace, 'gesture', { surface: 'warp', phase: 'intent', output, mode, pointerId: gesture.pointerId });
  };
  const move = (event) => {
    if (event.pointerType === "touch" && touches.has(event.pointerId)) {
      touches.set(event.pointerId, { clientX: event.clientX, clientY: event.clientY });
    }
    if (pan?.pointerId === event.pointerId) {
      const nextPoint = { clientX: event.clientX, clientY: event.clientY };
      pan.viewBox = clampWarpViewBox(transformWarpViewBox(pan.viewBox, pan.rect, { from: pan.previous, to: nextPoint }), pan.baseViewBox, { anchor: nextPoint, rect: pan.rect });
      pan.previous = { clientX: event.clientX, clientY: event.clientY };
      onNavigate?.({ viewBox: pan.viewBox });
      return;
    }
    if (navigation && navigation.ids.includes(event.pointerId)) {
      updateNavigation();
      return;
    }
    if (matches(event) && (!active.dragStarted || event.clientX !== active.lastClientX || event.clientY !== active.lastClientY)) {
      editMove(event, active);
      active.lastClientX = event.clientX; active.lastClientY = event.clientY;
    }
  };
  const up = (event) => {
    ignoredCaptureLoss.delete(event.pointerId);
    if (pan?.pointerId === event.pointerId) {
      const gesture = pan;
      pan = null;
      touches.delete(event.pointerId);
      release(gesture);
      return;
    }
    if (navigation && touches.has(event.pointerId)) {
      touches.delete(event.pointerId);
      if (navigation.ids.includes(event.pointerId)) {
        const gesture = navigation;
        navigation = null;
        for (const pointerId of gesture.capturedPointerIds) release({ pointerId });
      }
      return;
    }
    if (event.pointerType === "touch") touches.delete(event.pointerId);
    if (!matches(event)) return;
    const gesture = active;
    if (!gesture.dragStarted || event.clientX !== gesture.lastClientX || event.clientY !== gesture.lastClientY) beginDrag(event, gesture);
    active = null;
    recordProjectionTrace(trace, 'gesture', { surface: 'warp', phase: 'end', reason: 'pointerup', output: gesture.output, pointerId: gesture.pointerId });
    if (gesture.dragStarted) onEnd(point(event, gesture));
    release(gesture);
  };
  const lost = (event) => {
    if (navigation && (!event?.pointerId || navigation.ids.includes(event.pointerId))) cancelNavigation();
    if (pan && (!event?.pointerId || pan.pointerId === event.pointerId)) cancelPan();
    if (matches(event)) cancelGeometry({ reason: event.type === 'pointercancel' ? 'pointercancel' : 'lostcapture' });
    if (event?.pointerId != null) touches.delete(event.pointerId);
    ignoredCaptureLoss.delete(event?.pointerId);
  };
  const captureLost = (event) => {
    // Explicit release changes capture ownership, not whether a touch is still down.
    if (!ignoredCaptureLoss.delete(event.pointerId)) lost(event);
  };
  const blur = () => { cancel({ reason: 'blur' }); };
  const visibility = () => { if (doc.visibilityState === "hidden") cancel({ reason: 'visibility' }); };
  const listeners = [[surface, "pointerdown", down], [surface, "pointermove", move], [surface, "pointerup", up], [surface, "pointercancel", lost], [surface, "lostpointercapture", captureLost], [win, "blur", blur], [doc, "visibilitychange", visibility]];
  for (const [target, type, handler] of listeners) target?.addEventListener?.(type, handler);
  return {
    cancel,
    setInteractionMode(mode) { if (!["edit", "move"].includes(mode)) return false; if (active || pan || navigation) return false; interactionMode = mode; return true; },
    activeViewBox: () => navigation?.viewBox || pan?.viewBox || active?.viewBox || null,
    isActive: () => Boolean(active || navigation || pan),
    dispose() { cancel(); for (const [target, type, handler] of listeners) target?.removeEventListener?.(type, handler); },
  };
}
