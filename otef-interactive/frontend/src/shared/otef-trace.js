const TRACE_STORE_KEY = "__OTEF_TRACE_STORE__";
const TRACE_ENABLED_KEY = "__OTEF_TRACE_ENABLED__";
const TRACE_CONSOLE_KEY = "__OTEF_TRACE_CONSOLE__";
const TRACE_VIEWPORT_KEY = "__OTEF_TRACE_VIEWPORT__";
const MAX_EVENTS = 2000;

function getGlobalScope() {
  if (typeof window !== "undefined") return window;
  if (typeof globalThis !== "undefined") return globalThis;
  return null;
}

function getTraceStore() {
  const scope = getGlobalScope();
  if (!scope) return null;
  if (!scope[TRACE_STORE_KEY]) {
    scope[TRACE_STORE_KEY] = {
      events: [],
      byTraceId: new Map(),
    };
  }
  return scope[TRACE_STORE_KEY];
}

export function isTraceEnabled() {
  const scope = getGlobalScope();
  if (!scope) return false;
  return scope[TRACE_ENABLED_KEY] !== false;
}

export function setTraceEnabled(enabled) {
  const scope = getGlobalScope();
  if (!scope) return;
  scope[TRACE_ENABLED_KEY] = !!enabled;
}

function isConsoleTraceEnabled() {
  const scope = getGlobalScope();
  if (!scope) return false;
  return scope[TRACE_CONSOLE_KEY] === true;
}

function isViewportTraceEnabled() {
  const scope = getGlobalScope();
  if (!scope) return false;
  return scope[TRACE_VIEWPORT_KEY] === true;
}

function isHighVolumeViewportStage(stage) {
  if (typeof stage !== "string") return false;
  return (
    stage.startsWith("ws.viewport") ||
    stage.startsWith("context.viewport_from") ||
    stage.startsWith("remote.zoom") ||
    stage.startsWith("api.command")
  );
}

export function generateTraceId(prefix = "otef") {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now()}-${rand}`;
}

export function recordTraceEvent(traceId, stage, details = {}) {
  if (!isTraceEnabled()) return null;
  if (!traceId || !stage) return null;
  if (isHighVolumeViewportStage(stage) && !isViewportTraceEnabled()) return null;

  const nowMs = Date.now();
  const perfNow =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : null;

  const event = {
    traceId,
    stage,
    nowMs,
    perfNow,
    ...details,
  };

  const store = getTraceStore();
  if (store) {
    store.events.push(event);
    if (store.events.length > MAX_EVENTS) {
      store.events.splice(0, store.events.length - MAX_EVENTS);
    }
    const traceEvents = store.byTraceId.get(traceId) || [];
    traceEvents.push(event);
    store.byTraceId.set(traceId, traceEvents);
  }

  if (
    isConsoleTraceEnabled() &&
    typeof console !== "undefined" &&
    typeof console.log === "function"
  ) {
    console.log("[OTEF TRACE]", event);
  }
  return event;
}

export function getTraceEvents(traceId) {
  const store = getTraceStore();
  if (!store) return [];
  if (!traceId) return [...store.events];
  return [...(store.byTraceId.get(traceId) || [])];
}

if (typeof window !== "undefined") {
  window.OTEFTrace = {
    generateTraceId,
    recordTraceEvent,
    getTraceEvents,
    setTraceEnabled,
    isTraceEnabled,
    setConsoleVerbose(enabled) {
      window[TRACE_CONSOLE_KEY] = !!enabled;
    },
    setViewportTracing(enabled) {
      window[TRACE_VIEWPORT_KEY] = !!enabled;
    },
  };
}
