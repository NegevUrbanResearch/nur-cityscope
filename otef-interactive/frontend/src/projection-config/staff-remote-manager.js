import { STAFF_REMOTE_MANAGEMENT, validateStaffRemoteMessage } from "../shared/staff-remote-management-protocol.js";
import { createUuid } from "../shared/uuid.js";

const copy = (value) => ({ ...value });

export function createStaffRemoteManager({ socket, sourceId, monotonicNow = () => globalThis.performance?.now?.() ?? Date.now(), timers = globalThis } = {}) {
  const rows = new Map();
  const requests = new Map();
  const retiredDocuments = new Set();
  const retiredConnections = new Set();
  const listeners = new Set();
  let disposed = false;
  let tickTimer = null;
  let connected = socket?.getConnected?.() === true || socket?.isConnected === true;

  const emit = () => { if (!disposed) for (const listener of listeners) listener(getState()); };
  const age = (row) => monotonicNow() - row.receivedAt;
  const rowStatus = (row) => !connected || row.unconfirmed ? "Connection unavailable" : row.disconnected ? "Disconnected" :
    !Number.isFinite(age(row)) || age(row) < 0 ? "Connection unavailable" :
      age(row) > STAFF_REMOTE_MANAGEMENT.STALE_AFTER_MS ? "Not responding" : "Online";
  const ensureTicker = () => { if (tickTimer === null && rows.size) tickTimer = timers.setInterval(emit, 1_000); };
  const canRefresh = (row) => connected && rowStatus(row) === "Online" && Number.isFinite(age(row)) && age(row) >= 0 && age(row) < STAFF_REMOTE_MANAGEMENT.LEASE_MS &&
    row.ready && row.refreshBlockReason === null && !row.pending;
  const blockedCopy = (reason) => ({ not_home: "Return GIS/projection to Home before refreshing", busy: "Remote is busy",
    owned_session: "Close the archive or presentation before refreshing" })[reason] || "Remote is not ready";
  const rowBlockedCopy = (row) => {
    const status = rowStatus(row);
    if (!connected || row.unconfirmed || status === "Connection unavailable") return "Connection unavailable; remote state is unconfirmed";
    if (row.pending) return "Refresh request pending";
    if (status === "Disconnected") return "Disconnected";
    if (status === "Not responding") return "Remote is not responding";
    if (canRefresh(row)) return "";
    if (age(row) >= STAFF_REMOTE_MANAGEMENT.LEASE_MS) return "Remote status is too old to refresh";
    return blockedCopy(row.refreshBlockReason);
  };

  function getState() {
    const visibleKeys = new Set();
    const byRemote = new Map();
    for (const row of rows.values()) {
      if (!byRemote.has(row.remoteId)) byRemote.set(row.remoteId, []);
      byRemote.get(row.remoteId).push(row);
    }
    for (const documents of byRemote.values()) {
      const available = documents.filter((row) => !row.disconnected);
      if (available.length) {
        for (const row of available) visibleKeys.add(`${row.remoteId}:${row.instanceId}`);
        for (const row of documents) if (row.disconnected && row.pending) visibleKeys.add(`${row.remoteId}:${row.instanceId}`);
        continue;
      }
      let latest = documents[0];
      for (const row of documents) if (row.receivedAt > latest.receivedAt) latest = row;
      visibleKeys.add(`${latest.remoteId}:${latest.instanceId}`);
      for (const row of documents) if (row.pending) visibleKeys.add(`${row.remoteId}:${row.instanceId}`);
    }
    return { connectionStatus: connected ? "Connected" : "Connection unavailable", remotes: [...rows.values()].filter((row) =>
      visibleKeys.has(`${row.remoteId}:${row.instanceId}`)).map((row) => ({
      ...copy(row), status: rowStatus(row), ageMs: age(row), actionEnabled: canRefresh(row),
      blockedReason: !connected ? "connection_unavailable" : row.refreshBlockReason,
      blockedCopy: rowBlockedCopy(row),
      archiveSettling: row.refreshBlockReason === "owned_session",
    })) };
  }

  function query() {
    if (!connected || disposed) return;
    socket.send({ type: "otef_staff_remote_subscribe", table: "otef", sourceId });
    socket.send({ type: "otef_staff_remote_status_query", table: "otef", sourceId });
  }

  function acceptStatus(message) {
    const value = validateStaffRemoteMessage(message);
    if (value?.type !== "otef_staff_remote_status") return;
    const key = `${value.remoteId}:${value.instanceId}`;
    if (retiredDocuments.has(key)) return;
    if (retiredConnections.has(`${key}:${value.connectionSeq}`)) return;
    let row = rows.get(key);
    if (row && (value.connectionSeq < row.connectionSeq || (value.connectionSeq === row.connectionSeq && value.leaseSeq <= row.leaseSeq))) return;
    if (row && value.connectionSeq > row.connectionSeq) row.disconnected = false;
    if (!row) row = { remoteId: value.remoteId, instanceId: value.instanceId, connectionSeq: 0, leaseSeq: 0 };
    Object.assign(row, {
      remoteId: value.remoteId, instanceId: value.instanceId, connectionSeq: value.connectionSeq, leaseSeq: value.leaseSeq,
      sessionId: `${value.remoteId.slice(0, 8)} · ${value.instanceId.slice(-4)}`, version: value.buildId ? value.buildId : null, visibility: value.visibility,
      ready: value.ready, refreshBlockReason: value.refreshBlockReason, disconnected: false,
      unconfirmed: false, receivedAt: monotonicNow(), actionStatus: row.actionStatus || "", pending: row.pending || null,
    });
    rows.set(key, row);
    ensureTicker();
    const receipt = value.reloadReceipt;
    if (receipt) {
      for (const record of requests.values()) {
        if (value.ready && ["pending", "accepted", "timed_out"].includes(record.state) && record.target.remoteId === value.remoteId && record.target.instanceId === receipt.previousInstanceId &&
            receipt.sourceId === sourceId && receipt.requestId === record.request.requestId && value.instanceId !== receipt.previousInstanceId) {
          record.state = "complete";
          if (!row.pending || row.pending === record.request.requestId) {
            row.actionStatus = "Tablet reloaded to Home";
            row.pending = null;
          }
          if (record.timer !== null) timers.clearTimeout(record.timer);
          const oldKey = `${value.remoteId}:${receipt.previousInstanceId}`;
          rows.delete(oldKey);
          retiredDocuments.add(oldKey);
          for (const other of requests.values()) {
            if (other !== record && other.target.remoteId === value.remoteId && other.target.instanceId === receipt.previousInstanceId &&
                ["pending", "accepted", "timed_out"].includes(other.state)) {
              if (other.timer !== null) timers.clearTimeout(other.timer);
              other.state = "retired";
            }
          }
        }
      }
    }
    emit();
  }

  function acceptDisconnect(message) {
    const value = validateStaffRemoteMessage(message);
    if (value?.type !== "otef_staff_remote_disconnected") return;
    retiredConnections.add(`${value.remoteId}:${value.instanceId}:${value.connectionSeq}`);
    const row = rows.get(`${value.remoteId}:${value.instanceId}`);
    if (!row || value.connectionSeq !== row.connectionSeq) return;
    row.disconnected = true;
    emit();
  }

  function acceptAck(message) {
    const value = validateStaffRemoteMessage(message);
    if (value?.type !== "otef_staff_remote_refresh_ack" || value.sourceId !== sourceId) return;
    const record = requests.get(value.requestId);
    if (!record || record.target.remoteId !== value.remoteId || record.target.instanceId !== value.instanceId ||
        record.target.connectionSeq !== value.connectionSeq || record.state !== "pending") return;
    const row = rows.get(`${value.remoteId}:${value.instanceId}`);
    if (!row) return;
    if (value.result === "accepted") {
      record.state = "accepted";
      const ownsRow = row.pending === value.requestId;
      if (ownsRow) row.actionStatus = "Reload accepted";
      timers.clearTimeout(record.timer);
      record.timer = timers.setTimeout(() => {
        if (record.state === "accepted") {
          record.state = "timed_out";
          const current = rows.get(`${value.remoteId}:${value.instanceId}`);
          if (current?.pending === value.requestId) { current.pending = null; current.actionStatus = "Refresh not confirmed"; emit(); }
        }
      }, 30_000);
    } else {
      record.state = "rejected";
      timers.clearTimeout(record.timer);
      if (row.pending === value.requestId) {
        row.pending = null;
        row.actionStatus = value.reason === "not_home" ? "Return GIS/projection to Home before refreshing" :
          value.reason === "busy" || value.reason === "owned_session" ? blockedCopy(value.reason) : "Refresh not confirmed";
      }
    }
    emit();
  }

  function refresh(target) {
    if (disposed || !target) return false;
    const row = rows.get(`${target.remoteId}:${target.instanceId}`);
    if (!row || !canRefresh(row)) return false;
    const request = { type: "otef_staff_remote_refresh", table: "otef", sourceId, requestId: createUuid(),
      remoteId: row.remoteId, instanceId: row.instanceId, connectionSeq: row.connectionSeq, leaseSeq: row.leaseSeq };
    const record = { request, target: { ...row }, state: "pending", timer: null };
    requests.set(request.requestId, record);
    row.pending = request.requestId;
    row.actionStatus = "";
    const sent = socket.send(request) === true;
    if (!sent) {
      record.state = "failed";
      row.pending = null;
      row.actionStatus = "Refresh not sent";
      emit();
      return false;
    }
    record.timer = timers.setTimeout(() => {
      if (record.state === "pending") {
        record.state = "timed_out";
        const current = rows.get(`${row.remoteId}:${row.instanceId}`);
        if (current?.pending === request.requestId) { current.pending = null; current.actionStatus = "Refresh not confirmed"; emit(); }
      }
    }, 5_000);
    emit();
    return true;
  }

  function onConnect() { connected = true; query(); ensureTicker(); emit(); }
  function onDisconnect() { connected = false; for (const row of rows.values()) row.unconfirmed = true; emit(); }
  socket?.on?.("connect", onConnect);
  socket?.on?.("disconnect", onDisconnect);
  socket?.on?.("otef_staff_remote_status", acceptStatus);
  socket?.on?.("otef_staff_remote_disconnected", acceptDisconnect);
  socket?.on?.("otef_staff_remote_refresh_ack", acceptAck);
  if (connected) query();
  ensureTicker();

  return {
    getState,
    subscribe(listener) { listeners.add(listener); listener(getState()); return () => listeners.delete(listener); },
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (tickTimer !== null) timers.clearInterval(tickTimer);
      for (const record of requests.values()) if (record.timer !== null) timers.clearTimeout(record.timer);
      for (const type of ["connect", "disconnect", "otef_staff_remote_status", "otef_staff_remote_disconnected", "otef_staff_remote_refresh_ack"]) socket?.off?.(type, { connect: onConnect, disconnect: onDisconnect, otef_staff_remote_status: acceptStatus, otef_staff_remote_disconnected: acceptDisconnect, otef_staff_remote_refresh_ack: acceptAck }[type]);
      listeners.clear();
    },
  };
}
