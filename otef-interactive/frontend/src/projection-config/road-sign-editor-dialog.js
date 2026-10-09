import { createUuid } from "../shared/uuid.js";
import { createRoadSign, emptyRoadSignSettings } from "../shared/road-sign-settings.js";
import { renderField } from "./config-field-control.js";
import { mountRoadSignPreview } from "./road-sign-preview.js";
import { mapOutputToSourceUv, mapSourceUvToOutput, copyProjectionMesh, mapOverlayOutline } from "./clock-layout-geometry.js";

const clone = (value) => structuredClone(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const WIDTH = 114, HEIGHT = WIDTH / (524 / 381);

function make(doc, tag, props = {}, text = "") {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "ariaLabel") node.setAttribute("aria-label", value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else { try { node[key] = value; } catch { node.setAttribute?.(key, value); } }
  }
  if (text) node.textContent = text;
  return node;
}

function fitForRect(rect) {
  if (!(rect.width > 0 && rect.height > 0)) return null;
  const scale = Math.min(rect.width / 1920, rect.height / 1080);
  if (!(scale > 0)) return null;
  const width = scale * 1920, height = scale * 1080;
  return { scale, width, height, left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2 };
}

function fitIdentity(rect) {
  const fit = fitForRect(rect);
  return fit ? `${Math.round(fit.width * 10) / 10}x${Math.round(fit.height * 10) / 10}` : null;
}

function pointerOutput(event, rect) {
  const fit = fitForRect(rect);
  if (!fit) return null;
  const x = (event.clientX - fit.left) / fit.width;
  const y = (event.clientY - fit.top) / fit.height;
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

function signCorners(sign) {
  const angle = sign.rotateDeg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const halfW = WIDTH * sign.scale / 2, halfH = HEIGHT * sign.scale / 2;
  return [[-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH]].map(([x, y]) => ({
    u: (sign.x + x * c - y * s) / 1920,
    v: (sign.y + x * s + y * c) / 1080,
  }));
}

function hitSign(sign, point) {
  const dx = point.x - sign.x, dy = point.y - sign.y, angle = -sign.rotateDeg * Math.PI / 180;
  const x = dx * Math.cos(angle) - dy * Math.sin(angle);
  const y = dx * Math.sin(angle) + dy * Math.cos(angle);
  return Math.abs(x) <= WIDTH * sign.scale / 2 && Math.abs(y) <= HEIGHT * sign.scale / 2;
}

function fieldDescriptors() {
  return [
    { path: "x", label: "Center X", min: 0, max: 1920, step: 0.1, displayStep: 0.1, unit: "px", range: false, validate: (value) => Number.isFinite(value) && value >= 0 && value <= 1920 },
    { path: "y", label: "Center Y", min: 0, max: 1080, step: 0.1, displayStep: 0.1, unit: "px", range: false, validate: (value) => Number.isFinite(value) && value >= 0 && value <= 1080 },
    { path: "scale", label: "Size", min: 0.01, max: 3, step: 0.01, fine: 0.001, display: "percentage", displayMin: 1, displayMax: 300, displayStep: 1, unit: "%", range: true, validate: (value) => Number.isFinite(value) && value >= 0.01 && value <= 3 },
    { path: "rotateDeg", label: "Rotation", min: -180, max: 180, step: 1, fine: 0.1, displayMin: -180, displayMax: 180, displayStep: 1, unit: "°", range: true, validate: (value) => Number.isFinite(value) && value >= -180 && value <= 180 },
  ];
}

export function openRoadSignEditor({ document = globalThis.document, settingsClient, getAppliedCalibration, restoreFocus, onClose = () => {}, onPendingState = () => {}, manageBeforeUnload = false } = {}) {
  const doc = document, win = doc?.defaultView || globalThis.window;
  if (!doc?.createElement || !settingsClient || typeof getAppliedCalibration !== "function") throw new Error("Road 232 editor requires its document, settings client, and applied calibration");
  let active = true, activeOutput = "left", selectedId = null, placing = false, gesture = null, mesh = null, receipt = null, handlesEnabled = false;
  let preview = null, controls = new Map(), beforeUnloadAttached = false, syncSkipPath = null, lastPublishedIdentity = null;
  let resizeObserver = null, observedFit = null, hasObservedFit = false;
  const rangeBases = new Map(), nudgeBases = new Map();
  const opener = restoreFocus ? null : doc.activeElement;
  const dialog = make(doc, "section", { className: "road-sign-editor-dialog", role: "dialog", ariaLabel: "Road 232 signs editor", tabIndex: -1 });
  dialog.setAttribute("aria-modal", "true");
  const header = make(doc, "header", { className: "road-sign-editor-header" });
  const title = make(doc, "h2", {}, "Road 232 signs");
  const status = make(doc, "p", { className: "road-sign-editor-status", role: "status", ariaLive: "polite" }, "Loading");
  const closeButton = make(doc, "button", { type: "button", className: "road-sign-editor-close", ariaLabel: "Close editor" }, "Close");
  header.append(title, status, closeButton);
  const body = make(doc, "div", { className: "road-sign-editor-body" });
  const stage = make(doc, "div", { className: "road-sign-editor-stage" });
  const previewHost = make(doc, "div", { className: "road-sign-preview-host" });
  const overlay = doc.createElementNS?.("http://www.w3.org/2000/svg", "svg") || make(doc, "svg");
  overlay.setAttribute("viewBox", "0 0 1920 1080"); overlay.setAttribute("preserveAspectRatio", "xMidYMid meet"); overlay.setAttribute("aria-label", "Road 232 placement handles"); overlay.classList?.add("road-sign-overlay");
  stage.append(previewHost, overlay);
  const previewStatus = make(doc, "p", { className: "road-sign-preview-status", role: "status", ariaLive: "polite" }, "Loading preview");
  const mappingStatus = make(doc, "p", { className: "road-sign-mapping-status", role: "status", hidden: true });
  stage.append(previewStatus, mappingStatus);
  const panel = make(doc, "section", { className: "road-sign-editor-controls", ariaLabel: "Road 232 sign placement" });
  const outputLabel = make(doc, "label", { className: "road-sign-output-label" }, "Source output");
  const outputSelect = make(doc, "select", { ariaLabel: "Source output" });
  outputSelect.append(make(doc, "option", { value: "left" }, "Left"), make(doc, "option", { value: "right" }, "Right"), make(doc, "option", { value: "gis" }, "GIS"));
  outputLabel.append(outputSelect);
  const appliedNote = make(doc, "p", { className: "road-sign-applied-calibration" }, "Applied calibration");
  const actions = make(doc, "div", { className: "road-sign-actions" });
  const addButton = make(doc, "button", { type: "button", dataset: { action: "road-sign-add" } }, "Add");
  const duplicateButton = make(doc, "button", { type: "button", dataset: { action: "road-sign-duplicate" } }, "Duplicate");
  const removeButton = make(doc, "button", { type: "button", dataset: { action: "road-sign-remove" } }, "Remove");
  const capacityNote = make(doc, "p", { className: "road-sign-capacity-limit", hidden: true }, "At most 64 signs per source output. Remove a sign before adding or duplicating another.");
  actions.append(addButton, duplicateButton, removeButton);
  const list = make(doc, "div", { className: "road-sign-instance-list", role: "list", ariaLabel: "Road 232 sign instances" });
  const fields = make(doc, "div", { className: "road-sign-numeric-fields" });
  const warnings = make(doc, "p", { className: "road-sign-editor-warning", role: "status", hidden: true });
  panel.append(outputLabel, appliedNote, actions, capacityNote, list, fields, warnings);
  body.append(stage, panel); dialog.append(header, body); doc.body?.appendChild(dialog);
  const siblings = [...(doc.body?.children || [])].filter((node) => node !== dialog).map((node) => [node, node.inert]);
  siblings.forEach(([node]) => { node.inert = true; });
  closeButton.focus?.();

  function clientState() { return settingsClient.getState?.() || {}; }
  function currentDocument() {
    const state = clientState();
    const settings = clone(state.draft ?? state.acknowledged ?? emptyRoadSignSettings());
    if (activeOutput === "gis") settings.outputs.gis ??= [];
    return settings;
  }
  function isConflict() { return clientState().status === "Conflict"; }
  function signs() { return currentDocument().outputs?.[activeOutput] || []; }
  function selected() { return signs().find((sign) => sign.id === selectedId) || null; }
  function applied() {
    const value = getAppliedCalibration();
    if (!value || !value.config || !Number.isSafeInteger(value.revision) || value.revision < 0) throw new TypeError("Applied projection calibration is unavailable");
    return { config: clone(value.config), revision: value.revision };
  }
  function updateBeforeUnload() {
    const pending = Boolean(settingsClient.hasUnsavedWork?.());
    if (manageBeforeUnload && pending && !beforeUnloadAttached) { win?.addEventListener?.("beforeunload", beforeUnload); beforeUnloadAttached = true; }
    else if ((!manageBeforeUnload || !pending) && beforeUnloadAttached) { win?.removeEventListener?.("beforeunload", beforeUnload); beforeUnloadAttached = false; }
  }
  function beforeUnload(event) { if (settingsClient.hasUnsavedWork?.()) { event.preventDefault?.(); event.returnValue = ""; } }
  function renderStatus() {
    const value = settingsClient.getState?.() || {};
    status.textContent = value.status || "Saved";
    if (value.status === "Failed") {
      warnings.hidden = false; warnings.textContent = value.error || "Road 232 signs could not be saved.";
      const retry = make(doc, "button", { type: "button", dataset: { action: "road-sign-retry" } }, "Retry");
      warnings.appendChild(retry); retry.addEventListener("click", () => { void settingsClient.retry?.().catch?.(() => {}); });
    } else if (value.status === "Conflict") {
      warnings.hidden = false; warnings.replaceChildren(doc.createTextNode("Road 232 signs changed on the server. "));
      const latest = make(doc, "button", { type: "button", dataset: { action: "road-sign-use-latest" } }, "Use latest");
      warnings.appendChild(latest); latest.addEventListener("click", () => settingsClient.useLatest?.());
    } else { warnings.hidden = true; warnings.replaceChildren(); }
    updateBeforeUnload();
  }
  function publish(local = null, { force = false } = {}) {
    if (!preview || !active) return;
    const calibration = applied(), settings = local || currentDocument();
    const identity = JSON.stringify({ output: activeOutput, settings, config: calibration.config, revision: calibration.revision });
    if (!force && identity === lastPublishedIdentity) return;
    if (!gesture) {
      handlesEnabled = false; receipt = null; mesh = null;
      previewStatus.hidden = false; previewStatus.textContent = "Loading preview";
    }
    preview.setState({ settings, config: calibration.config, calibrationRevision: calibration.revision });
    lastPublishedIdentity = identity;
  }
  function svg(tag, attrs = {}) {
    const node = doc.createElementNS?.("http://www.w3.org/2000/svg", tag) || make(doc, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute?.(key, String(value));
    return node;
  }
  function sourcePoint(event, mapping) {
    const outputPoint = pointerOutput(event, mapping.rect);
    const uv = outputPoint && mapOutputToSourceUv(mapping.mesh, outputPoint);
    return uv ? { x: uv.u * 1920, y: uv.v * 1080 } : null;
  }
  function syncStageFit() {
    const rect = stage.getBoundingClientRect(), fit = fitForRect(rect);
    if (!fit) return null;
    previewHost.style.left = (fit.left - rect.left) + "px"; previewHost.style.top = (fit.top - rect.top) + "px";
    previewHost.style.right = "auto"; previewHost.style.bottom = "auto";
    previewHost.style.width = fit.width + "px"; previewHost.style.height = fit.height + "px";
    return fit;
  }
  function sameMapping(left, right) {
    return Boolean(left && right && left.output === right.output && left.sessionId === right.sessionId
      && left.calibrationRevision === right.calibrationRevision && left.meshIdentity === right.meshIdentity);
  }
  function mappingAccepted(mapping) {
    return handlesEnabled && Boolean(mesh && receipt) && sameMapping(mapping.receipt, receipt);
  }
  function drawOverlay() {
    const fit = syncStageFit();
    overlay.replaceChildren?.();
    if (!fit || !handlesEnabled || !mesh || !receipt) return;
    const overlaySigns = (gesture?.local || currentDocument()).outputs?.[activeOutput] || [];
    const selectedSign = overlaySigns.find((sign) => sign.id === selectedId && sign.visible);
    const selectedClipped = selectedSign ? signCorners(selectedSign).some((point) => point.u < 0 || point.u > 1 || point.v < 0 || point.v > 1) : false;
    mappingStatus.hidden = !selectedClipped;
    if (selectedClipped) mappingStatus.textContent = "Clipped by the source frame";
    for (const sign of overlaySigns) {
      if (!sign.visible) continue;
      const sourceCorners = signCorners(sign);
      const clipped = sourceCorners.some((point) => point.u < 0 || point.u > 1 || point.v < 0 || point.v > 1);
      const width = WIDTH * sign.scale, height = HEIGHT * sign.scale;
      const segments = mapOverlayOutline(mesh, {
        leftPct: (sign.x - width / 2) / 1920 * 100, topPct: (sign.y - height / 2) / 1080 * 100,
        widthPct: width / 1920 * 100, heightPct: height / 1080 * 100, rotateDeg: sign.rotateDeg,
      });
      const outlineClass = "road-sign-outline" + (sign.id === selectedId ? " selected" : "") + (clipped ? " clipped" : "");
      for (const segment of segments) overlay.appendChild(svg("line", { x1: segment.start.x * 1920, y1: segment.start.y * 1080,
        x2: segment.end.x * 1920, y2: segment.end.y * 1080, class: outlineClass, "data-sign-id": sign.id }));
      const center = mapSourceUvToOutput(mesh, { u: sign.x / 1920, v: sign.y / 1080 });
      if (center) {
        const radius = 22 / fit.scale, maxX = 1920 - radius, maxY = 1080 - radius;
        const hitX = Math.max(radius, Math.min(maxX, center.x * 1920)), hitY = Math.max(radius, Math.min(maxY, center.y * 1080));
        overlay.appendChild(svg("circle", { cx: center.x * 1920, cy: center.y * 1080, r: 4 / fit.scale,
          class: "road-sign-center-marker", "aria-hidden": "true" }));
        const conflictActive = isConflict();
        const handle = svg("circle", { cx: hitX, cy: hitY, r: radius, class: "road-sign-center-hit" + (clipped ? " clipped" : ""),
          "data-sign-id": sign.id, "aria-label": "Move sign " + sign.id, "aria-disabled": conflictActive, "pointer-events": conflictActive ? "none" : "auto" });
        if (!conflictActive) handle.addEventListener("pointerdown", (event) => beginGesture(event, sign.id, "sign")); overlay.appendChild(handle);
      }
      if (sign.leader.enabled) {
        const endpoint = mapSourceUvToOutput(mesh, { u: sign.leader.x / 1920, v: sign.leader.y / 1080 });
        if (endpoint) {
          const radius = 22 / fit.scale, maxX = 1920 - radius, maxY = 1080 - radius;
          const hitX = Math.max(radius, Math.min(maxX, endpoint.x * 1920)), hitY = Math.max(radius, Math.min(maxY, endpoint.y * 1080));
          overlay.appendChild(svg("circle", { cx: endpoint.x * 1920, cy: endpoint.y * 1080, r: 4 / fit.scale,
            class: "road-sign-leader-marker", "aria-hidden": "true" }));
          const conflictActive = isConflict();
          const handle = svg("circle", { cx: hitX, cy: hitY, r: radius, class: "road-sign-leader-hit", "data-sign-id": sign.id,
            "aria-label": "Move connector endpoint " + sign.id, "aria-disabled": conflictActive, "pointer-events": conflictActive ? "none" : "auto" });
          if (!conflictActive) handle.addEventListener("pointerdown", (event) => beginGesture(event, sign.id, "leader")); overlay.appendChild(handle);
        }
      }
    }
  }
  function syncConflictControls(disabled) {
    const outputSigns = signs(), atCapacity = outputSigns.length >= 64;
    addButton.disabled = disabled || atCapacity;
    duplicateButton.disabled = disabled || !selected() || atCapacity;
    removeButton.disabled = disabled || !selected();
    fields.querySelectorAll("input, button, select").forEach((node) => { node.disabled = disabled; });
  }
  function renderControls() {
    appliedNote.textContent = activeOutput === "gis" ? "GIS · Home scene" : "Applied calibration";
    const outputSigns = signs();
    if (!outputSigns.some((sign) => sign.id === selectedId)) selectedId = outputSigns[0]?.id || null;
    list.replaceChildren();
    outputSigns.forEach((sign, index) => {
      const item = make(doc, "button", { type: "button", role: "listitem", dataset: { signId: sign.id }, "aria-current": String(sign.id === selectedId) }, "Sign " + (index + 1));
      item.setAttribute("data-sign-id", sign.id); item.setAttribute("aria-current", String(sign.id === selectedId));
      item.addEventListener("click", () => setSelection(sign.id)); list.appendChild(item);
    });
    const sign = selected();
    const conflictActive = isConflict(), atCapacity = outputSigns.length >= 64;
    addButton.disabled = conflictActive || atCapacity;
    duplicateButton.disabled = !sign || conflictActive || atCapacity;
    removeButton.disabled = !sign || conflictActive;
    capacityNote.hidden = !atCapacity;
    fields.replaceChildren(); controls.forEach((control) => control.dispose()); controls.clear();
    if (!sign) {
      fields.appendChild(make(doc, "p", { className: "road-sign-empty-state" }, "No signs on this source output. Choose Add, then click the preview."));
      drawOverlay(); renderStatus(); return;
    }
    const visible = make(doc, "input", { type: "checkbox", checked: sign.visible, disabled: conflictActive, ariaLabel: "Show this sign", dataset: { action: "road-sign-visible" } });
    visible.addEventListener("change", () => { if (finishPendingEdit()) patchSelected((item) => { item.visible = visible.checked; }, true); });
    const visibleLabel = make(doc, "label", {}, "Visible"); visibleLabel.appendChild(visible); fields.appendChild(visibleLabel);
    for (const theme of ["dark", "original"]) {
      const radio = make(doc, "input", { type: "radio", name: "road-sign-theme", value: theme, checked: sign.theme === theme, disabled: conflictActive, ariaLabel: (theme === "dark" ? "Dark" : "Original") + " appearance", dataset: { action: "road-sign-theme-" + theme } });
      radio.addEventListener("change", () => { if (radio.checked && finishPendingEdit()) patchSelected((item) => { item.theme = theme; }, true); });
      const label = make(doc, "label", {}, theme === "dark" ? "Dark" : "Original"); label.appendChild(radio); fields.appendChild(label);
    }
    const connector = make(doc, "input", { type: "checkbox", checked: sign.leader.enabled, disabled: conflictActive, ariaLabel: "Show connector", dataset: { action: "road-sign-leader" } });
    connector.addEventListener("change", () => { if (finishPendingEdit()) patchSelected((item) => { item.leader.enabled = connector.checked; }, true); });
    const connectorLabel = make(doc, "label", {}, "Connector"); connectorLabel.appendChild(connector); fields.appendChild(connectorLabel);
    for (const descriptor of fieldDescriptors()) {
      const control = renderField(doc, descriptor, (path, raw, inputKind, meta) => onNumericField(path, raw, inputKind, meta, descriptor),
        (path, direction, meta) => onNudge(path, direction, meta, descriptor), false, true, () => {});
      control.descriptor = descriptor; control.wrap.classList.add("road-sign-numeric-field", "parameter-field-layout");
      if (descriptor.path === "x" || descriptor.path === "y") {
        control.wrap.classList.add("road-sign-coordinate-field"); control.range.hidden = true;
        control.wrap.querySelector(".numeric-sensitivity-group")?.setAttribute("hidden", "");
        control.wrap.querySelectorAll(".nudge").forEach((buttonNode) => buttonNode.setAttribute("hidden", ""));
      }
      fields.appendChild(control.wrap); controls.set(descriptor.path, control);
      control.update({ value: sign[descriptor.path] });
      if (conflictActive) control.wrap.querySelectorAll("input, button, select").forEach((node) => { node.disabled = true; });
    }
    drawOverlay(); renderStatus();
  }
  function syncControls(skipPath = null) {
    const sign = selected(); if (!sign) { renderControls(); return; }
    const visible = fields.querySelector('[data-action="road-sign-visible"]'); if (visible) visible.checked = sign.visible;
    for (const theme of ["dark", "original"]) { const radio = fields.querySelector('[data-action="road-sign-theme-' + theme + '"]'); if (radio) radio.checked = sign.theme === theme; }
    const connector = fields.querySelector('[data-action="road-sign-leader"]'); if (connector) connector.checked = sign.leader.enabled;
    for (const [path, control] of controls) if (path !== skipPath) control.update({ value: sign[path] });
    drawOverlay(); renderStatus();
  }
  function onNumericField(path, raw, inputKind, meta, descriptor) {
    if (inputKind === "range" && meta?.phase) {
      if (meta.phase === "start") {
        const base = selected()?.[path], value = meta.canonicalValue;
        rangeBases.set(path, base);
        if (!Number.isFinite(value) || (descriptor.validate && !descriptor.validate(value))) return false;
        if (Number.isFinite(base) && value !== base) patchSelected((item) => { item[path] = value; }, false, path);
        return true;
      }
      if (meta.phase === "end") { rangeBases.delete(path); return true; }
      if (meta.phase === "cancel") {
        const base = rangeBases.get(path); rangeBases.delete(path);
        if (!Number.isFinite(base)) return false;
        if (selected()?.[path] !== base) patchSelected((item) => { item[path] = base; }, false, path);
        controls.get(path)?.update({ value: base });
        return true;
      }
      if (meta.phase === "update") {
        const value = meta.canonicalValue;
        if (!Number.isFinite(value) || (descriptor.validate && !descriptor.validate(value))) return false;
        patchSelected((item) => { item[path] = value; }, false, path);
        return true;
      }
    }
    const next = Number(raw) / (path === "scale" ? 100 : 1);
    if (!Number.isFinite(next) || (descriptor.validate && !descriptor.validate(next))) return false;
    patchSelected((item) => { item[path] = next; }, false, path);
    return true;
  }
  function onNudge(path, direction, meta, descriptor) {
    if (meta?.phase === "sensitivity") return true;
    const current = selected()?.[path];
    if (!Number.isFinite(current)) return false;
    if (meta?.phase === "end") { nudgeBases.delete(path); return true; }
    if (meta?.phase === "cancel") {
      const base = nudgeBases.get(path); nudgeBases.delete(path);
      if (!Number.isFinite(base)) return true;
      if (current !== base) patchSelected((item) => { item[path] = base; }, false, path);
      return true;
    }
    if (meta?.phase === "start") nudgeBases.set(path, current);
    const amount = descriptor.fine ?? descriptor.step;
    const next = Math.max(descriptor.min, Math.min(descriptor.max, current + direction * amount));
    patchSelected((item) => { item[path] = next; }, false, path);
    return true;
  }
  function patchSelected(patch, flush = false, skipPath = null) {
    if (isConflict()) return false;
    const id = selectedId; if (!id) return false;
    const next = currentDocument(), sign = next.outputs[activeOutput]?.find((item) => item.id === id);
    if (!sign) return false;
    patch(sign);
    syncSkipPath = skipPath;
    let result;
    try { result = settingsClient.replaceDraft(next, { flush }); }
    finally { syncSkipPath = null; }
    void result.catch(() => {});
    publish(); syncControls(skipPath); return true;
  }
  function setSelection(id) {
    if (!finishPendingEdit()) return false;
    if (id === selectedId) return true;
    selectedId = id; renderControls(); publish(); return true;
  }
  function setOutput(next) {
    if (!["left", "right", "gis"].includes(next) || !finishPendingEdit()) { outputSelect.value = activeOutput; return false; }
    if (next === activeOutput) return true;
    placing = false; activeOutput = next; selectedId = signs()[0]?.id || null;
    receipt = null; mesh = null; handlesEnabled = false; lastPublishedIdentity = null;
    preview?.setOutput(next);
    previewStatus.hidden = false; previewStatus.textContent = "Loading preview";
    renderControls(); publish(); return true;
  }
  function beginGesture(event, id, kind) {
    if (isConflict() || gesture || event.button !== 0 || !finishPendingEdit() || !handlesEnabled || !receipt || !mesh) return;
    event.preventDefault?.(); event.stopPropagation?.();
    const rect = stage.getBoundingClientRect();
    const frozen = { rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      mesh: copyProjectionMesh(mesh), receipt: clone(receipt), output: activeOutput, base: currentDocument() };
    if (!frozen.mesh) return;
    if (kind === "place") {
      if (!placing) {
        const point = sourcePoint(event, frozen);
        const hit = point && signs().slice().reverse().find((item) => item.visible && hitSign(item, point));
        if (hit) { if (setSelection(hit.id)) beginGesture(event, hit.id, "sign"); }
        return;
      }
      const point = sourcePoint(event, frozen); if (!point) { mappingStatus.hidden = false; mappingStatus.textContent = "Mapping unavailable"; return; }
      if ((frozen.base.outputs[activeOutput] || []).length >= 64) return;
      const next = clone(frozen.base), sign = createRoadSign({ id: createUuid(), x: point.x, y: point.y });
      next.outputs[activeOutput].push(sign); gesture = { ...frozen, kind: "create", id: sign.id, origin: point, start: point, latest: point, local: next, pointerId: event.pointerId };
    } else {
      if (!signs().some((item) => item.id === id)) return;
      if (!setSelection(id)) return;
      const point = sourcePoint(event, frozen); if (!point) { mappingStatus.hidden = false; mappingStatus.textContent = "Mapping unavailable"; return; }
      const sign = signs().find((item) => item.id === id); if (!sign) return;
      const base = currentDocument();
      gesture = { ...frozen, kind, id, origin: kind === "leader" ? { x: sign.leader.x, y: sign.leader.y } : { x: sign.x, y: sign.y },
        start: point, latest: null, local: clone(base), pointerId: event.pointerId, base };
    }
    doc.addEventListener("pointermove", moveGesture); doc.addEventListener("pointerup", endGesture); doc.addEventListener("pointercancel", cancelGestureEvent);
    if (gesture?.kind === "create") { selectedId = gesture.id; publish(gesture.local); renderControls(); }
  }
  function moveGesture(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (isConflict() || gesture.output !== activeOutput || !same(currentDocument(), gesture.base) || !mappingAccepted(gesture)) { cancelGesture(); return; }
    const point = sourcePoint(event, gesture);
    if (!point) { mappingStatus.hidden = false; mappingStatus.textContent = "Mapping unavailable; placement was canceled."; cancelGesture(); return; }
    const dx = point.x - gesture.start.x, dy = point.y - gesture.start.y;
    gesture.latest = { x: Math.max(0, Math.min(1920, gesture.origin.x + dx)), y: Math.max(0, Math.min(1080, gesture.origin.y + dy)) };
    const item = gesture.local.outputs[gesture.output].find((sign) => sign.id === gesture.id);
    if (!item) { cancelGesture(); return; }
    if (gesture.kind === "leader") { item.leader.x = gesture.latest.x; item.leader.y = gesture.latest.y; }
    else { item.x = gesture.latest.x; item.y = gesture.latest.y; }
    publish(gesture.local); drawOverlay();
  }
  function releaseGestureListeners() {
    doc.removeEventListener("pointermove", moveGesture); doc.removeEventListener("pointerup", endGesture); doc.removeEventListener("pointercancel", cancelGestureEvent);
  }
  function cancelGesture({ publishState = true, render = true } = {}) {
    if (!gesture) return;
    gesture = null; releaseGestureListeners();
    if (publishState) publish();
    if (render) renderControls();
  }
  function cancelGestureEvent(event) { if (!gesture || event.pointerId !== gesture.pointerId) return; cancelGesture(); }
  function endGesture(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (isConflict() || !mappingAccepted(gesture)) { cancelGesture(); return; }
    moveGesture(event);
    if (!gesture) return;
    const completed = gesture; gesture = null; releaseGestureListeners();
    if (!mappingAccepted(completed) || !same(currentDocument(), completed.base)) { publish(); renderControls(); return; }
    placing = false; selectedId = completed.id;
    void settingsClient.replaceDraft(completed.local, { flush: true }).catch(() => {});
    publish(completed.local); renderControls();
  }
  function finishPendingEdit() {
    if (gesture || [...controls.values()].some((control) => control.isHeld())) return false;
    return [...controls.values()].every((control) => ["commit", "unchanged"].includes(control.finish().kind));
  }
  function hasPendingEdit() { return [...controls.values()].some((control) => control.isPending()); }
  const notifyPendingState = () => onPendingState(hasPendingEdit());
  for (const eventName of ["input", "change", "pointerup", "pointercancel", "keyup", "blur"]) fields.addEventListener(eventName, notifyPendingState);
  function isHeld() { return [...controls.values()].some((control) => control.isHeld()) || Boolean(gesture); }
  function cancelPendingEdit() { controls.forEach((control) => control.cancel()); cancelGesture(); }
  function close({ force = false } = {}) {
    if (!active) return true;
    if (!force && (!finishPendingEdit() || isHeld())) return false;
    controls.forEach((control) => { control.cancel(); control.dispose(); }); controls.clear();
    cancelGesture(); active = false; preview?.dispose(); preview = null;
    unsubscribe?.(); win?.removeEventListener?.("resize", onStageResize); resizeObserver?.disconnect?.(); resizeObserver = null;
    if (beforeUnloadAttached) win?.removeEventListener?.("beforeunload", beforeUnload);
    siblings.forEach(([node, wasInert]) => { node.inert = wasInert; }); dialog.remove?.();
    onPendingState(false);
    if (restoreFocus) restoreFocus()?.focus?.(); else opener?.focus?.();
    onClose(); return true;
  }
  function invalidate({ refreshPreview = false } = {}) {
    cancelGesture({ publishState: false }); handlesEnabled = false; receipt = null; mesh = null; lastPublishedIdentity = null;
    previewStatus.hidden = false; previewStatus.textContent = "Loading preview";
    syncStageFit(); publish();
    if (refreshPreview) preview?.refresh?.();
  }
  function onStageResize() {
    syncStageFit();
    const nextFit = fitIdentity(stage.getBoundingClientRect());
    if (!hasObservedFit) { observedFit = nextFit; hasObservedFit = true; return; }
    if (nextFit === observedFit) return;
    observedFit = nextFit;
    placing = false;
    invalidate({ refreshPreview: Boolean(nextFit) });
  }
  function onRendered(result) {
    const calibration = applied();
    if (!active || result.output !== activeOutput || result.calibrationRevision !== calibration.revision) return;
    const nextMesh = copyProjectionMesh(result.mesh);
    if (!nextMesh || !result.meshIdentity) return;
    const nextReceipt = { ...result, mesh: nextMesh };
    if (gesture && !sameMapping(gesture.receipt, nextReceipt)) cancelGesture({ publishState: false });
    mesh = nextMesh; receipt = nextReceipt; handlesEnabled = true;
    previewStatus.hidden = true; mappingStatus.hidden = true; drawOverlay();
  }
  outputSelect.addEventListener("change", () => setOutput(outputSelect.value));
  overlay.addEventListener?.("pointerdown", (event) => beginGesture(event, null, "place"));
  addButton.addEventListener("click", () => { if (isConflict() || signs().length >= 64 || !finishPendingEdit()) return; placing = true; previewStatus.hidden = false; previewStatus.textContent = "Click the preview to place a sign. Press Escape to cancel."; });
  duplicateButton.addEventListener("click", () => {
    if (isConflict() || signs().length >= 64 || !finishPendingEdit()) return;
    const source = selected(); if (!source) return;
    const next = currentDocument(), currentSource = next.outputs[activeOutput]?.find((item) => item.id === source.id);
    if (!currentSource) return;
    const copy = clone(currentSource); copy.id = createUuid(); copy.x = Math.max(0, Math.min(1920, copy.x + 24)); copy.y = Math.max(0, Math.min(1080, copy.y + 24));
    next.outputs[activeOutput].push(copy); selectedId = copy.id; void settingsClient.replaceDraft(next, { flush: true }).catch(() => {}); renderControls(); publish();
  });
  removeButton.addEventListener("click", () => {
    if (isConflict() || !finishPendingEdit() || !selectedId) return;
    const next = currentDocument(); next.outputs[activeOutput] = next.outputs[activeOutput].filter((sign) => sign.id !== selectedId);
    selectedId = next.outputs[activeOutput][0]?.id || null; void settingsClient.replaceDraft(next, { flush: true }).catch(() => {}); renderControls(); publish();
  });
  closeButton.addEventListener("click", () => close());
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (hasPendingEdit()) { event.preventDefault(); cancelPendingEdit(); return; }
      if (placing) { event.preventDefault(); placing = false; previewStatus.hidden = true; return; }
      close();
    } else if (event.key === "Tab") {
      const focusable = [...dialog.querySelectorAll("button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden])")];
      if (!focusable.length) return;
      if (event.shiftKey && doc.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
      else if (!event.shiftKey && doc.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
    }
  });
  let wasConflict = isConflict();
  const unsubscribe = settingsClient.subscribe?.((state) => {
    if (!active) return;
    const conflictActive = state?.status === "Conflict";
    const enteringConflict = conflictActive && !wasConflict, leavingConflict = !conflictActive && wasConflict;
    wasConflict = conflictActive;
    const canceledGesture = Boolean(gesture && (conflictActive || !same(currentDocument(), gesture.base)));
    if (canceledGesture) cancelGesture({ publishState: false, render: false });
    if (enteringConflict) controls.forEach((control, path) => {
      if (!control.isHeld()) return;
      control.cancel({ notify: false });
      rangeBases.delete(path); nudgeBases.delete(path);
    });
    const existingIds = [...list.querySelectorAll("[data-sign-id]")].map((item) => item.getAttribute("data-sign-id"));
    const nextIds = signs().map((item) => item.id);
    if (conflictActive) {
      if (enteringConflict || canceledGesture) {
        syncConflictControls(true);
        drawOverlay(); renderStatus();
      }
    } else if (leavingConflict || !same(existingIds, nextIds) || (selectedId != null && !nextIds.includes(selectedId))) renderControls();
    else syncControls(syncSkipPath);
    if (!gesture) publish();
  });
  win?.addEventListener?.("resize", onStageResize);
  preview = mountRoadSignPreview({ container: previewHost, output: activeOutput, onRendered, onError: (error) => {
    cancelGesture({ publishState: false }); handlesEnabled = false; receipt = null; mesh = null; lastPublishedIdentity = null;
    previewStatus.hidden = false; previewStatus.textContent = "Preview unavailable: " + (error?.message || "Rendering failed");
  } });
  try { publish(); } catch (error) { previewStatus.textContent = `Preview unavailable: ${error.message}`; }
  renderControls();
  observedFit = fitIdentity(stage.getBoundingClientRect()); hasObservedFit = true;
  if (typeof ResizeObserver === "function") { resizeObserver = new ResizeObserver(onStageResize); resizeObserver.observe(stage); }
  return {
    close, dispose() { close({ force: true }); }, sync() { renderControls(); publish(); }, calibrationChanged() { invalidate(); },
    finishPendingEdit, hasPendingEdit, isHeld, cancelPendingEdit,
  };
}
