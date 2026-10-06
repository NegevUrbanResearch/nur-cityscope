import { DEFAULT_PROJECTION_CONFIG } from "../shared/projection-config-schema.js";
import { projectionPlacementInputIdentity } from "./projection-names-run.js";

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
  displaySide = spanId,
  reversed = false,
  baseline = null,
  prepareGeometry = null,
  rollbackGeometry = null,
  finalizeGeometry = null,
  prepareCandidate = null,
  commitCandidate = null,
  rollbackCandidate = null,
  finalizeCandidate = null,
  getDatasetVersion = () => null,
  getDatasetIdentityError = () => null,
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
  let installedNames = null;
  let namesState = "initializing";
  let namesTarget = null;
  let namesGeneration = 0;
  let namesTargetGeneration = 0;
  let namesJob = null;
  let namesRenderWait = null;
  let initialNamesAttempted = false;
  let initialNamesDatasetRetry = false;
  const namesRequests = new Map();
  let observedDatasetVersion = null;
  let datasetIdentityError = null;
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
    if (wait?.geometryPair && typeof rollbackGeometry === "function") {
      const previousRollbackFlag = map?._otefProjectionConfigRollback;
      if (map) map._otefProjectionConfigRollback = true;
      try {
        const previousConfig = appliedConfig || initialConfig;
        rollbackGeometry(wait.geometryPair, previousConfig, wait.revision);
        applyConfig(previousConfig, wait.revision);
      }
      catch { /* A cancelled candidate cannot be acknowledged as applied. */ }
      finally {
        if (map) {
          if (previousRollbackFlag === undefined) delete map._otefProjectionConfigRollback;
          else map._otefProjectionConfigRollback = previousRollbackFlag;
        }
      }
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
    const message = { type: "otef_projection_applied", table, output: spanId, revision, instanceId, success, route, displaySide, reversed };
    const baselineIdentity = baselineOverride !== undefined ? baselineOverride : (typeof baseline === "function" ? baseline() : baseline);
    if (baselineIdentity != null) message.baseline = clone(baselineIdentity);
    if (error) message.error = String(error).slice(0, 240);
    if (success && appliedWall) message.wall = clone(appliedWall);
    send(message);
  };
  const reportNames = (state = namesState, request = null, error = "", correlationTarget = null) => {
    if (!correlationTarget) namesState = state;
    if (!error && state === "failed") error = datasetIdentityError || "";
    const target = correlationTarget || namesTarget;
    const message = { type: "otef_projection_names_status", table, output: spanId, instanceId,
      requestId: request?.requestId ?? null, revision: target?.revision ?? Math.max(0, appliedRevision),
      datasetVersion: target?.datasetVersion ?? "", placementIdentity: target?.placementIdentity ?? "",
      state, installed: installedNames ? { ...installedNames } : null };
    if (error) message.error = String(error).slice(0, 240);
    send(message);
  };
  const baselineFor = (config) => typeof baseline === "function" ? baseline(config) : baseline;
  const currentDatasetVersion = () => getDatasetVersion() || null;
  const wallDatasetChanged = (wall) => Boolean(wall && currentDatasetVersion() &&
    wall.datasetVersion !== currentDatasetVersion());

  function promoteInstalledNamesForTarget(target = namesTarget) {
    if (!target || appliedRevision !== target.revision || !installedNames ||
      installedNames.datasetVersion !== target.datasetVersion || installedNames.placementIdentity !== target.placementIdentity ||
      currentDatasetVersion() !== target.datasetVersion) return false;
    if (installedNames.revision !== target.revision) installedNames = { ...installedNames, revision: target.revision };
    reportNames("current");
    return true;
  }

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
    if (reason) acknowledge(latestRevision, false, reason, baselineFor(latest.config));
    suspended = false;
    schedule();
  }

  function handleRenderFailure(revision, error, baselineOverride = undefined) {
    const failedIdentity = baselineOverride !== undefined ? baselineOverride : renderWait?.baseline;
    const failedGeometryPair = renderWait?.geometryPair;
    generation += 1;
    removeRenderWait();
    const rollbackConfig = appliedConfig || initialConfig;
    const previousRollbackFlag = map?._otefProjectionConfigRollback;
    if (map) map._otefProjectionConfigRollback = true;
    let restored = false;
    try {
      if (failedGeometryPair && typeof rollbackGeometry === 'function') rollbackGeometry(failedGeometryPair, rollbackConfig, revision);
      applyConfig(rollbackConfig, revision);
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
    if (stopped || suspended || generation !== wait.applyGeneration || latestRevision !== wait.revision) {
      abandonRenderWait();
      return;
    }
    if (event?.error) {
      if (wait.applying) { wait.pendingError = event.error; return; }
      handleRenderFailure(wait.revision, event.error);
      return;
    }
    if (wait.applying) return;
    if (wallDatasetChanged(installedNames)) { invalidateNames("name dataset changed"); }
    if (typeof drawCompletion === "function") {
      let complete = false;
      try { complete = drawCompletion(wait.config, wait.revision) === true; } catch (error) { handleRenderFailure(wait.revision, error); return; }
      if (!complete) return;
    }
    appliedConfig = clone(wait.config);
    appliedRevision = wait.revision;
    failedRevision = -1;
    failedError = null;
    failedBaseline = null;
    awaitingReapply = false;
    removeRenderWait();
    promoteInstalledNamesForTarget();
    if (wait.geometryPair && typeof finalizeGeometry === 'function') finalizeGeometry(wait.geometryPair, wait.config, wait.revision);
    acknowledge(wait.revision, true);
    if (!initialNamesAttempted && !installedNames) {
      initialNamesAttempted = true;
      const config = clone(latest.config), revision = latestRevision;
      void setNamesTarget(config, revision).then((target) => {
        if (!target || stopped || latestRevision !== revision || appliedRevision !== revision) return;
        if (!target.datasetVersion) {
          const identityError = getDatasetIdentityError?.() || datasetIdentityError;
          if (identityError) {
            datasetIdentityError = String(identityError).slice(0, 240);
            reportNames("failed", null, datasetIdentityError);
          } else {
            reportNames("initializing", null, "Waiting for the names dataset identity");
          }
          return;
        }
        void runNamesBuild(null, config, target);
      }).catch((error) => reportNames("failed", null, error?.message || error));
    }
  };

  const waitForRender = (revision, applyGeneration, config, applying = true, geometryPair = null) => {
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
    renderWait = { listener, errorListener, revision, applyGeneration, config, applying, geometryPair, newCandidate: false, pendingError: null, baseline: null, timer: null };
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
    cancelNamesBuild("geometry changed");
    abandonRenderWait();
    if (typeof prepareGeometry !== "function") {
      if (typeof map?.on !== "function" && typeof map?.once !== "function") {
        try {
          applyConfig(item.config, item.revision);
          failedRevision = item.revision;
          failedError = "render completion unavailable";
          acknowledge(item.revision, false, failedError, baselineFor(item.config));
        } catch (error) { acknowledge(item.revision, false, error?.message || error, baselineFor(item.config)); }
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
          if (wait.pendingError) { handleRenderFailure(item.revision, wait.pendingError); return; }
        }
        map?.triggerRepaint?.();
      } catch (error) { handleRenderFailure(item.revision, error); }
      return;
    }
    const abort = new AbortController();
    const preparation = { abort };
    preparing = preparation;
    void (async () => {
      let geometryPair = null;
      try {
        if (typeof prepareGeometry === "function") geometryPair = await prepareGeometry(item.config, item.revision, abort.signal);
        if (stopped || suspended || abort.signal.aborted || preparing !== preparation || generation !== applyGeneration || latestRevision !== item.revision) return;
        preparing = null;
        if (typeof map?.on !== "function" && typeof map?.once !== "function") {
          // Apply validated geometry, but do not claim it rendered successfully.
      applyConfig(item.config, item.revision, geometryPair);
      if (geometryPair && typeof finalizeGeometry === "function") finalizeGeometry(geometryPair, item.config, item.revision);
          failedRevision = item.revision;
          failedError = "render completion unavailable";
          acknowledge(item.revision, false, failedError, baselineFor(item.config));
          return;
        }
        waitForRender(item.revision, applyGeneration, item.config, true, geometryPair);
        const wait = renderWait;
        if (wait) wait.baseline = clone(baselineFor(item.config));
        applyConfig(item.config, item.revision, geometryPair);
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
        if (preparing === preparation) preparing = null;
        if (geometryPair && !renderWait && typeof rollbackGeometry === "function") {
          try { rollbackGeometry(geometryPair, appliedConfig || initialConfig, item.revision); } catch { /* report the apply error below */ }
        }
        if (stopped || abort.signal.aborted || latestRevision !== item.revision) return;
        if (renderWait?.revision === item.revision) handleRenderFailure(item.revision, error);
        else {
          failedRevision = item.revision;
          failedError = String(error?.message || error || "projection geometry validation failed").slice(0, 240);
          acknowledge(item.revision, false, failedError, baselineFor(item.config));
        }
      } finally {
        if (preparing === preparation) preparing = null;
        if (!stopped && !suspended && latestRevision > item.revision) schedule();
      }
    })();
  }

  function cancelNamesBuild(reason) {
    namesGeneration += 1;
    namesJob?.abort?.abort();
    // Ownership lasts through the render promise continuation, so a newer
    // geometry apply always starts with the last completed names installed.
    namesJob?.rollback?.();
    namesJob = null;
    if (namesRenderWait) {
      map?.off?.("render", namesRenderWait.listener);
      if (namesRenderWait.timer !== null) clock.clearTimeout(namesRenderWait.timer);
      namesRenderWait.rollback?.();
      namesRenderWait.cancel?.(Object.assign(new Error(reason || "names run cancelled"), { name: "AbortError" }));
      namesRenderWait = null;
    }
  }

  async function setNamesTarget(config, revision) {
    const token = ++namesTargetGeneration;
    const datasetVersion = currentDatasetVersion() || "";
    let placementIdentity = "";
    try { placementIdentity = await projectionPlacementInputIdentity(config); } catch { /* the ordinary config validator reports malformed configs */ }
    if (stopped || token !== namesTargetGeneration || latestRevision !== revision || !latest || JSON.stringify(latest.config) !== JSON.stringify(config)) return;
    namesTarget = { revision, datasetVersion, placementIdentity };
    datasetIdentityError = getDatasetIdentityError?.() || datasetIdentityError;
    if (datasetIdentityError) {
      reportNames("failed", null, datasetIdentityError);
    } else if (!promoteInstalledNamesForTarget(namesTarget)) {
      reportNames(installedNames && installedNames.revision === revision && installedNames.datasetVersion === datasetVersion && installedNames.placementIdentity === placementIdentity ? "current" : installedNames ? "stale" : "initializing");
    }
    return namesTarget;
  }

  function awaitNamesRender(pair, config, revision, token, request) {
    return new Promise((resolve, reject) => {
      if (typeof map?.on !== "function" && typeof map?.once !== "function") { reject(new Error("render completion unavailable")); return; }
      const onTimeout = () => {
        if (namesRenderWait?.listener !== listener) return;
        if (!isDocumentVisible()) {
          namesRenderWait.timer = clock.setTimeout(onTimeout, renderTimeoutMs);
          return;
        }
        finish(new Error("name render completion timeout"));
      };
      const timer = typeof clock.setTimeout === "function" ? clock.setTimeout(onTimeout, renderTimeoutMs) : null;
      const listener = () => {
        if (namesRenderWait?.listener !== listener) return;
        if (stopped || suspended || token !== namesGeneration || latestRevision !== revision || (request && namesJob?.request?.requestId !== request.requestId)) {
          finish(Object.assign(new Error("names run superseded"), { name: "AbortError" })); return;
        }
        let complete = false;
        try { complete = typeof drawCompletion === "function" ? drawCompletion(config, revision) === true : true; }
        catch (error) { finish(error); return; }
        if (complete) finish();
      };
      const finish = (error = null) => {
        if (namesRenderWait?.listener !== listener) return;
        map?.off?.("render", listener);
        if (namesRenderWait.timer !== null) clock.clearTimeout(namesRenderWait.timer);
        namesRenderWait = null;
        if (error) reject(error); else resolve();
      };
      namesRenderWait = { listener, pair, config, revision, committed: true, timer, cancel: (error) => finish(error) };
      map?.on?.("render", listener);
      map?.triggerRepaint?.();
      if (typeof map?.on !== "function") map?.once?.("render", listener);
    });
  }

  async function runNamesBuild(requestId, config, target) {
    if (typeof prepareCandidate !== "function" || !target || !target.placementIdentity ||
      (requestId && (latestRevision !== target.revision || appliedRevision !== target.revision))) return false;
    const request = requestId ? { requestId, ...target } : null;
    if (request && namesRequests.has(requestId)) return namesRequests.get(requestId);
    const token = ++namesGeneration;
    const abort = new AbortController();
    namesJob = { abort, request };
    reportNames("rebuilding", request);
    const operation = (async () => {
      let pair;
      let committed = false;
      let candidateRolledBack = false;
      const isCurrentTarget = () => !stopped && !suspended && token === namesGeneration && !abort.signal.aborted &&
        latestRevision === target.revision && appliedRevision === target.revision && namesTarget === target &&
        (currentDatasetVersion() || "") === target.datasetVersion;
      const rollbackPrepared = () => {
        if (!pair || candidateRolledBack) return;
        rollbackCandidate?.(pair, appliedConfig || initialConfig, target.revision, { namesOnly: true });
        candidateRolledBack = true;
      };
      try {
        pair = await prepareCandidate(config, target.revision, token, abort.signal);
        if (!isCurrentTarget()) {
          rollbackPrepared(); throw Object.assign(new Error("names run superseded"), { name: "AbortError" });
        }
        const actualIdentity = await projectionPlacementInputIdentity(config);
        if (!isCurrentTarget() || actualIdentity !== target.placementIdentity) {
          rollbackPrepared(); throw Object.assign(new Error("names run superseded"), { name: "AbortError" });
        }
        const wall = wallFor(pair, config);
        if (!wall || wall.datasetVersion !== target.datasetVersion) {
          rollbackPrepared(); throw new Error("prepared name wall does not match the requested dataset");
        }
        commitCandidate?.(pair, config, target.revision);
        committed = true;
        if (namesJob?.abort === abort) namesJob.rollback = rollbackPrepared;
        const renderPromise = awaitNamesRender(pair, config, target.revision, token, request);
        if (namesRenderWait) namesRenderWait.rollback = rollbackPrepared;
        await renderPromise;
        if (!isCurrentTarget()) throw Object.assign(new Error("names run superseded"), { name: "AbortError" });
        finalizeCandidate?.(pair, config, target.revision);
        installedNames = { revision: target.revision, datasetVersion: wall.datasetVersion,
          placementIdentity: target.placementIdentity, mode: wall.mode, digest: wall.digest,
          expected: wall.expected, placed: wall.placed };
        appliedWall = wall;
        reportNames("current", request);
        acknowledge(target.revision, true);
        return true;
      } catch (error) {
        if (pair && !committed && !candidateRolledBack) rollbackPrepared();
        if (pair && committed && !candidateRolledBack) rollbackCandidate?.(pair, appliedConfig || initialConfig, target.revision, { namesOnly: true });
        if (token === namesGeneration && error?.name !== "AbortError") reportNames("failed", request, error?.message || error);
        return false;
      } finally {
        if (namesJob?.abort === abort) namesJob = null;
      }
    })();
    if (requestId) {
      namesRequests.set(requestId, operation);
      while (namesRequests.size > 32) namesRequests.delete(namesRequests.keys().next().value);
    }
    return operation;
  }

  async function onNamesRun(message) {
    if (message?.table !== table || typeof message.requestId !== "string" || !Number.isSafeInteger(message.revision) ||
      typeof message.datasetVersion !== "string" || !/^[a-f0-9]{64}$/i.test(message.placementIdentity || "")) return;
    if (namesRequests.has(message.requestId)) return;
    const config = latest?.config;
    const target = namesTarget;
    const targetGeneration = namesTargetGeneration;
    const validBeforeHash = Boolean(config && target && !stopped && !suspended && message.revision === latestRevision &&
      message.revision === appliedRevision && message.datasetVersion === (currentDatasetVersion() || "") &&
      target.revision === message.revision && target.datasetVersion === message.datasetVersion &&
      target.placementIdentity === message.placementIdentity);
    if (!validBeforeHash) {
      const unavailable = !currentDatasetVersion() || datasetIdentityError;
      reportNames(unavailable ? "failed" : "stale", message,
        unavailable ? (datasetIdentityError || "Accepted name dataset identity unavailable") : "Run target no longer matches the applied calibration", {
        revision: message.revision, datasetVersion: message.datasetVersion, placementIdentity: message.placementIdentity,
      });
      return;
    }
    const actualIdentity = await projectionPlacementInputIdentity(config);
    if (stopped || suspended || targetGeneration !== namesTargetGeneration || target !== namesTarget ||
      latestRevision !== message.revision || appliedRevision !== message.revision ||
      (currentDatasetVersion() || "") !== message.datasetVersion || actualIdentity !== message.placementIdentity) {
      reportNames("stale", message, "Run target no longer matches the applied calibration", {
        revision: message.revision, datasetVersion: message.datasetVersion, placementIdentity: message.placementIdentity,
      });
      return;
    }
    void runNamesBuild(message.requestId, config, target);
  }

  function invalidateNames(reason) {
    cancelNamesBuild(reason);
    if (namesTarget) reportNames("stale", null, reason);
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
    cancelNamesBuild("calibration changed");
    namesTargetGeneration += 1;
    latestRevision = snapshot.revision;
    latest = { revision: snapshot.revision, config: clone(snapshot.config) };
    namesTarget = null;
    void setNamesTarget(latest.config, latest.revision);
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
      reportNames(namesState);
      return;
    }
    if (!appliedConfig || appliedRevision < 0) {
      if (latest && !preparing && !renderWait) schedule();
      reportNames(namesState);
      return;
    }
    if (latest && latestRevision > appliedRevision) {
      if (!renderWait) schedule();
      return;
    }
    const applyGeneration = ++generation;
    waitForRender(appliedRevision, applyGeneration, appliedConfig, false);
    if (typeof map?.triggerRepaint === "function") map.triggerRepaint();
    reportNames(namesState);
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
      const disconnect = () => {
        generation += 1; abortPreparation(); abandonRenderWait();
        const namesWereRebuilding = namesState === "rebuilding";
        cancelNamesBuild("socket disconnected");
        if (namesWereRebuilding) reportNames("stale", null, "Names run cancelled because the connection was lost");
      };
      const status = (message) => onStatusRequest(message);
      const namesRun = (message) => { void onNamesRun(message); };
      socket.on("connect", connect);
      socket.on("disconnect", disconnect);
      socket.on("otef_projection_status_request", status);
      socket.on("otef_projection_names_run", namesRun);
      socketHandlers.push(["connect", connect], ["disconnect", disconnect], ["otef_projection_status_request", status], ["otef_projection_names_run", namesRun]);
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
    cancelNamesBuild("runtime stopped");
    if (typeof unsubscribe === "function") unsubscribe();
    unsubscribe = null;
    if (typeof socket?.off === "function") for (const [event, handler] of socketHandlers) socket.off(event, handler);
    socketHandlers.length = 0;
  }

  function invalidate() {
    generation += 1;
    suspended = true;
    awaitingReapply = true;
    const hadNamesWork = Boolean(namesJob || namesRenderWait);
    cancelNamesBuild("runtime invalidated");
    if (hadNamesWork && namesTarget) {
      const installedMatches = installedNames && installedNames.revision === namesTarget.revision &&
        installedNames.datasetVersion === namesTarget.datasetVersion && installedNames.placementIdentity === namesTarget.placementIdentity;
      reportNames(installedMatches ? "current" : "stale");
    }
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
    if (!nextVersion || nextVersion === observedDatasetVersion) return false;
    datasetIdentityError = null;
    if (!observedDatasetVersion) {
      observedDatasetVersion = nextVersion;
      if (!initialNamesAttempted || installedNames || initialNamesDatasetRetry || !latest || appliedRevision !== latestRevision) return false;
      initialNamesDatasetRetry = true;
      cancelNamesBuild("names dataset identity became available");
      void setNamesTarget(latest.config, latestRevision).then((target) => {
        if (target && !installedNames && !stopped && !suspended && appliedRevision === latestRevision) {
          void runNamesBuild(null, latest.config, target);
        }
      });
      return true;
    }
    observedDatasetVersion = nextVersion;
    if (namesTarget) namesTarget = { ...namesTarget, datasetVersion: nextVersion };
    invalidateNames("name dataset changed");
    return true;
  }

  function datasetIdentityFailed(reason) {
    datasetIdentityError = String(reason || "Accepted name dataset identity unavailable").slice(0, 240);
    if (latest && appliedRevision === latestRevision) void setNamesTarget(latest.config, latestRevision);
  }

  function getAppliedGeometryState() {
    return { revision: appliedRevision, configIdentity: appliedConfig ? JSON.stringify(appliedConfig) : null,
      pending: Boolean(preparing || renderWait || awaitingReapply || latestRevision !== appliedRevision),
      failed: failedRevision >= 0, suspended, stopped, namesState };
  }

  return { start, stop, requestStatus, invalidate, resume, reapply, datasetChanged, datasetIdentityFailed, getAppliedGeometryState };
}
