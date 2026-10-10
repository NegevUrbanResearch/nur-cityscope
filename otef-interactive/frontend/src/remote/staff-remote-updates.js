import { isDeviceId, isBuildId } from "../shared/staff-remote-update-api.js";
import { validateStaffRemoteMessage } from "../shared/staff-remote-management-protocol.js";
import { createUuid } from "../shared/uuid.js";

const DEVICE_KEY = "otef-exhibit-device-id";
const DISMISS_KEY = "otef-exhibit-dismissed-notice";

export function createStaffRemoteUpdates({ api, readBuildId, loadedBuildId, socket, reloadController,
  getIdentity, reportBinding = () => {}, getRefreshState, localStorage: storage,
  document: doc = globalThis.document, window: win = globalThis.window }) {
  let candidate = null, dismissed = null;
  try {
    const saved = storage?.getItem(DEVICE_KEY);
    candidate = isDeviceId(saved) ? saved : null;
    const value = JSON.parse(storage?.getItem(DISMISS_KEY) || "null");
    if (isDeviceId(value?.deviceId) && Number.isSafeInteger(value?.revision) && value.revision >= 0) dismissed = value;
  } catch { /* registration will explain unavailable persistence on an explicit action */ }
  let management = null, servedBuildId = null, registered = false, error = null;
  let disposed = false, checking = false, setupPending = false, navigating = false;
  let failureRevision = null, openedRevision = null, reopenedRevision = null;
  let attemptGeneration = 0, observedRevision = 0, inFlight = null, reconcilePending = false;
  const listeners = new Set();
  const connected = () => socket?.getConnected?.() === true;
  const refreshState = () => { try { return getRefreshState() || {}; } catch { return {}; } };
  const applicable = () => registered && management?.notice && isBuildId(servedBuildId) &&
    management.notice.targetBuildId === servedBuildId && loadedBuildId !== servedBuildId && !navigating;
  const isDismissed = () => dismissed?.deviceId === candidate && dismissed?.revision === management?.revision;

  function getState() {
    const local = refreshState();
    const safe = connected() && local.ready === true && local.refreshBlockReason === null;
    let mode = "hidden";
    if (applicable()) {
      if (checking) mode = "checking";
      else if (!connected() && openedRevision === management.revision && !isDismissed()) mode = "offline";
      else if (!safe || (isDismissed() && reopenedRevision !== management.revision) || doc?.visibilityState === "hidden") mode = "reminder";
      else mode = failureRevision === management.revision ? "failed" : "ready";
      if (["ready", "checking", "failed"].includes(mode)) openedRevision = management.revision;
    }
    return { mode, registration: registered ? "registered" : "unregistered", canRefresh: Boolean(applicable() && safe && !checking),
      setupPending, activeDeviceId: management?.deviceId ?? null, noticeRevision: management?.notice?.revision ?? null, error };
  }
  const emit = () => { if (!disposed) { const state = getState(); for (const listener of listeners) listener(state); } };
  function cancelAttempt() {
    attemptGeneration += 1;
    checking = false;
    reloadController.invalidate("notice");
  }
  function acceptState(value, buildId) {
    if (value.revision < observedRevision) return;
    const wasRegistered = registered;
    if (management && (management.deviceId !== value.deviceId || management.revision !== value.revision)) {
      cancelAttempt(); failureRevision = null; reopenedRevision = null; openedRevision = null;
    }
    management = value;
    observedRevision = Math.max(observedRevision, value.revision);
    servedBuildId = buildId;
    registered = Boolean(candidate && value.deviceId === candidate);
    if (!registered) cancelAttempt();
    if (wasRegistered && !registered) reloadController.invalidate();
    checkNoticeReceipt();
  }
  function checkNoticeReceipt() {
    const receipt = reloadController.getNoticeReceipt();
    if (registered && refreshState().ready === true && receipt?.deviceId === candidate && receipt.noticeRevision === management?.revision &&
        receipt.targetBuildId === management?.notice?.targetBuildId && loadedBuildId !== receipt.targetBuildId) failureRevision = management.revision;
  }
  function reconcile() {
    if (disposed) return Promise.resolve();
    if (inFlight) { reconcilePending = true; return inFlight; }
    inFlight = (async () => {
      do {
        reconcilePending = false;
        try {
          const [value, build] = await Promise.all([api.read({ deviceId: candidate || undefined }), readBuildId()]);
          if (disposed) return;
          error = null; acceptState(value, build);
        } catch (failure) {
          if (disposed) return;
          error = failure.code || "state_unavailable";
          if (failure.code === "unregistered") { management = failure.state || management; registered = false; cancelAttempt(); reloadController.invalidate(); }
        }
        emit();
      } while (reconcilePending && !disposed);
    })().finally(() => { inFlight = null; });
    return inFlight;
  }
  async function register({ replaceDeviceId = null } = {}) {
    if (disposed || setupPending) return;
    setupPending = true; error = null; emit();
    try {
      if (!candidate) {
        const id = createUuid();
        if (!storage?.setItem) throw Error("storage unavailable");
        storage.setItem(DEVICE_KEY, id); candidate = id;
      } else storage.setItem(DEVICE_KEY, candidate);
      reportBinding();
      const initial = await api.read();
      const value = await api.register({ deviceId: candidate, expectedRevision: initial.revision, replaceDeviceId });
      if (disposed) return;
      acceptState(value, servedBuildId); reportBinding();
      await reconcile();
      return value;
    } catch (failure) {
      if (!disposed) {
        error = failure.code || (candidate ? "state_unavailable" : "storage_unavailable");
        if (failure.state) management = failure.state;
      }
    } finally { setupPending = false; emit(); }
  }
  async function refresh() {
    if (disposed || !getState().canRefresh) return { result: "cancelled", reason: null };
    const deviceId = candidate, revision = management.revision, targetBuildId = management.notice.targetBuildId;
    const identity = getIdentity();
    const generation = ++attemptGeneration;
    const current = () => !disposed && generation === attemptGeneration && registered && candidate === deviceId &&
      management?.revision === revision && connected() && getIdentity().connectionSeq === identity.connectionSeq &&
      refreshState().ready === true && refreshState().refreshBlockReason === null;
    checking = true; error = null; emit();
    try {
      const [value, build] = await Promise.all([api.read({ deviceId }), readBuildId()]);
      if (!current()) return { result: "cancelled", reason: null };
      if (value.deviceId !== deviceId || value.revision !== revision || value.notice?.targetBuildId !== targetBuildId || build !== targetBuildId) {
        acceptState(value, build); cancelAttempt();
        return { result: "cancelled", reason: null };
      }
      const result = await reloadController.attempt({ owner: "notice", isCurrent: current,
        receipt: { schemaVersion: 2, origin: "notice", remoteId: identity.remoteId, deviceId, noticeRevision: revision,
          targetBuildId, previousInstanceId: identity.instanceId, requestId: createUuid() } });
      if (result.result === "reloaded") navigating = true;
      else if (current() && result.result === "rejected") { failureRevision = revision; error = result.reason; }
      return result;
    } catch (failure) {
      if (current()) { failureRevision = revision; error = failure.code || "state_unavailable"; }
      if (failure.code === "unregistered") { registered = false; cancelAttempt(); reloadController.invalidate(); }
      return { result: "cancelled", reason: null };
    } finally { if (generation === attemptGeneration) checking = false; emit(); }
  }
  function dismiss() {
    cancelAttempt(); reopenedRevision = null;
    if (candidate && management?.notice) {
      dismissed = { deviceId: candidate, revision: management.revision };
      try { storage?.setItem(DISMISS_KEY, JSON.stringify(dismissed)); } catch { error = "storage_unavailable"; }
    }
    emit();
  }
  function onChanged(message) {
    const value = validateStaffRemoteMessage(message);
    if (value?.type !== "otef_staff_remote_notice_changed_v1") return;
    if (value.revision > observedRevision) { observedRevision = value.revision; cancelAttempt(); }
    void reconcile();
  }
  function onConnect() { reportBinding(); void reconcile(); }
  function onDisconnect() { cancelAttempt(); emit(); }
  function onVisible() { if (doc?.visibilityState !== "hidden") void reconcile(); }
  function onPageShow(event) { if (event.persisted) void reconcile(); }
  socket?.on?.("connect", onConnect); socket?.on?.("disconnect", onDisconnect);
  socket?.on?.("otef_staff_remote_notice_changed_v1", onChanged);
  doc?.addEventListener?.("visibilitychange", onVisible);
  win?.addEventListener?.("pageshow", onPageShow); win?.addEventListener?.("online", onVisible);
  if (connected()) reportBinding();
  void reconcile();
  return { register, reconcile, refresh, dismiss, getState,
    getStoredDeviceId: () => candidate,
    reopen() { if (applicable() && connected() && refreshState().refreshBlockReason === null) reopenedRevision = management.revision; emit(); },
    refreshStateChanged() { if (checking && !getState().canRefresh && refreshState().refreshBlockReason !== null) cancelAttempt(); checkNoticeReceipt(); emit(); },
    subscribe(listener) { listeners.add(listener); listener(getState()); return () => listeners.delete(listener); },
    dispose() {
      disposed = true; cancelAttempt(); listeners.clear();
      socket?.off?.("connect", onConnect); socket?.off?.("disconnect", onDisconnect);
      socket?.off?.("otef_staff_remote_notice_changed_v1", onChanged);
      doc?.removeEventListener?.("visibilitychange", onVisible);
      win?.removeEventListener?.("pageshow", onPageShow); win?.removeEventListener?.("online", onVisible);
    },
  };
}
