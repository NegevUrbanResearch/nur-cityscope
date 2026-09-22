import { expect, test, vi } from "vitest";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { createIdentityProjectionMesh } from "../../frontend/src/shared/projection-warp-geometry.js";
import { createWarpEditor, gridSelection, keystoneSelection } from "../../frontend/src/projection-config/warp-editor.js";

const clone = (value) => structuredClone(value);

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
