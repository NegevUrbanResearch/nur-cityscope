// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { createProjectionConfigView } from "../../frontend/src/projection-config/config-view.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { FIELD_DESCRIPTORS, NAMES_WALL_DESCRIPTORS } from "../../frontend/src/projection-config/config-controller.js";
import { fitWarpViewport, warpPointFromClient } from "../../frontend/src/projection-config/warp-viewport.js";
import { createWarpEditor } from "../../frontend/src/projection-config/warp-editor.js";

const presets = [
  { id: "original", name: "Original", readOnly: true },
  { id: "td", name: "TD" },
  { id: "custom", name: "Workshop" },
];
const makeView = ({ coarse = true, onField = vi.fn(), onNudge = vi.fn() } = {}) => {
  window.matchMedia = vi.fn((query) => ({ matches: coarse && (query.includes("pointer: coarse") || query.includes("hover: none")), addEventListener() {}, removeEventListener() {} }));
  const root = document.createElement("main");
  document.body.appendChild(root);
  const onAction = vi.fn();
  const onOutputAction = vi.fn();
  const onNode = vi.fn();
  const onWarpAction = vi.fn();
  const onWarpPointer = vi.fn();
  const view = createProjectionConfigView(root, {
    descriptors: [...FIELD_DESCRIPTORS, ...NAMES_WALL_DESCRIPTORS], onAction, onOutputAction, onNode,
    onWarpAction, onWarpPointer, onOpenClockEditor: vi.fn(), onField, onNudge,
  });
  const update = (extra = {}) => view.update({
    state: { draft: structuredClone(DEFAULT_PROJECTION_CONFIG), snapshot: { config: structuredClone(DEFAULT_PROJECTION_CONFIG), presets, selectedPresetId: "original" }, selectedPresetId: "original" },
    selectedNode: "pre", loadedPresetId: "original", loadedPresetLoadToken: 1, ...extra,
  });
  update();
  return { root, view, onAction, onOutputAction, onNode, onWarpAction, onWarpPointer, onField, onNudge, update };
};
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

test("touch primary warp controls include selection, step, nudges, and the single working Undo action", () => {
  const { root, view, onWarpAction, update } = makeView();
  const editor = createWarpEditor({ config: DEFAULT_PROJECTION_CONFIG, output: "left" });
  update({ selectedNode: "left-keystone", warpStates: { left: { ...editor.getState(), config: editor.getConfig(), handles: editor.getControlPoints() } } });
  root.querySelector(".config-node[data-node='left-keystone'] .warp-open-button").click();
  const primary = root.querySelector(".warp-editor-fine-panel .warp-fine-primary");
  expect(primary.contains(root.querySelector(".warp-selection"))).toBe(true);
  expect(primary.contains(root.querySelector(".warp-step"))).toBe(true);
  expect(primary.contains(root.querySelector(".warp-arrows"))).toBe(true);
  const undo = primary.querySelector('[data-warp-action="warp-undo"]');
  expect(undo).not.toBeNull();
  expect(view.controls.warpUndo).toBe(undo);
  expect(root.querySelectorAll('[data-warp-action="warp-undo"]')).toHaveLength(1);
  undo.click();
  expect(onWarpAction).toHaveBeenCalledWith("warp-undo", {});
});

test("warp preview navigation changes the one viewBox without dispatching edits", () => {
  const { root, onAction, onWarpAction, onWarpPointer, update } = makeView({ coarse: false });
  const handles = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }];
  update({ selectedNode: "left-keystone", warpStates: { left: { config: DEFAULT_PROJECTION_CONFIG, handles, selection: { mode: "keystone", kind: "corner", index: 0, indices: [0] } } } });
  root.querySelector(".config-node[data-node='left-keystone'] .warp-open-button").click();
  const surface = root.querySelector(".warp-edit-surface");
  surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400 });
  const fitBox = surface.getAttribute("viewBox");
  surface.dispatchEvent(new WheelEvent("wheel", { clientX: 300, clientY: 200, deltaY: -100, bubbles: true, cancelable: true }));
  const zoomedBox = surface.getAttribute("viewBox");
  expect(zoomedBox).not.toBe(fitBox);
  expect(root.querySelector(".warp-editor-dialog .warp-editor-viewport").querySelector(".warp-editor-frame")).not.toBeNull();
  update({ selectedNode: "left-keystone", warpStates: { left: { config: DEFAULT_PROJECTION_CONFIG, handles, selection: { mode: "keystone", kind: "corner", index: 0, indices: [0] } } } });
  expect(surface.getAttribute("viewBox")).toBe(zoomedBox);
  expect(root.querySelector(".warp-editor-frame")).not.toBeNull();
  expect(root.querySelector(".warp-pan-toggle")).not.toBeNull();
  expect(onAction).not.toHaveBeenCalled();
  expect(onWarpAction).not.toHaveBeenCalled();
  expect(onWarpPointer).not.toHaveBeenCalled();
  root.querySelector(".warp-view-fit").click();
  expect(surface.getAttribute("viewBox")).toBe(fitBox);
  for (let index = 0; index < 30; index += 1) surface.dispatchEvent(new WheelEvent("wheel", { clientX: 300, clientY: 200, deltaY: -100, bubbles: true, cancelable: true }));
  let box = surface.getAttribute("viewBox").split(" ").map(Number);
  expect(box[2]).toBeGreaterThanOrEqual(Number(fitBox.split(" ")[2]) / 8);
  const anchorBeforeLimit = surface.getAttribute("viewBox").split(" ").map(Number);
  const anchorRect = { left: 0, top: 0, width: 600, height: 400 };
  const worldAtCursor = warpPointFromClient({ clientX: 100, clientY: 100 }, anchorRect, { x: anchorBeforeLimit[0], y: anchorBeforeLimit[1], width: anchorBeforeLimit[2], height: anchorBeforeLimit[3] });
  surface.dispatchEvent(new WheelEvent("wheel", { clientX: 100, clientY: 100, deltaY: -100, bubbles: true, cancelable: true }));
  const anchorAtLimit = surface.getAttribute("viewBox").split(" ").map(Number);
  const worldAtLimit = warpPointFromClient({ clientX: 100, clientY: 100 }, anchorRect, { x: anchorAtLimit[0], y: anchorAtLimit[1], width: anchorAtLimit[2], height: anchorAtLimit[3] });
  expect(worldAtLimit.x).toBeCloseTo(worldAtCursor.x, 6);
  expect(worldAtLimit.y).toBeCloseTo(worldAtCursor.y, 6);
  for (let index = 0; index < 60; index += 1) surface.dispatchEvent(new WheelEvent("wheel", { clientX: 300, clientY: 200, deltaY: 100, bubbles: true, cancelable: true }));
  box = surface.getAttribute("viewBox").split(" ").map(Number);
  expect(box[2]).toBeLessThanOrEqual(Number(fitBox.split(" ")[2]) * 2);
  root.querySelector(".warp-view-fit").click();
  const fitWidth = Number(surface.getAttribute("viewBox").split(" ")[2]);
  root.querySelector(".warp-view-zoom-in").click();
  const plusWidth = Number(surface.getAttribute("viewBox").split(" ")[2]);
  expect(plusWidth).toBeLessThan(fitWidth);
  root.querySelector(".warp-view-zoom-out").click();
  expect(Number(surface.getAttribute("viewBox").split(" ")[2])).toBeGreaterThan(plusWidth);
  root.querySelector("[data-action='warp-editor-close']").click();
  root.querySelector(".config-node[data-node='left-keystone'] .warp-open-button").click();
  expect(surface.getAttribute("viewBox")).toBe(fitBox);
});

test("warp preview plus zooms in and minus zooms out around the current center", () => {
  const { root, update } = makeView({ coarse: false });
  const handles = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }];
  update({ selectedNode: "left-keystone", warpStates: { left: { config: DEFAULT_PROJECTION_CONFIG, handles, selection: { mode: "keystone", kind: "corner", index: 0, indices: [0] } } } });
  root.querySelector(".config-node[data-node='left-keystone'] .warp-open-button").click();
  const surface = root.querySelector(".warp-edit-surface");
  root.querySelector(".warp-view-zoom-in").click();
  const zoomInWidth = Number(surface.getAttribute("viewBox").split(" ")[2]);
  root.querySelector(".warp-view-zoom-out").click();
  const zoomOutWidth = Number(surface.getAttribute("viewBox").split(" ")[2]);
  expect(zoomInWidth).toBeLessThan(2064);
  expect(zoomOutWidth).toBeGreaterThan(zoomInWidth);
});

test("rendered warp handles keep CSS radii through zoom, draft refresh, and orientation refit", () => {
  const { root, onAction, onWarpAction, onWarpPointer, update } = makeView({ coarse: false });
  const editor = createWarpEditor({ config: DEFAULT_PROJECTION_CONFIG, output: "left" });
  const handles = editor.getControlPoints();
  const selection = { mode: "keystone", kind: "corner", index: 0, indices: [0] };
  const warpStates = { left: { ...editor.getState(), config: editor.getConfig(), handles, selection } };
  update({ state: { draft: structuredClone(DEFAULT_PROJECTION_CONFIG) }, selectedNode: "left-keystone", warpStates });
  const surface = root.querySelector(".warp-edit-surface");
  expect(Number(surface.querySelector(".warp-handle.selected").getAttribute("r"))).toBe(18);
  surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 400, right: 600, bottom: 400 });
  const viewport = root.querySelector(".warp-editor-viewport");
  Object.defineProperties(viewport, { clientWidth: { configurable: true, value: 600 }, clientHeight: { configurable: true, value: 400 } });
  root.querySelector(".config-node[data-node='left-keystone'] .warp-open-button").click();
  const selected = () => surface.querySelector(".warp-handle.selected");
  const screenRadius = () => {
    const [x, y, width, height] = surface.getAttribute("viewBox").split(" ").map(Number);
    const scale = fitWarpViewport({ x, y, width, height }, 600, 400).scale;
    return Number(selected().getAttribute("r")) * scale;
  };
  expect(screenRadius()).toBeCloseTo(18);
  root.querySelector(".warp-view-zoom-in").click();
  expect(screenRadius()).toBeCloseTo(18);

  const refreshedHandles = handles.map((point, index) => index === 0 ? { x: point.x + 0.01, y: point.y } : point);
  update({ state: { draft: structuredClone(DEFAULT_PROJECTION_CONFIG) }, selectedNode: "left-keystone", warpStates: { left: { ...warpStates.left, handles: refreshedHandles } } });
  expect(screenRadius()).toBeCloseTo(18);
  expect(selected().getAttribute("cx")).toBe(String(refreshedHandles[0].x * 1920));
  const zoomed = surface.getAttribute("viewBox");
  const noWrites = [onAction, onWarpAction, onWarpPointer].map((callback) => callback.mock.calls.length);

  window.dispatchEvent(new Event("orientationchange"));
  expect(surface.getAttribute("viewBox")).toBe("-72 -72 2064 1224");
  expect(selected().dataset.index).toBe("0");
  expect(selected().getAttribute("cx")).toBe(String(refreshedHandles[0].x * 1920));
  expect(screenRadius()).toBeCloseTo(18);
  expect(zoomed).not.toBe(surface.getAttribute("viewBox"));
  expect([onAction, onWarpAction, onWarpPointer].map((callback) => callback.mock.calls.length)).toEqual(noWrites);
});

test("tablet task picker tracks the selected node without applying", () => {
  const { root, view, onNode, onAction, update } = makeView();
  const picker = root.querySelector(".node-selector");
  expect(picker).not.toBeNull();
  expect([...picker.options].map((option) => option.value)).toEqual(["content", "names-wall", "settlement-names", "clock-gis", "clock-projection", "pre", "left-crop", "right-crop", "left-fit", "right-fit", "left-keystone", "right-keystone", "left-grid", "right-grid", "left-output", "right-output"]);
  picker.value = "right-grid";
  picker.dispatchEvent(new Event("change", { bubbles: true }));
  expect(onNode).toHaveBeenCalledWith("right-grid");
  update({ selectedNode: "right-grid" });
  expect(picker.value).toBe("right-grid");
  expect(root.querySelector("iframe")).toBeNull();
  expect(onAction).not.toHaveBeenCalled();
});

test("preset selection remains pending until explicit Load", () => {
  const { root, view, onAction, update } = makeView({ coarse: false });
  const loaded = root.querySelector(".loaded-preset-identity");
  expect(loaded.textContent).toContain("Original");
  view.controls.presets.value = "td";
  view.controls.presets.dispatchEvent(new Event("change", { bubbles: true }));
  expect(onAction).toHaveBeenCalledWith("preset-select", "td");
  expect(loaded.textContent).toContain("Original");
  expect(onAction).not.toHaveBeenCalledWith("load", expect.anything());
  view.controls.load.click();
  expect(onAction).toHaveBeenCalledWith("load", "td");
  expect(view.controls.loadedPresetIdentity.textContent).toContain("Original");
  update({ loadedPresetId: "td", loadedPresetLoadToken: 2 });
  expect(loaded.textContent).toContain("TD");
});

test("top overlays open singly and retain error access", () => {
  const { root, update } = makeView();
  update({ errors: { action: "Preset load failed" } });
  const panels = [...root.querySelectorAll(".config-disclosure")];
  expect(panels.map((panel) => panel.querySelector("summary").textContent.trim())).toEqual(["Preset management", "More", "Workstation outputs"]);
  for (const panel of panels) {
    panel.querySelector("summary").click();
    expect(panel.open).toBe(true);
    expect(panels.filter((other) => other !== panel && other.open)).toHaveLength(0);
  }
  expect(root.querySelector(".action-error").textContent).toBe("Preset load failed");
  expect(root.querySelector(".action-error").hidden).toBe(false);
});

test("overlay dismissal preserves drafts and the correct focus owner", () => {
  const { root } = makeView({ coarse: false });
  const presetPanel = root.querySelector(".config-disclosure-preset");
  const trigger = presetPanel.querySelector("summary");
  trigger.click();
  trigger.focus();
  const name = root.querySelector("input[aria-label='Preset name']");
  name.value = "Unfinished draft";
  name.dispatchEvent(new Event("input", { bubbles: true }));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(presetPanel.open).toBe(false);
  expect(document.activeElement).toBe(trigger);
  expect(name.value).toBe("Unfinished draft");
  trigger.click();
  const nodeCard = root.querySelector(".config-node");
  let graphDragStarted = false;
  nodeCard.addEventListener("pointerdown", () => { graphDragStarted = true; });
  nodeCard.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  expect(presetPanel.open).toBe(false);
  expect(graphDragStarted).toBe(false);
  trigger.click();
  const destination = root.querySelector(".config-status");
  destination.tabIndex = 0;
  destination.focus();
  destination.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  expect(presetPanel.open).toBe(false);
  expect(document.activeElement).toBe(destination);
  expect(name.value).toBe("Unfinished draft");
});

test("closed utility disclosures do not block graph or warp pointerdown handlers", () => {
  const { root } = makeView({ coarse: false });
  let graphPointerdown = false;
  let warpPointerdown = false;
  const node = root.querySelector(".config-node");
  const surface = root.querySelector(".warp-edit-surface");
  node.addEventListener("pointerdown", () => { graphPointerdown = true; });
  surface.addEventListener("pointerdown", () => { warpPointerdown = true; });

  node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  surface.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

  expect(graphPointerdown).toBe(true);
  expect(warpPointerdown).toBe(true);
});

test("touch Move view enables one-finger preview panning", () => {
  const { root, onWarpAction, onWarpPointer, update } = makeView({ coarse: true });
  const editor = createWarpEditor({ config: DEFAULT_PROJECTION_CONFIG, output: "left" });
  update({ selectedNode: "left-keystone", warpStates: { left: { ...editor.getState(), config: editor.getConfig(), handles: editor.getControlPoints() } } });
  root.querySelector(".config-node[data-node='left-keystone'] .warp-open-button").click();
  const surface = root.querySelector(".warp-edit-surface");
  surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 540, right: 960, bottom: 540 });
  const moveView = root.querySelector(".warp-pan-toggle");
  expect(moveView.hidden).toBe(false);
  expect(moveView.textContent).toMatch(/move view/i);
  moveView.click();
  const start = surface.getAttribute("viewBox");
  surface.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 5, pointerType: "touch", isPrimary: true, button: 0, clientX: 300, clientY: 200, bubbles: true, cancelable: true }));
  surface.dispatchEvent(new PointerEvent("pointermove", { pointerId: 5, pointerType: "touch", isPrimary: true, clientX: 320, clientY: 210, bubbles: true, cancelable: true }));
  expect(surface.getAttribute("viewBox")).not.toBe(start);
  surface.dispatchEvent(new PointerEvent("pointerup", { pointerId: 5, pointerType: "touch", isPrimary: true, clientX: 320, clientY: 210, bubbles: true, cancelable: true }));
  expect(onWarpAction).not.toHaveBeenCalled();
  expect(onWarpPointer).not.toHaveBeenCalled();
});

test("warp status explains a rejected geometry move", () => {
  const { root, update } = makeView({ coarse: false });
  const editor = createWarpEditor({ config: DEFAULT_PROJECTION_CONFIG, output: "left" });
  update({ selectedNode: "left-keystone", warpStates: { left: { ...editor.getState(), config: editor.getConfig(), handles: editor.getControlPoints(), validationMessage: "Move rejected: keystone corners produce a singular homography" } } });
  root.querySelector(".config-node[data-node='left-keystone'] .warp-open-button").click();
  expect(root.querySelector(".warp-selection-status").textContent).toContain("Move rejected: keystone corners produce a singular homography");
});

test("portrait media query selects the compact inspector layout", () => {
  const queries = [];
  window.matchMedia = vi.fn((query) => {
    queries.push(query);
    return { matches: query.includes("orientation: portrait"), addEventListener() {}, removeEventListener() {} };
  });
  const root = document.createElement("main");
  document.body.appendChild(root);
  createProjectionConfigView(root, { descriptors: [...FIELD_DESCRIPTORS, ...NAMES_WALL_DESCRIPTORS] });
  expect(queries).toContain("(max-width: 1100px), (max-height: 700px), (pointer: coarse), (hover: none), (orientation: portrait)");
  expect(root.querySelector(".inspector").open).toBe(true);
});

test("utility failures stay scoped and remain visible from collapsed disclosures", () => {
  const { root, update, onAction } = makeView();
  update({ errors: { name: "Preset save failed", import: "Import failed" }, outputState: { error: "Display assignment failed" } });

  const preset = root.querySelector(".config-disclosure-preset");
  const more = root.querySelector(".config-disclosure-more");
  const outputs = root.querySelector(".config-disclosure-workstation");
  const indicator = preset.querySelector("summary .disclosure-error-indicator");
  expect(indicator.className).toBe("disclosure-error-indicator");
  expect(indicator.getAttribute("aria-label")).toBe("Unresolved error — open disclosure for details");
  expect(indicator.hidden).toBe(false);
  expect(more.querySelector("summary .disclosure-error-indicator").hidden).toBe(false);
  expect(outputs.querySelector("summary .disclosure-error-indicator").hidden).toBe(false);
  expect(root.querySelector(".action-error").hidden).toBe(true);

  for (const [panel, expected] of [[preset, "Preset save failed"], [more, "Import failed"], [outputs, "Display assignment failed"]]) {
    expect(root.querySelector(".config-command-bar .config-utilities").contains(panel)).toBe(true);
    expect(panel.querySelector("summary + .config-disclosure-content")).not.toBeNull();
    panel.querySelector("summary").click();
    const details = panel.querySelector(".disclosure-error-details");
    expect(details.hidden).toBe(false);
    expect(details.textContent).toContain(expected);
  }
  expect(onAction).not.toHaveBeenCalled();
});

test("scope help distinguishes Live geometry and preset contents", () => {
  const { root } = makeView();
  expect(root.querySelector(".live-scope-help").textContent).toContain("Live sends geometry");
  expect(root.querySelector(".live-scope-help").textContent).toContain("Run later");
  const presetHelp = root.querySelector(".preset-scope-help").textContent;
  expect(presetHelp).toContain("geometry");
  expect(presetHelp).toContain("people-wall");
  expect(presetHelp).toContain("Clock");
  expect(presetHelp).toContain("settlement");
});

test("workstation actions remain unavailable on touch", () => {
  const { root, view, onOutputAction } = makeView();
  const panel = root.querySelector(".config-disclosure-workstation");
  expect(panel.textContent).toContain("workstation-only");
  for (const control of [view.controls.outputIdentify, view.controls.outputAssign, view.controls.outputOpenBoth, view.controls.outputCloseBoth]) {
    expect(control.disabled).toBe(true);
    control.click();
  }
  expect(onOutputAction).not.toHaveBeenCalled();
});

test("inspector slider commits its formatted local value before a synchronous refresh", () => {
  let update;
  let control;
  const onField = vi.fn((path, raw, source) => {
    expect(control.value.textContent).toBe("125.00 %");
    expect(control.number.value).toBe("125.00");
    const draft = structuredClone(DEFAULT_PROJECTION_CONFIG);
    draft.pre.tx = Number(raw) / 100;
    update({ state: { draft } });
  });
  const fixture = makeView({ coarse: false, onField });
  ({ update } = fixture);
  control = fixture.view.fields.get("inspector:pre.tx");
  expect(control.wrap.querySelector(".config-field-range-row").contains(control.range)).toBe(true);
  control.range.value = "125";
  control.range.dispatchEvent(new Event("input", { bubbles: true }));
  expect(onField).toHaveBeenCalledWith("pre.tx", "125", "range");
  expect(control.number.value).toBe("125.00");
  expect(control.value.textContent).toBe("125.00 %");
});

test("release-commit slider previews locally and syncs its paired number on change", () => {
  const onField = vi.fn();
  const { view } = makeView({ coarse: false, onField });
  const control = view.fields.get("inspector:namesWall.inwardShiftPercent");
  control.range.value = "50";
  control.range.dispatchEvent(new Event("input", { bubbles: true }));
  expect(control.value.textContent).toBe("50 %");
  expect(control.number.value).toBe("0");
  expect(onField).not.toHaveBeenCalled();
  control.range.dispatchEvent(new Event("change", { bubbles: true }));
  expect(control.number.value).toBe("50");
  expect(onField).toHaveBeenCalledTimes(1);
  expect(onField).toHaveBeenCalledWith("namesWall.inwardShiftPercent", "50", "range");
});

test("blank numeric values survive refresh without showing zero", () => {
  const { view, update } = makeView({ coarse: false });
  const control = view.fields.get("inspector:pre.tx");
  control.number.focus();
  control.number.value = "";
  control.number.dispatchEvent(new Event("input", { bubbles: true }));
  expect(control.value.textContent).toBe("");
  update();
  expect(control.number.value).toBe("");
  expect(control.value.textContent).toBe("");
});

test("fine nudge calls the existing callback once with the field and direction", () => {
  const { view, onNudge } = makeView({ coarse: false });
  const control = view.fields.get("inspector:pre.tx");
  control.wrap.querySelector("[data-direction='-1']").click();
  expect(onNudge).toHaveBeenCalledTimes(1);
  expect(onNudge).toHaveBeenCalledWith("pre.tx", -1);
});
