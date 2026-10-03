import { renderField } from "./config-field-control.js";

const WIDTH = 1920;
const HEIGHT = 1080;
const make = (doc, tag, className, text) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
};

export function warpCoordinateTarget(output, mode, selection = {}) {
  return { output, mode: selection.mode || mode, kind: selection.kind, index: selection.index, indices: selection.indices || [] };
}
export const warpCoordinateTargetKey = (output, mode, selection) => JSON.stringify(warpCoordinateTarget(output, mode, selection));

/** Builds the shared selection, position, step, adjustment, and history controls. */
export function createWarpPanelView({ document: doc, onAction = () => {}, onPointer = () => {}, onNudgeFocus = () => {} }) {
  if (!doc?.createElement) throw new Error("warp panel requires a document");
  const element = make(doc, "section", "warp-precision-panel");
  element.setAttribute("aria-label", "Warp adjustment");
  const selectionRow = make(doc, "div", "warp-selection-row");
  const positionRow = make(doc, "div", "warp-position-row");
  const stepRow = make(doc, "div", "warp-step-row");
  const adjustmentRow = make(doc, "div", "warp-adjustment-row");
  const historyRow = make(doc, "div", "warp-history-row");
  const gridPreviewRow = make(doc, "div", "warp-grid-layout-preview");
  gridPreviewRow.hidden = true;
  const gridPreviewStatus = make(doc, "p", "warp-grid-layout-preview-status"); gridPreviewStatus.setAttribute("role", "status"); gridPreviewStatus.setAttribute("aria-live", "polite");
  const gridPreviewConfirm = make(doc, "button", "warp-action", "Confirm grid change"); gridPreviewConfirm.type = "button"; gridPreviewConfirm.dataset.action = "warp-grid-layout-confirm";
  const gridPreviewCancel = make(doc, "button", "warp-action", "Cancel preview"); gridPreviewCancel.type = "button"; gridPreviewCancel.dataset.action = "warp-grid-layout-cancel";
  gridPreviewConfirm.addEventListener("click", () => onAction("warp-grid-layout-confirm", { output: element.dataset.output }));
  gridPreviewCancel.addEventListener("click", () => onAction("warp-grid-layout-cancel", { output: element.dataset.output }));
  gridPreviewRow.append(gridPreviewStatus, gridPreviewConfirm, gridPreviewCancel);
  const selectionStatus = make(doc, "p", "warp-selection-status"); selectionStatus.setAttribute("role", "status");
  const selectionControls = make(doc, "div", "warp-selection-controls"); selectionControls.setAttribute("role", "group"); selectionControls.setAttribute("aria-label", "Warp selection");
  const selectionButtons = [];
  for (const kind of ["corner", "point", "row", "column", "edge", "all"]) {
    const item = make(doc, "button", "warp-selection-button", kind[0].toUpperCase() + kind.slice(1)); item.type = "button"; item.dataset.warpSelectionKind = kind;
    selectionControls.appendChild(item); selectionButtons.push(item);
  }
  const selectionPicker = doc.createElement("select"); selectionPicker.className = "warp-selection-picker"; selectionPicker.setAttribute("aria-label", "Warp selection target");
  const position = make(doc, "div", "warp-numeric");
  const coordinateFields = new Map();
  for (const axis of ["x", "y"]) {
    const control = renderField(doc, { path: `warp.position.${axis}`, label: `Selected warp ${axis.toUpperCase()} position`, unit: "px", min: -Infinity, max: Infinity, range: false, nudges: false, decimals: 2, captureOnFocus: true },
      (_path, raw, _inputKind, meta) => {
        let coordinateTarget;
        try { coordinateTarget = JSON.parse(meta?.resolvedPath || "{}"); } catch {}
        return onAction("warp-set-position", { axis, pixels: Number(raw), output: coordinateTarget?.output, coordinateTarget });
      }, null, false, false,
      (_path, _value, meta) => onAction("warp-field-cancel", { axis, ...meta }));
    coordinateFields.set(axis, control); position.appendChild(control.wrap);
  }
  const warpStep = doc.createElement("select"); warpStep.className = "warp-step"; warpStep.setAttribute("aria-label", "Warp nudge step");
  for (const [value, text] of [["fine", "Fine · 0.25 px"], ["coarse", "Coarse · 1 px"]]) { const option = doc.createElement("option"); option.value = value; option.textContent = text; warpStep.appendChild(option); }
  warpStep.addEventListener("change", () => onAction("warp-step", { mode: warpStep.value }));
  const stepLabel = make(doc, "label", "warp-step-label", "Step"); stepLabel.htmlFor = "warp-nudge-step"; warpStep.id = "warp-nudge-step";
  const nudgePad = make(doc, "div", "warp-arrows"); nudgePad.setAttribute("role", "group"); nudgePad.setAttribute("aria-label", "Warp nudge controls");
  let hold = null; let suppressClick = false;
  const stopHold = (cancel) => {
    if (!hold) return;
    const active = hold; hold = null; clearTimeout(active.delay); clearInterval(active.repeat);
    onAction(cancel ? "warp-nudge-cancel" : "warp-nudge-end", { output: active.output });
    if (active.repeated) suppressClick = true;
  };
  for (const [label, direction] of [["↑", "up"], ["↓", "down"], ["←", "left"], ["→", "right"]]) {
    const item = make(doc, "button", "warp-action", label); item.type = "button"; item.dataset.action = "warp-nudge"; item.dataset.direction = direction;
    item.addEventListener("click", (event) => { if (suppressClick && event.detail > 0) { suppressClick = false; return; } onAction("warp-nudge", { direction }); onNudgeFocus(); });
    item.addEventListener("pointerdown", (event) => {
      suppressClick = false; if (event.button !== undefined && event.button !== 0) return;
      const output = element.dataset.output || "left";
      if (!onAction("warp-nudge-start", { output })) return;
      event.preventDefault?.(); item.setPointerCapture?.(event.pointerId);
      const active = { output, pointer: event.pointerId, repeated: false, delay: null, repeat: null }; hold = active;
      const tick = () => { if (!onAction("warp-nudge", { direction, output, fine: warpStep.value === "fine", coarse: warpStep.value === "coarse" })) { stopHold(true); return false; } active.repeated = true; return true; };
      active.delay = setTimeout(() => { if (hold === active && tick()) active.repeat = setInterval(tick, 100); }, 350);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) item.addEventListener(type, (event) => { if (hold && (event.pointerId === undefined || event.pointerId === hold.pointer)) stopHold(type !== "pointerup"); });
    item.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault?.(); stopHold(true); } });
    nudgePad.appendChild(item);
  }
  const relativePad = make(doc, "div", "warp-relative-pad"); relativePad.setAttribute("role", "application"); relativePad.setAttribute("aria-label", "Relative warp adjustment pad"); relativePad.tabIndex = 0;
  const padLabel = make(doc, "span", "warp-relative-pad-label", "Drag to adjust"); relativePad.appendChild(padLabel);
  let padGesture = null;
  const cancelPad = (event = null) => {
    if (!padGesture || event?.pointerId !== undefined && padGesture.pointer !== event.pointerId) return false;
    const gesture = padGesture; padGesture = null;
    try { relativePad.releasePointerCapture?.(gesture.pointer); } catch {}
    onPointer("cancel", { x: 0, y: 0, output: gesture.output });
    return true;
  };
  const padPoint = (event) => {
    const sensitivity = warpStep.value === "coarse" ? 1 : 0.25;
    return { x: (event.clientX - padGesture.startX) / Math.max(1, padGesture.rect.width) * WIDTH * sensitivity, y: (event.clientY - padGesture.startY) / Math.max(1, padGesture.rect.height) * HEIGHT * sensitivity, output: padGesture.output };
  };
  relativePad.addEventListener("pointerdown", (event) => {
    if (padGesture || event.button !== undefined && event.button !== 0) return;
    const rect = relativePad.getBoundingClientRect?.() || { left: event.clientX - 100, top: event.clientY - 100, width: 200, height: 200 };
    const output = element.dataset.output || "left";
    padGesture = { pointer: event.pointerId, output, startX: event.clientX, startY: event.clientY, rect };
    relativePad.setPointerCapture?.(event.pointerId); event.preventDefault?.();
    if (onPointer("start", { x: 0, y: 0, output }) === false) {
      padGesture = null;
      try { relativePad.releasePointerCapture?.(event.pointerId); } catch {}
    }
  });
  relativePad.addEventListener("pointermove", (event) => { if (padGesture?.pointer === event.pointerId) onPointer("move", padPoint(event)); });
  const endPad = (event, cancel) => {
    if (!padGesture || padGesture.pointer !== event.pointerId) return;
    const final = padPoint(event); padGesture = null;
    onPointer(cancel ? "cancel" : "end", final);
  };
  relativePad.addEventListener("pointerup", (event) => endPad(event, false));
  relativePad.addEventListener("pointercancel", (event) => endPad(event, true));
  relativePad.addEventListener("lostpointercapture", (event) => cancelPad(event));
  relativePad.addEventListener("keydown", (event) => { if (event.key === "Escape" && cancelPad()) { event.preventDefault?.(); event.stopPropagation?.(); event.stopImmediatePropagation?.(); } });
  const cancelPadOnEscape = (event) => {
    if (event.key !== "Escape" || !hold && !padGesture) return;
    event.preventDefault?.(); event.stopImmediatePropagation?.();
    if (hold) stopHold(true);
    cancelPad();
  };
  const onBlur = () => { stopHold(true); cancelPad(); };
  const onVisibility = () => { if (doc.visibilityState === "hidden") { stopHold(true); cancelPad(); } };
  doc.addEventListener?.("keydown", cancelPadOnEscape, true);
  doc.addEventListener?.("visibilitychange", onVisibility);
  doc.defaultView?.addEventListener?.("blur", onBlur);
  const history = make(doc, "div", "warp-history-controls", ""); history.setAttribute("aria-label", "Warp history");
  const warpUndo = make(doc, "button", "warp-action", "Undo"); warpUndo.type = "button"; warpUndo.dataset.action = "warp-undo"; warpUndo.dataset.warpAction = "warp-undo"; warpUndo.addEventListener("click", () => onAction("warp-undo", { output: element.dataset.output }));
  warpUndo.setAttribute("aria-label", "Warp Undo");
  const warpRedo = make(doc, "button", "warp-action", "Redo"); warpRedo.type = "button"; warpRedo.dataset.action = "warp-redo"; warpRedo.dataset.warpAction = "warp-redo"; warpRedo.addEventListener("click", () => onAction("warp-redo", { output: element.dataset.output }));
  warpRedo.setAttribute("aria-label", "Warp Redo");
  const warpReset = make(doc, "button", "warp-action", "Reset selection"); warpReset.type = "button"; warpReset.dataset.action = "warp-reset-selection"; warpReset.dataset.warpAction = "warp-reset-selection"; warpReset.addEventListener("click", () => onAction("warp-reset-selection", { output: element.dataset.output }));
  const warpResetAll = make(doc, "button", "warp-action", "Reset all geometry"); warpResetAll.type = "button"; warpResetAll.dataset.action = "warp-reset-residuals"; warpResetAll.dataset.warpAction = "warp-reset-residuals"; warpResetAll.addEventListener("click", () => onAction("warp-reset-residuals", { output: element.dataset.output }));
  history.append(warpUndo, warpRedo, warpReset, warpResetAll);
  selectionRow.append(selectionStatus, selectionControls, selectionPicker);
  positionRow.appendChild(position);
  stepRow.append(stepLabel, warpStep);
  adjustmentRow.append(nudgePad, relativePad);
  element.append(selectionRow, positionRow, stepRow, adjustmentRow, gridPreviewRow, historyRow);
  historyRow.appendChild(history);
  const controls = { warpPanel: element, warpStatus: selectionStatus, warpSelectionControls: selectionControls, warpSelectionButtons: selectionButtons, warpSelectionPicker: selectionPicker, warpNumeric: position, warpCoordinateFields: coordinateFields, warpPositionX: coordinateFields.get("x").number, warpPositionY: coordinateFields.get("y").number, warpPositionLabels: [...coordinateFields.values()].map((control) => control.wrap.children[0]), warpStep, warpArrows: nudgePad, warpUndo, warpRedo, warpReset, warpResetAll, warpActions: history, relativePad, warpHistoryRow: historyRow };
  let state = null;
  let pickerTopologyKey = null;
  selectionPicker.addEventListener("change", () => {
    if (!state) return;
    const selection = state.selection || {};
    onAction("warp-select", { output: element.dataset.output, selection: { mode: selection.mode, kind: selection.kind, index: Number(selectionPicker.value) || 0 } });
  });
  selectionButtons.forEach((button) => button.addEventListener("click", () => {
    if (!state) return;
    const selection = state.selection || {};
    const mode = selection.mode || (element.dataset.nodeId?.endsWith("-grid") ? "grid" : "keystone");
    const kind = button.dataset.warpSelectionKind;
    let index = Number(selection.index) || 0;
    const warp = state.config?.outputs?.[element.dataset.output]?.warp;
    const columns = warp?.grid?.columns || 7;
    if (kind === "all") index = 0;
    else if (mode === "grid" && selection.kind === "point") index = kind === "row" ? Math.floor(index / columns) : kind === "column" ? index % columns : index;
    else if (mode === "grid" && kind === "point" && selection.indices?.length) index = selection.indices[0];
    onAction("warp-select", { output: element.dataset.output, selection: { mode, kind, index } });
  }));
  return {
    element,
    controls,
    setState({ output, nodeId, editorState } = {}) {
      element.dataset.output = output || "left";
      element.dataset.nodeId = nodeId || "";
      state = editorState || null;
    },
    update({ output, nodeId, editorState } = {}) {
      this.setState({ output, nodeId, editorState });
      if (!state) return;
      const mode = nodeId?.endsWith("-grid") ? "grid" : "keystone";
      const selection = state.selection || { mode, kind: mode === "grid" ? "point" : "corner", index: 0 };
      const warp = state.config?.outputs?.[output]?.warp;
      const rows = warp?.grid?.rows || 7, columns = warp?.grid?.columns || (output === "right" ? 8 : 7);
      const indices = selection.indices || [];
      const pointCount = rows * columns;
      const pickerCount = selection.kind === "all" ? 0 : selection.kind === "edge" ? 4 : mode === "grid" ? selection.kind === "row" ? rows : selection.kind === "column" ? columns : pointCount : 4;
      const edgeNames = ["Top edge", "Right edge", "Bottom edge", "Left edge"];
      const nextPickerTopology = JSON.stringify([output, mode, selection.kind, pickerCount, rows, columns]);
      if (pickerTopologyKey !== nextPickerTopology) {
        const options = Array.from({ length: pickerCount }, (_, index) => { const option = doc.createElement("option"); option.value = String(index); option.textContent = selection.kind === "edge" ? edgeNames[index] : mode === "grid" ? selection.kind === "row" ? `Row ${index + 1}` : selection.kind === "column" ? `Column ${index + 1}` : `Point ${index + 1} · Row ${Math.floor(index / columns) + 1}, Column ${index % columns + 1}` : `Corner ${index + 1}`; return option; });
        selectionPicker.replaceChildren(...options);
        pickerTopologyKey = nextPickerTopology;
      }
      selectionPicker.hidden = selection.kind === "all"; if (pickerCount) selectionPicker.value = String(Math.min(pickerCount - 1, selection.index || 0));
      selectionControls.hidden = false;
      selectionButtons.forEach((button) => { const kind = button.dataset.warpSelectionKind; button.hidden = mode === "grid" ? !["point", "row", "column", "edge", "all"].includes(kind) : !["corner", "edge", "all"].includes(kind); button.setAttribute("aria-pressed", String(kind === selection.kind)); });
      const points = state.handles || [];
      const selected = indices.map((index) => points[index]).filter(Boolean);
      for (const [axis, control] of coordinateFields) {
        const slot = axis === "x" ? 0 : 1; const dimension = axis === "x" ? WIDTH : HEIGHT;
        const mean = selected.length ? selected.reduce((sum, point) => sum + (slot === 0 ? point.x : point.y), 0) / selected.length : 0;
        control.update({ value: mean * dimension, resolvedPath: warpCoordinateTargetKey(output, mode, selection), error: state.validationMessage || "" });
        if (control.range) control.range.disabled = Boolean(state.adjusting);
        if (control.number) control.number.disabled = Boolean(state.adjusting);
        if (control.signButton) control.signButton.disabled = Boolean(state.adjusting);
      }
      warpStep.value = state.stepMode || "fine";
      warpUndo.disabled = !(state.historyDepth > 0) || Boolean(state.adjusting);
      warpRedo.disabled = !(state.redoDepth > 0) || Boolean(state.adjusting);
      warpReset.textContent = selection.kind === "all" ? "Reset all" : selection.kind === "edge" ? "Reset edge" : mode === "grid" ? `Reset ${selection.kind}` : "Reset corner";
      const groupName = selection.kind === "all" ? mode === "grid" ? "All grid points" : "All four corners" : selection.kind === "edge" ? edgeNames[Math.max(0, Math.min(3, Number(selection.index) || 0))] : `${selection.kind} ${Number(selection.index || 0) + 1}`;
      selectionStatus.textContent = `${groupName} · ${indices.length} points · ${state.stepMode === "coarse" ? "1 px" : "0.25 px"}${state.validationMessage ? ` · ${state.validationMessage}` : ""}`;
      const preview = state.gridLayoutPreview;
      const placement = state.gridPlacement;
      gridPreviewRow.hidden = !preview && !placement;
      gridPreviewConfirm.hidden = !preview?.requiresConfirmation;
      gridPreviewCancel.hidden = !preview && !placement;
      if (preview) {
        const grid = state.config?.outputs?.[output]?.warp?.grid;
        const axis = preview.values?.axis;
        const beforeCount = axis === "row" ? grid?.rows : grid?.columns;
        const afterCount = axis === "row" ? preview.grid?.rows : preview.grid?.columns;
        const scope = preview.operation === "remove" ? `Remove ${axis} ${Number(preview.values?.index ?? 0) + 1}: ${beforeCount} to ${afterCount} lines.`
          : preview.operation === "rebuild" || preview.operation === "counts" ? `Rebuild uniform grid: ${grid?.columns} columns by ${grid?.rows} rows.` : "Review the grid change before applying it.";
        const addPosition = preview.operation === "add" ? ` Candidate at ${Number(preview.values?.position).toFixed(2)}% source ${preview.values?.axis === "row" ? "Y" : "X"}.` : "";
        gridPreviewStatus.textContent = preview.error || (preview.status === "validating" ? "Checking grid candidate…" : preview.warning ? `${preview.warning} ${preview.requiresConfirmation && ["remove", "rebuild", "counts"].includes(preview.operation) ? scope : ""}${addPosition}` : `${scope}${addPosition}`);
        gridPreviewStatus.dataset.state = preview.error ? "error" : preview.warning ? "warning" : preview.status || "ready";
        gridPreviewConfirm.hidden = !preview.requiresConfirmation;
        gridPreviewConfirm.disabled = Boolean(state.adjusting || !preview.ok || preview.status !== "ready");
        gridPreviewCancel.disabled = Boolean(state.adjusting);
      } else if (placement) {
        gridPreviewStatus.dataset.state = placement.error ? "error" : "placement";
        const percent = Number.isFinite(Number(placement.position)) ? ` at ${Number(placement.position).toFixed(2)}% source ${placement.axis === "row" ? "Y" : "X"}` : "";
        const guidance = placement.blocked ? "Change the grid count to make room." : placement.error ? "Click again or enter a source percentage." : "Click the viewer or enter a source percentage.";
        gridPreviewStatus.textContent = `Add ${placement.axis}${percent}. ${placement.error ? `${placement.error} ` : ""}${guidance}`;
        gridPreviewConfirm.disabled = true;
        gridPreviewCancel.disabled = Boolean(state.adjusting);
      }
      [...selectionButtons, selectionPicker, warpStep, ...nudgePad.children, relativePad, warpReset, ...coordinateFields.values()].forEach((item) => { if (item?.disabled !== undefined) item.disabled = Boolean(state.adjusting); });
    },
    retireGestures() {
      if (hold) { clearTimeout(hold.delay); clearInterval(hold.repeat); hold = null; suppressClick = true; }
      if (padGesture) { const retired = padGesture; padGesture = null; try { relativePad.releasePointerCapture?.(retired.pointer); } catch {} }
    },
    cancelGestures() { stopHold(true); return cancelPad(); },
    setAdjusting(adjusting) {
      const blocked = Boolean(adjusting);
      const correctionEnabled = state?.config?.outputs?.[element.dataset.output]?.warp?.enabled !== false;
      const editBlocked = blocked || !correctionEnabled;
      [...selectionButtons, selectionPicker].forEach((item) => { if (item?.disabled !== undefined) item.disabled = blocked; });
      [warpStep, ...nudgePad.children, relativePad, warpReset, warpResetAll].forEach((item) => { if (item?.disabled !== undefined) item.disabled = editBlocked; });
      for (const control of coordinateFields.values()) {
        if (control.number) control.number.disabled = editBlocked;
        if (control.range) control.range.disabled = editBlocked;
        if (control.signButton) control.signButton.disabled = editBlocked;
      }
      warpUndo.disabled = editBlocked || !(state?.historyDepth > 0);
      warpRedo.disabled = editBlocked || !(state?.redoDepth > 0);
    },
    dispose() { stopHold(true); this.cancelGestures(); doc.removeEventListener?.("keydown", cancelPadOnEscape, true); doc.removeEventListener?.("visibilitychange", onVisibility); doc.defaultView?.removeEventListener?.("blur", onBlur); for (const control of coordinateFields.values()) control.dispose(); },
  };
}
