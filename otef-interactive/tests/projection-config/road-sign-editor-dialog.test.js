// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { emptyRoadSignSettings } from "../../frontend/src/shared/road-sign-settings.js";
import { createRoadSignClient } from "../../frontend/src/projection-config/road-sign-client.js";

const previewMock = { mesh: null, fail: null, onRendered: null, setStates: [], disposes: 0, refreshes: 0, output: "left", requestId: 0 };
const previewPath = "../../frontend/src/projection-config/road-sign-preview.js";
let openRoadSignEditor;
beforeEach(async () => {
  vi.doMock(previewPath, () => ({
    mountRoadSignPreview: ({ onRendered, onError }) => {
      previewMock.onRendered = onRendered; previewMock.fail = onError; previewMock.setStates = []; previewMock.disposes = 0; previewMock.refreshes = 0;
      previewMock.output = "left"; previewMock.requestId = 0;
      const render = (output, requestId) => onRendered({ output, sessionId: "preview", requestId, calibrationRevision: 4, meshIdentity: "mesh", mesh: previewMock.mesh });
      render("left", 1);
      return { setState: vi.fn((state) => { previewMock.setStates.push(structuredClone(state)); render(previewMock.output, ++previewMock.requestId); return true; }),
        setOutput: vi.fn((output) => { previewMock.output = output; render(output, ++previewMock.requestId); }), refresh: vi.fn(() => { previewMock.refreshes++; render(previewMock.output, ++previewMock.requestId); return true; }), dispose: vi.fn(() => { previewMock.disposes++; }) };
    },
  }));
  vi.resetModules();
  ({ openRoadSignEditor } = await import("../../frontend/src/projection-config/road-sign-editor-dialog.js"));
});

function identityMesh() { return { width: 1920, height: 1080, vertices: [
  { u: 0, v: 0, x: 0, y: 0 }, { u: 1, v: 0, x: 1, y: 0 }, { u: 1, v: 1, x: 1, y: 1 }, { u: 0, v: 1, x: 0, y: 1 },
], triangles: [0, 1, 2, 0, 2, 3] }; }
function affineMesh() { return { width: 1920, height: 1080, vertices: [
  { u: 0, v: 0, x: 0.25, y: 0.25 }, { u: 1, v: 0, x: 0.75, y: 0.25 }, { u: 1, v: 1, x: 0.75, y: 0.75 }, { u: 0, v: 1, x: 0.25, y: 0.75 },
], triangles: [0, 1, 2, 0, 2, 3] }; }

function makeClient(initial = emptyRoadSignSettings()) {
  let state = { acknowledged: structuredClone(initial), draft: null, revision: 2, status: "Saved" };
  const writes = [], listeners = new Set();
  const emit = () => listeners.forEach((listener) => listener(structuredClone(state)));
  return { writes, getState: () => structuredClone(state), hasUnsavedWork: () => state.draft !== null,
    subscribe(listener) { listeners.add(listener); listener(structuredClone(state)); return () => listeners.delete(listener); },
    replaceDraft(next, options) { writes.push({ settings: structuredClone(next), options }); state = { ...state, draft: structuredClone(next), status: "Saving" }; emit(); return Promise.resolve({ status: "ok" }); },
    setRemote(next) { state = { ...state, draft: structuredClone(next) }; emit(); } };
}

function open(initial = emptyRoadSignSettings(), mesh = identityMesh()) {
  previewMock.mesh = mesh;
  previewMock.setStates = []; previewMock.fail = null;
  const settingsClient = makeClient(initial);
  const applied = { config: structuredClone(DEFAULT_PROJECTION_CONFIG), revision: 4 };
  const editor = openRoadSignEditor({ document, settingsClient, getAppliedCalibration: () => structuredClone(applied), manageBeforeUnload: false });
  const dialog = document.querySelector('[role="dialog"]');
  dialog.querySelector(".road-sign-editor-stage").getBoundingClientRect = () => ({ left: 0, top: 0, width: 1920, height: 1080 });
  editor.sync();
  return { editor, settingsClient, dialog };
}

function click(node) { node.dispatchEvent(new MouseEvent("click", { bubbles: true })); }

test("GIS signs can be placed and edited without changing either projection output", () => {
  const initial = emptyRoadSignSettings();
  initial.outputs.left.push({ id: "11111111-1111-4111-8111-111111111111", x: 640, y: 360, scale: 0.7,
    rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 640, y: 360 } });
  const { editor, settingsClient, dialog } = open(initial);
  const output = dialog.querySelector("select[aria-label='Source output']");
  output.value = "gis";
  output.dispatchEvent(new Event("change", { bubbles: true }));
  expect(output.value).toBe("gis");
  expect(dialog.querySelector(".road-sign-applied-calibration").textContent).toContain("Home");
  click(dialog.querySelector('[data-action="road-sign-add"]'));
  const overlay = dialog.querySelector(".road-sign-overlay");
  overlay.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 32, clientX: 800, clientY: 400 }));
  document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 32, clientX: 800, clientY: 400 }));
  const saved = settingsClient.writes.at(-1).settings;
  expect(saved.outputs.gis[0].x).toBeCloseTo(800);
  expect(saved.outputs.gis[0]).toMatchObject({ y: 400, scale: 0.7 });
  expect(saved.outputs.left).toEqual(initial.outputs.left);
  expect(saved.outputs.right).toEqual(initial.outputs.right);
  const scale = dialog.querySelector('input[data-field="scale"][data-input="number"]');
  scale.value = "90";
  scale.dispatchEvent(new Event("input", { bubbles: true }));
  scale.dispatchEvent(new Event("change", { bubbles: true }));
  expect(settingsClient.writes.at(-1).settings.outputs.gis[0].scale).toBe(0.9);
  expect(settingsClient.writes.at(-1).settings.outputs.left).toEqual(initial.outputs.left);
  editor.dispose();
});
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.doUnmock(previewPath); vi.resetModules(); });
function addAtCenter(dialog) {
  click(dialog.querySelector('[data-action="road-sign-add"]'));
  const overlay = dialog.querySelector(".road-sign-overlay");
  overlay.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 960, clientY: 540 }));
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 1, clientX: 960, clientY: 540 }));
}

test("adds, selects, duplicates, removes, and assigns signs to a source output", () => {
  const { editor, settingsClient, dialog } = open();
  expect(dialog.textContent).toContain("Applied calibration");
  expect(dialog.querySelector('[data-action="road-sign-add"]')).toBeTruthy();
  addAtCenter(dialog);
  expect(settingsClient.writes).toHaveLength(1);
  const added = settingsClient.writes[0].settings.outputs.left[0];
  expect(added).toMatchObject({ x: 960, y: 540, scale: 0.7, theme: "dark", visible: true, leader: { enabled: false, x: 960, y: 540 } });
  click(dialog.querySelector('[data-action="road-sign-duplicate"]'));
  expect(settingsClient.writes.at(-1).settings.outputs.left).toHaveLength(2);
  expect(settingsClient.writes.at(-1).settings.outputs.left[1]).toMatchObject({ x: 984, y: 564 });
  const output = dialog.querySelector('[aria-label="Source output"]'); output.value = "right"; output.dispatchEvent(new Event("change", { bubbles: true }));
  expect(settingsClient.writes.at(-1).settings.outputs.right).toEqual([]);
  click(dialog.querySelector('[data-action="road-sign-add"]'));
  dialog.querySelector(".road-sign-overlay").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 2, clientX: 900, clientY: 500 }));
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 2, clientX: 900, clientY: 500 }));
  expect(settingsClient.writes.at(-1).settings.outputs.right).toHaveLength(1);
  click(dialog.querySelector('[data-action="road-sign-remove"]'));
  expect(settingsClient.writes.at(-1).settings.outputs.right).toEqual([]);
  editor.dispose();
});

test("uses sign-specific renderField limits and preserves decimal size and signed rotation", () => {
  const { editor, settingsClient, dialog } = open();
  addAtCenter(dialog);
  const size = dialog.querySelector('input[data-field="scale"][data-input="number"]');
  const rotation = dialog.querySelector('input[data-field="rotateDeg"][data-input="number"]');
  expect(size.min).toBe("1"); expect(size.max).toBe("300");
  expect(rotation.min).toBe("-180"); expect(rotation.max).toBe("180");
  size.value = "2.5"; size.dispatchEvent(new Event("input", { bubbles: true })); size.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(settingsClient.writes.at(-1).settings.outputs.left[0].scale).toBe(0.025);
  const centerX = dialog.querySelector('input[data-field="x"][data-input="number"]'); centerX.value = "123.4"; centerX.dispatchEvent(new Event("input", { bubbles: true })); centerX.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  const centerY = dialog.querySelector('input[data-field="y"][data-input="number"]'); centerY.value = "456.7"; centerY.dispatchEvent(new Event("input", { bubbles: true })); centerY.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(settingsClient.writes.at(-1).settings.outputs.left[0]).toMatchObject({ x: 123.4, y: 456.7 });
  rotation.value = "-17.3"; rotation.dispatchEvent(new Event("input", { bubbles: true })); rotation.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(settingsClient.writes.at(-1).settings.outputs.left[0].rotateDeg).toBe(-17.3);
  click(dialog.querySelector('[data-action="numeric-sign"]'));
  dialog.querySelector('input[data-field="rotateDeg"][data-input="number"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(settingsClient.writes.at(-1).settings.outputs.left[0].rotateDeg).toBe(17.3);
  click(dialog.querySelector('[data-action="road-sign-visible"]'));
  click(dialog.querySelector('[data-action="road-sign-theme-original"]'));
  click(dialog.querySelector('[data-action="road-sign-leader"]'));
  expect(settingsClient.writes.at(-1).settings.outputs.left[0]).toMatchObject({ visible: false, theme: "original", leader: { enabled: true } });
  expect(dialog.querySelector('[aria-label="Size slider step size"]')).toBeTruthy();
  expect(dialog.querySelector('[aria-label="Rotation slider step size"]')).toBeTruthy();
  editor.dispose();
});

test("incomplete numeric text blocks close and selection; Escape cancels the pending edit", () => {
  const { editor, dialog } = open({ version: 1, outputs: { left: [
    { id: "11111111-1111-4111-8111-111111111111", x: 900, y: 500, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 900, y: 500 } },
    { id: "22222222-2222-4222-8222-222222222222", x: 1000, y: 500, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 1000, y: 500 } },
  ], right: [] } });
  const rotation = dialog.querySelector('input[data-field="rotateDeg"][data-input="number"]');
  rotation.value = "-"; rotation.dispatchEvent(new Event("input", { bubbles: true }));
  expect(editor.close()).toBe(false);
  click(dialog.querySelector('.road-sign-instance-list [data-sign-id="22222222-2222-4222-8222-222222222222"]'));
  expect(rotation.value).toBe("-");
  expect(dialog.querySelector('.road-sign-instance-list [data-sign-id="11111111-1111-4111-8111-111111111111"]')?.getAttribute("aria-current")).toBe("true");
  dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(editor.hasPendingEdit()).toBe(false);
  expect(editor.close()).toBe(true);
});

test("clipped signs are marked and tiny hit areas stay at least 44 CSS pixels", () => {
  const initial = { version: 1, outputs: { left: [
    { id: "11111111-1111-4111-8111-111111111111", x: 0, y: 540, scale: 0.01, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 0, y: 540 } },
  ], right: [] } };
  const { editor, dialog } = open(initial);
  dialog.querySelector(".road-sign-editor-stage").getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 540 });
  editor.sync();
  expect(dialog.querySelector(".road-sign-center-hit").getAttribute("r")).toBe("44");
  editor.dispose();
  const clipped = structuredClone(initial); clipped.outputs.left[0].scale = 3;
  const second = open(clipped); second.editor.sync();
  expect(second.dialog.querySelector(".road-sign-center-hit").getAttribute("class")).toContain("clipped");
  expect(second.dialog.querySelector(".road-sign-mapping-status").textContent).toMatch(/Clipped by the source frame/);
  second.editor.dispose();
});

test("Add and Duplicate are disabled at capacity while Remove remains available", () => {
  const full = { version: 1, outputs: { left: Array.from({ length: 64 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, x: 960, y: 540, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 960, y: 540 },
  })), right: [] } };
  const { editor, settingsClient, dialog } = open(full);
  const add = dialog.querySelector('[data-action="road-sign-add"]');
  const duplicate = dialog.querySelector('[data-action="road-sign-duplicate"]');
  const remove = dialog.querySelector('[data-action="road-sign-remove"]');
  expect(add.disabled).toBe(true); expect(duplicate.disabled).toBe(true); expect(remove.disabled).toBe(false);
  expect(dialog.textContent).toContain("At most 64 signs per source output");
  const selectedId = dialog.querySelector(".road-sign-instance-list [data-sign-id]").getAttribute("data-sign-id");
  add.disabled = false; duplicate.disabled = false;
  add.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  duplicate.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(dialog.querySelector(".road-sign-instance-list [aria-current=true]").getAttribute("data-sign-id")).toBe(selectedId);
  expect(settingsClient.writes).toHaveLength(0);
  editor.dispose();
});

test("inverse mesh drag writes one source-plane update only on release", () => {
  const initial = { version: 1, outputs: { left: [
    { id: "11111111-1111-4111-8111-111111111111", x: 960, y: 540, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 960, y: 540 } },
  ], right: [] } };
  const { editor, settingsClient, dialog } = open(initial, affineMesh());
  const handle = dialog.querySelector(".road-sign-center-hit");
  handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 8, clientX: 960, clientY: 540 }));
  document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 8, clientX: 1200, clientY: 540 }));
  expect(settingsClient.writes).toHaveLength(0);
  expect(settingsClient.getState().acknowledged.outputs.left[0].x).toBe(960);
  expect(previewMock.setStates.at(-1).settings.outputs.left[0].x).toBe(1440);
  expect(Number(dialog.querySelector(".road-sign-center-hit").getAttribute("cx"))).toBe(1200);
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 8, clientX: 1200, clientY: 540 }));
  expect(settingsClient.writes).toHaveLength(1);
  expect(settingsClient.writes[0]).toMatchObject({ options: { flush: true }, settings: { outputs: { left: [{ x: 1440, y: 540 }] } } });
  editor.dispose();
});

test("real client conflict cancels a drag and blocks edits until reapplying on latest", async () => {
  vi.useFakeTimers();
  const initial = { version: 1, outputs: { left: [
    { id: "11111111-1111-4111-8111-111111111111", x: 960, y: 540, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 960, y: 540 } },
  ], right: [] } };
  const remote = structuredClone(initial);
  remote.outputs.right.push({ id: "22222222-2222-4222-8222-222222222222", x: 300, y: 300, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 300, y: 300 } });
  const handlers = new Map(), writes = []; let accepted = initial, revision = 1;
  const client = createRoadSignClient({ getSnapshot: async () => ({ road_sign_settings: accepted, road_sign_revision: revision }),
    writeSettings: vi.fn(async (settings, meta) => { writes.push(structuredClone(settings)); accepted = structuredClone(settings); revision = meta.baseRevision + 1; return { roadSignSettings: accepted, roadSignRevision: revision }; }),
    socket: { on: (name, fn) => handlers.set(name, fn), off: vi.fn() }, tableName: "otef" });
  await client.hydrate();
  const local = structuredClone(initial); local.outputs.left[0].x = 970;
  void client.replaceDraft(local);
  previewMock.mesh = affineMesh();
  const editor = openRoadSignEditor({ document, settingsClient: client, getAppliedCalibration: () => ({ config: structuredClone(DEFAULT_PROJECTION_CONFIG), revision: 4 }), manageBeforeUnload: false });
  const dialog = document.querySelector("[role=dialog]");
  dialog.querySelector(".road-sign-editor-stage").getBoundingClientRect = () => ({ left: 0, top: 0, width: 1920, height: 1080 });
  editor.sync();
  expect(client.getState().draft.outputs.left[0].x).toBe(970);
  const handle = dialog.querySelector(".road-sign-center-hit");
  const beforeHandleX = Number(handle.getAttribute("cx"));
  handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 40, clientX: beforeHandleX, clientY: 540 }));
  document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 40, clientX: beforeHandleX + 30, clientY: 540 }));
  expect(Number(dialog.querySelector(".road-sign-center-hit").getAttribute("cx"))).toBeGreaterThan(beforeHandleX);
  handlers.get("otef_road_signs_changed")({ table: "otef", roadSignSettings: remote, roadSignRevision: 2 });
  expect(client.getState().status).toBe("Conflict");
  expect(editor.isHeld()).toBe(false);
  expect(dialog.querySelector(".road-sign-center-hit").getAttribute("aria-disabled")).toBe("true");
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 40, clientX: beforeHandleX + 30, clientY: 540 }));
  expect(writes).toHaveLength(0);
  const staleDraft = client.getState().draft;
  const rotation = dialog.querySelector('input[data-field="rotateDeg"][data-input="number"]');
  expect(rotation.disabled).toBe(true);
  expect(client.getState().draft).toEqual(staleDraft);
  await vi.runAllTimersAsync();
  expect(writes).toHaveLength(0);
  dialog.querySelector('[data-action="road-sign-use-latest"]').click();
  const freshRotation = dialog.querySelector('input[data-field="rotateDeg"][data-input="number"]');
  expect(freshRotation.disabled).toBe(false);
  const addButton = dialog.querySelector('[data-action="road-sign-add"]');
  const duplicateButton = dialog.querySelector('[data-action="road-sign-duplicate"]');
  const removeButton = dialog.querySelector('[data-action="road-sign-remove"]');
  expect(addButton.disabled).toBe(false);
  expect(duplicateButton.disabled).toBe(false);
  expect(removeButton.disabled).toBe(false);
  addButton.click();
  expect(dialog.querySelector('.road-sign-preview-status').textContent).toContain("Click the preview to place");
  dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  freshRotation.value = "15"; freshRotation.dispatchEvent(new Event("input", { bubbles: true })); freshRotation.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await vi.runAllTimersAsync();
  expect(writes).toHaveLength(1);
  expect(writes[0].outputs.right).toEqual(remote.outputs.right);
  expect(writes[0].outputs.left[0]).toMatchObject({ x: 960, rotateDeg: 15 });
  editor.dispose(); client.destroy();
});

test("conflict preserves unfinished numeric text until Use latest explicitly discards it", async () => {
  vi.useFakeTimers();
  const initial = { version: 1, outputs: { left: [
    { id: "11111111-1111-4111-8111-111111111111", x: 960, y: 540, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 960, y: 540 } },
  ], right: [] } };
  const remote = structuredClone(initial);
  remote.outputs.right.push({ id: "22222222-2222-4222-8222-222222222222", x: 300, y: 300, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 300, y: 300 } });
  const handlers = new Map(), writes = []; let accepted = initial, revision = 1;
  const client = createRoadSignClient({ getSnapshot: async () => ({ road_sign_settings: accepted, road_sign_revision: revision }),
    writeSettings: vi.fn(async (settings, meta) => { writes.push(structuredClone(settings)); accepted = structuredClone(settings); revision = meta.baseRevision + 1; return { roadSignSettings: accepted, roadSignRevision: revision }; }),
    socket: { on: (name, fn) => handlers.set(name, fn), off: vi.fn() }, tableName: "otef" });
  await client.hydrate();
  previewMock.mesh = identityMesh();
  const editor = openRoadSignEditor({ document, settingsClient: client, getAppliedCalibration: () => ({ config: structuredClone(DEFAULT_PROJECTION_CONFIG), revision: 4 }), manageBeforeUnload: false });
  const dialog = document.querySelector("[role=dialog]");
  const local = structuredClone(initial); local.outputs.left[0].x = 970;
  void client.replaceDraft(local);
  const scale = dialog.querySelector('input[data-field="scale"][data-input="number"]');
  scale.value = "-"; scale.dispatchEvent(new Event("input", { bubbles: true }));
  expect(editor.hasPendingEdit()).toBe(true);
  handlers.get("otef_road_signs_changed")({ table: "otef", roadSignSettings: remote, roadSignRevision: 2 });
  expect(client.getState().status).toBe("Conflict");
  const conflictedScale = dialog.querySelector('input[data-field="scale"][data-input="number"]');
  expect(conflictedScale.value).toBe("-");
  expect(conflictedScale.disabled).toBe(true);
  expect(editor.hasPendingEdit()).toBe(true);
  expect(writes).toHaveLength(0);
  dialog.querySelector('[data-action="road-sign-use-latest"]').click();
  const freshScale = dialog.querySelector('input[data-field="scale"][data-input="number"]');
  expect(freshScale.disabled).toBe(false);
  expect(freshScale.value).toBe("70");
  expect(editor.hasPendingEdit()).toBe(false);
  const rotation = dialog.querySelector('input[data-field="rotateDeg"][data-input="number"]');
  rotation.value = "15"; rotation.dispatchEvent(new Event("input", { bubbles: true })); rotation.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await vi.runAllTimersAsync();
  expect(writes).toHaveLength(1);
  expect(writes[0].outputs.right).toEqual(remote.outputs.right);
  expect(writes[0].outputs.left[0]).toMatchObject({ x: 960, rotateDeg: 15 });
  editor.dispose(); client.destroy();
});

test.each(["slider", "Fine repeat"])("Use latest retires a held %s session without replaying its rollback", async (heldKind) => {
  vi.useFakeTimers();
  const initial = { version: 1, outputs: { left: [
    { id: "11111111-1111-4111-8111-111111111111", x: 960, y: 540, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 960, y: 540 } },
  ], right: [] } };
  const remote = structuredClone(initial);
  remote.outputs.left[0].scale = 0.9;
  remote.outputs.right.push({ id: "22222222-2222-4222-8222-222222222222", x: 300, y: 300, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 300, y: 300 } });
  const handlers = new Map(), writes = []; let accepted = initial, revision = 1;
  const client = createRoadSignClient({ getSnapshot: async () => ({ road_sign_settings: accepted, road_sign_revision: revision }),
    writeSettings: vi.fn(async (settings, meta) => { writes.push(structuredClone(settings)); accepted = structuredClone(settings); revision = meta.baseRevision + 1; return { roadSignSettings: accepted, roadSignRevision: revision }; }),
    socket: { on: (name, fn) => handlers.set(name, fn), off: vi.fn() }, tableName: "otef" });
  await client.hydrate();
  previewMock.mesh = identityMesh();
  const editor = openRoadSignEditor({ document, settingsClient: client, getAppliedCalibration: () => ({ config: structuredClone(DEFAULT_PROJECTION_CONFIG), revision: 4 }), manageBeforeUnload: false });
  const dialog = document.querySelector("[role=dialog]");
  if (heldKind === "slider") {
    const field = dialog.querySelector('[data-field="scale"]').closest(".config-field");
    click(field.querySelector('[data-action="numeric-sensitivity"][data-mode="coarse"]'));
    const range = field.querySelector('input[data-input="range"]');
    range.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 51 }));
    range.value = "71"; range.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    const finePlus = dialog.querySelector('[data-field="scale"]').closest(".config-field").querySelectorAll(".nudge")[1];
    finePlus.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 52, button: 0 }));
    await vi.advanceTimersByTimeAsync(350);
  }
  const expectedHeldScale = heldKind === "slider" ? 0.71 : 0.701;
  expect(client.getState().draft.outputs.left[0].scale).toBeCloseTo(expectedHeldScale);
  expect(editor.isHeld()).toBe(true);
  const raw = dialog.querySelector('input[data-field="rotateDeg"][data-input="number"]');
  raw.value = "-"; raw.dispatchEvent(new Event("input", { bubbles: true }));
  handlers.get("otef_road_signs_changed")({ table: "otef", roadSignSettings: remote, roadSignRevision: 2 });
  expect(client.getState().status).toBe("Conflict");
  expect(editor.isHeld()).toBe(false);
  expect(dialog.querySelector('input[data-field="rotateDeg"][data-input="number"]').value).toBe("-");
  expect(editor.hasPendingEdit()).toBe(true);
  expect(writes).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(writes).toHaveLength(0);
  dialog.querySelector('[data-action="road-sign-use-latest"]').click();
  expect(client.getState()).toMatchObject({ status: "Saved", draft: null, acknowledged: remote });
  expect(editor.isHeld()).toBe(false);
  expect(editor.hasPendingEdit()).toBe(false);
  expect(dialog.querySelector('input[data-field="scale"][data-input="number"]').value).toBe("90");
  expect(dialog.querySelector('input[data-field="rotateDeg"][data-input="number"]').value).toBe("0");
  await vi.advanceTimersByTimeAsync(1000);
  expect(writes).toHaveLength(0);
  const freshRotation = dialog.querySelector('input[data-field="rotateDeg"][data-input="number"]');
  expect(freshRotation.disabled).toBe(false);
  freshRotation.value = "15"; freshRotation.dispatchEvent(new Event("input", { bubbles: true })); freshRotation.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await vi.runAllTimersAsync();
  expect(writes).toHaveLength(1);
  expect(writes[0].outputs.left[0]).toMatchObject({ scale: 0.9, rotateDeg: 15 });
  expect(writes[0].outputs.right).toEqual(remote.outputs.right);
  expect(client.getState()).toMatchObject({ status: "Saved", draft: null, acknowledged: writes[0] });
  editor.dispose(); client.destroy();
});

test("connector endpoint inverse mapping moves only the endpoint", () => {
  const initial = { version: 1, outputs: { left: [
    { id: "11111111-1111-4111-8111-111111111111", x: 960, y: 540, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: true, x: 1200, y: 540 } },
  ], right: [] } };
  const { editor, settingsClient, dialog } = open(initial, affineMesh());
  dialog.querySelector(".road-sign-leader-hit").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 9, clientX: 1080, clientY: 540 }));
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 9, clientX: 1200, clientY: 540 }));
  expect(settingsClient.writes[0].settings.outputs.left[0]).toMatchObject({ x: 960, y: 540, leader: { enabled: true, x: 1440, y: 540 } });
  editor.dispose();
});

test("remote document change during drag cancels instead of overwriting another output", () => {
  const initial = { version: 1, outputs: { left: [
    { id: "11111111-1111-4111-8111-111111111111", x: 960, y: 540, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 960, y: 540 } },
  ], right: [] } };
  const { editor, settingsClient, dialog } = open(initial);
  dialog.querySelector(".road-sign-center-hit").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 10, clientX: 960, clientY: 540 }));
  document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 10, clientX: 1000, clientY: 540 }));
  const remote = structuredClone(initial); remote.outputs.right.push({ id: "22222222-2222-4222-8222-222222222222", x: 300, y: 300, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 300, y: 300 } });
  settingsClient.setRemote(remote);
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 10, clientX: 1000, clientY: 540 }));
  expect(settingsClient.writes).toHaveLength(0);
  expect(settingsClient.getState().draft.outputs.right).toHaveLength(1);
  editor.dispose();
});


test("Fine click uses the descriptor fine increment and coarse slider uses one display step", () => {
  const { editor, settingsClient, dialog } = open();
  addAtCenter(dialog);
  const sizeControl = dialog.querySelector('[data-field="scale"]').closest(".config-field");
  click(sizeControl.querySelector(".nudge"));
  expect(settingsClient.getState().draft.outputs.left[0].scale).toBeCloseTo(0.701);
  click(sizeControl.querySelector('[data-action="numeric-sensitivity"][data-mode="coarse"]'));
  const range = sizeControl.querySelector('input[type="range"]');
  range.value = "75"; range.dispatchEvent(new Event("input", { bubbles: true }));
  expect(settingsClient.getState().draft.outputs.left[0].scale).toBe(0.75);
  editor.dispose();
});

test("held Fine nudge release does not add another increment and cancel restores its base", () => {
  vi.useFakeTimers();
  try {
    const { editor, settingsClient, dialog } = open();
    addAtCenter(dialog);
    const field = dialog.querySelector('[data-field="rotateDeg"]').closest(".config-field");
    const finePlus = field.querySelectorAll(".nudge")[1];
    finePlus.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 31, button: 0 }));
    vi.advanceTimersByTime(350);
    finePlus.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 31, button: 0 }));
    expect(settingsClient.getState().draft.outputs.left[0].rotateDeg).toBeCloseTo(0.1);
    const size = dialog.querySelector('[data-field="scale"]').closest(".config-field");
    const held = size.querySelectorAll(".nudge")[1];
    held.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 32, button: 0 }));
    vi.advanceTimersByTime(350);
    held.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(settingsClient.getState().draft.outputs.left[0].scale).toBeCloseTo(0.7);
    editor.dispose();
  } finally { vi.useRealTimers(); }
});

test("slider cancellation restores canonical and displayed values before the next step", () => {
  const { editor, settingsClient, dialog } = open();
  addAtCenter(dialog);
  const range = dialog.querySelector('input[data-field="scale"][data-input="range"]');
  const number = dialog.querySelector('input[data-field="scale"][data-input="number"]');
  range.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 33 }));
  range.value = "1"; range.dispatchEvent(new Event("input", { bubbles: true }));
  expect(settingsClient.getState().draft.outputs.left[0].scale).toBeCloseTo(0.701);
  range.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 33 }));
  expect(settingsClient.getState().draft.outputs.left[0].scale).toBeCloseTo(0.7);
  expect(number.value).toBe("70");
  range.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 34 }));
  range.value = "1"; range.dispatchEvent(new Event("input", { bubbles: true }));
  range.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 34 }));
  expect(settingsClient.getState().draft.outputs.left[0].scale).toBeCloseTo(0.701);
  expect(number.value).toBe("70.1");
  editor.dispose();
});

test.each(["change", "Enter", "blur"])("keyboard Fine slider step is applied and finished by %s", (terminal) => {
  const { editor, settingsClient, dialog } = open();
  addAtCenter(dialog);
  const range = dialog.querySelector('input[data-field="scale"][data-input="range"]');
  const number = dialog.querySelector('input[data-field="scale"][data-input="number"]');
  range.focus();
  range.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  range.value = "1"; range.dispatchEvent(new Event("input", { bubbles: true }));
  expect(settingsClient.getState().draft.outputs.left[0].scale).toBeCloseTo(0.701);
  expect(settingsClient.writes.at(-1).settings.outputs.left[0].scale).toBeCloseTo(0.701);
  expect(settingsClient.writes).toHaveLength(2);
  if (terminal === "change") range.dispatchEvent(new Event("change", { bubbles: true }));
  if (terminal === "Enter") range.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  if (terminal === "blur") range.blur();
  expect(editor.hasPendingEdit()).toBe(false);
  expect(settingsClient.getState().draft.outputs.left[0].scale).toBeCloseTo(0.701);
  expect(number.value).toBe("70.1");
  editor.dispose();
});

test("X and Y use numeric edit sessions, preserve incomplete text, and commit with debounce", () => {
  const { editor, settingsClient, dialog } = open({ version: 1, outputs: { left: [
    { id: "11111111-1111-4111-8111-111111111111", x: 900, y: 500, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 900, y: 500 } },
    { id: "22222222-2222-4222-8222-222222222222", x: 1000, y: 500, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 1000, y: 500 } },
  ], right: [] } });
  const x = dialog.querySelector('input[data-field="x"][data-input="number"]');
  expect(x).toBeTruthy();
  x.value = ""; x.dispatchEvent(new Event("input", { bubbles: true }));
  expect(editor.hasPendingEdit()).toBe(true);
  expect(editor.finishPendingEdit()).toBe(false);
  expect(settingsClient.writes).toHaveLength(0);
  click(dialog.querySelector('[data-action="road-sign-duplicate"]'));
  expect(settingsClient.writes).toHaveLength(0);
  dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(editor.hasPendingEdit()).toBe(false);
  x.value = "123.4"; x.dispatchEvent(new Event("input", { bubbles: true }));
  x.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  expect(settingsClient.writes.at(-1).options).toEqual({ flush: false });
  expect(settingsClient.getState().draft.outputs.left[0].x).toBe(123.4);
  editor.dispose();
});

test("selection, duplicate, and held pointer actions finish or guard pending edits before reading a sign", () => {
  const initial = { version: 1, outputs: { left: [
    { id: "11111111-1111-4111-8111-111111111111", x: 900, y: 500, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 900, y: 500 } },
    { id: "22222222-2222-4222-8222-222222222222", x: 1000, y: 500, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 1000, y: 500 } },
  ], right: [] } };
  const { editor, settingsClient, dialog } = open(initial);
  const x = dialog.querySelector('input[data-field="x"][data-input="number"]');
  x.value = "912.5"; x.dispatchEvent(new Event("input", { bubbles: true }));
  click(dialog.querySelector('[data-action="road-sign-duplicate"]'));
  expect(settingsClient.writes.at(-1).settings.outputs.left[0].x).toBe(912.5);
  expect(settingsClient.writes.at(-1).settings.outputs.left[2].x).toBe(936.5);
  const hit = dialog.querySelector(".road-sign-center-hit");
  hit.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 34, clientX: 900, clientY: 500 }));
  expect(editor.isHeld()).toBe(true);
  click(dialog.querySelector('.road-sign-instance-list [data-sign-id="22222222-2222-4222-8222-222222222222"]'));
  expect(dialog.querySelector('.road-sign-instance-list [data-sign-id="11111111-1111-4111-8111-111111111111"]')?.getAttribute("aria-current")).toBe("true");
  document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 34 }));
  expect(editor.isHeld()).toBe(false);
  editor.dispose();
});

test("preview error during a drag cancels it, releases document listeners, and prevents a write", () => {
  const { editor, settingsClient, dialog } = open({ version: 1, outputs: { left: [
    { id: "11111111-1111-4111-8111-111111111111", x: 960, y: 540, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 960, y: 540 } },
  ], right: [] } });
  const remove = vi.spyOn(document, "removeEventListener");
  dialog.querySelector(".road-sign-center-hit").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 35, clientX: 960, clientY: 540 }));
  document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 35, clientX: 1000, clientY: 540 }));
  previewMock.fail(new Error("preview timed out"));
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 35, clientX: 1000, clientY: 540 }));
  expect(editor.isHeld()).toBe(false);
  expect(settingsClient.writes).toHaveLength(0);
  expect(remove).toHaveBeenCalledWith("pointermove", expect.any(Function));
  editor.dispose();
});

test("remote document updates republish settings to the preview when no drag is active", () => {
  const initial = { version: 1, outputs: { left: [
    { id: "11111111-1111-4111-8111-111111111111", x: 960, y: 540, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 960, y: 540 } },
  ], right: [] } };
  const { editor, settingsClient } = open(initial);
  const remote = structuredClone(initial); remote.outputs.left[0].x = 1120;
  settingsClient.setRemote(remote);
  expect(previewMock.setStates.at(-1).settings.outputs.left[0].x).toBe(1120);
  editor.dispose();
});

test("square preview uses one 16:9 fit for frame, mapped overlay, and off-center pointers", () => {
  const initial = { version: 1, outputs: { left: [
    { id: "11111111-1111-4111-8111-111111111111", x: 1440, y: 270, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 1440, y: 270 } },
  ], right: [] } };
  const { editor, settingsClient, dialog } = open(initial, affineMesh());
  const stage = dialog.querySelector(".road-sign-editor-stage");
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 960 });
  editor.sync();
  const frameHost = dialog.querySelector(".road-sign-preview-host");
  expect(frameHost.style.width).toBe("960px");
  expect(frameHost.style.height).toBe("540px");
  expect(frameHost.style.top).toBe("210px");
  dialog.querySelector(".road-sign-overlay").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 36, clientX: 600, clientY: 412.5 }));
  document.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 36, clientX: 660, clientY: 412.5 }));
  document.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 36, clientX: 660, clientY: 412.5 }));
  expect(settingsClient.writes.at(-1).settings.outputs.left[0].x).toBeCloseTo(1680);
  editor.dispose();
});

test("mapped sign outline follows interior mesh bends and clips at the output edge", () => {
  const vertices = [];
  const coords = [0, 0.25, 0.5, 0.75, 1];
  for (const v of coords) for (const u of coords) vertices.push({ u, v,
    x: u === 0.5 && v === 0.5 ? 0.58 : u, y: v === 0.5 && u === 0.5 ? 0.56 : v });
  const triangles = [];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const a = y * 5 + x, b = a + 1, d = a + 5, c = d + 1;
    triangles.push(a, b, c, a, c, d);
  }
  const grid = { width: 1920, height: 1080, vertices, triangles };
  const initial = { version: 1, outputs: { left: [
    { id: "11111111-1111-4111-8111-111111111111", x: 960, y: 540, scale: 3, rotateDeg: 37, theme: "dark", visible: true, leader: { enabled: false, x: 960, y: 540 } },
  ], right: [] } };
  const first = open(initial, grid); first.editor.sync();
  const outlines = first.dialog.querySelectorAll(".road-sign-outline");
  expect(outlines.length).toBeGreaterThan(4);
  first.editor.dispose();
  const edge = structuredClone(initial); edge.outputs.left[0].x = 0;
  const second = open(edge, grid); second.editor.sync();
  expect(second.dialog.querySelectorAll(".road-sign-outline").length).toBeGreaterThan(0);
  expect(second.dialog.querySelector(".road-sign-outline").getAttribute("class")).toContain("clipped");
  second.editor.dispose();
});

test("edge drag targets remain fully visible with true centers marked and focus returns on repeated teardown", () => {
  const opener = document.createElement("button"); document.body.appendChild(opener); opener.focus();
  const initial = { version: 1, outputs: { left: [
    { id: "11111111-1111-4111-8111-111111111111", x: 0, y: 0, scale: 0.01, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: true, x: 1920, y: 1080 } },
  ], right: [] } };
  const calibration = { config: structuredClone(DEFAULT_PROJECTION_CONFIG), revision: 4 };
  const settingsClient = makeClient(initial);
  const editor = openRoadSignEditor({ document, settingsClient, getAppliedCalibration: () => structuredClone(calibration), restoreFocus: () => opener });
  const dialog = document.querySelector('[role="dialog"]');
  dialog.querySelector(".road-sign-editor-stage").getBoundingClientRect = () => ({ left: 0, top: 0, width: 960, height: 540 });
  editor.sync();
  const circles = [...dialog.querySelectorAll(".road-sign-center-hit,.road-sign-leader-hit")];
  for (const circle of circles) {
    const cx = Number(circle.getAttribute("cx")), cy = Number(circle.getAttribute("cy")), radius = Number(circle.getAttribute("r"));
    expect(cx - radius).toBeGreaterThanOrEqual(0); expect(cy - radius).toBeGreaterThanOrEqual(0);
    expect(cx + radius).toBeLessThanOrEqual(1920); expect(cy + radius).toBeLessThanOrEqual(1080);
  }
  const focusable = [...dialog.querySelectorAll("button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden])")];
  focusable.at(-1).focus();
  const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  focusable.at(-1).dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(true); expect(document.activeElement).toBe(focusable[0]);
  editor.dispose(); editor.dispose();
  expect(document.activeElement).toBe(opener);
  expect(previewMock.disposes).toBe(1);
});


test("dragging the already-selected sign cannot discard incomplete placement input", () => {
  const initial = { version: 1, outputs: { left: [
    { id: "11111111-1111-4111-8111-111111111111", x: 960, y: 540, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 960, y: 540 } },
  ], right: [] } };
  const { editor, dialog } = open(initial);
  const rotation = dialog.querySelector('input[data-field="rotateDeg"][data-input="number"]');
  rotation.value = "-"; rotation.dispatchEvent(new Event("input", { bubbles: true }));
  dialog.querySelector(".road-sign-center-hit").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 38, clientX: 960, clientY: 540 }));
  expect(editor.isHeld()).toBe(false);
  expect(editor.hasPendingEdit()).toBe(true);
  expect(rotation.value).toBe("-");
  editor.dispose();
});

test("stage fit changes refresh one preview session, ignore unchanged fits, and cancel held placement without saving", () => {
  const observers = [];
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
    trigger() { this.callback([{ target: this.target }]); }
  });
  const initial = { version: 1, outputs: { left: [
    { id: "11111111-1111-4111-8111-111111111111", x: 960, y: 540, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 960, y: 540 } },
  ], right: [] } };
  const { editor, settingsClient, dialog } = open(initial);
  const stage = dialog.querySelector(".road-sign-editor-stage");
  let width = 1920, height = 1080;
  stage.getBoundingClientRect = () => ({ left: 0, top: 0, width, height });
  const observer = observers.at(-1);
  observer.trigger();
  observer.trigger();
  expect(previewMock.refreshes).toBe(1);

  const handle = dialog.querySelector(".road-sign-center-hit");
  handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 91, clientX: 960, clientY: 540 }));
  expect(editor.isHeld()).toBe(true);
  width = 960; height = 540;
  observer.trigger();
  expect(previewMock.refreshes).toBe(2);
  expect(editor.isHeld()).toBe(false);
  expect(settingsClient.writes).toHaveLength(0);
  expect(settingsClient.getState().acknowledged.outputs.left[0].x).toBe(960);
  editor.dispose();
  expect(observer.disconnected).toBe(true);
});
test("remote coordinate update keeps pending text conflicted and publishes the remote document", () => {
  const initial = { version: 1, outputs: { left: [
    { id: "11111111-1111-4111-8111-111111111111", x: 960, y: 540, scale: 0.7, rotateDeg: 0, theme: "dark", visible: true, leader: { enabled: false, x: 960, y: 540 } },
  ], right: [] } };
  const { editor, settingsClient, dialog } = open(initial);
  const x = dialog.querySelector('input[data-field="x"][data-input="number"]');
  x.value = "123.4"; x.dispatchEvent(new Event("input", { bubbles: true }));
  const remote = structuredClone(initial); remote.outputs.left[0].x = 1200;
  settingsClient.setRemote(remote);
  expect(editor.finishPendingEdit()).toBe(false);
  expect(x.value).toBe("123.4");
  expect(previewMock.setStates.at(-1).settings.outputs.left[0].x).toBe(1200);
  editor.dispose();
});
