import { createUuid } from "../shared/uuid.js";
import { copyProjectionMesh } from "./clock-layout-geometry.js";
import { validateSettlementNameSettings } from "../shared/settlement-name-settings.js";
import { mapSettlementPosition } from '../projection/settlement-name-framing.js';

const PREVIEW_TIMEOUT_MS = 30000;
const MAX_LABELS = 512;

function finiteLabel(label) {
  return label && typeof label.citycode === "string" && label.citycode && typeof label.text === "string"
    && [label.x, label.y, label.rotateDeg].every(Number.isFinite)
    && (label.inkBox == null || ["left", "right", "top", "bottom"].every((key) => Number.isFinite(label.inkBox[key])));
}

export function validSettlementPreviewWarnings(warnings) {
  return Boolean(warnings) && typeof warnings.clipped === "boolean" && typeof warnings.overlap === "boolean"
    && typeof warnings.outOfView === "boolean" && ["complete", "unavailable"].includes(warnings.mapping);
}

function validRendered(message, output) {
  if (!message || message.output !== output || typeof message.meshIdentity !== "string" || !message.meshIdentity) return false;
  if (message.positionMatrix != null && (!Array.isArray(message.positionMatrix) || !mapSettlementPosition({x:0,y:0},message.positionMatrix,true))) return false;
  if (!Array.isArray(message.labels) || message.labels.length > MAX_LABELS || !message.labels.every(finiteLabel)) return false;
  if (message.warnings != null && !validSettlementPreviewWarnings(message.warnings)) return false;
  return true;
}

export function mountSettlementNamePreview({ container, output, sessionId = createUuid(), onRendered = () => {}, onError = () => {} } = {}) {
  const doc = container?.ownerDocument;
  const win = doc?.defaultView;
  if (!container || !doc?.createElement || !win?.location?.href || !["left", "right"].includes(output)) {
    throw new Error("Settlement preview requires a container and a left or right output");
  }
  let frame = null;
  let activeOutput = output;
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
    failed = true;
    ready = false;
    clearTimeout(timeout);
    timeout = null;
    onError(error, { sessionId: activeSession, requestId: latestRequest });
  }
  function armTimeout(message) {
    clearTimeout(timeout);
    timeout = setTimeout(() => fail(new Error(message)), PREVIEW_TIMEOUT_MS);
  }
  function frameUrl(session, side) {
    const url = new URL("./projection.html", win.location.href);
    url.searchParams.set("settlementPreview", "1");
    url.searchParams.set("span", side);
    url.searchParams.set("outputMode", "browser");
    url.searchParams.set("previewSession", session);
    return url.href;
  }
  function sendState() {
    if (!ready || !frame?.contentWindow || !state || destroyed || failed) return;
    latestRequest = ++requestId;
    frame.contentWindow.postMessage({
      type: "otef_settlement_preview_state",
      sessionId: activeSession,
      requestId: latestRequest,
      output: activeOutput,
      settings: structuredClone(state.settings),
      selectedCitycode: state.selectedCitycode,
    }, win.location.origin);
    armTimeout("Settlement preview render timed out");
  }
  function removeFrame() {
    clearTimeout(timeout);
    timeout = null;
    frame?.removeEventListener?.("load", onFrameLoad);
    frame?.remove?.();
    frame = null;
    ready = false;
    requestId = 0;
    latestRequest = 0;
  }
  function createFrame() {
    failed = false;
    frame = doc.createElement("iframe");
    frame.className = "settlement-preview-frame";
    frame.title = `${activeOutput} settlement name preview`;
    frame.setAttribute?.("aria-label", frame.title);
    frame.src = frameUrl(activeSession, activeOutput);
    frame.addEventListener?.("load", onFrameLoad);
    if (container.replaceChildren) container.replaceChildren(frame);
    else container.appendChild(frame);
    armTimeout("Settlement preview loading timed out");
  }
  function onFrameLoad() { if (!destroyed) sendState(); }
  function onMessage(event) {
    if (destroyed || failed || event.origin !== win.location.origin || event.source !== frame?.contentWindow) return;
    const message = event.data;
    if (!message || message.sessionId !== activeSession || message.output !== activeOutput) return;
    if (message.type === "otef_settlement_preview_ready") {
      ready = true;
      clearTimeout(timeout);
      timeout = null;
      sendState();
      return;
    }
    if (message.type === "otef_settlement_preview_error") {
      if (message.requestId != null && message.requestId !== latestRequest) return;
      fail(new Error(typeof message.message === "string" ? message.message : "Settlement preview failed"));
      return;
    }
    if (message.type !== "otef_settlement_preview_rendered" || message.requestId !== latestRequest || !state) return;
    if (!validRendered(message, activeOutput)) return;
    let mesh = null;
    try {
      mesh = copyProjectionMesh(message.mesh);
      if (!mesh?.triangles?.length) throw new Error("Invalid settlement preview mesh");
    } catch {
      fail(new Error("Invalid settlement preview mesh"));
      return;
    }
    clearTimeout(timeout);
    timeout = null;
    onRendered({ ...message, sessionId: activeSession, mesh, labels: message.labels.map((label) => ({ ...label, inkBox: label.inkBox ? { ...label.inkBox } : null })) });
  }

  win.addEventListener("message", onMessage);
  createFrame();
  return {
    setState(next) {
      const checked = validateSettlementNameSettings(next?.settings);
      if (checked.errors.length || (next.selectedCitycode != null && typeof next.selectedCitycode !== "string")) {
        throw new TypeError("Invalid settlement preview state");
      }
      state = { settings: checked.value, selectedCitycode: next.selectedCitycode || null };
      sendState();
    },
    reload({ output: nextOutput } = {}) {
      if (destroyed) return;
      if (nextOutput === "left" || nextOutput === "right") activeOutput = nextOutput;
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
      if (container.replaceChildren) container.replaceChildren();
    },
  };
}
