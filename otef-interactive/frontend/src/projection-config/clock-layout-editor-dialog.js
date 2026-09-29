import { createUuid } from "../shared/uuid.js";
import { mapOverlayOutline, mapOutputToSourceUv, mapSourceUvToOutput, moveLayout, resizeClockLayout, resizeLegendLayout, copyProjectionMesh } from "./clock-layout-geometry.js";
import { mountClockLayoutPreview } from "./clock-layout-preview.js";
import { GIS_SLOT, GIS_LABEL, resourceFor, layoutFor, layoutFieldEdit, createClockLayoutParameters, createClockLayoutStatus } from "./clock-layout-controls.js";

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

function outputPoint(event, rect) {
  const scale = Math.min(rect.width / 1920, rect.height / 1080);
  const width = scale * 1920; const height = scale * 1080;
  const left = rect.left + (rect.width - width) / 2; const top = rect.top + (rect.height - height) / 2;
  return { x: (event.clientX - left) / width * 1920, y: (event.clientY - top) / height * 1080 };
}

function sourcePoint(surface, mesh, point) {
  if (surface === "gis") return { u: point.x / 1920, v: point.y / 1080 };
  return mapOutputToSourceUv(mesh, { x: point.x / 1920, y: point.y / 1080 });
}

function referencePoint(surface, point) {
  return surface === "projection" ? { x: point.x * 1920, y: point.y * 1080 } : point;
}

export function openClockLayoutEditor({ nodeId, sceneId = "home", element = "clock", layoutClient, document = globalThis.document, onShowOnExhibit = null, onPendingState = () => {}, onSelection = () => {}, restoreFocus, manageBeforeUnload = true, onClose = () => {} } = {}) {
  const doc = document;
  if (!doc?.createElement || !layoutClient) throw new Error("Clock layout editor requires a document and layout client");
  let activeScene = GIS_SLOT[sceneId] ? sceneId : "home";
  let activeElement = element === "legend" ? "legend" : "clock";
  let activeNode = nodeId === "clock-projection" ? "clock-projection" : "clock-gis";
  let selection = resourceFor(activeNode, activeScene, activeElement);
  let currentLayout = layoutFor(layoutClient, selection).layout;
  let active = true;
  let handlesEnabled = false;
  let gesture = null;
  let mesh = null;
  let meshIdentity = null;
  let preview = null;
  let pageCount = 1;
  let scheduledFrame = null;
  let previewHealth = "Loading";
  let previewError = "";
  const watched = new Set();
  const win = doc.defaultView || globalThis.window;
  const opener = doc.activeElement;
  let inertSiblings = [];
  let beforeUnloadAttached = false;
  const beforeUnload = (event) => {
    const pending = [...watched].some((key) => { const [resource, slot] = key.split(":"); return layoutClient.getSlot(resource, slot)?.status !== "Saved"; });
    if (pending) { event.preventDefault?.(); event.returnValue = ""; }
  };

  const dialog = make(doc, "section", { className: "clock-layout-dialog", role: "dialog", ariaLabel: "Clock and legend layout editor", tabIndex: -1 });
  dialog.setAttribute?.("aria-modal", "true");
  const header = make(doc, "header", { className: "clock-layout-header" });
  const title = make(doc, "h2", {}, selection.label);
  const closeButton = make(doc, "button", { type: "button", className: "clock-layout-close", ariaLabel: "Close editor" }, "Close");
  const statusControls = createClockLayoutStatus(doc, {
    onRetry: () => { void (editable() ? layoutClient.retry(selection.resource, selection.slot) : layoutClient.hydrate({ forceFresh: true })).catch(() => {}); },
    onLoad: () => { layoutClient.loadSaved(selection.resource, selection.slot); currentLayout = layoutFor(layoutClient, selection).layout; renderControls(); updatePreview(); },
  });
  header.append(title, statusControls.element, closeButton);
  const body = make(doc, "div", { className: "clock-layout-body" });
  const stage = make(doc, "div", { className: "clock-layout-stage" });
  const referencePlane = make(doc, "div", { className: "clock-layout-reference-plane" });
  const previewHost = make(doc, "div", { className: "clock-layout-preview-host" });
  const overlay = doc.createElementNS?.("http://www.w3.org/2000/svg", "svg") || make(doc, "svg");
  overlay.setAttribute?.("viewBox", "0 0 1920 1080");
  overlay.setAttribute?.("preserveAspectRatio", "xMidYMid meet");
  overlay.setAttribute?.("aria-label", "Layout preview handles");
  overlay.classList?.add?.("clock-layout-overlay");
  referencePlane.append(previewHost, overlay); stage.appendChild(referencePlane);
  const previewStatus = make(doc, "p", { className: "clock-layout-preview-status", role: "status" }, "Loading preview");
  const previewRetry = make(doc, "button", { type: "button", className: "clock-layout-preview-retry", hidden: true }, "Retry preview");
  const mappingStatus = make(doc, "p", { className: "clock-layout-mapping-status", role: "status", hidden: true });
  stage.append(previewStatus, previewRetry, mappingStatus);
  const warningStatus = make(doc, "p", { className: "clock-layout-warning", role: "status", hidden: true });
  const panel = make(doc, "section", { className: "clock-layout-parameters", ariaLabel: "Layout parameters" });
  const sceneLabel = make(doc, "label", { className: "clock-layout-selection clock-layout-scene" }, "GIS scene");
  const sceneSelect = make(doc, "select", { ariaLabel: "GIS clock preview scene" });
  for (const [value, label] of Object.entries(GIS_LABEL)) sceneSelect.appendChild(make(doc, "option", { value }, label));
  sceneLabel.appendChild(sceneSelect);
  sceneSelect.addEventListener("click", (event) => event.stopPropagation?.());
  const elementLabel = make(doc, "label", { className: "clock-layout-selection clock-layout-element" }, "Projection component");
  const elementSelect = make(doc, "select", { ariaLabel: "Projection overlay" });
  elementSelect.append(make(doc, "option", { value: "clock" }, "Clock"), make(doc, "option", { value: "legend" }, "Legend"));
  elementLabel.appendChild(elementSelect);
  elementSelect.addEventListener("click", (event) => event.stopPropagation?.());
  sceneSelect.addEventListener("change", () => { setSelection({ nodeId: "clock-gis", sceneId: sceneSelect.value, element: activeElement }); onSelection({ nodeId: activeNode, sceneId: activeScene, element: activeElement }); });
  elementSelect.addEventListener("change", () => { setSelection({ nodeId: "clock-projection", sceneId: activeScene, element: elementSelect.value }); onSelection({ nodeId: activeNode, sceneId: activeScene, element: activeElement }); });
  const parameters = createClockLayoutParameters(doc, { onField: commitField });
  const { controls, advanced } = parameters;
  const pages = make(doc, "label", { className: "clock-layout-page-label" }, "Legend page");
  const pageSelect = make(doc, "select", { className: "clock-layout-pages", ariaLabel: "Legend preview page" });
  pages.appendChild(pageSelect); pages.hidden = true;
  pageSelect.addEventListener("click", (event) => event.stopPropagation?.());
  pageSelect.addEventListener("change", () => { pageIndex = Number(pageSelect.value); updatePreview(); });
  let pageIndex = 0;
  panel.append(sceneLabel, elementLabel, parameters.element, pages, warningStatus);
  const exhibitButton = make(doc, "button", { type: "button", className: "clock-layout-show-exhibit" }, "Show on exhibit");
  const exhibitStatus = make(doc, "p", { className: "clock-layout-exhibit-status", role: "status", ariaLive: "polite" });
  exhibitButton.hidden = activeNode !== "clock-gis" || typeof onShowOnExhibit !== "function";
  exhibitButton.addEventListener("click", async () => {
    exhibitButton.disabled = true; exhibitStatus.textContent = "Applying scene…";
    try { await onShowOnExhibit(activeScene); exhibitStatus.textContent = "Scene acknowledged"; }
    catch (error) { exhibitStatus.textContent = error?.message || "Scene was not confirmed"; }
    finally { exhibitButton.disabled = false; }
  });
  panel.append(exhibitButton, exhibitStatus);
  body.append(stage, panel);
  dialog.append(header, body);
  doc.body?.appendChild(dialog);
  inertSiblings = [...(doc.body?.children || [])].filter((node) => node !== dialog).map((node) => ({ node, inert: node.inert }));
  inertSiblings.forEach(({ node }) => { node.inert = true; });
  closeButton.focus?.();
  const svgElement = (tag, props = {}) => {
    const item = doc.createElementNS?.("http://www.w3.org/2000/svg", tag) || make(doc, tag);
    for (const [key, value] of Object.entries(props)) item.setAttribute?.(key, String(value));
    return item;
  };

  function activeRecord() { return layoutClient.getSlot(selection.resource, selection.slot); }
  function hydrationState() { return layoutClient.getHydrationState?.() || { status: "Saved" }; }
  function editable() { return hydrationState().status === "Saved"; }
  function isLegend() { return selection.resource === "projectionLegend"; }
  function previewLayouts() {
    const clock = layoutFor(layoutClient, resourceFor(activeNode, activeScene, "clock"));
    const legend = layoutFor(layoutClient, resourceFor("clock-projection", "home", "legend"));
    return { clockLayout: isLegend() ? clock.layout : currentLayout, legendLayout: isLegend() ? currentLayout : legend.layout };
  }
  function updateBeforeUnload() {
    const pending = [...watched].some((key) => {
      const [resource, slot] = key.split(":");
      return layoutClient.getSlot(resource, slot)?.status !== "Saved";
    });
    if (manageBeforeUnload && pending && !beforeUnloadAttached) { win?.addEventListener?.("beforeunload", beforeUnload); beforeUnloadAttached = true; }
    else if (!pending && beforeUnloadAttached) { win?.removeEventListener?.("beforeunload", beforeUnload); beforeUnloadAttached = false; }
    onPendingState(pending);
  }
  function markWatched() { watched.add(`${selection.resource}:${selection.slot}`); updateBeforeUnload(); }
  function publishState() {
    if (!preview || !active) return;
    const layouts = previewLayouts();
    preview.setState({ surface: selection.surface, sceneId: selection.sceneId, output: selection.surface === "projection" ? "left" : null,
      element: selection.surface === "projection" ? activeElement : "clock", clockLayout: layouts.clockLayout,
      legendLayout: selection.surface === "projection" ? layouts.legendLayout : null, pageIndex: selection.surface === "projection" ? pageIndex : 0 });
  }
  function renderControls(record = activeRecord()) {
    const hydration = hydrationState();
    statusControls.render(record, hydration);
    parameters.render(currentLayout, { enabled: editable(), legend: isLegend() });
    sceneLabel.hidden = activeNode !== "clock-gis";
    elementLabel.hidden = activeNode !== "clock-projection";
    sceneSelect.value = activeScene;
    elementSelect.value = activeElement;
    pages.hidden = !isLegend() || pageCount <= 1;
    pageSelect.replaceChildren?.(...Array.from({ length: pageCount }, (_, index) => make(doc, "option", { value: String(index) }, `Page ${index + 1}`)));
    pageSelect.value = String(Math.min(pageIndex, pageCount - 1));
    exhibitButton.hidden = activeNode !== "clock-gis" || typeof onShowOnExhibit !== "function";
    title.textContent = selection.label;
    previewStatus.textContent = previewHealth === "Failed" ? `Preview unavailable: ${previewError}` : "Loading preview";
    previewStatus.hidden = previewHealth === "Ready";
    previewRetry.hidden = previewHealth !== "Failed";
    updateBeforeUnload();
  }
  function drawOverlay() {
    overlay.replaceChildren?.();
    fitPreview();
    if (!active || !handlesEnabled || !currentLayout || !editable()) return;
    const bodyHit = svgElement("rect", { x: 0, y: 0, width: 1920, height: 1080, class: "clock-layout-body-hit", "data-gesture": "body" });
    bodyHit.addEventListener("pointerdown", beginGesture); overlay.appendChild(bodyHit);
    const edges = selection.surface === "projection" ? mapOverlayOutline(mesh, currentLayout) : null;
    const lines = edges || (() => {
      const angle = currentLayout.rotateDeg * Math.PI / 180; const c = Math.cos(angle); const s = Math.sin(angle);
      const cx = (currentLayout.leftPct + currentLayout.widthPct / 2) * 19.2; const cy = (currentLayout.topPct + currentLayout.heightPct / 2) * 10.8;
      const coords = [[-currentLayout.widthPct * 9.6, -currentLayout.heightPct * 5.4], [currentLayout.widthPct * 9.6, -currentLayout.heightPct * 5.4], [currentLayout.widthPct * 9.6, currentLayout.heightPct * 5.4], [-currentLayout.widthPct * 9.6, currentLayout.heightPct * 5.4]];
      const points = coords.map(([x, y]) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c }));
      return points.map((start, index) => ({ start, end: points[(index + 1) % 4] }));
    })();
    for (const edge of lines) {
      const start = referencePoint(selection.surface, edge.start);
      const end = referencePoint(selection.surface, edge.end);
      const d = `M${start.x} ${start.y} L${end.x} ${end.y}`;
      overlay.appendChild(svgElement("path", { d, class: "clock-layout-outline" }));
      const hit = svgElement("path", { d, class: "clock-layout-hit", "data-gesture": "move" });
      hit.addEventListener("pointerdown", beginGesture); overlay.appendChild(hit);
    }
    const corners = [
      { u: 0, v: 0, name: "top-left" }, { u: 1, v: 0, name: "top-right" }, { u: 1, v: 1, name: "bottom-right" }, { u: 0, v: 1, name: "bottom-left" },
    ].map(({ u, v, name }) => {
      const rad = currentLayout.rotateDeg * Math.PI / 180; const x = (currentLayout.leftPct + (u ? currentLayout.widthPct : 0)) / 100; const y = (currentLayout.topPct + (v ? currentLayout.heightPct : 0)) / 100;
      const cx = (currentLayout.leftPct + currentLayout.widthPct / 2) / 100; const cy = (currentLayout.topPct + currentLayout.heightPct / 2) / 100;
      const px = (x - cx) * 1920; const py = (y - cy) * 1080;
      const uv = { u: cx + (px * Math.cos(rad) - py * Math.sin(rad)) / 1920, v: cy + (px * Math.sin(rad) + py * Math.cos(rad)) / 1080 };
      const out = selection.surface === "projection" ? mapSourceUvToOutput(mesh, uv) : { x: uv.u * 1920, y: uv.v * 1080 };
      return out ? { ...referencePoint(selection.surface, out), name } : null;
    }).filter(Boolean);
    for (const corner of corners) {
      const point = svgElement("circle", { cx: corner.x, cy: corner.y, r: 14, class: "clock-layout-handle", "data-gesture": "resize", "data-corner": corner.name, "aria-label": `Resize from ${corner.name}` });
      point.addEventListener("pointerdown", beginGesture); overlay.appendChild(point);
    }
  }
  function updatePreview() { drawOverlay(); publishState(); }
  function fitPreview() {
    const rect = gesture?.rect || stage.getBoundingClientRect();
    const scale = Math.min(rect.width / 1920, rect.height / 1080);
    referencePlane.style.transform = `translate(${(rect.width - 1920 * scale) / 2}px, ${(rect.height - 1080 * scale) / 2}px) scale(${scale})`;
  }
  function commitLayout(next, numeric = false, target = selection) {
    currentLayout = structuredClone(next);
    markWatched(); renderControls(); updatePreview();
    Promise.resolve(layoutClient.commit(target.resource, target.slot, structuredClone(next), numeric ? { numeric: true } : {})).catch(() => {});
  }
  function commitField(key, raw) {
    if (!editable()) return;
    const next = layoutFieldEdit(currentLayout, key, raw);
    if (!next) { renderControls(); return; }
    commitLayout(next, true);
  }
  function reloadPreview() {
    if (gesture) cancelGesture();
    handlesEnabled = false; mesh = null; meshIdentity = null; previewHealth = "Loading"; previewError = "";
    renderControls(); drawOverlay(); preview?.reload();
  }
  previewRetry.addEventListener("click", reloadPreview);

  function beginGesture(event) {
    if (!handlesEnabled || !editable() || gesture || event.button !== 0) return;
    event.preventDefault?.();
    const rect = stage.getBoundingClientRect();
    const frozenMesh = selection.surface === "projection" ? copyProjectionMesh(mesh) : null;
    const point = outputPoint(event, rect);
    const source = sourcePoint(selection.surface, frozenMesh, point);
    if (!source) { mappingStatus.textContent = "Mapping unavailable or ambiguous; use numeric parameters"; mappingStatus.hidden = false; return; }
    mappingStatus.hidden = true;
    if (event.currentTarget?.dataset?.gesture === "body") {
      const dx = source.u * 1920 - (currentLayout.leftPct + currentLayout.widthPct / 2) * 19.2;
      const dy = source.v * 1080 - (currentLayout.topPct + currentLayout.heightPct / 2) * 10.8;
      const angle = currentLayout.rotateDeg * Math.PI / 180;
      const x = dx * Math.cos(angle) + dy * Math.sin(angle);
      const y = -dx * Math.sin(angle) + dy * Math.cos(angle);
      if (Math.abs(x) > currentLayout.widthPct * 9.6 || Math.abs(y) > currentLayout.heightPct * 5.4) return;
    }
    const record = activeRecord();
    gesture = { pointerId: event.pointerId, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, mesh: frozenMesh,
      meshIdentity, orientation: win?.screen?.orientation?.type || "", start: source, startLayout: structuredClone(currentLayout), latestLayout: structuredClone(currentLayout),
      corner: event.currentTarget?.dataset?.gesture === "resize" ? event.currentTarget.dataset.corner : null,
      resource: selection.resource, slot: selection.slot, baseline: structuredClone(record?.acknowledged ?? null) };
    const ownerDoc = doc;
    ownerDoc.addEventListener?.("pointermove", moveGesture);
    ownerDoc.addEventListener?.("pointerup", endGesture);
    ownerDoc.addEventListener?.("pointercancel", cancelGesture);
  }
  function calculateGesture(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const point = outputPoint(event, gesture.rect);
    const source = sourcePoint(selection.surface, gesture.mesh, point);
    if (!source) {
      cancelGesture();
      mappingStatus.textContent = "Mapping unavailable or ambiguous; gesture canceled"; mappingStatus.hidden = false;
      return;
    }
    const delta = { x: (source.u - gesture.start.u) * 1920, y: (source.v - gesture.start.v) * 1080 };
    const next = gesture.corner
      ? (gesture.resource === "projectionLegend" ? resizeLegendLayout(gesture.startLayout, gesture.corner, delta) : resizeClockLayout(gesture.startLayout, gesture.corner, delta))
      : moveLayout(gesture.startLayout, delta);
    gesture.latestLayout = next;
    currentLayout = structuredClone(next);
    if (scheduledFrame != null) return;
    const requestFrame = win?.requestAnimationFrame?.bind(win) || ((callback) => setTimeout(callback, 0));
    scheduledFrame = requestFrame(() => { scheduledFrame = null; renderControls(); updatePreview(); });
  }
  function moveGesture(event) { calculateGesture(event); }
  function releaseGestureListeners() {
    doc.removeEventListener?.("pointermove", moveGesture); doc.removeEventListener?.("pointerup", endGesture); doc.removeEventListener?.("pointercancel", cancelGesture);
  }
  function endGesture(event) {
    if (!gesture || event?.pointerId !== gesture.pointerId) return;
    calculateGesture(event);
    if (!gesture) return;
    const completed = gesture; gesture = null; releaseGestureListeners();
    if (scheduledFrame != null) { (win?.cancelAnimationFrame || clearTimeout)(scheduledFrame); scheduledFrame = null; }
    currentLayout = structuredClone(completed.latestLayout);
    const target = { resource: completed.resource, slot: completed.slot };
    markWatched(); renderControls(); updatePreview();
    Promise.resolve(layoutClient.commit(target.resource, target.slot, structuredClone(currentLayout), { baseline: { layout: completed.baseline } })).catch(() => {});
  }
  function cancelGesture(event) {
    if (!gesture || (event?.pointerId != null && event.pointerId !== gesture.pointerId)) return;
    const canceled = gesture; gesture = null; releaseGestureListeners();
    if (scheduledFrame != null) { (win?.cancelAnimationFrame || clearTimeout)(scheduledFrame); scheduledFrame = null; }
    currentLayout = structuredClone(canceled.startLayout); renderControls(); updatePreview();
  }
  overlay.addEventListener("pointercancel", cancelGesture);

  function handleRendered(result) {
    if (!active) return;
    if (selection.surface === "projection") {
      if (meshIdentity && result.meshIdentity !== meshIdentity) cancelGesture();
      mesh = copyProjectionMesh(result.mesh); meshIdentity = result.meshIdentity;
      pageCount = result.pageCount; pageIndex = result.pageIndex;
      handlesEnabled = true;
    } else { pageCount = 1; pageIndex = 0; handlesEnabled = true; }
    previewHealth = "Ready"; previewError = "";
    const warnings = result.warnings;
    warningStatus.textContent = [warnings?.clipped ? "Content clipped" : "", warnings?.outOfView ? "Box partly outside the output" : "",
      warnings?.mapping === "partial" ? "Projection mapping is partial" : warnings?.mapping === "unavailable" ? "Projection mapping unavailable" : ""].filter(Boolean).join(". ");
    warningStatus.hidden = !warningStatus.textContent;
    renderControls(); drawOverlay();
  }
  function createPreview() {
    preview?.destroy(); mesh = null; meshIdentity = null; handlesEnabled = false;
    previewHealth = "Loading"; previewError = "";
    preview = mountClockLayoutPreview({ container: previewHost, surface: selection.surface, sessionId: createUuid(), onRendered: handleRendered,
      onError: (error) => { if (gesture) cancelGesture(); previewHealth = "Failed"; previewError = error.message; handlesEnabled = false; renderControls(); drawOverlay(); } });
    renderControls(); fitPreview();
  }
  function setSelection(next = {}) {
    if (gesture) cancelGesture();
    activeNode = next.nodeId === "clock-projection" ? "clock-projection" : "clock-gis";
    if (GIS_SLOT[next.sceneId]) activeScene = next.sceneId;
    if (next.element === "clock" || next.element === "legend") activeElement = next.element;
    selection = resourceFor(activeNode, activeScene, activeElement);
    currentLayout = layoutFor(layoutClient, selection).layout;
    exhibitStatus.textContent = ""; pageCount = 1; pageIndex = 0;
    exhibitButton.hidden = activeNode !== "clock-gis" || typeof onShowOnExhibit !== "function";
    renderControls();
    if (!preview || (previewSurface !== selection.surface)) { previewSurface = selection.surface; createPreview(); }
    publishState(); drawOverlay();
  }
  let previewSurface = selection.surface;
  closeButton.addEventListener("click", close);
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault?.(); close(); return; }
    if (event.key !== "Tab") return;
    const available = (node) => {
      if (node.disabled) return false;
      for (let parent = node; parent && parent !== dialog; parent = parent.parentElement) {
        if (parent.hidden || (parent === advanced && !advanced.open && node.tagName !== "SUMMARY")) return false;
      }
      return true;
    };
    const focusables = [...(dialog.querySelectorAll?.("button, input, select, summary") ||
      [statusControls.element.children[1], statusControls.element.children[2], closeButton, previewRetry, sceneSelect, elementSelect, ...controls.values(), advanced.children[0], pageSelect, exhibitButton])].filter(available);
    const first = focusables[0]; const last = focusables.at(-1);
    if (!focusables.length) { event.preventDefault?.(); dialog.focus?.(); return; }
    if (event.shiftKey && (doc.activeElement === first || !focusables.includes(doc.activeElement))) { event.preventDefault?.(); last.focus?.(); }
    else if (!event.shiftKey && (doc.activeElement === last || !focusables.includes(doc.activeElement))) { event.preventDefault?.(); first.focus?.(); }
  });
  function close() {
    if (!active) return;
    if (gesture) cancelGesture();
    active = false; preview?.destroy(); preview = null;
    dialog.remove?.();
    inertSiblings.forEach(({ node, inert }) => { node.inert = inert; }); inertSiblings = [];
    if (restoreFocus) restoreFocus()?.focus?.();
    else opener?.focus?.();
    unsubscribe?.();
    updateBeforeUnload();
    onClose();
  }
  const unsubscribe = layoutClient.subscribe?.(() => {
    if (!active) return;
    const record = activeRecord();
    if (!gesture) currentLayout = structuredClone(record?.draft || record?.acknowledged || selection.fallback);
    renderControls(record); updatePreview();
  }) || (() => {});
  const pendingUnsubscribe = layoutClient.subscribe?.(updateBeforeUnload) || (() => {});
  const onResize = () => { if (active) { reloadPreview(); fitPreview(); } };
  const resizeObserver = win?.ResizeObserver ? new win.ResizeObserver(onResize) : null;
  resizeObserver?.observe(stage);
  win?.addEventListener?.("resize", onResize);
  win?.addEventListener?.("orientationchange", onResize);
  renderControls(); createPreview(); publishState();
  return {
    close,
    setSelection,
    calibrationChanged: reloadPreview,
    dispose() { close(); resizeObserver?.disconnect(); pendingUnsubscribe(); win?.removeEventListener?.("resize", onResize); win?.removeEventListener?.("orientationchange", onResize); win?.removeEventListener?.("beforeunload", beforeUnload); beforeUnloadAttached = false; onPendingState(false); },
  };
}
