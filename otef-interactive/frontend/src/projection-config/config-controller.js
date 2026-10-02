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
import { migrateNamesWallToV5, migrateNamesWallToV6 } from "../shared/nli-name-wall-config.js";
import { openClockLayoutEditor } from "./clock-layout-editor-dialog.js";
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
  if (field === "strokeWidthPx") return `namesWall.profiles.${config.namesWall.activeMode}.strokeWidthPx`;
  if (field.startsWith("innerEdgeInsetPx.")) return path;
  if (field === "inwardShiftPercent") return "namesWall.profiles.wall.inwardShiftPercent";
  return `namesWall.profiles.${config.namesWall.activeMode}.${field}`;
}
function readField(config, path) { return path.split(".").reduce((target, key) => target?.[key], namesWallProfileScoped(path) ? { namesWall: config?.namesWall?.profiles?.[path === "namesWall.inwardShiftPercent" ? "wall" : config?.namesWall?.activeMode] } : config); }
function normalizeConfig(config) {
  if (!config) return config;
  if ([1, 2, 3, 4].includes(config.schemaVersion)) return migrateNamesWallToV5(config);
  if (config.schemaVersion === 6) return migrateNamesWallToV6(config, config.namesWall?.rotateDeg ?? 35);
  return config;
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

export function mountProjectionConfig(root, { client, share, onExport, onImport, socket, outputController, candidateValidator, readNamesDataset = null, layoutClient, settlementClient = null, catalog = { entries: [] }, clockEditorFactory = openClockLayoutEditor, settlementEditorFactory = openSettlementNameEditor } = {}) {
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
  let settlementOutput = "left";
  let settlementCitycode = catalog.entries?.find((entry) => entry?.citycode)?.citycode || "";
  let activeSettlementEditor = null;
  let localDraftNotification = false;
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
    left: createWarpEditor({ config: state.draft || DEFAULT_PROJECTION_CONFIG, output: "left", onChange: (candidate, meta) => handleWarpChange("left", candidate, meta) }),
    right: createWarpEditor({ config: state.draft || DEFAULT_PROJECTION_CONFIG, output: "right", onChange: (candidate, meta) => handleWarpChange("right", candidate, meta) }),
  };
  const view = createProjectionConfigView(root, {
    descriptors: ALL_FIELD_DESCRIPTORS,
    onField: handleField,
    onNudge: handleNudge,
    onNamesMode: handleNamesMode,
    onNode: (node) => { view.cancelWarpPointer(); selectedNode = node; if (node === "clock-gis" || node === "clock-projection") syncClockEditor(node); else closeClockEditor(); if (node === "settlement-names") syncSettlementEditor(); else closeSettlementEditor(); if (node.endsWith("-keystone") || node.endsWith("-grid")) warpEditors[node.startsWith("right-") ? "right" : "left"].setMode(node.endsWith("-grid") ? "grid" : "keystone"); refresh(); },
    onOpenClockEditor: openClockEditor,
    onOpenSettlementEditor: openSettlementEditor,
    onSettlementOutput: (output) => { settlementOutput = output === "right" ? "right" : "left"; activeSettlementEditor?.setSelection({ output: settlementOutput, citycode: settlementCitycode }); refresh(); },
    onSettlementCitycode: (citycode) => { settlementCitycode = citycode; activeSettlementEditor?.setSelection({ output: settlementOutput, citycode }); refresh(); },
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
    onClockScene: (sceneId) => { clockSceneId = sceneId; activeClockEditor?.setSelection({ nodeId: "clock-gis", sceneId: clockSceneId, element: clockElement }); refresh(); },
    onClockElement: (nextElement) => { clockElement = nextElement; activeClockEditor?.setSelection({ nodeId: "clock-projection", sceneId: clockSceneId, element: clockElement }); refresh(); },
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
    const status = row.revision !== expectedRevision ? "Not confirmed" : row.success ? "Applied" : row.error || "Not confirmed";
    return `${label} · revision ${row.revision} · ${status}${identity}`;
  }
  function refresh() {
    if (disposed) return;
    syncLayoutUnload();
    const rows = [...statusRows.values()].map((row) => ({ ...row, text: rowText(row) }));
    const warpStates = Object.fromEntries(["left", "right"].map((output) => [output, { ...warpEditors[output].getState(), config: warpEditors[output].getConfig(), handles: warpEditors[output].getControlPoints() }]));
    view.update({ state: { ...state, selectedPresetId }, errors: fieldErrors,
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
      clockLayouts: layoutClient ? Object.fromEntries(["clock-gis", "clock-projection"].map((node) => [node, layoutFor(layoutClient, resourceFor(node, clockSceneId, clockElement))])) : {},
      clockHydration: layoutClient?.getHydrationState?.() || { status: layoutClient ? "Saved" : "Loading" },
      settlement: settlementViewState() });
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
  function openSettlementEditor() {
    if (!settlementClient) return;
    view.cancelWarpPointer();
    view.closeWarpEditor();
    closeClockEditor();
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
      const rotateDeg = state.snapshot?.config?.namesWall?.rotateDeg;
      const imported = typeof onImport === "function" ? await onImport(file) : await file.text();
      const parsed = typeof imported === "string" ? parseProjectionImport(imported, rotateDeg) : imported?.config ? imported : parseProjectionImport(String(imported), rotateDeg);
      const warnings = [...(parsed?.warnings || [])];
      let config = parsed?.config;
      if (config && config.schemaVersion < 6) {
        if ([1, 2, 3, 4].includes(config.schemaVersion)) migrateNamesWallToV5(config, warnings);
        config = migrateNamesWallToV6(config, rotateDeg);
      } else config = normalizeConfig(config);
      const importErrors = validateProjectionConfig(config);
      if (Object.keys(importErrors).length) throw new Error(`invalid imported projection config: ${Object.entries(importErrors).map(([path, message]) => `${path} ${message}`).join("; ")}`);
      client.setLive(false); setClientDraft(config); view.setPresetName(parsed.name || ""); fieldErrors = {}; conflict = [...new Set(warnings)].join(" "); refresh();
    } catch (error) { fieldErrors = { import: error.message }; refresh(); }
  }
  async function handleAction(action, value) {
    if (disposed) return;
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
      for (const output of ["left", "right"]) warpEditors[output].setConfig(accepted.draft, { rebase: true });
    };
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
    getStatusRows: () => [...statusRows.values()].map((row) => ({ ...row })),
    setConflict,
    dispose() { if (disposed) return; disposed = true; syncLayoutUnload(); closeSettlementEditor(); closeClockEditor(); for (const action of clockCueActions) action.cancel(); clockCueActions.clear(); namesTargetRequest += 1; for (const editor of clockEditors) editor.dispose(); clockEditors.clear(); activeClockEditor = null; activeClockEditorNode = null; activeSettlementEditor = null; if (confirmationTimer !== null) clearTimeout(confirmationTimer); if (patternTimer !== null) clearInterval(patternTimer); socket?.send?.({ type: "otef_projection_pattern", table: "otef", output: activePattern.branch, pattern: "off", sourceId }); socket?.off?.("otef_projection_applied", statusMessage); socket?.off?.("otef_projection_names_status", namesStatusMessage); socket?.off?.("connect", onConnect); socket?.off?.("disconnect", onDisconnect); socket?.off?.('otef_person_selection_changed', onDatasetEvent); socket?.off?.('otef_narrative_scene_changed', onDatasetEvent); unsubscribe?.(); unsubscribeLayout?.(); unsubscribeSettlement?.(); unsubscribeOutput?.(); outputController?.dispose?.(); validator.dispose?.(); view.dispose(); client.stop?.(); },
  };
}

export { FIELD_DESCRIPTORS, NAMES_WALL_DESCRIPTORS, statusText };
