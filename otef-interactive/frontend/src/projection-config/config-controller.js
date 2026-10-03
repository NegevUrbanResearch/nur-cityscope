import {
  DEFAULT_PROJECTION_CONFIG,
  parseProjectionImport,
  serializeProjectionExport,
  migrateProjectionConfigToV7,
  validateProjectionConfig,
} from "../shared/projection-config-schema.js";
import { equalProjectionConfig } from "../shared/projection-config-client.js";
import { createUuid } from "../shared/uuid.js";
import { createProjectionConfigView } from "./config-view.js";
import { deriveGridSelectionIndices } from "./grid-layout-controls.js";
import { createParameterHistory } from './parameter-history.js';
import { createWarpEditor } from "./warp-editor.js";
import { warpCoordinateTargetKey } from "./warp-panel-view.js";
import { recordProjectionTrace, projectionTraceTime } from './projection-trace-input.js';
import { createProjectionBaselineCatalogLoader } from "../projection/projection-captured-baseline.js";
import { normalizeProjectionBaselineHash } from '../shared/projection-baseline-manifest.js';
import { openClockLayoutEditor } from "./clock-layout-editor-dialog.js";
import { openNovaExplainerEditor } from "./nova-explainer-editor-dialog.js";
import { openSettlementNameEditor } from "./settlement-name-editor-dialog.js";
import { shownSettlementPosition } from "./settlement-name-controls.js";
import { createClockExhibitCueAction } from "./clock-exhibit-cue.js";
import { OTEF_API } from "../shared/api-client.js";
import { resourceFor, layoutFor, layoutFieldEdit } from "./clock-layout-controls.js";
import { projectionPlacementInputIdentity } from "../projection/projection-names-run.js";
import { createProjectionNamesStatusTracker } from "../projection/projection-names-status.js";

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
  { path: "namesWall.rotateDeg", node: "names-wall", label: "Rotation", min: -180, max: 180, step: 1, fine: 1, unit: "°" },
  { path: "namesWall.strokeWidthPx", node: "names-wall", label: "Name outline", min: 1, max: 6, step: 1, fine: 1, unit: "px" },
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
function namesWallProfileScoped(path) {
  return path.startsWith("namesWall.") && path !== "namesWall.rotateDeg" && !path.startsWith("namesWall.innerEdgeInsetPx.");
}
function resolvedFieldPath(config, path) {
  if (!path.startsWith("namesWall.")) return path;
  const field = path.slice("namesWall.".length);
  if (field === "activeMode") return "namesWall.activeMode";
  if (field === "rotateDeg") return "namesWall.rotateDeg";
  if (field === "strokeWidthPx") return `namesWall.profiles.${config?.namesWall?.activeMode || 'wall'}.strokeWidthPx`;
  if (field.startsWith("innerEdgeInsetPx.")) return path;
  if (field === "inwardShiftPercent") return "namesWall.profiles.wall.inwardShiftPercent";
  return `namesWall.profiles.${config?.namesWall?.activeMode || 'wall'}.${field}`;
}
function readField(config, path) { return path.split(".").reduce((target, key) => target?.[key], namesWallProfileScoped(path) ? { namesWall: config?.namesWall?.profiles?.[path === "namesWall.inwardShiftPercent" ? "wall" : config?.namesWall?.activeMode] } : config); }
function normalizeConfig(config) {
  if (!config) return config;
  return migrateProjectionConfigToV7(config, config.namesWall?.rotateDeg ?? 35);
}
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
  if (state.reconciliation?.status === "reading") return "Checking accepted settings";
  if (state.reconciliation?.status === "needs-choice") return "Review accepted settings";
  if (state.reconciliation?.status === "read-error") return "Accepted settings check failed";
  if (state.hydrating) return "Connecting";
  if (state.connected === false) return "Disconnected";
  if (state.previewError) return "Failed";
  if (state.pending) return "Applying changes";
  const selected = state.snapshot?.presets?.find((preset) => preset.id === selectedPresetId);
  const checkpoint = selected?.config || state.snapshot?.config;
  if (state.hasLocalDraft || (state.draft && state.snapshot && !equalProjectionConfig(state.draft, state.snapshot.config))) return "Local draft";
  if (!checkpoint || !state.snapshot || !equalProjectionConfig(state.snapshot.config, checkpoint)) return "Accepted · preset needs saving";
  return "Saved";
}

export function projectionAppliedStatus(rows, revision) {
  const current = rows.filter((row) => row.revision === revision);
  if (current.some((row) => row.success === false && row.instanceId)) return 'Failed';
  if (!['left', 'right'].every((output) => current.some((row) => row.output === output && row.success))) return 'Pending';
  if (['left', 'right'].some((output) => current.filter((row) => row.output === output && row.instanceId).length !== 1)) return 'Unconfirmed';
  return 'Applied';
}

export function mountProjectionConfig(root, { client, share, onExport, onImport, socket, outputController, candidateValidator, baselineCatalogLoader = createProjectionBaselineCatalogLoader(), readNamesDataset = null, layoutClient, settlementClient = null, catalog = { entries: [] }, clockEditorFactory = openClockLayoutEditor, novaExplainerEditorFactory = openNovaExplainerEditor, settlementEditorFactory = openSettlementNameEditor, trace } = {}) {
  if (!client) throw new Error("projection config client is required");
  if (trace?.enabled) client.setLive(false);
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
  let activeNovaEditor = null;
  const clockEditors = new Set();
  const clockCueActions = new Set();
  let settlementOutput = "left";
  let settlementCitycode = catalog.entries?.find((entry) => entry?.citycode)?.citycode || "";
  let activeSettlementEditor = null;
  let localDraftNotification = false;
  const parameterHistory = createParameterHistory();
  const scalarGestures = new Map();
  const nudgeAnchors = new Map();
  let restoringParameter = false;
  let warpMutationDepth = 0;
  let warpRefreshPending = false;
  let pendingAction = null;
  let actionSequence = 0;
  let outputState = outputController?.getState?.() || { screens: [], assignments: { left: null, right: null }, supported: false, error: "", message: "Display management unavailable in this browser." };
  let statusRows = new Map();
  let expectedRevision = Number.isSafeInteger(state.snapshot?.revision) ? state.snapshot.revision : null;
  let reconnectStatusRevision = null;
  let confirmationTimer = null;
  let loadedPresetId = state.snapshot?.selectedPresetId || "original";
  let loadedPresetLoadToken = 0;
  let showUnconfirmed = false;
  const validator = candidateValidator || { validateCandidate: async ({ identity }) => ({ identity, valid: false, reason: 'Geometry validator unavailable' }), dispose() {} };
  const namesTracker = createProjectionNamesStatusTracker();
  let editorBaselineReady = false;
  let editorBaselineSequence = 0;
  let editorBaselineAbort = null;
  let editorBaselineIdentity = null;
  let editorBaselineMeshes = { left: null, right: null };
  let requestedEditorBaselineIdentity = null;
  const gridPreviews = { left: null, right: null };
  const gridPlacements = { left: null, right: null };
  let gridPreviewSequence = 0;
  let gridContextGeneration = 0;
  let gridContextNode = null;
  let namesRunPending = false;
  let namesDatasetVersion = "";
  let namesTargetRequest = 0;
  let namesStatusReplayPending = false;
  const win = root?.ownerDocument?.defaultView || globalThis.document?.defaultView;
  let layoutUnloadAttached = false;
  const layoutBeforeUnload = (event) => {
    if (layoutClient?.hasUnsavedWork?.() || settlementClient?.hasUnsavedWork?.()) { event.preventDefault?.(); event.returnValue = ""; }
  };
  function syncLayoutUnload() {
    const pending = !disposed && (layoutClient?.hasUnsavedWork?.() === true || settlementClient?.hasUnsavedWork?.() === true);
    if (pending === layoutUnloadAttached) return;
    layoutUnloadAttached = pending;
    if (pending) win?.addEventListener?.("beforeunload", layoutBeforeUnload);
    else win?.removeEventListener?.("beforeunload", layoutBeforeUnload);
  }
  let activePattern = { pattern: "off", branch: "left" };
  let patternTimer = null;
  const warpEditors = {
    left: createWarpEditor({ config: state.draft || DEFAULT_PROJECTION_CONFIG, output: "left", trace, onChange: (candidate, meta) => handleWarpChange("left", candidate, meta) }),
    right: createWarpEditor({ config: state.draft || DEFAULT_PROJECTION_CONFIG, output: "right", trace, onChange: (candidate, meta) => handleWarpChange("right", candidate, meta) }),
  };
  const view = createProjectionConfigView(root, {
    trace,
    descriptors: ALL_FIELD_DESCRIPTORS,
    onField: handleField,
    onFieldCancel: handleFieldCancel,
    onNudge: handleNudge,
    onWarpFieldCancel: (output) => { warpEditors[output].clearValidation(); refresh(); },
    onWarpEditorVisibility: (visible) => setGridTopologyContext(Boolean(visible)),
    onNamesMode: handleNamesMode,
    onNode: (node) => { if (!finishPendingEdit()) return false; view.cancelWarpPointer(); setGridTopologyContext(false); selectedNode = node; if (node === "clock-gis" || node === "clock-projection") { closeNovaExplainerEditor(); syncClockEditor(node); } else closeClockEditor(); if (node !== "nova-explainers") closeNovaExplainerEditor(); if (node === "settlement-names") syncSettlementEditor(); else closeSettlementEditor(); if (node.endsWith("-keystone") || node.endsWith("-grid")) warpEditors[node.startsWith("right-") ? "right" : "left"].setMode(node.endsWith("-grid") ? "grid" : "keystone"); if (view.isWarpEditorOpen?.()) setGridTopologyContext(true); refresh(); return true; },
    onOpenClockEditor: openClockEditor,
    onOpenNovaExplainerEditor: openNovaEditor,
    onOpenSettlementEditor: openSettlementEditor,
    onSettlementOutput: (output) => { if (!finishPendingEdit()) return; settlementOutput = output === "right" ? "right" : "left"; activeSettlementEditor?.setSelection({ output: settlementOutput, citycode: settlementCitycode }); refresh(); },
    onSettlementCitycode: (citycode) => { if (!finishPendingEdit()) return; settlementCitycode = citycode; activeSettlementEditor?.setSelection({ output: settlementOutput, citycode }); refresh(); },
    onSettlementPosition: (position) => { if (!settlementClient || !settlementCitycode) return; void settlementClient.commit({ kind: "position", output: settlementOutput, citycode: settlementCitycode }, position, { numeric: true }).catch(() => {}); },
    onSettlementStyle: (style) => { if (!settlementClient) return; void settlementClient.commit({ kind: "style" }, style, { numeric: true }).catch(() => {}); },
    onSettlementRecovery: (action) => {
      if (!settlementClient || !settlementCitycode) return;
      const position = { kind: "position", output: settlementOutput, citycode: settlementCitycode };
      const style = { kind: "style" };
      if (action === "load") {
        settlementClient.loadSaved(position);
        settlementClient.loadSaved(style);
      } else {
        void (settlementClient.getHydrationState?.().status === "Failed"
          ? settlementClient.hydrate({ forceFresh: true })
          : Promise.all([settlementClient.retry(position), settlementClient.retry(style)])).catch(() => {});
      }
      refresh();
    },
    onClockScene: (sceneId) => { if (!finishPendingEdit()) return; clockSceneId = sceneId; activeClockEditor?.setSelection({ nodeId: "clock-gis", sceneId: clockSceneId, element: clockElement }); refresh(); },
    onClockElement: (nextElement) => { if (!finishPendingEdit()) return; clockElement = nextElement; activeClockEditor?.setSelection({ nodeId: "clock-projection", sceneId: clockSceneId, element: clockElement }); refresh(); },
    onClockField: (key, raw) => {
      if (!layoutClient || !["clock-gis", "clock-projection"].includes(selectedNode) || layoutClient.getHydrationState?.().status === "Failed") return;
      const selection = resourceFor(selectedNode, clockSceneId, clockElement);
      const next = layoutFieldEdit(layoutFor(layoutClient, selection).layout, key, raw);
      if (next) void layoutClient.commit(selection.resource, selection.slot, next, { numeric: true }).catch(() => {});
      refresh();
    },
    onClockRecovery: (action, node) => {
      if (!layoutClient) return;
      const selection = resourceFor(node, clockSceneId, clockElement);
      if (action === "load") layoutClient.loadSaved(selection.resource, selection.slot);
      else void (layoutClient.getHydrationState?.().status === "Failed" ? layoutClient.hydrate({ forceFresh: true }) : layoutClient.retry(selection.resource, selection.slot)).catch(() => {});
      refresh();
    },
    onAction: handleAction,
    onRunNames: runNames,
    onOutputAction: handleOutputAction,
    onWarpAction: handleWarpAction,
    onWarpPointer: handleWarpPointer,
  });
  client.setValidateCandidate?.((args) => validator.validateCandidate(args));
  void syncWarpEditorsForConfig(state.draft || DEFAULT_PROJECTION_CONFIG, true);

  function baselineIdentityFor(config) {
    return Object.fromEntries(["left", "right"].map((output) => {
      const warp = config?.outputs?.[output]?.warp;
      return [output, warp?.enabled !== false && warp?.baseline?.type === "tdMesh"
        ? JSON.stringify([output, warp.baseline.assetId, normalizeProjectionBaselineHash(warp.baseline.sha256)]) : null];
    }));
  }
  function syncWarpEditorsForConfig(config, rebase = false) {
    if (!config) return;
    if (rebase) view.retireWarpGestures?.();
    const identity = baselineIdentityFor(config);
    if (editorBaselineIdentity && JSON.stringify(identity) === JSON.stringify(editorBaselineIdentity)) {
      if (JSON.stringify(identity) !== JSON.stringify(requestedEditorBaselineIdentity)) {
        editorBaselineSequence += 1;
        editorBaselineAbort?.abort();
        editorBaselineAbort = null;
        requestedEditorBaselineIdentity = identity;
      }
      for (const output of ["left", "right"]) warpEditors[output].setBaselineMesh(editorBaselineMeshes[output]);
      for (const output of ["left", "right"]) warpEditors[output].setConfig(config, { rebase });
      editorBaselineReady = true;
      return;
    }
    if (JSON.stringify(identity) === JSON.stringify(requestedEditorBaselineIdentity)) return;
    requestedEditorBaselineIdentity = identity;
    const token = ++editorBaselineSequence;
    editorBaselineAbort?.abort();
    editorBaselineAbort = null;
    editorBaselineReady = false;
    view.cancelWarpPointer({ notify: false });
    view.retireWarpGestures?.();
    // Clear editor drag state while its rollback callback is suspended. The
    // pointer adapter has already dropped the gesture without publishing it.
    for (const output of ["left", "right"]) warpEditors[output].pointerCancel();
    for (const output of ["left", "right"]) warpEditors[output].setBaselineMesh(null);
    for (const output of ["left", "right"]) warpEditors[output].setConfig(config, { rebase: false });
    if (!Object.values(identity).some(Boolean)) {
      for (const output of ["left", "right"]) warpEditors[output].setConfig(config, { rebase: true });
      editorBaselineIdentity = identity;
      editorBaselineMeshes = { left: null, right: null };
      editorBaselineReady = true;
      refresh();
      return;
    }
    const controller = new AbortController();
    editorBaselineAbort = controller;
    void baselineCatalogLoader.prepare(config, controller.signal).then(({ snapshot, loaded }) => {
      if (disposed || controller.signal.aborted || token !== editorBaselineSequence ||
        JSON.stringify(baselineIdentityFor(state.draft)) !== JSON.stringify(identity)) return;
      const currentConfig = state.draft;
      for (const output of ["left", "right"]) warpEditors[output].setBaselineMesh(loaded[output]?.mesh || null);
      editorBaselineMeshes = { left: loaded.left?.mesh || null, right: loaded.right?.mesh || null };
      for (const output of ["left", "right"]) warpEditors[output].setConfig(currentConfig, { rebase: true });
      editorBaselineIdentity = identity;
      requestedEditorBaselineIdentity = identity;
      editorBaselineAbort = null;
      baselineCatalogLoader.promote(snapshot);
      editorBaselineReady = true;
      refresh();
    }).catch(() => {
      if (disposed || controller.signal.aborted || token !== editorBaselineSequence) return;
      requestedEditorBaselineIdentity = null;
      editorBaselineAbort = null;
      refresh();
    });
  }

  function rowText(row) {
    const identity = row.instanceId ? ` · ${row.instanceId}` : "";
    const label = row.output[0].toUpperCase() + row.output.slice(1);
    const status = row.revision !== expectedRevision ? "Not confirmed" : row.success ? "Applied" : row.error || "Not confirmed";
    return `${label} · revision ${row.revision} · ${status}${identity}`;
  }
  function refresh() {
    if (disposed) return;
    syncLayoutUnload();
    if (warpMutationDepth > 0) { warpRefreshPending = true; return; }
    const traceStarted = projectionTraceTime(trace);
    recordProjectionTrace(trace, 'redraw', { surface: 'page', phase: 'start', live: Boolean(state.live) });
    const rows = [...statusRows.values()].map((row) => ({ ...row, text: rowText(row) }));
    const warpStates = Object.fromEntries(["left", "right"].map((output) => {
      const editor = warpEditors[output];
      const pendingPreview = gridPreviews[output];
      let evaluatedMesh = null;
      try { evaluatedMesh = editor.getEvaluatedMesh(); } catch {}
      if (pendingPreview?.ok && pendingPreview.baseWarpIdentity !== JSON.stringify(editor.getConfig().outputs[output].warp)) {
        gridPreviews[output] = { ...pendingPreview, id: ++gridPreviewSequence, ok: false, status: "error", error: "The warp changed. Preview the grid edit again." };
      }
      const placement = gridPlacements[output];
      if (placement?.preview && placement.preview.baseWarpIdentity !== JSON.stringify(editor.getConfig().outputs[output].warp)) {
        gridPlacements[output] = { ...placement, preview: null, error: "The warp changed. Choose a new source percentage or click to place again." };
      }
      return [output, { ...editor.getState(), gridLayoutPreview: gridPreviews[output], gridPlacement: gridPlacements[output],
      ...(!editorBaselineReady ? { baselineAvailable: false, historyDepth: 0, redoDepth: 0 } : {}),
      config: editor.getConfig(), baselineMesh: editorBaselineMeshes[output], evaluatedMesh, handles: editor.getControlPoints() }];
    }));
    view.update({ state: { ...state, selectedPresetId }, errors: fieldErrors, parameterHistory: parameterHistory.state(),
      conflict: conflict || state.migrationWarnings?.join(' ') || '',
      statusText: pendingAction
        ? ({ save: "Saving preset", apply: "Applying changes", load: "Loading preset", revert: "Reverting settings" }[pendingAction.kind])
        : conflict ? "Conflict" : fieldErrors.action || state.previewError ? "Failed" : statusText(state, loadedPresetId),
      draftDiffersFromAccepted: Boolean(state.draft && state.snapshot?.config && !equalProjectionConfig(state.draft, state.snapshot.config)),
      savePending: pendingAction?.kind === "save",
      selectedNode, loadedPresetId, loadedPresetLoadToken, statusRows: rows,
      appliedSummary: projectionAppliedStatus(rows, expectedRevision), outputState, warpStates, activePattern,
      namesWallStatus: namesRunPending && !namesTracker.getState().pending
        ? { ...namesTracker.getState(), state: "rebuilding", pending: true, detail: "Starting names run…" }
        : namesTracker.getState(), namesRunDisabledReason: runNamesDisabledReason(), clockScene: clockSceneId, clockElement,
      clockLayouts: layoutClient ? Object.fromEntries(["clock-gis", "nova-explainers", "clock-projection"].map((node) => [node, layoutFor(layoutClient, resourceFor(node, clockSceneId, clockElement))])) : {},
      clockHydration: layoutClient?.getHydrationState?.() || { status: layoutClient ? "Saved" : "Loading" },
      settlement: settlementViewState() });
    recordProjectionTrace(trace, 'redraw', { surface: 'page', phase: 'end', durationMs: projectionTraceTime(trace) - traceStarted });
  }
  function withWarpMutation(mutation) {
    warpMutationDepth += 1;
    try { return mutation(); }
    finally {
      warpMutationDepth -= 1;
      if (warpMutationDepth === 0 && warpRefreshPending) {
        warpRefreshPending = false;
        refresh();
      }
    }
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
  function settlementViewState() {
    if (!settlementClient) return null;
    const settings = settlementClient.getSnapshot()?.settings || null;
    const positionRecord = settlementCitycode ? settlementClient.getTarget({ kind: "position", output: settlementOutput, citycode: settlementCitycode }) : null;
    const styleRecord = settlementClient.getTarget({ kind: "style" });
    return {
      output: settlementOutput,
      citycode: settlementCitycode,
      catalog,
      position: shownSettlementPosition(settings, positionRecord, settlementOutput, settlementCitycode),
      style: styleRecord?.draft || styleRecord?.acknowledged || settings?.style || null,
      positionRecord,
      styleRecord,
      hydration: settlementClient.getHydrationState?.() || { status: "Loading" },
    };
  }
  function syncSettlementEditor() {
    activeSettlementEditor?.setSelection({ output: settlementOutput, citycode: settlementCitycode });
  }
  function closeSettlementEditor() {
    if (!activeSettlementEditor) return;
    const editor = activeSettlementEditor;
    activeSettlementEditor = null;
    editor.close();
  }
  function closeNovaExplainerEditor() {
    if (!activeNovaEditor) return;
    const editor = activeNovaEditor;
    activeNovaEditor = null;
    editor.dispose();
  }
  function openNovaEditor() {
    if (!layoutClient) return;
    view.cancelWarpPointer();
    view.closeWarpEditor();
    closeClockEditor();
    closeSettlementEditor();
    selectedNode = "nova-explainers";
    if (activeNovaEditor) { refresh(); return; }
    const editor = novaExplainerEditorFactory({
      layoutClient,
      manageBeforeUnload: false,
      document: root?.ownerDocument || globalThis.document,
      restoreFocus: () => view.getNovaExplainerEditorOpener(),
      onClose: () => { if (activeNovaEditor === editor) activeNovaEditor = null; },
    });
    activeNovaEditor = editor;
    refresh();
  }
  function openSettlementEditor() {
    if (!settlementClient) return;
    view.cancelWarpPointer();
    view.closeWarpEditor();
    closeClockEditor();
    closeNovaExplainerEditor();
    selectedNode = "settlement-names";
    if (activeSettlementEditor) { syncSettlementEditor(); refresh(); return; }
    const editor = settlementEditorFactory({
      nodeId: "settlement-names",
      output: settlementOutput,
      citycode: settlementCitycode,
      settingsClient: settlementClient,
      catalog,
      manageBeforeUnload: false,
      document: root?.ownerDocument || globalThis.document,
      onSelection: ({ output, citycode }) => { settlementOutput = output; settlementCitycode = citycode; refresh(); },
      restoreFocus: () => view.getSettlementEditorOpener(),
      onClose: () => { if (activeSettlementEditor === editor) activeSettlementEditor = null; },
    });
    activeSettlementEditor = editor;
    refresh();
  }
  function openClockEditor(nodeId) {
    if (!layoutClient || !["clock-gis", "clock-projection"].includes(nodeId)) return;
    view.cancelWarpPointer();
    view.closeWarpEditor();
    closeSettlementEditor();
    closeNovaExplainerEditor();
    selectedNode = nodeId;
    if (activeClockEditor) { syncClockEditor(nodeId); refresh(); return; }
    const editor = clockEditorFactory({ nodeId, sceneId: clockSceneId, element: clockElement, layoutClient,
      manageBeforeUnload: false,
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
  function runNamesDisabledReason() {
    if (namesRunPending || namesTracker.getState().pending) return "Names are rebuilding on both outputs.";
    if (state.pending || state.hasLocalDraft || !state.draft || !state.snapshot?.config || !equalProjectionConfig(state.draft, state.snapshot.config)) return "Apply the pending calibration before running names.";
    if (!['left', 'right'].every((output) => {
      const rows = [...statusRows.values()].filter((row) => row.output === output && row.revision === expectedRevision && row.instanceId);
      return rows.length === 1 && rows[0].success;
    })) return "Wait for both outputs to apply the current calibration.";
    if (namesTracker.getState().state === "rebuilding") return "Names are rebuilding on both outputs.";
    if (!socket?.getConnected?.() && socket?.isConnected !== true) return "Projection outputs are disconnected.";
    return "";
  }
  async function updateNamesTarget(readDataset = false) {
    const snapshot = state.snapshot;
    if (!snapshot?.config || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) { namesTracker.setTarget(null); refresh(); return false; }
    const token = ++namesTargetRequest;
    try {
      if (readDataset) {
        const inputs = await readNamesDataset?.();
        if (disposed || token !== namesTargetRequest || state.snapshot?.revision !== snapshot.revision) return false;
        namesDatasetVersion = typeof inputs?.datasetVersion === "string" && inputs.datasetVersion.trim() && inputs.datasetVersion.length <= 128 ? inputs.datasetVersion : "";
      }
      const placementIdentity = await projectionPlacementInputIdentity(snapshot.config);
      if (disposed || token !== namesTargetRequest || state.snapshot?.revision !== snapshot.revision) return false;
      const changed = namesDatasetVersion
        ? namesTracker.setTarget({ revision: snapshot.revision, datasetVersion: namesDatasetVersion, placementIdentity })
        : namesTracker.setTarget(null);
      if (changed) namesRunPending = false;
      refresh();
      return Boolean(namesDatasetVersion);
    } catch {
      if (token === namesTargetRequest) { namesTracker.setTarget(null); namesRunPending = false; }
      refresh();
      return false;
    }
  }
  async function runNames() {
    const reason = runNamesDisabledReason();
    if (reason) { fieldErrors = { action: reason }; refresh(); return false; }
    if (typeof readNamesDataset !== "function") { fieldErrors = { action: "Names dataset identity is unavailable." }; refresh(); return false; }
    const snapshot = state.snapshot;
    const config = clone(snapshot.config);
    const revision = snapshot.revision;
    if (!Number.isSafeInteger(revision) || revision < 0) return false;
    namesRunPending = true;
    refresh();
    try {
      const inputs = await readNamesDataset();
      const datasetVersion = inputs?.datasetVersion;
      if (disposed || state.snapshot?.revision !== revision || !equalProjectionConfig(state.draft, config) ||
        state.pending || state.hasLocalDraft || typeof datasetVersion !== "string" || !datasetVersion.trim() || datasetVersion.length > 128) {
        namesRunPending = false; refresh(); return false;
      }
      const placementIdentity = await projectionPlacementInputIdentity(config);
      namesDatasetVersion = datasetVersion;
      namesTracker.setTarget({ revision, datasetVersion, placementIdentity });
      const requestId = createUuid();
      if (!namesTracker.beginRequest(requestId)) { namesRunPending = false; refresh(); return false; }
      socket?.send?.({ type: "otef_projection_names_run", table: "otef", requestId, revision, datasetVersion, placementIdentity });
      view.sendRunNamesPreview?.(config);
      fieldErrors = {};
      refresh();
      return true;
    } catch (error) {
      namesRunPending = false;
      fieldErrors = { action: error?.message || "Names dataset identity is unavailable." };
      refresh();
      return false;
    }
  }
  async function handleOutputAction(action, value) {
    if (!outputController) { fieldErrors = { action: "Workstation output controls are unavailable in this browser." }; refresh(); return; }
    try {
      if (action === "identify") await outputController.identifyDisplays();
      if (action === "refresh") await outputController.refreshDisplays();
      if (action === "assign") outputController.assignDisplays(value);
      if (action === "open") await outputController.openBoth();
      if (action === "open-left") await outputController.openSide("left");
      if (action === "open-right") await outputController.openSide("right");
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
  function handleState(nextState, receipt) {
    nextState = normalizeState(nextState);
    recordProjectionTrace(trace, 'receipt', { receiptType: localDraftNotification ? 'local_draft' : 'configuration_received', ...(Number.isSafeInteger(nextState.snapshot?.revision) ? { revision: nextState.snapshot.revision } : {}), live: Boolean(nextState.live) });
    const incomingCalibration = nextState.snapshot?.config;
    if (incomingCalibration && JSON.stringify(incomingCalibration) !== JSON.stringify(lastCalibrationConfig)) {
      lastCalibrationConfig = structuredClone(incomingCalibration);
      if (activeClockEditor && activeClockEditorNode === "clock-projection") activeClockEditor.calibrationChanged();
      activeSettlementEditor?.calibrationChanged();
    }
    const previousRevision = state.snapshot?.revision;
    const previousSelected = state.snapshot?.selectedPresetId;
    const previousDraft = state.draft;
    const revision = nextState.snapshot?.revision;
    const firstHydration = expectedRevision === null && Number.isSafeInteger(revision);
    const draftChanged = !equalProjectionConfig(previousDraft, nextState.draft);
    const nextSelected = nextState.snapshot?.selectedPresetId;
    const selectionChanged = nextSelected && nextSelected !== previousSelected;
    const acceptedReplacement = !localDraftNotification && receipt?.action !== "save" && (firstHydration || (!nextState.hasLocalDraft && (draftChanged || selectionChanged)));
    if (!localDraftNotification && draftChanged) {
      const changed = ALL_FIELD_DESCRIPTORS.flatMap(descriptor => {
        const paths = new Set([resolvedFieldPath(previousDraft, descriptor.path), resolvedFieldPath(nextState.draft, descriptor.path)]);
        return [...paths].filter(path => !Object.is(readPath(previousDraft, path), readPath(nextState.draft, path)));
      });
      parameterHistory.invalidate(changed);
      for (const path of changed) { nudgeAnchors.delete(path); for (const [id, gesture] of scalarGestures) if (gesture.path === path) scalarGestures.delete(id); }
    }
    if (acceptedReplacement) { parameterHistory.clear(); nudgeAnchors.clear(); scalarGestures.clear(); }
    if (acceptedReplacement) view.cancelWarpPointer({ notify: false });
    state = nextState;
    const snapshotSelected = state.snapshot?.selectedPresetId;
    const snapshotSelectionChanged = snapshotSelected && snapshotSelected !== previousSelected;
    if (state.draft) syncWarpEditorsForConfig(state.draft, acceptedReplacement);
    // Follow the server selection after the cached snapshot, while preserving
    // an explicit local dropdown choice.
    if (!selectedPresetId || (snapshotSelectionChanged && (!previousSelected || selectedPresetId === previousSelected))) selectedPresetId = snapshotSelected || "original";
    if (!loadedPresetId || (!state.hasLocalDraft && snapshotSelectionChanged && (!previousSelected || loadedPresetId === previousSelected))) loadedPresetId = snapshotSelected || loadedPresetId;
    expectRevision(state);
    const targetUpdate = firstHydration || (Number.isSafeInteger(revision) && revision !== previousRevision)
      ? updateNamesTarget(!namesDatasetVersion)
      : null;
    if ((firstHydration || (Number.isSafeInteger(revision) && revision !== previousRevision)) &&
      (socket?.getConnected?.() || socket?.isConnected === true)) namesStatusReplayPending = true;
    const advancedAfterReconnect = reconnectStatusRevision !== null && revision !== reconnectStatusRevision;
    if (!firstHydration && advancedAfterReconnect && Number.isSafeInteger(revision) && (socket?.getConnected?.() || socket?.isConnected === true)) namesStatusReplayPending = true;
    if (namesStatusReplayPending && targetUpdate && Number.isSafeInteger(revision) && (socket?.getConnected?.() || socket?.isConnected === true)) {
      void targetUpdate.then((ready) => {
        if (ready && !disposed && namesStatusReplayPending && state.snapshot?.revision === revision && (socket?.getConnected?.() || socket?.isConnected === true)) {
          namesStatusReplayPending = false;
          reconnectStatusRevision = null;
          requestStatus();
        }
      });
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
  function commitScalar({ path, resolvedPath: editPath, value, baseValue, override = false, phase, gestureId }) {
    const descriptor = descriptorFor(path);
    if (!descriptor) return false;
    const reject = (message, key = path) => { fieldErrors = { [key]: message }; refresh(); return false; };
    if (!state.draft) return reject("Waiting for calibration settings");
    const resolvedPath = resolvedFieldPath(state.draft, path);
    if (descriptor.wallOnly && state.draft.namesWall.activeMode !== "wall") return reject("Target changed while editing. Use latest and restart.", resolvedPath);
    if (editPath !== undefined && editPath !== resolvedPath) return reject("Target changed while editing. Use latest and restart.", resolvedPath);
    const current = readPath(state.draft, resolvedPath);
    const gesture = gestureId ? scalarGestures.get(gestureId) : null;
    if (['update', 'end', 'cancel'].includes(phase) && gestureId && !gesture) return reject('Gesture ended or the value changed. Use latest and restart.', resolvedPath);
    if (gesture && (gesture.path !== resolvedPath || !Object.is(current, gesture.last))) return reject('Value changed while editing. Use latest and restart.', resolvedPath);
    if (phase === 'cancel') {
      restoringParameter = true;
      try {
        const accepted = commitScalar({ path, resolvedPath, value: gesture.before, baseValue: current });
        if (accepted) { scalarGestures.delete(gestureId); nudgeAnchors.delete(resolvedPath); }
        return accepted;
      } finally { restoringParameter = false; }
    }
    if (baseValue !== undefined && !override && !Object.is(current, baseValue)) return reject("Value changed while editing. Use latest or use my value.", resolvedPath);
    if (!Number.isFinite(value)) return reject("must be a finite number", resolvedPath);
    if (value < descriptor.min || value > descriptor.max) return reject(`must be between ${fieldInputValue(descriptor, descriptor.min)} and ${fieldInputValue(descriptor, descriptor.max)}${descriptor.unit ? ` ${descriptor.unit}` : ""}`, resolvedPath);
    if (Object.is(current, value)) {
      if (phase === 'start' && gestureId) scalarGestures.set(gestureId, { path: resolvedPath, before: current, last: current });
      if (phase === 'end' && gesture) { parameterHistory.record({ path: resolvedPath, before: gesture.before, after: current }); scalarGestures.delete(gestureId); }
      fieldErrors = Object.fromEntries(Object.entries(fieldErrors).filter(([key]) => key !== resolvedPath && !key.startsWith(`${resolvedPath}.`) && !resolvedPath.startsWith(`${key}.`)));
      refresh(); return true;
    }
    const candidate = setPath(state.draft, resolvedPath, value);
    if (!validCandidate(candidate, resolvedPath)) return false;
    try {
      setClientDraft(candidate);
      if (!restoringParameter) {
        if (gestureId && phase) {
          const active = gesture || { path: resolvedPath, before: current, last: current };
          active.last = value;
          if (phase === 'end') { parameterHistory.record({ path: resolvedPath, before: active.before, after: value }); scalarGestures.delete(gestureId); }
          else scalarGestures.set(gestureId, active);
        } else parameterHistory.record({ path: resolvedPath, before: current, after: value });
      }
      refresh(); return true;
    }
    catch (error) { return reject(error.message, resolvedPath); }
  }
  function handleField(path, raw, inputKind, editMeta = {}) {
    const descriptor = descriptorFor(path);
    if (!descriptor) return false;
    if (!editMeta.phase || editMeta.phase === 'start') nudgeAnchors.delete(resolvedFieldPath(state.draft, path));
    return commitScalar({ path, ...editMeta, value: editMeta.canonicalValue !== undefined ? editMeta.canonicalValue : fieldValueFromInput(descriptor, raw) });
  }
  function gridCandidate(editor, output, preview) {
    const candidate = editor.getConfig();
    candidate.outputs[output].warp.grid = clone(preview.grid);
    return candidate;
  }
  async function validateGridCandidate(candidate, token) {
    const identity = JSON.stringify(candidate);
    const revision = Number.isSafeInteger(expectedRevision) ? expectedRevision + 1 : 1;
    const result = await validator.validateCandidate({ config: clone(candidate), identity, generation: token, revision });
    return result?.valid === true && result.identity === identity ? { valid: true } : { valid: false, reason: result?.reason || "Candidate geometry was rejected." };
  }
  function currentGridDraftIdentity() { return JSON.stringify(state.draft || DEFAULT_PROJECTION_CONFIG); }
  async function startGridLayoutPreview(output, operation, values) {
    if (!finishPendingEdit()) return false;
    const contextGeneration = gridContextGeneration;
    const contextNode = `${output}-grid`;
    if (!ownsGridTopologyContext(output, contextGeneration, contextNode)) return false;
    const editor = warpEditors[output];
    if (!editor || editor.getState().adjusting) return false;
    const id = ++gridPreviewSequence;
    const preview = editor.previewGridLayout(operation, values);
    if (!preview.ok) {
      gridPreviews[output] = { ...preview, id, status: "error", requiresConfirmation: true };
      refresh();
      return false;
    }
    const baseDraftIdentity = currentGridDraftIdentity();
    const pending = { ...preview, id, status: "validating", contextGeneration, contextNode };
    gridPreviews[output] = pending;
    refresh();
    try {
      const candidate = gridCandidate(editor, output, preview);
      const result = await validateGridCandidate(candidate, id);
      if (disposed || gridPreviews[output]?.id !== id || gridPreviews[output]?.status !== "validating" || !ownsGridTopologyContext(output, contextGeneration, contextNode)) return false;
      if (preview.output !== output || JSON.stringify(editor.getConfig().outputs[output].warp) !== preview.baseWarpIdentity || currentGridDraftIdentity() !== baseDraftIdentity) {
        gridPreviews[output] = { ...pending, ok: false, status: "error", error: "The draft changed while checking this preview. Preview the grid edit again." };
        refresh();
        return false;
      }
      if (!result.valid) {
        gridPreviews[output] = { ...pending, ok: false, status: "error", error: result.reason };
        refresh();
        return false;
      }
      if (preview.requiresConfirmation) {
        gridPlacements[output] = null;
        gridPreviews[output] = { ...pending, status: "ready" };
        refresh();
        return true;
      }
      gridPreviews[output] = null;
      gridPlacements[output] = null;
      const committed = withWarpMutation(() => editor.commitGridLayoutPreview(preview));
      if (!committed) gridPreviews[output] = { ...pending, ok: false, status: "error", error: editor.getState().validationMessage || "The preview is stale." };
      refresh();
      return committed;
    } catch (error) {
      if (gridPreviews[output]?.id === id && ownsGridTopologyContext(output, contextGeneration, contextNode)) {
        gridPreviews[output] = { ...pending, ok: false, status: "error", error: error?.message || "Candidate validation failed." };
        refresh();
      }
      return false;
    }
  }
  async function confirmGridLayoutPreview(output) {
    const pending = gridPreviews[output];
    const editor = warpEditors[output];
    if (!pending?.ok || pending.status !== "ready" || !editor || editor.getState().adjusting || !ownsGridTopologyContext(output, pending.contextGeneration, pending.contextNode)) return false;
    if (JSON.stringify(editor.getConfig().outputs[output].warp) !== pending.baseWarpIdentity) {
      gridPreviews[output] = { ...pending, ok: false, status: "error", error: "The warp changed. Preview the grid edit again." };
      refresh();
      return false;
    }
    const token = ++gridPreviewSequence;
    const latestDraftIdentity = currentGridDraftIdentity();
    gridPreviews[output] = { ...pending, status: "validating" };
    refresh();
    try {
      const candidate = gridCandidate(editor, output, pending);
      const result = await validateGridCandidate(candidate, token);
      if (disposed || gridPreviews[output]?.id !== pending.id || gridPreviews[output]?.status !== "validating" || !ownsGridTopologyContext(output, pending.contextGeneration, pending.contextNode)) return false;
      if (JSON.stringify(editor.getConfig().outputs[output].warp) !== pending.baseWarpIdentity || currentGridDraftIdentity() !== latestDraftIdentity) {
        gridPreviews[output] = { ...pending, ok: false, status: "error", error: "The draft changed while checking this confirmation. Preview the grid edit again." };
        refresh();
        return false;
      }
      if (!result.valid) {
        gridPreviews[output] = { ...pending, ok: false, status: "error", error: result.reason };
        refresh();
        return false;
      }
      gridPreviews[output] = null;
      gridPlacements[output] = null;
      const committed = withWarpMutation(() => editor.commitGridLayoutPreview(pending));
      if (!committed) gridPreviews[output] = { ...pending, ok: false, status: "error", error: editor.getState().validationMessage || "The preview is stale." };
      refresh();
      return committed;
    } catch (error) {
      if (gridPreviews[output]?.id === pending.id && ownsGridTopologyContext(output, pending.contextGeneration, pending.contextNode)) {
        gridPreviews[output] = { ...pending, ok: false, status: "error", error: error?.message || "Candidate validation failed." };
        refresh();
      }
      return false;
    }
  }
  function handleFieldCancel(path, resolvedPath = path) {
    const target = resolvedPath || path;
    const next = Object.fromEntries(Object.entries(fieldErrors).filter(([key]) => key !== target && !key.startsWith(`${target}.`) && !target.startsWith(`${key}.`)));
    if (Object.keys(next).length === Object.keys(fieldErrors).length) return;
    fieldErrors = next;
    refresh();
  }
  function handleNudge(path, direction, meta = {}) {
    const descriptor = descriptorFor(path); if (!descriptor || !state.draft) return false;
    const resolvedPath = resolvedFieldPath(state.draft, path); const current = readPath(state.draft, resolvedPath);
    if (meta.phase === 'sensitivity') { nudgeAnchors.delete(resolvedPath); return true; }
    let anchor = nudgeAnchors.get(resolvedPath);
    if (!anchor || !Object.is(anchor.last, current) || anchor.step !== descriptor.fine || meta.phase === 'start') anchor = { base: current, count: 0, last: current, step: descriptor.fine };
    const count = meta.count !== undefined ? meta.count * direction : anchor.count + direction;
    const value = count === 0 ? anchor.base : anchor.base + count * descriptor.fine;
    const accepted = commitScalar({ path, resolvedPath, value, baseValue: current, ...meta });
    if (accepted && meta.phase !== 'cancel') { anchor.count = count; anchor.last = value; nudgeAnchors.set(resolvedPath, anchor); }
    return accepted;
  }
  function restoreParameter(direction) {
    if (!finishPendingEdit()) return false;
    const entry = direction === 'undo' ? parameterHistory.peekUndo() : parameterHistory.peekRedo();
    if (!entry) return false;
    const descriptor = ALL_FIELD_DESCRIPTORS.find(item => resolvedFieldPath(state.draft, item.path) === entry.path);
    if (!descriptor) { fieldErrors = { action: 'Parameter target changed. Use the current profile.' }; refresh(); return false; }
    restoringParameter = true;
    try {
      const accepted = commitScalar({ path: descriptor.path, resolvedPath: entry.path, value: direction === 'undo' ? entry.before : entry.after, baseValue: direction === 'undo' ? entry.after : entry.before });
      if (accepted) { direction === 'undo' ? parameterHistory.commitUndo() : parameterHistory.commitRedo(); nudgeAnchors.delete(entry.path); }
      refresh(); return accepted;
    } finally { restoringParameter = false; }
  }
  function handleNamesMode(mode) {
    if (!finishPendingEdit()) return false;
    if (!state.draft || !["wall", "model"].includes(mode)) return;
    const candidate = setPath(state.draft, "namesWall.activeMode", mode);
    if (!validCandidate(candidate, "namesWall.activeMode")) return;
    try { setClientDraft(candidate); fieldErrors = {}; }
    catch (error) { fieldErrors = { "namesWall.activeMode": error.message }; }
    refresh();
  }
  function activeWarpOutput() { return selectedNode.startsWith("right-") ? "right" : "left"; }
  function setGridTopologyContext(active) {
    gridContextGeneration += 1;
    gridPreviewSequence += 1;
    gridContextNode = active && selectedNode.endsWith("-grid") ? selectedNode : null;
    for (const output of ["left", "right"]) {
      gridPreviews[output] = null;
      gridPlacements[output] = null;
    }
    refresh();
  }
  function ownsGridTopologyContext(output, generation, node = `${output}-grid`) {
    return gridContextGeneration === generation && gridContextNode === node && selectedNode === node;
  }
  function hasHeldGesture() { return Object.values(warpEditors).some(editor => editor.getState().adjusting) || view.hasHeldNumericEdit(); }
  function finishPendingEdit() {
    if (hasHeldGesture()) { fieldErrors = { ...fieldErrors, action: "Finish or cancel the active gesture before continuing." }; refresh(); return false; }
    const finished = view.finishPendingEdit();
    if (!finished) refresh();
    return finished;
  }
  function discardPendingEdit() {
    if (!hasHeldGesture() && !view.hasPendingEdit()) return true;
    if (win?.confirm?.("Discard the pending edit or gesture and replace the calibration draft?") !== true) return false;
    view.cancelNumericEdits({ notify: false }); scalarGestures.clear(); nudgeAnchors.clear();
    view.cancelWarpPointer({ notify: false });
    for (const editor of Object.values(warpEditors)) editor.retireGesture();
    fieldErrors = {}; refresh();
    return true;
  }
  function handleWarpChange(output, candidate, meta = {}) {
    if (disposed || !editorBaselineReady) return;
    try {
      setClientDraft(candidate);
      fieldErrors = {};
      if (meta.flush && client.getState?.().live) void client.apply().catch((error) => { fieldErrors = { action: error?.message || String(error) }; refresh(); });
    } catch (error) { fieldErrors = { action: error?.message || String(error) }; refresh(); }
    refresh();
  }
  function handleWarpAction(action, value) {
    if (disposed || (!editorBaselineReady && !["warp-select", "warp-mode", "warp-step"].includes(action))) return false;
    if (["warp-select", "warp-mode"].includes(action) && !finishPendingEdit()) return false;
    if (action === "warp-grid-layout") return startGridLayoutPreview(value?.output || activeWarpOutput(), value?.operation, value || {});
    if (action === "warp-grid-placement") {
      const output = value?.output || activeWarpOutput();
      const axis = value?.axis;
      const generation = gridContextGeneration;
      if (!ownsGridTopologyContext(output, generation)) return false;
      gridPreviewSequence += 1;
      gridPreviews[output] = null;
      if (axis) {
        const editor = warpEditors[output];
        const grid = editor.getConfig().outputs[output].warp.grid;
        const { rowIndex, columnIndex } = deriveGridSelectionIndices(grid, editor.getState().selection);
        const positions = axis === "row" ? grid.rowPositions : grid.columnPositions;
        const index = axis === "row" ? rowIndex : columnIndex;
        const position = ((positions[Math.min(index, positions.length - 2)] + positions[Math.min(index + 1, positions.length - 1)]) / 2) * 100;
        const preview = editor.previewGridLayout("add", { axis, position });
        gridPlacements[output] = { axis, position, error: preview.ok ? "" : preview.error, blocked: !preview.ok && /maximum count/i.test(preview.error || ""), preview: preview.ok ? preview : null };
      } else gridPlacements[output] = null;
      refresh();
      return true;
    }
    if (action === "warp-grid-placement-error") {
      const output = value?.output || activeWarpOutput();
      if (gridPlacements[output]?.axis === value?.axis) {
        const reason = value.reason === "ambiguous" ? "This viewer location overlaps multiple source positions. Enter a source percentage instead." : value.reason === "degenerate" ? "This part of the evaluated mesh cannot be inverted. Enter a source percentage instead." : "This click is outside the evaluated mesh. Enter a source percentage instead.";
        gridPlacements[output] = { ...gridPlacements[output], error: reason };
        refresh();
      }
      return false;
    }
    if (action === "warp-grid-layout-confirm") return confirmGridLayoutPreview(value?.output || activeWarpOutput());
    if (action === "warp-grid-layout-cancel") {
      const output = value?.output || activeWarpOutput();
      gridPreviewSequence += 1;
      gridPreviews[output] = null;
      gridPlacements[output] = null;
      refresh();
      return true;
    }
    return withWarpMutation(() => {
      const output = value?.coordinateTarget?.output || value?.output || activeWarpOutput();
      const editor = warpEditors[output];
      if (!editor) return;
      if (action === "warp-set-position" && value?.coordinateTarget && warpCoordinateTargetKey(output, editor.getState().selection.mode, editor.getState().selection) !== JSON.stringify(value.coordinateTarget)) return false;
      let accepted = false;
      if (action === "warp-select") accepted = editor.select(value.selection);
      if (action === "warp-mode") accepted = editor.setMode(value.mode);
      if (action === "warp-step") accepted = editor.setStep(value.mode);
      if (action === "warp-nudge") accepted = editor.nudge(value.direction, value);
      if (action === "warp-nudge-start") accepted = editor.beginNudgeGesture();
      if (action === "warp-nudge-end") accepted = editor.endNudgeGesture();
      if (action === "warp-nudge-cancel") accepted = editor.cancelNudgeGesture();
      if (action === "warp-set-position") accepted = editor.setPosition(value.axis, value.pixels);
      if (action === "warp-reset-selection") accepted = editor.resetSelection();
      if (action === "warp-reset-residuals") accepted = editor.resetResiduals();
      if (action === "warp-undo") accepted = editor.undo();
      if (action === "warp-redo") accepted = editor.redo();
      if (action === "warp-enabled") accepted = editor.setEnabled(value.enabled);
      if (action === "warp-grid-layout") accepted = editor.editGridLayout(value.operation, value);
      refresh();
      return accepted;
    });
  }
  function handleWarpPointer(action, value) {
    if (disposed || !editorBaselineReady) return;
    return withWarpMutation(() => {
      const output = value?.output || activeWarpOutput();
      const editor = warpEditors[output];
      if (!editor) return;
      let accepted = false;
      if (action === "start") accepted = editor.pointerStart(value);
      if (action === "move") accepted = editor.pointerMove(value);
      if (action === "end") { editor.pointerMove(value); accepted = editor.pointerEnd(); }
      if (action === "cancel") accepted = editor.pointerCancel();
      if (action !== "start") refresh();
      return accepted;
    });
  }
  function readPath(config, path) { return path.split(".").reduce((target, key) => target?.[key], config); }
  async function handleImport(file) {
    if (!file) return;
    try {
      const rotateDeg = state.snapshot?.config?.namesWall?.rotateDeg;
      const imported = typeof onImport === "function" ? await onImport(file) : await file.text();
      const parsed = typeof imported === "string" ? parseProjectionImport(imported, rotateDeg) : imported?.config ? imported : parseProjectionImport(String(imported), rotateDeg);
      const warnings = [...(parsed?.warnings || [])];
      let config = parsed?.config;
      if (config && config.schemaVersion < 7) {
        config = migrateProjectionConfigToV7(config, rotateDeg, warnings);
      } else config = normalizeConfig(config);
      const importErrors = validateProjectionConfig(config);
      if (Object.keys(importErrors).length) throw new Error(`invalid imported projection config: ${Object.entries(importErrors).map(([path, message]) => `${path} ${message}`).join("; ")}`);
      client.setLive(false); setClientDraft(config); parameterHistory.clear(); nudgeAnchors.clear(); scalarGestures.clear(); view.setPresetName(parsed.name || ""); fieldErrors = {}; conflict = [...new Set(warnings)].join(" "); refresh();
    } catch (error) { fieldErrors = { import: error.message }; refresh(); }
  }
  async function handleAction(action, value) {
    if (disposed) return;
    if (action === 'parameter-undo' || action === 'parameter-redo') return restoreParameter(action === 'parameter-undo' ? 'undo' : 'redo');
    if (["apply", "save", "save-new", "preset-select"].includes(action) && !finishPendingEdit()) return false;
    if (["load", "revert", "import"].includes(action) && !discardPendingEdit()) return false;
    let actionToken = null;
    const runPending = async (kind, operation) => {
      const promise = operation();
      actionToken = ++actionSequence;
      if (fieldErrors.action) { fieldErrors = { ...fieldErrors }; delete fieldErrors.action; }
      pendingAction = { kind, token: actionToken };
      refresh();
      try { return await promise; }
      finally {
        if (pendingAction?.token === actionToken) { pendingAction = null; refresh(); }
      }
    };
    const rebaseWarpHistory = () => {
      const accepted = normalizeState(client.getState?.() || state);
      if (!accepted.draft) return;
      view.cancelWarpPointer({ notify: false });
      view.retireWarpGestures?.();
      for (const output of ["left", "right"]) warpEditors[output].setConfig(accepted.draft, { rebase: true });
      parameterHistory.clear(); nudgeAnchors.clear(); scalarGestures.clear();
    };
    if (action === "reconciliation-retry") { await client.retryReconciliation?.(); refresh(); return; }
    if (action === "reconciliation-keep-local") { client.resolveReconciliation?.("keep-local"); refresh(); return; }
    if (action === "reconciliation-use-accepted") { client.resolveReconciliation?.("use-accepted"); rebaseWarpHistory(); refresh(); return; }
    try {
      if (action === "live") await client.setLive(Boolean(value));
      if (action === "retry-hydration") await client.retryHydration();
      if (action === "apply") await runPending("apply", () => client.apply());
      if (action === "save-new") { if (!String(value || "").trim()) { fieldErrors = { name: "Enter a preset name" }; refresh(); return; } const result = await runPending("save", () => client.save({ presetId: null, name: String(value).trim() })); if (actionToken === actionSequence && result?.savedPresetId) selectedPresetId = loadedPresetId = result.savedPresetId; }
      if (action === "save") { const selected = state.snapshot?.presets?.find((preset) => preset.id === loadedPresetId); if (!selected || selected.readOnly || !String(value || "").trim()) { fieldErrors = { name: selected?.readOnly ? `${selected.name || "Selected preset"} is immutable` : "Enter a preset name" }; refresh(); return; } const result = await runPending("save", () => client.save({ presetId: loadedPresetId, name: String(value).trim() })); if (actionToken === actionSequence && result?.savedPresetId) selectedPresetId = loadedPresetId = result.savedPresetId; }
      if (action === "load") { const requested = value; const result = await runPending("load", () => client.load(requested)); if (result?.draftReplaced) { selectedPresetId = loadedPresetId = requested; loadedPresetLoadToken += 1; rebaseWarpHistory(); } }
      if (action === "preset-select") { selectedPresetId = value; }
      if (action === "revert") { const result = await runPending("revert", () => client.revert()); if (result?.draftReplaced) rebaseWarpHistory(); }
      if (action === "export") { const selected = state.snapshot?.presets?.find((preset) => preset.id === loadedPresetId); const content = serializeProjectionExport(selected?.name || "Calibration", state.draft); onExport?.(content, selected?.name || "Calibration"); }
      if (action === "import") await handleImport(value);
      if (action === "share") { const result = await share?.(); const href = typeof result === "string" ? result : result?.href; view.controls.shareLink.href = href || ""; view.controls.shareLink.textContent = href || ""; view.controls.shareLink.hidden = !href; view.controls.shareQr.hidden = !href || !result?.qrRendered; if (!href) view.controls.shareQr.replaceChildren(); view.controls.shareStatus.textContent = href ? (result?.copied ? "Copied link" : "Select the link to copy") : "Share unavailable on this network."; }
      if (action === "pattern") setPattern(value);
    } catch (error) { if (actionToken !== null && actionToken !== actionSequence) return; if (action === "share") { view.controls.shareLink.href = ""; view.controls.shareLink.textContent = ""; view.controls.shareLink.hidden = true; view.controls.shareQr.hidden = true; view.controls.shareQr.replaceChildren(); view.controls.shareStatus.textContent = "Share unavailable on this network."; } else if (error?.fields) fieldErrors = error.fields; else if (error?.message?.includes("conflict")) conflict = error.message; else fieldErrors = { action: error?.message || String(error) }; refresh(); }
    refresh();
  }
  function sendPattern() {
    if (!socket?.send || activePattern.pattern === "off") return;
    socket.send({ type: "otef_projection_pattern", table: "otef", output: activePattern.branch, pattern: activePattern.pattern, sourceId });
  }
  function setPattern(next = {}) {
    if (patternTimer !== null) { clearInterval(patternTimer); patternTimer = null; }
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
        !["wall", "model"].includes(wall.mode) ||
        !/^[a-f0-9]{64}$/i.test(wall.digest) || !Number.isSafeInteger(wall.expected) ||
        wall.expected < 1 || wall.placed !== wall.expected) return;
    }
    recordProjectionTrace(trace, 'receipt', { receiptType: 'output_applied', output: message.output, revision: message.revision, accepted: message.success, live: Boolean(state.live) });
    namesTracker.observeInstance(message.output, message.instanceId);
    showUnconfirmed = false;
    statusRows.delete(`${message.output}:pending`);
    for (const key of statusRows.keys()) if (key.startsWith(`${message.output}:`) && key !== `${message.output}:${message.instanceId}`) statusRows.delete(key);
    statusRows.set(`${message.output}:${message.instanceId}`, message); refresh();
  }
  function requestStatus() { socket?.send?.({ type: "otef_projection_status_request", table: "otef", sourceId }); }
  const namesStatusMessage = (message) => { if (namesTracker.accept(message)) { if (!namesTracker.getState().pending) namesRunPending = false; refresh(); } };
  const onDatasetEvent = () => { void updateNamesTarget(true).then((ready) => { if (ready && !disposed) requestStatus(); }); };
  const unsubscribe = client.subscribe(handleState);
  const unsubscribeLayout = layoutClient?.subscribe?.(refresh);
  const unsubscribeSettlement = settlementClient?.subscribe?.(() => { syncLayoutUnload(); refresh(); });
  const unsubscribeOutput = outputController?.subscribe?.((nextState) => { outputState = nextState; refresh(); });
  if (view.canManageDisplays) outputController?.refreshDisplays?.().catch(() => {});
  socket?.on?.("otef_projection_applied", statusMessage);
  socket?.on?.("otef_projection_names_status", namesStatusMessage);
  const onConnect = () => { namesTracker.setConnected(true); reconnectStatusRevision = expectedRevision; expectRevision(state, true); void updateNamesTarget(true).then((ready) => { if (ready && !disposed) requestStatus(); }); if (activePattern.pattern !== "off") setPattern(activePattern); refresh(); };
  socket?.on?.("connect", onConnect);
  const onDisconnect = () => { namesRunPending = false; namesTracker.setConnected(false); reconnectStatusRevision = null; socket?.send?.({ type: "otef_projection_pattern", table: "otef", output: activePattern.branch, pattern: "off", sourceId }); statusRows = new Map(); if (patternTimer !== null) { clearInterval(patternTimer); patternTimer = null; } refresh(); };
  socket?.on?.("disconnect", onDisconnect);
  socket?.on?.('otef_person_selection_changed', onDatasetEvent);
  socket?.on?.('otef_narrative_scene_changed', onDatasetEvent);
  if (socket?.getConnected?.() || socket?.isConnected === true) void updateNamesTarget(true).then((ready) => { if (ready && !disposed) requestStatus(); });
  else void updateNamesTarget(true);
  void client.start?.();
  refresh();
  return {
    sourceId,
    handleAction,
    getStatusRows: () => [...statusRows.values()].map((row) => ({ ...row })),
    setConflict,
    dispose() { if (disposed) return; disposed = true; editorBaselineSequence += 1; editorBaselineAbort?.abort(); editorBaselineAbort = null; syncLayoutUnload(); closeSettlementEditor(); closeClockEditor(); closeNovaExplainerEditor(); for (const action of clockCueActions) action.cancel(); clockCueActions.clear(); namesTargetRequest += 1; for (const editor of clockEditors) editor.dispose(); clockEditors.clear(); activeClockEditor = null; activeClockEditorNode = null; activeSettlementEditor = null; if (confirmationTimer !== null) clearTimeout(confirmationTimer); if (patternTimer !== null) clearInterval(patternTimer); socket?.send?.({ type: "otef_projection_pattern", table: "otef", output: activePattern.branch, pattern: "off", sourceId }); socket?.off?.("otef_projection_applied", statusMessage); socket?.off?.("otef_projection_names_status", namesStatusMessage); socket?.off?.("connect", onConnect); socket?.off?.("disconnect", onDisconnect); socket?.off?.('otef_person_selection_changed', onDatasetEvent); socket?.off?.('otef_narrative_scene_changed', onDatasetEvent); unsubscribe?.(); unsubscribeLayout?.(); unsubscribeSettlement?.(); unsubscribeOutput?.(); outputController?.dispose?.(); validator.dispose?.(); view.dispose(); client.stop?.(); },
  };
}

export { FIELD_DESCRIPTORS, NAMES_WALL_DESCRIPTORS, statusText };
