import { createUuid } from "../shared/uuid.js";
import { copyProjectionMesh } from "./clock-layout-geometry.js";
import { validClockPreviewWarnings } from "../projection/clock-preview-warnings.js";

const GIS_SCENES = new Set(["home", "timeline", "segev", "nova", "sderot", "hostages", "hostages_all"]);
const LAYOUT_KEYS = ["leftPct", "topPct", "widthPct", "heightPct", "fontPx", "rotateDeg"];
const PREVIEW_TIMEOUT_MS = 30000;

function validLayout(layout) {
  return layout && typeof layout === "object" && !Array.isArray(layout)
    && LAYOUT_KEYS.every((key) => Number.isFinite(layout[key]))
    && layout.widthPct > 0 && layout.heightPct > 0 && layout.fontPx > 0;
}

function validateState(surface, state) {
  if (!state || state.surface !== surface || !validLayout(state.clockLayout)) return false;
  if (surface === "gis") return GIS_SCENES.has(state.sceneId) && state.output == null && state.legendLayout == null;
  return state.sceneId === "home" && state.output === "left" && ["clock", "legend"].includes(state.element)
    && validLayout(state.legendLayout) && Number.isSafeInteger(state.pageIndex) && state.pageIndex >= 0;
}

export function mountClockLayoutPreview({ container, surface, sessionId = createUuid(), onRendered = () => {}, onError = () => {} } = {}) {
  const doc = container?.ownerDocument;
  const win = doc?.defaultView;
  if (!container || !doc?.createElement || !win?.location?.href || !["gis", "projection"].includes(surface)) {
    throw new Error("Clock layout preview requires a container, same-origin window, and supported surface");
  }
  let frame = null;
  let activeSession = sessionId;
  let requestId = 0;
  let latestRequest = 0;
  let ready = false;
  let state = null;
  let destroyed = false;
  let failed = false;
  let timeout = null;

  function fail(error) {
    if (destroyed || failed) return;
    failed = true; ready = false; clearTimeout(timeout); timeout = null;
    onError(error, { sessionId: activeSession, requestId: latestRequest });
  }
  function armTimeout(message) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fail(new Error(message)), PREVIEW_TIMEOUT_MS);
  }

  function frameUrl(session) {
    const path = surface === "gis" ? "./index.html" : "./projection.html";
    const url = new URL(path, win.location.href);
    url.searchParams.set("clockPreview", "1");
    url.searchParams.set("previewSession", session);
    if (surface === "projection") {
      url.searchParams.set("span", "left");
      url.searchParams.set("outputMode", "browser");
    }
    return url.href;
  }

  function sendState() {
    if (!ready || !frame?.contentWindow || !state || destroyed || failed) return;
    latestRequest = ++requestId;
    frame.contentWindow.postMessage({ type: "otef_clock_preview_state", sessionId: activeSession, requestId: latestRequest, ...structuredClone(state) }, win.location.origin);
    armTimeout("Clock preview render timed out");
  }

  function removeFrame() {
    clearTimeout(timeout); timeout = null;
    if (frame) {
      frame.removeEventListener?.("load", onFrameLoad);
      frame.removeEventListener?.("error", onFrameError);
      frame.remove?.();
    }
    frame = null;
    ready = false;
    requestId = 0;
    latestRequest = 0;
  }

  function createFrame() {
    failed = false;
    frame = doc.createElement("iframe");
    frame.className = "clock-preview-frame";
    frame.title = surface === "gis" ? "GIS clock preview" : "Projection clock and legend preview";
    frame.setAttribute?.("aria-label", frame.title);
    frame.referrerPolicy = "same-origin";
    frame.tabIndex = -1;
    frame.src = frameUrl(activeSession);
    frame.addEventListener?.("load", onFrameLoad);
    frame.addEventListener?.("error", onFrameError);
    container.replaceChildren?.(frame);
    if (!container.replaceChildren) container.appendChild(frame);
    armTimeout("Clock preview loading timed out");
  }

  function onFrameError() { fail(new Error("Clock preview frame failed to load")); }

  function onFrameLoad() {
    if (!destroyed) sendState();
  }

  function onMessage(event) {
    if (destroyed || failed || event.origin !== win.location.origin || event.source !== frame?.contentWindow) return;
    const message = event.data;
    if (!message || message.sessionId !== activeSession) return;
    if (message.type === "otef_clock_preview_ready") {
      if (message.surface !== surface || message.output !== (surface === "projection" ? "left" : null)) return;
      if (ready) return;
      ready = true;
      clearTimeout(timeout); timeout = null;
      sendState();
      return;
    }
    if (message.type === "otef_clock_preview_error") {
      if (message.requestId != null && message.requestId !== latestRequest) return;
      fail(new Error(typeof message.message === "string" ? message.message : "Clock preview failed"));
      return;
    }
    if (message.type !== "otef_clock_preview_rendered" || message.requestId !== latestRequest || !state) return;
    if (message.warnings != null && !validClockPreviewWarnings(message.warnings)) return;
    if (message.surface !== surface || message.sceneId !== state.sceneId || message.output !== (surface === "projection" ? "left" : null)
      || !Number.isSafeInteger(message.pageIndex) || !Number.isSafeInteger(message.pageCount)
      || message.pageCount < 1 || message.pageIndex < 0 || message.pageIndex >= message.pageCount) return;
    if (surface === "gis") {
      if (message.mesh !== null || message.meshIdentity !== null || message.pageIndex !== 0 || message.pageCount !== 1) return;
    }
    let mesh = null;
    if (surface === "projection") {
      try {
        mesh = copyProjectionMesh(message.mesh);
        if (typeof message.meshIdentity !== "string" || !message.meshIdentity || !mesh || !mesh.triangles.length || mesh.triangles.length % 3) throw new Error("Invalid projection preview mesh");
      } catch { fail(new Error("Invalid projection preview mesh")); return; }
    }
    clearTimeout(timeout); timeout = null;
    onRendered({ ...message, sessionId: activeSession, mesh, ...(message.warnings == null ? {} : { warnings: { ...message.warnings } }) });
  }

  win.addEventListener("message", onMessage);
  createFrame();

  return {
    setState(next) {
      if (!validateState(surface, next)) throw new TypeError("Invalid clock layout preview state");
      state = structuredClone(next);
      sendState();
    },
    reload() {
      if (destroyed) return;
      removeFrame();
      activeSession = createUuid();
      createFrame();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      win.removeEventListener("message", onMessage);
      removeFrame();
      state = null;
    },
  };
}
