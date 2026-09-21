import { validateProjectionConfig } from "../shared/projection-config-schema.js";
import { evaluateWarpMesh } from "../shared/projection-warp-geometry.js";

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
} = {}) {
  if (!config?.outputs?.[output]?.warp) throw new Error(`warp editor requires ${output} warp config`);
  let current = clone(config);
  let selection = keystoneSelection("corner", 0);
  let stepMode = "fine";
  let undoStack = [];
  let redoStack = [];
  let drag = null;

  const step = () => stepMode === "coarse" ? 1 : 0.25;
  const selectedIndices = () => indicesFor(selection, configWarp(current, output));
  const emit = (candidate, meta) => { current = candidate; onChange(clone(candidate), { ...meta, selection: clone(selection) }); };
  const valid = (candidate, { semantic = true } = {}) => {
    try {
      if (!validateCandidate(candidate)) return false;
      if (!semantic) return true;
      const warp = configWarp(candidate, output);
      if (warp?.enabled === false || warp?.baseline?.type === "identity") {
        evaluateWarpMesh(null, warp);
        return true;
      }
      if (warp?.baseline?.type !== "tdMesh" || !baselineMesh) return false;
      evaluateWarpMesh(baselineMesh, warp);
      return true;
    } catch { return false; }
  };
  const remember = (snapshot) => {
    undoStack.push(clone(configWarp(snapshot, output)));
    if (undoStack.length > historyLimit) undoStack.splice(0, undoStack.length - historyLimit);
    redoStack = [];
  };
  const apply = (candidate, meta = {}, { record = true } = {}) => {
    if (!valid(candidate)) return false;
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
    emit(candidate, { reason, flush });
    return true;
  };

  function select(next) {
    if (!next || !["keystone", "grid"].includes(next.mode)) return false;
    selection = clone(next);
    return true;
  }
  function setMode(mode) { return select(mode === "grid" ? gridSelection() : keystoneSelection()); }
  function setStep(mode) { if (!["fine", "coarse"].includes(mode)) return false; stepMode = mode; return true; }
  function moveByPixels(dx, dy, meta = {}) {
    return moveNormalized(Number(dx) / OUTPUT_WIDTH, Number(dy) / OUTPUT_HEIGHT, { reason: meta.reason || "nudge", flush: meta.flush ?? true }, { record: meta.record !== false });
  }
  function nudge(direction, options = {}) {
    const amount = options.coarse === true ? 1 : options.fine === true ? 0.25 : step();
    const vectors = { up: [0, -amount], down: [0, amount], left: [-amount, 0], right: [amount, 0] };
    const vector = vectors[direction];
    if (!vector) return false;
    return moveByPixels(vector[0], vector[1], { reason: "nudge", flush: true });
  }
  function setPosition(axis, pixels) {
    if (!["x", "y"].includes(axis) || !Number.isFinite(Number(pixels))) return false;
    const target = Number(pixels) / (axis === "x" ? OUTPUT_WIDTH : OUTPUT_HEIGHT);
    const anchor = selectedMean(axis);
    if (!Number.isFinite(anchor)) return false;
    return moveNormalized(axis === "x" ? target - anchor : 0, axis === "y" ? target - anchor : 0, { reason: "numeric", flush: true });
  }
  function resetSelection() { return apply(resetToIdentity(true), { reason: "reset-selection", flush: true }); }
  function resetResiduals() { return apply(resetToIdentity(false), { reason: "reset-residuals", flush: true }); }
  function setEnabled(enabled) { const candidate = clone(current); candidate.outputs[output].warp.enabled = Boolean(enabled); return apply(candidate, { reason: "warp-enabled", flush: true }); }
  function undo() {
    if (!undoStack.length) return false;
    redoStack.push(clone(configWarp(current, output)));
    return restoreWarp(undoStack.pop(), "undo");
  }
  function redo() {
    if (!redoStack.length) return false;
    undoStack.push(clone(configWarp(current, output)));
    return restoreWarp(redoStack.pop(), "redo");
  }
  function pointerStart(point) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    drag = { startWarp: clone(configWarp(current, output)), x: point.x, y: point.y, moved: false };
    return true;
  }
  function pointerMove(point) {
    if (!drag || !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    const dx = (point.x - drag.x) / OUTPUT_WIDTH;
    const dy = (point.y - drag.y) / OUTPUT_HEIGHT;
    const candidate = clone(current);
    candidate.outputs[output].warp = clone(drag.startWarp);
    const points = pointsForSelection(candidate, output, selection);
    const indices = selectedIndices();
    for (const index of indices) { points[index][0] += dx; points[index][1] += dy; }
    if (!valid(candidate)) return false;
    drag.moved = drag.moved || dx !== 0 || dy !== 0;
    emit(candidate, { reason: "drag", flush: false });
    return true;
  }
  function pointerEnd() {
    if (!drag) return false;
    if (drag.moved) { undoStack.push(clone(drag.startWarp)); if (undoStack.length > historyLimit) undoStack.splice(0, undoStack.length - historyLimit); redoStack = []; onChange(clone(current), { reason: "drag-end", flush: true, selection: clone(selection) }); }
    drag = null;
    return true;
  }
  function pointerCancel() {
    if (!drag) return false;
    const shouldFlush = drag.moved;
    const start = drag.startWarp;
    drag = null;
    if (shouldFlush) restoreWarp(start, "drag-cancel", true);
    return true;
  }
  function setConfig(next, { rebase = true } = {}) {
    if (!valid(next, { semantic: false })) return false;
    current = clone(next);
    if (rebase) { undoStack = []; redoStack = []; drag = null; }
    return true;
  }
  function setBaselineMesh(next) { baselineMesh = next ? clone(next) : null; return true; }
  function getControlPoints() {
    const warp = configWarp(current, output);
    const dimensions = sideDimensions(output);
    const regular = Array.from({ length: dimensions.columns * dimensions.rows }, (_, index) => ({ s: (index % dimensions.columns) / (dimensions.columns - 1), t: Math.floor(index / dimensions.columns) / (dimensions.rows - 1), x: (index % dimensions.columns) / (dimensions.columns - 1), y: Math.floor(index / dimensions.columns) / (dimensions.rows - 1) }));
    const usesTdMesh = warp?.enabled !== false && warp?.baseline?.type === "tdMesh";
    if (usesTdMesh && !baselineMesh) return [];
    let evaluated = null;
    try { evaluated = evaluateWarpMesh(usesTdMesh ? baselineMesh : null, warp); } catch { if (usesTdMesh) return []; }
    const points = regular.map((point) => {
      const match = evaluated?.vertices?.find((candidate) => Math.abs(candidate.s - point.s) < 1e-6 && Math.abs(candidate.t - point.t) < 1e-6);
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
    try { evaluateWarpMesh(baselineMesh, warp); return true; } catch { return false; }
  };
  return {
    getConfig: () => clone(current),
    getState: () => ({ output, selection: { ...clone(selection), indices: selectedIndices() }, stepMode, dragging: Boolean(drag), historyDepth: undoStack.length, redoDepth: redoStack.length, baselineAvailable: baselineAvailable() }),
    getControlPoints,
    select, setMode, setStep, moveByPixels, nudge, setPosition, resetSelection, resetResiduals, setEnabled, undo, redo,
    pointerStart, pointerMove, pointerEnd, pointerCancel, setConfig, setBaselineMesh,
  };
}

export { OUTPUT_HEIGHT, OUTPUT_WIDTH, indicesFor };
