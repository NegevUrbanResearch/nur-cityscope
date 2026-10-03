// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { createParameterEditorDialog } from "../../frontend/src/projection-config/parameter-editor-dialog.js";

const descriptors = [
  { path: "pre.scale", node: "pre", label: "Scale", min: 0.1, max: 8, step: 0.01, fine: 0.001, unit: "×", decimals: 3 },
  { path: "outputs.left.crop.x0", node: "left-crop", label: "Left edge", min: 0, max: 1, step: 0.001, fine: 0.0001, unit: "%", display: "percentage", displayMin: 0, displayMax: 100, displayStep: 0.1, decimals: 2 },
];
const makeConfig = () => ({ pre: { scale: 1.25 }, outputs: { left: { crop: { x0: 0.1 } } } });
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });
test('opening retains current parameter history controls and forwards undo', () => {
  const host=document.createElement('main'); document.body.append(host); const onAction=vi.fn();
  const dialog=createParameterEditorDialog({document,host,onAction});
  dialog.update({config:makeConfig(),parameterHistory:{undo:2,redo:0}}); dialog.open({nodeId:'pre',descriptors:[descriptors[0]]});
  expect(host.querySelector('[data-action="parameter-undo"]').disabled).toBe(false);
  expect(host.querySelector('[data-action="parameter-redo"]').disabled).toBe(true);
  host.querySelector('[data-action="parameter-undo"]').click(); expect(onAction).toHaveBeenCalledWith('parameter-undo'); dialog.dispose();
});

test("Names profile context follows the active profile beside the editor heading", () => {
  const host = document.createElement("main"); document.body.append(host);
  const contextForConfig = (nodeId, config) => nodeId === "names-wall"
    ? `${config.namesWall.activeMode === "wall" ? "Regular wall" : "Model-oriented"} profile`
    : "";
  const dialog = createParameterEditorDialog({ document, host, presentation: "panel", contextForConfig });
  const config = { ...makeConfig(), namesWall: { activeMode: "wall" } };
  dialog.open({ nodeId: "names-wall", title: "Names wall" }); dialog.update({ config });
  expect(dialog.titleContext.textContent).toBe("Regular wall profile");
  config.namesWall.activeMode = "model"; dialog.update({ config });
  expect(dialog.titleContext.textContent).toBe("Model-oriented profile");
  dialog.dispose();
});

test("opens only the selected node fields and forwards a numeric edit once", () => {
  const host = document.createElement("main"); document.body.appendChild(host);
  const opener = document.createElement("button"); opener.textContent = "Adjust"; host.appendChild(opener);
  const onField = vi.fn(); const onNudge = vi.fn();
  const dialog = createParameterEditorDialog({ document, host, onField, onNudge });
  dialog.update({ config: makeConfig(), fieldErrors: {}, status: "Applied" });
  dialog.open({ nodeId: "pre", title: "Shared pre-transform", descriptors: [descriptors[0]], opener });
  expect(host.querySelectorAll(".parameter-editor-field")).toHaveLength(1);
  const number = host.querySelector('input[data-input="number"][data-field="pre.scale"]');
  number.value = "1.5";
  number.dispatchEvent(new Event('input'));
  number.dispatchEvent(new Event("blur"));
  expect(onField).toHaveBeenCalledTimes(1);
  expect(onField).toHaveBeenCalledWith("pre.scale", "1.5", "number", {baseValue:1.25,resolvedPath:'pre.scale',override:false});
  onField.mockClear();
  host.querySelector('[data-action="fine-nudge"][data-direction="1"]').click();
  expect(onField).not.toHaveBeenCalled();
  expect(onNudge).toHaveBeenCalledTimes(1);
  expect(onNudge).toHaveBeenCalledWith("pre.scale", 1);
  host.querySelector('[data-action="parameter-editor-close"]').click();
  expect(document.activeElement).toBe(opener);
  dialog.dispose();
});

test("updates external values and validation without replacing active text entry", () => {
  const host = document.createElement("main"); document.body.appendChild(host);
  const dialog = createParameterEditorDialog({ document, host });
  dialog.open({ nodeId: "left-crop", title: "Left Crop", descriptors: [descriptors[1]] });
  const number = host.querySelector('input[data-input="number"][data-field="outputs.left.crop.x0"]');
  dialog.update({ config: makeConfig(), fieldErrors: {} });
  expect(number.value).toBe("10.00");
  number.focus(); number.value = "1.5";
  number.dispatchEvent(new Event('input'));
  dialog.update({ config: { ...makeConfig(), outputs: { left: { crop: { x0: 0.2 } } } }, fieldErrors: { "outputs.left.crop.x0": "Must be below the right edge." }, status: "Draft" });
  expect(number.value).toBe("1.5");
  expect(host.querySelector(".config-field-error").textContent).toBe("Must be below the right edge.");
  expect(host.querySelector(".parameter-editor-status").textContent).toBe("Draft");
  dialog.dispose();
});

test("crop extent errors use displayed percentage points and keep their accessible target stable", () => {
  const host = document.createElement("aside"); document.body.appendChild(host);
  const crop = { ...descriptors[1], path: "outputs.left.crop.x0", label: "Left edge" };
  const config = makeConfig();
  const dialog = createParameterEditorDialog({ document, host, presentation: "panel" });
  dialog.update({ config });
  dialog.open({ nodeId: "left-crop", descriptors: [crop] });
  const number = host.querySelector('[data-input="number"]');
  const error = host.querySelector(".config-field-error");
  const describedBy = number.getAttribute("aria-describedby");
  dialog.update({ config, fieldErrors: { "outputs.left.crop": "x extent must be at least 0.01" } });
  expect(error.textContent).toBe("Horizontal crop extent must be at least 1 percentage point.");
  expect(number.getAttribute("aria-describedby")).toBe(describedBy);
  expect(describedBy.split(" ")).toContain(error.id);
  number.focus(); number.value = "11.25"; number.dispatchEvent(new Event("input", { bubbles: true }));
  dialog.update({ config, fieldErrors: { "outputs.left.crop": "x extent must be at least 0.01" } });
  expect(number.value).toBe("11.25");
  dialog.dispose();
});

test("Escape closes, restores inert siblings, and returns focus to the opener", () => {
  const host = document.createElement("main"); document.body.appendChild(host);
  const workspace = document.createElement("section"); const opener = document.createElement("button"); workspace.appendChild(opener); host.appendChild(workspace);
  const dialog = createParameterEditorDialog({ document, host });
  dialog.open({ nodeId: "pre", title: "Shared pre-transform", descriptors: [descriptors[0]], opener });
  expect(workspace.inert).toBe(true);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(host.querySelector(".parameter-editor-dialog").hidden).toBe(true);
  expect(workspace.inert).not.toBe(true);
  expect(document.activeElement).toBe(opener);
  dialog.dispose();
});

test("true dialog consumes Escape to cancel dirty field then closes on the next bubbled Escape", () => {
  const host = document.createElement("main"); document.body.appendChild(host);
  const workspace = document.createElement("section"); const opener = document.createElement("button"); workspace.appendChild(opener); host.appendChild(workspace);
  const dialog = createParameterEditorDialog({ document, host });
  dialog.update({ config: makeConfig() });
  dialog.open({ nodeId: "pre", title: "Shared pre-transform", descriptors: [descriptors[0]], opener });
  const input = host.querySelector('[data-input="number"]');
  input.focus(); input.value = "1.5"; input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(host.querySelector(".parameter-editor-dialog").hidden).toBe(false);
  expect(input.value).toBe("1.250");
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(host.querySelector(".parameter-editor-dialog").hidden).toBe(true);
  expect(workspace.inert).not.toBe(true);
  expect(document.activeElement).toBe(opener);
  dialog.dispose();
});

test("panel presentation keeps header actions interactive and returns focus without inerting siblings", () => {
  const host = document.createElement("aside"); document.body.appendChild(host);
  const headerAction = document.createElement("button"); headerAction.textContent = "Save"; document.body.appendChild(headerAction);
  const opener = document.createElement("button"); document.body.appendChild(opener);
  const onAction = vi.fn();
  const panel = createParameterEditorDialog({ document, host, onAction, presentation: "panel" });
  panel.update({ config: makeConfig(), parameterHistory: { undo: 1, redo: 0 } });
  panel.open({ nodeId: "pre", title: "Shared pre-transform", descriptors: [descriptors[0]], opener });
  expect(host.querySelector(".parameter-editor-dialog").getAttribute("role")).toBe("region");
  expect(host.querySelector(".parameter-editor-dialog").getAttribute("aria-modal")).toBeNull();
  expect(headerAction.inert).not.toBe(true);
  expect(headerAction.hasAttribute("inert")).toBe(false);
  headerAction.click();
  expect(headerAction.disabled).toBe(false);
  const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  document.dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(false);
  host.querySelector('[data-action="parameter-undo"]').click();
  expect(onAction).toHaveBeenCalledWith("parameter-undo");
  panel.close();
  expect(document.activeElement).toBe(opener);
  panel.dispose();
});

test("Back commits valid pending text, while invalid text waits for explicit Cancel edit", () => {
  const host = document.createElement("aside"); document.body.appendChild(host);
  const opener = document.createElement("button"); document.body.appendChild(opener);
  const onField = vi.fn();
  const panel = createParameterEditorDialog({ document, host, onField, presentation: "panel" });
  panel.update({ config: makeConfig() });
  panel.open({ nodeId: "pre", descriptors: [descriptors[0]], opener });
  const input = host.querySelector('[data-input="number"]');
  input.focus(); input.value = "1.500"; input.dispatchEvent(new Event("input", { bubbles: true }));
  host.querySelector('[data-action="parameter-editor-close"]').click();
  expect(panel.isOpen()).toBe(false);
  expect(onField).toHaveBeenCalledWith("pre.scale", "1.5", "number", { baseValue: 1.25, resolvedPath: "pre.scale", override: false });

  onField.mockClear();
  panel.open({ nodeId: "pre", descriptors: [descriptors[0]], opener });
  const reopened = host.querySelector('[data-input="number"]');
  reopened.focus(); reopened.value = "-"; reopened.dispatchEvent(new Event("input", { bubbles: true }));
  expect(host.querySelector('[data-action="numeric-cancel-edit"]').hidden).toBe(false);
  host.querySelector('[data-action="parameter-editor-close"]').click();
  expect(panel.isOpen()).toBe(true);
  expect(onField).not.toHaveBeenCalled();
  host.querySelector('[data-action="numeric-cancel-edit"]').click();
  expect(reopened.value).toBe("1.250");
  host.querySelector('[data-action="parameter-editor-close"]').click();
  expect(panel.isOpen()).toBe(false);
  panel.dispose();
});

test("panel Back keeps a pointer-down on the target until the click finishes the pending field", () => {
  const host = document.createElement("aside"); document.body.appendChild(host);
  const opener = document.createElement("button"); document.body.appendChild(opener);
  const onField = vi.fn();
  const panel = createParameterEditorDialog({ document, host, onField, presentation: "panel" });
  panel.update({ config: makeConfig() });
  panel.open({ nodeId: "pre", descriptors: [descriptors[0]], opener });
  const input = host.querySelector('[data-input="number"]');
  const back = host.querySelector('[data-action="parameter-editor-close"]');
  input.focus(); input.value = "1.500"; input.dispatchEvent(new Event("input", { bubbles: true }));
  const pointerDown = new Event("pointerdown", { bubbles: true, cancelable: true });
  back.dispatchEvent(pointerDown);
  expect(pointerDown.defaultPrevented).toBe(true);
  expect(panel.isOpen()).toBe(true);
  back.click();
  expect(panel.isOpen()).toBe(false);
  expect(onField).toHaveBeenCalledWith("pre.scale", "1.5", "number", { baseValue: 1.25, resolvedPath: "pre.scale", override: false });
  panel.dispose();
});

test("Escape cancels pending panel text before the next Escape closes it", () => {
  const host = document.createElement("aside"); document.body.appendChild(host);
  const opener = document.createElement("button"); document.body.appendChild(opener);
  const onField = vi.fn();
  const panel = createParameterEditorDialog({ document, host, onField, presentation: "panel" });
  panel.update({ config: makeConfig() });
  panel.open({ nodeId: "pre", descriptors: [descriptors[0]], opener });
  const input = host.querySelector('[data-input="number"]');
  input.focus(); input.value = "1.5"; input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(host.querySelector(".parameter-editor-dialog").hidden).toBe(false);
  expect(input.value).toBe("1.250");
  expect(onField).not.toHaveBeenCalled();
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(host.querySelector(".parameter-editor-dialog").hidden).toBe(true);
  expect(document.activeElement).toBe(opener);
  panel.dispose();
});

test("panel header Escape retires a rejected field using its resolved session target", () => {
  const host = document.createElement("aside"); document.body.appendChild(host);
  const onCancelField = vi.fn();
  const panel = createParameterEditorDialog({ document, host, presentation: "panel", onField: () => false, onCancelField });
  panel.update({ config: makeConfig() });
  panel.open({ nodeId: "left-crop", descriptors: [descriptors[1]] });
  const input = host.querySelector('[data-input="number"]'); input.focus(); input.value = "0";
  input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("blur"));
  const back = host.querySelector('[data-action="parameter-editor-close"]'); back.focus();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(panel.isOpen()).toBe(true);
  expect(onCancelField).toHaveBeenCalledWith("outputs.left.crop.x0", "outputs.left.crop.x0");
  panel.dispose();
});

test('untouched blur and a dirty foreign update never emit stale parameter edits', () => {
  const host = document.createElement('main'); document.body.appendChild(host);
  const onField = vi.fn();
  const dialog = createParameterEditorDialog({document,host,onField});
  const config = makeConfig(); config.pre.scale=1.23456;
  dialog.update({config}); dialog.open({nodeId:'pre',descriptors:[descriptors[0]]});
  const input=host.querySelector('[data-input="number"]');
  input.dispatchEvent(new Event('blur')); expect(onField).not.toHaveBeenCalled();
  input.value='1.5'; input.dispatchEvent(new Event('input'));
  dialog.update({config:{...config,pre:{scale:2}}}); input.dispatchEvent(new Event('blur'));
  expect(onField).not.toHaveBeenCalled(); expect(host.querySelector('[data-action="numeric-use-latest"]').hidden).toBe(false);
  dialog.dispose();
});
