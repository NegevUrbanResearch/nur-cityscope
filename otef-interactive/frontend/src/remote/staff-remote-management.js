import { STAFF_REMOTE_MANAGEMENT, validateStaffRemoteMessage } from "../shared/staff-remote-management-protocol.js";
import { withRequestDeadline } from "../shared/request-deadline.js";
import { createUuid } from "../shared/uuid.js";
import { isCanonicalHome } from "./staff-remote-refresh-guard.js";

const REMOTE_ID_KEY = "otef-staff-remote-id";
const RECEIPT_KEY = "otef-staff-remote-reload-receipt";
const RECEIPT_MAX_AGE_MS = 60_000;
const RECEIPT_MAX_BYTES = 512;
const FRESH_READ_TIMEOUT_MS = 3_000;

function elapsed(now, then) {
  return Number.isFinite(now) && Number.isFinite(then) ? now - then : NaN;
}

function validReceipt(raw, remoteId, nowMs) {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > RECEIPT_MAX_BYTES) return null;
  try {
    const receipt = JSON.parse(raw);
    const age = nowMs - receipt.savedAtMs;
    const expectedKeys = ["schemaVersion", "remoteId", "sourceId", "requestId", "previousInstanceId", "savedAtMs"];
    if (!receipt || receipt.schemaVersion !== 1 || receipt.remoteId !== remoteId ||
        Object.keys(receipt).sort().join("\0") !== expectedKeys.sort().join("\0") ||
        ![receipt.remoteId, receipt.sourceId, receipt.requestId, receipt.previousInstanceId].every(isUuid) ||
        !Number.isSafeInteger(receipt.savedAtMs) || receipt.savedAtMs < 0 || age < 0 || age > RECEIPT_MAX_AGE_MS) return null;
    return receipt;
  } catch {
    return null;
  }
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

function readRemoteId(storage) {
  try {
    const stored = storage?.getItem(REMOTE_ID_KEY);
    if (isUuid(stored)) return stored;
    const generated = createUuid();
    storage?.setItem(REMOTE_ID_KEY, generated);
    return generated;
  } catch {
    return createUuid();
  }
}

export function createStaffRemoteManagement({
  socket, buildId = null, getRefreshState = () => ({ ready: false, refreshBlockReason: "not_ready" }),
  readCanonicalState, storage, window: win = globalThis.window, document: doc = globalThis.document,
  wallNow = Date.now, monotonicNow = () => globalThis.performance?.now?.() ?? Date.now(), reload, ids = {},
}) {
  const remoteId = isUuid(ids.remoteId) ? ids.remoteId : readRemoteId(storage);
  const instanceId = isUuid(ids.instanceId) ? ids.instanceId : createUuid();
  let connectionSeq = 0;
  let leaseSeq = 0;
  let lastReportWall = NaN;
  let lastReportMono = NaN;
  let timer = null;
  let pending = null;
  let reloadIssued = false;
  let disposed = false;
  let receipt = null;
  let receiptHomeAtMono = null;
  const processedRequestIds = new Set();

  try {
    const raw = storage?.getItem(RECEIPT_KEY);
    receipt = validReceipt(raw, remoteId, wallNow());
    storage?.removeItem(RECEIPT_KEY);
    if (!receipt && raw !== null) storage?.removeItem(RECEIPT_KEY);
  } catch {
    receipt = null;
  }

  const isConnected = () => !disposed && socket?.getConnected?.() === true;
  const localState = () => {
    try {
      const state = getRefreshState?.() || {};
      const allowed = state.refreshBlockReason === null ||
        ["not_ready", "not_home", "busy", "owned_session"].includes(state.refreshBlockReason);
      if (typeof state.ready !== "boolean" || !allowed) return { ready: false, refreshBlockReason: "not_ready" };
      return {
        ready: state.ready,
        refreshBlockReason: state.refreshBlockReason,
      };
    } catch {
      return { ready: false, refreshBlockReason: "not_ready" };
    }
  };

  function report({ force = false } = {}) {
    if (disposed || !isConnected()) return false;
    const ws = socket.ws;
    if (!force && Number(ws?.bufferedAmount) > STAFF_REMOTE_MANAGEMENT.MAX_BUFFERED_BYTES) return false;
    const state = localState();
    if (receiptHomeAtMono !== null && elapsed(monotonicNow(), receiptHomeAtMono) >= RECEIPT_MAX_AGE_MS) {
      try { storage?.removeItem(RECEIPT_KEY); } catch { /* best effort cleanup */ }
      receipt = null;
      receiptHomeAtMono = null;
    }
    leaseSeq += 1;
    lastReportWall = wallNow();
    lastReportMono = monotonicNow();
    const message = {
      type: "otef_staff_remote_status", table: "otef", remoteId, instanceId,
      connectionSeq, leaseSeq, buildId: typeof buildId === "string" ? buildId : null,
      visibility: doc?.visibilityState === "hidden" ? "hidden" : "visible",
      ready: state.ready, refreshBlockReason: state.refreshBlockReason,
      reloadReceipt: receipt && state.ready && receiptHomeAtMono !== null
        ? { sourceId: receipt.sourceId, requestId: receipt.requestId, previousInstanceId: receipt.previousInstanceId }
        : null,
    };
    if (new TextEncoder().encode(JSON.stringify(message)).byteLength >= STAFF_REMOTE_MANAGEMENT.MAX_REPORT_BYTES) return false;
    return socket.send(message) === true;
  }

  function onConnected() {
    connectionSeq += 1;
    leaseSeq = 0;
    report({ force: true });
  }
  function onDisconnected() {
    if (pending) pending.invalidated = true;
  }
  function onVisible() {
    if (doc?.visibilityState !== "hidden") report({ force: true });
  }
  function onStatusQuery(message) {
    const query = validateStaffRemoteMessage(message);
    if (query?.type === "otef_staff_remote_status_query") report({ force: true });
  }

  function leaseIsCurrent(targetLease) {
    if (!isConnected() || targetLease !== leaseSeq) return false;
    const wallAge = elapsed(wallNow(), lastReportWall);
    const monoAge = elapsed(monotonicNow(), lastReportMono);
    return wallAge >= 0 && wallAge <= STAFF_REMOTE_MANAGEMENT.LEASE_MS &&
      monoAge >= 0 && monoAge <= STAFF_REMOTE_MANAGEMENT.LEASE_MS;
  }

  function sendAck(request, result, reason) {
    return socket.send({ type: "otef_staff_remote_refresh_ack", table: "otef", sourceId: request.sourceId,
      requestId: request.requestId, remoteId, instanceId, connectionSeq,
      result, reason: result === "accepted" ? null : reason });
  }

  function reject(request, reason) {
    sendAck(request, "rejected", reason);
  }

  async function onRefresh(incoming) {
    const request = validateStaffRemoteMessage(incoming);
    if (request?.type !== "otef_staff_remote_refresh" || request.table !== "otef" ||
        request.remoteId !== remoteId || request.instanceId !== instanceId || request.connectionSeq !== connectionSeq) return;
    if (processedRequestIds.has(request.requestId)) return;
    processedRequestIds.add(request.requestId);
    if (reloadIssued || pending) {
      if (pending && request.requestId === pending.request.requestId) return;
      reject(request, "busy");
      return;
    }
    if (!leaseIsCurrent(request.leaseSeq)) {
      reject(request, "expired");
      return;
    }
    const before = localState();
    if (!before.ready || (before.refreshBlockReason && before.refreshBlockReason !== "not_home")) {
      reject(request, before.refreshBlockReason || "not_ready");
      return;
    }
    const token = { request, invalidated: false };
    pending = token;
    try {
      if (typeof readCanonicalState !== "function") throw new Error("canonical state reader unavailable");
      const snapshot = await withRequestDeadline((signal) => readCanonicalState({ signal }), { timeoutMs: FRESH_READ_TIMEOUT_MS });
      if (disposed || pending !== token || token.invalidated) return;
      const after = localState();
      if (!isConnected()) return;
      if (!after.ready || (after.refreshBlockReason && after.refreshBlockReason !== "not_home")) {
        reject(request, after.refreshBlockReason || "not_ready");
        return;
      }
      if (!leaseIsCurrent(request.leaseSeq)) {
        reject(request, "expired");
        return;
      }
      if (!isCanonicalHome(snapshot)) {
        reject(request, "not_home");
        return;
      }
      const receiptValue = { schemaVersion: 1, remoteId, sourceId: request.sourceId, requestId: request.requestId,
        previousInstanceId: instanceId, savedAtMs: wallNow() };
      const encoded = JSON.stringify(receiptValue);
      if (new TextEncoder().encode(encoded).byteLength > RECEIPT_MAX_BYTES) {
        reject(request, "storage_unavailable");
        return;
      }
      try {
        if (!storage || typeof storage.setItem !== "function") throw new Error("session storage unavailable");
        storage.setItem(RECEIPT_KEY, encoded);
      }
      catch { reject(request, "storage_unavailable"); return; }
      if (!sendAck(request, "accepted", null)) {
        try { storage?.removeItem(RECEIPT_KEY); } catch { /* best effort rollback */ }
        return;
      }
      reloadIssued = true;
      try {
        if (typeof reload === "function") reload();
        else win?.location?.reload?.();
      } catch { /* acceptance was already acknowledged; never send a contradictory rejection */ }
    } catch {
      if (disposed || pending !== token || token.invalidated) return;
      reject(request, "state_unavailable");
    } finally {
      if (pending === token) pending = null;
    }
  }

  socket?.on?.("connect", onConnected);
  socket?.on?.("disconnect", onDisconnected);
  socket?.on?.("connecting", onDisconnected);
  socket?.on?.("otef_staff_remote_status_query", onStatusQuery);
  socket?.on?.("otef_staff_remote_refresh", onRefresh);
  doc?.addEventListener?.("visibilitychange", onVisible);
  if (isConnected()) onConnected();
  timer = globalThis.setInterval(() => report(), STAFF_REMOTE_MANAGEMENT.HEARTBEAT_MS);

  return {
    noteHomeSuccess() {
      if (receipt && receiptHomeAtMono === null) receiptHomeAtMono = monotonicNow();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer !== null) globalThis.clearInterval(timer);
      if (pending) pending.invalidated = true;
      socket?.off?.("connect", onConnected);
      socket?.off?.("disconnect", onDisconnected);
      socket?.off?.("connecting", onDisconnected);
      socket?.off?.("otef_staff_remote_status_query", onStatusQuery);
      socket?.off?.("otef_staff_remote_refresh", onRefresh);
      doc?.removeEventListener?.("visibilitychange", onVisible);
    },
  };
}
