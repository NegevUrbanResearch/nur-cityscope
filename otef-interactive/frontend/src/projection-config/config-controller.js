import {
  DEFAULT_PROJECTION_CONFIG,
  parseProjectionImport,
  serializeProjectionExport,
  validateProjectionConfig,
} from "../shared/projection-config-schema.js";
import { equalProjectionConfig } from "../shared/projection-config-client.js";
import { createUuid } from "../shared/uuid.js";
import { createProjectionConfigView } from "./config-view.js";
import { createWarpEditor } from "./warp-editor.js";
import { loadCapturedProjectionAsset } from "../projection/projection-captured-baseline.js";
import { migrateNamesWallToV5 } from "../shared/nli-name-wall-config.js";
import { NLI_LABEL_HEADING_STORAGE_KEY } from "../shared/nli-label-heading.js";
import { openClockLayoutEditor } from "./clock-layout-editor-dialog.js";
import { createClockExhibitCueAction } from "./clock-exhibit-cue.js";
import { OTEF_API } from "../shared/api-client.js";

const FIELD_DESCRIPTORS = [
  { path: "pre.scale", node: "pre", label: "Scale", min: 0.1, max: 8, step: 0.01, fine: 0.001, unit: "×", decimals: 3 },
  { path: "pre.rotateDeg", node: "pre", label: "Rotation", min: -180, max: 180, step: 0.1, fine: 0.01, unit: "°", decimals: 2 },
  { path: "pre.tx", node: "pre", label: "Base-view X offset (right +)", min: -2, max: 2, step: 0.001, fine: 0.0001, unit: "%", display: "percentage", displayMin: -200, displayMax: 200, displayStep: 0.1, decimals: 2 },
  { path: "pre.ty", node: "pre", label: "Base-view Y offset (down +)", min: -2, max: 2, step: 0.001, fine: 0.0001, unit: "%", display: "percentage", displayMin: -200, displayMax: 200, displayStep: 0.1, decimals: 2 },
  { path: "outputs.left.crop.x0", node: "left-crop", label: "Left edge", min: 0, max: 1, step: 0.001, fine: 0.0001, unit: "%", display: "percentage", displayMin: 0, displayMax: 100, displayStep: 0.1, decimals: 2 },
  { path: "outputs.left.crop.x1", node: "left-crop", label: "Right edge", min: 0, max: 1, step: 0.001, fine: 0.0001, unit: "%", display: "percentage", displayMin: 0, displayMax: 100, displayStep: 0.1, decimals: 2 },
  { path: "outputs.left.crop.y0", node: "left-crop", label: "Top edge", min: 0, max: 1, step: 0.001, fine: 0.0001, unit: "%", display: "percentage", displayMin: 0, displayMax: 100, displayStep: 0.1, decimals: 2 },
  { path: "outputs.left.crop.y1", node: "left-crop", label: "Bottom edge", min: 0, max: 1, step: 0.001, fine: 0.0001, unit: "%", display: "percentage", displayMin: 0, displayMax: 100, displayStep: 0.1, decimals: 2 },
  { path: "outputs.left.post.scale", node: "left-fit", label: "Scale", min: 0.1, max: 8, step: 0.01, fine: 0.001, unit: "×", decimals: 3 },
  { path: "outputs.left.post.tx", node: "left-fit", label: "X offset (right +)", min: -2, max: 2, step: 0.001, fine: 0.0001, unit: "%", display: "percentage", displayMin: -200, displayMax: 200, displayStep: 0.1, decimals: 2 },
  { path: "outputs.left.post.ty", node: "left-fit", label: "Y offset (down +)", min: -2, max: 2, step: 0.001, fine: 0.0001, unit: "%", display: "percentage", displayMin: -200, displayMax: 200, displayStep: 0.1, decimals: 2 },
  { path: "outputs.right.crop.x0", node: "right-crop", label: "Left edge", min: 0, max: 1, step: 0.001, fine: 0.0001, unit: "%", display: "percentage", displayMin: 0, displayMax: 100, displayStep: 0.1, decimals: 2 },
  { path: "outputs.right.crop.x1", node: "right-crop", label: "Right edge", min: 0, max: 1, step: 0.001, fine: 0.0001, unit: "%", display: "percentage", displayMin: 0, displayMax: 100, displayStep: 0.1, decimals: 2 },
  { path: "outputs.right.crop.y0", node: "right-crop", label: "Top edge", min: 0, max: 1, step: 0.001, fine: 0.0001, unit: "%", display: "percentage", displayMin: 0, displayMax: 100, displayStep: 0.1, decimals: 2 },
  { path: "outputs.right.crop.y1", node: "right-crop", label: "Bottom edge", min: 0, max: 1, step: 0.001, fine: 0.0001, unit: "%", display: "percentage", displayMin: 0, displayMax: 100, displayStep: 0.1, decimals: 2 },
  { path: "outputs.right.post.scale", node: "right-fit", label: "Scale", min: 0.1, max: 8, step: 0.01, fine: 0.001, unit: "×", decimals: 3 },
  { path: "outputs.right.post.tx", node: "right-fit", label: "X offset (right +)", min: -2, max: 2, step: 0.001, fine: 0.0001, unit: "%", display: "percentage", displayMin: -200, displayMax: 200, displayStep: 0.1, decimals: 2 },
  { path: "outputs.right.post.ty", node: "right-fit", label: "Y offset (down +)", min: -2, max: 2, step: 0.001, fine: 0.0001, unit: "%", display: "percentage", displayMin: -200, displayMax: 200, displayStep: 0.1, decimals: 2 },
].map((descriptor) => ({ ...descriptor, displayMin: descriptor.displayMin ?? descriptor.min, displayMax: descriptor.displayMax ?? descriptor.max, displayStep: descriptor.displayStep ?? descriptor.step }));
const NAMES_WALL_DESCRIPTORS = [
  { path: "namesWall.requestedFontPx", node: "names-wall", label: "Requested font", min: 1, max: 48, step: 1, fine: 1, unit: "px" },
  { path: "namesWall.spacingPx", node: "names-wall", label: "Name spacing", min: 0, max: 32, step: 1, fine: 1, unit: "px" },
  { path: "namesWall.edgeInsetPx", node: "names-wall", label: "Edge inset", min: 0, max: 256, step: 1, fine: 1, unit: "px" },
  { path: "namesWall.inwardShiftPercent", node: "names-wall", label: "Bring pages together", min: 0, max: 100, step: 1, fine: 1, unit: "%", wallOnly: true, commitOnChange: true },
  { path: "namesWall.innerEdgeInsetPx.left", node: "names-wall", label: "Left inner-edge clearance", min: 0, max: 960, step: 1, fine: 1, unit: "output px" },
  { path: "namesWall.innerEdgeInsetPx.right", node: "names-wall", label: "Right inner-edge clearance", min: 0, max: 960, step: 1, fine: 1, unit: "output px" },
].map((descriptor) => ({ ...descriptor, integer: true, displayMin: descriptor.min, displayMax: descriptor.max, displayStep: 1 }));
const ALL_FIELD_DESCRIPTORS = [...FIELD_DESCRIPTORS, ...NAMES_WALL_DESCRIPTORS];

function clone(value) { return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function setPath(value, path, next) {
  const result = clone(value); const parts = path.split("."); let target = result;
  for (const key of parts.slice(0, -1)) target = target[key];
  target[parts.at(-1)] = next; return result;
}
function descriptorFor(path) { return ALL_FIELD_DESCRIPTORS.find((descriptor) => descriptor.path === path); }
function resolvedFieldPath(config, path) {
  if (!path.startsWith("namesWall.")) return path;
  const field = path.slice("namesWall.".length);
  if (field === "activeMode") return "namesWall.activeMode";
  if (field.startsWith("innerEdgeInsetPx.")) return path;
  if (field === "inwardShiftPercent") return "namesWall.profiles.wall.inwardShiftPercent";
  return `namesWall.profiles.${config.namesWall.activeMode}.${field}`;
}
function readField(config, path) { return path.split(".").reduce((target, key) => target?.[key], path.startsWith("namesWall.") && !path.startsWith("namesWall.innerEdgeInsetPx.") ? { namesWall: config?.namesWall?.profiles?.[path === "namesWall.inwardShiftPercent" ? "wall" : config?.namesWall?.activeMode] } : config); }
function normalizeConfig(config) { return config && [1, 2, 3, 4].includes(config.schemaVersion) ? migrateNamesWallToV5(config) : config; }
function normalizeState(value) {
  if (!value || typeof value !== "object") return value;
  const snapshot = value.snapshot && {
    ...value.snapshot,
    config: normalizeConfig(value.snapshot.config),
    presets: Array.isArray(value.snapshot.presets) ? value.snapshot.presets.map((preset) => ({ ...preset, config: normalizeConfig(preset.config) })) : value.snapshot.presets,
  };
  return { ...value, draft: normalizeConfig(value.draft), snapshot };
}

export function fieldValueFromInput(descriptor, raw) {
  if (String(raw ?? "").trim() === "") return NaN;
  const value = Number(raw);
  if (!Number.isFinite(value)) return NaN;
  return descriptor.display === "percentage" ? value / 100 : value;
}
export function fieldInputValue(descriptor, value) { return descriptor.display === "percentage" ? Number(value) * 100 : Number(value); }
export function fineStepFor(descriptor) { return descriptor.fine; }

function statusText(state, selectedPresetId) {
  if (state.hydrationError) return "Settings check failed";
  if (state.hydrating) return "Checking settings";
  const selected = state.snapshot?.presets?.find((preset) => preset.id === selectedPresetId);
  const checkpoint = selected?.config || state.snapshot?.config;
  if (state.hasLocalDraft || (state.draft && state.snapshot && !equalProjectionConfig(state.draft, state.snapshot.config))) return "Local draft";
  if (state.pending || !checkpoint || !state.snapshot || !equalProjectionConfig(state.snapshot.config, checkpoint)) return "Live changes";
  return "Saved";
}

export function projectionAppliedStatus(rows, revision) {
  const current = rows.filter((row) => row.revision === revision);
  if (current.some((row) => row.success === false && row.instanceId)) return 'Failed';
  if (!['left', 'right'].every((output) => current.some((row) => row.output === output && row.success))) return 'Pending';
  const successful = current.filter((row) => row.success);
  const walls = successful.map((row) => row.wall);
  if (walls.every((wall) => wall == null)) return 'Renderer applied';
  if (walls.some((wall) => wall == null)) return 'Unconfirmed';
  const identity = (wall) => [wall.datasetVersion, wall.mode, wall.digest, wall.expected, wall.placed].join('|');
  return new Set(walls.map(identity)).size === 1 ? 'Applied' : 'Unconfirmed';
}

export function mountProjectionConfig(root, { client, share, onExport, onImport, socket, outputController, candidateValidator, layoutClient, clockEditorFactory = openClockLayoutEditor } = {}) {
  if (!client) throw new Error("projection config client is required");
  const sourceId = createUuid();
  let selectedNode = "pre";
  let selectedPresetId = null;
  let fieldErrors = {};
  let conflict = "";
  let disposed = false;
  let state = normalizeState(client.getState?.() || {});
  let lastCalibrationConfig = state.snapshot?.config ? structuredClone(state.snapshot.config) : null;
  let clockSceneId = "home";
  let clockElement = "clock";
  let activeClockEditor = null;
  let activeClockEditorNode = null;
  const clockEditors = new Set();
  const clockCueActions = new Set();
  let localDraftNotification = false;
  let outputState = outputController?.getState?.() || { screens: [], assignments: { left: null, right: null }, error: "", message: "Workstation output controls unavailable." };
  let statusRows = new Map();
  let expectedRevision = Number.isSafeInteger(state.snapshot?.revision) ? state.snapshot.revision : null;
  let reconnectStatusRevision = null;
  let confirmationTimer = null;
  let loadedPresetId = state.snapshot?.selectedPresetId || "original";
  let loadedPresetLoadToken = 0;
  let showUnconfirmed = false;
  let wallValidation = { identity: "", revision: null, pending: false, result: null };
  let wallInspectionId = 0;
  let wallMutationId = 0;
  let inputCheckId = 0;
  let validatedInputs = null;
  const validator = candidateValidator || { validateCandidate: async ({ identity }) => ({ identity, valid: false, reason: 'Candidate validator unavailable' }), dispose() {} };
  const win = root?.ownerDocument?.defaultView || globalThis.document?.defaultView;
  let activePattern = { pattern: "off", branch: "left" };
  let patternTimer = null;
  const warpEditors = {
    left: createWarpEditor({ config: state.draft || DEFAULT_PROJECTION_CONFIG, output: "left", onChange: (candidate, meta) => handleWarpChange("left", candidate, meta) }),
    right: createWarpEditor({ config: state.draft || DEFAULT_PROJECTION_CONFIG, output: "right", onChange: (candidate, meta) => handleWarpChange("right", candidate, meta) }),
  };
  const view = createProjectionConfigView(root, {
    descriptors: ALL_FIELD_DESCRIPTORS,
    onField: handleField,
    onNudge: handleNudge,
    onNamesMode: handleNamesMode,
    onNode: (node) => { view.cancelWarpPointer(); selectedNode = node; if (node === "clock-gis" || node === "clock-projection") syncClockEditor(node); else closeClockEditor(); if (node.endsWith("-keystone") || node.endsWith("-grid")) warpEditors[node.startsWith("right-") ? "right" : "left"].setMode(node.endsWith("-grid") ? "grid" : "keystone"); refresh(); },
    onOpenClockEditor: openClockEditor,
    onClockScene: (sceneId) => { clockSceneId = sceneId; activeClockEditor?.setSelection({ nodeId: "clock-gis", sceneId: clockSceneId, element: clockElement }); refresh(); },
    onClockElement: (nextElement) => { clockElement = nextElement; activeClockEditor?.setSelection({ nodeId: "clock-projection", sceneId: clockSceneId, element: clockElement }); refresh(); },
    onAction: handleAction,
    onOutputAction: handleOutputAction,
    onWarpAction: handleWarpAction,
    onWarpPointer: handleWarpPointer,
  });
  client.setValidateCandidate?.(validateWallCandidate);
  Promise.all(["left", "right"].map(async (output) => {
    try {
      const baseline = await loadCapturedProjectionAsset({ spanId: output });
      warpEditors[output].setBaselineMesh(baseline.mesh);
      refresh();
    } catch { /* identity and disabled presets remain editable without TD assets */ }
  }));

  function rowText(row) {
    const identity = row.instanceId ? ` · ${row.instanceId}` : "";
    const label = row.output[0].toUpperCase() + row.output.slice(1);
    if (row.revision !== expectedRevision) return `${label} · Not confirmed${identity}`;
    return row.success ? `${label} applied${identity}` : `${label} · ${row.error || "Not confirmed"}${identity}`;
  }
  function refresh() {
    if (disposed) return;
    const rows = [...statusRows.values()].map((row) => ({ ...row, text: rowText(row) }));
    const warpStates = Object.fromEntries(["left", "right"].map((output) => [output, { ...warpEditors[output].getState(), config: warpEditors[output].getConfig(), handles: warpEditors[output].getControlPoints() }]));
    view.update({ state: { ...state, selectedPresetId }, errors: fieldErrors,
      conflict: conflict || state.migrationWarnings?.join(' ') || '',
      statusText: statusText(state, loadedPresetId), selectedNode, loadedPresetId, loadedPresetLoadToken, statusRows: rows,
      appliedSummary: projectionAppliedStatus(rows, expectedRevision), outputState, warpStates,
      namesWallStatus: wallStatusForDraft(), clockScene: clockSceneId, clockElement });
  }
  function syncClockEditor(node = activeClockEditorNode) {
    if (!activeClockEditor) return;
    activeClockEditorNode = node;
    activeClockEditor.setSelection({ nodeId: node, sceneId: clockSceneId, element: clockElement });
  }
  function closeClockEditor() {
    for (const action of clockCueActions) action.cancel();
    clockCueActions.clear();
    if (!activeClockEditor) return;
    const editor = activeClockEditor;
    activeClockEditor = null; activeClockEditorNode = null;
    editor.close();
  }
  function openClockEditor(nodeId) {
    if (!layoutClient || !["clock-gis", "clock-projection"].includes(nodeId)) return;
    view.cancelWarpPointer();
    view.closeWarpEditor();
    selectedNode = nodeId;
    if (activeClockEditor) { syncClockEditor(nodeId); refresh(); return; }
    const editor = clockEditorFactory({ nodeId, sceneId: clockSceneId, element: clockElement, layoutClient,
      document: root?.ownerDocument || globalThis.document,
      onShowOnExhibit: async (sceneId) => {
        const action = createClockExhibitCueAction({ api: OTEF_API, tableName: "otef", sourceId: createUuid() });
        clockCueActions.add(action);
        try { return await action.show(sceneId); } finally { action.cancel(); clockCueActions.delete(action); }
      },
      onSelection: ({ nodeId: nextNode, sceneId, element }) => { selectedNode = nextNode; clockSceneId = sceneId; clockElement = element; refresh(); },
      restoreFocus: () => view.getClockEditorOpener(selectedNode),
      onClose: () => { if (activeClockEditor === editor) { activeClockEditor = null; activeClockEditorNode = null; } },
    });
    activeClockEditor = editor; activeClockEditorNode = nodeId; clockEditors.add(editor);
    refresh();
  }
  function wallStatusForDraft() {
    const config = state.draft;
    const profile = config?.namesWall?.profiles?.[config?.namesWall?.activeMode];
    if (!profile) return { state: "building", reason: "Names wall settings are unavailable.", expected: null, placed: null };
    const identity = JSON.stringify(config);
    if (wallValidation.identity !== identity || (wallValidation.revision !== expectedRevision && wallValidation.targetRevision !== expectedRevision) || wallValidation.pending) return { state: "building", ...profile, expected: null, placed: null };
    const result = wallValidation.result;
    if (!result) return { state: "building", ...profile, expected: null, placed: null };
    if (!result.valid && result.diagnostics?.state !== "invalid") return { ...profile, state: "building", expected: null, placed: null, reason: `Validation unavailable: ${result.reason || "preflight failed"}.` };
    return { ...profile, ...(result.diagnostics || {}), state: result.valid ? (Number(result.diagnostics?.effectiveFontPx) < profile.requestedFontPx ? "auto-reduced" : "valid") : "invalid", reason: result.reason || result.diagnostics?.reason || "" };
  }
  function validateWallCandidate({ config, generation, identity, revision }) {
    const exactIdentity = identity || JSON.stringify(config);
    // Every mutation gets a new immutable paired preflight for its revision.
    // The display-only inspection below is never reused for Apply, Live, or presets.
    const mutationId = ++wallMutationId;
    wallInspectionId += 1;
    if (JSON.stringify(state.draft) === exactIdentity) { wallValidation = { identity: exactIdentity, revision: expectedRevision, pending: true, result: null }; refresh(); }
    const currentCandidate = () => mutationId === wallMutationId && JSON.stringify(state.draft) === exactIdentity &&
      (!Number.isSafeInteger(expectedRevision) || revision === expectedRevision || revision === expectedRevision + 1);
    return Promise.resolve().then(() => validator.validateCandidate({ config, generation, identity: exactIdentity, revision })).then((result) => {
      if (currentCandidate()) { validatedInputs = validator.getLastInputs?.() || validatedInputs; wallValidation = { identity: exactIdentity, revision: expectedRevision, targetRevision: result.valid ? revision : null, pending: false, result }; refresh(); }
      return result;
    }, (error) => {
      if (currentCandidate()) { wallValidation = { identity: exactIdentity, revision: expectedRevision, pending: false, result: { valid: false, identity: exactIdentity, reason: error?.message || "Wall validation unavailable" } }; refresh(); }
      throw error;
    });
  }
  function checkDraftWall() {
    if (!state.draft || Object.keys(validateProjectionConfig(state.draft)).length) return;
    const identity = JSON.stringify(state.draft);
    const revision = expectedRevision;
    if (wallValidation.identity === identity && (wallValidation.revision === revision || wallValidation.targetRevision === revision)) {
      if (wallValidation.pending) return;
      return;
    }
    const inspectionId = ++wallInspectionId;
    wallValidation = { identity, revision, pending: true, result: null };
    refresh();
    Promise.resolve().then(() => validator.validateCandidate({ config: clone(state.draft), generation: -1, identity, revision })).then((result) => {
      if (inspectionId !== wallInspectionId || JSON.stringify(state.draft) !== identity || expectedRevision !== revision) return;
      validatedInputs = validator.getLastInputs?.() || validatedInputs;
      wallValidation = { identity, revision, pending: false, result };
      refresh();
    }, (error) => {
      if (inspectionId !== wallInspectionId || JSON.stringify(state.draft) !== identity || expectedRevision !== revision) return;
      wallValidation = { identity, revision, pending: false, result: { valid: false, identity, reason: error?.message || "Wall validation unavailable" } };
      refresh();
    });
  }
  async function handleOutputAction(action, value) {
    if (!outputController) { fieldErrors = { action: "Workstation output controls are unavailable in this browser." }; refresh(); return; }
    try {
      if (action === "identify") await outputController.identifyDisplays();
      if (action === "assign") outputController.assignDisplays(value);
      if (action === "open") await outputController.openBoth();
      if (action === "close") outputController.closeBoth();
      outputState = outputController.getState?.() || outputState;
    } catch (error) {
      outputState = outputController.getState?.() || { ...outputState, error: error?.message || String(error) };
    }
    refresh();
  }
  const setConflict = (message) => { conflict = String(message || "Calibration changed on another screen; latest settings loaded."); refresh(); };
  function expectRevision(nextState, force = false) {
    const next = nextState.snapshot?.revision;
    if (!Number.isSafeInteger(next) || (next === expectedRevision && !force)) return;
    expectedRevision = next;
    statusRows = new Map(); showUnconfirmed = false;
    if (confirmationTimer !== null) clearTimeout(confirmationTimer);
    confirmationTimer = setTimeout(() => { confirmationTimer = null; showUnconfirmed = true; const nextRows = new Map(statusRows); if (![...nextRows.values()].some((row) => row.output === "left")) nextRows.set("left:pending", { output: "left", instanceId: "", revision: next, success: false }); if (![...nextRows.values()].some((row) => row.output === "right")) nextRows.set("right:pending", { output: "right", instanceId: "", revision: next, success: false }); statusRows = nextRows; refresh(); }, 5000);
  }
  function handleState(nextState) {
    nextState = normalizeState(nextState);
    const incomingCalibration = nextState.snapshot?.config;
    if (incomingCalibration && JSON.stringify(incomingCalibration) !== JSON.stringify(lastCalibrationConfig)) {
      lastCalibrationConfig = structuredClone(incomingCalibration);
      if (activeClockEditor && activeClockEditorNode === "clock-projection") activeClockEditor.calibrationChanged();
    }
    const previousRevision = state.snapshot?.revision;
    const previousSelected = state.snapshot?.selectedPresetId;
    const previousDraft = state.draft;
    const revision = nextState.snapshot?.revision;
    const firstHydration = expectedRevision === null && Number.isSafeInteger(revision);
    const draftChanged = !equalProjectionConfig(previousDraft, nextState.draft);
    const nextSelected = nextState.snapshot?.selectedPresetId;
    const selectionChanged = nextSelected && nextSelected !== previousSelected;
    const acceptedReplacement = !localDraftNotification && (firstHydration || (!nextState.hasLocalDraft && (draftChanged || selectionChanged)));
    if (acceptedReplacement) view.cancelWarpPointer({ notify: false });
    state = nextState;
    const snapshotSelected = state.snapshot?.selectedPresetId;
    const snapshotSelectionChanged = snapshotSelected && snapshotSelected !== previousSelected;
    if (state.draft) {
      const rebase = acceptedReplacement;
      for (const output of ["left", "right"]) warpEditors[output].setConfig(state.draft, { rebase });
    }
    // Follow the server selection after the cached snapshot, while preserving
    // an explicit local dropdown choice.
    if (!selectedPresetId || (snapshotSelectionChanged && (!previousSelected || selectedPresetId === previousSelected))) selectedPresetId = snapshotSelected || "original";
    if (!loadedPresetId || (snapshotSelectionChanged && (!previousSelected || loadedPresetId === previousSelected))) loadedPresetId = snapshotSelected || loadedPresetId;
    expectRevision(state);
    if (firstHydration || draftChanged || (Number.isSafeInteger(revision) && revision !== previousRevision)) checkDraftWall();
    const advancedAfterReconnect = reconnectStatusRevision !== null && revision !== reconnectStatusRevision;
    if ((firstHydration || advancedAfterReconnect) && Number.isSafeInteger(revision) && (socket?.getConnected?.() || socket?.isConnected === true)) {
      reconnectStatusRevision = null;
      requestStatus();
    }
    refresh();
  }
  function validCandidate(candidate, path) {
    const errors = validateProjectionConfig(candidate); fieldErrors = errors;
    if (Object.keys(errors).length) { fieldErrors = Object.fromEntries(Object.entries(errors).filter(([key]) => key === path || key.startsWith(`${path}.`) || path.startsWith(`${key}.`))); refresh(); return false; }
    fieldErrors = {}; return true;
  }
  function setClientDraft(candidate) {
    localDraftNotification = true;
    try { client.setDraft(candidate); } finally { localDraftNotification = false; }
  }
  function handleField(path, raw) {
    const descriptor = descriptorFor(path); if (!descriptor) return;
    if (descriptor.wallOnly && state.draft?.namesWall?.activeMode !== "wall") return;
    if (!state.draft) { fieldErrors = { [path]: "Waiting for calibration settings" }; refresh(); return; }
    const value = fieldValueFromInput(descriptor, raw);
    const resolvedPath = resolvedFieldPath(state.draft, path);
    const candidate = setPath(state.draft, resolvedPath, value);
    if (!Number.isFinite(value)) { fieldErrors = { [path]: "must be a finite number" }; refresh(); return; }
    if (value < descriptor.min || value > descriptor.max) { fieldErrors = { [path]: `must be between ${descriptor.min} and ${descriptor.max}` }; refresh(); return; }
    if (!validCandidate(candidate, resolvedPath)) return;
    try { setClientDraft(candidate); } catch (error) { fieldErrors = { [path]: error.message }; refresh(); }
  }
  function handleNudge(path, direction) {
    const descriptor = descriptorFor(path); const value = readField(state.draft, path) + direction * fineStepFor(descriptor);
    handleField(path, String(fieldInputValue(descriptor, value)));
  }
  function handleNamesMode(mode) {
    if (!state.draft || !["wall", "model"].includes(mode)) return;
    const candidate = setPath(state.draft, "namesWall.activeMode", mode);
    if (!validCandidate(candidate, "namesWall.activeMode")) return;
    try { setClientDraft(candidate); fieldErrors = {}; }
    catch (error) { fieldErrors = { "namesWall.activeMode": error.message }; }
    refresh();
  }
  function activeWarpOutput() { return selectedNode.startsWith("right-") ? "right" : "left"; }
  function handleWarpChange(output, candidate, meta = {}) {
    try {
      setClientDraft(candidate);
      fieldErrors = {};
      if (meta.flush && client.getState?.().live) void client.apply().catch((error) => { fieldErrors = { action: error?.message || String(error) }; refresh(); });
    } catch (error) { fieldErrors = { action: error?.message || String(error) }; refresh(); }
    refresh();
  }
  function handleWarpAction(action, value) {
    const output = value?.output || activeWarpOutput();
    const editor = warpEditors[output];
    if (!editor) return;
    if (action === "warp-select") editor.select(value.selection);
    if (action === "warp-mode") editor.setMode(value.mode);
    if (action === "warp-step") editor.setStep(value.mode);
    if (action === "warp-nudge") editor.nudge(value.direction, value);
    if (action === "warp-set-position") editor.setPosition(value.axis, value.pixels);
    if (action === "warp-reset-selection") editor.resetSelection();
    if (action === "warp-reset-residuals") editor.resetResiduals();
    if (action === "warp-undo") editor.undo();
    if (action === "warp-redo") editor.redo();
    if (action === "warp-enabled") editor.setEnabled(value.enabled);
    refresh();
  }
  function handleWarpPointer(action, value) {
    const output = value?.output || activeWarpOutput();
    const editor = warpEditors[output];
    if (!editor) return;
    if (action === "start") editor.pointerStart(value);
    if (action === "move") editor.pointerMove(value);
    if (action === "end") { editor.pointerMove(value); editor.pointerEnd(); }
    if (action === "cancel") editor.pointerCancel();
    refresh();
  }
  function readPath(config, path) { return path.split(".").reduce((target, key) => target?.[key], config); }
  async function handleImport(file) {
    if (!file) return;
    try {
      const imported = typeof onImport === "function" ? await onImport(file) : await file.text();
      const parsed = typeof imported === "string" ? parseProjectionImport(imported) : imported?.config ? imported : parseProjectionImport(String(imported));
      const warnings = [...(parsed?.warnings || [])];
      const config = parsed?.config && [1, 2, 3, 4].includes(parsed.config.schemaVersion)
        ? migrateNamesWallToV5(parsed.config, warnings) : normalizeConfig(parsed?.config);
      const importErrors = validateProjectionConfig(config);
      if (Object.keys(importErrors).length) throw new Error(`invalid imported projection config: ${Object.entries(importErrors).map(([path, message]) => `${path} ${message}`).join("; ")}`);
      client.setLive(false); setClientDraft(config); view.setPresetName(parsed.name || ""); fieldErrors = {}; conflict = [...new Set(warnings)].join(" "); refresh();
    } catch (error) { fieldErrors = { import: error.message }; refresh(); }
  }
  async function handleAction(action, value) {
    if (disposed) return;
    try {
      if (action === "live") await client.setLive(Boolean(value));
      if (action === "retry-hydration") await client.retryHydration();
      if (action === "apply") await client.apply();
      if (action === "save-new") { if (!String(value || "").trim()) { fieldErrors = { name: "Enter a preset name" }; refresh(); return; } await client.save({ presetId: null, name: String(value).trim() }); selectedPresetId = loadedPresetId = client.getState?.().snapshot?.selectedPresetId || selectedPresetId; }
      if (action === "save") { const selected = state.snapshot?.presets?.find((preset) => preset.id === loadedPresetId); if (!selected || selected.readOnly || !String(value || "").trim()) { fieldErrors = { name: selected?.readOnly ? `${selected.name || "Selected preset"} is immutable` : "Enter a preset name" }; refresh(); return; } await client.save({ presetId: loadedPresetId, name: String(value).trim() }); selectedPresetId = loadedPresetId = client.getState?.().snapshot?.selectedPresetId || loadedPresetId; }
      if (action === "load") { const requested = value; await client.load(requested); selectedPresetId = loadedPresetId = requested; loadedPresetLoadToken += 1; }
      if (action === "preset-select") { selectedPresetId = value; }
      if (action === "revert") await client.revert();
      if (action === "export") { const selected = state.snapshot?.presets?.find((preset) => preset.id === loadedPresetId); const content = serializeProjectionExport(selected?.name || "Calibration", state.draft); onExport?.(content, selected?.name || "Calibration"); }
      if (action === "import") await handleImport(value);
      if (action === "share") { const result = await share?.(); const href = typeof result === "string" ? result : result?.href; view.controls.shareLink.href = href || ""; view.controls.shareLink.textContent = href || ""; view.controls.shareLink.hidden = !href; view.controls.shareQr.hidden = !href || !result?.qrRendered; if (!href) view.controls.shareQr.replaceChildren(); view.controls.shareStatus.textContent = href ? (result?.copied ? "Copied link" : "Select the link to copy") : "Share unavailable on this network."; }
      if (action === "pattern") setPattern(value);
    } catch (error) { if (action === "share") { view.controls.shareLink.href = ""; view.controls.shareLink.textContent = ""; view.controls.shareLink.hidden = true; view.controls.shareQr.hidden = true; view.controls.shareQr.replaceChildren(); view.controls.shareStatus.textContent = "Share unavailable on this network."; } else if (error?.fields) fieldErrors = error.fields; else if (error?.message?.includes("conflict")) conflict = error.message; else fieldErrors = { action, message: error?.message || String(error) }; refresh(); }
    refresh();
  }
  function sendPattern() {
    if (!socket?.send || activePattern.pattern === "off") return;
    socket.send({ type: "otef_projection_pattern", table: "otef", output: activePattern.branch, pattern: activePattern.pattern, sourceId });
  }
  function setPattern(next = {}) {
    if (patternTimer !== null) clearInterval(patternTimer);
    if (activePattern.pattern !== "off" && (next.pattern === "off" || next.branch !== activePattern.branch)) socket?.send?.({ type: "otef_projection_pattern", table: "otef", output: activePattern.branch, pattern: "off", sourceId });
    activePattern = { pattern: next.pattern || "off", branch: next.branch || "left" };
    if (activePattern.pattern !== "off") { sendPattern(); patternTimer = setInterval(sendPattern, 1000); }
  }
  function statusMessage(message) {
    if (!message || message.table !== "otef" || !["left", "right"].includes(message.output) || typeof message.instanceId !== "string" || !message.instanceId || !Number.isSafeInteger(message.revision) || message.revision < 0 || typeof message.success !== "boolean" || (!message.success && typeof message.error !== "string")) return;
    if (message.revision !== expectedRevision) return;
    if (message.route !== "browser" || !message.baseline || typeof message.baseline !== "object") return;
    const expectedWarp = state.snapshot?.config?.outputs?.[message.output]?.warp;
    const expected = expectedWarp?.enabled === false
      ? { type: "identity" }
      : (expectedWarp?.baseline || { type: "identity" });
    if (message.baseline.type !== expected.type || message.baseline.assetId !== expected.assetId || message.baseline.sha256?.toLowerCase() !== expected.sha256?.toLowerCase()) return;
    if (message.wall !== undefined) {
      const wall = message.wall;
      if (!wall || typeof wall !== 'object' || Array.isArray(wall) ||
        Object.keys(wall).sort().join('|') !== 'datasetVersion|digest|expected|mode|placed' ||
        typeof wall.datasetVersion !== 'string' || !wall.datasetVersion || wall.datasetVersion.length > 128 ||
        wall.mode !== state.snapshot?.config?.namesWall?.activeMode ||
        !/^[a-f0-9]{64}$/i.test(wall.digest) || !Number.isSafeInteger(wall.expected) ||
        wall.expected < 1 || wall.placed !== wall.expected) return;
    }
    showUnconfirmed = false;
    statusRows.delete(`${message.output}:pending`);
    statusRows.set(`${message.output}:${message.instanceId}`, message); refresh();
  }
  function requestStatus() { socket?.send?.({ type: "otef_projection_status_request", table: "otef", sourceId }); }
  async function recheckInputs() {
    if (disposed || typeof validator.readInputs !== 'function') return;
    const checkId = ++inputCheckId;
    let inputs;
    try { inputs = await validator.readInputs(); }
    catch { inputs = null; }
    if (disposed || checkId !== inputCheckId) return;
    const before = JSON.stringify(validatedInputs);
    const after = JSON.stringify(inputs);
    if (validatedInputs === null && inputs !== null) { validatedInputs = inputs; return; }
    if (before === after) return;
    validatedInputs = inputs;
    wallInspectionId += 1;
    wallMutationId += 1;
    wallValidation = { identity: '', revision: null, pending: false, result: null };
    checkDraftWall();
  }
  const onHeadingStorage = (event) => { if (event.key === NLI_LABEL_HEADING_STORAGE_KEY) void recheckInputs(); };
  const onDatasetEvent = () => { void recheckInputs(); };
  const onPageReturn = () => { void recheckInputs(); };
  const onVisibility = () => { if (globalThis.document?.visibilityState === 'visible') void recheckInputs(); };
  const unsubscribe = client.subscribe(handleState);
  const unsubscribeOutput = outputController?.subscribe?.((nextState) => { outputState = nextState; refresh(); });
  if (view.canManageDisplays) outputController?.refreshDisplays?.().catch(() => {});
  socket?.on?.("otef_projection_applied", statusMessage);
  const onConnect = () => { reconnectStatusRevision = expectedRevision; expectRevision(state, true); requestStatus(); void recheckInputs(); if (activePattern.pattern !== "off") setPattern(activePattern); refresh(); };
  socket?.on?.("connect", onConnect);
  const onDisconnect = () => { reconnectStatusRevision = null; socket?.send?.({ type: "otef_projection_pattern", table: "otef", output: activePattern.branch, pattern: "off", sourceId }); statusRows = new Map(); if (patternTimer !== null) { clearInterval(patternTimer); patternTimer = null; } refresh(); };
  socket?.on?.("disconnect", onDisconnect);
  socket?.on?.('otef_person_selection_changed', onDatasetEvent);
  socket?.on?.('otef_narrative_scene_changed', onDatasetEvent);
  win?.addEventListener?.('storage', onHeadingStorage);
  win?.addEventListener?.('pageshow', onPageReturn);
  win?.addEventListener?.('focus', onPageReturn);
  globalThis.document?.addEventListener?.('visibilitychange', onVisibility);
  if (socket?.getConnected?.() || socket?.isConnected === true) requestStatus();
  checkDraftWall();
  void recheckInputs();
  void client.start?.();
  refresh();
  return {
    sourceId,
    getStatusRows: () => [...statusRows.values()].map((row) => ({ ...row })),
    setConflict,
    dispose() { if (disposed) return; disposed = true; closeClockEditor(); for (const action of clockCueActions) action.cancel(); clockCueActions.clear(); inputCheckId += 1; wallInspectionId += 1; wallMutationId += 1; for (const editor of clockEditors) editor.dispose(); clockEditors.clear(); activeClockEditor = null; activeClockEditorNode = null; if (confirmationTimer !== null) clearTimeout(confirmationTimer); if (patternTimer !== null) clearInterval(patternTimer); socket?.send?.({ type: "otef_projection_pattern", table: "otef", output: activePattern.branch, pattern: "off", sourceId }); socket?.off?.("otef_projection_applied", statusMessage); socket?.off?.("connect", onConnect); socket?.off?.("disconnect", onDisconnect); socket?.off?.('otef_person_selection_changed', onDatasetEvent); socket?.off?.('otef_narrative_scene_changed', onDatasetEvent); win?.removeEventListener?.('storage', onHeadingStorage); win?.removeEventListener?.('pageshow', onPageReturn); win?.removeEventListener?.('focus', onPageReturn); globalThis.document?.removeEventListener?.('visibilitychange', onVisibility); unsubscribe?.(); unsubscribeOutput?.(); outputController?.dispose?.(); validator.dispose?.(); view.dispose(); client.stop?.(); },
  };
}

export { FIELD_DESCRIPTORS, NAMES_WALL_DESCRIPTORS, statusText };
