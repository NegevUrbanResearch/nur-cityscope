import { OTEF_MESSAGE_TYPES } from "../shared/message-protocol.js";
import { validateRoadSignSettings } from "../shared/road-sign-settings.js";
import { createUuid } from "../shared/uuid.js";

const EVENT = OTEF_MESSAGE_TYPES.ROAD_SIGNS_CHANGED;
const NUMERIC_DEBOUNCE_MS = 150;
const clone = (value) => value == null ? value : structuredClone(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function readSnapshot(snapshot = {}) {
  const settings = Object.prototype.hasOwnProperty.call(snapshot, "roadSignSettings")
    ? snapshot.roadSignSettings : snapshot.road_sign_settings;
  const revision = Object.prototype.hasOwnProperty.call(snapshot, "roadSignRevision")
    ? snapshot.roadSignRevision : snapshot.road_sign_revision;
  const checked = validateRoadSignSettings(settings);
  if (!checked.valid) throw new TypeError(checked.error || "Invalid Road 232 sign settings");
  if (!Number.isSafeInteger(revision) || revision < 0) throw new TypeError("Invalid Road 232 sign revision");
  return { settings: checked.settings, revision };
}

function conflictError() {
  return Object.assign(new Error("Road 232 signs changed on the server"), { code: "conflict", status: 409 });
}

export function createRoadSignClient({ getSnapshot, writeSettings, socket = null, tableName = "otef" }) {
  const listeners = new Set();
  let acknowledged = null;
  let revision = -1;
  let draft = null;
  let generation = 0;
  let baseline = null;
  let status = "Loading";
  let error = null;
  let conflict = null;
  let pending = false;
  let timer = null;
  let destroyed = false;
  let writeQueue = Promise.resolve();
  let hydrateGeneration = 0;
  let reconnectGeneration = 0;
  let refreshing = false;
  let disconnected = false;
  let connectedBefore = false;
  let writesBlocked = false;
  let lastFailure = null;
  let inFlight = null;
  const waiters = [];

  function getState() {
    return clone({ acknowledged, revision, draft, dirty: draft !== null && !same(draft, acknowledged), pending: pending || inFlight !== null,
      conflict, error, status });
  }

  function emit() {
    if (destroyed) return;
    const state = getState();
    for (const listener of listeners) listener(state);
  }

  function hasUnsavedWork() {
    return pending || timer !== null || draft !== null || inFlight !== null;
  }

  function notifyWaitersThrough(sentGeneration, result) {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (waiter.generation > sentGeneration) continue;
      waiters.splice(index, 1);
      result instanceof Error ? waiter.reject(result) : waiter.resolve(result);
    }
  }

  function setConflict(settings, incomingRevision) {
    if (incomingRevision < revision) return false;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    acknowledged = clone(settings);
    revision = incomingRevision;
    conflict = { settings: clone(settings), revision: incomingRevision };
    status = "Conflict";
    error = "Road 232 signs changed on the server";
    pending = false;
    baseline = baseline || { settings: clone(settings), revision: incomingRevision };
    notifyWaitersThrough(generation, { status: "Conflict", revision: incomingRevision });
    emit();
    return true;
  }

  function markAcknowledged(settings, incomingRevision, sentGeneration) {
    if (incomingRevision < revision) return false;
    if (incomingRevision === revision && !same(settings, acknowledged)) return false;
    acknowledged = clone(settings);
    revision = incomingRevision;
    if (generation === sentGeneration && draft !== null && same(draft, settings)) {
      draft = null;
      baseline = null;
      conflict = null;
      error = null;
      status = "Saved";
      notifyWaitersThrough(sentGeneration, { status: "ok", revision });
    } else if (draft !== null) {
      baseline = { settings: clone(acknowledged), revision };
      conflict = null;
      error = null;
      status = "Saving";
      notifyWaitersThrough(sentGeneration, { status: "ok", revision });
    } else {
      baseline = null;
      conflict = null;
      error = null;
      status = "Saved";
      notifyWaitersThrough(sentGeneration, { status: "ok", revision });
    }
    emit();
    return true;
  }

  function acceptSnapshot(snapshot, { authoritative = false, sent = null } = {}) {
    const incoming = readSnapshot(snapshot);
    if (revision >= 0 && incoming.revision < revision) return false;
    if (sent && incoming.revision > sent.baseRevision && same(incoming.settings, sent.settings)) {
      return markAcknowledged(incoming.settings, incoming.revision, sent.generation);
    }
    if (revision >= 0 && incoming.revision === revision) {
      if (same(incoming.settings, acknowledged)) return false;
      if (!authoritative) {
        void refreshFresh();
        return false;
      }
      if (draft !== null && !same(incoming.settings, acknowledged)) {
        setConflict(incoming.settings, incoming.revision);
        return false;
      }
    }
    if (draft !== null && acknowledged !== null) {
      if (incoming.revision === baseline?.revision && same(incoming.settings, baseline.settings)) return false;
      if (same(incoming.settings, acknowledged) && incoming.revision > revision) {
        revision = incoming.revision;
        baseline = { settings: clone(acknowledged), revision };
        emit();
        return true;
      }
      setConflict(incoming.settings, incoming.revision);
      return false;
    }
    acknowledged = clone(incoming.settings);
    revision = incoming.revision;
    error = null;
    conflict = null;
    status = "Saved";
    baseline = null;
    emit();
    return true;
  }

  async function refreshFresh(sent = null) {
    if (refreshing || destroyed) return false;
    const capturedSent = sent || inFlight;
    refreshing = true;
    try {
      const snapshot = await getSnapshot({ forceFresh: true });
      if (destroyed) return false;
      return acceptSnapshot(snapshot, { authoritative: true, sent: capturedSent || inFlight });
    } catch (refreshError) {
      if (!destroyed) {
        error = refreshError?.message || "Road 232 signs unavailable";
        if (draft !== null && status !== "Conflict") status = "Failed";
        emit();
      }
      return false;
    } finally {
      refreshing = false;
    }
  }

  function scheduleWrite(delay = NUMERIC_DEBOUNCE_MS) {
    if (timer !== null) clearTimeout(timer);
    pending = true;
    timer = setTimeout(() => {
      timer = null;
      void dispatchLatest().catch(() => {});
    }, delay);
    emit();
  }

  async function reconcileFailure(sent, failure) {
    const snapshot = await getSnapshot({ forceFresh: true });
    if (destroyed) return false;
    const incoming = readSnapshot(snapshot);
    if (incoming.revision < revision) return false;
    if (status === "Conflict" && incoming.revision <= revision) return false;
    if (incoming.revision > sent.baseRevision && same(incoming.settings, sent.settings)) {
      acceptSnapshot(snapshot, { authoritative: true, sent });
      lastFailure = null;
      if (draft !== null && status !== "Conflict") scheduleWrite(0);
      return true;
    }
    if (incoming.revision === sent.baseRevision && revision === sent.baseRevision && same(incoming.settings, sent.baseSettings) && same(acknowledged, sent.baseSettings)) {
      acceptSnapshot(snapshot, { authoritative: true });
      if (timer !== null) clearTimeout(timer);
      timer = null;
      lastFailure = { sent, error: failure };
      pending = false;
      status = "Failed";
      error = failure?.message || "Road 232 signs could not be saved";
      notifyWaitersThrough(sent.generation, failure);
      notifyWaitersThrough(generation, { status: "Failed", revision, error });
      emit();
      return false;
    }
    acceptSnapshot(snapshot, { authoritative: true });
    if (status !== "Conflict" && incoming.revision > sent.baseRevision) {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = false;
      status = "Failed";
      error = failure?.message || "Road 232 signs could not be saved";
      lastFailure = { sent, error: failure };
      notifyWaitersThrough(sent.generation, failure);
      notifyWaitersThrough(generation, { status: "Failed", revision, error });
      emit();
    }
    return false;
  }

  async function performWrite() {
    if (writesBlocked) return { status: "waiting-for-refresh" };
    if (destroyed || draft === null || acknowledged === null || status === "Conflict" || status === "Failed") return { status };
    const sent = { settings: clone(draft), generation, baseSettings: clone(acknowledged), baseRevision: revision };
    inFlight = sent;
    pending = true;
    status = "Saving";
    error = null;
    emit();
    try {
      const response = await writeSettings(clone(sent.settings), {
        baseRevision: sent.baseRevision,
        sourceId: createUuid(),
        timestamp: new Date().toISOString(),
      });
      if (destroyed) return { status: "destroyed" };
      const result = readSnapshot(response || {});
      if (result.revision <= sent.baseRevision || !same(result.settings, sent.settings)) {
        throw new Error("Road 232 sign save acknowledgement did not match the sent document");
      }
      acceptSnapshot({ roadSignSettings: result.settings, roadSignRevision: result.revision }, { authoritative: true, sent });
      lastFailure = null;
      pending = false;
      inFlight = null;
      if (draft !== null && status !== "Conflict") {
        status = "Saving";
        scheduleWrite(0);
      } else if (status !== "Conflict") {
        status = "Saved";
        emit();
      } else {
        emit();
      }
      return { status: "ok", revision: result.revision };
    } catch (writeError) {
      if (destroyed) return { status: "destroyed" };
      pending = false;
      try {
        const reconciled = await reconcileFailure(sent, writeError);
        if (reconciled) {
          inFlight = null;
          emit();
          return { status: "ok", reconciled: true, revision };
        }
        if (draft !== null && status === "Saving") {
          if (timer !== null) clearTimeout(timer);
          timer = null;
          pending = false;
          status = "Failed";
          error = writeError?.message || "Road 232 signs could not be saved";
          lastFailure = { sent, error: writeError };
          notifyWaitersThrough(sent.generation, writeError);
          notifyWaitersThrough(generation, { status: "Failed", revision, error });
          emit();
        }
      } catch (refreshError) {
        if (draft !== null && status !== "Conflict") {
          status = "Failed";
          error = refreshError?.message || writeError?.message || "Road 232 signs could not be saved";
          lastFailure = { sent, error: writeError };
          notifyWaitersThrough(sent.generation, writeError);
          emit();
        }
      }
      inFlight = null;
      emit();
      throw writeError;
    }
  }

  function dispatchLatest() {
    const operation = writeQueue.then(() => performWrite());
    writeQueue = operation.catch(() => {});
    return operation;
  }

  function replaceDraft(settings, options = {}) {
    if (destroyed) return Promise.reject(new Error("Road 232 sign client destroyed"));
    if (acknowledged === null) return Promise.reject(new Error("Road 232 sign settings are not loaded"));
    if (conflict) return Promise.reject(conflictError());
    const checked = validateRoadSignSettings(settings);
    if (!checked.valid) return Promise.reject(new TypeError(checked.error));
    generation += 1;
    if (same(checked.settings, acknowledged) && !inFlight) {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      draft = null;
      baseline = null;
      conflict = null;
      error = null;
      pending = false;
      status = "Saved";
      notifyWaitersThrough(generation, { status: "ok", revision });
      emit();
      return Promise.resolve({ status: "ok", revision });
    }
    draft = clone(checked.settings);
    if (!baseline) baseline = { settings: clone(acknowledged), revision };
    conflict = null;
    error = null;
    status = "Saving";
    lastFailure = null;
    const promise = new Promise((resolve, reject) => waiters.push({ generation, resolve, reject }));
    scheduleWrite(options.flush === true ? 0 : NUMERIC_DEBOUNCE_MS);
    return promise;
  }

  async function hydrate(options = {}) {
    if (destroyed) return false;
    const current = ++hydrateGeneration;
    status = acknowledged === null ? "Loading" : status;
    error = null;
    emit();
    try {
      const snapshot = await getSnapshot(options.forceFresh === true ? { forceFresh: true } : {});
      if (destroyed || current !== hydrateGeneration) return false;
      const incoming = readSnapshot(snapshot);
      const beforeRevision = revision;
      const sent = pending ? inFlight : null;
      acceptSnapshot(snapshot, { authoritative: options.forceFresh === true, sent });
      if (acknowledged === null) throw new Error("Road 232 sign settings snapshot is incomplete");
      if (status === "Loading") status = "Saved";
      emit();
      return incoming.revision >= beforeRevision;
    } catch (hydrateError) {
      if (destroyed || current !== hydrateGeneration) return false;
      status = draft === null ? "Failed" : status === "Conflict" ? "Conflict" : "Failed";
      error = hydrateError?.message || "Road 232 signs unavailable";
      emit();
      throw hydrateError;
    }
  }

  async function retry() {
    if (destroyed || draft === null || status === "Conflict") return { status };
    if (inFlight !== null) return { status: "Saving" };
    const capturedGeneration = generation;
    const capturedDraft = clone(draft);
    const capturedReconnectGeneration = reconnectGeneration;
    const snapshot = await getSnapshot({ forceFresh: true });
    if (destroyed || capturedGeneration !== generation || !same(capturedDraft, draft)) return { status: "superseded" };
    if (capturedReconnectGeneration !== reconnectGeneration) return { status: "superseded" };
    const incoming = readSnapshot(snapshot);
    if (incoming.revision < revision) return { status: status === "Conflict" ? "Conflict" : "stale" };
    if (lastFailure && incoming.revision > lastFailure.sent.baseRevision && same(incoming.settings, lastFailure.sent.settings)) {
      acceptSnapshot(snapshot, { authoritative: true, sent: lastFailure.sent });
      lastFailure = null;
      reconnectGeneration += 1;
      writesBlocked = false;
      if (status === "Conflict") return { status: "Conflict" };
      if (draft !== null) return dispatchLatest();
      return { status: "ok", reconciled: true, revision };
    }
    acceptSnapshot(snapshot, { authoritative: true });
    reconnectGeneration += 1;
    writesBlocked = false;
    if (status === "Conflict") return { status: "Conflict" };
    baseline = { settings: clone(acknowledged), revision };
    status = "Saving";
    error = null;
    emit();
    return dispatchLatest();
  }

  function useLatest() {
    if (!conflict) return false;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    generation += 1;
    acknowledged = clone(conflict.settings);
    revision = conflict.revision;
    draft = null;
    conflict = null;
    baseline = null;
    pending = false;
    error = null;
    status = "Saved";
    lastFailure = null;
    notifyWaitersThrough(generation, conflictError());
    emit();
    return true;
  }

  function onChanged(message = {}) {
    if (message.table !== tableName) return;
    try {
      const incoming = readSnapshot({ roadSignSettings: message.roadSignSettings, roadSignRevision: message.roadSignRevision });
      if (incoming.revision < revision) return;
      if (incoming.revision === revision && same(incoming.settings, acknowledged)) return;
      const activeWrite = pending ? inFlight : null;
      if (activeWrite && incoming.revision > activeWrite.baseRevision && same(incoming.settings, activeWrite.settings)) {
        markAcknowledged(incoming.settings, incoming.revision, activeWrite.generation);
        return;
      }
      if (incoming.revision === revision && !same(incoming.settings, acknowledged)) {
        void refreshFresh();
        return;
      }
      acceptSnapshot({ roadSignSettings: incoming.settings, roadSignRevision: incoming.revision });
    } catch (_error) {
      void refreshFresh();
    }
  }

  function onDisconnect() {
    disconnected = true;
    reconnectGeneration += 1;
    writesBlocked = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }
  function onConnect() {
    if (connectedBefore || disconnected) {
      const currentReconnect = ++reconnectGeneration;
      writesBlocked = true;
      void hydrate({ forceFresh: true }).then((loaded) => {
        if (currentReconnect !== reconnectGeneration || !loaded) return;
        writesBlocked = false;
        if (draft !== null && status !== "Conflict" && status !== "Failed") scheduleWrite(0);
      }).catch(() => {});
    }
    connectedBefore = true;
    disconnected = false;
  }

  socket?.on?.(EVENT, onChanged);
  socket?.on?.("disconnect", onDisconnect);
  socket?.on?.("connect", onConnect);

  function subscribe(listener) {
    listeners.add(listener);
    listener(getState());
    return () => listeners.delete(listener);
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    hydrateGeneration += 1;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    socket?.off?.(EVENT, onChanged);
    socket?.off?.("disconnect", onDisconnect);
    socket?.off?.("connect", onConnect);
    listeners.clear();
    waiters.splice(0).forEach((waiter) => waiter.resolve({ status: "destroyed" }));
  }

  return { hydrate, getState, subscribe, replaceDraft, retry, useLatest, hasUnsavedWork, destroy };
}
