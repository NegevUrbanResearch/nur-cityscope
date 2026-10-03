import { getLogger } from "../shared/logger.js";
import {
  acceptSettlementNameSnapshot,
  validateSettlementNameOperation,
  validateSettlementNameSettings,
} from "../shared/settlement-name-settings.js";

const SETTLEMENT_EVENT = "otef_settlement_names_changed";
const NUMERIC_DEBOUNCE_MS = 150;
const MAX_REBASE_ATTEMPTS = 8;
const styleKey = "style";
const PROBE_SOURCE = "11111111-1111-4111-8111-111111111111";
const PROBE_TIMESTAMP = "1970-01-01T00:00:00.000Z";

function positionKey(output, citycode) {
  return `position:${output}:${citycode}`;
}

const clone = (value) => value == null ? value : structuredClone(value);
const freeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
};
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function conflictError() {
  return Object.assign(new Error("Settlement names changed on the server"), { code: "conflict", status: 409 });
}

function initializationError() {
  return Object.assign(new Error("Initialization required"), { code: "initialization_required", status: 409 });
}

function readSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const settings = Object.prototype.hasOwnProperty.call(snapshot, "settlementNameSettings")
    ? snapshot.settlementNameSettings
    : snapshot.settlement_name_settings;
  const revision = Object.prototype.hasOwnProperty.call(snapshot, "settlementNameRevision")
    ? snapshot.settlementNameRevision
    : snapshot.settlement_name_revision;
  return { settings, revision };
}

function uninitialized(settings, revision) {
  const empty = settings == null || (typeof settings === "object" && !Array.isArray(settings) && Object.keys(settings).length === 0);
  return empty && revision === 0;
}

function assertTarget(target) {
  if (target?.kind === "style") return;
  if (target?.kind === "position" && (target.output === "left" || target.output === "right") && typeof target.citycode === "string" && target.citycode) return;
  throw new Error("Unknown settlement target");
}

function operationName(target, options = {}) {
  if (options.operation === "reset_position") return "reset_position";
  if (target.kind === "style") return "style";
  if (target.kind === "position") return "position";
  throw new Error("Unknown settlement target");
}

function probeOperation(target, value, operation, baseRevision) {
  const meta = { action: "set_settlement_names", operation, baseRevision, sourceId: PROBE_SOURCE, timestamp: PROBE_TIMESTAMP };
  switch (operation) {
    case "position":
      return { ...meta, output: target.output, citycode: target.citycode, position: value };
    case "reset_position":
      return { ...meta, output: target.output, citycode: target.citycode };
    case "style":
      return { ...meta, style: value };
    default: {
      const unknown = operation;
      throw new Error(`Unknown settlement operation: ${String(unknown)}`);
    }
  }
}

function intentBody(intent, baseRevision) {
  switch (intent.operation) {
    case "position":
      return { operation: "position", output: intent.output, citycode: intent.citycode, position: clone(intent.value), baseRevision };
    case "reset_position":
      return { operation: "reset_position", output: intent.output, citycode: intent.citycode, baseRevision };
    case "style":
      return { operation: "style", style: clone(intent.value), baseRevision };
    default: {
      const unknown = intent.operation;
      throw new Error(`Unknown settlement operation: ${String(unknown)}`);
    }
  }
}

function targetValue(settings, record) {
  if (!settings) return null;
  if (record.kind === "style") return clone(settings.style ?? null);
  return clone(settings.outputs?.[record.output]?.[record.citycode] ?? null);
}

function sentValue(operation, value) {
  return operation === "reset_position" ? null : clone(value);
}

export function createSettlementNameClient({ getSnapshot, writeOperation, socket = null, tableName = "otef" }) {
  const listeners = new Set();
  const records = new Map();
  const timers = new Map();
  const pendingEvents = new Map();
  const domain = { settings: null, revision: -1, refreshing: false };
  let writeQueue = Promise.resolve();
  let destroyed = false;
  let hydrationGeneration = 0;
  let hydrationAbortController = null;
  let connectedOnce = false;
  let hydration = { status: "Loading", error: null };
  const page = typeof globalThis.addEventListener === "function" ? globalThis : null;

  function emit() {
    if (destroyed) return;
    for (const listener of listeners) listener();
  }

  function hasUnsavedWork() {
    return [...records.values()].some((record) => record.draft !== null || record.status !== "Saved");
  }

  function onBeforeUnload(event) {
    if (!hasUnsavedWork()) return;
    event.preventDefault();
    event.returnValue = "";
  }

  function ensureRecord(target) {
    const key = target.kind === "style" ? styleKey : positionKey(target.output, target.citycode);
    if (!records.has(key)) {
      const record = {
        key,
        kind: target.kind,
        output: target.output || null,
        citycode: target.citycode || null,
        acknowledged: null,
        draft: null,
        status: "Saved",
        generation: 0,
        conflict: null,
        baseline: null,
        operation: null,
        waiters: [],
      };
      record.acknowledged = targetValue(domain.settings, record);
      records.set(key, record);
    }
    return records.get(key);
  }

  function publicRecord(record) {
    return freeze(clone({
      acknowledged: record.acknowledged,
      draft: record.draft,
      status: record.status,
      generation: record.generation,
      conflict: record.conflict,
    }));
  }

  function scheduleRefresh() {
    if (domain.refreshing || destroyed || typeof getSnapshot !== "function") return;
    domain.refreshing = true;
    Promise.resolve().then(() => getSnapshot({ forceFresh: true })).then((snapshot) => {
      if (destroyed) return;
      const parsed = readSnapshot(snapshot);
      acceptDocument(parsed?.settings, parsed?.revision, { authoritative: true });
    }).catch((error) => {
      if (destroyed) return;
      getLogger().warn("[SettlementNameClient] Failed to refresh settlement names:", error);
      hydration = { ...hydration, error: error?.message || "Settlement names unavailable" };
      emit();
    }).finally(() => {
      if (!destroyed) domain.refreshing = false;
    });
  }

  function applyAccepted(settings, revision) {
    const matched = [];
    for (const [key, pending] of pendingEvents) {
      if (revision <= pending.baseRevision) continue;
      const value = targetValue(settings, pending);
      if (same(value, pending.value)) {
        pending.acknowledge({ settings, revision });
        matched.push(pending);
        pendingEvents.delete(key);
      }
    }
    for (const record of records.values()) {
      const incoming = targetValue(settings, record);
      const pending = matched.find((item) => item.key === record.key);
      const inFlight = record.draft !== null || (record.operation === "reset_position" && record.status !== "Saved");
      if (pending && record.status !== "Conflict" && pending.generation !== record.generation) {
        record.acknowledged = clone(incoming);
        record.baseline = { value: clone(incoming), revision };
      } else if (pending && record.status !== "Conflict" && same(incoming, record.operation === "reset_position" ? null : record.draft)) {
        record.acknowledged = clone(incoming);
        record.draft = null;
        record.operation = null;
        record.status = "Saved";
        record.conflict = null;
        record.baseline = null;
        record.waiters.splice(0).forEach((resolve) => resolve({ status: "ok", revision }));
      } else if (record.status === "Conflict" || (inFlight && !same(incoming, record.acknowledged))) {
        record.acknowledged = clone(incoming);
        record.conflict = { value: clone(incoming), revision };
        record.status = "Conflict";
        record.waiters.splice(0).forEach((resolve) => resolve(conflictError()));
        const live = pendingEvents.get(record.key);
        if (live?.conflict) {
          live.conflict({ value: clone(incoming), revision });
          pendingEvents.delete(record.key);
        }
      } else {
        record.acknowledged = clone(incoming);
      }
    }
    emit();
  }

  function acceptDocument(settings, revision, options = {}) {
    if (!Number.isInteger(revision) || revision < 0) return false;
    if (uninitialized(settings, revision)) throw initializationError();
    const current = { settings: domain.settings, revision: domain.revision < 0 ? -1 : domain.revision };
    let next;
    try {
      next = acceptSettlementNameSnapshot(current, { settings, revision });
    } catch (error) {
      if (options.authoritative !== true && options.hydrate !== true) scheduleRefresh();
      throw error;
    }
    if (next.requiresFreshRead) {
      if (options.authoritative === true) {
        const checked = validateSettlementNameSettings(settings);
        if (checked.errors.length) throw new TypeError(checked.errors.join(", "));
        domain.settings = checked.value;
        domain.revision = revision;
        applyAccepted(domain.settings, domain.revision);
        return true;
      }
      if (options.hydrate !== true) scheduleRefresh();
      return false;
    }
    if (next === current || next.revision === current.revision) return false;
    domain.settings = next.settings;
    domain.revision = next.revision;
    applyAccepted(domain.settings, domain.revision);
    return true;
  }

  function applyEvent(message = {}) {
    if (message.table != null && message.table !== tableName) return;
    if (!Number.isInteger(message.settlementNameRevision)) return;
    try {
      acceptDocument(message.settlementNameSettings, message.settlementNameRevision);
    } catch (error) {
      getLogger().warn("[SettlementNameClient] Ignored invalid settlement event:", error);
    }
  }

  const onChanged = (message) => applyEvent(message);
  const onDisconnect = () => { connectedOnce = true; };
  const onConnect = () => {
    if (connectedOnce) {
      void hydrate({ forceFresh: true }).catch((error) => {
        getLogger().warn("[SettlementNameClient] Failed to hydrate after reconnect:", error);
      });
    }
    connectedOnce = true;
  };
  socket?.on?.(SETTLEMENT_EVENT, onChanged);
  socket?.on?.("disconnect", onDisconnect);
  socket?.on?.("connect", onConnect);
  page?.addEventListener?.("beforeunload", onBeforeUnload);

  async function hydrateRequest(options, generation, signal) {
    hydration = { status: "Loading", error: null };
    emit();
    try {
      const snapshot = await getSnapshot({ ...options, signal });
      if (destroyed || generation !== hydrationGeneration) return false;
      const parsed = readSnapshot(snapshot);
      if (!parsed || !Number.isInteger(parsed.revision)) throw new Error("Settlement name settings snapshot is incomplete");
      if (uninitialized(parsed.settings, parsed.revision)) throw initializationError();
      acceptDocument(parsed.settings, parsed.revision, { authoritative: options.forceFresh === true, hydrate: true });
      if (!domain.settings) throw new Error("Settlement name settings snapshot is incomplete");
      hydration = { status: "Saved", error: null };
      emit();
      return true;
    } catch (error) {
      if (destroyed || generation !== hydrationGeneration) return false;
      const canRefresh = options.forceFresh !== true && options._refresh !== true && error?.code !== "initialization_required";
      if (canRefresh) {
        return hydrateRequest({ ...options, forceFresh: true, _refresh: true }, generation, signal);
      }
      hydration = { status: "Failed", error: error?.message || "Settlement names unavailable" };
      emit();
      throw error;
    }
  }

  async function hydrate(options = {}) {
    if (destroyed) return false;
    const generation = ++hydrationGeneration;
    hydrationAbortController?.abort();
    const requestController = new AbortController();
    hydrationAbortController = requestController;
    return hydrateRequest(options, generation, requestController.signal);
  }

  function updateRecordForDraft(record, value, options = {}) {
    record.generation += 1;
    record.operation = options.operation;
    record.draft = options.operation === "reset_position" ? null : clone(value);
    if (record.status !== "Conflict") {
      record.status = "Saving";
      record.conflict = null;
    }
    if (options.baseline && !record.baseline) record.baseline = clone(options.baseline);
    else if (!record.baseline) record.baseline = { value: clone(record.acknowledged), revision: domain.revision };
    if (record.baseline && !same(record.baseline.value, record.acknowledged)) {
      record.conflict = { value: clone(record.acknowledged), revision: domain.revision };
      record.status = "Conflict";
    }
    return record.generation;
  }

  function adoptConflictSnapshot(source) {
    const payload = source?.details?.error ? source.details : source;
    if (!payload?.settlementNameSettings || !Number.isInteger(payload.settlementNameRevision)) return false;
    try {
      acceptDocument(payload.settlementNameSettings, payload.settlementNameRevision);
      return true;
    } catch (acceptError) {
      getLogger().warn("[SettlementNameClient] Ignored invalid conflict snapshot:", acceptError);
      return false;
    }
  }

  function dispatch(record, generation, value, operationName) {
    const intent = {
      operation: operationName,
      value: sentValue(operationName, value),
      generation,
      kind: record.kind,
      output: record.output,
      citycode: record.citycode,
      baseline: clone(record.baseline),
    };
    const queued = writeQueue.then(async () => {
      if (destroyed) throw new Error("Settlement name client destroyed");
      const pendingValue = intent.value;
      let attempts = 0;
      while (!destroyed) {
        if (intent.generation !== record.generation && record.draft === null && record.status === "Saved") {
          return { status: "superseded" };
        }
        if (record.status === "Saved" && same(record.acknowledged, pendingValue)) {
          return { status: "ok", acknowledgedBy: "event" };
        }
        if (record.status === "Conflict") throw conflictError();
        const advancedBaseline = record.baseline
          && same(record.baseline.value, record.acknowledged)
          && (record.baseline.revision ?? 0) >= (intent.baseline?.revision ?? -1)
          ? record.baseline
          : intent.baseline;
        if (advancedBaseline && !same(advancedBaseline.value, record.acknowledged)) {
          record.conflict = { value: clone(record.acknowledged), revision: domain.revision };
          record.status = "Conflict";
          emit();
          throw conflictError();
        }
        attempts += 1;
        const baseRevision = domain.revision;
        let acknowledge;
        let signalConflict;
        const eventPromise = new Promise((resolve) => {
          acknowledge = (event) => resolve({ type: "acknowledged", ...event });
          signalConflict = (conflict) => resolve({ type: "conflict", ...conflict });
        });
        pendingEvents.set(record.key, {
          key: record.key,
          kind: intent.kind,
          output: intent.output,
          citycode: intent.citycode,
          value: pendingValue,
          baseRevision,
          generation: intent.generation,
          acknowledge,
          conflict: signalConflict,
        });
        const writePromise = Promise.resolve().then(() => writeOperation(freeze(intentBody(intent, baseRevision))));
        writePromise.catch(() => {});
        try {
          const result = await Promise.race([
            writePromise.then((response) => ({ kind: "http", response })),
            eventPromise.then((event) => ({ kind: "event", event })),
          ]);
          if (result.kind === "event") {
            if (result.event.type === "conflict") throw conflictError();
            return { status: "ok", revision: result.event.revision };
          }
          const response = result.response;
          if (response?.status === "ok" && response.settlementNameSettings && Number.isInteger(response.settlementNameRevision)) {
            if (response.settlementNameRevision <= baseRevision) throw new Error("Invalid settlement name acknowledgement revision");
            acceptDocument(response.settlementNameSettings, response.settlementNameRevision);
            if (record.status === "Saved" && same(record.acknowledged, pendingValue)) return response;
          } else if (response?.error === "initialization_required") {
            record.status = "Failed";
            emit();
            throw initializationError();
          } else if (response?.error === "conflict" || response?.status === 409) {
            adoptConflictSnapshot(response);
            if (record.status === "Saved" && same(record.acknowledged, pendingValue)) {
              return { status: "ok", acknowledgedBy: "conflict-snapshot" };
            }
            if (intent.generation !== record.generation) {
              if (record.status === "Conflict") throw conflictError();
              return { status: "superseded" };
            }
            if (record.status !== "Conflict" && domain.revision > baseRevision && attempts < MAX_REBASE_ATTEMPTS) {
              record.status = "Saving";
              record.conflict = null;
              record.baseline = { value: clone(record.acknowledged), revision: domain.revision };
              emit();
              continue;
            }
            if (record.status !== "Conflict" && intent.generation === record.generation) {
              record.status = "Failed";
              emit();
              throw new Error("Settlement name save lost the revision race");
            }
            record.conflict = { value: clone(record.acknowledged), revision: domain.revision };
            record.status = "Conflict";
            emit();
            throw conflictError();
          } else {
            throw new Error("Invalid settlement name acknowledgement");
          }
          if (intent.generation === record.generation && record.status !== "Saved") {
            throw new Error("Settlement acknowledgement did not match current draft");
          }
          return response;
        } catch (error) {
          if (record.status === "Saved" && same(record.acknowledged, pendingValue)) return { status: "ok", acknowledgedBy: "event" };
          if (error?.status === 409 && error?.details?.error === "conflict") {
            adoptConflictSnapshot(error);
            if (record.status === "Saved" && same(record.acknowledged, pendingValue)) {
              return { status: "ok", acknowledgedBy: "conflict-snapshot" };
            }
            if (intent.generation !== record.generation) {
              if (record.status === "Conflict") throw conflictError();
              return { status: "superseded" };
            }
            if (record.status !== "Conflict" && domain.revision > baseRevision && attempts < MAX_REBASE_ATTEMPTS) {
              record.status = "Saving";
              record.conflict = null;
              record.baseline = { value: clone(record.acknowledged), revision: domain.revision };
              emit();
              continue;
            }
            if (record.status !== "Conflict") {
              record.status = "Failed";
              emit();
              throw error;
            }
          }
          if (error?.status === 409 || error?.code === "conflict") {
            record.status = "Conflict";
            record.conflict ||= { value: clone(record.acknowledged), revision: domain.revision };
          } else if (intent.generation === record.generation && record.status !== "Conflict") {
            record.status = "Failed";
          }
          emit();
          throw error;
        } finally {
          const pending = pendingEvents.get(record.key);
          if (pending?.baseRevision === baseRevision && pending?.acknowledge === acknowledge) pendingEvents.delete(record.key);
        }
      }
      throw new Error("Settlement name client destroyed");
    });
    writeQueue = queued.catch(() => {});
    return queued;
  }

  function settleTimer(record, result) {
    const entry = timers.get(record.key);
    if (!entry) return;
    clearTimeout(entry.timer);
    timers.delete(record.key);
    entry.waiters.splice(0).forEach((done) => done(result));
  }

  function scheduleNumeric(record, generation, value) {
    let entry = timers.get(record.key);
    if (entry) {
      clearTimeout(entry.timer);
      entry.generation = generation;
      entry.value = clone(value);
      entry.operation = record.operation;
    } else {
      entry = { generation, value: clone(value), operation: record.operation, waiters: [] };
      timers.set(record.key, entry);
    }
    return new Promise((resolve, reject) => {
      entry.waiters.push((result) => result instanceof Error ? reject(result) : resolve(result));
      entry.timer = setTimeout(() => {
        if (timers.get(record.key) !== entry) return;
        timers.delete(record.key);
        const waiters = entry.waiters.splice(0);
        if (destroyed || entry.generation !== record.generation) {
          waiters.forEach((done) => done({ status: "superseded" }));
          return;
        }
        dispatch(record, entry.generation, entry.value, entry.operation).then(
          (result) => waiters.forEach((done) => done(result)),
          (error) => waiters.forEach((done) => done(error)),
        );
      }, NUMERIC_DEBOUNCE_MS);
    });
  }

  function commit(target, value, options = {}) {
    if (hydration.status !== "Saved") return Promise.reject(new Error("Settlement names are not loaded"));
    assertTarget(target);
    const operation = operationName(target, options);
    const record = ensureRecord(target);
    const checked = validateSettlementNameOperation(
      probeOperation(target, value, operation, domain.revision < 0 ? 0 : domain.revision),
      domain.settings,
    );
    if (checked.errors.length) return Promise.reject(new Error(checked.errors.join(", ")));
    if (checked.warnings.length) getLogger().warn(`[SettlementNameClient] ${checked.warnings.join("; ")}`);
    const generation = updateRecordForDraft(record, value, { ...options, operation });
    emit();
    if (options.numeric === true) return scheduleNumeric(record, generation, value);
    settleTimer(record, { status: "superseded" });
    return dispatch(record, generation, value, operation);
  }

  function resetPosition(output, citycode, options = {}) {
    return commit({ kind: "position", output, citycode }, null, { ...options, operation: "reset_position" });
  }

  async function retry(target) {
    if (hydration.status !== "Saved") return Promise.reject(new Error("Settlement names are not loaded"));
    assertTarget(target);
    const record = ensureRecord(target);
    if (record.draft === null && record.status === "Saved") return { status: "Saved" };
    const captured = {
      generation: record.generation,
      draft: clone(record.draft),
      acknowledged: clone(record.acknowledged),
      operation: record.operation,
    };
    const snapshot = await getSnapshot({ forceFresh: true });
    if (destroyed || record.generation !== captured.generation || !same(record.draft, captured.draft)) return { status: "superseded" };
    const parsed = readSnapshot(snapshot);
    if (!parsed || !Number.isInteger(parsed.revision)) throw new Error("Settlement name settings snapshot is incomplete");
    if (uninitialized(parsed.settings, parsed.revision)) throw initializationError();
    if (!same(record.acknowledged, captured.acknowledged)) throw conflictError();
    acceptDocument(parsed.settings, parsed.revision, { authoritative: true, hydrate: true });
    if (record.generation !== captured.generation || !same(record.draft, captured.draft)) return { status: "superseded" };
    if (!same(record.acknowledged, captured.acknowledged)) throw conflictError();
    record.status = "Saving";
    record.conflict = null;
    record.operation = captured.operation;
    record.baseline = { value: clone(record.acknowledged), revision: domain.revision };
    settleTimer(record, { status: "superseded" });
    const generation = ++record.generation;
    emit();
    return dispatch(record, generation, captured.draft, captured.operation);
  }

  function loadSaved(target) {
    assertTarget(target);
    const record = ensureRecord(target);
    const timer = timers.get(record.key);
    if (timer) {
      clearTimeout(timer.timer);
      timers.delete(record.key);
      timer.waiters.splice(0).forEach((resolve) => resolve({ status: "loaded" }));
    }
    record.draft = null;
    record.operation = null;
    record.status = "Saved";
    record.conflict = null;
    record.baseline = null;
    record.generation += 1;
    record.acknowledged = targetValue(domain.settings, record);
    emit();
    return publicRecord(record);
  }

  function previewSnapshot() {
    if (!domain.settings) return { settings: null, revision: domain.revision };
    const settings = clone(domain.settings);
    for (const record of records.values()) {
      if (record.kind === "position") {
        if (record.operation === "reset_position" && record.status !== "Saved") {
          delete settings.outputs[record.output][record.citycode];
        } else if (record.draft != null) {
          settings.outputs[record.output][record.citycode] = clone(record.draft);
        }
      } else if (record.draft != null) {
        settings.style = clone(record.draft);
      }
    }
    return { settings, revision: domain.revision };
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function destroy() {
    destroyed = true;
    hydrationGeneration += 1;
    hydrationAbortController?.abort();
    hydrationAbortController = null;
    for (const entry of timers.values()) {
      clearTimeout(entry.timer);
      entry.waiters.splice(0).forEach((resolve) => resolve(undefined));
    }
    timers.clear();
    socket?.off?.(SETTLEMENT_EVENT, onChanged);
    socket?.off?.("disconnect", onDisconnect);
    socket?.off?.("connect", onConnect);
    page?.removeEventListener?.("beforeunload", onBeforeUnload);
    listeners.clear();
    pendingEvents.clear();
  }

  return {
    hydrate,
    getHydrationState: () => ({ ...hydration }),
    getTarget: (target) => publicRecord(ensureRecord(target)),
    getSnapshot: previewSnapshot,
    subscribe,
    commit,
    resetPosition,
    retry,
    loadSaved,
    destroy,
    hasUnsavedWork,
  };
}
