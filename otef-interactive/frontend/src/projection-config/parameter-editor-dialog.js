import { renderField } from "./config-field-control.js";

const pathValue = (config, path) => path.split(".").reduce((value, key) => value?.[key], config);
export function presentationError(path, error) {
  const cropMatch = path.match(/^outputs\.(left|right)\.crop\.(x0|x1|y0|y1)$/);
  const extentMatch = String(error || "").match(/^([xy]) extent must be at least 0\.01$/);
  if (!cropMatch || !extentMatch) return error;
  const dimension = extentMatch[1] === "x" ? "Horizontal" : "Vertical";
  return `${dimension} crop extent must be at least 1 percentage point.`;
}

/** Enlarged controls for one geometry node. Values remain owned by the view/controller. */
export function createParameterEditorDialog({ document: doc, host, presentation = "dialog", onField = () => {}, onCancelField = () => {}, onNudge = () => {}, onAction = () => {}, createPreview = null, onVisibilityChange = () => {}, resolveFieldPath = (_descriptor, _config) => null, isFieldVisible = () => true, pendingTargetLabel = (descriptor, resolvedPath) => `Pending edit still targets ${descriptor.label || resolvedPath}. Cancel this field before returning to nodes.`, contextForConfig = () => "" }) {
  if (!doc?.createElement || !host) throw new Error("parameter editor host is required");
  if (!["dialog", "panel"].includes(presentation)) throw new TypeError("parameter editor presentation must be dialog or panel");
  const modal = doc.createElement("section");
  modal.className = "parameter-editor-dialog";
  modal.hidden = true;
  modal.dataset.presentation = presentation;
  if (presentation === "dialog") {
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
  } else modal.setAttribute("role", "region");
  modal.setAttribute("aria-labelledby", "parameter-editor-title");
  const header = doc.createElement("header"); header.className = "parameter-editor-header";
  const title = doc.createElement("h2"); title.id = "parameter-editor-title";
  const titleContext = doc.createElement("span"); titleContext.className = "parameter-editor-title-context"; titleContext.hidden = true;
  const status = doc.createElement("p"); status.className = "parameter-editor-status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const closeButton = doc.createElement("button"); closeButton.type = "button"; closeButton.dataset.action = "parameter-editor-close"; closeButton.textContent = presentation === "panel" ? "Back to nodes" : "Close";
  const undo = doc.createElement('button'); undo.type = 'button'; undo.textContent = 'Undo parameter'; undo.dataset.action = 'parameter-undo';
  const redo = doc.createElement('button'); redo.type = 'button'; redo.textContent = 'Redo parameter'; redo.dataset.action = 'parameter-redo';
  undo.addEventListener('click', () => onAction('parameter-undo')); redo.addEventListener('click', () => onAction('parameter-redo'));
  header.append(title, titleContext, status, undo, redo, closeButton);
  const body = doc.createElement("div"); body.className = "parameter-editor-body";
  const fields = doc.createElement("div"); fields.className = "parameter-editor-fields";
  const previewColumn = doc.createElement("section"); previewColumn.className = "parameter-editor-preview-column";
  const previewHost = doc.createElement("div"); previewHost.className = "parameter-editor-previews";
  const previewStatus = doc.createElement("p"); previewStatus.className = "parameter-editor-preview-status"; previewStatus.setAttribute("role", "status"); previewStatus.setAttribute("aria-live", "polite");
  const previewRetry = doc.createElement("button"); previewRetry.type = "button"; previewRetry.textContent = "Retry preview"; previewRetry.className = "parameter-preview-retry"; previewRetry.hidden = true;
  previewColumn.append(previewHost, previewStatus, previewRetry);
  body.append(fields, previewColumn); modal.append(header, body); host.appendChild(modal);
  const preview = createPreview?.(previewHost, (message, canRetry) => { previewStatus.textContent = message; previewRetry.hidden = !canRetry; }) || null;
  let opener = null;
  let fieldControls = new Map();
  let inertSiblings = [];
  let oldOverflow = null;
  let disposed = false;
  let latestConfig = null;
  let latestHistory = { undo: 0, redo: 0 };

  const focusables = () => [...modal.querySelectorAll("button:not([hidden]), input:not([hidden]), select:not([hidden]), [tabindex]:not([tabindex='-1'])")]
    .filter((item) => !item.disabled && !item.closest("[hidden]"));
  const onKeyDown = (event) => {
    if (modal.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if ([...fieldControls.values()].some((control) => control.isPending())) {
        for (const control of fieldControls.values()) control.cancel({ clearControllerError: true });
        return;
      }
      close(); return;
    }
    if (presentation !== "dialog" || event.key !== "Tab") return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0]; const last = items.at(-1);
    if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const renderValues = ({ config, fieldErrors = {}, status: nextStatus, parameterHistory } = {}) => {
    if (parameterHistory) latestHistory = parameterHistory;
    undo.disabled = !latestHistory.undo; redo.disabled = !latestHistory.redo;
    if (nextStatus !== undefined) status.textContent = String(nextStatus || "");
    if (!config) return;
    latestConfig = config;
    const context = String(contextForConfig(modal.dataset.node, config) || "");
    titleContext.textContent = context;
    titleContext.hidden = !context;
    preview?.update?.(config);
    for (const [path, control] of fieldControls) {
      const descriptor = control.descriptor;
      const resolvedPath = resolveFieldPath(descriptor, config) || path;
      const profileVisible = isFieldVisible(descriptor, config);
      const retainPending = !profileVisible && control.isPending();
      control.wrap.hidden = !profileVisible && !retainPending;
      const targetNote = control.pendingTargetNote;
      if (targetNote) {
        targetNote.hidden = !retainPending;
        targetNote.textContent = retainPending ? pendingTargetLabel(descriptor, resolvedPath, config) : "";
      }
      const value = pathValue(config, resolvedPath);
      const rawError = fieldErrors[resolvedPath] || Object.entries(fieldErrors).find(([key]) => resolvedPath.startsWith(`${key}.`))?.[1] || "";
      control.update({ value, resolvedPath, error: presentationError(resolvedPath, rawError) });
    }
  };
  const open = ({ nodeId, title: heading, descriptors = [], opener: activatingElement } = {}) => {
    if (disposed) return;
    if (modal.hidden) {
      opener = activatingElement || doc.activeElement;
      if (presentation === "dialog") {
        if (doc.body?.style) { oldOverflow = doc.body.style.overflow; doc.body.style.overflow = "hidden"; }
        inertSiblings = [...host.children].filter((child) => child !== modal).map((child) => [child, child.inert]);
        for (const [child] of inertSiblings) child.inert = true;
      }
      modal.hidden = false;
      doc.addEventListener?.("keydown", onKeyDown);
      onVisibilityChange(true);
    }
    modal.dataset.node = nodeId || "";
    title.textContent = heading || "Adjust parameters";
    for (const control of fieldControls.values()) control.dispose();
    fields.replaceChildren(); fieldControls = new Map();
    for (const descriptor of descriptors) {
      const control = renderField(doc, descriptor, onField, onNudge, false, true, onCancelField);
      control.wrap.classList.add("parameter-editor-field");
      control.descriptor = descriptor;
      control.pendingTargetNote = doc.createElement("p");
      control.pendingTargetNote.className = "config-field-pending-target";
      control.pendingTargetNote.setAttribute("role", "status");
      control.pendingTargetNote.hidden = true;
      control.wrap.appendChild(control.pendingTargetNote);
      fields.appendChild(control.wrap);
      fieldControls.set(descriptor.path, control);
    }
    preview?.open?.(nodeId);
    preview?.update?.(latestConfig);
    renderValues({ config: latestConfig });
    closeButton.focus();
  };
  const close = ({ force = false } = {}) => {
    if (modal.hidden) return true;
    if (!force) {
      if ([...fieldControls.values()].some((control) => control.isHeld())) return false;
      const results = [...fieldControls.values()].map((control) => control.finish());
      if (!results.every((result) => result.kind === "commit" || result.kind === "unchanged")) return false;
    }
    for (const control of fieldControls.values()) control.cancel();
    modal.hidden = true;
    preview?.close?.();
    doc.removeEventListener?.("keydown", onKeyDown);
    for (const [element, wasInert] of inertSiblings) element.inert = wasInert;
    inertSiblings = [];
    if (oldOverflow !== null && doc.body?.style) { doc.body.style.overflow = oldOverflow; oldOverflow = null; }
    onVisibilityChange(false);
    opener?.focus?.(); opener = null;
    return true;
  };
  if (presentation === "panel") closeButton.addEventListener("pointerdown", (event) => event.preventDefault?.());
  closeButton.addEventListener("click", close);
  previewRetry.addEventListener("click", () => preview?.retry?.());
  return {
    open,
    element: modal,
    titleContext,
    fieldsElement: fields,
    presentation,
    update: renderValues,
    close,
    finish() { return [...fieldControls.values()].map(control => control.finish()); },
    isPending: () => [...fieldControls.values()].some(control => control.isPending()),
    isHeld: () => [...fieldControls.values()].some(control => control.isHeld()),
    cancel(options) { for (const control of fieldControls.values()) control.cancel(options); },
    isOpen: () => !modal.hidden,
    dispose() { if (disposed) return; close({ force: true }); disposed = true; for (const control of fieldControls.values()) control.dispose(); preview?.dispose?.(); doc.removeEventListener?.("keydown", onKeyDown); modal.remove(); fieldControls.clear(); },
  };
}
