import {
  parseProjectionImport,
  serializeProjectionExport,
  validateProjectionConfig,
} from "../shared/projection-config-schema.js";
import { equalProjectionConfig } from "../shared/projection-config-client.js";
import { createUuid } from "../shared/uuid.js";
import { createProjectionConfigView } from "./config-view.js";

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

function clone(value) { return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function setPath(value, path, next) {
  const result = clone(value); const parts = path.split("."); let target = result;
  for (const key of parts.slice(0, -1)) target = target[key];
  target[parts.at(-1)] = next; return result;
}
function descriptorFor(path) { return FIELD_DESCRIPTORS.find((descriptor) => descriptor.path === path); }

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

export function mountProjectionConfig(root, { client, share, onExport, onImport, socket } = {}) {
  if (!client) throw new Error("projection config client is required");
  const sourceId = createUuid();
  let selectedNode = "pre";
  let selectedPresetId = null;
  let fieldErrors = {};
  let conflict = "";
  let disposed = false;
  let state = client.getState?.() || {};
  let statusRows = new Map();
  let expectedRevision = Number.isSafeInteger(state.snapshot?.revision) ? state.snapshot.revision : null;
  let reconnectStatusRevision = null;
  let confirmationTimer = null;
  let loadedPresetId = state.snapshot?.selectedPresetId || "original";
  let showUnconfirmed = false;
  let activePattern = { pattern: "off", branch: "left" };
  let patternTimer = null;
  const view = createProjectionConfigView(root, { descriptors: FIELD_DESCRIPTORS, onField: handleField, onNudge: handleNudge, onNode: (node) => { selectedNode = node; refresh(); }, onAction: handleAction });

  function rowText(row) {
    const identity = row.instanceId ? ` · ${row.instanceId}` : "";
    const label = row.output[0].toUpperCase() + row.output.slice(1);
    if (row.revision !== expectedRevision) return `${label} · Not confirmed${identity}`;
    return row.success ? `${label} applied${identity}` : `${label} · ${row.error || "Not confirmed"}${identity}`;
  }
  function refresh() {
    if (disposed) return;
    const rows = [...statusRows.values()].map((row) => ({ ...row, text: rowText(row) }));
    view.update({ state: { ...state, selectedPresetId }, errors: fieldErrors, conflict, statusText: statusText(state, loadedPresetId), selectedNode, statusRows: rows });
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
    const previousRevision = state.snapshot?.revision;
    const previousSelected = state.snapshot?.selectedPresetId;
    const revision = nextState.snapshot?.revision;
    const firstHydration = expectedRevision === null && Number.isSafeInteger(revision);
    state = nextState;
    if (!selectedPresetId) selectedPresetId = state.snapshot?.selectedPresetId || "original";
    if (!loadedPresetId || (Number.isSafeInteger(revision) && revision !== previousRevision && state.snapshot?.selectedPresetId && state.snapshot.selectedPresetId !== previousSelected)) loadedPresetId = state.snapshot.selectedPresetId;
    expectRevision(state);
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
  function handleField(path, raw) {
    const descriptor = descriptorFor(path); if (!descriptor) return;
    if (!state.draft) { fieldErrors = { [path]: "Waiting for calibration settings" }; refresh(); return; }
    const value = fieldValueFromInput(descriptor, raw);
    const candidate = setPath(state.draft, path, value);
    if (!Number.isFinite(value)) { fieldErrors = { [path]: "must be a finite number" }; refresh(); return; }
    if (value < descriptor.min || value > descriptor.max) { fieldErrors = { [path]: `must be between ${descriptor.min} and ${descriptor.max}` }; refresh(); return; }
    if (!validCandidate(candidate, path)) return;
    try { client.setDraft(candidate); } catch (error) { fieldErrors = { [path]: error.message }; refresh(); }
  }
  function handleNudge(path, direction) {
    const descriptor = descriptorFor(path); const value = readPath(state.draft, path) + direction * fineStepFor(descriptor);
    handleField(path, String(fieldInputValue(descriptor, value)));
  }
  function readPath(config, path) { return path.split(".").reduce((target, key) => target?.[key], config); }
  async function handleImport(file) {
    if (!file) return;
    try {
      const imported = typeof onImport === "function" ? await onImport(file) : await file.text();
      const parsed = typeof imported === "string" ? parseProjectionImport(imported) : imported?.config ? imported : parseProjectionImport(String(imported));
      const importErrors = validateProjectionConfig(parsed?.config);
      if (Object.keys(importErrors).length) throw new Error(`invalid imported projection config: ${Object.entries(importErrors).map(([path, message]) => `${path} ${message}`).join("; ")}`);
      client.setLive(false); client.setDraft(parsed.config); view.controls.saveName.value = parsed.name || ""; fieldErrors = {}; conflict = ""; refresh();
    } catch (error) { fieldErrors = { import: error.message }; refresh(); }
  }
  async function handleAction(action, value) {
    if (disposed) return;
    try {
      if (action === "live") await client.setLive(Boolean(value));
      if (action === "retry-hydration") await client.retryHydration();
      if (action === "apply") await client.apply();
      if (action === "save-new") { if (!String(value || "").trim()) { fieldErrors = { name: "Enter a preset name" }; refresh(); return; } await client.save({ presetId: null, name: String(value).trim() }); selectedPresetId = loadedPresetId = client.getState?.().snapshot?.selectedPresetId || selectedPresetId; }
      if (action === "save") { const selected = state.snapshot?.presets?.find((preset) => preset.id === loadedPresetId); if (!selected || selected.readOnly || !String(value || "").trim()) { fieldErrors = { name: selected?.readOnly ? "Original calibration is immutable" : "Enter a preset name" }; refresh(); return; } await client.save({ presetId: loadedPresetId, name: String(value).trim() }); selectedPresetId = loadedPresetId = client.getState?.().snapshot?.selectedPresetId || loadedPresetId; }
      if (action === "load") { const requested = value; await client.load(requested); selectedPresetId = loadedPresetId = requested; }
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
    showUnconfirmed = false;
    statusRows.delete(`${message.output}:pending`);
    statusRows.set(`${message.output}:${message.instanceId}`, message); refresh();
  }
  function requestStatus() { socket?.send?.({ type: "otef_projection_status_request", table: "otef", sourceId }); }
  const unsubscribe = client.subscribe(handleState);
  socket?.on?.("otef_projection_applied", statusMessage);
  const onConnect = () => { reconnectStatusRevision = expectedRevision; expectRevision(state, true); requestStatus(); if (activePattern.pattern !== "off") setPattern(activePattern); refresh(); };
  socket?.on?.("connect", onConnect);
  const onDisconnect = () => { reconnectStatusRevision = null; socket?.send?.({ type: "otef_projection_pattern", table: "otef", output: activePattern.branch, pattern: "off", sourceId }); statusRows = new Map(); if (patternTimer !== null) { clearInterval(patternTimer); patternTimer = null; } refresh(); };
  socket?.on?.("disconnect", onDisconnect);
  if (socket?.getConnected?.() || socket?.isConnected === true) requestStatus();
  void client.start?.();
  refresh();
  return {
    sourceId,
    getStatusRows: () => [...statusRows.values()].map((row) => ({ ...row })),
    setConflict,
    dispose() { disposed = true; if (confirmationTimer !== null) clearTimeout(confirmationTimer); if (patternTimer !== null) clearInterval(patternTimer); socket?.send?.({ type: "otef_projection_pattern", table: "otef", output: activePattern.branch, pattern: "off", sourceId }); socket?.off?.("otef_projection_applied", statusMessage); socket?.off?.("connect", onConnect); socket?.off?.("disconnect", onDisconnect); unsubscribe?.(); view.dispose(); client.stop?.(); },
  };
}

export { FIELD_DESCRIPTORS, statusText };
