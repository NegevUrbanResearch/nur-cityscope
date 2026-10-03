import { expect, test, vi } from "vitest";
import { bindWarpPointerInput } from "../../frontend/src/projection-config/warp-pointer-input.js";
import { fitWarpViewport, warpPointFromClient } from "../../frontend/src/projection-config/warp-viewport.js";
import { createWarpEditor, gridSelection } from "../../frontend/src/projection-config/warp-editor.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { createIdentityProjectionMesh } from "../../frontend/src/shared/projection-warp-geometry.js";

function fixture({ handles = [{ x: 0.25, y: 0.25 }], selection = { mode: "grid", kind: "point", index: 0, indices: [0] }, rows = 7, columns = 7, rect = { left: 0, top: 0, width: 960, height: 540 }, viewBox = { x: 0, y: 0, width: 1920, height: 1080 } } = {}) {
  const listeners = new Map();
  const surface = {
    ownerDocument: { visibilityState: "visible", addEventListener(type, callback) { listeners.set(`doc:${type}`, callback); }, removeEventListener(type) { listeners.delete(`doc:${type}`); }, defaultView: { addEventListener(type, callback) { listeners.set(`win:${type}`, callback); }, removeEventListener(type) { listeners.delete(`win:${type}`); } } },
    addEventListener(type, callback) { listeners.set(type, callback); }, removeEventListener(type) { listeners.delete(type); },
    setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), focus: vi.fn(),
  };
  const calls = { select: vi.fn(), start: vi.fn(), move: vi.fn(), end: vi.fn(), cancel: vi.fn(), navigate: vi.fn() };
  const geometry = { rect, viewBox, handles, selection, rows, columns, side: "left", mode: selection.mode };
  const binder = bindWarpPointerInput({ surface, readGeometry: () => geometry, onSelect: calls.select, onStart: calls.start, onMove: calls.move, onEnd: calls.end, onCancel: calls.cancel, onNavigate: calls.navigate });
  const fire = (type, event = {}) => listeners.get(type)?.({ type, pointerId: 1, isPrimary: true, button: 0, clientX: 240, clientY: 135, preventDefault: vi.fn(), ...event });
  return { surface, calls, geometry, binder, fire };
}

test.each([
  { side: "left", rows: 7, columns: 7, index: 17, expected: { mode: "grid", kind: "row", index: 2 } },
  { side: "right", rows: 7, columns: 8, index: 19, expected: { mode: "grid", kind: "row", index: 2 } },
])("a hit on a different row member selects that row before starting the drag ($side grid)", ({ side, rows, columns, index, expected }) => {
  const handles = Array.from({ length: rows * columns }, (_, item) => ({ x: (item % columns) / (columns - 1), y: Math.floor(item / columns) / (rows - 1) }));
  const selectedRowIndices = Array.from({ length: columns }, (_, column) => columns + column);
  const f = fixture({ handles, rows, columns, selection: { mode: "grid", kind: "row", index: 1, indices: selectedRowIndices }, rect: { left: 0, top: 0, width: 1920, height: 1080 } });
  f.geometry.side = side;
  const order = [];
  f.calls.select.mockImplementation((value) => { order.push("select"); f.geometry.selection = { ...value.selection, indices: Array.from({ length: columns }, (_, column) => expected.index * columns + column) }; });
  f.calls.start.mockImplementation(() => { expect(f.geometry.selection).toMatchObject(expected); order.push("start"); });
  const point = handles[index];
  f.fire("pointerdown", { clientX: point.x * 1920, clientY: point.y * 1080 });
  expect(f.calls.select).toHaveBeenCalledWith({ output: side, selection: expected });
  f.fire("pointermove", { clientX: point.x * 1920 + 7, clientY: point.y * 1080 });
  expect(order).toEqual(["select", "start"]);
  expect(f.calls.start).toHaveBeenCalledOnce();
  f.binder.dispose();
});

test("a hit on another column member preserves column mode and selects that column before starting", () => {
  const rows = 7; const columns = 8;
  const handles = Array.from({ length: rows * columns }, (_, item) => ({ x: (item % columns) / (columns - 1), y: Math.floor(item / columns) / (rows - 1) }));
  const indices = Array.from({ length: rows }, (_, row) => row * columns + 2);
  const f = fixture({ handles, rows, columns, selection: { mode: "grid", kind: "column", index: 2, indices }, rect: { left: 0, top: 0, width: 1920, height: 1080 } });
  const order = [];
  f.calls.select.mockImplementation((value) => { order.push("select"); f.geometry.selection = { ...value.selection, indices: Array.from({ length: rows }, (_, row) => row * columns + 5) }; });
  f.calls.start.mockImplementation(() => { expect(f.geometry.selection).toMatchObject({ mode: "grid", kind: "column", index: 5 }); order.push("start"); });
  const hitIndex = 2 * columns + 5;
  const point = handles[hitIndex];
  f.fire("pointerdown", { clientX: point.x * 1920, clientY: point.y * 1080 });
  expect(f.calls.select).toHaveBeenCalledWith({ output: "left", selection: { mode: "grid", kind: "column", index: 5 } });
  f.fire("pointermove", { clientX: point.x * 1920 + 7, clientY: point.y * 1080 });
  expect(order).toEqual(["select", "start"]);
  f.binder.dispose();
});

test.each([
  { kind: "row", columns: 8, rows: 7, selectedIndex: 0, hitIndex: 3, expectedKind: "row", expectedIndex: 0 },
  { kind: "column", columns: 8, rows: 7, selectedIndex: 2, hitIndex: 10, expectedKind: "column", expectedIndex: 2 },
])("hitting a selected $kind member preserves the group selection", ({ kind, columns, rows, selectedIndex, hitIndex, expectedKind, expectedIndex }) => {
  const handles = Array.from({ length: rows * columns }, (_, item) => ({ x: (item % columns) / (columns - 1), y: Math.floor(item / columns) / (rows - 1) }));
  const indices = kind === "row" ? Array.from({ length: columns }, (_, column) => selectedIndex * columns + column) : Array.from({ length: rows }, (_, row) => row * columns + selectedIndex);
  const f = fixture({ handles, rows, columns, selection: { mode: "grid", kind, index: selectedIndex, indices }, rect: { left: 0, top: 0, width: 1920, height: 1080 } });
  const point = handles[hitIndex];
  f.fire("pointerdown", { clientX: point.x * 1920, clientY: point.y * 1080 });
  expect(f.calls.select).not.toHaveBeenCalled();
  f.fire("pointermove", { clientX: point.x * 1920 + 7, clientY: point.y * 1080 });
  expect(f.calls.start).toHaveBeenCalledOnce();
  f.binder.dispose();
});

test("second touch rolls back a local drag and takes ownership for pinch navigation", () => {
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  config.outputs.left.warp.baseline = { type: "identity", width: 1920, height: 1080, origin: "top-left" };
  const editor = createWarpEditor({ config, output: "left" });
  const startConfig = editor.getConfig();
  const f = fixture({ handles: editor.getControlPoints(), selection: editor.getState().selection });
  f.binder.dispose();
  const binder = bindWarpPointerInput({ surface: f.surface, readGeometry: () => ({ ...f.geometry, handles: editor.getControlPoints(), selection: editor.getState().selection }),
    onSelect: ({ selection }) => editor.select(selection), onStart: editor.pointerStart, onMove: editor.pointerMove, onEnd: editor.pointerEnd, onCancel: editor.pointerCancel, onNavigate: f.calls.navigate });

  f.fire("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 0, clientY: 0 });
  f.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 10, clientY: 0 });
  f.fire("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 400, clientY: 270 });
  expect(editor.getConfig().outputs.left.warp.keystone.corners[0][0]).toBe(0);
  expect(editor.getState().historyDepth).toBe(0);
  expect(editor.getState().dragging).toBe(false);
  expect(binder.activeViewBox()).not.toBeNull();
  f.fire("pointermove", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 420, clientY: 270 });
  expect(f.calls.navigate).toHaveBeenCalled();
  expect(editor.getConfig()).toEqual(startConfig);
  f.fire("pointerup", { pointerId: 2, pointerType: "touch", isPrimary: false });
  binder.dispose();
});

test("a touch that moved before the second finger joins starts navigation at its latest position", () => {
  const f = fixture();
  f.calls.navigate.mockImplementation(({ viewBox }) => { f.geometry.viewBox = viewBox; });
  const startingView = { ...f.geometry.viewBox };
  f.fire("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 200 });
  f.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 300 });
  f.fire("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 500 });
  f.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 300 });
  expect(f.binder.activeViewBox()).toEqual(startingView);
  expect(f.geometry.viewBox).toEqual(startingView);
  f.binder.dispose();
});

test("a surviving touch keeps its latest position before a replacement finger joins", () => {
  const f = fixture();
  f.calls.navigate.mockImplementation(({ viewBox }) => { f.geometry.viewBox = viewBox; });
  const startingView = { ...f.geometry.viewBox };
  f.fire("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 200 });
  f.fire("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 500 });
  f.fire("pointerup", { pointerId: 2, pointerType: "touch", isPrimary: false });
  f.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 300 });
  f.fire("pointerdown", { pointerId: 3, pointerType: "touch", isPrimary: false, clientX: 500 });
  f.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 300 });
  expect(f.binder.activeViewBox()).toEqual(startingView);
  expect(f.geometry.viewBox).toEqual(startingView);
  f.binder.dispose();
});

test("deliberate capture loss after a local rollback leaves the pinch navigation owner active", () => {
  const f = fixture({ selection: { mode: "grid", kind: "point", index: 3, indices: [3] } });
  f.fire("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 240, clientY: 135 });
  f.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 247, clientY: 135 });
  f.fire("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 400, clientY: 270 });
  f.fire("lostpointercapture", { pointerId: 1, pointerType: "touch" });
  f.calls.navigate.mockClear();
  f.fire("pointermove", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 420, clientY: 270 });
  expect(f.calls.cancel).toHaveBeenCalledTimes(1);
  expect(f.calls.navigate).toHaveBeenCalledTimes(1);
  expect(f.binder.activeViewBox()).not.toBeNull();
  f.binder.dispose();
});

test("reused pointer ID capture loss cancels a later geometry drag", () => {
  const f = fixture({ selection: { mode: "grid", kind: "point", index: 3, indices: [3] } });
  f.fire("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 240, clientY: 135 });
  f.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 247, clientY: 135 });
  f.fire("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 400, clientY: 270 });
  f.fire("pointerup", { pointerId: 1, pointerType: "touch" });
  f.fire("pointerup", { pointerId: 2, pointerType: "touch", isPrimary: false });
  f.calls.cancel.mockClear();

  f.fire("pointerdown", { pointerId: 1, clientX: 240, clientY: 135 });
  f.fire("pointermove", { pointerId: 1, clientX: 247, clientY: 135 });
  f.fire("lostpointercapture", { pointerId: 1 });
  expect(f.calls.cancel).toHaveBeenCalledTimes(1);
  f.binder.dispose();
});

test("third touch cannot replace or end the two navigation owners", () => {
  const f = fixture();
  f.calls.navigate.mockImplementation(({ viewBox }) => { f.geometry.viewBox = viewBox; });
  f.fire("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 200 });
  f.fire("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 400 });
  f.fire("pointermove", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 500 });
  const expectedStart = { x: 0, y: 0, width: 1920, height: 1080 };
  f.fire("pointerdown", { pointerId: 3, pointerType: "touch", isPrimary: false, clientX: 700 });
  f.fire("pointerup", { pointerId: 3, pointerType: "touch", isPrimary: false });
  f.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 210 });
  expect(f.calls.navigate).toHaveBeenCalledTimes(2);
  expect(f.binder.activeViewBox()).not.toBeNull();
  f.binder.cancel();
  expect(f.calls.navigate).toHaveBeenLastCalledWith({ viewBox: expectedStart });
});

test("second touch restores an active local drag before navigation takes over", () => {
  const f = fixture();
  f.fire("pointerdown", { pointerId: 1, pointerType: "touch" });
  f.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 247, clientY: 135 });
  f.fire("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 400 });
  f.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 250 });
  f.fire("pointerup", { pointerId: 1, pointerType: "touch", clientX: 250 });
  f.fire("pointerup", { pointerId: 2, pointerType: "touch", isPrimary: false });
  expect(f.calls.start).toHaveBeenCalledTimes(1);
  expect(f.calls.move).toHaveBeenCalledTimes(1);
  expect(f.calls.end).not.toHaveBeenCalled();
  expect(f.calls.cancel).toHaveBeenCalledTimes(1);
  expect(f.calls.navigate).toHaveBeenCalled();
  f.binder.dispose();
});

test("navigation cancellation restores its starting view without geometry callbacks", () => {
  const f = fixture();
  f.fire("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 200 });
  f.fire("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 400 });
  f.fire("pointermove", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 500 });
  f.calls.navigate.mockClear();
  f.fire("pointercancel", { pointerId: 1, pointerType: "touch" });
  expect(f.calls.navigate).toHaveBeenLastCalledWith({ viewBox: f.geometry.viewBox });
  expect(f.calls.start).not.toHaveBeenCalled();
  expect(f.calls.move).not.toHaveBeenCalled();
  expect(f.calls.end).not.toHaveBeenCalled();
  expect(f.calls.cancel).not.toHaveBeenCalled();
  f.binder.dispose();
});

test("desktop Pan moves the preview without beginning a geometry edit", () => {
  const f = fixture();
  f.geometry.panMode = true;
  f.fire("pointerdown", { pointerType: "mouse" });
  f.fire("pointermove", { pointerType: "mouse", clientX: 260, clientY: 155 });
  expect(f.calls.navigate).toHaveBeenCalledTimes(1);
  expect(f.calls.start).not.toHaveBeenCalled();
  expect(f.calls.move).not.toHaveBeenCalled();
  expect(f.calls.end).not.toHaveBeenCalled();
  f.fire("pointerup", { pointerType: "mouse" });
  f.binder.dispose();
});

test("desktop Pan cancellation restores its starting view while pointerup keeps the pan", () => {
  for (const cancelWith of ["pointercancel", "lostpointercapture", "explicit"]) {
    const f = fixture();
    f.geometry.panMode = true;
    f.calls.navigate.mockImplementation(({ viewBox }) => { f.geometry.viewBox = viewBox; });
    const startingView = { ...f.geometry.viewBox };
    f.fire("pointerdown", { pointerType: "mouse" });
    f.fire("pointermove", { pointerType: "mouse", clientX: 280, clientY: 165 });
    const navigatedView = { ...f.binder.activeViewBox() };
    expect(navigatedView).not.toEqual(startingView);
    if (cancelWith === "explicit") f.binder.cancel();
    else f.fire(cancelWith, { pointerType: "mouse" });
    expect(f.calls.navigate).toHaveBeenLastCalledWith({ viewBox: startingView });
    f.binder.dispose();
  }
  const f = fixture();
  f.geometry.panMode = true;
  f.calls.navigate.mockImplementation(({ viewBox }) => { f.geometry.viewBox = viewBox; });
  f.fire("pointerdown", { pointerType: "mouse" });
  f.fire("pointermove", { pointerType: "mouse", clientX: 280, clientY: 165 });
  const navigatedView = { ...f.binder.activeViewBox() };
  f.fire("pointerup", { pointerType: "mouse" });
  expect(f.geometry.viewBox).toEqual(navigatedView);
  f.binder.dispose();
});

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

test("nearest handle wins within 24 CSS pixels, with stable index tie break and group retention", () => {
  const f = fixture({ handles: [{ x: 0.24, y: 0.25 }, { x: 0.26, y: 0.25 }], selection: { mode: "grid", kind: "row", index: 0, indices: [0, 1] } });
  f.fire("pointerdown", { clientX: 263.5, clientY: 135 });
  f.fire("pointermove", { clientX: 270.5, clientY: 135 });
  expect(f.calls.select).not.toHaveBeenCalled();
  f.fire("pointerup");
  f.geometry.selection = { mode: "grid", kind: "point", index: 1, indices: [1] };
  f.fire("pointerdown");
  expect(f.calls.select).toHaveBeenCalledWith({ output: "left", selection: { mode: "grid", kind: "point", index: 0 } });
  f.fire("pointerup");
  f.fire("pointerdown", { clientX: 400, clientY: 300 });
  expect(f.calls.start).toHaveBeenCalledTimes(1);
  f.binder.dispose();
});

test("released touch pan leaves no stale owner pointer before the next single finger", () => {
  const f = fixture();
  f.geometry.panMode = true;
  f.surface.setPointerCapture = () => {};
  f.surface.releasePointerCapture = () => {};
  f.calls.navigate.mockImplementation(({ viewBox }) => { f.geometry.viewBox = viewBox; });
  f.fire("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 200, clientY: 200 });
  f.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 220, clientY: 200 });
  f.fire("pointerup", { pointerId: 1, pointerType: "touch", clientX: 220, clientY: 200 });
  f.calls.navigate.mockClear();
  f.geometry.panMode = false;
  f.fire("pointerdown", { pointerId: 2, pointerType: "touch", clientX: 240, clientY: 135 });
  f.fire("pointermove", { pointerId: 2, pointerType: "touch", clientX: 247, clientY: 135 });
  expect(f.calls.start).toHaveBeenCalledTimes(1);
  expect(f.calls.navigate).not.toHaveBeenCalled();
  f.binder.dispose();
});

test("a second touch promotes Move view pan into pinch at the current viewport", () => {
  const f = fixture();
  f.geometry.panMode = true;
  f.calls.navigate.mockImplementation(({ viewBox }) => { f.geometry.viewBox = viewBox; });
  f.fire("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 200, clientY: 200 });
  f.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 220, clientY: 200 });
  const afterPan = { ...f.geometry.viewBox };
  f.calls.navigate.mockClear();
  f.fire("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 420, clientY: 200 });
  expect(f.geometry.viewBox).toEqual(afterPan);
  expect(f.binder.activeViewBox()).toEqual(afterPan);
  expect(f.calls.navigate).not.toHaveBeenCalled();
  f.fire("pointermove", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 440, clientY: 200 });
  expect(f.calls.navigate).toHaveBeenCalledTimes(1);
  expect(f.geometry.viewBox).not.toEqual(afterPan);
  f.binder.cancel();
  expect(f.geometry.viewBox).toEqual(afterPan);
  f.binder.dispose();
});

test("Edit selects on a five CSS pixel tap without starting or changing geometry", () => {
  const f = fixture({ selection: { mode: "grid", kind: "point", index: 0, indices: [] } });
  const before = { ...f.geometry.viewBox };
  f.fire("pointerdown", { clientX: 240, clientY: 135 });
  f.fire("pointermove", { clientX: 245, clientY: 135 });
  f.fire("pointerup", { clientX: 245, clientY: 135 });
  expect(f.calls.select).toHaveBeenCalledOnce();
  expect(f.calls.select).toHaveBeenCalledWith({ output: "left", selection: { mode: "grid", kind: "point", index: 0 } });
  expect(f.calls.start).not.toHaveBeenCalled();
  expect(f.calls.move).not.toHaveBeenCalled();
  expect(f.calls.end).not.toHaveBeenCalled();
  expect(f.geometry.viewBox).toEqual(before);
  f.binder.dispose();
});

test("Edit crosses the six CSS pixel threshold once and starts with CSS and output coordinates", () => {
  const f = fixture({ rect: { left: 0, top: 0, width: 960, height: 540 } });
  f.fire("pointerdown", { clientX: 240, clientY: 135 });
  f.fire("pointermove", { clientX: 245, clientY: 135 });
  expect(f.calls.start).not.toHaveBeenCalled();
  f.fire("pointermove", { clientX: 246, clientY: 135 });
  f.fire("pointermove", { clientX: 248, clientY: 135 });
  expect(f.calls.start).toHaveBeenCalledOnce();
  expect(f.calls.start).toHaveBeenCalledWith(expect.objectContaining({ clientX: 240, clientY: 135, x: 480, y: 270, outputPoint: { x: 480, y: 270 } }));
  expect(f.calls.move).toHaveBeenCalledTimes(2);
  f.fire("pointerup", { clientX: 248, clientY: 135 });
  expect(f.calls.end).toHaveBeenCalledOnce();
  f.binder.dispose();
});

test("a second touch cancels a tentative handle edit and transfers to pinch navigation", () => {
  const f = fixture();
  f.calls.navigate.mockImplementation(({ viewBox }) => { f.geometry.viewBox = viewBox; });
  const startView = { ...f.geometry.viewBox };
  f.fire("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 240, clientY: 135 });
  f.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 245, clientY: 135 });
  f.fire("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 400, clientY: 270 });
  expect(f.calls.start).not.toHaveBeenCalled();
  expect(f.calls.cancel).not.toHaveBeenCalled();
  expect(f.geometry.viewBox).toEqual(startView);
  f.fire("pointermove", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 420, clientY: 270 });
  expect(f.calls.navigate).toHaveBeenCalled();
  expect(f.binder.activeViewBox()).not.toBeNull();
  f.binder.dispose();
});

test("Move pans from a handle with the same behavior as the background", () => {
  const handle = fixture();
  const background = fixture();
  handle.binder.setInteractionMode("move");
  background.binder.setInteractionMode("move");
  handle.fire("pointerdown", { clientX: 240, clientY: 135 });
  background.fire("pointerdown", { clientX: 300, clientY: 200 });
  handle.fire("pointermove", { clientX: 260, clientY: 145 });
  background.fire("pointermove", { clientX: 320, clientY: 210 });
  expect(handle.calls.navigate).toHaveBeenCalledTimes(1);
  expect(background.calls.navigate).toHaveBeenCalledTimes(1);
  expect(handle.calls.start).not.toHaveBeenCalled();
  expect(background.calls.start).not.toHaveBeenCalled();
  handle.binder.dispose(); background.binder.dispose();
});

test.each(["cancel", "complete", "dispose", "cancel-with-synchronous-capture-loss"])("promoted pan capture is released on %s", (finish) => {
  const f = fixture();
  const captures = new Set();
  const releases = [];
  f.geometry.panMode = true;
  f.calls.navigate.mockImplementation(({ viewBox }) => { f.geometry.viewBox = viewBox; });
  f.surface.setPointerCapture = (pointerId) => captures.add(pointerId);
  f.surface.releasePointerCapture = (pointerId) => {
    releases.push(pointerId);
    captures.delete(pointerId);
    if (finish === "cancel-with-synchronous-capture-loss") f.fire("lostpointercapture", { pointerId, pointerType: "touch" });
  };
  f.fire("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 200, clientY: 200 });
  f.fire("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 420, clientY: 200 });
  expect([...captures]).toEqual([1]);
  if (finish === "complete") {
    f.fire("pointerup", { pointerId: 2, pointerType: "touch", isPrimary: false });
    f.fire("pointerup", { pointerId: 1, pointerType: "touch" });
  } else if (finish === "dispose") f.binder.dispose();
  else f.binder.cancel();
  expect([...captures]).toEqual([]);
  expect(releases).toEqual([1]);
  if (finish === "complete") expect(f.calls.navigate).not.toHaveBeenCalled();
  else expect(f.calls.navigate).toHaveBeenCalledTimes(1);
  if (finish !== "dispose") f.binder.dispose();
});

test.each(["synchronous", "asynchronous"])("replacement pinch finger retains the promoted pan survivor with %s capture loss", (delivery) => {
  const f = fixture();
  const captures = new Set();
  const pendingLosses = [];
  f.geometry.panMode = true;
  f.calls.navigate.mockImplementation(({ viewBox }) => { f.geometry.viewBox = viewBox; });
  f.surface.setPointerCapture = (pointerId) => captures.add(pointerId);
  f.surface.releasePointerCapture = (pointerId) => {
    captures.delete(pointerId);
    const loss = () => f.fire("lostpointercapture", { pointerId, pointerType: "touch" });
    if (delivery === "synchronous") loss();
    else pendingLosses.push(loss);
  };
  f.fire("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 200, clientY: 200 });
  f.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 220, clientY: 200 });
  f.fire("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 420, clientY: 200 });
  f.fire("pointermove", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 440, clientY: 200 });
  f.fire("pointerup", { pointerId: 2, pointerType: "touch", isPrimary: false });
  expect([...captures]).toEqual([]);
  expect(f.binder.isActive()).toBe(false);
  f.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 240, clientY: 200 });
  const afterPinch = { ...f.geometry.viewBox };
  f.calls.navigate.mockClear();
  f.fire("pointerdown", { pointerId: 3, pointerType: "touch", isPrimary: false, clientX: 440, clientY: 200 });
  // Delayed capture loss may arrive after the replacement gesture has started.
  pendingLosses.splice(0).forEach((loss) => loss());
  expect(f.binder.isActive()).toBe(true);
  f.fire("pointermove", { pointerId: 1, pointerType: "touch", clientX: 240, clientY: 200 });
  expect(f.geometry.viewBox).toEqual(afterPinch);
  f.calls.navigate.mockClear();
  f.fire("pointermove", { pointerId: 3, pointerType: "touch", isPrimary: false, clientX: 480, clientY: 200 });
  expect(f.calls.navigate).toHaveBeenCalledTimes(1);
  expect(f.geometry.viewBox).not.toEqual(afterPinch);
  f.fire("pointerup", { pointerId: 3, pointerType: "touch", isPrimary: false });
  f.fire("pointerup", { pointerId: 1, pointerType: "touch" });
  expect(f.calls.cancel).not.toHaveBeenCalled();
  f.binder.dispose();
});

test("pointercancel still cancels the surviving touch while its deliberate capture loss is pending", () => {
  const f = fixture();
  f.geometry.panMode = true;
  f.calls.navigate.mockImplementation(({ viewBox }) => { f.geometry.viewBox = viewBox; });
  f.fire("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 200 });
  f.fire("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 400 });
  f.fire("pointerup", { pointerId: 2, pointerType: "touch", isPrimary: false });
  f.fire("pointerdown", { pointerId: 3, pointerType: "touch", isPrimary: false, clientX: 400 });
  const replacementStart = { ...f.geometry.viewBox };
  f.fire("pointermove", { pointerId: 3, pointerType: "touch", isPrimary: false, clientX: 440 });
  expect(f.geometry.viewBox).not.toEqual(replacementStart);
  f.calls.navigate.mockClear();
  f.fire("pointercancel", { pointerId: 1, pointerType: "touch" });
  expect(f.binder.isActive()).toBe(false);
  expect(f.calls.navigate).toHaveBeenCalledExactlyOnceWith({ viewBox: replacementStart });
  f.fire("lostpointercapture", { pointerId: 1, pointerType: "touch" });
  expect(f.calls.navigate).toHaveBeenCalledTimes(1);
  f.binder.dispose();
});

test.each(["pointercancel", "lostpointercapture"])("unexpected %s during promoted pinch cancels once and releases its capture", (eventType) => {
  const f = fixture();
  const captures = new Set();
  f.geometry.panMode = true;
  f.calls.navigate.mockImplementation(({ viewBox }) => { f.geometry.viewBox = viewBox; });
  f.surface.setPointerCapture = (pointerId) => captures.add(pointerId);
  f.surface.releasePointerCapture = (pointerId) => {
    captures.delete(pointerId);
    f.fire("lostpointercapture", { pointerId, pointerType: "touch" });
  };
  f.fire("pointerdown", { pointerId: 1, pointerType: "touch", clientX: 200 });
  f.fire("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 400 });
  const pinchStart = { ...f.geometry.viewBox };
  f.fire("pointermove", { pointerId: 2, pointerType: "touch", isPrimary: false, clientX: 440 });
  f.calls.navigate.mockClear();
  f.fire(eventType, { pointerId: 1, pointerType: "touch" });
  expect(f.binder.isActive()).toBe(false);
  expect([...captures]).toEqual([]);
  expect(f.calls.navigate).toHaveBeenCalledExactlyOnceWith({ viewBox: pinchStart });
  f.binder.dispose();
});

test("the warp handle hit target reaches 24 CSS pixels from the marker center", () => {
  const f = fixture({ handles: [{ x: 0.25, y: 0.25 }] });
  f.fire("pointerdown", { clientX: 263.5, clientY: 135 });
  f.fire("pointermove", { clientX: 270.5, clientY: 135 });
  expect(f.calls.start).toHaveBeenCalledTimes(1);
  f.binder.dispose();
});

test.each([
  ["landscape fitted", { left: 0, top: 0, width: 960, height: 540 }, { x: 0, y: 0, width: 1920, height: 1080 }],
  ["portrait fitted", { left: 10, top: 20, width: 540, height: 960 }, { x: 0, y: 0, width: 1920, height: 1080 }],
  ["landscape zoomed and panned", { left: 0, top: 0, width: 960, height: 540 }, { x: -120, y: -60, width: 2160, height: 1200 }],
  ["portrait zoomed and panned", { left: 10, top: 20, width: 540, height: 960 }, { x: -120, y: -60, width: 2160, height: 1200 }],
])("keystone corners drag at all four preview edges in %s coordinates", (_name, rect, viewBox) => {
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  config.outputs.left.warp.baseline = { type: "identity", width: 1920, height: 1080, origin: "top-left" };
  const editor = createWarpEditor({ config, output: "left" });
  const f = fixture({ handles: editor.getControlPoints(), rect, viewBox });
  f.binder.dispose();
  const binder = bindWarpPointerInput({ surface: f.surface, readGeometry: () => ({ ...f.geometry, handles: editor.getControlPoints(), selection: editor.getState().selection }),
    onSelect: ({ selection }) => editor.select(selection), onStart: editor.pointerStart, onMove: editor.pointerMove, onEnd: editor.pointerEnd, onCancel: editor.pointerCancel });
  const scale = fitWarpViewport(viewBox, rect.width, rect.height).scale;
  const corners = [[0, 0], [1920, 0], [0, 1080], [1920, 1080]];
  for (let index = 0; index < corners.length; index += 1) {
    const before = structuredClone(editor.getConfig().outputs.left.warp.keystone.corners[index]);
    const [x, y] = corners[index];
    const mapping = fitWarpViewport(viewBox, rect.width, rect.height);
    const clientX = rect.left + mapping.insetX + (x - viewBox.x) * scale;
    const clientY = rect.top + mapping.insetY + (y - viewBox.y) * scale;
    const dx = index % 2 === 0 ? 4 : -4;
    const dy = index < 2 ? 4 : -4;
    editor.select({ mode: "keystone", kind: "corner", index });
    f.fire("pointerdown", { clientX, clientY });
    f.fire("pointermove", { clientX: clientX + 7, clientY });
    f.fire("pointermove", { clientX: clientX + dx * scale, clientY: clientY + dy * scale });
    f.fire("pointerup", { clientX: clientX + dx * scale, clientY: clientY + dy * scale });
    expect(editor.getConfig().outputs.left.warp.keystone.corners[index][0]).toBeCloseTo(before[0] + dx / 1920);
    expect(editor.getConfig().outputs.left.warp.keystone.corners[index][1]).toBeCloseTo(before[1] + dy / 1080);
  }
  expect(editor.getState().historyDepth).toBe(4);
  binder.dispose();
});

test("tap does not move, cancellation and capture loss run once, and blur or hiding cancel", () => {
  const f = fixture();
  f.fire("pointerdown"); f.fire("pointerup");
  expect(f.calls.move).not.toHaveBeenCalled();
  f.fire("pointerdown"); f.fire("pointermove", { clientX: 247, clientY: 135 }); f.fire("pointercancel", { pointerId: 2 });
  expect(f.calls.cancel).not.toHaveBeenCalled();
  f.fire("lostpointercapture"); f.fire("pointercancel");
  expect(f.calls.cancel).toHaveBeenCalledTimes(1);
  f.fire("pointerdown"); f.fire("pointermove", { clientX: 247, clientY: 135 }); f.fire("win:blur");
  f.fire("pointerdown"); f.fire("pointermove", { clientX: 247, clientY: 135 }); f.surface.ownerDocument.visibilityState = "hidden"; f.fire("doc:visibilitychange");
  expect(f.calls.cancel).toHaveBeenCalledTimes(3);
  f.binder.dispose();
});

test("explicit layout and authoritative cancellation do not notify twice", () => {
  const f = fixture();
  f.fire("pointerdown"); f.fire("pointermove", { clientX: 247, clientY: 135 }); f.binder.cancel(); f.fire("lostpointercapture");
  expect(f.calls.cancel).toHaveBeenCalledTimes(1);
  f.fire("pointerdown"); f.fire("pointermove", { clientX: 247, clientY: 135 }); f.binder.cancel({ notify: false }); f.fire("lostpointercapture");
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

test("grid drag uses the imported TD baseline geometry and creates one undo entry", () => {
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  config.outputs.right.warp.baseline = { type: "tdMesh", assetId: "mesh", sha256: "a".repeat(64), width: 1920, height: 1080, origin: "top-left" };
  const baseline = createIdentityProjectionMesh({ side: "right" });
  baseline.vertices.forEach((point) => { point.x *= 1.05; point.y *= 0.95; });
  const editor = createWarpEditor({ config, output: "right", baselineMesh: baseline });
  const pointIndex = 1;
  editor.select(gridSelection("point", pointIndex));
  const f = fixture({ handles: editor.getControlPoints(), selection: editor.getState().selection, rect: { left: 0, top: 0, width: 1920, height: 1080 } });
  f.binder.dispose();
  const binder = bindWarpPointerInput({ surface: f.surface, readGeometry: () => ({ ...f.geometry, handles: editor.getControlPoints(), selection: editor.getState().selection }),
    onSelect: ({ selection }) => editor.select(selection), onStart: editor.pointerStart, onMove: editor.pointerMove, onEnd: editor.pointerEnd, onCancel: editor.pointerCancel });
  const start = editor.getConfig();
  const handle = editor.getControlPoints()[pointIndex];
  expect(handle.x).toBeCloseTo((1 / 7) * 1.05);
  expect(handle.y).toBe(0);
  const viewBox = f.geometry.viewBox;
  const mapping = fitWarpViewport(viewBox, f.geometry.rect.width, f.geometry.rect.height);
  const clientX = f.geometry.rect.left + mapping.insetX + (handle.x * 1920 - viewBox.x) * mapping.scale;
  const clientY = f.geometry.rect.top + mapping.insetY + (handle.y * 1080 - viewBox.y) * mapping.scale;
  f.fire("pointerdown", { pointerType: "touch", clientX, clientY });
  f.fire("pointermove", { pointerType: "touch", clientX: clientX + 8, clientY });
  f.fire("pointerup", { pointerType: "touch", clientX: clientX + 8, clientY });
  expect(editor.getConfig().outputs.right.warp.grid.offsets[pointIndex][0]).toBeCloseTo(8 / 1920);
  expect(editor.getState().historyDepth).toBe(1);
  expect(editor.undo()).toBe(true);
  expect(editor.getConfig()).toEqual(start);
  binder.dispose();
});
