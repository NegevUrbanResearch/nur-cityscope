import { createUuid } from "../shared/uuid.js";
import { validateRoadSignSettings } from "../shared/road-sign-settings.js";
import { validateProjectionConfig } from "../shared/projection-config-schema.js";
import { copyProjectionMesh } from "./clock-layout-geometry.js";

const PREVIEW_TIMEOUT_MS = 30000;
const clone = (value) => structuredClone(value);

function validatePreviewState(value) {
  const checked = validateRoadSignSettings(value?.settings);
  if (!checked.valid || !value?.config || typeof value.config !== "object" || Array.isArray(value.config)
    || Object.keys(validateProjectionConfig(value.config)).length
    || !Number.isSafeInteger(value.calibrationRevision) || value.calibrationRevision < 0) {
    throw new TypeError("Invalid Road 232 preview state");
  }
  return { settings: checked.settings, config: clone(value.config), calibrationRevision: value.calibrationRevision };
}

export function mountRoadSignPreview({ container, output, onRendered = () => {}, onError = () => {} } = {}) {
  const doc = container?.ownerDocument;
  const win = doc?.defaultView;
  if (!container || !doc?.createElement || !win?.location?.href || !["left", "right", "gis"].includes(output)) {
    throw new Error("Road 232 preview requires a same-origin container and source output");
  }
  let activeOutput = output;
  let sessionId = createUuid();
  let frame = null;
  let requestId = 0;
  let latestRequest = 0;
  let ready = false;
  let state = null;
  let receipt = null;
  let disposed = false;
  let failed = false;
  let timeout = null;
  let frameResize = null;

  const clearTimeoutHandle = () => { clearTimeout(timeout); timeout = null; };
  function fail(error, request = latestRequest) {
    if (disposed || failed) return;
    failed = true;
    ready = false;
    receipt = null;
    clearTimeoutHandle();
    onError(error, { output: activeOutput, sessionId, requestId: request });
  }
  function armTimeout(message) {
    clearTimeoutHandle();
    timeout = setTimeout(() => fail(new Error(message)), PREVIEW_TIMEOUT_MS);
  }
  function frameUrl() {
    const url = new URL(activeOutput === "gis" ? "./index.html" : "./projection.html", win.location.href);
    url.searchParams.set("roadSignsPreview", "1");
    if (activeOutput !== "gis") {
      url.searchParams.set("span", activeOutput);
      url.searchParams.set("outputMode", "browser");
    }
    url.searchParams.set("previewSession", sessionId);
    return url.href;
  }
  function sendState() {
    if (!ready || !frame?.contentWindow || !state || disposed || failed) return;
    latestRequest = ++requestId;
    receipt = null;
    frame.contentWindow.postMessage({ type: "otef_road_sign_preview_state", sessionId, requestId: latestRequest,
      output: activeOutput, ...(activeOutput === "gis" ? { sceneId: "home" } : {}), settings: clone(state.settings), config: clone(state.config), calibrationRevision: state.calibrationRevision }, win.location.origin);
    armTimeout("Road 232 preview render timed out");
  }
  function onFrameLoad() { if (!disposed) sendState(); }
  function onFrameError() { fail(new Error("Road 232 preview frame failed to load")); }
  function removeFrame() {
    clearTimeoutHandle();
    frameResize?.disconnect(); frameResize = null;
    if (frame) {
      frame.removeEventListener?.("load", onFrameLoad);
      frame.removeEventListener?.("error", onFrameError);
      frame.remove?.();
    }
    frame = null; ready = false; requestId = 0; latestRequest = 0; receipt = null;
  }
  function replaceSession() {
    sessionId = createUuid();
    removeFrame();
    createFrame();
  }
  function createFrame() {
    failed = false;
    frame = doc.createElement("iframe");
    frame.className = "road-sign-preview-frame";
    frame.title = `${activeOutput} Road 232 placement preview`;
    frame.setAttribute?.("aria-label", frame.title);
    frame.referrerPolicy = "same-origin";
    frame.tabIndex = -1;
    frame.src = frameUrl();
    frame.addEventListener?.("load", onFrameLoad);
    frame.addEventListener?.("error", onFrameError);
    container.replaceChildren?.(frame);
    if (!container.replaceChildren) container.appendChild(frame);
    if (activeOutput === "gis") {
      const fit = () => {
        const scale = Math.min((container.clientWidth || 1920) / 1920, (container.clientHeight || 1080) / 1080);
        Object.assign(frame.style, { width: "1920px", height: "1080px", transformOrigin: "top left", transform: `scale(${scale})` });
      };
      fit();
      if (typeof win.ResizeObserver === "function") {
        frameResize = new win.ResizeObserver(fit);
        frameResize.observe(container);
      }
    }
    armTimeout("Road 232 preview loading timed out");
  }
  function onMessage(event) {
    if (disposed || failed || event.origin !== win.location.origin || event.source !== frame?.contentWindow) return;
    const message = event.data;
    if (!message || message.sessionId !== sessionId || message.output !== activeOutput) return;
    if (message.type === "otef_road_sign_preview_ready") {
      if (ready) return;
      ready = true; clearTimeoutHandle(); sendState();
      return;
    }
    if (message.type === "otef_road_sign_preview_error") {
      if (message.requestId != null && message.requestId !== latestRequest) return;
      fail(new Error(typeof message.message === "string" ? message.message : "Road 232 preview failed"), message.requestId);
      return;
    }
    if (message.type !== "otef_road_sign_preview_rendered" || message.requestId !== latestRequest || !state) return;
    if (message.calibrationRevision !== state.calibrationRevision) return;
    let mesh;
    try {
      mesh = copyProjectionMesh(message.mesh);
      if (!mesh?.triangles.length || mesh.triangles.length % 3 || typeof message.meshIdentity !== "string" || !message.meshIdentity.trim()) {
        throw new Error("Invalid Road 232 preview mesh receipt");
      }
    } catch (error) { fail(error); return; }
    clearTimeoutHandle();
    receipt = { output: activeOutput, sessionId, requestId: latestRequest, calibrationRevision: state.calibrationRevision,
      meshIdentity: message.meshIdentity, mesh };
    onRendered(clone(receipt));
  }

  win.addEventListener("message", onMessage);
  createFrame();
  return {
    setState(next) {
      if (disposed) return false;
      const checked = validatePreviewState(next);
      const calibrationChanged = state && (state.calibrationRevision !== checked.calibrationRevision || JSON.stringify(state.config) !== JSON.stringify(checked.config));
      state = checked;
      failed = false;
      receipt = null;
      if (calibrationChanged) replaceSession();
      else sendState();
      return true;
    },
    refresh() {
      if (disposed) return false;
      replaceSession();
      return true;
    },
    setOutput(nextOutput) {
      if (disposed || !["left", "right", "gis"].includes(nextOutput)) return false;
      if (nextOutput === activeOutput) return true;
      activeOutput = nextOutput;
      replaceSession();
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      win.removeEventListener("message", onMessage);
      removeFrame();
      state = null;
    },
  };
}
