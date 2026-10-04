// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { createWarpPanelView } from "../../frontend/src/projection-config/warp-panel-view.js";
import { createWarpEditor, gridSelection, keystoneSelection } from "../../frontend/src/projection-config/warp-editor.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";

afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); });

test("Keystone and Grid expose the same shared adjustment rows and the picker selects the exact target", () => {
  const onAction = vi.fn();
  const panel = createWarpPanelView({ document, onAction });
  const editor = createWarpEditor({ config: structuredClone(DEFAULT_PROJECTION_CONFIG) });
  document.body.append(panel.element);
  const update = (nodeId, selection) => panel.update({ output: "left", nodeId, editorState: { ...editor.getState(), selection, config: editor.getConfig(), handles: editor.getControlPoints() } });
  update("left-keystone", keystoneSelection("corner", 2));
  const rowNames = [...panel.element.children].map((row) => row.className);
  expect(rowNames).toEqual(["warp-selection-row", "warp-position-row", "warp-step-row", "warp-adjustment-row", "warp-history-row"]);
  expect(panel.element.querySelector('[aria-label="Selected warp X position"]')).toBeTruthy();
  expect(panel.element.querySelector('[aria-label="Selected warp Y position"]')).toBeTruthy();
  expect(panel.element.querySelector('[aria-label="Warp Undo"]')).toBeTruthy();
  update("left-grid", gridSelection("point", 15));
  expect([...panel.element.children].map((row) => row.className)).toEqual(rowNames);
  expect(panel.controls.warpSelectionControls.hidden).toBe(false);
  panel.controls.warpSelectionPicker.value = "1";
  panel.controls.warpSelectionPicker.dispatchEvent(new Event("change", { bubbles: true }));
  expect(onAction).toHaveBeenCalledWith("warp-select", { output: "left", selection: { mode: "grid", kind: "point", index: 1 } });
  panel.dispose();
});

test("relative pad forwards one captured pointer gesture in output pixels", () => {
  const onPointer = vi.fn();
  const panel = createWarpPanelView({ document, onPointer });
  panel.update({ output: "right", nodeId: "right-grid", editorState: { selection: gridSelection("row", 0), stepMode: "fine", config: structuredClone(DEFAULT_PROJECTION_CONFIG), handles: [] } });
  const pad = panel.controls.relativePad;
  pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 });
  const down = new Event("pointerdown", { bubbles: true, cancelable: true }); Object.assign(down, { pointerId: 7, button: 0, clientX: 100, clientY: 100 }); pad.dispatchEvent(down);
  const move = new Event("pointermove", { bubbles: true }); Object.assign(move, { pointerId: 7, clientX: 110, clientY: 110 }); pad.dispatchEvent(move);
  const up = new Event("pointerup", { bubbles: true }); Object.assign(up, { pointerId: 7, clientX: 110, clientY: 110 }); pad.dispatchEvent(up);
  expect(onPointer.mock.calls.map(([phase]) => phase)).toEqual(["start", "move", "end"]);
  expect(onPointer.mock.calls[0][1]).toMatchObject({ x: 0, y: 0, output: "right" });
  expect(onPointer.mock.calls[1][1].x).toBeCloseTo(24);
  expect(onPointer.mock.calls[1][1].y).toBeCloseTo(13.5);
  expect(onPointer.mock.calls[2][1]).toEqual(onPointer.mock.calls[1][1]);
  panel.dispose();
});

test("a rejected relative-pad start releases local ownership without late movement", () => {
  const onPointer = vi.fn((phase) => phase !== "start");
  const panel = createWarpPanelView({ document, onPointer });
  const pad = panel.controls.relativePad;
  pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 });
  pad.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 28, button: 0, clientX: 100, clientY: 100, bubbles: true }));
  pad.dispatchEvent(new PointerEvent("pointermove", { pointerId: 28, clientX: 110, clientY: 100, bubbles: true }));
  expect(onPointer.mock.calls.map(([phase]) => phase)).toEqual(["start"]);
  expect(panel.cancelGestures()).toBe(false);
  panel.dispose();
});

test("retirement drops pad ownership before releasing capture can dispatch lostpointercapture", () => {
  const onPointer = vi.fn();
  const panel = createWarpPanelView({ document, onPointer });
  const pad = panel.controls.relativePad;
  pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 });
  pad.setPointerCapture = vi.fn();
  pad.releasePointerCapture = vi.fn((pointerId) => {
    const lost = new Event("lostpointercapture", { bubbles: true });
    Object.assign(lost, { pointerId });
    pad.dispatchEvent(lost);
  });
  pad.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 46, button: 0, clientX: 100, clientY: 100, bubbles: true }));
  panel.retireGestures();
  pad.dispatchEvent(new PointerEvent("pointermove", { pointerId: 46, clientX: 110, clientY: 100, bubbles: true }));
  expect(onPointer.mock.calls.map(([phase]) => phase)).toEqual(["start"]);
  expect(pad.releasePointerCapture).toHaveBeenCalledWith(46);
  panel.dispose();
});

test.each(["lostpointercapture", "escape", "blur", "visibilitychange"])("relative pad %s cancels captured geometry without history", (terminal) => {
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  config.outputs.left.warp.baseline = { type: "identity", width: 1920, height: 1080, origin: "top-left" };
  const editor = createWarpEditor({ config, output: "left" });
  const initial = editor.getConfig();
  const panel = createWarpPanelView({ document, onPointer(phase, value) {
    if (phase === "start") return editor.pointerStart(value);
    if (phase === "move") return editor.pointerMove(value);
    if (phase === "cancel") return editor.pointerCancel();
    if (phase === "end") { editor.pointerMove(value); return editor.pointerEnd(); }
  } });
  document.body.append(panel.element);
  const pad = panel.controls.relativePad;
  pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 });
  const down = new PointerEvent("pointerdown", { pointerId: 31, button: 0, clientX: 100, clientY: 100, bubbles: true }); pad.dispatchEvent(down);
  pad.dispatchEvent(new PointerEvent("pointermove", { pointerId: 31, clientX: 110, clientY: 100, bubbles: true }));
  expect(editor.getState().adjusting).toBe(true);
  if (terminal === "lostpointercapture") pad.dispatchEvent(new PointerEvent(terminal, { pointerId: 31, bubbles: true }));
  else if (terminal === "escape") document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  else if (terminal === "blur") window.dispatchEvent(new Event("blur"));
  else { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event(terminal)); }
  expect(editor.getState()).toMatchObject({ adjusting: false, historyDepth: 0 });
  expect(editor.getConfig().outputs.left.warp).toEqual(initial.outputs.left.warp);
  panel.dispose();
});

test("a held arrow repeats at selected sensitivity and retires without a late tick", () => {
  vi.useFakeTimers();
  const onAction = vi.fn(() => true);
  const panel = createWarpPanelView({ document, onAction });
  panel.update({ output: "left", nodeId: "left-keystone", editorState: { selection: keystoneSelection(), stepMode: "coarse", config: structuredClone(DEFAULT_PROJECTION_CONFIG), handles: [] } });
  const arrow = panel.element.querySelector('[data-action="warp-nudge"][data-direction="right"]');
  const down = new Event("pointerdown", { bubbles: true, cancelable: true }); Object.assign(down, { pointerId: 9, button: 0 }); arrow.dispatchEvent(down);
  vi.advanceTimersByTime(550);
  expect(onAction.mock.calls.filter(([action]) => action === "warp-nudge")).toHaveLength(3);
  expect(onAction.mock.calls.find(([action]) => action === "warp-nudge")?.[1]).toMatchObject({ direction: "right", coarse: true });
  panel.retireGestures();
  const repeats = onAction.mock.calls.filter(([action]) => action === "warp-nudge").length;
  vi.advanceTimersByTime(500);
  expect(onAction.mock.calls.filter(([action]) => action === "warp-nudge")).toHaveLength(repeats);
  expect(onAction.mock.calls.at(-1)[0]).toBe("warp-nudge");
  panel.dispose();
});

test.each(["blur", "visibilitychange"]) ("held nudge %s cancels locally and keeps prior history", (terminal) => {
  vi.useFakeTimers();
  const changes = [];
  const editor = createWarpEditor({ config: structuredClone(DEFAULT_PROJECTION_CONFIG), onChange: (config, meta) => changes.push({ config: structuredClone(config), meta }) });
  editor.nudge("left");
  expect(editor.getState().historyDepth).toBe(1);
  const captured = editor.getConfig();
  const panel = createWarpPanelView({ document,
    onAction(action, value) {
      if (action === "warp-nudge-start") return editor.beginNudgeGesture();
      if (action === "warp-nudge") return editor.nudge(value.direction, value);
      if (action === "warp-nudge-end") return editor.endNudgeGesture();
      if (action === "warp-nudge-cancel") return editor.cancelNudgeGesture();
      return false;
    },
  });
  panel.update({ output: "left", nodeId: "left-keystone", editorState: { ...editor.getState(), config: editor.getConfig(), handles: editor.getControlPoints() } });
  const arrow = panel.element.querySelector('[data-action="warp-nudge"][data-direction="right"]');
  const down = new Event("pointerdown", { bubbles: true, cancelable: true }); Object.assign(down, { pointerId: 77, button: 0 }); arrow.dispatchEvent(down);
  vi.advanceTimersByTime(375);
  expect(editor.getState().adjusting).toBe(true);
  expect(editor.getConfig()).not.toEqual(captured);
  const changeCountAtTerminal = changes.length;

  if (terminal === "blur") window.dispatchEvent(new Event("blur"));
  else {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  expect(editor.getState()).toMatchObject({ adjusting: false, historyDepth: 1 });
  expect(editor.getConfig().outputs.left.warp).toEqual(captured.outputs.left.warp);
  const changesAfterCancel = changes.length;
  expect(changesAfterCancel).toBeGreaterThanOrEqual(changeCountAtTerminal);
  vi.advanceTimersByTime(225);
  const up = new Event("pointerup", { bubbles: true }); Object.assign(up, { pointerId: 77 }); arrow.dispatchEvent(up);
  arrow.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  expect(changes).toHaveLength(changesAfterCancel);
  expect(editor.getState()).toMatchObject({ adjusting: false, historyDepth: 1 });
  expect(editor.getConfig().outputs.left.warp).toEqual(captured.outputs.left.warp);
  expect(panel.element.querySelector('[data-action="warp-undo"]').disabled).toBe(false);
  panel.dispose();
  if (terminal === "visibilitychange") Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

test("foreign replacement retires nudge timers and pad capture; own acknowledgment retains one undo", () => {
  vi.useFakeTimers();
  const changes = [];
  const editor = createWarpEditor({ config: structuredClone(DEFAULT_PROJECTION_CONFIG), onChange: (_config, meta) => changes.push(meta) });
  const panel = createWarpPanelView({ document,
    onAction(action, value) {
      if (action === "warp-nudge-start") return editor.beginNudgeGesture();
      if (action === "warp-nudge") return editor.nudge(value.direction, value);
      if (action === "warp-nudge-end") return editor.endNudgeGesture();
      if (action === "warp-nudge-cancel") return editor.cancelNudgeGesture();
      return false;
    },
    onPointer(phase, value) {
      if (phase === "start") return editor.pointerStart(value);
      if (phase === "move") return editor.pointerMove(value);
      if (phase === "end") { editor.pointerMove(value); return editor.pointerEnd(); }
      if (phase === "cancel") return editor.pointerCancel();
    },
  });
  const state = () => ({ ...editor.getState(), config: editor.getConfig(), handles: editor.getControlPoints() });
  panel.update({ output: "left", nodeId: "left-keystone", editorState: state() });
  const start = editor.getConfig();
  const arrow = panel.element.querySelector('[data-action="warp-nudge"][data-direction="right"]');
  const down = new Event("pointerdown", { bubbles: true, cancelable: true }); Object.assign(down, { pointerId: 12, button: 0 }); arrow.dispatchEvent(down);
  vi.advanceTimersByTime(350);
  expect(editor.getState().adjusting).toBe(true);
  const afterTick = changes.length;
  const foreign = structuredClone(DEFAULT_PROJECTION_CONFIG); foreign.outputs.left.warp.keystone.corners[0][0] = 0.02;
  editor.setConfig(foreign, { rebase: true }); panel.retireGestures();
  vi.advanceTimersByTime(500);
  const up = new Event("pointerup", { bubbles: true }); Object.assign(up, { pointerId: 12 }); arrow.dispatchEvent(up);
  expect(changes).toHaveLength(afterTick);
  expect(editor.getState()).toMatchObject({ adjusting: false, historyDepth: 0 });
  expect(editor.getConfig().outputs.left.warp.keystone.corners[0][0]).toBe(0.02);
  panel.update({ output: "left", nodeId: "left-keystone", editorState: state() });
  const pad = panel.controls.relativePad;
  pad.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 200 });
  const padDown = new Event("pointerdown", { bubbles: true, cancelable: true }); Object.assign(padDown, { pointerId: 14, button: 0, clientX: 100, clientY: 100 }); pad.dispatchEvent(padDown);
  const padMove = new Event("pointermove", { bubbles: true }); Object.assign(padMove, { pointerId: 14, clientX: 101, clientY: 100 }); pad.dispatchEvent(padMove);
  const afterPadMove = changes.length;
  const secondForeign = structuredClone(DEFAULT_PROJECTION_CONFIG); secondForeign.outputs.left.warp.keystone.corners[0][1] = 0.02;
  editor.setConfig(secondForeign, { rebase: true }); panel.retireGestures();
  const latePadUp = new Event("pointerup", { bubbles: true }); Object.assign(latePadUp, { pointerId: 14, clientX: 101, clientY: 100 }); pad.dispatchEvent(latePadUp);
  expect(changes).toHaveLength(afterPadMove);
  expect(editor.getConfig().outputs.left.warp.keystone.corners[0][1]).toBe(0.02);

  const ownEditor = createWarpEditor({ config: structuredClone(DEFAULT_PROJECTION_CONFIG) });
  const ownPanel = createWarpPanelView({ document,
    onAction(action, value) {
      if (action === "warp-nudge-start") return ownEditor.beginNudgeGesture();
      if (action === "warp-nudge") return ownEditor.nudge(value.direction, value);
      if (action === "warp-nudge-end") return ownEditor.endNudgeGesture();
      return false;
    },
  });
  ownPanel.update({ output: "left", nodeId: "left-keystone", editorState: { ...ownEditor.getState(), config: ownEditor.getConfig(), handles: ownEditor.getControlPoints() } });
  const ownStart = ownEditor.getConfig();
  const ownArrow = ownPanel.element.querySelector('[data-action="warp-nudge"][data-direction="right"]');
  const ownDown = new Event("pointerdown", { bubbles: true, cancelable: true }); Object.assign(ownDown, { pointerId: 13, button: 0 }); ownArrow.dispatchEvent(ownDown);
  vi.advanceTimersByTime(350);
  expect(ownEditor.setConfig(ownEditor.getConfig(), { rebase: false })).toBe(true);
  expect(ownEditor.getState().adjusting).toBe(true);
  const ownUp = new Event("pointerup", { bubbles: true }); Object.assign(ownUp, { pointerId: 13 }); ownArrow.dispatchEvent(ownUp);
  expect(ownEditor.getState()).toMatchObject({ adjusting: false, historyDepth: 1 });
  expect(ownEditor.undo()).toBe(true);
  expect(ownEditor.getConfig().outputs.left.warp).toEqual(ownStart.outputs.left.warp);
  ownPanel.dispose(); panel.dispose();
});
