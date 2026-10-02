// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { createProjectionConfigView } from "../../frontend/src/projection-config/config-view.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { FIELD_DESCRIPTORS, NAMES_WALL_DESCRIPTORS } from "../../frontend/src/projection-config/config-controller.js";

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
  const view = createProjectionConfigView(root, {
    descriptors: [...FIELD_DESCRIPTORS, ...NAMES_WALL_DESCRIPTORS], onAction, onOutputAction, onNode,
    onWarpAction: vi.fn(), onWarpPointer: vi.fn(), onOpenClockEditor: vi.fn(), onField, onNudge,
  });
  const update = (extra = {}) => view.update({
    state: { draft: structuredClone(DEFAULT_PROJECTION_CONFIG), snapshot: { config: structuredClone(DEFAULT_PROJECTION_CONFIG), presets, selectedPresetId: "original" }, selectedPresetId: "original" },
    selectedNode: "pre", loadedPresetId: "original", loadedPresetLoadToken: 1, ...extra,
  });
  update();
  return { root, view, onAction, onOutputAction, onNode, onField, onNudge, update };
};
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

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
  expect(preset.querySelector("summary .disclosure-error-indicator").hidden).toBe(false);
  expect(more.querySelector("summary .disclosure-error-indicator").hidden).toBe(false);
  expect(outputs.querySelector("summary .disclosure-error-indicator").hidden).toBe(false);
  expect(root.querySelector(".action-error").hidden).toBe(true);

  for (const [panel, expected] of [[preset, "Preset save failed"], [more, "Import failed"], [outputs, "Display assignment failed"]]) {
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
