import { DEFAULT_PROJECTION_CONFIG } from "../shared/projection-config-schema.js";

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
  drawCompletion = null,
  route = "maplibre",
  baseline = null,
  prepareCandidate = null,
  commitCandidate = null,
  rollbackCandidate = null,
  finalizeCandidate = null,
  getDatasetVersion = () => null,
} = {}) {
  let stopped = true;
  let unsubscribe = null;
  let frameId = null;
  let latest = null;
  let latestRevision = -1;
  let generation = 0;
  let appliedConfig = null;
  let appliedRevision = -1;
  let appliedWall = null;
  let observedDatasetVersion = null;
  let hydrated = false;
  let failedRevision = -1;
  let failedError = null;
  let failedBaseline = null;
  let renderWait = null;
  let preparing = null;
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

  const abandonRenderWait = () => {
    const wait = renderWait;
    removeRenderWait();
    if (wait?.pair && typeof rollbackCandidate === "function") {
      try { rollbackCandidate(wait.pair, appliedConfig || initialConfig, wait.revision); }
      catch { /* A cancelled candidate cannot be acknowledged as applied. */ }
    }
  };
  const abortPreparation = () => { preparing?.abort?.abort(); preparing = null; };

  const wallFor = (pair, config) => {
    const wall = pair?.wall;
    if (!wall) return null;
    const expected = wall.diagnostics?.expected, placed = wall.diagnostics?.placed;
    if (typeof wall.datasetVersion !== 'string' || !wall.datasetVersion || !/^[a-f0-9]{64}$/i.test(wall.digest || '') ||
      !Number.isSafeInteger(expected) || expected < 1 || placed !== expected) return null;
    return { datasetVersion: wall.datasetVersion, mode: config.namesWall?.activeMode,
      digest: wall.digest, expected, placed };
  };

  const acknowledge = (revision, success, error, baselineOverride = undefined) => {
    const message = { type: "otef_projection_applied", table, output: spanId, revision, instanceId, success, route };
    const baselineIdentity = baselineOverride !== undefined ? baselineOverride : (typeof baseline === "function" ? baseline() : baseline);
    if (baselineIdentity != null) message.baseline = clone(baselineIdentity);
    if (error) message.error = String(error).slice(0, 240);
    if (success && appliedWall) message.wall = clone(appliedWall);
    send(message);
  };
  const baselineFor = (config) => typeof baseline === "function" ? baseline(config) : baseline;
  const currentDatasetVersion = () => getDatasetVersion() || null;
  const wallDatasetChanged = (wall) => Boolean(wall && currentDatasetVersion() &&
    wall.datasetVersion !== currentDatasetVersion());

  function restartLatest(reason = null) {
    if (stopped || !latest) return;
    generation += 1;
    abortPreparation();
    abandonRenderWait();
    if (frameId !== null) { cancelFrame(frameId); frameId = null; }
    failedRevision = -1;
    failedError = null;
    failedBaseline = null;
    awaitingReapply = true;
    if (reason) {
      appliedWall = null;
      acknowledge(latestRevision, false, reason, baselineFor(latest.config));
    }
    suspended = false;
    schedule();
  }

  function handleRenderFailure(revision, error, baselineOverride = undefined) {
    const failedIdentity = baselineOverride !== undefined ? baselineOverride : renderWait?.baseline;
    const failedPair = renderWait?.pair;
    generation += 1;
    removeRenderWait();
    const rollbackConfig = appliedConfig || initialConfig;
    const previousRollbackFlag = map?._otefProjectionConfigRollback;
    if (map) map._otefProjectionConfigRollback = true;
    let restored = false;
    try {
      if (failedPair && typeof rollbackCandidate === 'function') rollbackCandidate(failedPair, rollbackConfig, revision);
      else applyConfig(rollbackConfig, revision);
      restored = typeof drawCompletion === "function" ? drawCompletion(rollbackConfig, revision) === true : true;
    } catch { /* report failure without claiming restoration */ }
    finally {
      if (map) {
        if (previousRollbackFlag === undefined) delete map._otefProjectionConfigRollback;
        else map._otefProjectionConfigRollback = previousRollbackFlag;
      }
    }
    const nameFieldController = map?._otefNliNameFieldController;
    if (!restored && typeof nameFieldController?._rollbackProjectionConfig === "function") {
      try { nameFieldController._rollbackProjectionConfig(rollbackConfig, revision); } catch { /* keep the render failure visible */ }
    }
    failedRevision = revision;
    failedError = String(error?.message || error || "projection render failed").slice(0, 240);
    failedBaseline = failedIdentity ?? null;
    acknowledge(revision, false, failedError, failedIdentity);
  }

  const settleRender = (event) => {
    const wait = renderWait;
    if (!wait) return;
    if (stopped || generation !== wait.applyGeneration || latestRevision !== wait.revision) {
      abandonRenderWait();
      return;
    }
    if (event?.error) {
      if (wait.applying) { wait.pendingError = event.error; return; }
      handleRenderFailure(wait.revision, event.error);
      return;
    }
    if (wait.applying) return;
    if (wallDatasetChanged(wait.pair?.wall || appliedWall)) {
      restartLatest('name dataset changed; rebuilding wall');
      return;
    }
    if (typeof drawCompletion === "function") {
      let complete = false;
      try { complete = drawCompletion(wait.config, wait.revision) === true; } catch (error) { handleRenderFailure(wait.revision, error); return; }
      if (!complete) return;
    }
    appliedConfig = clone(wait.config);
    appliedRevision = wait.revision;
    if (wait.newCandidate) appliedWall = wallFor(wait.pair, wait.config);
    failedRevision = -1;
    failedError = null;
    failedBaseline = null;
    awaitingReapply = false;
    removeRenderWait();
    if (wait.pair && typeof finalizeCandidate === 'function') finalizeCandidate(wait.pair, wait.config, wait.revision);
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
    renderWait = { listener, errorListener, revision, applyGeneration, config, applying, newCandidate: applying, pendingError: null, baseline: null, timer: null };
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
    if (stopped || suspended || frameId !== null || preparing || !latest) return;
    frameId = requestFrame(() => {
      frameId = null;
      applyLatest();
    });
  };

  function applyLatest() {
    if (stopped || suspended || !latest || spanId !== "left" && spanId !== "right") return;
    const item = latest;
    const applyGeneration = ++generation;
    abandonRenderWait();
    if (typeof prepareCandidate === 'function') {
      const abort = new AbortController();
      preparing = { generation: applyGeneration, revision: item.revision, abort };
      let preparation;
      try { preparation = prepareCandidate(item.config, item.revision, applyGeneration, abort.signal); }
      catch (error) { preparation = Promise.reject(error); }
      Promise.resolve(preparation).then((pair) => {
        if (stopped || suspended || generation !== applyGeneration || latestRevision !== item.revision) {
          rollbackCandidate?.(pair, appliedConfig || initialConfig, item.revision);
          return;
        }
        if (wallDatasetChanged(pair?.wall)) {
          rollbackCandidate?.(pair, appliedConfig || initialConfig, item.revision);
          restartLatest('name dataset changed; rebuilding wall');
          return;
        }
        preparing = null;
        frameId = requestFrame(() => {
          frameId = null;
          if (stopped || suspended || generation !== applyGeneration || latestRevision !== item.revision) {
            rollbackCandidate?.(pair, appliedConfig || initialConfig, item.revision);
            schedule();
            return;
          }
          if (wallDatasetChanged(pair?.wall)) {
            rollbackCandidate?.(pair, appliedConfig || initialConfig, item.revision);
            restartLatest('name dataset changed; rebuilding wall');
            return;
          }
          waitForRender(item.revision, applyGeneration, item.config);
          const wait = renderWait;
          if (wait) { wait.baseline = clone(baselineFor(item.config)); wait.pair = pair; }
          try {
            commitCandidate(pair, item.config, item.revision);
            if (wait) {
              wait.applying = false;
              if (wait.pendingError) { handleRenderFailure(item.revision, wait.pendingError); return; }
            }
            map?.triggerRepaint?.();
          } catch (error) { handleRenderFailure(item.revision, error); }
        });
      }).catch((error) => {
        if (stopped || generation !== applyGeneration || latestRevision !== item.revision) return;
        preparing = null;
        failedRevision = item.revision;
        failedError = String(error?.message || error).slice(0, 240);
        failedBaseline = baselineFor(item.config);
        acknowledge(item.revision, false, failedError, failedBaseline);
      });
      return;
    }
    if (typeof map?.on !== "function" && typeof map?.once !== "function") {
      // Without a render completion event there is no evidence for a successful
      // browser-output acknowledgement. Keep the presentation usable but report
      // the missing completion honestly.
      try {
        applyConfig(item.config, item.revision);
        failedRevision = item.revision;
        failedError = "render completion unavailable";
        acknowledge(item.revision, false, "render completion unavailable", baselineFor(item.config));
      } catch (error) {
        acknowledge(item.revision, false, error?.message || error, baselineFor(item.config));
      }
      return;
    }
    waitForRender(item.revision, applyGeneration, item.config);
    try {
      const wait = renderWait;
      if (wait) wait.baseline = clone(baselineFor(item.config));
      applyConfig(item.config, item.revision);
      if (wait) {
        wait.baseline = clone(baselineFor(item.config));
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
    if (snapshot.revision <= latestRevision) return;
    if (snapshot.revision > latestRevision && renderWait) {
      generation += 1;
      abandonRenderWait();
    }
    if (snapshot.revision > latestRevision && preparing) {
      generation += 1;
      abortPreparation();
    }
    latestRevision = snapshot.revision;
    latest = { revision: snapshot.revision, config: clone(snapshot.config) };
    if (snapshot.revision > failedRevision) { failedRevision = -1; failedError = null; failedBaseline = null; }
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
    if (datasetChanged()) return;
    if (awaitingReapply) { schedule(); return; }
    if (failedRevision === latestRevision) {
      acknowledge(failedRevision, false, failedError || "projection render failed", failedBaseline);
      return;
    }
    if (!appliedConfig || appliedRevision < 0) {
      if (latest && !preparing && !renderWait) schedule();
      return;
    }
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
    observedDatasetVersion = currentDatasetVersion();
    if (typeof client?.subscribe === "function") unsubscribe = client.subscribe(onState);
    if (typeof socket?.on === "function") {
      const connect = () => { if (hydrated) requestStatus(); };
      const disconnect = () => { generation += 1; abortPreparation(); abandonRenderWait(); };
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
    abortPreparation();
    if (frameId !== null) { cancelFrame(frameId); frameId = null; }
    abandonRenderWait();
    if (typeof unsubscribe === "function") unsubscribe();
    unsubscribe = null;
    if (typeof socket?.off === "function") for (const [event, handler] of socketHandlers) socket.off(event, handler);
    socketHandlers.length = 0;
  }

  function invalidate() {
    generation += 1;
    suspended = true;
    awaitingReapply = true;
    abortPreparation();
    abandonRenderWait();
    if (frameId !== null) { cancelFrame(frameId); frameId = null; }
  }

  function resume() {
    if (stopped || !suspended) return;
    suspended = false;
    schedule();
  }

  function reapply(reason = null) {
    restartLatest(reason);
  }

  function datasetChanged() {
    const nextVersion = currentDatasetVersion();
    if (nextVersion === observedDatasetVersion) return false;
    observedDatasetVersion = nextVersion;
    if (suspended) { appliedWall = null; awaitingReapply = true; return true; }
    restartLatest('name dataset changed; rebuilding wall');
    return true;
  }

  return { start, stop, requestStatus, invalidate, resume, reapply, datasetChanged };
}
