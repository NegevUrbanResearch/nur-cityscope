import { getLogger } from "../shared/logger.js";

const CLOCK_EVENT = "otef_nli_clock_layout_changed";
const LEGEND_EVENT = "otef_legend_settings_changed";
const NUMERIC_DEBOUNCE_MS = 150;
const GIS_CLOCK_SLOTS = new Set(["start", "segev", "nova", "sderot", "hostages", "hostages_all"]);

const clone = (value) => value == null ? value : structuredClone(value);
const freeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const slotKey = (resource, slot) => `${resource}:${slot}`;

function resourceDetails(resource, slot) {
  if (resource === "gisClock" && GIS_CLOCK_SLOTS.has(slot)) return { domain: "clock", surface: "gis", slot };
  if (resource === "projectionClock" && slot === "left") return { domain: "clock", surface: "projection", slot: "left" };
  if (resource === "projectionLegend" && slot === "left") return { domain: "legend", span: "left", slot: "left" };
  throw new Error(`Unknown clock layout resource: ${resource}`);
}

function conflictError() {
  return Object.assign(new Error("Layout changed on the server"), { code: "conflict", status: 409 });
}

export function createClockLayoutClient({ getSnapshot, writeClockSlot, writeLegendSlot, socket = null }) {
  const listeners = new Set();
  const records = new Map();
  const domains = {
    clock: { snapshot: { gis: {}, projection: {} }, revision: -1, refreshing: false },
    legend: { snapshot: {}, revision: -1, refreshing: false },
  };
  const timers = new Map();
  const pendingEvents = new Map();
  let writeQueue = Promise.resolve();
  let destroyed = false;
  let connectedOnce = false;
  let hydration = { status: "Loading", error: null };

  function emit() {
    if (destroyed) return;
    for (const listener of listeners) listener();
  }

  function ensureRecord(resource, slot, layout = null) {
    const key = slotKey(resource, slot);
    if (!records.has(key)) records.set(key, {
      resource, slot, acknowledged: clone(layout), draft: null, status: "Saved",
      generation: 0, conflict: null, baseline: null, waiters: [],
    });
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

  function slotLayout(domain, resource, slot) {
    const details = resourceDetails(resource, slot);
    return details.domain === "clock"
      ? domains.clock.snapshot?.[details.surface]?.[details.slot] ?? null
      : domains.legend.snapshot?.[details.span] ?? null;
  }

  function refreshOnEqualMismatch(domainName) {
    const domain = domains[domainName];
    if (domain.refreshing || destroyed || typeof getSnapshot !== "function") return;
    domain.refreshing = true;
    Promise.resolve().then(() => getSnapshot({ forceFresh: true })).then((snapshot) => acceptSnapshot(snapshot, { authoritative: true })).catch((error) => {
      getLogger().warn("[ClockLayoutClient] Failed to refresh layout revision:", error);
    }).finally(() => {
      domain.refreshing = false;
    });
  }

  function markEventAcknowledgements(domainName, snapshot, revision) {
    for (const [key, pending] of pendingEvents) {
      if (pending.domain !== domainName || revision <= pending.baseRevision) continue;
      const value = domainName === "clock"
        ? snapshot?.[pending.surface]?.[pending.slot]
        : snapshot?.[pending.span];
      if (same(value, pending.layout)) {
        pending.acknowledge({ snapshot, revision });
        pendingEvents.delete(key);
      }
    }
  }

  function acceptDomainSnapshot(domainName, snapshot, revision, options = {}) {
    if (!snapshot || typeof snapshot !== "object" || !Number.isInteger(revision) || revision < 0) return false;
    const domain = domains[domainName];
    if (revision < domain.revision) return false;
    if (revision === domain.revision) {
      if (!same(snapshot, domain.snapshot)) {
        if (options.authoritative === true) {
          domain.snapshot = clone(snapshot);
          applyAcceptedSnapshot(domainName, snapshot, revision);
        } else {
          refreshOnEqualMismatch(domainName);
        }
      }
      return false;
    }
    domain.snapshot = clone(snapshot);
    domain.revision = revision;
    applyAcceptedSnapshot(domainName, snapshot, revision);
    return true;
  }

  function applyAcceptedSnapshot(domainName, snapshot, revision) {
    const domain = domains[domainName];
    const matchingSlots = new Set([...pendingEvents.values()]
      .filter((pending) => pending.domain === domainName && revision > pending.baseRevision)
      .filter((pending) => same(domainName === "clock"
        ? snapshot?.[pending.surface]?.[pending.slot]
        : snapshot?.[pending.span], pending.layout))
      .map((pending) => pending.key));
    const matchedPending = [...pendingEvents.values()].filter((pending) => matchingSlots.has(pending.key));
    markEventAcknowledgements(domainName, domain.snapshot, revision);
    for (const record of records.values()) {
      const details = resourceDetails(record.resource, record.slot);
      if (details.domain !== domainName) continue;
      const incoming = slotLayout(domainName, record.resource, record.slot);
      const matched = matchedPending.find((pending) => pending.key === slotKey(record.resource, record.slot));
      if (matched && record.status !== "Conflict" && matched.generation !== record.generation) {
        record.acknowledged = clone(incoming);
        record.baseline = { layout: clone(incoming), revision };
      } else if (matched && record.status !== "Conflict" && same(incoming, record.draft)) {
        record.acknowledged = clone(incoming);
        record.draft = null;
        record.status = "Saved";
        record.conflict = null;
        record.baseline = null;
        record.waiters.splice(0).forEach((resolve) => resolve({ status: "ok", revision }));
      } else if (record.status === "Conflict" || (record.draft !== null && !same(incoming, record.acknowledged))) {
        record.acknowledged = clone(incoming);
        record.conflict = { layout: clone(incoming), revision };
        record.status = "Conflict";
        record.waiters.splice(0).forEach((resolve) => resolve(conflictError()));
        const pending = pendingEvents.get(slotKey(record.resource, record.slot));
        if (pending?.conflict) {
          pending.conflict({ layout: clone(incoming), revision });
          pendingEvents.delete(pending.key);
        }
      } else {
        record.acknowledged = clone(incoming);
      }
    }
    emit();
  }

  function acceptSnapshot(snapshot, options = {}) {
    if (!snapshot || typeof snapshot !== "object") return;
    if (snapshot.nli_clock_layout && Number.isInteger(snapshot.nli_clock_layout_revision)) {
      acceptDomainSnapshot("clock", snapshot.nli_clock_layout, snapshot.nli_clock_layout_revision, options);
    }
    const projection = snapshot.legendProjection ?? snapshot.legend_settings?.projection;
    const legendRevision = snapshot.legendLayoutRevision ?? snapshot.legend_layout_revision;
    if (projection && Number.isInteger(legendRevision)) acceptDomainSnapshot("legend", projection, legendRevision, options);
  }

  function applyClockEvent(message = {}) {
    if (message.nliClockLayout && Number.isInteger(message.nliClockLayoutRevision)) {
      acceptDomainSnapshot("clock", message.nliClockLayout, message.nliClockLayoutRevision);
    }
  }

  function applyLegendEvent(message = {}) {
    if (message.changeKind === "layout" && message.legendProjection && Number.isInteger(message.legendLayoutRevision)) {
      acceptDomainSnapshot("legend", message.legendProjection, message.legendLayoutRevision);
    }
  }

  const onClock = (message) => applyClockEvent(message);
  const onLegend = (message) => applyLegendEvent(message);
  const onDisconnect = () => { connectedOnce = true; };
  const onConnect = () => {
    if (connectedOnce) void hydrate({ forceFresh: true }).catch((error) => {
      getLogger().warn("[ClockLayoutClient] Failed to hydrate after reconnect:", error);
    });
    connectedOnce = true;
  };
  socket?.on?.(CLOCK_EVENT, onClock);
  socket?.on?.(LEGEND_EVENT, onLegend);
  socket?.on?.("disconnect", onDisconnect);
  socket?.on?.("connect", onConnect);

  async function hydrate(options = {}) {
    hydration = { status: "Loading", error: null }; emit();
    let snapshot;
    try {
      snapshot = await getSnapshot(options);
      if (!snapshot?.nli_clock_layout || !Number.isInteger(snapshot.nli_clock_layout_revision) || snapshot.nli_clock_layout_revision < 0
        || !(snapshot.legendProjection ?? snapshot.legend_settings?.projection)
        || !Number.isInteger(snapshot.legendLayoutRevision ?? snapshot.legend_layout_revision)
        || (snapshot.legendLayoutRevision ?? snapshot.legend_layout_revision) < 0) throw new Error("Layout settings snapshot is incomplete");
    } catch (error) {
      hydration = { status: "Failed", error: error?.message || "Layout settings unavailable" }; emit(); throw error;
    }
    acceptSnapshot(snapshot, { authoritative: options.forceFresh === true });
    for (const [surface, layout] of Object.entries(domains.clock.snapshot || {})) {
      if (!layout || typeof layout !== "object") continue;
      for (const [slot, value] of Object.entries(layout)) {
        const resource = surface === "gis" ? "gisClock" : "projectionClock";
        ensureRecord(resource, slot, value);
      }
    }
    for (const [span, value] of Object.entries(domains.legend.snapshot || {})) {
      if (span === "left") ensureRecord("projectionLegend", span, value);
    }
    hydration = { status: "Saved", error: null }; emit();
    return true;
  }

  function getSlot(resource, slot) {
    const details = resourceDetails(resource, slot);
    const record = ensureRecord(resource, details.slot, slotLayout(details.domain, resource, details.slot));
    return publicRecord(record);
  }

  function updateRecordForDraft(record, layout, options = {}) {
    record.generation += 1;
    record.draft = clone(layout);
    if (record.status !== "Conflict") {
      record.status = "Saving";
      record.conflict = null;
    }
    if (options.baseline && !record.baseline) record.baseline = clone(options.baseline);
    else if (!record.baseline) record.baseline = { layout: clone(record.acknowledged), revision: domains[resourceDetails(record.resource, record.slot).domain].revision };
    if (record.baseline && !same(record.baseline.layout, record.acknowledged)) {
      const domain = domains[resourceDetails(record.resource, record.slot).domain];
      record.conflict = { layout: clone(record.acknowledged), revision: domain.revision };
      record.status = "Conflict";
    }
    return record.generation;
  }

  function dispatch(record, generation, layout) {
    const operation = writeQueue.then(async () => {
      if (destroyed) throw new Error("Clock layout client destroyed");
      if (generation !== record.generation) return { status: "superseded" };
      const details = resourceDetails(record.resource, record.slot);
      const domain = domains[details.domain];
      if (record.status === "Conflict") throw conflictError();
      if (record.baseline && !same(record.baseline.layout, record.acknowledged)) {
        record.conflict = { layout: clone(record.acknowledged), revision: domain.revision };
        record.status = "Conflict";
        emit();
        throw conflictError();
      }
      const baseRevision = domain.revision;
      const intent = details.domain === "clock"
        ? { surface: details.surface, slot: details.slot, layout: clone(layout), baseRevision }
        : { span: details.span, layout: clone(layout), baseRevision };
      let acknowledge;
      let signalConflict;
      const eventPromise = new Promise((resolve) => {
        acknowledge = (event) => resolve({ type: "acknowledged", ...event });
        signalConflict = (conflict) => resolve({ type: "conflict", ...conflict });
      });
      const key = slotKey(record.resource, record.slot);
      pendingEvents.set(key, { key, domain: details.domain, surface: details.surface, slot: details.slot, span: details.span, layout: clone(layout), baseRevision, generation, acknowledge, conflict: signalConflict });
      const immutableIntent = freeze(intent);
      const writePromise = Promise.resolve().then(() => details.domain === "clock"
        ? writeClockSlot(immutableIntent)
        : writeLegendSlot(immutableIntent));
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
        if (response?.status === "ok" && details.domain === "clock" && response.nliClockLayout && Number.isInteger(response.nliClockLayoutRevision)) {
          if (response.nliClockLayoutRevision <= baseRevision) throw new Error("Invalid clock layout acknowledgement revision");
          acceptDomainSnapshot("clock", response.nliClockLayout, response.nliClockLayoutRevision);
          if (record.status === "Saved" && same(record.acknowledged, layout)) return response;
        } else if (response?.changeKind === "layout" && details.domain === "legend" && response.legendProjection && Number.isInteger(response.legendLayoutRevision)) {
          if (response.legendLayoutRevision <= baseRevision) throw new Error("Invalid legend layout acknowledgement revision");
          acceptDomainSnapshot("legend", response.legendProjection, response.legendLayoutRevision);
          if (record.status === "Saved" && same(record.acknowledged, layout)) return response;
        } else if (response?.error === "conflict" || response?.status === 409) {
          const conflictSnapshot = details.domain === "clock" ? response.nliClockLayout : response.legendProjection;
          const conflictRevision = details.domain === "clock" ? response.nliClockLayoutRevision : response.legendLayoutRevision;
          if (conflictSnapshot && Number.isInteger(conflictRevision)) acceptDomainSnapshot(details.domain, conflictSnapshot, conflictRevision);
          record.conflict = { layout: clone(record.acknowledged), revision: domain.revision };
          record.status = "Conflict";
          emit();
          throw conflictError();
        } else {
          throw new Error("Invalid layout acknowledgement");
        }
        if (generation === record.generation && record.status !== "Saved") throw new Error("Layout acknowledgement did not match current draft");
        return response;
      } catch (error) {
        if (record.status === "Saved" && same(record.acknowledged, layout)) return { status: "ok", acknowledgedBy: "event" };
        const detailsPayload = error?.details;
        if (error?.status === 409 && detailsPayload?.error === "conflict") {
          const conflictSnapshot = details.domain === "clock" ? detailsPayload.nliClockLayout : detailsPayload.legendProjection;
          const conflictRevision = details.domain === "clock" ? detailsPayload.nliClockLayoutRevision : detailsPayload.legendLayoutRevision;
          if (conflictSnapshot && Number.isInteger(conflictRevision)) acceptDomainSnapshot(details.domain, conflictSnapshot, conflictRevision);
        }
        if (error?.status === 409 || error?.code === "conflict") {
          record.status = "Conflict";
          record.conflict ||= { layout: clone(record.acknowledged), revision: domain.revision };
        } else if (generation === record.generation && record.status !== "Conflict") {
          record.status = "Failed";
        }
        emit();
        throw error;
      } finally {
        const pending = pendingEvents.get(key);
        if (pending?.baseRevision === baseRevision && pending?.acknowledge === acknowledge) pendingEvents.delete(key);
      }
    });
    writeQueue = operation.catch(() => {});
    return operation;
  }

  function commit(resource, slot, layout, options = {}) {
    if (hydration.status !== "Saved") return Promise.reject(new Error("Layout settings are not loaded"));
    const details = resourceDetails(resource, slot);
    const record = ensureRecord(resource, details.slot, slotLayout(details.domain, resource, details.slot));
    const generation = updateRecordForDraft(record, layout, options);
    emit();
    if (options.numeric === true) {
      const key = slotKey(resource, details.slot);
      let entry = timers.get(key);
      if (entry) {
        clearTimeout(entry.timer);
        entry.generation = generation;
        entry.layout = clone(layout);
      } else {
        entry = { generation, layout: clone(layout), waiters: record.waiters };
        record.waiters = entry.waiters;
        timers.set(key, entry);
      }
      return new Promise((resolve, reject) => {
        entry.waiters.push((result) => result instanceof Error ? reject(result) : resolve(result));
        entry.timer = setTimeout(() => {
          timers.delete(key);
          const waiters = entry.waiters.splice(0);
          dispatch(record, entry.generation, entry.layout).then((value) => waiters.forEach((done) => done(value)), (error) => waiters.forEach((done) => done(error)));
        }, NUMERIC_DEBOUNCE_MS);
      });
    }
    return dispatch(record, generation, clone(layout));
  }

  function retry(resource, slot) {
    if (hydration.status !== "Saved") return Promise.reject(new Error("Layout settings are not loaded"));
    const details = resourceDetails(resource, slot);
    const record = ensureRecord(resource, details.slot, slotLayout(details.domain, resource, details.slot));
    if (record.draft === null) return Promise.resolve({ status: "Saved" });
    record.status = "Saving";
    record.conflict = null;
    record.baseline = { layout: clone(record.acknowledged), revision: domains[details.domain].revision };
    const generation = ++record.generation;
    emit();
    return dispatch(record, generation, clone(record.draft));
  }

  function loadSaved(resource, slot) {
    const details = resourceDetails(resource, slot);
    const record = ensureRecord(resource, details.slot, slotLayout(details.domain, resource, details.slot));
    const timerKey = slotKey(resource, details.slot);
    const timer = timers.get(timerKey);
    if (timer) {
      clearTimeout(timer.timer);
      timers.delete(timerKey);
      timer.waiters.splice(0).forEach((resolve) => resolve({ status: "loaded" }));
    }
    record.draft = null;
    record.status = "Saved";
    record.conflict = null;
    record.baseline = null;
    record.generation += 1;
    record.acknowledged = clone(slotLayout(details.domain, resource, details.slot));
    emit();
    return publicRecord(record);
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function destroy() {
    destroyed = true;
    for (const entry of timers.values()) clearTimeout(entry.timer);
    timers.clear();
    socket?.off?.(CLOCK_EVENT, onClock);
    socket?.off?.(LEGEND_EVENT, onLegend);
    socket?.off?.("disconnect", onDisconnect);
    socket?.off?.("connect", onConnect);
    listeners.clear();
    pendingEvents.clear();
  }

  return { hydrate, getHydrationState: () => ({ ...hydration }), getSlot, subscribe, commit, retry, loadSaved, destroy };
}
