import { createUuid } from "../shared/uuid.js";
import { normalizeNovaExplainerMaps } from "../shared/nli-nova-explainer-layout.js";
import { mountClockLayoutPreview } from "./clock-layout-preview.js";
import { createClockLayoutStatus, layoutFor, resourceFor } from "./clock-layout-controls.js";

const CLOCK_KEYS = ["leftPct", "topPct", "widthPct", "heightPct", "fontPx", "rotateDeg"];

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
  const width = scale * 1920;
  const height = scale * 1080;
  const left = rect.left + (rect.width - width) / 2;
  const top = rect.top + (rect.height - height) / 2;
  return { x: (event.clientX - left) / width * 1920, y: (event.clientY - top) / height * 1080 };
}

function clampPercent(value) {
  return Math.min(100, Math.max(0, value));
}

function svgElement(doc, tag, props = {}) {
  const item = doc.createElementNS?.("http://www.w3.org/2000/svg", tag) || make(doc, tag);
  for (const [key, value] of Object.entries(props)) item.setAttribute?.(key, String(value));
  return item;
}

export function openNovaExplainerEditor({ layoutClient, document = globalThis.document, onPendingState = () => {}, restoreFocus, manageBeforeUnload = true, onClose = () => {} } = {}) {
  const doc = document;
  if (!doc?.createElement || !layoutClient) throw new Error("Nova explainer editor requires a document and layout client");
  const win = doc.defaultView || globalThis.window;
  const opener = doc.activeElement;
  let camera = "close";
  let selectedId = "";
  let active = true;
  let gesture = null;
  let preview = null;
  let previewHealth = "Loading";
  let previewError = "";
  let renderedCards = [];
  let beforeUnloadAttached = false;
  let localLayout = readDocument();
  let previewSerial = 0;
  const beforeUnload = (event) => {
    if (unsaved()) { event.preventDefault?.(); event.returnValue = ""; }
  };

  const dialog = make(doc, "section", { className: "clock-layout-dialog nova-explainer-dialog", role: "dialog", ariaLabel: "Nova explainer editor", tabIndex: -1 });
  dialog.setAttribute?.("aria-modal", "true");
  const header = make(doc, "header", { className: "clock-layout-header" });
  const title = make(doc, "h2", {}, "Nova explainers");
  const closeButton = make(doc, "button", { type: "button", className: "clock-layout-close", ariaLabel: "Close editor" }, "Close");
  const statusControls = createClockLayoutStatus(doc, { onRetry: retry, onLoad: loadSaved });
  header.append(title, statusControls.element, closeButton);
  const body = make(doc, "div", { className: "clock-layout-body" });
  const stage = make(doc, "div", { className: "clock-layout-stage" });
  const referencePlane = make(doc, "div", { className: "clock-layout-reference-plane" });
  const previewHost = make(doc, "div", { className: "clock-layout-preview-host" });
  const overlay = svgElement(doc, "svg", { viewBox: "0 0 1920 1080", preserveAspectRatio: "xMidYMid meet", class: "clock-layout-overlay", "aria-label": "Nova explainer handles" });
  referencePlane.append(previewHost, overlay);
  stage.appendChild(referencePlane);
  const previewStatus = make(doc, "p", { className: "clock-layout-preview-status", role: "status" }, "Loading preview");
  const previewRetry = make(doc, "button", { type: "button", className: "clock-layout-preview-retry", hidden: true }, "Retry preview");
  stage.append(previewStatus, previewRetry);
  const panel = make(doc, "section", { className: "clock-layout-parameters", ariaLabel: "Nova explainer positions" });
  const cameras = make(doc, "div", { className: "nova-explainer-cameras", role: "group", ariaLabel: "Explainer camera" });
  const closeCamera = make(doc, "button", { type: "button", dataset: { camera: "close" } }, "Close");
  const wideCamera = make(doc, "button", { type: "button", dataset: { camera: "wide" } }, "Wide");
  cameras.append(closeCamera, wideCamera);
  const nameLabel = make(doc, "label", { className: "clock-layout-selection" }, "Story card");
  const names = make(doc, "select", { className: "nova-explainer-names", ariaLabel: "Nova explainer card" });
  names.setAttribute?.("dir", "auto");
  nameLabel.appendChild(names);
  const xInput = axisField("X", "leftPct");
  const yInput = axisField("Y", "topPct");
  const resetButton = make(doc, "button", { type: "button", className: "nova-explainer-reset", dataset: { action: "nova-explainer-reset" } }, "Reset position");
  const note = make(doc, "p", { className: "clock-layout-autosave-note" }, "Position edits save automatically for the selected camera.");
  panel.append(cameras, nameLabel, xInput.label, yInput.label, resetButton, note);
  body.append(stage, panel);
  dialog.append(header, body);
  doc.body?.appendChild(dialog);
  let inertSiblings = [...(doc.body?.children || [])].filter((node) => node !== dialog).map((node) => ({ node, inert: node.inert }));
  inertSiblings.forEach(({ node }) => { node.inert = true; });
  closeButton.focus?.();

  function axisField(label, field) {
    const wrap = make(doc, "label", { className: "clock-layout-field" }, label);
    const input = make(doc, "input", { type: "number", min: "0", max: "100", step: "0.1", inputMode: "decimal", dataset: { field }, ariaLabel: label });
    wrap.append(input, make(doc, "span", { className: "clock-layout-unit" }, "%"));
    input.addEventListener("click", (event) => event.stopPropagation?.());
    input.addEventListener("change", () => commitAxis(field, input.value));
    return { label: wrap, input };
  }
  function readDocument() {
    const record = layoutClient.getSlot?.("gisNovaExplainers", "novaExplainers");
    return normalizeNovaExplainerMaps(record?.draft || record?.acknowledged || { close: {}, wide: {} });
  }
  function unsaved() {
    const record = layoutClient.getSlot?.("gisNovaExplainers", "novaExplainers");
    return Boolean(record?.status && record.status !== "Saved");
  }
  function boxFor(id) {
    return renderedCards.find((card) => String(card.objectId) === id)?.box || null;
  }
  function clockRectangle() {
    const selection = resourceFor("clock-gis", "nova");
    const layout = layoutFor(layoutClient, selection).layout;
    if (layout && CLOCK_KEYS.every((key) => Number.isFinite(layout[key])) && layout.widthPct > 0 && layout.heightPct > 0 && layout.fontPx > 0) return layout;
    return selection.fallback;
  }
  function updateBeforeUnload() {
    const pending = unsaved();
    if (manageBeforeUnload && pending && !beforeUnloadAttached) { win?.addEventListener?.("beforeunload", beforeUnload); beforeUnloadAttached = true; }
    else if ((!pending || !manageBeforeUnload) && beforeUnloadAttached) { win?.removeEventListener?.("beforeunload", beforeUnload); beforeUnloadAttached = false; }
    onPendingState(pending);
  }
  function renderChrome() {
    const record = layoutClient.getSlot?.("gisNovaExplainers", "novaExplainers");
    statusControls.render(record, layoutClient.getHydrationState?.() || { status: "Saved" });
    closeCamera.setAttribute?.("aria-pressed", String(camera === "close"));
    wideCamera.setAttribute?.("aria-pressed", String(camera === "wide"));
    previewStatus.textContent = previewHealth === "Failed" ? `Preview unavailable: ${previewError}` : "Loading preview";
    previewStatus.hidden = previewHealth === "Ready";
    previewRetry.hidden = previewHealth !== "Failed";
    const editable = (layoutClient.getHydrationState?.() || { status: "Saved" }).status === "Saved" && previewHealth === "Ready";
    xInput.input.disabled = !editable;
    yInput.input.disabled = !editable;
    resetButton.disabled = !editable || !selectedId;
    updateBeforeUnload();
  }
  function seedFields() {
    if (!selectedId) return;
    const entry = localLayout[camera]?.[selectedId];
    const box = boxFor(selectedId);
    const left = entry?.leftPct ?? box?.leftPct ?? 50;
    const top = entry?.topPct ?? box?.topPct ?? 50;
    if (doc.activeElement !== xInput.input) xInput.input.value = String(left);
    if (doc.activeElement !== yInput.input) yInput.input.value = String(top);
  }
  function displayedOrigin(element, card) {
    const read = (key) => {
      const raw = element?.getAttribute?.(key) ?? element?.attributes?.[key];
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    };
    const x = read("x");
    const y = read("y");
    return {
      leftPct: x == null ? card.box.leftPct : x / 19.2,
      topPct: y == null ? card.box.topPct : y / 10.8,
    };
  }
  function alignHandlesToDocument() {
    for (const card of renderedCards) {
      const entry = localLayout[camera]?.[String(card.objectId)];
      if (!entry || !card.box) continue;
      card.box = { ...card.box, leftPct: entry.leftPct, topPct: entry.topPct };
    }
    drawHandles();
  }
  function acceptCards(cards) {
    renderedCards = Array.isArray(cards) ? cards.map((card) => ({
      ...card,
      box: card.box ? { ...card.box } : card.box,
    })) : [];
    const previous = selectedId;
    names.replaceChildren?.(...renderedCards.map((card) => {
      const option = make(doc, "option", { value: String(card.objectId) });
      option.textContent = `${card.objectId} ${card.name}`;
      option.setAttribute?.("dir", "auto");
      return option;
    }));
    const stillSelected = previous && renderedCards.some((card) => String(card.objectId) === previous);
    if (stillSelected) {
      names.value = previous;
    } else {
      const matched = renderedCards.find((card) => String(card.objectId) === String(names.value));
      const nextId = matched ? String(matched.objectId) : (renderedCards[0] ? String(renderedCards[0].objectId) : "");
      names.value = nextId;
      selectedId = nextId;
    }
    seedFields();
  }
  function drawHandles() {
    overlay.replaceChildren?.();
    fitPreview();
    if (!active || previewHealth !== "Ready") return;
    for (const card of renderedCards) {
      if (!card.box) continue;
      const id = String(card.objectId);
      const live = gesture?.id === id ? gesture.latest?.[camera]?.[id] : null;
      const leftPct = live?.leftPct ?? card.box.leftPct;
      const topPct = live?.topPct ?? card.box.topPct;
      const rect = svgElement(doc, "rect", {
        x: leftPct * 19.2, y: topPct * 10.8, width: card.box.widthPct * 19.2, height: card.box.heightPct * 10.8,
        class: "nova-explainer-card", "data-object-id": id,
      });
      rect.addEventListener("pointerdown", (event) => beginGesture(event, card));
      overlay.appendChild(rect);
    }
  }
  function fitPreview() {
    const rect = stage.getBoundingClientRect?.() || { width: 960, height: 540 };
    const scale = Math.min((rect.width || 0) / 1920, (rect.height || 0) / 1080);
    if (!(scale > 0)) return;
    referencePlane.style.transform = `translate(${(rect.width - 1920 * scale) / 2}px, ${(rect.height - 1080 * scale) / 2}px) scale(${scale})`;
  }
  function publish() {
    previewSerial += 1;
    if (!preview || !active) return;
    preview.setState({
      surface: "gis", sceneId: "nova", output: null, element: "novaExplainers", novaExplainerCamera: camera,
      novaExplainerLayout: normalizeNovaExplainerMaps(localLayout), clockLayout: clockRectangle(), legendLayout: null, pageIndex: 0,
    });
  }
  function commitDocument(numeric) {
    localLayout = normalizeNovaExplainerMaps(localLayout);
    renderChrome();
    return Promise.resolve(layoutClient.commit("gisNovaExplainers", "novaExplainers", structuredClone(localLayout), numeric ? { numeric: true } : {})).catch(() => {});
  }
  function commitAxis(field, raw) {
    if (!selectedId || previewHealth !== "Ready" || (layoutClient.getHydrationState?.() || { status: "Saved" }).status !== "Saved") return;
    if (String(raw).trim() === "" || !Number.isFinite(Number(raw))) { seedFields(); return; }
    const next = structuredClone(localLayout);
    const current = next[camera]?.[selectedId];
    const box = boxFor(selectedId);
    const leftPct = field === "leftPct" ? clampPercent(Number(raw)) : (current?.leftPct ?? box?.leftPct ?? 50);
    const topPct = field === "topPct" ? clampPercent(Number(raw)) : (current?.topPct ?? box?.topPct ?? 50);
    next[camera][selectedId] = { leftPct, topPct };
    localLayout = next;
    const card = renderedCards.find((item) => String(item.objectId) === selectedId);
    if (card?.box) card.box = { ...card.box, leftPct, topPct };
    drawHandles();
    const serial = previewSerial;
    commitDocument(true).finally(() => {
      if (serial !== previewSerial || !active || gesture) return;
      publish();
    });
  }
  function retry() {
    const hydration = layoutClient.getHydrationState?.() || { status: "Saved" };
    const action = hydration.status === "Failed" ? layoutClient.hydrate?.({ forceFresh: true }) : layoutClient.retry?.("gisNovaExplainers", "novaExplainers");
    Promise.resolve(action).then(() => {
      if (!active || gesture) return;
      localLayout = readDocument();
      seedFields();
      publish();
      renderChrome();
    }).catch(() => { if (active) renderChrome(); });
  }
  function loadSaved() {
    if (gesture) cancelGesture();
    layoutClient.loadSaved?.("gisNovaExplainers", "novaExplainers");
    localLayout = readDocument();
    seedFields();
    publish();
    renderChrome();
  }
  function resetSelected() {
    if (gesture) cancelGesture();
    if (!selectedId || previewHealth !== "Ready") return;
    const next = structuredClone(localLayout);
    delete next[camera][selectedId];
    localLayout = next;
    commitDocument(false);
    publish();
    seedFields();
  }
  function setCamera(next) {
    if (next !== "close" && next !== "wide") return;
    if (gesture) cancelGesture();
    if (next === camera) return;
    camera = next;
    previewHealth = "Loading";
    seedFields();
    publish();
    drawHandles();
    renderChrome();
  }
  function releaseGesture() {
    doc.removeEventListener?.("pointermove", moveGesture);
    doc.removeEventListener?.("pointerup", endGesture);
    doc.removeEventListener?.("pointercancel", cancelGesture);
    if (gesture?.element) gesture.element.releasePointerCapture?.(gesture.pointerId);
  }
  function beginGesture(event, card) {
    if (previewHealth !== "Ready" || gesture || event.button !== 0) return;
    if ((layoutClient.getHydrationState?.() || { status: "Saved" }).status !== "Saved") return;
    event.preventDefault?.();
    const id = String(card.objectId);
    selectedId = id;
    names.value = id;
    const displayed = displayedOrigin(event.currentTarget, card);
    const rect = stage.getBoundingClientRect();
    gesture = {
      pointerId: event.pointerId, element: event.currentTarget, id, camera,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      start: outputPoint(event, rect),
      originLeft: displayed.leftPct,
      originTop: displayed.topPct,
      startLayout: structuredClone(localLayout),
      latest: structuredClone(localLayout),
    };
    event.currentTarget?.setPointerCapture?.(event.pointerId);
    doc.addEventListener?.("pointermove", moveGesture);
    doc.addEventListener?.("pointerup", endGesture);
    doc.addEventListener?.("pointercancel", cancelGesture);
  }
  function moveGesture(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const point = outputPoint(event, gesture.rect);
    const leftPct = clampPercent(gesture.originLeft + (point.x - gesture.start.x) / 1920 * 100);
    const topPct = clampPercent(gesture.originTop + (point.y - gesture.start.y) / 1080 * 100);
    const next = structuredClone(gesture.startLayout);
    next[gesture.camera][gesture.id] = { leftPct, topPct };
    gesture.latest = next;
    localLayout = next;
    gesture.element.setAttribute?.("x", String(leftPct * 19.2));
    gesture.element.setAttribute?.("y", String(topPct * 10.8));
  }
  function endGesture(event) {
    if (!gesture || event?.pointerId !== gesture.pointerId) return;
    moveGesture(event);
    const completed = gesture;
    gesture = null;
    doc.removeEventListener?.("pointermove", moveGesture);
    doc.removeEventListener?.("pointerup", endGesture);
    doc.removeEventListener?.("pointercancel", cancelGesture);
    completed.element?.releasePointerCapture?.(completed.pointerId);
    localLayout = completed.latest;
    commitDocument(false);
    publish();
  }
  function cancelGesture(event) {
    if (!gesture || (event?.pointerId != null && event.pointerId !== gesture.pointerId)) return;
    const startLayout = gesture.startLayout;
    releaseGesture();
    gesture = null;
    localLayout = startLayout;
    drawHandles();
  }
  function handleRendered(result) {
    if (!active || gesture) return;
    if (result?.novaExplainerCamera !== camera || !Array.isArray(result.novaExplainerCards)) return;
    previewHealth = "Ready";
    previewError = "";
    acceptCards(result.novaExplainerCards);
    drawHandles();
    renderChrome();
  }
  function createPreview() {
    preview?.destroy();
    previewHealth = "Loading";
    previewError = "";
    renderedCards = [];
    drawHandles();
    preview = mountClockLayoutPreview({
      container: previewHost, surface: "gis", sessionId: createUuid(), onRendered: handleRendered,
      onError: (error) => {
        if (gesture) cancelGesture();
        previewHealth = "Failed";
        previewError = error?.message || "Preview failed";
        renderedCards = [];
        drawHandles();
        renderChrome();
      },
    });
  }
  function close() {
    if (!active) return;
    active = false;
    if (gesture) cancelGesture();
    preview?.destroy();
    preview = null;
    dialog.remove?.();
    inertSiblings.forEach(({ node, inert }) => { node.inert = inert; });
    inertSiblings = [];
    if (restoreFocus) restoreFocus()?.focus?.();
    else opener?.focus?.();
    unsubscribe();
    win?.removeEventListener?.("resize", onResize);
    win?.removeEventListener?.("orientationchange", onResize);
    win?.removeEventListener?.("beforeunload", beforeUnload);
    beforeUnloadAttached = false;
    onPendingState(false);
    onClose();
  }
  const onResize = () => { if (active) fitPreview(); };
  win?.addEventListener?.("resize", onResize);
  win?.addEventListener?.("orientationchange", onResize);
  const unsubscribe = layoutClient.subscribe?.(() => {
    if (!active || gesture) return;
    const record = layoutClient.getSlot?.("gisNovaExplainers", "novaExplainers");
    const keepDraft = Boolean(record?.draft) || (record?.status && record.status !== "Saved");
    if (keepDraft) {
      localLayout = readDocument();
      renderChrome();
      return;
    }
    const next = readDocument();
    const changed = JSON.stringify(next) !== JSON.stringify(localLayout);
    localLayout = next;
    renderChrome();
    if (!changed) return;
    seedFields();
    alignHandlesToDocument();
    publish();
  }) || (() => {});
  closeCamera.addEventListener("click", () => setCamera("close"));
  wideCamera.addEventListener("click", () => setCamera("wide"));
  names.addEventListener("change", () => { selectedId = names.value; seedFields(); renderChrome(); });
  names.addEventListener("click", (event) => event.stopPropagation?.());
  resetButton.addEventListener("click", resetSelected);
  previewRetry.addEventListener("click", () => { if (gesture) cancelGesture(); previewHealth = "Loading"; drawHandles(); renderChrome(); preview?.reload(); publish(); });
  closeButton.addEventListener("click", close);
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault?.(); close(); return; }
    if (event.key !== "Tab") return;
    const available = (node) => {
      if (node.disabled) return false;
      for (let parent = node; parent && parent !== dialog; parent = parent.parentElement) if (parent.hidden) return false;
      return true;
    };
    const focusables = [...(dialog.querySelectorAll?.("button, input, select") || [])].filter(available);
    const first = focusables[0];
    const last = focusables.at(-1);
    if (!focusables.length) { event.preventDefault?.(); dialog.focus?.(); return; }
    if (event.shiftKey && (doc.activeElement === first || !focusables.includes(doc.activeElement))) { event.preventDefault?.(); last.focus?.(); }
    else if (!event.shiftKey && (doc.activeElement === last || !focusables.includes(doc.activeElement))) { event.preventDefault?.(); first.focus?.(); }
  });
  renderChrome();
  createPreview();
  publish();
  return { close, dispose() { close(); } };
}
