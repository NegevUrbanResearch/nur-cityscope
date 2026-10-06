import { recordProjectionTrace } from './projection-trace-input.js';

const FRAME_URL = (side) => `/otef-interactive/projection.html?span=${side}&preview=1&mapPixelRatio=1&outputMode=browser`;

/** Owns a projection preview iframe and its origin/source/request guarded message channel. */
export function createProjectionPreviewFrame({ document: doc, host, onStatus = () => {}, timeoutMs = 30000, appliedTimeoutMs = 30000, frameClass = "warp-editor-frame", titleForSide = (side) => `${side} projection output`, trace }) {
  const win = doc.defaultView;
  const origin = win?.location?.origin;
  let current = null;
  let generation = 0;
  let latest = null;
  let disposed = false;
  let listening = false;
  let calibrationEnabled = false, calibrationTimer = null;
  let calibrationState = { active: false, ready: false, sceneIdentity: null, missingIds: [], error: null };
  const sendCalibration = () => {
    const session = current;
    if (!session?.ready || !origin || session.frame.isConnected === false || !session.frame.contentWindow) return;
    if (calibrationEnabled && session.calibrationFailed) return;
    if (calibrationEnabled && session.calibrationOutstandingSince != null && Date.now() - session.calibrationOutstandingSince >= 3000) {
      calibrationState = { ...calibrationState, ready: false, sceneIdentity: null, error: 'No rendered landmark acknowledgement for 3000 ms' };
      session.calibrationFailed = true;
      if (calibrationTimer !== null) clearInterval(calibrationTimer); calibrationTimer = null;
      return;
    }
    const requestId = ++session.calibrationRequestId;
    if (calibrationEnabled && session.calibrationOutstandingSince == null) session.calibrationOutstandingSince = Date.now();
    session.frame.contentWindow.postMessage({ type: 'otef_projection_preview_calibration', output: session.side, requestId, enabled: calibrationEnabled }, origin);
  };
  const setStatus = (message, retry = false) => onStatus(message, retry);
  const clear = () => {
    if (calibrationTimer !== null) clearInterval(calibrationTimer); calibrationTimer = null;
    calibrationState = { active: calibrationEnabled, ready: false, sceneIdentity: null, missingIds: [], error: null };
    if (!current) return;
    clearTimeout(current.timer); clearTimeout(current.appliedTimer);
    current.frame.remove();
    current = null;
  };
  const send = ({ config = latest, force = false, runNames = false } = {}) => {
    const session = current;
    if (!session?.ready || !config || !origin) return false;
    const identity = JSON.stringify(config);
    if (runNames && (!session.calibrated || session.pendingGeometryRequestId != null || identity !== session.calibratedIdentity)) return false;
    if (!force && identity === session.sentIdentity) return false;
    const target = session.frame.contentWindow;
    if (!target) return false;
    if (!runNames) session.sentIdentity = identity;
    clearTimeout(session.appliedTimer); session.appliedTimer = null;
    const requestId = ++session.requestId;
    session.expiredRequestId = null;
    session.requestKind = runNames ? "names" : "geometry";
    if (!runNames) { session.pendingGeometryRequestId = requestId; session.pendingGeometryIdentity = identity; }
    target.postMessage({ type: "otef_projection_preview_config", output: session.side, requestId, config, ...(runNames ? { runNames: true } : {}) }, origin);
    const pendingId = session.requestId;
    session.appliedTimer = setTimeout(() => {
      if (current !== session || session.generation !== generation || session.requestId !== pendingId) return;
      session.appliedTimer = null;
      session.expiredRequestId = pendingId;
      if (session.pendingGeometryRequestId === pendingId) { session.pendingGeometryRequestId = null; session.pendingGeometryIdentity = null; }
      setStatus(session.calibrated
        ? "Preview did not finish; visible preview is stale. Retry to reload it."
        : "Preview did not finish. Retry to reload it.", true);
    }, appliedTimeoutMs);
    setStatus(runNames
      ? (session.calibrated ? "Running names; visible preview may be stale…" : "Running names for applied calibration…")
      : (session.calibrated ? "Rendering updated draft; visible preview is stale…" : "Rendering current draft…"));
    return true;
  };
  const onMessage = (event) => {
    const session = current;
    const message = event.data;
    if (!session || session.timedOut || session.generation !== generation || event.origin !== origin || event.source !== session.frame.contentWindow || message?.output !== session.side) return;
    if (message.type === "otef_projection_preview_ready") {
      if (session.ready) return;
      session.ready = true; clearTimeout(session.timer); session.timer = null;
      recordProjectionTrace(trace, 'receipt', { receiptType: 'preview_ready', output: session.side });
      setStatus("Ready"); send();
      if (calibrationEnabled) { sendCalibration(); calibrationTimer = setInterval(sendCalibration, 1000); }
      return;
    }
    if (message.type === 'otef_projection_preview_calibration_rendered') {
      if (!session.ready || session.calibrationFailed || message.requestId !== session.calibrationRequestId || typeof message.ready !== 'boolean' ||
        !(message.sceneIdentity === null || (typeof message.sceneIdentity === 'string' && message.sceneIdentity.length > 0 && message.sceneIdentity.length <= 4096)) ||
        !Array.isArray(message.missingIds) || message.missingIds.length > 7 || !message.missingIds.every(id => typeof id === 'string' && id.length <= 128) ||
        !(message.error === null || (typeof message.error === 'string' && message.error.length <= 240))) return;
      calibrationState = { active: calibrationEnabled, ready: calibrationEnabled && message.ready && !message.error && typeof message.sceneIdentity === 'string',
        sceneIdentity: message.sceneIdentity, missingIds: [...message.missingIds], error: message.error };
      session.calibrationOutstandingSince = null;
      return;
    }
    if (message.type !== "otef_projection_preview_applied" || !session.ready || message.requestId !== session.requestId || message.requestId === session.expiredRequestId) return;
    clearTimeout(session.appliedTimer); session.appliedTimer = null;
    recordProjectionTrace(trace, 'receipt', { receiptType: 'preview_applied', output: session.side, accepted: Boolean(message.success) });
    if (session.requestKind === "geometry") {
      if (message.success) { session.calibrated = true; session.calibratedIdentity = session.pendingGeometryIdentity; session.frame.style.visibility = "visible"; }
      session.pendingGeometryRequestId = null; session.pendingGeometryIdentity = null;
    } else if (message.success) session.frame.style.visibility = "visible";
    const failure = `Preview unavailable: ${String(message.error || "render failed").slice(0, 240)}`;
    setStatus(message.success ? "Current draft"
      : (session.calibrated && session.requestKind === "geometry" ? `Preview unavailable; visible preview is stale. ${failure}` : failure), !message.success);
  };
  const attach = () => { if (listening) return; listening = true; win?.addEventListener?.("message", onMessage); };
  const detach = () => { if (!listening) return; listening = false; win?.removeEventListener?.("message", onMessage); };
  const mount = (side) => {
    if (disposed || !["left", "right"].includes(side)) return null;
    clear(); attach();
    const frame = doc.createElement("iframe");
    frame.className = frameClass;
    frame.title = titleForSide(side);
    frame.setAttribute("aria-hidden", "true"); frame.tabIndex = -1; frame.src = FRAME_URL(side); frame.style.visibility = "hidden";
    host.appendChild(frame);
    const session = { frame, side, generation: ++generation, ready: false, calibrated: false, calibratedIdentity: null,
      pendingGeometryRequestId: null, pendingGeometryIdentity: null, requestKind: null, timedOut: false, requestId: 0,
      expiredRequestId: null, sentIdentity: null, timer: null, appliedTimer: null, calibrationRequestId: 0, calibrationOutstandingSince: null, calibrationFailed: false };
    current = session;
    setStatus("Loading projection output…", false);
    session.timer = setTimeout(() => {
      if (current !== session || session.ready) return;
      session.timedOut = true; setStatus("Projection output unavailable. Retry to reload it.", true);
    }, timeoutMs);
    return frame;
  };
  return {
    mount,
    retry() { if (current) mount(current.side); },
    update(config) { latest = config; return send(); },
    sendRunNamesPreview(config) { return send({ config, force: true, runNames: true }); },
    setCalibrationView(enabled) {
      calibrationEnabled = enabled === true;
      if (current) { current.calibrationOutstandingSince = null; current.calibrationFailed = false; }
      calibrationState = { active: calibrationEnabled, ready: false, sceneIdentity: null, missingIds: [], error: null };
      if (calibrationTimer !== null) clearInterval(calibrationTimer); calibrationTimer = null;
      sendCalibration();
      if (calibrationEnabled && current?.ready) calibrationTimer = setInterval(sendCalibration, 1000);
    },
    getCalibrationState: () => structuredClone(calibrationState),
    frame: () => current?.frame || null,
    isReady: () => Boolean(current?.ready),
    clear() { clear(); detach(); setStatus(""); },
    dispose() { if (disposed) return; clear(); detach(); disposed = true; latest = null; setStatus(""); },
  };
}
