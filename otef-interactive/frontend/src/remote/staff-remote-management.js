import { STAFF_REMOTE_MANAGEMENT, validateStaffRemoteMessage } from "../shared/staff-remote-management-protocol.js";
import { createUuid } from "../shared/uuid.js";
import { createStaffRemoteReload } from "./staff-remote-reload.js";

const REMOTE_ID_KEY = "otef-staff-remote-id";

function elapsed(now, then) {
  return Number.isFinite(now) && Number.isFinite(then) ? now - then : NaN;
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

export function createStaffRemoteDocumentIdentity({ storage } = {}) {
  return { remoteId: readRemoteId(storage), instanceId: createUuid() };
}

export function createStaffRemoteManagement({
  socket, buildId = null, getRefreshState = () => ({ ready: false, refreshBlockReason: "not_ready" }),
  readCanonicalState, storage, window: win = globalThis.window, document: doc = globalThis.document,
  wallNow = Date.now, monotonicNow = () => globalThis.performance?.now?.() ?? Date.now(), reload, ids = {}, reloadController, getDeviceId = () => null,
}) {
  const remoteId = isUuid(ids.remoteId) ? ids.remoteId : readRemoteId(storage);
  const instanceId = isUuid(ids.instanceId) ? ids.instanceId : createUuid();
  let connectionSeq = 0;
  let leaseSeq = 0;
  let lastReportWall = NaN;
  let lastReportMono = NaN;
  let timer = null;
  let pending = null;
  let disposed = false;
  const processedRequestIds = new Set();

  const isConnected = () => !disposed && socket?.getConnected?.() === true;
  const reloader = reloadController || createStaffRemoteReload({ getRefreshState, readCanonicalState, isConnected,
    storage, remoteId, wallNow, monotonicNow, reload: reload || (() => win?.location?.reload?.()) });
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
    const receipt = reloader.getOperatorReceipt();
    leaseSeq += 1;
    lastReportWall = wallNow();
    lastReportMono = monotonicNow();
    const message = {
      type: "otef_staff_remote_status", table: "otef", remoteId, instanceId,
      connectionSeq, leaseSeq, buildId: typeof buildId === "string" ? buildId : null,
      visibility: doc?.visibilityState === "hidden" ? "hidden" : "visible",
      ready: state.ready, refreshBlockReason: state.refreshBlockReason,
      reloadReceipt: receipt && state.ready
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
    reportDeviceBinding();
  }
  function onDisconnected() {
    if (pending) pending.invalidated = true;
    reloader.invalidate();
  }
  function onVisible() {
    if (doc?.visibilityState !== "hidden") report({ force: true });
  }
  function onStatusQuery(message) {
    const query = validateStaffRemoteMessage(message);
    if (query?.type === "otef_staff_remote_status_query") { report({ force: true }); reportDeviceBinding(); }
  }

  function reportDeviceBinding() {
    const deviceId = getDeviceId();
    if (!isConnected() || !isUuid(deviceId)) return false;
    return socket.send({ type: "otef_staff_remote_device_bind_v1", table: "otef", deviceId, remoteId, instanceId, connectionSeq }) === true;
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
    if (pending || reloader.isBusy()) {
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
      const outcome = await reloader.attempt({ owner: "operator",
        isCurrent: () => !disposed && pending === token && !token.invalidated && leaseIsCurrent(request.leaseSeq),
        receipt: { schemaVersion: 1, remoteId, sourceId: request.sourceId, requestId: request.requestId, previousInstanceId: instanceId },
        beforeReload: () => sendAck(request, "accepted", null) === true,
      });
      if (disposed || token.invalidated || !isConnected()) return;
      if (outcome.result === "rejected") reject(request, outcome.reason);
      else if (outcome.result === "cancelled" && !leaseIsCurrent(request.leaseSeq)) reject(request, "expired");
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
    getIdentity: () => ({ remoteId, instanceId, connectionSeq }), reportDeviceBinding,
    noteHomeSuccess: () => reloader.noteHomeSuccess(),
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer !== null) globalThis.clearInterval(timer);
      if (pending) pending.invalidated = true;
      if (!reloadController) reloader.dispose();
      else reloader.invalidate("operator");
      socket?.off?.("connect", onConnected);
      socket?.off?.("disconnect", onDisconnected);
      socket?.off?.("connecting", onDisconnected);
      socket?.off?.("otef_staff_remote_status_query", onStatusQuery);
      socket?.off?.("otef_staff_remote_refresh", onRefresh);
      doc?.removeEventListener?.("visibilitychange", onVisible);
    },
  };
}
