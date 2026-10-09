// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { mountProjectionConfig } from "../../frontend/src/projection-config/config-controller.js";
import { createRoadSignClient } from "../../frontend/src/projection-config/road-sign-client.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";
import { createRoadSign, emptyRoadSignSettings } from "../../frontend/src/shared/road-sign-settings.js";
import { layoutNodePositions } from "../../frontend/src/projection-config/node-canvas.js";

let mounted;
afterEach(() => { mounted?.dispose(); mounted = null; document.body.replaceChildren(); vi.useRealTimers(); });

async function mountFixture({ sign = createRoadSign({ id: "11111111-1111-4111-8111-111111111111", x: 640, y: 360 }), outputController, roadSignEditorFactory } = {}) {
  window.history.replaceState({}, "", "/frontend/projection-config.html");
  const root = document.createElement("main"); document.body.append(root);
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  const state = { snapshot: { revision: 1, config, presets: [], selectedPresetId: null }, draft: structuredClone(config), live: false, pending: false, connected: true, hasLocalDraft: false };
  const projectionListeners = new Set();
  const projectionClient = { getState: () => state, subscribe(listener) { projectionListeners.add(listener); listener(state); return () => projectionListeners.delete(listener); }, start: async () => state, stop() {}, setValidateCandidate() {}, setDraft: vi.fn(), setLive() {}, apply: vi.fn() };
  const settings = emptyRoadSignSettings(); if (sign) settings.outputs.left.push(structuredClone(sign));
  let revision = 4, current = structuredClone(settings);
  const writeSettings = vi.fn(async (next, meta) => { current = structuredClone(next); revision = meta.baseRevision + 1; return { status: "ok", roadSignSettings: current, roadSignRevision: revision }; });
  const roadSignHandlers = new Map();
  const roadSignClient = createRoadSignClient({ getSnapshot: async () => ({ road_sign_settings: current, road_sign_revision: revision }), writeSettings,
    socket: { on: (name, listener) => roadSignHandlers.set(name, listener), off: vi.fn() }, tableName: "otef" });
  await roadSignClient.hydrate({ forceFresh: true });
  mounted = mountProjectionConfig(root, { client: projectionClient, roadSignClient, outputController, roadSignEditorFactory, candidateValidator: { validateCandidate: async ({ identity }) => ({ identity, valid: true }), dispose() {} } });
  return {
    root, roadSignClient, writeSettings, projectionClient,
    updateSnapshot(nextSnapshot) { state.snapshot = structuredClone(nextSnapshot); for (const listener of projectionListeners) listener(state, { foreign: true }); },
    setCalibrationDraft(nextDraft) { state.draft = structuredClone(nextDraft); for (const listener of projectionListeners) listener(state, { foreign: true }); },
    emitRemote(nextSettings, nextRevision = revision + 1) { current = structuredClone(nextSettings); revision = nextRevision; roadSignHandlers.get("otef_road_signs_changed")({ table: "otef", roadSignSettings: current, roadSignRevision: revision }); },
    open() { root.querySelector('[data-action="road-sign-editor-open"]').click(); },
    close() { document.querySelector('.road-sign-editor-close').click(); },
    selectNode(id) { root.querySelector(`[data-node="${id}"]`).click(); },
  };
}

test("Road 232 signs has a placed disconnected node and does not create graph wires", () => {
  const { positions } = layoutNodePositions({});
  expect(positions["road-signs"]).toBeDefined();
  expect(positions["road-signs"].x).toBe(positions.content.x);
  expect(positions["road-signs"].y).toBeGreaterThan(positions["settlement-names"].y);
});

test("config load has no sign iframe; open mounts one and successful close removes it", async () => {
  const app = await mountFixture();
  expect(app.root.querySelector('[data-node="road-signs"]')).not.toBeNull();
  expect(app.root.querySelector('[data-node="road-signs"] [data-action="road-sign-editor-open"]').textContent).toBe("Open editor");
  expect(app.root.querySelector('[data-node="road-signs"]').textContent).toContain("Place signs on GIS and the Browser projection outputs");
  expect(app.root.querySelector('[data-node="road-signs"] .node-port')).toBeNull();
  expect(app.root.querySelector('[data-node="road-signs"]').textContent).toContain("Exhibit visibility: Unknown");
  expect(document.querySelectorAll("iframe")).toHaveLength(0);
  app.open();
  expect(document.querySelectorAll("iframe")).toHaveLength(1);
  app.close();
  expect(document.querySelectorAll("iframe")).toHaveLength(0);
});

test("a rejected close keeps the sign dialog and blocks other dialog-opening transitions", async () => {
  const app = await mountFixture(); app.open();
  const dialog = document.querySelector(".road-sign-editor-dialog");
  const scale = dialog.querySelector('input[data-field="scale"][data-input="number"]');
  scale.value = "-"; scale.dispatchEvent(new Event("input", { bubbles: true })); scale.dispatchEvent(new Event("change", { bubbles: true }));
  app.close();
  const openers = [
    '[data-node="clock-gis"] [data-action="clock-editor-open"]',
    '[data-node="settlement-names"] [data-action="settlement-editor-open"]',
    '[data-node="nova-explainers"] [data-action="nova-explainer-editor-open"]',
    '[data-node="left-keystone"] [data-action="warp-editor-open"]',
  ];
  for (const selector of openers) {
    app.root.querySelector(selector).click();
    expect(document.querySelector(".road-sign-editor-dialog")).toBe(dialog);
    expect(document.querySelector(".clock-layout-dialog, .settlement-name-dialog")).toBeNull();
    expect(document.querySelector(".warp-editor-dialog").hidden).toBe(true);
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
  }
  expect(app.writeSettings).not.toHaveBeenCalled();
  scale.value = "0.825"; scale.dispatchEvent(new Event("input", { bubbles: true })); scale.dispatchEvent(new Event("change", { bubbles: true }));
  app.open();
  expect(document.querySelector(".road-sign-editor-dialog")).toBe(dialog);
  expect(document.querySelectorAll("iframe")).toHaveLength(1);
});

test("closing and reopening preserves a pending numeric sign edit without calibration Apply", async () => {
  vi.useFakeTimers();
  const app = await mountFixture(); app.open();
  const dialog = document.querySelector(".road-sign-editor-dialog");
  const scale = dialog.querySelector('input[data-field="scale"][data-input="number"]');
  scale.value = "82.5"; scale.dispatchEvent(new Event("input", { bubbles: true })); scale.dispatchEvent(new Event("change", { bubbles: true }));
  app.close();
  expect(app.roadSignClient.getState().draft.outputs.left[0].scale).toBe(0.825);
  app.open();
  expect(document.querySelector('input[data-field="scale"][data-input="number"]').value).toBe("82.5");
  expect(app.projectionClient.apply).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(150);
  await Promise.resolve(); await Promise.resolve();
  expect(app.writeSettings).toHaveBeenCalledTimes(1);
  expect(app.projectionClient.apply).not.toHaveBeenCalled();
});

test("held sign gestures block node transitions until released", async () => {
  const app = await mountFixture(); app.open();
  const dialog = document.querySelector(".road-sign-editor-dialog");
  const range = dialog.querySelector('input[data-field="scale"][data-input="range"]');
  range.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 71 }));
  app.selectNode("clock-gis");
  expect(document.querySelector(".road-sign-editor-dialog")).toBe(dialog);
  expect(document.querySelector(".clock-layout-dialog")).toBeNull();
  document.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 71 }));
});

test("an accepted revision-only calibration change invalidates the open preview", async () => {
  const editor = { calibrationChanged: vi.fn(), sync() {}, close: () => true, finishPendingEdit: () => true, hasPendingEdit: () => false, isHeld: () => false, cancelPendingEdit() {} };
  const roadSignEditorFactory = vi.fn(() => editor);
  const app = await mountFixture({ roadSignEditorFactory }); app.open();
  app.updateSnapshot({ revision: 2, config: structuredClone(DEFAULT_PROJECTION_CONFIG), presets: [], selectedPresetId: null });
  expect(editor.calibrationChanged).toHaveBeenCalledOnce();
});
test("beforeunload protects unfinished input and failed, conflicting, or in-flight signs writes", async () => {
  vi.useFakeTimers();
  const app = await mountFixture(); app.open();
  const dialog = document.querySelector(".road-sign-editor-dialog");
  const beforeUnload = () => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
  const raw = dialog.querySelector('input[data-field="scale"][data-input="number"]');
  raw.value = "-"; raw.dispatchEvent(new Event("input", { bubbles: true }));
  expect(beforeUnload()).toBe(true);
  dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(app.roadSignClient.hasUnsavedWork()).toBe(false);

  app.writeSettings.mockRejectedValueOnce(new Error("offline"));
  const failedDraft = structuredClone(app.roadSignClient.getState().acknowledged); failedDraft.outputs.left[0].x = 700;
  const failedSave = app.roadSignClient.replaceDraft(failedDraft, { flush: true }).catch(() => {});
  await vi.advanceTimersByTimeAsync(0); await failedSave;
  expect(app.roadSignClient.getState().status).toBe("Failed");
  expect(beforeUnload()).toBe(true);
  await app.roadSignClient.replaceDraft(app.roadSignClient.getState().acknowledged);

  const remote = structuredClone(app.roadSignClient.getState().acknowledged);
  remote.outputs.right.push(createRoadSign({ id: "22222222-2222-4222-8222-222222222222", x: 300, y: 300 }));
  const local = structuredClone(app.roadSignClient.getState().acknowledged); local.outputs.left[0].x = 710;
  void app.roadSignClient.replaceDraft(local); app.emitRemote(remote, app.roadSignClient.getState().revision + 1);
  expect(app.roadSignClient.getState().status).toBe("Conflict");
  expect(beforeUnload()).toBe(true);
  app.roadSignClient.useLatest();

  let finishWrite;
  app.writeSettings.mockImplementationOnce((next, meta) => new Promise((resolve) => { finishWrite = () => resolve({ status: "ok", roadSignSettings: next, roadSignRevision: meta.baseRevision + 1 }); }));
  const inflightDraft = structuredClone(app.roadSignClient.getState().acknowledged); inflightDraft.outputs.left[0].x = 720;
  const inflightSave = app.roadSignClient.replaceDraft(inflightDraft, { flush: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(app.roadSignClient.getState()).toMatchObject({ status: "Saving", pending: true });
  expect(beforeUnload()).toBe(true);
  finishWrite(); await vi.advanceTimersByTimeAsync(0); await inflightSave;
  app.close();
});

test("applied calibration for sign preview comes from accepted snapshot when draft is dirty", async () => {
  let applied;
  const editor = { calibrationChanged() {}, sync() {}, close: () => true, finishPendingEdit: () => true, hasPendingEdit: () => false, isHeld: () => false, cancelPendingEdit() {} };
  const roadSignEditorFactory = vi.fn((options) => { applied = options.getAppliedCalibration(); return editor; });
  const app = await mountFixture({ roadSignEditorFactory });
  const accepted = structuredClone(app.projectionClient.getState().snapshot.config);
  const dirty = structuredClone(accepted); dirty.namesWall.rotateDeg = 87;
  app.setCalibrationDraft(dirty); app.open();
  expect(applied).toEqual({ config: accepted, revision: 1 });
  expect(applied.config).not.toEqual(dirty);
});

test("moving the Road 232 config node does not edit acknowledged sign settings", async () => {
  const app = await mountFixture();
  const before = app.roadSignClient.getState().acknowledged;
  const header = app.root.querySelector('[data-node="road-signs"] h3');
  header.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 5, isPrimary: true, clientX: 10, clientY: 10 }));
  document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 5, clientX: 30, clientY: 25 }));
  document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 5, clientX: 30, clientY: 25 }));
  expect(app.roadSignClient.getState().acknowledged).toEqual(before);
  expect(app.writeSettings).not.toHaveBeenCalled();
});
