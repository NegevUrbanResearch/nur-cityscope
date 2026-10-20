// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { createProjectionConfigView } from "../../frontend/src/projection-config/config-view.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { FIELD_DESCRIPTORS, NAMES_WALL_DESCRIPTORS } from "../../frontend/src/projection-config/config-controller.js";
import { createWarpEditor, gridSelection } from "../../frontend/src/projection-config/warp-editor.js";
import { createIdentityProjectionMesh } from "../../frontend/src/shared/projection-warp-geometry.js";

window.requestAnimationFrame = undefined;
window.cancelAnimationFrame = undefined;
function dispatchFixtureEvent(type, detail = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(detail)) if (!['currentTarget', 'target'].includes(key)) Object.defineProperty(event, key, { value });
  this.dispatchEvent(event);
}
window.HTMLElement.prototype.dispatch = dispatchFixtureEvent;
window.SVGElement.prototype.dispatch = dispatchFixtureEvent;
function makeNode(tag = 'div') {
  return tag === 'svg' || ['g', 'path', 'circle', 'line', 'text', 'rect'].includes(tag) ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
}


const views = [];
afterEach(() => { views.splice(0).forEach(view => view.dispose()); document.body.replaceChildren(); vi.restoreAllMocks(); });
function fittedView() {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const root = document.createElement('main'); document.body.appendChild(root);
  let selectedNode = 'pre';
  const draft = structuredClone(DEFAULT_PROJECTION_CONFIG);
  let view;
  const onNode = vi.fn(id => { selectedNode = id; update(); });
  const onField = vi.fn();
  view = createProjectionConfigView(root, { descriptors: [...FIELD_DESCRIPTORS, ...NAMES_WALL_DESCRIPTORS], onNode, onField }); views.push(view);
  function update(extra = {}) { view.update({ state: { draft, snapshot: { config: draft, presets: [] } }, selectedNode, ...extra }); }
  update(); return { root, view, onNode, onField, update, draft };
}

test('Content font controls retain keyboard focus during status refreshes', () => {
  const { root, view, update } = fittedView();
  view.activateNode('content');
  const font = root.querySelector('.config-selected-context select[data-font-language]');
  font.focus(); update();
  expect(document.activeElement).toBe(font);
});

test('Escape returns Content to its diagram and delegates external editor cancellation from the header', () => {
  const { root, view } = fittedView();
  view.activateNode('content');
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(root.querySelector('.config-navigation').dataset.view).toBe('diagram');
  view.activateNode('clock-gis');
  const editor = document.createElement('section'); editor.className = 'config-content-editor';
  let pending = true;
  editor.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (pending) pending = false; else view.showDiagram();
  });
  view.controls.editorRegion.appendChild(editor);
  root.querySelector('[data-action=apply]').focus();
  const escape = () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  escape(); expect(pending).toBe(false);
  expect(root.querySelector('.config-navigation').dataset.view).toBe('editor');
  escape(); expect(root.querySelector('.config-navigation').dataset.view).toBe('diagram');
});

test('diagram navigation exposes two categories and sixteen tools without output nodes', () => {
  const { root } = fittedView();
  expect([...root.querySelectorAll('[data-config-tab]')].map(tab => tab.textContent)).toEqual(['Image calibration', 'Content, names & overlays']);
  expect(root.querySelectorAll('[data-config-node]')).toHaveLength(16);
  expect(root.querySelector('[data-config-node="left-output"]')).toBeNull();
  root.querySelector('[data-config-tab="content"]').click();
  expect(root.querySelector('.config-diagram-content').hidden).toBe(false);
  expect(root.querySelector('.config-diagram-content').querySelectorAll('[data-config-node]')).toHaveLength(7);
  expect(root.querySelector('.graph-column').hidden).toBe(true);
});
test('a diagram card opens the fitted editor and the projector switch changes its scope', () => {
  const { root, view, onNode } = fittedView();
  root.querySelector('[data-config-node="left-fit"]').click();
  expect(view.parameterDialog.isOpen()).toBe(true);
  expect(view.parameterDialog.element.dataset.presentation).toBe('panel');
  expect(root.querySelector('[data-projector="left"]').getAttribute('aria-pressed')).toBe('true');
  root.querySelector('[data-projector="right"]').click();
  expect(onNode).toHaveBeenCalledWith('right-fit');
  expect(root.querySelector('[data-projector="right"]').getAttribute('aria-pressed')).toBe('true');
  root.querySelector('[data-config-back]').click();
  expect(root.querySelector('.config-navigation').dataset.view).toBe('diagram');
});
test('ordinary refresh preserves focused numeric text and does not publish an incomplete value', () => {
  const { root, view, update, onField } = fittedView();
  root.querySelector('[data-config-node="pre"]').click();
  const input = view.parameterDialog.element.querySelector('[data-field="pre.scale"][data-input="number"]');
  input.focus(); input.value = '1.'; input.dispatchEvent(new Event('input', { bubbles: true }));
  update();
  expect(document.activeElement).toBe(input); expect(input.value).toBe('1.');
  expect(onField).not.toHaveBeenCalled();
});
test("Content font selectors stay synchronized across graph and inspector during edit, preset load, and reload", () => {
  const make = makeNode;
  const doc = document;
  const root = make("main"); void (doc);
  const onNliFont = vi.fn();
  const view = createProjectionConfigView(root, { descriptors: [...FIELD_DESCRIPTORS, ...NAMES_WALL_DESCRIPTORS], onNliFont });
  const descendants = (node) => [node, ...Array.from(node.children || []).flatMap(descendants)];
  const graphChoices = descendants(view.nodeMap.get("content")).filter((node) => node.dataset?.fontLanguage);
  expect(graphChoices.map((node) => node.dataset.fontLanguage)).toEqual(["he", "en"]);
  const draft = structuredClone(DEFAULT_PROJECTION_CONFIG);
  draft.nliFonts = { he: "narkiss", en: "arial" };
  view.update({ state: { draft }, selectedNode: "content" });
  const selectedChoices = descendants(view.controls.editorRegion).filter((node) => node.dataset?.fontLanguage);
  expect(selectedChoices.map((node) => node.value)).toEqual(["narkiss", "arial"]);
  expect(graphChoices.map((node) => node.value)).toEqual(["narkiss", "arial"]);
  expect([...graphChoices[0].children].map((node) => node.value)).toEqual(["default", "guttman", "hadassah", "narkiss", "arial"]);
  expect([...graphChoices[1].children].map((node) => node.value)).toEqual(["hadassah", "narkiss", "arial", "belleza", "marcellus"]);
  graphChoices[0].value = "guttman"; graphChoices[0].dispatch("change");
  expect(onNliFont).toHaveBeenCalledWith("he", "guttman");
  draft.nliFonts = { ...draft.nliFonts, he: "guttman" };
  view.update({ state: { draft }, selectedNode: "content" });
  expect(graphChoices.map((node) => node.value)).toEqual(["guttman", "arial"]);
  expect(selectedChoices.map((node) => node.value)).toEqual(["guttman", "arial"]);
  selectedChoices[1].value = "belleza"; selectedChoices[1].dispatch("change");
  expect(onNliFont).toHaveBeenLastCalledWith("en", "belleza");
  draft.nliFonts = { he: "guttman", en: "belleza" };
  view.update({ state: { draft }, selectedNode: "content" });
  expect(graphChoices.map((node) => node.value)).toEqual(["guttman", "belleza"]);
  expect(selectedChoices.map((node) => node.value)).toEqual(["guttman", "belleza"]);
  graphChoices[1].value = "marcellus"; graphChoices[1].dispatch("change");
  expect(onNliFont).toHaveBeenLastCalledWith("en", "marcellus");
  draft.nliFonts = { he: "guttman", en: "marcellus" };
  view.update({ state: { draft }, selectedNode: "content" });
  expect(graphChoices.map((node) => node.value)).toEqual(["guttman", "marcellus"]);
  expect(selectedChoices.map((node) => node.value)).toEqual(["guttman", "marcellus"]);
  draft.nliFonts = { he: "default", en: "belleza" };
  view.update({ state: { draft }, selectedNode: "content", loadedPresetId: "preset-2", loadedPresetLoadToken: 1 });
  expect(graphChoices.map((node) => node.value)).toEqual(["default", "belleza"]);
  expect(selectedChoices.map((node) => node.value)).toEqual(["default", "belleza"]);
  draft.nliFonts = { he: "hadassah", en: "narkiss" };
  view.update({ state: { draft }, selectedNode: "content", loadedPresetId: "original", loadedPresetLoadToken: 2 });
  expect(graphChoices.map((node) => node.value)).toEqual(["hadassah", "narkiss"]);
  expect(selectedChoices.map((node) => node.value)).toEqual(["hadassah", "narkiss"]);
  expect(descendants(view.nodeMap.get("settlement-names")).some((node) => node.dataset?.field === "fontFamily")).toBe(false);
  view.dispose();
});

test("Names wall keeps controls editable and reports installed output status with Run action", () => {
  const make = makeNode;
  const root = make("main");
  void (document); window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const view = createProjectionConfigView(root, { descriptors: [...FIELD_DESCRIPTORS, ...NAMES_WALL_DESCRIPTORS], onField() {}, onNamesMode() {} });
  const draft = structuredClone(DEFAULT_PROJECTION_CONFIG);
  view.update({ state: { draft }, selectedNode: "names-wall", namesWallStatus: { state: "rebuilding", detail: "Rebuilding names on both outputs…" }, namesRunDisabledReason: "Apply the pending calibration before running names." });
  const control = view.fields.get("names-wall:namesWall.requestedFontPx");
  expect(control.number.disabled).not.toBe(true);
  expect(view.nodeMap.get("names-wall").querySelector(".names-wall-status").dataset.state).toBe("rebuilding");
  const run = view.nodeMap.get("names-wall").querySelector("[data-action=projection-names-run]");
  expect(run.disabled).toBe(true);
  expect(run.title).toContain("Apply");
  view.update({ state: { draft, snapshot: { config: structuredClone(draft) } }, selectedNode: "names-wall", namesWallStatus: { state: "failed", detail: "placement failed; run names to retry." } });
  const status = view.nodeMap.get("names-wall").querySelector(".names-wall-status");
  expect(status.textContent).toContain("placement failed");
  view.update({ state: { draft, snapshot: { config: structuredClone(draft) } }, selectedNode: "names-wall", namesWallStatus: { state: "stale", detail: "Geometry changed. Finish geometry, then Run names." } });
  expect(status.textContent).toContain("Finish geometry, then Run names");
  expect(run.disabled).toBe(false);
  expect(status.title).toContain("reference-plane pixels");
  expect(control.number.disabled).not.toBe(true);
  view.dispose();
});

test("repeated refresh keeps inline fields scoped to their graph nodes", () => {
  const make = makeNode;
  const root = make("main"); void (document); window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const view = createProjectionConfigView(root, { descriptors: [...FIELD_DESCRIPTORS, ...NAMES_WALL_DESCRIPTORS] });
  const draft = structuredClone(DEFAULT_PROJECTION_CONFIG);
  for (let n = 0; n < 3; n += 1) view.update({ state: { draft }, selectedNode: "right-fit" });
  expect(view.fields.get("right-fit:outputs.right.post.scale").wrap.hidden).toBe(false);
  expect(view.fields.get("right-fit:outputs.right.post.tx").wrap.hidden).toBe(false);
  expect(view.fields.get("right-fit:outputs.right.post.ty").wrap.hidden).toBe(false);
  expect(view.fields.has("inspector:pre.scale")).toBe(false);
  draft.namesWall.activeMode = "model";
  view.update({ state: { draft }, selectedNode: "names-wall" });
  expect(view.fields.get("names-wall:namesWall.requestedFontPx").wrap.hidden).toBe(false);
  expect(view.fields.get("names-wall:namesWall.inwardShiftPercent").wrap.hidden).toBe(true);
  expect(view.fields.get("names-wall:namesWall.innerEdgeInsetPx.left").wrap.hidden).toBe(false);
  const rotation = view.fields.get("names-wall:namesWall.rotateDeg");
  expect(rotation.wrap.hidden).toBe(false);
  expect(rotation.number.value).toBe(String(draft.namesWall.rotateDeg));
  expect(view.fields.get("names-wall:namesWall.rotateDeg").number.value).toBe(String(draft.namesWall.rotateDeg));
  const rotationHelp = [...view.nodeMap.get("names-wall").children]
    .filter((node) => node.className?.includes("names-wall-rotation"));
  expect(rotationHelp.length).toBeGreaterThan(0);
  expect(rotationHelp.every((node) => /both wall and model/i.test(node.textContent) && /Live, Apply, and Save/i.test(node.textContent))).toBe(true);
  const editor = createWarpEditor({ config: draft, output: "right" });
  view.update({ state: { draft }, selectedNode: "right-grid", warpStates: { right: { ...editor.getState(), config: editor.getConfig(), handles: editor.getControlPoints() } } });
  expect(view.controls.warpPanel.hidden).toBe(false);
  expect(view.fields.get("right-fit:outputs.right.post.scale").wrap.hidden).toBe(false);
  view.dispose();
});

test("invalid warp coordinates preserve handles and show an accessible error", () => {
  const make = makeNode;
  const root = make("main"); void (document); window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const onWarpAction = vi.fn();
  const view = createProjectionConfigView(root, { descriptors: FIELD_DESCRIPTORS, onWarpAction });
  const draft = structuredClone(DEFAULT_PROJECTION_CONFIG); const editor = createWarpEditor({ config: draft, output: "left" });
  const handles = editor.getControlPoints();
  view.update({ state: { draft }, selectedNode: "left-keystone", warpStates: { left: { ...editor.getState(), config: editor.getConfig(), handles } } });
  expect(view.controls.warpPositionX.inputMode).toBe('decimal');
  for (const [input, axis] of [[view.controls.warpPositionX, "x"], [view.controls.warpPositionY, "y"]]) {
    input.value = ""; input.dispatch("input"); input.dispatch("change");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(view.controls.warpCoordinateFields.get(axis).error.textContent).toContain("Enter");
    input.value = "-"; input.dispatch("input"); input.dispatch("change");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(handles).toEqual(editor.getControlPoints());
  }
  expect(onWarpAction).not.toHaveBeenCalled();
  view.controls.warpPositionX.value = "-12.5"; view.controls.warpPositionX.dispatch("input"); view.controls.warpPositionX.dispatch("change");
  expect(onWarpAction).toHaveBeenCalledWith("warp-set-position", expect.objectContaining({ axis: "x", pixels: -12.5, output: "left", coordinateTarget: expect.objectContaining({ output: "left" }) }));
  expect(view.controls.warpPositionX.getAttribute("aria-invalid")).toBe("false");
  view.controls.warpPositionY.value = "-4.25"; view.controls.warpPositionY.dispatch("input"); view.controls.warpPositionY.dispatch("change");
  expect(onWarpAction).toHaveBeenCalledWith("warp-set-position", expect.objectContaining({ axis: "y", pixels: -4.25, output: "left", coordinateTarget: expect.objectContaining({ output: "left" }) }));
  expect(onWarpAction).toHaveBeenCalledTimes(2);
  for (const axis of ['x', 'y']) {
    const coordinate = view.controls.warpCoordinateFields.get(axis);
    coordinate.cancel();
    view.update({ state: { draft }, selectedNode: 'left-keystone', warpStates: { left: { ...editor.getState(), config: editor.getConfig(), handles } } });
    coordinate.cancel();
    coordinate.number.value = '-5'; coordinate.number.dispatch('input'); coordinate.number.dispatch('change');
    expect(onWarpAction).toHaveBeenLastCalledWith('warp-set-position', expect.objectContaining({ axis, pixels: -5, output: 'left', coordinateTarget: expect.objectContaining({ output: 'left' }) }));
    onWarpAction.mockReturnValueOnce(false);
    coordinate.number.value = '9'; coordinate.number.dispatch('input'); coordinate.number.dispatch('change');
    expect(coordinate.isPending()).toBe(true);
    expect(coordinate.number.getAttribute('aria-invalid')).toBe('true');
    coordinate.cancel();
  }

  expect(view.controls.warpPositionY.getAttribute("aria-invalid")).toBe("false");
  view.dispose();
});

test("selection refresh keeps pending coordinates conflicted until restart", () => {
  const make = makeNode;
  const root = make("main"); const doc = document; void (doc);
  const onWarpAction = vi.fn(); const view = createProjectionConfigView(root, { descriptors: FIELD_DESCRIPTORS, onWarpAction });
  const draft = structuredClone(DEFAULT_PROJECTION_CONFIG); const editor = createWarpEditor({ config: draft, output: "left" });
  const warpStates = { left: { ...editor.getState(), config: editor.getConfig(), handles: editor.getControlPoints() } };
  view.update({ state: { draft }, selectedNode: "left-keystone", warpStates });
  view.controls.warpPositionX.dispatch("focus");
  expect(view.controls.warpCoordinateFields.get('x').isPending()).toBe(false);
  editor.select({ mode: "keystone", kind: "corner", index: 1 });
  view.update({ state: { draft }, selectedNode: "left-keystone", warpStates: { left: { ...editor.getState(), config: editor.getConfig(), handles: editor.getControlPoints() } } });
  expect(view.controls.warpPositionX.getAttribute("aria-invalid")).toBe("true");
  const coordinate = view.controls.warpCoordinateFields.get('x');
  coordinate.number.value = '5'; coordinate.number.dispatch('input'); coordinate.number.dispatch('change');
  expect(coordinate.isPending()).toBe(true);
  expect(coordinate.wrap.querySelector('[data-action="numeric-use-mine"]').disabled).toBe(true);
  coordinate.cancel();
  expect(coordinate.isPending()).toBe(false);
  expect(coordinate.error.textContent).toBe('');
  expect(onWarpAction).not.toHaveBeenCalled();
  view.dispose();
});
