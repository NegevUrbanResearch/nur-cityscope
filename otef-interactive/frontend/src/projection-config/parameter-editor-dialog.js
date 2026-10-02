import { renderField } from "./config-field-control.js";

const pathValue = (config, path) => path.split(".").reduce((value, key) => value?.[key], config);

/** Full-screen controls for one geometry node. Values remain owned by the view/controller. */
export function createParameterEditorDialog({ document: doc, host, onField = () => {}, onNudge = () => {}, createPreview = null }) {
  if (!doc?.createElement || !host) throw new Error("parameter editor host is required");
  const modal = doc.createElement("section");
  modal.className = "parameter-editor-dialog";
  modal.hidden = true;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "parameter-editor-title");
  const header = doc.createElement("header"); header.className = "parameter-editor-header";
  const title = doc.createElement("h2"); title.id = "parameter-editor-title";
  const status = doc.createElement("p"); status.className = "parameter-editor-status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  const closeButton = doc.createElement("button"); closeButton.type = "button"; closeButton.dataset.action = "parameter-editor-close"; closeButton.textContent = "Close";
  header.append(title, status, closeButton);
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

  const focusables = () => [...modal.querySelectorAll("button:not([hidden]), input:not([hidden]), select:not([hidden]), [tabindex]:not([tabindex='-1'])")]
    .filter((item) => !item.disabled && !item.closest("[hidden]"));
  const onKeyDown = (event) => {
    if (modal.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const items = focusables();
    if (!items.length) return;
    const first = items[0]; const last = items.at(-1);
    if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const renderValues = ({ config, fieldErrors = {}, status: nextStatus } = {}) => {
    if (nextStatus !== undefined) status.textContent = String(nextStatus || "");
    if (!config) return;
    latestConfig = config;
    preview?.update?.(config);
    for (const [path, control] of fieldControls) {
      const value = pathValue(config, path);
      const error = fieldErrors[path] || Object.entries(fieldErrors).find(([key]) => path.startsWith(`${key}.`))?.[1] || "";
      control.update({ value, resolvedPath: path, error });
    }
  };
  const open = ({ nodeId, title: heading, descriptors = [], opener: activatingElement } = {}) => {
    if (disposed) return;
    if (modal.hidden) {
      opener = activatingElement || doc.activeElement;
      if (doc.body?.style) { oldOverflow = doc.body.style.overflow; doc.body.style.overflow = "hidden"; }
      inertSiblings = [...host.children].filter((child) => child !== modal).map((child) => [child, child.inert]);
      for (const [child] of inertSiblings) child.inert = true;
      modal.hidden = false;
      doc.addEventListener?.("keydown", onKeyDown);
    }
    modal.dataset.node = nodeId || "";
    title.textContent = heading || "Adjust parameters";
    for (const control of fieldControls.values()) control.dispose();
    fields.replaceChildren(); fieldControls = new Map();
    for (const descriptor of descriptors) {
      const control = renderField(doc, descriptor, onField, onNudge, false, true);
      control.wrap.classList.add("parameter-editor-field");
      control.descriptor = descriptor;
      fields.appendChild(control.wrap);
      fieldControls.set(descriptor.path, control);
    }
    preview?.open?.(nodeId);
    preview?.update?.(latestConfig);
    renderValues({ config: latestConfig });
    closeButton.focus();
  };
  const close = () => {
    if (modal.hidden) return;
    for (const control of fieldControls.values()) control.cancel();
    modal.hidden = true;
    preview?.close?.();
    doc.removeEventListener?.("keydown", onKeyDown);
    for (const [element, wasInert] of inertSiblings) element.inert = wasInert;
    inertSiblings = [];
    if (oldOverflow !== null && doc.body?.style) { doc.body.style.overflow = oldOverflow; oldOverflow = null; }
    opener?.focus?.(); opener = null;
  };
  closeButton.addEventListener("click", close);
  previewRetry.addEventListener("click", () => preview?.retry?.());
  return {
    open,
    update: renderValues,
    close,
    finish() { return [...fieldControls.values()].map(control => control.finish()); },
    isPending: () => [...fieldControls.values()].some(control => control.isPending()),
    isHeld: () => [...fieldControls.values()].some(control => control.isHeld()),
    cancel() { for (const control of fieldControls.values()) control.cancel(); },
    isOpen: () => !modal.hidden,
    dispose() { if (disposed) return; close(); disposed = true; for (const control of fieldControls.values()) control.dispose(); preview?.dispose?.(); doc.removeEventListener?.("keydown", onKeyDown); modal.remove(); fieldControls.clear(); },
  };
}
