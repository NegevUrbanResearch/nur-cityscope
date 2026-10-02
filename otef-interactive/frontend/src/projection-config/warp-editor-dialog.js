import { fitWarpViewport } from "./warp-viewport.js";

const FRAME_URL = (side) => `/otef-interactive/projection.html?span=${side}&preview=1&mapPixelRatio=1&outputMode=browser`;

/** Owns one disposable projection frame. The config controller retains all draft and edit state. */
export function createWarpEditorDialog({ document: doc, host, editorPanel, overlay, navigationControls, onRunNames = () => {}, onBeforeClose = () => {}, onBeforeSwitch = () => {}, onFineToggle = () => {}, onBeforeResize = () => {}, onViewportChange = () => {}, onOrientationChange = () => {}, onApply = () => {}, onLive = () => {} }) {
  const win = doc.defaultView;
  const origin = win?.location?.origin;
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
  const fineToggle = doc.createElement("button"); fineToggle.type = "button"; fineToggle.dataset.action = "warp-editor-fine"; fineToggle.textContent = "Fine adjustment"; fineToggle.setAttribute("aria-expanded", "false");
  const closeButton = doc.createElement("button"); closeButton.type = "button"; closeButton.dataset.action = "warp-editor-close"; closeButton.textContent = "Close";
  header.append(title, status);
  if (navigationControls) header.appendChild(navigationControls);
  header.append(fineToggle, closeButton);
  const body = doc.createElement("div"); body.className = "warp-editor-body";
  const viewport = doc.createElement("div"); viewport.className = "warp-editor-viewport";
  const finePanel = doc.createElement("aside"); finePanel.className = "warp-editor-fine-panel"; finePanel.hidden = true;
  body.append(viewport, finePanel);
  const footer = doc.createElement("footer"); footer.className = "warp-editor-footer";
  const liveLabel = doc.createElement("label"); liveLabel.textContent = "Live";
  const liveInput = doc.createElement("input"); liveInput.type = "checkbox"; liveInput.setAttribute("aria-label", "Editor Live"); liveLabel.prepend(liveInput);
  const applyButton = doc.createElement("button"); applyButton.type = "button"; applyButton.textContent = "Apply once";
  const applied = doc.createElement("span"); applied.className = "warp-editor-applied";
  const retry = doc.createElement("button"); retry.type = "button"; retry.dataset.action = "warp-editor-retry"; retry.textContent = "Retry"; retry.hidden = true;
  const namesStatus = doc.createElement("span"); namesStatus.className = "warp-editor-names-status"; namesStatus.setAttribute("role", "status"); namesStatus.setAttribute("aria-live", "polite");
  const namesRun = doc.createElement("button"); namesRun.type = "button"; namesRun.dataset.action = "projection-names-run"; namesRun.textContent = "Run names";
  namesRun.addEventListener("click", onRunNames);
  footer.append(liveLabel, applyButton, applied, retry, namesStatus, namesRun);
  modal.append(header, body, footer); host.appendChild(modal);

  let session = null;
  let latest = null;
  let generation = 0;
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
  const touchVisible = () => Boolean(win?.matchMedia?.("(pointer: coarse)")?.matches || win?.matchMedia?.("(hover: none)")?.matches);
  const setMessage = (message) => { status.textContent = message; };
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
    clearTimeout(session.timer);
    session.observer?.disconnect();
    session.frame.remove();
    session = null;
  };
  const send = ({ config = latest, force = false, runNames = false } = {}) => {
    if (!session?.ready || !config || !origin) return false;
    const identity = JSON.stringify(config);
    if (runNames && (!session.calibrated || session.pendingGeometryRequestId != null || identity !== session.calibratedIdentity)) return false;
    if (!force && identity === session.sentIdentity) return false;
    if (!runNames) session.sentIdentity = identity;
    const requestId = ++session.requestId;
    session.requestKind = runNames ? "names" : "geometry";
    if (!runNames) {
      session.pendingGeometryRequestId = requestId;
      session.pendingGeometryIdentity = identity;
    }
    session.frame.contentWindow?.postMessage({ type: "otef_projection_preview_config", output: session.side, requestId, config, ...(runNames ? { runNames: true } : {}) }, origin);
    setMessage(runNames ? "Running names for applied calibration…" : "Rendering current draft…");
    return true;
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
    const frame = doc.createElement("iframe");
    frame.className = "warp-editor-frame";
    frame.title = `${side} projection output`;
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.src = FRAME_URL(side);
    viewport.appendChild(frame);
    const current = { frame, side, generation: ++generation, ready: false, calibrated: false, calibratedIdentity: null,
      pendingGeometryRequestId: null, pendingGeometryIdentity: null, requestKind: null, timedOut: false, requestId: 0,
      sentIdentity: null, observer: null, timer: null };
    frame.style.visibility = "hidden";
    session = current;
    setMessage("Loading projection output…"); retry.hidden = true;
    current.timer = setTimeout(() => {
      if (session !== current || current.ready) return;
      current.timedOut = true;
      setMessage("Projection output unavailable. Retry to reload it."); retry.hidden = false;
    }, 30000);
    const ResizeObserverType = win?.ResizeObserver || globalThis.ResizeObserver;
    if (ResizeObserverType) { current.observer = new ResizeObserverType(() => { onBeforeResize(); fit(); }); current.observer.observe(viewport); }
    fit();
  };
  const onMessage = (event) => {
    const current = session;
    const message = event.data;
    if (!current || current.timedOut || current.generation !== generation || event.origin !== origin || event.source !== current.frame.contentWindow || message?.output !== current.side) return;
    if (message.type === "otef_projection_preview_ready") {
      if (current.ready) return;
      current.ready = true; clearTimeout(current.timer); current.timer = null;
      setMessage("Ready"); retry.hidden = true; send();
    } else if (message.type === "otef_projection_preview_applied" && current.ready && message.requestId === current.requestId) {
      if (current.requestKind === "geometry") {
        if (message.success) {
          current.calibrated = true;
          current.calibratedIdentity = current.pendingGeometryIdentity;
          current.frame.style.visibility = "visible";
        }
        current.pendingGeometryRequestId = null;
        current.pendingGeometryIdentity = null;
      } else if (message.success) current.frame.style.visibility = "visible";
      setMessage(message.success ? "Current draft" : `Preview unavailable: ${String(message.error || "render failed").slice(0, 240)}`);
      retry.hidden = Boolean(message.success);
    }
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
    win?.addEventListener?.("message", onMessage);
    win?.addEventListener?.("resize", onResize);
    win?.addEventListener?.("orientationchange", onOrientation);
    doc.addEventListener?.("fullscreenchange", fit);
    doc.addEventListener?.("keydown", onKeyDown);
  };
  const detachListeners = () => {
    if (!listenersAttached) return;
    listenersAttached = false;
    win?.removeEventListener?.("message", onMessage);
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
    finePanel.hidden = !touchVisible(); fineToggle.setAttribute("aria-expanded", String(!finePanel.hidden));
    finePanel.appendChild(editorPanel); viewport.appendChild(overlay);
    overlay.classList?.add?.("warp-preview-overlay");
    overlay.setAttribute("preserveAspectRatio", "xMidYMid meet");
    overlay.setAttribute("tabindex", "0");
    makeFrame(side);
    closeButton.focus?.();
  };
  fineToggle.addEventListener("click", () => {
    onFineToggle(); finePanel.hidden = !finePanel.hidden;
    fineToggle.setAttribute("aria-expanded", String(!finePanel.hidden));
    fit();
  });
  closeButton.addEventListener("click", close);
  retry.addEventListener("click", () => { if (session) makeFrame(session.side); });
  applyButton.addEventListener("click", onApply);
  liveInput.addEventListener("change", () => onLive(liveInput.checked));
  return {
    open,
    isOpen() { return !modal.hidden; },
    update(config, { live, appliedSummary, namesRunStatus, namesRunDisabledReason } = {}) {
      latest = config;
      if (live !== undefined) liveInput.checked = Boolean(live);
      if (appliedSummary !== undefined) applied.textContent = appliedSummary;
      if (namesRunStatus !== undefined) namesStatus.textContent = namesRunStatus;
      namesRun.disabled = Boolean(namesRunDisabledReason);
      namesRun.title = namesRunDisabledReason || "Run names for the applied calibration.";
      send();
    },
    sendRunNamesPreview(config) { return send({ config, force: true, runNames: true }); },
    setViewBox(next) { if (!next) return; viewBox = { ...next }; fit(); },
    close,
    dispose() {
      if (disposed) return;
      close(); disposed = true;
      detachListeners();
      modal.remove();
    },
  };
}
