import { expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { createIdentityProjectionMesh, evaluateWarpPoint } from "../../frontend/src/shared/projection-warp-geometry.js";
import { createWarpEditor, gridSelection, keystoneSelection } from "../../frontend/src/projection-config/warp-editor.js";
import { variableTdMesh } from "../fixtures/td-variable-grid.js";

const clone = (value) => structuredClone(value);
const parityMesh = JSON.parse(readFileSync(new URL("../../../nur-io/django_api/backend/tests/fixtures/projection-grid-parity.json", import.meta.url), "utf8")).mesh;
const renderParity = JSON.parse(readFileSync(new URL("../../../nur-io/django_api/backend/tests/fixtures/projection-grid-render-parity.json", import.meta.url), "utf8"));

test.each(["left", "right"])("start fresh detaches %s from TD and preserves everything outside its warp", (output) => {
  const config = clone(DEFAULT_PROJECTION_CONFIG);
  const warp = config.outputs[output].warp;
  warp.baseline = { type: "tdMesh", assetId: "capture", sha256: "a".repeat(64), width: 1920, height: 1080, origin: "top-left" };
  warp.keystone.corners[0] = [0.04, 0.03];
  warp.grid.columnPositions[1] = 0.05;
  warp.grid.offsets[0] = [0.01, 0.02];
  const onChange = vi.fn();
  const editor = createWarpEditor({ config, output, baselineMesh: createIdentityProjectionMesh({ side: output }), onChange });
  expect(editor.startFresh()).toBe(true);
  const fresh = editor.getConfig();
  expect(fresh.outputs[output].warp.baseline).toEqual({ type: "identity", width: 1920, height: 1080, origin: "top-left" });
  expect(fresh.outputs[output].warp.keystone.corners).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
  expect(fresh.outputs[output].warp.grid.columnPositions).toEqual(Array.from({ length: warp.grid.columns }, (_, i) => i / (warp.grid.columns - 1)));
  expect(fresh.outputs[output].warp.grid.rowPositions).toEqual(Array.from({ length: warp.grid.rows }, (_, i) => i / (warp.grid.rows - 1)));
  expect(fresh.outputs[output].warp.grid.offsets.every(([x, y]) => x === 0 && y === 0)).toBe(true);
  const outside = clone(fresh); outside.outputs[output].warp = clone(warp);
  expect(outside).toEqual(config);
  expect(editor.getEvaluatedMesh().vertices.every(p => p.x === p.s && p.y === p.t)).toBe(true);
  expect(onChange).toHaveBeenLastCalledWith(fresh, expect.objectContaining({ reason: "start-fresh", flush: true }));
  expect(editor.undo()).toBe(true);
  expect(editor.getConfig()).toEqual(config);
  expect(editor.redo()).toBe(true);
  expect(editor.getConfig()).toEqual(fresh);
  expect(editor.nudge("right")).toBe(true);
});

test.each([true, false])("start fresh works without the old TD asset when warp enabled is %s", (enabled) => {
  const config = clone(DEFAULT_PROJECTION_CONFIG);
  config.outputs.left.warp.baseline = { type: "tdMesh", assetId: "missing", sha256: "a".repeat(64), width: 1920, height: 1080, origin: "top-left" };
  config.outputs.left.warp.enabled = enabled;
  const editor = createWarpEditor({ config });
  expect(editor.startFresh()).toBe(true);
  expect(editor.getConfig().outputs.left.warp).toMatchObject({ enabled: true, baseline: { type: "identity" } });
  expect(editor.getState().baselineAvailable).toBe(true);
  if (!enabled) {
    expect(editor.undo()).toBe(true);
    expect(editor.getConfig()).toEqual(config);
    expect(editor.getState().canRedo).toBe(true);
    expect(editor.redo()).toBe(true);
    expect(editor.getConfig().outputs.left.warp).toMatchObject({ enabled: true, baseline: { type: "identity" } });
  }
  expect(editor.nudge("right")).toBe(true);
});

test.each([
  ['nudge', e => e.nudge('down')], ['numeric', e => e.setPosition('x', 50)],
  ['reset', e => e.resetSelection()], ['reset all', e => e.resetResiduals()],
  ['start fresh', e => e.startFresh()],
  ['undo', e => e.undo()], ['redo', e => e.redo()],
  ['enable', e => e.setEnabled(false)], ['selection', e => e.select(gridSelection())],
  ['mode', e => e.setMode('grid')], ['step', e => e.setStep('coarse')],
  ['layout', e => e.editGridLayout('even')],
])('held drag rejects %s and retains one undo snapshot', (_label, command) => {
  const initial = clone(DEFAULT_PROJECTION_CONFIG);
  const editor = createWarpEditor({ config: initial });
  editor.pointerStart({ x: 0, y: 0 }); editor.pointerMove({ x: 12, y: 0 });
  const before = editor.getConfig();
  expect(command(editor)).toBe(false);
  expect(editor.getConfig()).toEqual(before);
  expect(editor.getState().validationMessage).toBe('Finish or cancel the active adjustment first.');
  editor.pointerMove({ x: 24, y: 0 }); editor.pointerEnd();
  expect(editor.getState().historyDepth).toBe(1);
  expect(editor.undo()).toBe(true);
  expect(editor.getConfig().outputs.left.warp).toEqual(initial.outputs.left.warp);
});

test("keystone and grid nudges use output pixels, signs, and group selection", () => {
  const changes = [];
  const editor = createWarpEditor({ config: clone(DEFAULT_PROJECTION_CONFIG), output: "left", onChange: (config, meta) => changes.push({ config, meta }) });
  editor.select(keystoneSelection("corner", 0));
  editor.nudge("right");
  expect(editor.getConfig().outputs.left.warp.keystone.corners[0][0]).toBeCloseTo(0.25 / 1920);
  editor.select(gridSelection("row", 0));
  editor.setStep("coarse");
  editor.nudge("down");
  expect(editor.getConfig().outputs.left.warp.grid.offsets.slice(0, 7).every((point) => point[1] === 1 / 1080)).toBe(true);
  expect(changes.map(({ meta }) => meta.reason)).toEqual(["nudge", "nudge"]);
});

test("per-output undo and redo preserve unrelated framing and the other output", () => {
  const editor = createWarpEditor({ config: clone(DEFAULT_PROJECTION_CONFIG), output: "left" });
  editor.nudge("right");
  const withOtherChanges = editor.getConfig();
  withOtherChanges.pre.tx = 0.12;
  withOtherChanges.outputs.right.post.ty = -0.18;
  editor.setConfig(withOtherChanges, { rebase: false });
  expect(editor.undo()).toBe(true);
  expect(editor.getConfig().pre.tx).toBeCloseTo(0.12);
  expect(editor.getConfig().outputs.right.post.ty).toBeCloseTo(-0.18);
  expect(editor.getConfig().outputs.left.warp.keystone.corners[0][0]).toBe(0);
  expect(editor.redo()).toBe(true);
  expect(editor.getConfig().pre.tx).toBeCloseTo(0.12);
  expect(editor.getConfig().outputs.right.post.ty).toBeCloseTo(-0.18);
  expect(editor.getConfig().outputs.left.warp.keystone.corners[0][0]).toBeCloseTo(0.25 / 1920);
});

test("drag coalesces history and cancel restores the previewed start", () => {
  const changes = [];
  const editor = createWarpEditor({ config: clone(DEFAULT_PROJECTION_CONFIG), output: "left", onChange: (config, meta) => changes.push({ config, meta }) });
  editor.select(gridSelection("point", 8));
  const start = editor.getConfig();
  editor.pointerStart({ x: 100, y: 100 });
  editor.pointerMove({ x: 120, y: 130 });
  editor.pointerMove({ x: 140, y: 150 });
  expect(editor.getConfig()).not.toEqual(start);
  editor.pointerCancel();
  expect(editor.getConfig()).toEqual(start);
  expect(changes.at(-1).meta).toMatchObject({ reason: "drag-cancel", flush: true });
  expect(editor.undo()).toBe(false);
  expect(editor.getConfig()).toEqual(start);
});

test.each([
  ["fine", "up", 0, -0.25], ["fine", "down", 0, 0.25], ["fine", "left", -0.25, 0], ["fine", "right", 0.25, 0],
  ["coarse", "up", 0, -1], ["coarse", "down", 0, 1], ["coarse", "left", -1, 0], ["coarse", "right", 1, 0],
])("%s %s nudge changes the selected point by output pixels", (step, direction, dx, dy) => {
  const editor = createWarpEditor({ config: clone(DEFAULT_PROJECTION_CONFIG), output: "left" });
  editor.setStep(step);
  expect(editor.nudge(direction)).toBe(true);
  const point = editor.getConfig().outputs.left.warp.keystone.corners[0];
  expect(point[0] * 1920).toBeCloseTo(dx);
  expect(point[1] * 1080).toBeCloseTo(dy);
});

test("a group nudge retains selection through undo and redo", () => {
  const editor = createWarpEditor({ config: clone(DEFAULT_PROJECTION_CONFIG), output: "left" });
  editor.select(gridSelection("row", 0)); editor.setStep("coarse");
  expect(editor.nudge("right")).toBe(true);
  expect(editor.getState().selection).toMatchObject({ kind: "row", index: 0 });
  expect(editor.getConfig().outputs.left.warp.grid.offsets.slice(0, 7).every(([x]) => x === 1 / 1920)).toBe(true);
  expect(editor.undo()).toBe(true);
  expect(editor.getConfig().outputs.left.warp.grid.offsets.slice(0, 7).every(([x]) => x === 0)).toBe(true);
  expect(editor.redo()).toBe(true);
  expect(editor.getConfig().outputs.left.warp.grid.offsets.slice(0, 7).every(([x]) => x === 1 / 1920)).toBe(true);
});

test("keystone and grid edits share the current projector history across mode switches", () => {
  const editor = createWarpEditor({ config: clone(DEFAULT_PROJECTION_CONFIG), output: "left" });
  editor.nudge("right");
  const keystoneMoved = editor.getConfig().outputs.left.warp.keystone.corners[0];
  editor.select(gridSelection("point", 0));
  editor.nudge("down");
  const gridMoved = editor.getConfig().outputs.left.warp.grid.offsets[0];
  editor.select(keystoneSelection("corner", 0));
  expect(editor.undo()).toBe(true);
  expect(editor.getConfig().outputs.left.warp.grid.offsets[0]).not.toEqual(gridMoved);
  expect(editor.getConfig().outputs.left.warp.keystone.corners[0]).toEqual(keystoneMoved);
  expect(editor.undo()).toBe(true);
  expect(editor.getConfig().outputs.left.warp.keystone.corners[0]).toEqual([0, 0]);
});

test("a zero-distance or repeated move does not publish a duplicate drag preview", () => {
  const onChange = vi.fn();
  const editor = createWarpEditor({ config: clone(DEFAULT_PROJECTION_CONFIG), output: "left", onChange });
  editor.pointerStart({ x: 100, y: 100 });
  editor.pointerMove({ x: 100, y: 100 });
  expect(onChange).not.toHaveBeenCalled();
  editor.pointerMove({ x: 110, y: 100 });
  editor.pointerMove({ x: 110, y: 100 });
  expect(onChange).toHaveBeenCalledTimes(1);
  editor.pointerEnd();
  expect(editor.getState().historyDepth).toBe(1);
});

test("group numeric position uses an anchor delta and residual reset preserves baseline", () => {
  const config = clone(DEFAULT_PROJECTION_CONFIG);
  config.outputs.right.warp.baseline = { type: "tdMesh", assetId: "mesh", sha256: "a".repeat(64), width: 1920, height: 1080, origin: "top-left" };
  config.outputs.right.warp.keystone.corners[0] = [0, 0];
  config.outputs.right.warp.grid.offsets[0] = [0, 0];
  const editor = createWarpEditor({ config, output: "right", baselineMesh: createIdentityProjectionMesh({ side: "right" }) });
  editor.select(gridSelection("column", 0));
  const before = editor.getConfig().outputs.right.warp.grid.offsets.filter((_, index) => index % 8 === 0).map((point) => point[0]);
  editor.setPosition("x", 200);
  const after = editor.getConfig().outputs.right.warp.grid.offsets.filter((_, index) => index % 8 === 0).map((point) => point[0]);
  expect(after.reduce((sum, value) => sum + value, 0) / after.length).toBeCloseTo(200 / 1920);
  after.forEach((value, index) => expect(value - after[0]).toBeCloseTo(before[index] - before[0]));
  editor.resetResiduals();
  expect(editor.getConfig().outputs.right.warp.baseline.type).toBe("tdMesh");
  expect(editor.getConfig().outputs.right.warp.keystone.corners).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
  expect(editor.getConfig().outputs.right.warp.grid.offsets.every((point) => point[0] === 0 && point[1] === 0)).toBe(true);
});

test("identity baseline uses identity geometry and missing TD assets reject edits", () => {
  const identity = clone(DEFAULT_PROJECTION_CONFIG);
  identity.outputs.left.warp.baseline = { type: "identity", width: 1920, height: 1080, origin: "top-left" };
  const editor = createWarpEditor({ config: identity, output: "left", baselineMesh: createIdentityProjectionMesh({ side: "left" }) });
  expect(editor.getControlPoints()[0]).toMatchObject({ x: 0, y: 0 });
  const td = clone(identity);
  td.outputs.left.warp.baseline = { type: "tdMesh", assetId: "mesh", sha256: "a".repeat(64), width: 1920, height: 1080, origin: "top-left" };
  const missing = createWarpEditor({ config: td, output: "left" });
  expect(missing.getControlPoints()).toEqual([]);
  expect(missing.nudge("right")).toBe(false);
});

test("keystone handles are output-plane homography controls while grid handles use evaluated TD destinations", () => {
  const config = clone(DEFAULT_PROJECTION_CONFIG);
  config.outputs.left.warp.baseline = { type: "tdMesh", assetId: "mesh", sha256: "a".repeat(64), width: 1920, height: 1080, origin: "top-left" };
  const baseline = createIdentityProjectionMesh({ side: "left" });
  baseline.vertices.forEach((point) => { point.x *= 1.1; point.y *= 0.9; });
  const editor = createWarpEditor({ config, output: "left", baselineMesh: baseline });
  expect(editor.getControlPoints()[0]).toMatchObject({ x: 0, y: 0 });
  editor.select(gridSelection("point", 0));
  expect(editor.getControlPoints()[0].x).toBeCloseTo(0);
  editor.select(keystoneSelection("corner", 0));
  editor.nudge("right");
  expect(editor.getControlPoints()[0].x).toBeCloseTo(0.25 / 1920);
});

test("inverted candidates and degenerate imported meshes reject edits", () => {
  const inverted = clone(DEFAULT_PROJECTION_CONFIG);
  inverted.outputs.left.warp.keystone.corners = [[1, 0], [0, 0], [0, 1], [1, 1]];
  const invertedEditor = createWarpEditor({ config: inverted, output: "left" });
  expect(invertedEditor.nudge("right")).toBe(false);

  const degenerateMesh = createIdentityProjectionMesh({ side: "left" });
  degenerateMesh.triangles[1] = degenerateMesh.triangles[0];
  const td = clone(DEFAULT_PROJECTION_CONFIG);
  td.outputs.left.warp.baseline = { type: "tdMesh", assetId: "mesh", sha256: "a".repeat(64), width: 1920, height: 1080, origin: "top-left" };
  const degenerateEditor = createWarpEditor({ config: td, output: "left", baselineMesh: degenerateMesh });
  expect(degenerateEditor.getControlPoints()).toEqual([]);
  expect(degenerateEditor.nudge("right")).toBe(false);
});

test("invalid candidate stays local and bounded undo/redo restores edits", () => {
  const onChange = vi.fn();
  const editor = createWarpEditor({ config: clone(DEFAULT_PROJECTION_CONFIG), output: "left", historyLimit: 2, onChange });
  editor.select(keystoneSelection("corner", 0));
  expect(editor.setPosition("x", -5000)).toBe(false);
  expect(onChange).not.toHaveBeenCalled();
  editor.nudge("right"); editor.nudge("right");
  expect(editor.undo()).toBe(true);
  expect(editor.redo()).toBe(true);
  expect(editor.getState().historyDepth).toBeLessThanOrEqual(2);
});

test("nonuniform TD grid handles match explicit-side evaluation at every source knot", () => {
  const config = clone(DEFAULT_PROJECTION_CONFIG);
  const warp = config.outputs.left.warp;
  warp.baseline = { type: "tdMesh", assetId: "fixture", sha256: "a".repeat(64), width: 1920, height: 1080, origin: "top-left" };
  warp.grid = {
    columns: 3, rows: 3, columnPositions: [0, 0.25, 1], rowPositions: [0, 0.6, 1],
    offsets: Array.from({ length: 9 }, (_, index) => [index / 100, -index / 200]),
  };
  const editor = createWarpEditor({ config, output: "left", baselineMesh: parityMesh });
  editor.setMode("grid");
  const handles = editor.getControlPoints();
  expect(handles).toHaveLength(9);
  for (let row = 0; row < 3; row += 1) for (let column = 0; column < 3; column += 1) {
    const index = row * 3 + column;
    const s = warp.grid.columnPositions[column]; const t = warp.grid.rowPositions[row];
    const [x, y] = evaluateWarpPoint(0, 0, warp, s, t, { side: "left", schemaVersion: 7, mesh: parityMesh });
    expect(handles[index]).toMatchObject({ s, t });
    expect(handles[index].x).toBeCloseTo(x, 12);
    expect(handles[index].y).toBeCloseTo(y, 12);
  }
});

test.each(["uniform", "custom"])("changed TD captures expose editable %s browser knots", (layout) => {
  const config = clone(DEFAULT_PROJECTION_CONFIG);
  const warp = config.outputs.left.warp;
  warp.baseline = { type: "tdMesh", assetId: "changed", sha256: "a".repeat(64), width: 1920, height: 1080, origin: "top-left" };
  if (layout === "custom") {
    warp.grid = { columns: 3, rows: 3, columnPositions: [0, 0.4, 1], rowPositions: [0, 0.6, 1], offsets: Array.from({ length: 9 }, () => [0, 0]) };
  } else warp.grid.offsets = warp.grid.offsets.map(() => [0, 0]);
  const editor = createWarpEditor({ config, output: "left", baselineMesh: variableTdMesh("left") });
  editor.setMode("grid");
  const count = warp.grid.columns * warp.grid.rows;
  const start = editor.getControlPoints();
  expect(start).toHaveLength(count);
  for (const t of warp.grid.rowPositions) for (const s of warp.grid.columnPositions) {
    expect(start.some((point) => Math.abs(point.s - s) <= 1e-12 && Math.abs(point.t - t) <= 1e-12)).toBe(true);
  }

  editor.select(gridSelection("point", Math.floor(count / 2)));
  expect(editor.setPosition("x", 960)).toBe(true);
  expect(editor.getControlPoints()[Math.floor(count / 2)].x).toBeCloseTo(0.5, 10);
  expect(editor.setPosition("y", 540)).toBe(true);
  expect(editor.getControlPoints()[Math.floor(count / 2)].y).toBeCloseTo(0.5, 10);
  expect(editor.undo()).toBe(true);
  expect(editor.redo()).toBe(true);

  editor.select(gridSelection("row", 1));
  expect(editor.setPosition("x", 960)).toBe(true);
  const rowStart = editor.getControlPoints().slice(warp.grid.columns, 2 * warp.grid.columns);
  expect(rowStart.reduce((sum, point) => sum + point.x, 0) / rowStart.length).toBeCloseTo(0.5, 10);
  editor.setStep("fine");
  expect(editor.nudge("right")).toBe(true);
  expect(editor.nudge("right", { coarse: true })).toBe(true);
  const rowMoved = editor.getControlPoints().slice(warp.grid.columns, 2 * warp.grid.columns);
  expect(rowMoved.reduce((sum, point) => sum + point.x, 0) / rowMoved.length).toBeCloseTo(0.5 + 1.25 / 1920, 9);

  editor.select(gridSelection("point", Math.floor(count / 2)));
  const beforeDrag = editor.getControlPoints()[Math.floor(count / 2)];
  expect(editor.pointerStart({ x: 100, y: 100 })).toBe(true);
  expect(editor.pointerMove({ x: 101, y: 101 })).toBe(true);
  expect(editor.pointerEnd()).toBe(true);
  const afterDrag = editor.getControlPoints()[Math.floor(count / 2)];
  expect(afterDrag.x - beforeDrag.x).toBeCloseTo(1 / 1920, 9);
  expect(afterDrag.y - beforeDrag.y).toBeCloseTo(1 / 1080, 9);
  expect(editor.undo()).toBe(true);
  expect(editor.redo()).toBe(true);

  expect(editor.resetResiduals()).toBe(true);
  expect(editor.getConfig().outputs.left.warp.grid.offsets.every(([x, y]) => x === 0 && y === 0)).toBe(true);
  expect(editor.getControlPoints()).toEqual(start);
});

test.each([["left", 49], ["right", 56]])("changed %s TD capture exposes all %i default browser handles", (side, count) => {
  const config = clone(DEFAULT_PROJECTION_CONFIG);
  const warp = config.outputs[side].warp;
  warp.baseline = { type: "tdMesh", assetId: "changed", sha256: "a".repeat(64), width: 1920, height: 1080, origin: "top-left" };
  warp.grid.offsets = warp.grid.offsets.map(() => [0, 0]);
  const editor = createWarpEditor({ config, output: side, baselineMesh: variableTdMesh(side) });
  editor.setMode("grid");
  expect(editor.getControlPoints()).toHaveLength(count);
});

test.each(["left", "right"])("dense accepted %s capture remains responsive to grid edits", (side) => {
  const baselineMesh = JSON.parse(readFileSync(new URL(`../../public/projection-calibration/td-baselines/${side}.json`, import.meta.url), "utf8"));
  const config = clone(DEFAULT_PROJECTION_CONFIG);
  const warp = config.outputs[side].warp;
  warp.baseline = { type: "tdMesh", assetId: `accepted-${side}`, sha256: "a".repeat(64), width: 1920, height: 1080, origin: "top-left" };
  warp.grid.offsets = warp.grid.offsets.map(() => [0, 0]);
  const editor = createWarpEditor({ config, output: side, baselineMesh });
  editor.setMode("grid");
  const count = warp.grid.columns * warp.grid.rows;
  expect(editor.getControlPoints()).toHaveLength(count);
  const index = Math.floor(count / 2);
  editor.select(gridSelection("point", index));
  const beforeNudge = editor.getControlPoints()[index];
  expect(editor.nudge("right", { coarse: true })).toBe(true);
  const afterNudge = editor.getControlPoints()[index];
  expect(afterNudge.x - beforeNudge.x).toBeCloseTo(1 / 1920, 9);
  expect(editor.undo()).toBe(true);
  expect(editor.redo()).toBe(true);

  const beforeDrag = editor.getControlPoints()[index];
  expect(editor.pointerStart({ x: 100, y: 100 })).toBe(true);
  expect(editor.pointerMove({ x: 101, y: 100.25 })).toBe(true);
  expect(editor.pointerEnd()).toBe(true);
  const afterDrag = editor.getControlPoints()[index];
  expect(afterDrag.x - beforeDrag.x).toBeCloseTo(1 / 1920, 9);
  expect(afterDrag.y - beforeDrag.y).toBeCloseTo(0.25 / 1080, 9);
});

test("close custom TD knots keep distinct exact destinations instead of matching a nearby source vertex", () => {
  const config = clone(DEFAULT_PROJECTION_CONFIG);
  const warp = config.outputs.left.warp;
  warp.baseline = { type: "tdMesh", assetId: "fixture", sha256: "a".repeat(64), width: 1920, height: 1080, origin: "top-left" };
  warp.grid = {
    columns: 4, rows: 3, columnPositions: [0, 0.0000005, 0.0000011, 1], rowPositions: [0, 0.5, 1],
    offsets: Array.from({ length: 12 }, (_, index) => [index % 4 === 1 ? 0.01 : index % 4 === 2 ? 0.04 : 0, 0]),
  };
  const editor = createWarpEditor({ config, output: "left", baselineMesh: parityMesh }); editor.setMode("grid");
  const handles = editor.getControlPoints();
  expect(handles).toHaveLength(12);
  for (const column of [1, 2]) {
    const index = column;
    const s = warp.grid.columnPositions[column], t = 0;
    const [x, y] = evaluateWarpPoint(0, 0, warp, s, t, { side: "left", schemaVersion: 7, mesh: parityMesh });
    expect(handles[index].s).toBe(s);
    expect(handles[index].x).toBeCloseTo(x, 12);
    expect(handles[index].y).toBeCloseTo(y, 12);
  }
  expect(handles[1].x).not.toBe(handles[2].x);
});

test("selection history restores a topology edit on both outputs", () => {
  for (const output of ["left", "right"]) {
    const config = clone(DEFAULT_PROJECTION_CONFIG); const editor = createWarpEditor({ config, output });
    editor.setMode("grid"); editor.select(gridSelection("row", 6));
    const before = editor.getConfig().outputs[output].warp.grid;
    expect(editor.editGridLayout("counts", { columns: 3, rows: 3 })).toBe(true);
    expect(editor.getState().selection).toMatchObject({ kind: "row", index: 2 });
    expect(editor.undo()).toBe(true);
    expect(editor.getConfig().outputs[output].warp.grid).toEqual(before);
    expect(editor.getState().selection).toMatchObject({ kind: "row", index: 6 });
    expect(editor.redo()).toBe(true);
    expect(editor.getState().selection).toMatchObject({ kind: "row", index: 2 });
  }
});

test("direct grid count edit commits once and undo/redo restore topology with selection", () => {
  const onChange = vi.fn();
  const config = clone(DEFAULT_PROJECTION_CONFIG);
  const editor = createWarpEditor({ config, output: "left", onChange });
  editor.select(gridSelection("row", 6));
  const before = editor.getConfig().outputs.left.warp.grid;
  expect(editor.editGridLayout("counts", { columns: 5, rows: 3 })).toBe(true);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ reason: "grid-layout", flush: true }));
  expect(editor.getConfig().outputs.left.warp.grid).toMatchObject({ columns: 5, rows: 3, columnPositions: [0, 0.25, 0.5, 0.75, 1], rowPositions: [0, 0.5, 1] });
  expect(editor.getState().selection).toMatchObject({ mode: "grid", kind: "row", index: 2 });
  expect(editor.getState().historyDepth).toBe(1);
  expect(editor.undo()).toBe(true);
  expect(editor.getConfig().outputs.left.warp.grid).toEqual(before);
  expect(editor.getState().selection).toMatchObject({ mode: "grid", kind: "row", index: 6 });
  expect(editor.redo()).toBe(true);
  expect(editor.getConfig().outputs.left.warp.grid.rows).toBe(3);
  expect(editor.getState().selection).toMatchObject({ mode: "grid", kind: "row", index: 2 });
});

test("invalid direct grid edits keep config, selection, history, and notifications unchanged", () => {
  const onChange = vi.fn();
  const editor = createWarpEditor({ config: clone(DEFAULT_PROJECTION_CONFIG), output: "left", onChange });
  editor.setMode("grid"); editor.select(gridSelection("column", 2));
  const before = editor.getConfig(); const selection = editor.getState().selection;
  expect(editor.editGridLayout("move", { axis: "column", index: 1, position: 100 })).toBe(false);
  expect(editor.getConfig()).toEqual(before);
  expect(editor.getState().selection).toEqual(selection);
  expect(editor.getState().historyDepth).toBe(0);
  expect(onChange).not.toHaveBeenCalled();
});

test("source, add, remove, and even edits each commit one undoable topology change", () => {
  const config = clone(DEFAULT_PROJECTION_CONFIG);
  config.outputs.left.warp.grid.columnPositions = [0, 0.1, 0.32, 0.51, 0.75, 0.9, 1];
  config.outputs.left.warp.grid.rowPositions = [0, 0.12, 0.28, 0.5, 0.7, 0.88, 1];
  const changes = vi.fn();
  const editor = createWarpEditor({ config, output: "left", onChange: changes }); editor.setMode("grid");
  editor.select(gridSelection("row", 2));
  const beforeMove = editor.getConfig().outputs.left.warp.grid;
  changes.mockClear();
  expect(editor.editGridLayout("move", { axis: "row", index: 2, position: 31 })).toBe(true);
  expect(changes).toHaveBeenCalledTimes(1); expect(changes.mock.calls[0][1]).toMatchObject({ reason: "grid-layout", flush: true });
  expect(editor.getConfig().outputs.left.warp.grid.rowPositions[2]).toBeCloseTo(0.31);
  expect(editor.undo()).toBe(true);
  expect(editor.getConfig().outputs.left.warp.grid).toEqual(beforeMove);
  const beforeAdd = editor.getConfig().outputs.left.warp.grid;
  changes.mockClear();
  expect(editor.editGridLayout("add", { axis: "column", position: 40 })).toBe(true);
  expect(changes).toHaveBeenCalledTimes(1);
  expect(editor.getConfig().outputs.left.warp.grid.columns).toBe(8);
  expect(editor.undo()).toBe(true);
  expect(editor.getConfig().outputs.left.warp.grid).toEqual(beforeAdd);
  const beforeRemove = editor.getConfig().outputs.left.warp.grid;
  changes.mockClear();
  expect(editor.editGridLayout("remove", { axis: "row", index: 2 })).toBe(true);
  expect(changes).toHaveBeenCalledTimes(1);
  expect(editor.getConfig().outputs.left.warp.grid.rows).toBe(6);
  expect(editor.undo()).toBe(true);
  expect(editor.getConfig().outputs.left.warp.grid).toEqual(beforeRemove);
  const beforeEven = editor.getConfig().outputs.left.warp.grid;
  changes.mockClear();
  expect(editor.editGridLayout("even", {})).toBe(true);
  expect(changes).toHaveBeenCalledTimes(1);
  expect(editor.getConfig().outputs.left.warp.grid.rowPositions).toEqual([0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1]);
  expect(editor.undo()).toBe(true);
  expect(editor.getConfig().outputs.left.warp.grid).toEqual(beforeEven);
});

test("residual reset clears offsets while retaining source axes and group selection", () => {
  const config = clone(DEFAULT_PROJECTION_CONFIG);
  config.outputs.left.warp.grid.columnPositions = [0, 0.2, 0.45, 0.7, 0.85, 0.95, 1];
  config.outputs.left.warp.grid.rowPositions = [0, 0.15, 0.3, 0.55, 0.75, 0.9, 1];
  config.outputs.left.warp.grid.offsets[8] = [0.01, -0.02];
  const editor = createWarpEditor({ config, output: "left" }); editor.setMode("grid"); editor.select(gridSelection("row", 2));
  expect(editor.resetResiduals()).toBe(true);
  expect(editor.getConfig().outputs.left.warp.grid.columnPositions).toEqual(config.outputs.left.warp.grid.columnPositions);
  expect(editor.getConfig().outputs.left.warp.grid.rowPositions).toEqual(config.outputs.left.warp.grid.rowPositions);
  expect(editor.getConfig().outputs.left.warp.grid.offsets.every(([x, y]) => x === 0 && y === 0)).toBe(true);
  expect(editor.getState().selection).toMatchObject({ kind: "row", index: 2 });
});

test("group mean positioning uses evaluated anchors and retains custom axes and keystone", () => {
  const config = clone(DEFAULT_PROJECTION_CONFIG);
  const warp = config.outputs.left.warp;
  warp.grid.columnPositions = [0, 0.2, 0.45, 0.7, 0.85, 0.95, 1];
  warp.grid.rowPositions = [0, 0.15, 0.3, 0.55, 0.75, 0.9, 1];
  const beforeKeystone = clone(warp.keystone.corners);
  const editor = createWarpEditor({ config, output: "left" }); editor.setMode("grid"); editor.select(gridSelection("row", 2));
  expect(editor.setPosition("x", 500)).toBe(true);
  const selected = editor.getControlPoints().slice(14, 21);
  expect(selected.reduce((sum, point) => sum + point.x, 0) / selected.length).toBeCloseTo(500 / 1920, 12);
  expect(editor.getConfig().outputs.left.warp.grid.columnPositions).toEqual(warp.grid.columnPositions);
  expect(editor.getConfig().outputs.left.warp.grid.rowPositions).toEqual(warp.grid.rowPositions);
  expect(editor.getConfig().outputs.left.warp.keystone.corners).toEqual(beforeKeystone);
});

test("an active pointer gesture rejects topology edits until the old gesture ends or cancels", () => {
  for (const moved of [false, true]) {
    const onChange = vi.fn();
    const editor = createWarpEditor({ config: clone(DEFAULT_PROJECTION_CONFIG), output: "left", onChange });
    editor.setMode("grid"); editor.select(gridSelection("point", 0));
    const initial = editor.getConfig().outputs.left.warp.grid;
    expect(editor.pointerStart({ x: 0, y: 0 })).toBe(true);
    if (moved) expect(editor.pointerMove({ x: 8, y: 0 })).toBe(true);
    const activeGrid = editor.getConfig().outputs.left.warp.grid;
    onChange.mockClear();
    const selection = editor.getState().selection;
    expect(editor.editGridLayout("counts", { columns: 3, rows: 3 })).toBe(false);
    expect(editor.getConfig().outputs.left.warp.grid).toEqual(activeGrid);
    expect(editor.getState()).toMatchObject({ dragging: true, historyDepth: 0, selection });
    expect(editor.getState().validationMessage).toContain("active adjustment");
    expect(onChange).not.toHaveBeenCalled();
    if (moved) expect(editor.pointerCancel()).toBe(true);
    else expect(editor.pointerEnd()).toBe(true);
    expect(editor.getConfig().outputs.left.warp.grid).toEqual(initial);
    expect(editor.getState().dragging).toBe(false);
    expect(editor.editGridLayout("counts", { columns: 3, rows: 3 })).toBe(true);
    expect(editor.getConfig().outputs.left.warp.grid).toMatchObject({ columns: 3, rows: 3 });
    const accepted = clone(editor.getConfig().outputs.left.warp.grid);
    expect(editor.pointerMove({ x: 20, y: 0 })).toBe(false);
    expect(editor.pointerEnd()).toBe(false);
    expect(editor.pointerCancel()).toBe(false);
    expect(editor.getConfig().outputs.left.warp.grid).toEqual(accepted);
    expect(editor.getState().historyDepth).toBe(1);
  }
});

test("grid previews stay side-effect free and confirmation merges the latest non-warp draft", () => {
  const changes = vi.fn();
  const config = clone(DEFAULT_PROJECTION_CONFIG);
  config.outputs.left.warp.baseline = { type: "identity", width: 1920, height: 1080, origin: "top-left" };
  const editor = createWarpEditor({ config, output: "left", onChange: changes });
  editor.setMode("grid"); editor.select(gridSelection("column", 2));
  const before = editor.getConfig();
  const preview = editor.previewGridLayout("remove", { axis: "column", index: 2 });
  expect(preview).toMatchObject({ ok: true, selection: { mode: "grid", kind: "column", index: 1 }, requiresConfirmation: true });
  expect(preview.grid.columns).toBe(6);
  expect(editor.getConfig()).toEqual(before);
  expect(editor.getState().historyDepth).toBe(0);
  expect(changes).not.toHaveBeenCalled();

  const latest = editor.getConfig(); latest.pre.scale = 1.5;
  expect(editor.setConfig(latest, { rebase: false })).toBe(true);
  expect(editor.commitGridLayoutPreview(preview)).toBe(true);
  expect(editor.getConfig().pre.scale).toBe(1.5);
  expect(editor.getConfig().outputs.left.warp.grid.columns).toBe(6);
  expect(editor.getState().historyDepth).toBe(1);
  expect(changes).toHaveBeenCalledTimes(1);
  expect(editor.undo()).toBe(true);
  expect(editor.getConfig().outputs.left.warp.grid.columns).toBe(7);
});

test("stale grid previews are rejected after the warp changes", () => {
  const editor = createWarpEditor({ config: clone(DEFAULT_PROJECTION_CONFIG), output: "left" });
  const preview = editor.previewGridLayout("remove", { axis: "row", index: 2 });
  const changed = editor.getConfig(); changed.outputs.left.warp.keystone.corners[0][0] = 0.01;
  editor.setConfig(changed, { rebase: false });
  expect(editor.commitGridLayoutPreview(preview)).toBe(false);
  expect(editor.getConfig().outputs.left.warp.grid.rows).toBe(7);
  expect(editor.getState().historyDepth).toBe(0);
});

test("insert preview selects the new line and warns on the existing sampled layout comparison", () => {
  const config = clone(DEFAULT_PROJECTION_CONFIG);
  config.outputs.left.warp.baseline = clone(renderParity.warp.baseline);
  config.outputs.left.warp.grid = clone(renderParity.warp.grid);
  config.outputs.left.warp.grid.offsets[4] = [.01, .005];
  const editor = createWarpEditor({ config, output: "left", baselineMesh: renderParity.mesh });
  editor.setMode("grid"); editor.select(gridSelection("row", 1));
  const inserted = editor.previewGridLayout("add", { axis: "row", position: 45 });
  expect(inserted).toMatchObject({ ok: true, selection: { mode: "grid", kind: "row", index: 1 }, grid: { rows: 4 } });
  expect(inserted.baseWarpIdentity).toBe(JSON.stringify(config.outputs.left.warp));
  const moved = editor.previewGridLayout("move", { axis: "column", index: 1, position: 52 });
  expect(moved.ok).toBe(true);
  expect(moved.comparison).toMatchObject({ comparison: "sampled-only" });
  expect(moved.comparison.maximumDifferencePx).toBeGreaterThan(.01);
  expect(moved.warning).toContain("Sampled layout difference");
  expect(moved.requiresConfirmation).toBe(true);
});

test("a held nudge accumulates from its captured warp and records once on end", () => {
  const changes = [];
  const editor = createWarpEditor({ config: clone(DEFAULT_PROJECTION_CONFIG), onChange: (config, meta) => changes.push({ config, meta }) });
  const start = editor.getConfig();
  expect(editor.beginNudgeGesture()).toBe(true);
  expect(editor.getState()).toMatchObject({ adjusting: true, dragging: false });
  expect(editor.nudge("right")).toBe(true);
  expect(editor.nudge("right")).toBe(true);
  expect(editor.select(gridSelection("point", 3))).toBe(false);
  expect(editor.getState().historyDepth).toBe(0);
  expect(editor.endNudgeGesture()).toBe(true);
  expect(editor.endNudgeGesture()).toBe(false);
  expect(editor.getState()).toMatchObject({ adjusting: false, historyDepth: 1 });
  expect(changes.map(({ meta }) => meta.reason)).toEqual(["nudge", "nudge", "nudge-end"]);
  expect(editor.undo()).toBe(true);
  expect(editor.getConfig().outputs.left.warp).toEqual(start.outputs.left.warp);
});

test("canceling a held nudge restores its capture without adding history", () => {
  const changes = [];
  const editor = createWarpEditor({ config: clone(DEFAULT_PROJECTION_CONFIG), onChange: (config, meta) => changes.push(meta) });
  const start = editor.getConfig();
  editor.beginNudgeGesture();
  editor.nudge("down");
  expect(editor.cancelNudgeGesture()).toBe(true);
  expect(editor.getConfig().outputs.left.warp).toEqual(start.outputs.left.warp);
  expect(editor.getState()).toMatchObject({ adjusting: false, historyDepth: 0 });
  expect(changes.at(-1)).toMatchObject({ reason: "nudge-cancel", flush: true });
});

test("retiring a gesture before foreign rebase emits no rollback and rejects later movement", () => {
  const changed = vi.fn();
  const editor = createWarpEditor({ config: clone(DEFAULT_PROJECTION_CONFIG), onChange: changed });
  editor.pointerStart({ x: 0, y: 0 });
  editor.pointerMove({ x: 10, y: 0 });
  changed.mockClear();
  expect(editor.retireGesture()).toBeUndefined();
  const foreignConfig = clone(DEFAULT_PROJECTION_CONFIG);
  foreignConfig.outputs.left.warp.keystone.corners[0][0] = 0.02;
  expect(editor.setConfig(foreignConfig, { rebase: true })).toBe(true);
  expect(changed).not.toHaveBeenCalled();
  expect(editor.pointerMove({ x: 20, y: 0 })).toBe(false);
  expect(editor.getConfig().outputs.left.warp.keystone.corners[0][0]).toBe(0.02);
});

test("own acknowledgment without rebase retains the drag and creates one Undo entry", () => {
  const config = clone(DEFAULT_PROJECTION_CONFIG);
  const editor = createWarpEditor({ config });
  expect(editor.pointerStart({ x: 0, y: 0 })).toBe(true);
  expect(editor.pointerMove({ x: 10, y: 0 })).toBe(true);
  const acknowledged = editor.getConfig();
  expect(editor.setConfig(acknowledged, { rebase: false })).toBe(true);
  expect(editor.getState().dragging).toBe(true);
  expect(editor.pointerMove({ x: 20, y: 0 })).toBe(true);
  expect(editor.pointerEnd()).toBe(true);
  expect(editor.getState().historyDepth).toBe(1);
  expect(editor.undo()).toBe(true);
  expect(editor.getConfig().outputs.left.warp).toEqual(config.outputs.left.warp);
});

test("disabled correction blocks geometry edits but keeps selection and explicit enable available", () => {
  const onChange = vi.fn();
  const config = clone(DEFAULT_PROJECTION_CONFIG);
  config.outputs.left.warp.enabled = false;
  config.outputs.left.warp.keystone.corners[0] = [0.03, 0.02];
  const editor = createWarpEditor({ config, onChange });
  const before = editor.getConfig();
  expect(editor.select(gridSelection("point", 4))).toBe(true);
  expect(editor.getState().selection).toMatchObject({ mode: "grid", kind: "point", index: 4 });
  expect(editor.nudge("right")).toBe(false);
  expect(editor.setPosition("x", 600)).toBe(false);
  expect(editor.resetSelection()).toBe(false);
  expect(editor.resetResiduals()).toBe(false);
  expect(editor.editGridLayout("counts", { columns: 3, rows: 3 })).toBe(false);
  expect(editor.pointerStart({ x: 0, y: 0 })).toBe(false);
  expect(editor.getConfig().outputs.left.warp.keystone.corners[0]).toEqual([0.03, 0.02]);
  expect(editor.getConfig().outputs.left.warp.grid).toEqual(before.outputs.left.warp.grid);
  expect(onChange).not.toHaveBeenCalled();
  expect(editor.setEnabled(true)).toBe(true);
  expect(onChange).toHaveBeenCalledOnce();
  expect(editor.getConfig().outputs.left.warp.enabled).toBe(true);
});

test("an invalid warp move preserves the last valid geometry and reports why it was rejected", () => {
  const editor = createWarpEditor({ config: clone(DEFAULT_PROJECTION_CONFIG), output: "left" });
  const before = editor.getConfig();
  editor.select(keystoneSelection("corner", 0));
  expect(editor.setPosition("x", -5000)).toBe(false);
  expect(editor.getConfig()).toEqual(before);
  expect(editor.getState().validationMessage).toMatch(/^Move rejected: .+/);
});

test("undo, redo, authoritative rebase, and drag cancellation clear stale rejection feedback", () => {
  const editor = createWarpEditor({ config: clone(DEFAULT_PROJECTION_CONFIG), output: "left" });
  editor.nudge("right");
  editor.setPosition("x", -5000);
  expect(editor.getState().validationMessage).toMatch(/^Move rejected:/);
  expect(editor.undo()).toBe(true);
  expect(editor.getState().validationMessage).toBe("");
  editor.setPosition("x", -5000);
  expect(editor.redo()).toBe(true);
  expect(editor.getState().validationMessage).toBe("");
  editor.setPosition("x", -5000);
  expect(editor.getState().validationMessage).toMatch(/^Move rejected:/);
  expect(editor.setConfig(editor.getConfig(), { rebase: true })).toBe(true);
  expect(editor.getState().validationMessage).toBe("");
  editor.setPosition("x", -5000);
  expect(editor.pointerCancel()).toBe(false);
  expect(editor.getState().validationMessage).toBe("");
  editor.setPosition("x", -5000);
  editor.pointerStart({ x: 0, y: 0 });
  editor.pointerMove({ x: 10000, y: 0 });
  expect(editor.getState().validationMessage).toMatch(/^Move rejected:/);
  expect(editor.pointerCancel()).toBe(true);
  expect(editor.getState().validationMessage).toBe("");
});
