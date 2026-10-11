import { withRequestDeadline } from "../shared/request-deadline.js";
import { isDeviceId, isBuildId } from "../shared/staff-remote-update-api.js";
import { isCanonicalHome } from "./staff-remote-refresh-guard.js";

const RECEIPT_KEY = "otef-staff-remote-reload-receipt";
const MAX_AGE = 60000;

function parseReceipt(raw, remoteId, now) {
  if (typeof raw !== "string" || new TextEncoder().encode(raw).byteLength > 512) return null;
  try {
    const value = JSON.parse(raw);
    const notice = value.schemaVersion === 2 && value.origin === "notice";
    const names = notice ? ["schemaVersion", "origin", "remoteId", "deviceId", "noticeRevision", "targetBuildId", "previousInstanceId", "requestId", "savedAtMs"] :
      ["schemaVersion", "remoteId", "sourceId", "requestId", "previousInstanceId", "savedAtMs"];
    const ids = notice ? [value.deviceId, value.requestId, value.previousInstanceId] : [value.sourceId, value.requestId, value.previousInstanceId];
    if (Object.keys(value).sort().join() !== names.sort().join() || (!notice && value.schemaVersion !== 1) ||
        value.remoteId !== remoteId || !isDeviceId(value.remoteId) || !ids.every(isDeviceId) ||
        !Number.isSafeInteger(value.savedAtMs) || value.savedAtMs < 0 || now - value.savedAtMs < 0 || now - value.savedAtMs > MAX_AGE ||
        (notice && (!Number.isSafeInteger(value.noticeRevision) || value.noticeRevision <= 0 || !isBuildId(value.targetBuildId)))) return null;
    return value;
  } catch { return null; }
}

export function createStaffRemoteReload({ getRefreshState = () => ({ ready: false, refreshBlockReason: "not_ready" }),
  readCanonicalState, isConnected = () => false, storage, remoteId, wallNow = Date.now,
  monotonicNow = () => globalThis.performance?.now?.() ?? Date.now(), reload = () => globalThis.window?.location?.reload() } = {}) {
  let pending = null, issued = false, disposed = false, receipt = null, homeAt = null;
  try { receipt = parseReceipt(storage?.getItem(RECEIPT_KEY), remoteId, wallNow()); storage?.removeItem(RECEIPT_KEY); } catch { /* unavailable storage prevents a later attempt */ }
  function retainedReceipt() {
    if (homeAt !== null && monotonicNow() - homeAt >= MAX_AGE) receipt = null;
    return receipt;
  }
  function blockReason() {
    try {
      const value = getRefreshState();
      if (value?.ready !== true || ![null, "not_home", "busy", "owned_session"].includes(value.refreshBlockReason)) return "not_ready";
      return value.refreshBlockReason === "not_home" ? null : value.refreshBlockReason;
    } catch { return "not_ready"; }
  }
  const rejected = reason => ({ result: "rejected", reason });
  const cancelled = () => ({ result: "cancelled", reason: null });
  async function attempt({ owner, isCurrent, receipt: metadata, beforeReload = () => true }) {
    if (disposed) return cancelled();
    if (issued || pending) return rejected("busy");
    const token = { owner, controller: new AbortController(), invalidated: false };
    const current = () => !disposed && !token.invalidated && pending === token && isConnected() && isCurrent();
    pending = token;
    try {
      if (!current()) return cancelled();
      const before = blockReason();
      if (before) return rejected(before);
      const snapshot = await withRequestDeadline(signal => readCanonicalState({ signal }), { timeoutMs: 3000, signal: token.controller.signal });
      if (!current()) return cancelled();
      const after = blockReason();
      if (after) return rejected(after);
      if (!isCanonicalHome(snapshot)) return rejected("not_home");
      const encoded = JSON.stringify({ ...metadata, savedAtMs: wallNow() });
      if (!parseReceipt(encoded, remoteId, wallNow())) return rejected("storage_unavailable");
      if (!current()) return cancelled();
      try {
        if (!storage?.setItem) throw Error("storage unavailable");
        storage.setItem(RECEIPT_KEY, encoded);
      } catch { return rejected("storage_unavailable"); }
      if (!current() || beforeReload() !== true || !current()) {
        try { storage.removeItem(RECEIPT_KEY); } catch { /* best effort */ }
        return cancelled();
      }
      issued = true;
      try { reload(); } catch {
        // Operator acceptance has already been sent; a presenter attempt has no ACK to contradict.
        if (owner === "notice") {
          issued = false;
          try { storage.removeItem(RECEIPT_KEY); } catch { /* best effort */ }
          return rejected("state_unavailable");
        }
      }
      return { result: "reloaded", reason: null };
    } catch {
      return current() ? rejected("state_unavailable") : cancelled();
    } finally { if (pending === token) pending = null; }
  }
  function invalidate(owner) {
    if (pending && (!owner || owner === pending.owner)) { pending.invalidated = true; pending.controller.abort(); }
  }
  return { attempt, invalidate, isBusy: () => issued || pending !== null,
    noteHomeSuccess() { if (receipt && homeAt === null) homeAt = monotonicNow(); },
    getOperatorReceipt() { const value = retainedReceipt(); return value?.schemaVersion === 1 && homeAt !== null ? value : null; },
    getNoticeReceipt() { const value = retainedReceipt(); return value?.origin === "notice" ? value : null; },
    dispose() { disposed = true; invalidate(); },
  };
}
