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
const makeView = ({ coarse = true, small = false, onField = vi.fn(), onNudge = vi.fn() } = {}) => {
  const mediaListeners = new Set();
  let smallMediaQuery;
  window.matchMedia = vi.fn((query) => {
    const result = { matches: query.includes("max-width: 359px") ? small : coarse && (query.includes("pointer: coarse") || query.includes("hover: none")), addEventListener(_type, listener) { mediaListeners.add(listener); }, removeEventListener(_type, listener) { mediaListeners.delete(listener); } };
    if (query.includes("max-width: 359px")) smallMediaQuery = result;
    return result;
  });
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
  return { root, view, onAction, onOutputAction, onNode, onWarpAction, onWarpPointer, onField, onNudge, update, setSmallWidth(value) { small = value; if (smallMediaQuery) smallMediaQuery.matches = value; for (const listener of mediaListeners) listener({ matches: value }); } };
};
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

test("warp editor keeps Undo and Redo visible with point, step, nudge, and reset controls", () => {
  const { root, view, onWarpAction, update } = makeView();
  const editor = createWarpEditor({ config: DEFAULT_PROJECTION_CONFIG, output: "left" });
  update({ selectedNode: "left-keystone", warpStates: { left: { ...editor.getState(), historyDepth: 1, redoDepth: 1, config: editor.getConfig(), handles: editor.getControlPoints() } } });
  root.querySelector(".config-node[data-node='left-keystone'] .warp-open-button").click();
  const primary = root.querySelector(".warp-editor-fine-panel .warp-fine-primary");
  expect(primary.contains(root.querySelector(".warp-step"))).toBe(true);
  expect(primary.contains(root.querySelector(".warp-arrows"))).toBe(true);
  const undo = primary.querySelector('[data-warp-action="warp-undo"]');
  expect(undo).toBeNull();
  expect(view.controls.warpUndo.parentElement.className).toBe("warp-history-command-group");
  expect(view.controls.warpRedo.parentElement).toBe(view.controls.warpUndo.parentElement);
  const navigation = view.controls.warpUndo.parentElement.parentElement;
  expect(navigation.className).toBe("warp-view-controls");
  const viewGroup = navigation.querySelector(".warp-view-command-group");
  expect(viewGroup.role).toBe("group");
  expect(viewGroup.getAttribute("aria-label")).toBe("Move view, zoom, and fit");
  expect(Array.from(viewGroup.children, (item) => item.textContent)).toEqual(["Move view", "−", "+", "Fit"]);
  expect(root.querySelectorAll('[data-warp-action="warp-undo"]')).toHaveLength(1);
  expect(root.querySelectorAll('[data-warp-action="warp-redo"]')).toHaveLength(1);
  expect(root.querySelector('[data-warp-action="warp-reset-selection"]').textContent).toBe("Reset point");
  expect(root.querySelector(".warp-selection")).toBeNull();
  view.controls.warpUndo.click();
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

test("rendered warp handles keep navigation and CSS radii through draft refresh, reopen, resize, and orientation", () => {
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
  const pan = root.querySelector(".warp-pan-toggle"); pan.click();
  const noWrites = [onAction, onWarpAction, onWarpPointer].map((callback) => callback.mock.calls.length);

  root.querySelector("[data-action='warp-editor-close']").click();
  root.querySelector(".config-node[data-node='left-keystone'] .warp-open-button").click();
  expect(surface.getAttribute("viewBox")).toBe(zoomed); expect(pan.getAttribute("aria-pressed")).toBe("true");
  window.dispatchEvent(new Event("resize"));
  expect(surface.getAttribute("viewBox")).toBe(zoomed); expect(pan.getAttribute("aria-pressed")).toBe("true");
  window.dispatchEvent(new Event("orientationchange"));
  expect(surface.getAttribute("viewBox")).toBe(zoomed); expect(pan.getAttribute("aria-pressed")).toBe("true");
  expect(selected().dataset.index).toBe("0");
  expect(selected().getAttribute("cx")).toBe(String(refreshedHandles[0].x * 1920));
  expect(screenRadius()).toBeCloseTo(18);
  root.querySelector(".warp-view-fit").click();
  expect(surface.getAttribute("viewBox")).toBe("-72 -72 2064 1224"); expect(pan.getAttribute("aria-pressed")).toBe("false");
  expect(screenRadius()).toBeCloseTo(18);
  expect([onAction, onWarpAction, onWarpPointer].map((callback) => callback.mock.calls.length)).toEqual(noWrites);
});

test("category shortcuts call actual graph node groups and leave every node mounted", () => {
  const { root, view, onNode } = makeView({ coarse: false });
  const categories = [...root.querySelectorAll(".config-category-actions button")];
  expect(categories.map((item) => item.textContent)).toEqual(["Geometry", "Overlays", "Names"]);
  expect(categories.map((item) => item.dataset.focusNodes.split(" "))).toEqual([
    ["pre", "left-crop", "right-crop", "left-fit", "right-fit", "left-keystone", "right-keystone", "left-grid", "right-grid", "left-output", "right-output"],
    ["clock-gis", "nova-explainers", "clock-projection"],
    ["names-wall", "settlement-names"],
  ]);
  categories.find((item) => item.textContent === "Overlays").click();
  expect(onNode).not.toHaveBeenCalled();
  expect(root.querySelectorAll(".config-node")).toHaveLength(17);
  expect(root.querySelector(".node-selector")).toBeNull();
  expect(root.querySelector('[data-action="warp-editor-open-mobile"]')).toBeNull();
  expect(root.querySelectorAll(".config-action-row button")).toHaveLength(5);
  expect(root.querySelector('[data-action="export"]')).toBeNull();
  expect(root.querySelector('[data-action="share"]')).toBeNull();
  expect(root.querySelector('[data-action="output-open-left"]')).toBeNull();
  expect(root.querySelector('[data-action="output-open-right"]')).toBeNull();
  expect(root.querySelector(".inspector")).toBeNull();
  expect(view.nodeMap.has("settlement-names")).toBe(true);
});

test("Adjust opens the descriptor set for Shared transform and each Crop/Fit node", () => {
  const { root, view } = makeView({ coarse: false });
  const expected = new Map([
    ["pre", ["pre.scale", "pre.rotateDeg", "pre.tx", "pre.ty"]],
    ["left-crop", ["outputs.left.crop.x0", "outputs.left.crop.x1", "outputs.left.crop.y0", "outputs.left.crop.y1"]],
    ["right-crop", ["outputs.right.crop.x0", "outputs.right.crop.x1", "outputs.right.crop.y0", "outputs.right.crop.y1"]],
    ["left-fit", ["outputs.left.post.scale", "outputs.left.post.tx", "outputs.left.post.ty"]],
    ["right-fit", ["outputs.right.post.scale", "outputs.right.post.tx", "outputs.right.post.ty"]],
  ]);
  for (const [nodeId, paths] of expected) {
    const adjust = view.nodeMap.get(nodeId).querySelector('[data-action="parameter-editor-open"]');
    expect(adjust.textContent).toBe("Adjust");
    adjust.click();
    const dialog = root.querySelector(".parameter-editor-dialog");
    expect(dialog.dataset.node).toBe(nodeId);
    expect([...dialog.querySelectorAll(".parameter-editor-field")].map((field) => field.dataset.path)).toEqual(paths);
    expect([...dialog.querySelectorAll('input[type="number"]')].every((input) => input.value !== "")).toBe(true);
    expect(root.querySelectorAll(".parameter-preview-frame").length).toBe(nodeId === "pre" ? 2 : 1);
    view.parameterDialog.close();
  }
  view.dispose();
});

test("an open Shared Adjust preview receives the latest full view draft on both sides", () => {
  const { root, view, update } = makeView({ coarse: false });
  const initial = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const changed = structuredClone(initial);
  changed.pre.scale = 1.5;
  changed.outputs.left.crop.x0 = 0.12;
  update({ state: { draft: initial, snapshot: { config: initial, presets }, selectedPresetId: "original" } });
  view.nodeMap.get("pre").querySelector('[data-action="parameter-editor-open"]').click();
  const frames = [...root.querySelectorAll(".parameter-editor-dialog iframe")];
  expect(frames.map((frame) => new URL(frame.src).searchParams.get("span"))).toEqual(["left", "right"]);
  const sends = frames.map((frame) => vi.spyOn(frame.contentWindow, "postMessage"));
  frames.forEach((frame, index) => window.dispatchEvent(new MessageEvent("message", {
    origin: location.origin, source: frame.contentWindow,
    data: { type: "otef_projection_preview_ready", output: index === 0 ? "left" : "right" },
  })));
  expect(sends.map((send) => send.mock.calls[0][0].config)).toEqual([initial, initial]);

  update({ state: { draft: changed, snapshot: { config: initial, presets }, selectedPresetId: "original" } });
  expect(sends.every((send) => send.mock.calls.length === 2)).toBe(true);
  expect(sends.map((send) => send.mock.calls[1][0])).toEqual([
    expect.objectContaining({ type: "otef_projection_preview_config", output: "left", config: changed }),
    expect.objectContaining({ type: "otef_projection_preview_config", output: "right", config: changed }),
  ]);
  view.dispose();
});

test("keyboard activation selects and nudges a noninitial corner and grid point", () => {
  const { root, view, onWarpAction, update } = makeView({ coarse: false });
  const exercise = ({ output, nodeId, mode, index, selection }) => {
    const editor = createWarpEditor({ config: DEFAULT_PROJECTION_CONFIG, output });
    editor.setMode(mode);
    update({ selectedNode: nodeId, warpStates: { [output]: { ...editor.getState(), config: editor.getConfig(), handles: editor.getControlPoints() } } });
    root.querySelector(`.config-node[data-node='${nodeId}'] .warp-open-button`).click();
    const marker = root.querySelector(`.warp-handle[data-index='${index}']`);
    marker.focus();
    marker.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(onWarpAction).toHaveBeenLastCalledWith("warp-select", { output, selection: { ...selection, mode } });
    editor.select(selection);
    update({ selectedNode: nodeId, warpStates: { [output]: { ...editor.getState(), config: editor.getConfig(), handles: editor.getControlPoints() } } });
    const focused = document.activeElement;
    expect(focused.getAttribute("data-index")).toBe(String(index));
    focused.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    expect(onWarpAction).toHaveBeenLastCalledWith("warp-nudge", { direction: "right", coarse: false, fine: false });
    root.querySelector("[data-action='warp-editor-close']").click();
  };
  exercise({ output: "left", nodeId: "left-keystone", mode: "keystone", index: 2, selection: { kind: "corner", index: 2 } });
  exercise({ output: "right", nodeId: "right-grid", mode: "grid", index: 24, selection: { kind: "point", index: 24 } });
  view.dispose();
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
  const panels = [...root.querySelectorAll("details.config-tools")];
  expect(panels.map((panel) => panel.querySelector("summary").textContent.trim())).toEqual(["Tools"]);
  for (const panel of panels) {
    panel.querySelector("summary").click();
    expect(panel.open).toBe(true);
    expect(panels.filter((other) => other !== panel && other.open)).toHaveLength(0);
  }
  expect(root.querySelector(".action-error").textContent).toContain("Preset load failed");
  expect(root.querySelector(".action-error").hidden).toBe(false);
});

test("overlay dismissal preserves drafts and the correct focus owner", () => {
  const { root } = makeView({ coarse: false });
  const presetPanel = root.querySelector(".config-tools");
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
  expect(graphDragStarted).toBe(true);
  trigger.click();
  const destination = root.querySelector(".config-alerts");
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
  update({ selectedNode: "left-keystone", warpStates: { left: { ...editor.getState(), historyDepth: 1, redoDepth: 1, config: editor.getConfig(), handles: editor.getControlPoints() } } });
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

test("Run names force-sends the applied config only after calibration applies", () => {
  const { root, view, update } = makeView({ coarse: false });
  const editor = createWarpEditor({ config: DEFAULT_PROJECTION_CONFIG, output: "left" });
  update({ selectedNode: "left-keystone", warpStates: { left: { ...editor.getState(), historyDepth: 1, redoDepth: 1, config: editor.getConfig(), handles: editor.getControlPoints() } } });
  root.querySelector(".config-node[data-node='left-keystone'] .warp-open-button").click();
  const frame = root.querySelector(".warp-editor-frame");
  const postMessage = vi.spyOn(frame.contentWindow, "postMessage");
  window.dispatchEvent(new MessageEvent("message", { data: { type: "otef_projection_preview_ready", output: "left" }, origin: window.location.origin, source: frame.contentWindow }));
  expect(postMessage).toHaveBeenCalledTimes(1);
  expect(frame.style.visibility).toBe("hidden");
  expect(view.sendRunNamesPreview(DEFAULT_PROJECTION_CONFIG)).toBe(false);
  const geometryRequestId = postMessage.mock.calls[0][0].requestId;
  window.dispatchEvent(new MessageEvent("message", { data: { type: "otef_projection_preview_applied", output: "left", requestId: geometryRequestId, success: true }, origin: window.location.origin, source: frame.contentWindow }));
  postMessage.mockClear();
  expect(frame.style.visibility).toBe("visible");
  expect(view.sendRunNamesPreview(DEFAULT_PROJECTION_CONFIG)).toBe(true);
  expect(view.sendRunNamesPreview(DEFAULT_PROJECTION_CONFIG)).toBe(true);
  expect(postMessage.mock.calls.map(([message]) => message)).toEqual([
    expect.objectContaining({ type: "otef_projection_preview_config", runNames: true, config: DEFAULT_PROJECTION_CONFIG, requestId: 2 }),
    expect.objectContaining({ type: "otef_projection_preview_config", runNames: true, config: DEFAULT_PROJECTION_CONFIG, requestId: 3 }),
  ]);
  window.dispatchEvent(new MessageEvent("message", { data: { type: "otef_projection_preview_applied", output: "left", requestId: 3, success: true }, origin: window.location.origin, source: frame.contentWindow }));
  expect(frame.style.visibility).toBe("visible");
});

test.each(["mouse", "coarse-pointer landscape", "portrait"])("%s workspace keeps every node in the shared graph", (surface) => {
  window.matchMedia = vi.fn((query) => ({ matches: surface === "coarse-pointer landscape" && query.includes("pointer: coarse") || surface === "portrait" && query.includes("orientation: portrait"), addEventListener() {}, removeEventListener() {} }));
  const root = document.createElement("main");
  document.body.appendChild(root);
  createProjectionConfigView(root, { descriptors: [...FIELD_DESCRIPTORS, ...NAMES_WALL_DESCRIPTORS] });
  const nodes = [...root.querySelectorAll(".config-node")].map((node) => node.dataset.node);
  expect(nodes).toContain("content");
  expect(nodes).toContain("clock-projection");
  expect(nodes).toContain("left-keystone");
  expect(nodes).toContain("right-grid");
  expect(nodes).toContain("settlement-names");
  expect(root.querySelector(".node-graph-viewport").hidden).toBe(false);
  expect(root.querySelector(".node-selector")).toBeNull();
});

test("preset and display setup failures stay visible from collapsed disclosures", () => {
  const { root, update, onAction } = makeView();
  update({ errors: { name: "Preset save failed" }, outputState: { error: "Display assignment failed" } });

  const tools = root.querySelector(".config-tools");
  const indicator = tools.querySelector("summary .disclosure-error-indicator");
  expect(indicator.className).toBe("disclosure-error-indicator");
  expect(indicator.getAttribute("aria-label")).toBe("Tools contains an unresolved error");
  expect(indicator.hidden).toBe(false);
  expect(root.querySelector(".action-error").hidden).toBe(false);
  expect(root.querySelector(".action-error").textContent).toContain("Preset save failed");

  expect(root.querySelector(".config-command-bar").contains(tools)).toBe(true);
  expect([...tools.querySelectorAll(".config-tools-section h2")].map((heading) => heading.textContent)).toContain("Apply and load");
  tools.querySelector("summary").click();
  expect(tools.querySelector(".disclosure-error-details").hidden).toBe(false);
  expect(tools.querySelector(".disclosure-error-details").textContent).toContain("Preset save failed");
  expect(tools.querySelector(".disclosure-error-details").textContent).toContain("Display assignment failed");
  expect(onAction).not.toHaveBeenCalled();
});

test("preset creation remains available alongside preset selection and save", () => {
  const { root, view } = makeView();
  expect(root.contains(view.controls.save)).toBe(true);
  expect(root.contains(view.controls.presets)).toBe(true);
  expect(root.contains(view.controls.load)).toBe(true);
  expect(root.contains(view.controls.saveName)).toBe(true);
  expect(root.contains(view.controls.saveNew)).toBe(true);
  const presetHelp = root.querySelector(".preset-scope-help").textContent;
  expect(presetHelp).toContain("geometry");
  expect(presetHelp).toContain("people-wall");
  expect(presetHelp).toContain("Clock");
  expect(presetHelp).toContain("settlement");
});

test("touch-capable workstation output actions dispatch only both-window commands", () => {
  const { root, view, onOutputAction } = makeView();
  expect(view.controls.outputOpenBoth.disabled).toBe(false);
  expect(view.controls.outputCloseBoth.disabled).toBe(false);
  expect(root.querySelector('[data-action="output-open-left"]')).toBeNull();
  expect(root.querySelector('[data-action="output-open-right"]')).toBeNull();
  view.controls.outputOpenBoth.click();
  view.controls.outputCloseBoth.click();
  expect(onOutputAction.mock.calls.map(([action]) => action)).toEqual(["open", "close"]);
});

test("unsupported browser shows output guidance outside the collapsed Tools disclosure", () => {
  const { root, view, update } = makeView();
  const displaySetup = root.querySelector(".config-tools");
  expect(displaySetup.open).toBe(false);
  update({ outputState: { supported: false, message: "Display management unavailable in this browser." } });
  expect(view.controls.outputOpenBoth.disabled).toBe(true);
  expect(view.controls.outputCloseBoth.disabled).toBe(true);
  const notice = root.querySelector(".output-capability-notice");
  expect(notice.hidden).toBe(false);
  expect(notice.closest(".config-alerts")).not.toBeNull();
  expect(displaySetup.contains(notice)).toBe(false);
  expect(notice.textContent).toMatch(/open\/close outputs on the workstation/i);
});

test("supported browser hides the workstation-only output capability notice", () => {
  const { root, update } = makeView();
  update({ outputState: { supported: true, message: "Identify displays on the workstation." } });
  expect(root.querySelector(".output-capability-notice").hidden).toBe(true);
});

test("Adjust slider commits its formatted local value before a synchronous refresh", () => {
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
  fixture.view.nodeMap.get("pre").querySelector('[data-action="parameter-editor-open"]').click();
  const wrap = fixture.root.querySelector('.parameter-editor-dialog [data-field="pre.tx"]').closest(".config-field");
  control = { wrap, range: wrap.querySelector('input[type="range"]'), number: wrap.querySelector('input[type="number"]'), value: wrap.querySelector(".config-field-value") };
  expect(control.wrap.classList.contains("parameter-field-layout")).toBe(true);
  control.range.value = "125";
  control.range.dispatchEvent(new Event("input", { bubbles: true }));
  expect(onField).toHaveBeenCalledWith("pre.tx", "125", "range");
  expect(control.number.value).toBe("125.00");
  expect(control.value.textContent).toBe("125.00 %");
});

test("release-commit slider previews locally and syncs its paired number on change", () => {
  const onField = vi.fn();
  const { view } = makeView({ coarse: false, onField });
  const control = view.fields.get("names-wall:namesWall.inwardShiftPercent");
  control.range.value = "50";
  control.range.dispatchEvent(new Event("input", { bubbles: true }));
  expect(control.value.textContent).toBe("50");
  expect(control.number.value).toBe("0");
  expect(onField).not.toHaveBeenCalled();
  control.range.dispatchEvent(new Event("change", { bubbles: true }));
  expect(control.number.value).toBe("50");
  expect(onField).toHaveBeenCalledTimes(1);
  expect(onField).toHaveBeenCalledWith("namesWall.inwardShiftPercent", "50", "range");
});

test("blank numeric values survive refresh without showing zero", () => {
  const { view, update } = makeView({ coarse: false });
  const control = view.fields.get("pre:pre.tx");
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
  const control = view.fields.get("pre:pre.tx");
  control.wrap.querySelector("[data-direction='-1']").click();
  expect(onNudge).toHaveBeenCalledTimes(1);
  expect(onNudge).toHaveBeenCalledWith("pre.tx", -1);
});

test("compact command header keeps all actions in two rows and one dismissible Tools panel", () => {
  const { root, view, onAction, onOutputAction, update } = makeView({ coarse: false });
  const header = root.querySelector(".config-command-bar");
  expect(header.children).toHaveLength(3);
  expect(header.querySelectorAll("details")).toHaveLength(1);
  const tools = header.querySelector("details.config-tools");
  expect(tools.querySelector("summary").textContent).toContain("Tools");
  expect(tools.contains(view.controls.apply)).toBe(true);
  expect(tools.contains(view.controls.load)).toBe(true);
  expect(tools.contains(view.controls.saveNew)).toBe(true);
  expect(tools.contains(view.controls.outputRefresh)).toBe(true);
  expect(header.querySelector(".config-action-row").contains(view.controls.outputOpenBoth)).toBe(true);
  expect(header.querySelector(".config-action-row").contains(view.controls.outputCloseBoth)).toBe(true);
  expect(view.controls.outputOpenBoth.textContent).toBe("Open both");
  expect(view.controls.outputCloseBoth.textContent).toBe("Close both");
  expect(view.controls.live.parentElement.parentElement.className).toBe("compact-live");
  expect(view.controls.live.getAttribute("aria-label")).toBe("Live");
  expect(view.controls.live.parentElement.textContent).toBe("Live");
  expect(view.controls.live.getAttribute("aria-describedby")).toBe("projection-apply-live-description");
  update({ state: { live: true } });
  expect(root.querySelector("#projection-apply-live-description").textContent).toBe("Live on. Changes update automatically.");
  update({ state: { live: false } });
  expect(root.querySelector("#projection-apply-live-description").textContent).toBe("Live off. Use Apply once in Tools, or Apply & save.");
  update({ statusText: "Saved" });
  expect(header.querySelector(".config-save-status").textContent).toContain("Saved");

  view.controls.presets.value = "td";
  view.controls.presets.dispatchEvent(new Event("change", { bubbles: true }));
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(onAction).toHaveBeenCalledWith("preset-select", "td");
  expect(view.controls.loadedPresetIdentity.textContent).toBe("Loaded: Original");
  view.controls.load.click();
  view.controls.apply.click();
  update({ loadedPresetId: "td", loadedPresetLoadToken: 2 });
  view.controls.save.click();
  view.controls.outputOpenBoth.click();
  view.controls.outputCloseBoth.click();
  expect(onAction.mock.calls).toEqual([["preset-select", "td"], ["load", "td"], ["apply"], ["save", "TD"]]);
  expect(onOutputAction.mock.calls).toEqual([["open", undefined], ["close", undefined]]);

  const trigger = tools.querySelector("summary");
  trigger.click();
  expect(tools.open).toBe(true);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(tools.open).toBe(false);
  expect(document.activeElement).toBe(trigger);
  update({ statusText: "Saving preset", state: { dirty: true } });
  expect(view.controls.status.textContent).toBe("Saving preset");
  expect(header.querySelector(".config-save-status").textContent).toContain("Saving");
  view.dispose();
});

test("narrow output relocation keeps the native button instances visible and focused", () => {
  const { root, view, setSmallWidth } = makeView({ coarse: false });
  const open = view.controls.outputOpenBoth;
  const tools = view.controls.tools;
  open.focus();
  setSmallWidth(true);
  expect(tools.open).toBe(true);
  expect(root.querySelector(".tools-output-commands").contains(open)).toBe(true);
  expect(document.activeElement).toBe(open);
  setSmallWidth(false);
  expect(root.querySelector(".output-command-actions").contains(open)).toBe(true);
  expect(document.activeElement).toBe(open);
  view.dispose();
});

test("Tools repeats the controller output acknowledgement when the compact summary is omitted", () => {
  const { root, view, update } = makeView({ coarse: false });
  update({
    appliedSummary: "Unconfirmed",
    statusRows: [{ output: "left", instanceId: "left-1", success: true, text: "Left output applied" }],
  });
  expect(view.controls.appliedSummary.textContent).toBe("Outputs: unconfirmed");
  expect(root.querySelector(".tools-applied-summary").textContent).toBe("Outputs: unconfirmed");
  expect(root.querySelector(".tools-applied-summary").parentElement.querySelector(".applied-details").textContent).toContain("Left output applied");
  view.dispose();
});

test("actionable banner includes simultaneous preset, display, and action errors once", () => {
  const { root, update } = makeView({ coarse: false });
  update({
    errors: { name: "Shared failure", action: "Shared failure" },
    outputState: { error: "Display assignment failed" },
  });
  const banner = root.querySelector(".action-error");
  expect(banner.textContent).toContain("Preset management: Shared failure");
  expect(banner.textContent).toContain("Display setup: Display assignment failed");
  expect(banner.textContent).not.toMatch(/Shared failure.*Shared failure/);
  expect(banner.hidden).toBe(false);
});

test("Save follows the acknowledged checkpoint and explicit pending state", () => {
  const { view, update } = makeView({ coarse: false });
  const customDraft = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const snapshot = { config: customDraft, presets, selectedPresetId: "original" };

  update({ state: { draft: customDraft, snapshot, selectedPresetId: "original" }, loadedPresetId: "td", loadedPresetLoadToken: 2 });
  expect(view.controls.loadedPresetIdentity.textContent).toBe("Loaded: TD");
  expect(view.controls.save.disabled).toBe(false);
  view.controls.presets.value = "original";
  view.controls.presets.dispatchEvent(new Event("change", { bubbles: true }));
  expect(view.controls.save.disabled).toBe(false);

  update({ state: { draft: customDraft, snapshot, selectedPresetId: "original" }, loadedPresetId: "original", loadedPresetLoadToken: 3 });
  expect(view.controls.save.disabled).toBe(true);
  expect(view.controls.saveNew.disabled).toBe(false);
  expect(view.controls.tools.querySelector(".original-checkpoint-guidance").textContent).toContain("Original is immutable");

  update({ state: { draft: customDraft, snapshot, selectedPresetId: "td" }, loadedPresetId: "td", loadedPresetLoadToken: 4, savePending: true });
  expect(view.controls.save.disabled).toBe(true);
  expect(view.controls.saveNew.disabled).toBe(true);
  view.dispose();
});
