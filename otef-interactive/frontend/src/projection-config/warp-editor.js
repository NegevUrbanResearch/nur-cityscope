import { validateProjectionConfig } from "../shared/projection-config-schema.js";
import { compareRenderedLayouts, evaluateWarpMesh } from "../shared/projection-warp-geometry.js";
import { insertGridLine, moveGridLine, removeGridLine, resizeGridAxis, uniformGrid } from "../shared/projection-grid-topology.js";
import { recordProjectionTrace, projectionTraceTime } from './projection-trace-input.js';

const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;
const DEFAULT_HISTORY_LIMIT = 40;
const KEYSTONE_EDGES = [[0, 1], [1, 3], [2, 3], [0, 2]];
const clone = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function sideDimensions(output) { return output === "right" ? { columns: 8, rows: 7 } : { columns: 7, rows: 7 }; }
function configWarp(config, output) { return config?.outputs?.[output]?.warp; }
function axisValue(point, axis) { return Array.isArray(point) ? point[axis === "x" ? 0 : 1] : point?.[axis]; }

export function keystoneSelection(type = "corner", index = 0) {
  if (type === "edge") return { mode: "keystone", kind: "edge", index: clamp(Number(index) || 0, 0, 3) };
  if (type === "all") return { mode: "keystone", kind: "all", index: 0 };
  return { mode: "keystone", kind: "corner", index: clamp(Number(index) || 0, 0, 3) };
}

export function gridSelection(type = "point", index = 0) {
  const kind = type === "row" || type === "column" || type === "edge" || type === "all" ? type : "point";
  return { mode: "grid", kind, index: Math.max(0, Number(index) || 0) };
}

function indicesFor(selection, warp) {
  if (selection.mode === "keystone") {
    if (selection.kind === "all") return [0, 1, 2, 3];
    if (selection.kind === "edge") return KEYSTONE_EDGES[clamp(selection.index, 0, 3)];
    return [clamp(selection.index, 0, 3)];
  }
  const columns = warp?.grid?.columns || 7;
  const rows = warp?.grid?.rows || 7;
  if (selection.kind === "all") return Array.from({ length: columns * rows }, (_, index) => index);
  if (selection.kind === "row") {
    const row = clamp(selection.index, 0, rows - 1);
    return Array.from({ length: columns }, (_, column) => row * columns + column);
  }
  if (selection.kind === "column") {
    const column = clamp(selection.index, 0, columns - 1);
    return Array.from({ length: rows }, (_, row) => row * columns + column);
  }
  if (selection.kind === "edge") {
    const edge = clamp(selection.index, 0, 3);
    if (edge === 0) return Array.from({ length: columns }, (_, column) => column);
    if (edge === 1) return Array.from({ length: rows }, (_, row) => row * columns + columns - 1);
    if (edge === 2) return Array.from({ length: columns }, (_, column) => (rows - 1) * columns + column);
    return Array.from({ length: rows }, (_, row) => row * columns);
  }
  return [clamp(selection.index, 0, columns * rows - 1)];
}

function pointsForSelection(config, output, selection) {
  const warp = configWarp(config, output);
  return selection.mode === "keystone" ? warp.keystone.corners : warp.grid.offsets;
}

export function createWarpEditor({
  config,
  output = "left",
  baselineMesh = null,
  onChange = () => {},
  validateCandidate = (candidate) => Object.keys(validateProjectionConfig(candidate)).length === 0,
  historyLimit = DEFAULT_HISTORY_LIMIT,
  trace,
} = {}) {
  if (!config?.outputs?.[output]?.warp) throw new Error(`warp editor requires ${output} warp config`);
  let current = clone(config);
  let selection = keystoneSelection("corner", 0);
  let stepMode = "fine";
  let undoStack = [];
  let redoStack = [];
  let drag = null;
  let nudgeGesture = null;
  let validationMessage = "";
  let validationReason = '';
  let evaluationCache = null;

  const allowCommand = () => {
    if (!drag && !nudgeGesture) return true;
    validationReason = 'gesture_active';
    validationMessage = 'Finish or cancel the active adjustment first.';
    return false;
  };
  const allowGeometryCommand = () => {
    if (!allowCommand()) return false;
    if (configWarp(current, output)?.enabled !== false) return true;
    validationReason = "warp_bypassed";
    validationMessage = "Correction is bypassed. Enable correction to edit geometry.";
    return false;
  };

  const step = () => stepMode === "coarse" ? 1 : 0.25;
  const selectedIndices = () => indicesFor(selection, configWarp(current, output));
  const emit = (candidate, meta) => { current = candidate; onChange(clone(candidate), { ...meta, selection: clone(selection) }); };
  const evaluate = (candidate) => {
    if (evaluationCache?.config === candidate && evaluationCache.mesh === baselineMesh) return evaluationCache.result;
    const warp = configWarp(candidate, output);
    const result = evaluateWarpMesh(warp?.baseline?.type === "tdMesh" ? baselineMesh : null, warp, { side: output, schemaVersion: candidate.schemaVersion });
    evaluationCache = { config: candidate, mesh: baselineMesh, result };
    return result;
  };
  const valid = (candidate, { semantic = true, report = false } = {}) => {
    validationReason = '';
    const reject = (reason, category = 'geometry_invalid') => { validationReason = category; if (report) validationMessage = "Move rejected: " + reason; return false; };
    try {
      if (!validateCandidate(candidate)) {
        const errors = validateProjectionConfig(candidate);
        return reject(Object.values(errors)[0] || "configuration validation rejected the candidate.", 'configuration_invalid');
      }
      if (!semantic) { if (report) validationMessage = ""; return true; }
      const warp = configWarp(candidate, output);
      if (warp?.enabled === false || warp?.baseline?.type === "identity") {
        evaluate(candidate);
        if (report) validationMessage = "";
        return true;
      }
      if (warp?.baseline?.type !== "tdMesh" || !baselineMesh) return reject("the TD baseline is unavailable.", 'baseline_unavailable');
      evaluate(candidate);
      if (report) validationMessage = "";
      return true;
    } catch (error) { return reject(error?.message || "the geometry is invalid."); }
  };
  const remember = (snapshot, selected = selection) => {
    undoStack.push({ warp: clone(configWarp(snapshot, output)), selection: clone(selected) });
    if (undoStack.length > historyLimit) undoStack.splice(0, undoStack.length - historyLimit);
    redoStack = [];
  };
  const apply = (candidate, meta = {}, { record = true } = {}) => {
    if (!valid(candidate, { report: true })) return false;
    if (record) remember(current);
    emit(candidate, meta);
    return true;
  };
  const makeMoved = (dx, dy) => {
    const candidate = clone(current);
    const points = pointsForSelection(candidate, output, selection);
    for (const index of selectedIndices()) {
      points[index][0] += dx;
      points[index][1] += dy;
    }
    return candidate;
  };
  const moveNormalized = (dx, dy, meta = {}, options = {}) => {
    const candidate = makeMoved(dx, dy);
    return apply(candidate, meta, options);
  };
  const selectedMean = (axis) => {
    const points = getControlPoints();
    const indices = selectedIndices();
    const selected = indices.map((index) => points[index]).filter(Boolean);
    return selected.length ? selected.reduce((sum, point) => sum + axisValue(point, axis), 0) / selected.length : NaN;
  };
  const resetToIdentity = (onlySelection) => {
    const candidate = clone(current);
    const warp = configWarp(candidate, output);
    const keys = onlySelection ? selectedIndices() : [0, 1, 2, 3];
    for (const index of keys) {
      if (selection.mode === "keystone") candidate.outputs[output].warp.keystone.corners[index] = [[0, 0], [1, 0], [0, 1], [1, 1]][index].slice();
      else warp.grid.offsets[index] = [0, 0];
    }
    if (!onlySelection) {
      warp.keystone.corners = [[0, 0], [1, 0], [0, 1], [1, 1]];
      warp.grid.offsets = warp.grid.offsets.map(() => [0, 0]);
    }
    return candidate;
  };
  const restoreWarp = (warp, reason, flush = true) => {
    const candidate = clone(current);
    candidate.outputs[output].warp = clone(warp);
    if (!valid(candidate)) return false;
    validationMessage = "";
    emit(candidate, { reason, flush });
    return true;
  };

  function select(next) {
    if (!allowCommand()) return false;
    if (!next || !["keystone", "grid"].includes(next.mode)) return false;
    selection = clone(next);
    recordProjectionTrace(trace, 'selection', { output, mode: selection.mode, role: selection.kind, index: selection.index, indices: selectedIndices() });
    return true;
  }
  function setMode(mode) { if (!allowCommand()) return false; if (selection.mode === mode) return true; return select(mode === "grid" ? gridSelection() : keystoneSelection()); }
  function setStep(mode) { if (!allowCommand()) return false; if (!["fine", "coarse"].includes(mode)) return false; stepMode = mode; return true; }
  function moveByPixels(dx, dy, meta = {}) {
    if (!allowGeometryCommand()) return false;
    return moveNormalized(Number(dx) / OUTPUT_WIDTH, Number(dy) / OUTPUT_HEIGHT, { reason: meta.reason || "nudge", flush: meta.flush ?? true }, { record: meta.record !== false });
  }
  function nudge(direction, options = {}) {
    const amount = options.coarse === true ? 1 : options.fine === true ? 0.25 : step();
    const vectors = { up: [0, -amount], down: [0, amount], left: [-amount, 0], right: [amount, 0] };
    const vector = vectors[direction];
    if (!vector) return false;
    if (!nudgeGesture) return moveByPixels(vector[0], vector[1], { reason: "nudge", flush: true });
    const deltaX = nudgeGesture.dx + vector[0];
    const deltaY = nudgeGesture.dy + vector[1];
    const candidate = clone(current);
    candidate.outputs[output].warp = clone(nudgeGesture.startWarp);
    const points = pointsForSelection(candidate, output, nudgeGesture.startSelection);
    for (const index of indicesFor(nudgeGesture.startSelection, configWarp(candidate, output))) {
      points[index][0] += deltaX / OUTPUT_WIDTH;
      points[index][1] += deltaY / OUTPUT_HEIGHT;
    }
    if (!valid(candidate, { report: true })) return false;
    nudgeGesture.dx = deltaX;
    nudgeGesture.dy = deltaY;
    nudgeGesture.changed = deltaX !== 0 || deltaY !== 0;
    emit(candidate, { reason: "nudge", flush: false });
    return true;
  }
  function beginNudgeGesture() {
    if (!allowGeometryCommand()) return false;
    nudgeGesture = { startWarp: clone(configWarp(current, output)), startSelection: clone(selection), dx: 0, dy: 0, changed: false };
    return true;
  }
  function endNudgeGesture() {
    if (!nudgeGesture) return false;
    const gesture = nudgeGesture;
    nudgeGesture = null;
    if (gesture.changed) {
      undoStack.push({ warp: clone(gesture.startWarp), selection: clone(gesture.startSelection) });
      if (undoStack.length > historyLimit) undoStack.splice(0, undoStack.length - historyLimit);
      redoStack = [];
      onChange(clone(current), { reason: "nudge-end", flush: true, selection: clone(selection) });
    }
    return true;
  }
  function cancelNudgeGesture() {
    if (!nudgeGesture) { validationMessage = ""; return false; }
    const gesture = nudgeGesture;
    nudgeGesture = null;
    validationMessage = "";
    if (gesture.changed) restoreWarp(gesture.startWarp, "nudge-cancel", true);
    return true;
  }
  function setPosition(axis, pixels) {
    if (!allowGeometryCommand()) return false;
    if (!["x", "y"].includes(axis) || !Number.isFinite(Number(pixels))) return false;
    const target = Number(pixels) / (axis === "x" ? OUTPUT_WIDTH : OUTPUT_HEIGHT);
    const anchor = selectedMean(axis);
    if (!Number.isFinite(anchor)) return false;
    return moveNormalized(axis === "x" ? target - anchor : 0, axis === "y" ? target - anchor : 0, { reason: "numeric", flush: true });
  }
  function resetSelection() { if (!allowGeometryCommand()) return false; return apply(resetToIdentity(true), { reason: "reset-selection", flush: true }); }
  function resetResiduals() { if (!allowGeometryCommand()) return false; return apply(resetToIdentity(false), { reason: "reset-residuals", flush: true }); }
  function setEnabled(enabled) { if (!allowCommand()) return false; const candidate = clone(current); candidate.outputs[output].warp.enabled = Boolean(enabled); return apply(candidate, { reason: "warp-enabled", flush: true }); }
  function restoreHistory(entry, reason) {
    const candidate = clone(current);
    candidate.outputs[output].warp = clone(entry.warp);
    if (!valid(candidate)) return false;
    selection = clone(entry.selection);
    validationMessage = "";
    emit(candidate, { reason, flush: true });
    return true;
  }
  function undo() {
    if (!allowGeometryCommand()) return false;
    if (!undoStack.length) return false;
    redoStack.push({ warp: clone(configWarp(current, output)), selection: clone(selection) });
    return restoreHistory(undoStack.pop(), "undo");
  }
  function redo() {
    if (!allowGeometryCommand()) return false;
    if (!redoStack.length) return false;
    undoStack.push({ warp: clone(configWarp(current, output)), selection: clone(selection) });
    return restoreHistory(redoStack.pop(), "redo");
  }
  function pointerStart(point) {
    if (!allowGeometryCommand()) return false;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    drag = { startWarp: clone(configWarp(current, output)), startSelection: clone(selection), x: point.x, y: point.y, lastX: point.x, lastY: point.y, moved: false };
    return true;
  }
  function pointerMove(point) {
    if (!drag || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    if (point.x === drag.lastX && point.y === drag.lastY) return true;
    const started = projectionTraceTime(trace);
    const dx = (point.x - drag.x) / OUTPUT_WIDTH;
    const dy = (point.y - drag.y) / OUTPUT_HEIGHT;
    const candidate = clone(current);
    candidate.outputs[output].warp = clone(drag.startWarp);
    const points = pointsForSelection(candidate, output, selection);
    const indices = selectedIndices();
    for (const index of indices) { points[index][0] += dx; points[index][1] += dy; }
    if (!valid(candidate, { report: true })) { recordProjectionTrace(trace, 'geometry', { output, phase: 'move', accepted: false, reason: validationReason, durationMs: projectionTraceTime(trace) - started }); return false; }
    recordProjectionTrace(trace, 'geometry', { output, phase: 'move', accepted: true, durationMs: projectionTraceTime(trace) - started });
    drag.moved = drag.moved || dx !== 0 || dy !== 0;
    drag.lastX = point.x; drag.lastY = point.y;
    emit(candidate, { reason: "drag", flush: false });
    return true;
  }
  function pointerEnd() {
    if (!drag) return false;
    if (drag.moved) { undoStack.push({ warp: clone(drag.startWarp), selection: clone(drag.startSelection) }); if (undoStack.length > historyLimit) undoStack.splice(0, undoStack.length - historyLimit); redoStack = []; onChange(clone(current), { reason: "drag-end", flush: true, selection: clone(selection) }); }
    drag = null;
    return true;
  }
  function pointerCancel() {
    if (!drag) { validationMessage = ""; return false; }
    const shouldFlush = drag.moved;
    const start = drag.startWarp;
    drag = null;
    validationMessage = "";
    if (shouldFlush) restoreWarp(start, "drag-cancel", true);
    return true;
  }
  function setConfig(next, { rebase = true } = {}) {
    if (!valid(next, { semantic: false })) return false;
    const canReuseEvaluation = !rebase && evaluationCache?.mesh === baselineMesh && evaluationCache.config?.schemaVersion === next.schemaVersion &&
      JSON.stringify(configWarp(evaluationCache.config, output)) === JSON.stringify(configWarp(next, output));
    current = clone(next);
    if (canReuseEvaluation) evaluationCache.config = current;
    validationMessage = "";
    if (rebase) { undoStack = []; redoStack = []; drag = null; nudgeGesture = null; }
    return true;
  }
  function setBaselineMesh(next) { baselineMesh = next ? clone(next) : null; return true; }
  const nearestAxisIndex = (oldAxis, newAxis, index) => {
    const value = oldAxis[Math.max(0, Math.min(oldAxis.length - 1, index))];
    let best = 0;
    for (let i = 1; i < newAxis.length; i += 1) if (Math.abs(newAxis[i] - value) < Math.abs(newAxis[best] - value)) best = i;
    return best;
  };
  const remapGridSelection = (next, oldGrid, newGrid, operation, values) => {
    const columns = newGrid.columns, rows = newGrid.rows;
    if (next.mode !== "grid" || next.kind === "all" || next.kind === "edge") return next;
    const oldX = oldGrid.columnPositions || Array.from({ length: oldGrid.columns }, (_, i) => i / (oldGrid.columns - 1));
    const oldY = oldGrid.rowPositions || Array.from({ length: oldGrid.rows }, (_, i) => i / (oldGrid.rows - 1));
    const newX = newGrid.columnPositions, newY = newGrid.rowPositions;
    const oldRow = next.kind === "row" ? next.index : Math.floor(next.index / oldGrid.columns);
    const oldColumn = next.kind === "column" ? next.index : next.index % oldGrid.columns;
    const movedAxis = operation === "move" ? values.axis : null;
    const preserveIndex = operation === "counts" || operation === "even";
    const followsMovedRow = movedAxis === "row" && (next.kind === "row" && next.index === values.index || next.kind === "point" && oldRow === values.index);
    const followsMovedColumn = movedAxis === "column" && (next.kind === "column" && next.index === values.index || next.kind === "point" && oldColumn === values.index);
    const rowIndex = preserveIndex ? clamp(oldRow, 0, rows - 1) : followsMovedRow ? clamp(values.index, 0, rows - 1) : nearestAxisIndex(oldY, newY, oldRow);
    const columnIndex = preserveIndex ? clamp(oldColumn, 0, columns - 1) : followsMovedColumn ? clamp(values.index, 0, columns - 1) : nearestAxisIndex(oldX, newX, oldColumn);
    if (next.kind === "row") return gridSelection("row", rowIndex);
    if (next.kind === "column") return gridSelection("column", columnIndex);
    return gridSelection("point", rowIndex * columns + columnIndex);
  };
  function editGridLayout(operation, values = {}) {
    if (!allowGeometryCommand()) return false;
    const candidate = clone(current);
    const grid = configWarp(candidate, output)?.grid;
    if (!grid) return false;
    let nextGrid;
    try {
      if (operation === "counts" || operation === "even") nextGrid = uniformGrid(grid, operation === "counts" ? values.columns : grid.columns, operation === "counts" ? values.rows : grid.rows);
      else if (operation === "move") nextGrid = moveGridLine(grid, values.axis, values.index, Number(values.position) / 100);
      else if (operation === "add") nextGrid = insertGridLine(grid, values.axis, Number(values.position) / 100);
      else if (operation === "remove") nextGrid = removeGridLine(grid, values.axis, values.index);
      else return false;
    } catch (error) {
      validationReason = 'configuration_invalid';
      validationMessage = error?.message || "The grid layout is invalid.";
      return false;
    }
    candidate.outputs[output].warp.grid = nextGrid;
    if (!valid(candidate, { report: true })) return false;
    const priorSelection = selection;
    const nextSelection = remapGridSelection(selection, grid, nextGrid, operation, values);
    remember(current, priorSelection);
    selection = nextSelection;
    redoStack = [];
    validationMessage = "";
    emit(candidate, { reason: "grid-layout", flush: true });
    return true;
  }
  function previewGridLayout(operation, values = {}) {
    if (drag || nudgeGesture) return { ok: false, error: 'Finish or cancel the active adjustment first.' };
    if (configWarp(current, output)?.enabled === false) return { ok: false, error: 'Correction is bypassed. Enable correction to edit geometry.' };
    const sourceWarp = configWarp(current, output);
    if (!sourceWarp?.grid) return { ok: false, error: 'The grid is unavailable.' };
    try {
      const candidate = clone(current);
      const oldGrid = candidate.outputs[output].warp.grid;
      let grid;
      let nextSelection = clone(selection);
      if (operation === 'resize') {
        const axis = values.axis;
        grid = resizeGridAxis(oldGrid, axis, Number(values.count));
      } else if (operation === 'even') {
        const axis = values.axis || (selection.kind === 'column' ? 'column' : 'row');
        const count = axis === 'column' ? oldGrid.columns : oldGrid.rows;
        grid = resizeGridAxis(oldGrid, axis, count);
      } else if (operation === 'rebuild' || operation === 'counts') {
        grid = uniformGrid(oldGrid, Number(values.columns ?? oldGrid.columns), Number(values.rows ?? oldGrid.rows));
      } else if (operation === 'move') grid = moveGridLine(oldGrid, values.axis, values.index, Number(values.position) / 100);
      else if (operation === 'add') grid = insertGridLine(oldGrid, values.axis, Number(values.position) / 100);
      else if (operation === 'remove') grid = removeGridLine(oldGrid, values.axis, values.index);
      else return { ok: false, error: 'Choose a grid layout operation.' };
      candidate.outputs[output].warp.grid = grid;
      const errors = validateProjectionConfig(candidate);
      if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0] };
      const evaluatedPreview = evaluateWarpMesh(sourceWarp.baseline?.type === 'tdMesh' ? baselineMesh : null, candidate.outputs[output].warp, { side: output, schemaVersion: candidate.schemaVersion });
      const previewHandles = (grid.rowPositions || []).flatMap((t) => (grid.columnPositions || []).map((s) => {
        const vertex = evaluatedPreview.vertices.find((point) => Math.abs(point.s - s) <= 1e-12 && Math.abs(point.t - t) <= 1e-12);
        return vertex ? { s, t, x: vertex.x, y: vertex.y } : null;
      }));
      if (previewHandles.some((point) => !point)) return { ok: false, error: 'The candidate mesh does not contain every grid knot.' };
      if (operation === 'add') {
        const axis = values.axis;
        const key = axis === 'row' ? 'rowPositions' : 'columnPositions';
        const inserted = Number(values.position) / 100;
        const index = grid[key].findIndex((position) => Math.abs(position - inserted) <= 1e-12);
        nextSelection = gridSelection(axis, index);
      } else nextSelection = remapGridSelection(selection, oldGrid, grid, operation, values);
      const comparison = compareRenderedLayouts(baselineMesh, sourceWarp, candidate.outputs[output].warp, { side: output });
      const baseWarpIdentity = JSON.stringify(sourceWarp);
      const requiresConfirmation = operation === 'remove' || operation === 'rebuild' || operation === 'counts' || comparison.maximumDifferencePx > 0.01;
      const preview = {
        ok: true, output, grid: clone(grid), selection: nextSelection, handles: previewHandles, baseWarpIdentity,
        operation, values: clone(values), comparison, requiresConfirmation,
        warning: comparison.maximumDifferencePx > 0.01 ? `Sampled layout difference: ${comparison.maximumDifferencePx.toFixed(3)} output px.` : '',
      };
      return clone(preview);
    } catch (error) {
      return { ok: false, error: error?.message || 'The grid layout is invalid.' };
    }
  }
  function commitGridLayoutPreview(preview) {
    if (!allowGeometryCommand() || !preview?.ok || preview.output !== output) return false;
    if (JSON.stringify(configWarp(current, output)) !== preview.baseWarpIdentity) {
      validationReason = 'stale_grid_preview';
      validationMessage = 'The warp changed. Preview the grid edit again.';
      return false;
    }
    const candidate = clone(current);
    candidate.outputs[output].warp.grid = clone(preview.grid);
    if (!valid(candidate, { report: true })) return false;
    remember(current, selection);
    selection = clone(preview.selection);
    redoStack = [];
    validationMessage = '';
    emit(candidate, { reason: 'grid-layout', flush: true });
    return true;
  }
  function retireGesture() { drag = null; nudgeGesture = null; validationMessage = ""; }
  function clearValidation() { validationMessage = ""; validationReason = ""; }
  function getControlPoints() {
    const warp = configWarp(current, output);
    const grid = warp?.grid || {};
    const columns = grid.columns || sideDimensions(output).columns;
    const rows = grid.rows || sideDimensions(output).rows;
    const axesX = grid.columnPositions || Array.from({ length: columns }, (_, index) => index / (columns - 1));
    const axesY = grid.rowPositions || Array.from({ length: rows }, (_, index) => index / (rows - 1));
    const regular = axesY.flatMap((t) => axesX.map((s) => ({ s, t, x: s, y: t })));
    const usesTdMesh = warp?.enabled !== false && warp?.baseline?.type === "tdMesh";
    if (usesTdMesh && !baselineMesh) return [];
    let evaluated = null;
    try { evaluated = evaluate(current); } catch { if (usesTdMesh) return []; }
    const exactKnots = current.schemaVersion === 7 || Object.hasOwn(grid, "columnPositions") || Object.hasOwn(grid, "rowPositions");
    const tolerance = exactKnots ? 1e-12 : 1e-6;
    if (usesTdMesh && exactKnots && regular.some((point) => !evaluated?.vertices?.some((candidate) => Math.abs(candidate.s - point.s) <= tolerance && Math.abs(candidate.t - point.t) <= tolerance))) return [];
    const points = regular.map((point) => {
      const match = evaluated?.vertices?.find((candidate) => Math.abs(candidate.s - point.s) <= tolerance && Math.abs(candidate.t - point.t) <= tolerance);
      return { s: point.s, t: point.t, x: match?.x ?? point.x, y: match?.y ?? point.y };
    });
    if (selection.mode !== "keystone") return points;
    // Keystone handles are the four output-plane homography controls. Grid
    // handles remain the evaluated destinations of the imported TD mesh.
    return (warp.keystone?.corners || []).map(([x, y]) => ({ s: x, t: y, x, y }));
  }
  const baselineAvailable = () => {
    const warp = configWarp(current, output);
    if (warp?.enabled === false || warp?.baseline?.type !== "tdMesh") return true;
    if (!baselineMesh) return false;
    try { evaluate(current); return true; } catch { return false; }
  };
  return {
    getConfig: () => clone(current),
    getState: () => ({ output, selection: { ...clone(selection), indices: selectedIndices() }, stepMode, dragging: Boolean(drag), adjusting: Boolean(drag || nudgeGesture), historyDepth: undoStack.length, redoDepth: redoStack.length, baselineAvailable: baselineAvailable(), validationMessage }),
    getEvaluatedMesh: () => evaluate(current),
    getControlPoints,
    select, setMode, setStep, moveByPixels, nudge, setPosition, resetSelection, resetResiduals, setEnabled, undo, redo,
    pointerStart, pointerMove, pointerEnd, pointerCancel, beginNudgeGesture, endNudgeGesture, cancelNudgeGesture, retireGesture, clearValidation, setConfig, setBaselineMesh, editGridLayout, previewGridLayout, commitGridLayoutPreview,
  };
}

export { OUTPUT_HEIGHT, OUTPUT_WIDTH, indicesFor };
