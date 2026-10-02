import { recordProjectionTrace } from './projection-trace-input.js';

const FRAME_URL = (side) => `/otef-interactive/projection.html?span=${side}&preview=1&mapPixelRatio=1&outputMode=browser`;

/** Owns a projection preview iframe and its origin/source/request guarded message channel. */
export function createProjectionPreviewFrame({ document: doc, host, onStatus = () => {}, timeoutMs = 30000, frameClass = "warp-editor-frame", titleForSide = (side) => `${side} projection output`, trace }) {
  const win = doc.defaultView;
  const origin = win?.location?.origin;
  let current = null;
  let generation = 0;
  let latest = null;
  let disposed = false;
  let listening = false;
  const setStatus = (message, retry = false) => onStatus(message, retry);
  const clear = () => {
    if (!current) return;
    clearTimeout(current.timer);
    current.frame.remove();
    current = null;
  };
  const send = ({ config = latest, force = false, runNames = false } = {}) => {
    const session = current;
    if (!session?.ready || !config || !origin) return false;
    const identity = JSON.stringify(config);
    if (runNames && (!session.calibrated || session.pendingGeometryRequestId != null || identity !== session.calibratedIdentity)) return false;
    if (!force && identity === session.sentIdentity) return false;
    if (!runNames) session.sentIdentity = identity;
    const requestId = ++session.requestId;
    session.requestKind = runNames ? "names" : "geometry";
    if (!runNames) { session.pendingGeometryRequestId = requestId; session.pendingGeometryIdentity = identity; }
    session.frame.contentWindow?.postMessage({ type: "otef_projection_preview_config", output: session.side, requestId, config, ...(runNames ? { runNames: true } : {}) }, origin);
    setStatus(runNames ? "Running names for applied calibration…" : "Rendering current draft…");
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
      return;
    }
    if (message.type !== "otef_projection_preview_applied" || !session.ready || message.requestId !== session.requestId) return;
    recordProjectionTrace(trace, 'receipt', { receiptType: 'preview_applied', output: session.side, accepted: Boolean(message.success) });
    if (session.requestKind === "geometry") {
      if (message.success) { session.calibrated = true; session.calibratedIdentity = session.pendingGeometryIdentity; session.frame.style.visibility = "visible"; }
      session.pendingGeometryRequestId = null; session.pendingGeometryIdentity = null;
    } else if (message.success) session.frame.style.visibility = "visible";
    setStatus(message.success ? "Current draft" : `Preview unavailable: ${String(message.error || "render failed").slice(0, 240)}`, !message.success);
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
      pendingGeometryRequestId: null, pendingGeometryIdentity: null, requestKind: null, timedOut: false, requestId: 0, sentIdentity: null, timer: null };
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
    frame: () => current?.frame || null,
    isReady: () => Boolean(current?.ready),
    clear() { clear(); detach(); setStatus(""); },
    dispose() { if (disposed) return; clear(); detach(); disposed = true; latest = null; setStatus(""); },
  };
}
