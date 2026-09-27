import { expect, test, vi } from "vitest";
import { bindWarpPointerInput } from "../../frontend/src/projection-config/warp-pointer-input.js";
import { fitWarpViewport, warpPointFromClient } from "../../frontend/src/projection-config/warp-viewport.js";
import { createWarpEditor, gridSelection } from "../../frontend/src/projection-config/warp-editor.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";

function fixture({ handles = [{ x: 0.25, y: 0.25 }], selection = { mode: "grid", kind: "point", index: 0, indices: [0] }, rect = { left: 0, top: 0, width: 960, height: 540 }, viewBox = { x: 0, y: 0, width: 1920, height: 1080 } } = {}) {
  const listeners = new Map();
  const surface = {
    ownerDocument: { visibilityState: "visible", addEventListener(type, callback) { listeners.set(`doc:${type}`, callback); }, removeEventListener(type) { listeners.delete(`doc:${type}`); }, defaultView: { addEventListener(type, callback) { listeners.set(`win:${type}`, callback); }, removeEventListener(type) { listeners.delete(`win:${type}`); } } },
    addEventListener(type, callback) { listeners.set(type, callback); }, removeEventListener(type) { listeners.delete(type); },
    setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), focus: vi.fn(),
  };
  const calls = { select: vi.fn(), start: vi.fn(), move: vi.fn(), end: vi.fn(), cancel: vi.fn() };
  const geometry = { rect, viewBox, handles, selection, side: "left", mode: selection.mode };
  const binder = bindWarpPointerInput({ surface, readGeometry: () => geometry, onSelect: calls.select, onStart: calls.start, onMove: calls.move, onEnd: calls.end, onCancel: calls.cancel });
  const fire = (type, event = {}) => listeners.get(type)?.({ pointerId: 1, isPrimary: true, button: 0, clientX: 240, clientY: 135, preventDefault: vi.fn(), ...event });
  return { surface, calls, geometry, binder, fire };
}

test("maps a client displacement through the shared viewport fit", () => {
  const rect = { left: 0, top: 0, width: 960, height: 540 };
  const viewBox = { x: 0, y: 0, width: 1920, height: 1080 };
  expect(warpPointFromClient({ clientX: 110, clientY: 100 }, rect, viewBox).x - warpPointFromClient({ clientX: 100, clientY: 100 }, rect, viewBox).x).toBe(20);
  expect(fitWarpViewport({ x: -240, y: -90, width: 2400, height: 1260 }, 1200, 700).image.left).toBe(120);
});

test("freezes dimensions from a DOMRect with prototype getters", () => {
  const rect = Object.create({ left: 0, top: 0, width: 960, height: 540 });
  const f = fixture({ rect });
  f.fire("pointerdown");
  f.fire("pointermove", { clientX: 250 });
  expect(f.calls.move).toHaveBeenCalledWith(expect.objectContaining({ x: 500 }));
  f.binder.dispose();
});

test("captures one primary pointer and freezes geometry and origin side", () => {
  const f = fixture();
  f.fire("pointerdown");
  expect(f.surface.setPointerCapture).toHaveBeenCalledWith(1);
  f.fire("pointerdown", { pointerId: 2 });
  f.fire("pointermove", { pointerId: 2, clientX: 250 });
  f.geometry.rect.width = 480; f.geometry.side = "right";
  f.fire("pointermove", { clientX: 250 });
  expect(f.calls.start).toHaveBeenCalledTimes(1);
  expect(f.calls.move).toHaveBeenCalledWith(expect.objectContaining({ x: 500, output: "left" }));
  f.fire("pointerup", { pointerId: 2 });
  expect(f.calls.end).not.toHaveBeenCalled();
  f.fire("pointerup"); f.fire("lostpointercapture");
  expect(f.calls.end).toHaveBeenCalledTimes(1);
  expect(f.calls.cancel).not.toHaveBeenCalled();
  f.binder.dispose();
});

test("nearest handle wins within 22 CSS pixels, with stable index tie break and group retention", () => {
  const f = fixture({ handles: [{ x: 0.24, y: 0.25 }, { x: 0.26, y: 0.25 }], selection: { mode: "grid", kind: "row", index: 0, indices: [0, 1] } });
  f.fire("pointerdown");
  expect(f.calls.select).not.toHaveBeenCalled();
  f.fire("pointerup");
  f.geometry.selection = { mode: "grid", kind: "point", index: 1, indices: [1] };
  f.fire("pointerdown");
  expect(f.calls.select).toHaveBeenCalledWith({ output: "left", selection: { mode: "grid", kind: "point", index: 0 } });
  f.fire("pointerup");
  f.fire("pointerdown", { clientX: 400, clientY: 300 });
  expect(f.calls.start).toHaveBeenCalledTimes(2);
  f.binder.dispose();
});

test("tap does not move, cancellation and capture loss run once, and blur or hiding cancel", () => {
  const f = fixture();
  f.fire("pointerdown"); f.fire("pointerup");
  expect(f.calls.move).not.toHaveBeenCalled();
  f.fire("pointerdown"); f.fire("pointercancel", { pointerId: 2 });
  expect(f.calls.cancel).not.toHaveBeenCalled();
  f.fire("lostpointercapture"); f.fire("pointercancel");
  expect(f.calls.cancel).toHaveBeenCalledTimes(1);
  f.fire("pointerdown"); f.fire("win:blur");
  f.fire("pointerdown"); f.surface.ownerDocument.visibilityState = "hidden"; f.fire("doc:visibilitychange");
  expect(f.calls.cancel).toHaveBeenCalledTimes(3);
  f.binder.dispose();
});

test("explicit layout and authoritative cancellation do not notify twice", () => {
  const f = fixture();
  f.fire("pointerdown"); f.binder.cancel(); f.fire("lostpointercapture");
  expect(f.calls.cancel).toHaveBeenCalledTimes(1);
  f.fire("pointerdown"); f.binder.cancel({ notify: false }); f.fire("lostpointercapture");
  expect(f.calls.cancel).toHaveBeenCalledTimes(1);
  f.binder.dispose();
});

test("dragging a selected row member moves the row and creates one undo entry", () => {
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  config.outputs.left.warp.baseline = { type: "identity", width: 1920, height: 1080, origin: "top-left" };
  const editor = createWarpEditor({ config, output: "left" });
  editor.select(gridSelection("row", 0));
  const handles = editor.getControlPoints();
  const f = fixture({ handles, selection: editor.getState().selection, rect: { left: 0, top: 0, width: 1920, height: 1080 } });
  f.binder.dispose();
  const binder = bindWarpPointerInput({ surface: f.surface, readGeometry: () => f.geometry,
    onSelect: ({ selection }) => editor.select(selection), onStart: editor.pointerStart, onMove: editor.pointerMove, onEnd: editor.pointerEnd, onCancel: editor.pointerCancel });
  f.fire("pointerdown", { clientX: 0, clientY: 0 });
  f.fire("pointermove", { clientX: 10, clientY: 0 });
  f.fire("pointermove", { clientX: 20, clientY: 0 });
  f.fire("pointerup", { clientX: 20, clientY: 0 });
  expect(editor.getConfig().outputs.left.warp.grid.offsets.slice(0, 7).every(([x]) => Math.abs(x - 20 / 1920) < 1e-9)).toBe(true);
  expect(editor.getState().historyDepth).toBe(1);
  expect(editor.undo()).toBe(true);
  expect(editor.getConfig().outputs.left.warp.grid.offsets.slice(0, 7).every(([x]) => x === 0)).toBe(true);
  binder.dispose();
});
