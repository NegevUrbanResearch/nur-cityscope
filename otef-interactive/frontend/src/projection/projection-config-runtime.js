import { DEFAULT_PROJECTION_CONFIG } from "../shared/projection-config-schema.js";
import { equalProjectionConfig } from "../shared/projection-config-client.js";

const TABLE = "otef";

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function createProjectionConfigRuntime({
  map,
  spanId,
  client,
  socket,
  applyConfig,
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis) || ((fn) => setTimeout(fn, 0)),
  cancelFrame = globalThis.cancelAnimationFrame?.bind(globalThis) || clearTimeout,
  instanceId,
  table = TABLE,
  clock = globalThis,
  renderTimeoutMs = 1000,
  isDocumentVisible = () => globalThis.document?.visibilityState !== "hidden",
} = {}) {
  let stopped = true;
  let unsubscribe = null;
  let frameId = null;
  let latest = null;
  let latestRevision = -1;
  let generation = 0;
  let appliedConfig = null;
  let appliedRevision = -1;
  let hydrated = false;
  let failedRevision = -1;
  let failedError = null;
  let renderWait = null;
  let suspended = false;
  let awaitingReapply = false;
  const initialConfig = clone(map?.getEffectiveProjectionConfig?.() || DEFAULT_PROJECTION_CONFIG);
  const socketHandlers = [];

  const send = (message) => {
    if (socket && typeof socket.send === "function") socket.send(message);
  };

  const removeRenderWait = () => {
    if (!renderWait) return;
    if (typeof map?.off === "function") map.off("render", renderWait.listener);
    if (typeof map?.off === "function") map.off("error", renderWait.errorListener);
    if (renderWait.timer !== null && typeof clock.clearTimeout === "function") clock.clearTimeout(renderWait.timer);
    renderWait = null;
  };

  const acknowledge = (revision, success, error) => {
    const message = { type: "otef_projection_applied", table, output: spanId, revision, instanceId, success };
    if (error) message.error = String(error).slice(0, 240);
    send(message);
  };

  function handleRenderFailure(revision, error) {
    generation += 1;
    removeRenderWait();
    try { applyConfig(appliedConfig || initialConfig, revision); } catch { /* report failure without claiming restoration */ }
    failedRevision = revision;
    failedError = String(error?.message || error || "projection render failed").slice(0, 240);
    acknowledge(revision, false, failedError);
  }

  const settleRender = (event) => {
    const wait = renderWait;
    if (!wait) return;
    if (stopped || generation !== wait.applyGeneration || latestRevision !== wait.revision) {
      removeRenderWait();
      return;
    }
    if (event?.error) {
      if (wait.applying) { wait.pendingError = event.error; return; }
      handleRenderFailure(wait.revision, event.error);
      return;
    }
    if (wait.applying) return;
    appliedConfig = clone(wait.config);
    appliedRevision = wait.revision;
    failedRevision = -1;
    failedError = null;
    awaitingReapply = false;
    removeRenderWait();
    acknowledge(wait.revision, true);
  };

  const waitForRender = (revision, applyGeneration, config, applying = true) => {
    removeRenderWait();
    const listener = (event) => {
      if (!renderWait || renderWait.listener !== listener) return;
      settleRender(event);
    };
    const errorListener = (event) => {
      // Tile/source errors are unrelated to projection application.
      if (!renderWait || renderWait.errorListener !== errorListener || !event?.error || event.sourceId || event.source || event.tile) return;
      settleRender(event);
    };
    renderWait = { listener, errorListener, revision, applyGeneration, config, applying, pendingError: null, timer: null };
    if (typeof map?.on === "function") map.on("render", listener);
    else if (typeof map?.once === "function") map.once("render", listener);
    if (typeof map?.on === "function") map.on("error", errorListener);
    if (typeof clock.setTimeout === "function") {
      const onTimeout = () => {
        if (renderWait?.listener !== listener) return;
        if (!isDocumentVisible()) {
          renderWait.timer = clock.setTimeout(onTimeout, renderTimeoutMs);
          return;
        }
        handleRenderFailure(revision, "render completion timeout");
      };
      renderWait.timer = clock.setTimeout(onTimeout, renderTimeoutMs);
    }
    if (typeof map?.on !== "function" && typeof map?.once !== "function") settleRender({ error: "render completion unavailable" });
  };

  const schedule = () => {
    if (stopped || suspended || frameId !== null || !latest) return;
    frameId = requestFrame(() => {
      frameId = null;
      applyLatest();
    });
  };

  function applyLatest() {
    if (stopped || suspended || !latest || spanId !== "left" && spanId !== "right") return;
    const item = latest;
    const applyGeneration = ++generation;
    removeRenderWait();
    if (typeof map?.on !== "function" && typeof map?.once !== "function") {
      // Without a render completion event there is no evidence for a successful
      // browser-output acknowledgement. Keep the presentation usable but report
      // the missing completion honestly.
      try {
        applyConfig(item.config, item.revision);
        failedRevision = item.revision;
        failedError = "render completion unavailable";
        acknowledge(item.revision, false, "render completion unavailable");
      } catch (error) {
        acknowledge(item.revision, false, error?.message || error);
      }
      return;
    }
    waitForRender(item.revision, applyGeneration, item.config);
    try {
      applyConfig(item.config, item.revision);
      const wait = renderWait;
      if (wait) {
        wait.applying = false;
        if (wait.pendingError) {
          handleRenderFailure(item.revision, wait.pendingError);
          return;
        }
      }
      if (typeof map?.triggerRepaint === "function") map.triggerRepaint();
    } catch (error) {
      handleRenderFailure(item.revision, error);
    }
  }

  function onState(state) {
    const snapshot = state?.snapshot;
    if (spanId !== "left" && spanId !== "right") return;
    if (!snapshot || !Number.isSafeInteger(snapshot.revision) || !snapshot.config) return;
    if (snapshot.revision < latestRevision) return;
    if (snapshot.revision === latestRevision && latest && equalProjectionConfig(snapshot.config, latest.config)) return;
    if (snapshot.revision > latestRevision && renderWait) {
      generation += 1;
      removeRenderWait();
    }
    latestRevision = snapshot.revision;
    latest = { revision: snapshot.revision, config: clone(snapshot.config) };
    if (snapshot.revision > failedRevision) { failedRevision = -1; failedError = null; }
    if (!hydrated) {
      hydrated = true;
      requestStatus();
    }
    schedule();
  }

  function onStatusRequest(message = {}) {
    if (spanId !== "left" && spanId !== "right") return;
    if (message.table && message.table !== table) return;
    if (suspended) return;
    if (awaitingReapply) { schedule(); return; }
    if (failedRevision === latestRevision) {
      acknowledge(failedRevision, false, failedError || "projection render failed");
      return;
    }
    if (!appliedConfig || appliedRevision < 0) return;
    if (latest && latestRevision > appliedRevision) {
      if (!renderWait) schedule();
      return;
    }
    const applyGeneration = ++generation;
    waitForRender(appliedRevision, applyGeneration, appliedConfig, false);
    if (typeof map?.triggerRepaint === "function") map.triggerRepaint();
  }

  function requestStatus() {
    if (spanId !== "left" && spanId !== "right") return;
    send({ type: "otef_projection_status_request", table, sourceId: instanceId });
    if (!suspended) onStatusRequest({ table });
  }

  async function start() {
    if (!stopped) return;
    stopped = false;
    if (typeof client?.subscribe === "function") unsubscribe = client.subscribe(onState);
    if (typeof socket?.on === "function") {
      const connect = () => { if (hydrated) requestStatus(); };
      const disconnect = () => { removeRenderWait(); generation += 1; };
      const status = (message) => onStatusRequest(message);
      socket.on("connect", connect);
      socket.on("disconnect", disconnect);
      socket.on("otef_projection_status_request", status);
      socketHandlers.push(["connect", connect], ["disconnect", disconnect], ["otef_projection_status_request", status]);
    }
    if (typeof client?.start === "function") await client.start();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    generation += 1;
    if (frameId !== null) { cancelFrame(frameId); frameId = null; }
    removeRenderWait();
    if (typeof unsubscribe === "function") unsubscribe();
    unsubscribe = null;
    if (typeof socket?.off === "function") for (const [event, handler] of socketHandlers) socket.off(event, handler);
    socketHandlers.length = 0;
  }

  function invalidate() {
    generation += 1;
    suspended = true;
    awaitingReapply = true;
    removeRenderWait();
    if (frameId !== null) { cancelFrame(frameId); frameId = null; }
  }

  function resume() {
    if (stopped || !suspended) return;
    suspended = false;
    schedule();
  }

  return { start, stop, requestStatus, invalidate, resume };
}
