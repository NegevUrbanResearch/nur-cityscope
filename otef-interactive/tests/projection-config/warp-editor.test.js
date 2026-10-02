import { expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { createIdentityProjectionMesh, evaluateWarpPoint } from "../../frontend/src/shared/projection-warp-geometry.js";
import { createWarpEditor, gridSelection, keystoneSelection } from "../../frontend/src/projection-config/warp-editor.js";

const clone = (value) => structuredClone(value);
const parityMesh = JSON.parse(readFileSync(new URL("../../../nur-io/django_api/backend/tests/fixtures/projection-grid-parity.json", import.meta.url), "utf8")).mesh;

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
    expect(editor.getState().validationMessage).toContain("active pointer gesture");
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
