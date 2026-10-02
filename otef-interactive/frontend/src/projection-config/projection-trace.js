const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QUEUE = 1000;
const MAX_ARCHIVE = 2000;
const MAX_BATCH_EVENTS = 64;
const MAX_BATCH_BYTES = 48 * 1024;
const BATCH_DELAY_MS = 100;
const ACK_TIMEOUT_MS = 3000;
const MAX_SOCKET_BUFFERED_BYTES = 256 * 1024;
const TEXT_FIELDS = new Set(["phase", "reason", "role", "surface", "output", "mode", "pointerType", "baselineType", "receiptType", "visibilityState"]);
const NUMBER_FIELDS = new Set(["clientX", "clientY", "rectX", "rectY", "rectWidth", "rectHeight", "viewX", "viewY", "viewWidth", "viewHeight", "durationMs", "scale", "width", "height", "devicePixelRatio"]);
const INTEGER_FIELDS = new Set(["pointerId", "buttons", "index", "revision", "schemaVersion", "columns", "rows", "redrawId", "gestureId"]);
const BOOLEAN_FIELDS = new Set(["primary", "captured", "accepted", "live", "visible", "dragging", "connected"]);
const KINDS = new Set(["pointer", "capture", "selection", "redraw", "geometry", "gesture", "viewport", "receipt", "lifecycle"]);

function validSession(sessionId, search) {
  if (typeof sessionId !== "string" || !UUID_PATTERN.test(sessionId)) return false;
  try { return new URLSearchParams(search || "").get("projectionTrace")?.toLowerCase() === sessionId.toLowerCase(); }
  catch { return false; }
}

function cleanDetail(detail) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const result = {};
  for (const [key, value] of Object.entries(detail)) {
    if (TEXT_FIELDS.has(key)) {
      if (typeof value !== "string" || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value)) return null;
      if (key === "output" && value !== "left" && value !== "right") return null;
      if (key === "pointerType" && !["mouse", "touch", "pen", "unknown"].includes(value)) return null;
      if (key === "surface" && !["graph", "warp", "dialog", "page"].includes(value)) return null;
      result[key] = value;
    } else if (NUMBER_FIELDS.has(key)) {
      if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e12) return null;
      result[key] = value;
    } else if (INTEGER_FIELDS.has(key)) {
      if (!Number.isInteger(value) || value < 0 || value > 2147483647) return null;
      result[key] = value;
    } else if (key === "button") {
      if (!Number.isInteger(value) || value < -1 || value > 31) return null;
      result[key] = value;
    } else if (key === "indices") {
      if (!Array.isArray(value) || value.length > 64 || value.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return null;
      result[key] = [...value];
    } else if (BOOLEAN_FIELDS.has(key)) {
      if (typeof value !== "boolean") return null;
      result[key] = value;
    } else return null;
  }
  return result;
}

function utf8Length(value) {
  try { return new TextEncoder().encode(value).length; }
  catch { return unescape(encodeURIComponent(value)).length; }
}

export function createProjectionTrace({ sessionId, socket, window: win = globalThis.window, document: doc = globalThis.document } = {}) {
  const enabled = Boolean(win && validSession(sessionId, win.location?.search));
  const clientId = enabled ? (win.crypto?.randomUUID?.() || createFallbackUuid()) : null;
  const listeners = new Set();
  const archive = [];
  const queue = [];
  let recording = enabled;
  let connected = Boolean(enabled && socket?.getConnected?.());
  let pending = null;
  let sequence = 0;
  let acknowledged = 0;
  let dropped = 0;
  let archiveTruncated = 0;
  let deliveryError = null;
  let batchTimer = null;
  let ackTimer = null;
  let statusTimer = null;
  let disposed = false;

  const now = () => {
    const value = Number(win?.performance?.now?.());
    return Number.isFinite(value) && value >= 0 ? Math.min(value, 1e12) : 0;
  };
  const snapshot = () => Object.freeze({ recording, connected, queued: queue.length, pending: pending ? pending.events.length : 0, pendingBatches: pending ? 1 : 0, acknowledged, dropped, deliveryError, sessionId: enabled ? sessionId : null, clientId });
  const publishNow = () => {
    statusTimer = null;
    const status = snapshot();
    for (const listener of [...listeners]) { try { listener(status); } catch { /* subscriber errors are isolated */ } }
  };
  const publish = () => {
    if (statusTimer !== null || disposed || !listeners.size) return;
    statusTimer = win.setTimeout(publishNow, 50);
  };
  const clearBatchTimer = () => { if (batchTimer !== null) { win.clearTimeout(batchTimer); batchTimer = null; } };
  const clearAckTimer = () => { if (ackTimer !== null) { win.clearTimeout(ackTimer); ackTimer = null; } };
  const scheduleBatch = (delay = BATCH_DELAY_MS) => {
    if (!enabled || disposed || batchTimer !== null || (!queue.length && !pending)) return;
    batchTimer = win.setTimeout(() => { batchTimer = null; flush(); }, delay);
  };
  const sendPending = () => {
    if (!pending || !connected || disposed) return;
    try {
      if (Number(socket?.ws?.bufferedAmount) > MAX_SOCKET_BUFFERED_BYTES) {
        deliveryError = "backpressure"; publish(); scheduleBatch(ACK_TIMEOUT_MS); return;
      }
      const sent = socket?.send?.(pending);
      if (sent !== true) { deliveryError = "send_failed"; publish(); scheduleBatch(ACK_TIMEOUT_MS); return; }
      clearAckTimer();
      ackTimer = win.setTimeout(() => {
        ackTimer = null;
        if (pending && connected && !disposed) {
          if (!deliveryError) deliveryError = "ack_timeout";
          publish();
          sendPending();
        }
      }, ACK_TIMEOUT_MS);
      publish();
    } catch {
      deliveryError = "send_failed";
      publish();
      scheduleBatch(ACK_TIMEOUT_MS);
    }
  };
  function flush() {
    if (!enabled || disposed) return;
    if (pending) { if (connected && !ackTimer) sendPending(); return; }
    if (!queue.length) { publish(); return; }
    if (!connected) { publish(); scheduleBatch(ACK_TIMEOUT_MS); return; }
    const events = [];
    while (queue.length && events.length < MAX_BATCH_EVENTS) {
      const candidate = [...events, queue[0]];
      const envelope = { type: "otef_projection_trace", table: "otef", version: 1, sessionId, clientId, seq: sequence + 1, dropped, events: candidate };
      if (utf8Length(JSON.stringify(envelope)) > MAX_BATCH_BYTES) {
        if (!events.length) { queue.shift(); dropped += 1; continue; }
        break;
      }
      events.push(queue.shift());
    }
    if (events.length) {
      sequence += 1;
      pending = Object.freeze({ type: "otef_projection_trace", table: "otef", version: 1, sessionId, clientId, seq: sequence, dropped, events: Object.freeze(events) });
      sendPending();
    }
    publish();
  }
  const onConnect = () => {
    connected = true; deliveryError = null;
    clearBatchTimer();
    if (pending) { clearAckTimer(); sendPending(); }
    else scheduleBatch(0);
    publish();
  };
  const onDisconnect = () => { connected = false; clearAckTimer(); publish(); };
  const onAck = (message) => {
    if (!pending || !message || message.type !== "otef_projection_trace_ack" || message.version !== 1 || message.sessionId?.toLowerCase?.() !== sessionId.toLowerCase() || message.clientId?.toLowerCase?.() !== clientId.toLowerCase() || message.seq !== pending.seq) return;
    acknowledged += pending.events.length;
    pending = null;
    clearAckTimer();
    deliveryError = null;
    publish();
    if (queue.length) scheduleBatch(0);
  };
  const onTraceError = (message) => {
    if (!pending || !message || message.type !== "otef_projection_trace_error") return;
    if (message.sessionId && message.sessionId.toLowerCase?.() !== sessionId.toLowerCase()) return;
    if (message.clientId && message.clientId.toLowerCase?.() !== clientId.toLowerCase()) return;
    if (message.seq !== undefined && message.seq !== pending.seq) return;
    deliveryError = message.reason === "invalid_batch" || message.reason === "log_failed" ? message.reason : "server_rejected";
    publish();
  };

  if (enabled) {
    socket?.on?.("connect", onConnect);
    socket?.on?.("disconnect", onDisconnect);
    socket?.on?.("otef_projection_trace_ack", onAck);
    socket?.on?.("otef_projection_trace_error", onTraceError);
  }
  return {
    enabled,
    record(kind, detail = {}) {
      if (!enabled || !recording || disposed) return false;
      try {
        if (!KINDS.has(kind)) { dropped += 1; publish(); return false; }
        const safeDetail = cleanDetail(detail);
        if (!safeDetail) { dropped += 1; publish(); return false; }
        const event = Object.freeze({ t: now(), kind, detail: Object.freeze(safeDetail) });
        if (archive.length >= MAX_ARCHIVE) { archive.shift(); archiveTruncated += 1; }
        archive.push(event);
        if (queue.length >= MAX_QUEUE) dropped += 1;
        else queue.push(event);
        publish();
        scheduleBatch();
        return true;
      } catch { dropped += 1; publish(); return false; }
    },
    getStatus: snapshot,
    subscribe(listener) {
      if (typeof listener !== "function") return () => {};
      if (!enabled || disposed) return () => {};
      listeners.add(listener);
      try { listener(snapshot()); } catch { /* subscriber errors are isolated */ }
      return () => listeners.delete(listener);
    },
    stop() {
      if (!enabled || disposed || !recording) return;
      recording = false;
      try {
        const event = Object.freeze({ t: now(), kind: "lifecycle", detail: Object.freeze({ phase: "stop" }) });
        if (archive.length >= MAX_ARCHIVE) { archive.shift(); archiveTruncated += 1; }
        archive.push(event);
        if (queue.length < MAX_QUEUE) queue.push(event);
        else dropped += 1;
      } catch { /* stopping must remain fail-safe */ }
      publish();
      scheduleBatch(0);
    },
    exportJson() {
      try { return JSON.stringify({ type: "otef_projection_trace_export", version: 1, sessionId: enabled ? sessionId : null, clientId, archiveTruncated, status: snapshot(), events: archive }, null, 2); }
      catch { return JSON.stringify({ type: "otef_projection_trace_export", version: 1, events: [] }); }
    },
    dispose() {
      if (disposed) return;
      if (recording) this.stop();
      disposed = true;
      clearBatchTimer(); clearAckTimer();
      if (statusTimer !== null) { win.clearTimeout(statusTimer); statusTimer = null; }
      if (enabled) {
        socket?.off?.("connect", onConnect);
        socket?.off?.("disconnect", onDisconnect);
        socket?.off?.("otef_projection_trace_ack", onAck);
        socket?.off?.("otef_projection_trace_error", onTraceError);
      }
      listeners.clear();
    },
  };
}

function createFallbackUuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === "x" ? random : (random & 3) | 8).toString(16);
  });
}
