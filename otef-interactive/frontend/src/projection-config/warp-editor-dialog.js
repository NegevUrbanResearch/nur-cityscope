import { fitWarpViewport } from "./warp-viewport.js";
import { createProjectionPreviewFrame } from "./projection-preview-frame.js";

/** Owns one disposable projection frame. The config controller retains all draft and edit state. */
export function createWarpEditorDialog({ document: doc, host, editorPanel, overlay, navigationControls, onBeforeClose = () => {}, onBeforeSwitch = () => {}, onBeforeResize = () => {}, onViewportChange = () => {}, onOrientationChange = () => {}, onApply = () => {}, onLive = () => {} }) {
  const win = doc.defaultView;
  const home = editorPanel.parentElement;
  const overlayHome = overlay.parentElement;
  const modal = doc.createElement("section");
  modal.className = "warp-editor-dialog";
  modal.hidden = true;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Warp editor");
  const header = doc.createElement("header"); header.className = "warp-editor-header";
  const title = doc.createElement("h2"); title.className = "warp-editor-title";
  const status = doc.createElement("span"); status.className = "warp-editor-message"; status.setAttribute("role", "status");
  const closeButton = doc.createElement("button"); closeButton.type = "button"; closeButton.dataset.action = "warp-editor-close"; closeButton.textContent = "Close";
  header.append(title, status);
  if (navigationControls) header.appendChild(navigationControls);
  header.appendChild(closeButton);
  const body = doc.createElement("div"); body.className = "warp-editor-body";
  const viewport = doc.createElement("div"); viewport.className = "warp-editor-viewport";
  const finePanel = doc.createElement("aside"); finePanel.className = "warp-editor-fine-panel";
  body.append(viewport, finePanel);
  const footer = doc.createElement("footer"); footer.className = "warp-editor-footer";
  const liveLabel = doc.createElement("label"); liveLabel.className = "live-toggle"; liveLabel.textContent = "Live";
  const liveInput = doc.createElement("input"); liveInput.type = "checkbox"; liveInput.setAttribute("aria-label", "Editor Live"); liveLabel.prepend(liveInput);
  const applyButton = doc.createElement("button"); applyButton.type = "button"; applyButton.textContent = "Apply once";
  const applied = doc.createElement("span"); applied.className = "warp-editor-applied";
  const retry = doc.createElement("button"); retry.type = "button"; retry.dataset.action = "warp-editor-retry"; retry.textContent = "Retry"; retry.hidden = true;
  footer.append(liveLabel, applyButton, applied, retry);
  modal.append(header, body, footer); host.appendChild(modal);

  let session = null;
  let opener = null;
  let oldOverflow = null;
  let inertSiblings = [];
  let ownFullscreen = false;
  let fullscreenPending = false;
  let disposed = false;
  let listenersAttached = false;
  let focusEpoch = 0;
  let closedFocus = null;
  let viewBox = { x: -72, y: -72, width: 2064, height: 1224 };
  const setMessage = (message) => { status.textContent = message; };
  const preview = createProjectionPreviewFrame({ document: doc, host: viewport, onStatus: (message, canRetry) => { setMessage(message); retry.hidden = !canRetry; } });
  const fit = () => {
    if (!session || !viewport.clientWidth || !viewport.clientHeight) return;
    const mapping = fitWarpViewport(viewBox, viewport.clientWidth, viewport.clientHeight);
    const frame = session.frame;
    frame.style.transform = `translate(${mapping.image.left}px, ${mapping.image.top}px) scale(${mapping.scale})`;
    overlay.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
    onViewportChange();
  };
  const clearFrame = () => {
    if (!session) return;
    session.observer?.disconnect();
    preview.clear();
    session = null;
  };
  const restoreFocus = (returnTo) => {
    if (returnTo && focusEpoch === returnTo.epoch && modal.hidden) returnTo.element?.focus?.();
  };
  const exitOwnedFullscreen = (returnTo) => {
    if (doc.fullscreenElement !== modal || typeof doc.exitFullscreen !== "function") return;
    let exit;
    try { exit = doc.exitFullscreen(); }
    catch { restoreFocus(returnTo); return; }
    Promise.resolve(exit).then(() => restoreFocus(returnTo), () => restoreFocus(returnTo));
  };
  const makeFrame = (side) => {
    clearFrame();
    const frame = preview.mount(side);
    const current = { frame, side, observer: null };
    session = current;
    const ResizeObserverType = win?.ResizeObserver || globalThis.ResizeObserver;
    if (ResizeObserverType) { current.observer = new ResizeObserverType(() => { onBeforeResize(); fit(); }); current.observer.observe(viewport); }
    fit();
  };
  const requestFullscreen = () => {
    if (fullscreenPending || doc.fullscreenElement === modal || typeof modal.requestFullscreen !== "function") return;
    fullscreenPending = true;
    let request;
    try { request = modal.requestFullscreen(); }
    catch { fullscreenPending = false; return; }
    Promise.resolve(request).then(() => {
      fullscreenPending = false;
      if (disposed || !session) { exitOwnedFullscreen(closedFocus); ownFullscreen = false; }
      else { ownFullscreen = doc.fullscreenElement === modal; fit(); }
    }).catch(() => { fullscreenPending = false; });
  };
  const onKeyDown = (event) => {
    if (modal.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const focusables = [...modal.querySelectorAll("button:not([hidden]), input:not([hidden]), select:not([hidden])")].filter((item) => !item.disabled && !item.closest("[hidden]"));
    if (!focusables.length) return;
    const first = focusables[0]; const last = focusables.at(-1);
    if (event.shiftKey && doc.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const onResize = () => { onBeforeResize(); fit(); };
  const onOrientation = () => { onOrientationChange(); fit(); };
  const attachListeners = () => {
    if (listenersAttached) return;
    listenersAttached = true;
    win?.addEventListener?.("resize", onResize);
    win?.addEventListener?.("orientationchange", onOrientation);
    doc.addEventListener?.("fullscreenchange", fit);
    doc.addEventListener?.("keydown", onKeyDown);
  };
  const detachListeners = () => {
    if (!listenersAttached) return;
    listenersAttached = false;
    win?.removeEventListener?.("resize", onResize);
    win?.removeEventListener?.("orientationchange", onOrientation);
    doc.removeEventListener?.("fullscreenchange", fit);
    doc.removeEventListener?.("keydown", onKeyDown);
  };
  const close = () => {
    if (modal.hidden) return;
    const returnTo = { element: opener, epoch: ++focusEpoch };
    closedFocus = returnTo;
    onBeforeClose(); detachListeners(); clearFrame();
    overlay.classList?.remove?.("warp-preview-overlay");
    overlay.removeAttribute?.("tabindex");
    if (overlayHome?.appendChild) overlayHome.appendChild(overlay);
    if (home?.appendChild) home.appendChild(editorPanel);
    modal.hidden = true;
    for (const [element, wasInert] of inertSiblings) element.inert = wasInert;
    inertSiblings = [];
    if (oldOverflow !== null) { doc.body.style.overflow = oldOverflow; oldOverflow = null; }
    if (ownFullscreen && doc.fullscreenElement === modal) exitOwnedFullscreen(returnTo);
    else restoreFocus(returnTo);
    ownFullscreen = false;
    opener = null;
  };
  const open = ({ side, mode, opener: activatingElement } = {}) => {
    if (disposed || !["left", "right"].includes(side) || !["keystone", "grid"].includes(mode)) return;
    if (!modal.hidden && session?.side === side) {
      if (modal.dataset.mode !== mode) onBeforeSwitch();
      modal.dataset.mode = mode; title.textContent = `${side === "left" ? "Left" : "Right"} · ${mode === "grid" ? "Grid Warp" : "Keystone"}`;
      return;
    }
    if (!modal.hidden) { onBeforeSwitch(); clearFrame(); }
    else {
      focusEpoch += 1; closedFocus = null;
      opener = activatingElement || doc.activeElement;
      if (doc.body?.style) { oldOverflow = doc.body.style.overflow; doc.body.style.overflow = "hidden"; }
      inertSiblings = [...host.children].filter((child) => child !== modal).map((child) => [child, child.inert]);
      for (const [child] of inertSiblings) child.inert = true;
      modal.hidden = false;
      attachListeners();
      requestFullscreen();
    }
    modal.dataset.mode = mode;
    title.textContent = `${side === "left" ? "Left" : "Right"} · ${mode === "grid" ? "Grid Warp" : "Keystone"}`;
    finePanel.appendChild(editorPanel); viewport.appendChild(overlay);
    overlay.classList?.add?.("warp-preview-overlay");
    overlay.setAttribute("preserveAspectRatio", "xMidYMid meet");
    overlay.setAttribute("tabindex", "0");
    makeFrame(side);
    closeButton.focus?.();
  };
  closeButton.addEventListener("click", close);
  retry.addEventListener("click", () => { if (session) { preview.retry(); session.frame = preview.frame(); fit(); } });
  applyButton.addEventListener("click", onApply);
  liveInput.addEventListener("change", () => onLive(liveInput.checked));
  return {
    open,
    isOpen() { return !modal.hidden; },
    update(config, { live, appliedSummary } = {}) {
      if (live !== undefined) liveInput.checked = Boolean(live);
      if (appliedSummary !== undefined) applied.textContent = appliedSummary;
      preview.update(config);
    },
    sendRunNamesPreview(config) { return preview.sendRunNamesPreview(config); },
    setViewBox(next) { if (!next) return; viewBox = { ...next }; fit(); },
    close,
    dispose() {
      if (disposed) return;
      close(); disposed = true;
      detachListeners();
      preview.dispose();
      modal.remove();
    },
  };
}
