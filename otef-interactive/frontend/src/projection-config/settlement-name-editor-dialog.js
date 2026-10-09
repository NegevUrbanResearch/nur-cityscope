import { createUuid } from "../shared/uuid.js";
import { hitTestSettlementLabels, settlementOutline, settlementPointerToReference } from "./settlement-name-geometry.js";
import { mountSettlementNamePreview } from "./settlement-name-preview.js";
import { createSettlementNameControls, shownSettlementPosition } from "./settlement-name-controls.js";
import { mapSettlementPosition } from '../projection/settlement-name-framing.js';
import { mapSourceUvToOutput } from './clock-layout-geometry.js';
import { snapSettlementOrigin } from './settlement-origin-geometry.js';

function make(doc, tag, props = {}, text = "") {
  const node = doc.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "ariaLabel") node.setAttribute("aria-label", value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else node[key] = value;
  }
  if (text) node.textContent = text;
  return node;
}

function outputPoint(event, rect) {
  const scale = Math.min(rect.width / 1920, rect.height / 1080) || 1;
  const width = scale * 1920;
  const height = scale * 1080;
  const left = rect.left + (rect.width - width) / 2;
  const top = rect.top + (rect.height - height) / 2;
  return { x: (event.clientX - left) / width * 1920, y: (event.clientY - top) / height * 1080 };
}

function warningText(warnings) {
  return [
    warnings?.clipped ? "Clipped by the frame" : "",
    warnings?.overlap ? "Overlap" : "",
    warnings?.outOfView ? "Outside the frame" : "",
  ].filter(Boolean).join(". ");
}

export function openSettlementNameEditor({
  nodeId = "settlement-names",
  output = "left",
  citycode = "",
  settingsClient,
  getNameLanguage = () => 'he',
  subscribeNameLanguage,
  catalog = { entries: [] },
  catalogStatus = { status: "ready" },
  onRetryCatalog = () => {},
  document = globalThis.document,
  onSelection = () => {},
  onClose = () => {},
  restoreFocus,
  manageBeforeUnload = true,
} = {}) {
  const doc = document;
  if (!doc?.createElement || !settingsClient || nodeId !== "settlement-names") throw new Error("Settlement editor requires a document and settings client");
  const win = doc.defaultView || globalThis.window;
  let activeOutput = output === "right" ? "right" : "left";
  let activeCitycode = citycode || catalog.entries?.[0]?.citycode || "";
  let active = true;
  let handlesEnabled = false;
  let labels = [];
  let mesh = null;
  let positionMatrix = null;
  let originGeometry = null;
  let gesture = null;
  let preview = null;
  let scheduledFrame = null;
  const opener = typeof restoreFocus === "function" ? null : doc.activeElement;

  const dialog = make(doc, "section", { className: "settlement-name-dialog", role: "dialog", ariaLabel: "Settlement names editor", tabIndex: -1 });
  dialog.setAttribute?.("aria-modal", "true");
  const header = make(doc, "header", { className: "settlement-name-header" });
  const title = make(doc, "h2", {}, "Settlement names");
  const closeButton = make(doc, "button", { type: "button", className: "settlement-name-close", ariaLabel: "Close editor" }, "Close");
  header.append(title, closeButton);
  const body = make(doc, "div", { className: "settlement-name-body" });
  const stage = make(doc, "div", { className: "settlement-name-stage" });
  const referencePlane = make(doc, "div", { className: "settlement-name-reference-plane" });
  const previewHost = make(doc, "div", { className: "settlement-preview-host" });
  const overlay = doc.createElementNS?.("http://www.w3.org/2000/svg", "svg") || make(doc, "svg");
  overlay.setAttribute?.("class", "settlement-name-overlay");
  overlay.setAttribute?.("viewBox", "0 0 1920 1080");
  overlay.setAttribute?.("preserveAspectRatio", "none");
  referencePlane.append(previewHost, overlay);
  stage.appendChild(referencePlane);
  const mapping = make(doc, "p", { className: "settlement-name-mapping", role: "status", hidden: true });
  const warning = make(doc, "p", { className: "settlement-name-warning", role: "status", hidden: true });
  const retry = make(doc, "button", { type: "button", className: "settlement-preview-retry", hidden: true }, "Retry preview");
  stage.append(mapping, retry);
  const controls = createSettlementNameControls(doc, {
    catalog,
    onOutput: (next) => { if (setSelection({ output: next, citycode: activeCitycode })) onSelection({ output: activeOutput, citycode: activeCitycode }); else controls.output.value = activeOutput; },
    onCitycode: (next) => { if (setSelection({ output: activeOutput, citycode: next })) onSelection({ output: activeOutput, citycode: activeCitycode }); else controls.city.value = activeCitycode; },
    onPosition: (position) => { void settingsClient.commit({ kind: "position", output: activeOutput, citycode: activeCitycode }, position, { numeric: true }).catch(() => {}); publish(); },
    onStyle: (style) => { void settingsClient.commit({ kind: "style" }, style, { numeric: true }).catch(() => {}); publish(); },
    onLineBreak: (afterWord) => { void settingsClient.commit({ kind: 'line_break', citycode: activeCitycode }, afterWord).catch(() => {}); publish(); },
    onLeaderStyle: (style) => { void settingsClient.commit({ kind: 'leader_style' }, style, { numeric: true }).catch(() => {}); publish(); },
    onResetOrigin: () => { void settingsClient.commit({ kind: 'leader_origin', citycode: activeCitycode }, null, { operation: 'reset_leader_origin' }).catch(() => {}); publish(); },
    onRetry: () => {
      if (settingsClient.getHydrationState?.().status === "Failed") {
        void settingsClient.hydrate({ forceFresh: true }).catch(() => {});
      } else if (activeCitycode) {
        void Promise.all([
          settingsClient.retry({ kind: "position", output: activeOutput, citycode: activeCitycode }),
          settingsClient.retry({ kind: "style" }),
          settingsClient.retry({ kind: 'line_break', citycode: activeCitycode }),
          settingsClient.retry({ kind: 'leader_style' }),
          settingsClient.retry({ kind: 'leader_origin', citycode: activeCitycode }),
        ]).catch(() => {});
      }
    },
    onRetryCatalog,
    onLoad: () => {
      settingsClient.loadSaved({ kind: "position", output: activeOutput, citycode: activeCitycode });
      settingsClient.loadSaved({ kind: "style" });
      settingsClient.loadSaved({ kind: 'line_break', citycode: activeCitycode });
      settingsClient.loadSaved({ kind: 'leader_style' });
      settingsClient.loadSaved({ kind: 'leader_origin', citycode: activeCitycode });
      publish();
    },
  });
  controls.element.appendChild(warning);
  body.append(stage, controls.element);
  dialog.append(header, body);
  doc.body?.appendChild(dialog);
  closeButton.focus?.();

  function snapshot() { return settingsClient.getSnapshot()?.settings || null; }
  function setCatalog(nextCatalog, nextCatalogStatus = catalogStatus) {
    catalog = nextCatalog && Array.isArray(nextCatalog.entries) ? nextCatalog : { entries: [] };
    catalogStatus = nextCatalogStatus || { status: "ready" };
    if (!catalog.entries.some((entry) => entry?.citycode === activeCitycode)) activeCitycode = catalog.entries[0]?.citycode || "";
    renderControls();
  }
  function positionRecord() { return settingsClient.getTarget({ kind: "position", output: activeOutput, citycode: activeCitycode }); }
  function styleRecord() { return settingsClient.getTarget({ kind: "style" }); }
  function shownPosition() {
    if (gesture?.latest && gesture.kind !== 'origin') return gesture.latest;
    return shownSettlementPosition(snapshot(), positionRecord(), activeOutput, activeCitycode);
  }
  function renderControls() {
    const settings = snapshot();
    controls.render({
      output: activeOutput,
      citycode: activeCitycode,
      catalog,
      catalogStatus,
      position: shownPosition(),
      style: styleRecord().draft || styleRecord().acknowledged || settings?.style,
      positionRecord: positionRecord(),
      styleRecord: styleRecord(),
      afterWord: settings?.lineBreaks?.[activeCitycode] || 0,
      leaderStyle: settings?.leaderStyle,
      lineBreakRecord: settingsClient.getTarget({ kind: 'line_break', citycode: activeCitycode }),
      leaderStyleRecord: settingsClient.getTarget({ kind: 'leader_style' }),
      leaderOrigin: settings?.leaderOrigins?.[activeCitycode] || null,
      leaderOriginRecord: settingsClient.getTarget({ kind: 'leader_origin', citycode: activeCitycode }),
      hydration: settingsClient.getHydrationState?.() || { status: "Saved" },
      enabled: settingsClient.getHydrationState?.().status !== "Failed",
    });
  }
  function svg(tag, props = {}) {
    const node = doc.createElementNS?.("http://www.w3.org/2000/svg", tag) || make(doc, tag);
    for (const [key, value] of Object.entries(props)) node.setAttribute?.(key, String(value));
    return node;
  }
  function fitPreview() {
    const rect = gesture?.rect || stage.getBoundingClientRect();
    const scale = Math.min(rect.width / 1920, rect.height / 1080) || 1;
    referencePlane.style.transform = `translate(${(rect.width - 1920 * scale) / 2}px, ${(rect.height - 1080 * scale) / 2}px) scale(${scale})`;
  }
  function drawOverlay() {
    overlay.replaceChildren?.();
    if (!handlesEnabled || !mesh) return;
    const hit = svg("rect", { x: 0, y: 0, width: 1920, height: 1080, class: "settlement-body-hit" });
    hit.addEventListener("pointerdown", beginGesture);
    overlay.appendChild(hit);
    const selected = labels.find((label) => label.citycode === activeCitycode);
    if (!selected) return;
    for (const edge of settlementOutline(mesh, selected)) {
      const path = svg("path", { d: `M${edge.start.x * 1920} ${edge.start.y * 1080} L${edge.end.x * 1920} ${edge.end.y * 1080}`, class: "settlement-outline" });
      overlay.appendChild(path);
    }
    if (originGeometry?.point && originGeometry.citycode === activeCitycode) {
      const point = mapSourceUvToOutput(mesh, { u: originGeometry.point.x / 1920, v: originGeometry.point.y / 1080 });
      if (!point) return;
      const rect = stage.getBoundingClientRect(), scale = Math.min(rect.width / 1920, rect.height / 1080) || 1;
      const cx = point.x * 1920, cy = point.y * 1080;
      const visible = svg('circle', { cx, cy, r: 7 / scale, class: 'settlement-origin-handle' });
      const hitOrigin = svg('circle', { cx, cy, r: 24 / scale, class: 'settlement-origin-hit', 'aria-label': 'Drag line origin on the settlement outline' });
      hitOrigin.addEventListener('pointerdown', beginOriginGesture);
      overlay.append(visible, hitOrigin);
    }
  }
  function publish() {
    const settings = snapshot();
    if (!settings || !preview) return;
    const next = structuredClone(settings);
    if (gesture?.latest && gesture.kind === 'origin') {
      next.leaderOrigins ||= {}; next.leaderOrigins[activeCitycode] = { ...gesture.latest };
    } else if (gesture?.latest) next.outputs[activeOutput][activeCitycode] = { ...gesture.latest };
    preview.setState({ settings: next, selectedCitycode: activeCitycode, language: getNameLanguage() });
    renderControls();
  }
  function referenceFor(event, rect, frozen = mesh) {
    const point = outputPoint(event, rect);
    return settlementPointerToReference(frozen, { x: point.x / 1920, y: point.y / 1080 });
  }
  function showMapping(text) {
    const position = shownPosition();
    mapping.hidden = false;
    mapping.textContent = `${text}; source coordinates remain X ${position?.x ?? "—"} Y ${position?.y ?? "—"}`;
  }
  function beginGesture(event) {
    if (!handlesEnabled || gesture || event.button !== 0) return;
    event.preventDefault?.();
    const rect = stage.getBoundingClientRect();
    const reference = referenceFor(event, rect, mesh);
    if (!reference) { showMapping("Mapping unavailable"); return; }
    mapping.hidden = true;
    const hit = hitTestSettlementLabels(labels, reference, activeCitycode);
    if (hit && hit !== activeCitycode) {
      activeCitycode = hit;
      onSelection({ output: activeOutput, citycode: activeCitycode });
    }
    if (hit !== activeCitycode && hit == null) return;
    const position = shownSettlementPosition(snapshot(), positionRecord(), activeOutput, activeCitycode);
    if (!position) return;
    const storedReference=mapSettlementPosition(reference,positionMatrix,true);
    if (!storedReference) { showMapping("Mapping unavailable"); return; }
    gesture = { pointerId: event.pointerId, rect, mesh, positionMatrix:positionMatrix ? [...positionMatrix] : null, start: storedReference, origin: { ...position }, latest: { ...position } };
    doc.addEventListener?.("pointermove", moveGesture);
    doc.addEventListener?.("pointerup", endGesture);
    doc.addEventListener?.("pointercancel", cancelGesture);
  }
  function beginOriginGesture(event) {
    if (!handlesEnabled || gesture || event.button !== 0 || originGeometry?.citycode !== activeCitycode) return;
    event.preventDefault?.(); event.stopPropagation?.();
    const rect = stage.getBoundingClientRect(), geometry = structuredClone(originGeometry);
    const reference = referenceFor(event, rect, mesh);
    const snapped = reference && snapSettlementOrigin(reference, geometry.worldRings, geometry.projectedRings);
    if (!snapped) return;
    const record = settingsClient.getTarget({ kind: 'leader_origin', citycode: activeCitycode });
    gesture = { kind: 'origin', pointerId: event.pointerId, rect, mesh, geometry, latest: snapped.origin,
      baseline: { value: record.acknowledged, revision: settingsClient.getSnapshot().revision } };
    doc.addEventListener?.('pointermove', moveGesture); doc.addEventListener?.('pointerup', endGesture); doc.addEventListener?.('pointercancel', cancelGesture);
  }
  function moveGesture(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const outputReference = referenceFor(event, gesture.rect, gesture.mesh);
    if (gesture.kind === 'origin') {
      const snapped = outputReference && snapSettlementOrigin(outputReference, gesture.geometry.worldRings, gesture.geometry.projectedRings);
      if (!snapped) { cancelGesture(event); return; }
      gesture.latest = snapped.origin;
      publish();
      return;
    }
    const reference = outputReference && mapSettlementPosition(outputReference,gesture.positionMatrix,true);
    if (!reference) { showMapping("Mapping unavailable"); cancelGesture(event); return; }
    gesture.latest = { x: gesture.origin.x + (reference.x - gesture.start.x), y: gesture.origin.y + (reference.y - gesture.start.y) };
    if (scheduledFrame != null) return;
    const request = win?.requestAnimationFrame?.bind(win) || ((callback) => callback());
    scheduledFrame = request(() => { scheduledFrame = null; publish(); drawOverlay(); });
  }
  function release(event) {
    doc.removeEventListener?.("pointermove", moveGesture);
    doc.removeEventListener?.("pointerup", endGesture);
    doc.removeEventListener?.("pointercancel", cancelGesture);
    if (scheduledFrame != null && win?.cancelAnimationFrame) win.cancelAnimationFrame(scheduledFrame);
    scheduledFrame = null;
    if (event) event.pointerId = event.pointerId;
  }
  function endGesture(event) {
    if (!gesture || event?.pointerId !== gesture.pointerId) return;
    moveGesture(event);
    const completed = gesture;
    gesture = null;
    release();
    if (!completed?.latest) return;
    if (completed.kind === 'origin') void settingsClient.commit({ kind: 'leader_origin', citycode: activeCitycode }, completed.latest, { baseline: completed.baseline }).catch(() => {});
    else void settingsClient.commit({ kind: "position", output: activeOutput, citycode: activeCitycode }, { x: completed.latest.x, y: completed.latest.y }).catch(() => {});
    publish();
  }
  function cancelGesture(event) {
    if (!gesture || (event?.pointerId != null && event.pointerId !== gesture.pointerId)) return;
    gesture = null;
    release();
    publish();
    drawOverlay();
  }
  function invalidate() {
    if (gesture) cancelGesture({ pointerId: gesture.pointerId });
    handlesEnabled = false;
    mesh = null;
    positionMatrix = null;
    originGeometry = null;
    labels = [];
    drawOverlay();
    preview?.reload({ output: activeOutput });
    fitPreview();
  }
  function onRendered(result) {
    if (!active) return;
    mesh = result.mesh;
    positionMatrix = result.positionMatrix || null;
    originGeometry = result.originGeometry?.citycode === activeCitycode ? result.originGeometry : null;
    labels = result.labels || [];
    handlesEnabled = true;
    retry.hidden = true;
    warning.hidden = !warningText(result.warnings);
    warning.textContent = warningText(result.warnings);
    renderControls();
    drawOverlay();
    fitPreview();
  }
  preview = mountSettlementNamePreview({
    container: previewHost,
    output: activeOutput,
    sessionId: createUuid(),
    onRendered,
    onError: (error) => { handlesEnabled = false; retry.hidden = false; showMapping(error?.message || "Preview unavailable"); drawOverlay(); },
  });
  const unsubscribe = settingsClient.subscribe?.(() => { if (active) renderControls(); });
  let lastNameLanguage = getNameLanguage();
  const unsubscribeLanguage = subscribeNameLanguage?.(() => {
    const language = getNameLanguage();
    if (active && language !== lastNameLanguage) { lastNameLanguage = language; publish(); }
  });
  const onResize = () => invalidate();
  win?.addEventListener?.("resize", onResize);
  retry.addEventListener("click", () => invalidate());
  closeButton.addEventListener("click", close);
  dialog.addEventListener("keydown", (event) => { if (event.key === "Escape") { event.preventDefault?.(); if (controls.hasPending()) controls.cancel(); else close(); } });
  const beforeUnload = (event) => { if (settingsClient.hasUnsavedWork?.()) { event.preventDefault?.(); event.returnValue = ""; } };
  if (manageBeforeUnload) win?.addEventListener?.("beforeunload", beforeUnload);
  publish();
  fitPreview();

  function setSelection({ output: nextOutput, citycode: nextCitycode } = {}) {
    if (!finishPendingEdit()) return false;
    const outputChanged = nextOutput && nextOutput !== activeOutput;
    const cityChanged = nextCitycode && nextCitycode !== activeCitycode;
    if (nextOutput === "left" || nextOutput === "right") activeOutput = nextOutput;
    if (typeof nextCitycode === "string" && nextCitycode) activeCitycode = nextCitycode;
    if (gesture) cancelGesture({ pointerId: gesture.pointerId });
    if (cityChanged) { originGeometry = null; drawOverlay(); }
    renderControls();
    if (outputChanged) invalidate();
    else publish();
    return true;
  }
  function finishPendingEdit() {
    if (controls.isHeld()) return false;
    return controls.finish().every(result => result.kind === "commit" || result.kind === "unchanged");
  }
  function close({ force = false } = {}) {
    if (!active) return;
    if (!force && !finishPendingEdit()) return false;
    controls.cancel();
    controls.dispose();
    active = false;
    if (gesture) cancelGesture({ pointerId: gesture.pointerId });
    unsubscribe?.();
    unsubscribeLanguage?.();
    win?.removeEventListener?.("resize", onResize);
    if (manageBeforeUnload) win?.removeEventListener?.("beforeunload", beforeUnload);
    preview?.destroy();
    preview = null;
    dialog.remove?.();
    if (restoreFocus) restoreFocus()?.focus?.();
    else opener?.focus?.();
    onClose();
    return true;
  }
  return { close, setSelection, setCatalog, finishPendingEdit, hasPendingEdit: controls.hasPending, isHeld: controls.isHeld, cancelPendingEdit: controls.cancel,
    dispose() { close({ force: true }); }, calibrationChanged() { invalidate(); } };
}
