// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { createParameterEditorDialog } from "../../frontend/src/projection-config/parameter-editor-dialog.js";

const descriptors = [
  { path: "pre.scale", node: "pre", label: "Scale", min: 0.1, max: 8, step: 0.01, fine: 0.001, unit: "×", decimals: 3 },
  { path: "outputs.left.crop.x0", node: "left-crop", label: "Left edge", min: 0, max: 1, step: 0.001, fine: 0.0001, unit: "%", display: "percentage", displayMin: 0, displayMax: 100, displayStep: 0.1, decimals: 2 },
];
const makeConfig = () => ({ pre: { scale: 1.25 }, outputs: { left: { crop: { x0: 0.1 } } } });
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

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
