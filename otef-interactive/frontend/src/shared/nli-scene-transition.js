import { resolveMotionMode } from "./reduced-motion.js";
import { LAYER_FADE_MS } from "./layer-lifecycle-fade.js";

const PREPARATION_LIMIT_MS = 15000;
export const NLI_SCENE_READY_TIMEOUT_MS = 10000;

/** Bound preparation independently of whether its producer cooperates with abort. */
export async function prepareNliScene(produce, { controller, discard = () => {}, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const signal = controller.signal;
  let timer, cancel, accepted = false;
  const preparation = Promise.resolve().then(() => {
    if (signal.aborted) throw new Error("Scene cancelled");
    return produce(signal);
  });
  preparation.then(value => {
    if (!accepted && signal.aborted) { try { discard(value); } catch { /* Late cleanup cannot revive ownership. */ } }
  }, () => {});
  try {
    return await Promise.race([
      preparation.then(value => { accepted = !signal.aborted; return value; }),
      new Promise((_, reject) => {
        timer = setTimer(() => {
          const error = new Error("Scene preparation timed out"); error.timedOut = true;
          reject(error); controller.abort();
        }, PREPARATION_LIMIT_MS);
      }),
      new Promise((_, reject) => {
        cancel = () => reject(new Error("Scene cancelled"));
        signal.addEventListener("abort", cancel, { once: true });
        if (signal.aborted) cancel();
      }),
    ]);
  } finally {
    clearTimer(timer); signal.removeEventListener("abort", cancel);
  }
}

function enabledIds(snapshot) {
  if (Array.isArray(snapshot.enabledIds)) return [...new Set(snapshot.enabledIds)].sort();
  const groups = Array.isArray(snapshot.layerGroups) ? snapshot.layerGroups : Object.values(snapshot.layerGroups || {});
  return groups.flatMap(group => (group.layers || [])
    .filter(layer => layer.enabled)
    .map(layer => String(layer.fullId || group.id + "." + layer.id))).sort();
}

/**
 * Display-filtered snapshot shape: { enabledIds? | layerGroups?, narrativeState?,
 * escapeOverlay?, investigationClock?, personSelection?, basemapId?,
 * presentationCommand? }. Only a scene-bound presentation belongs in this input.
 * Clock transport, selection, revisions, and hold bookkeeping are semantic updates.
 */
export function nliSceneStructuralKey(snapshot) {
  const escape = snapshot.escapeOverlay || {};
  const presentation = snapshot.presentationCommand;
  return JSON.stringify([
    enabledIds(snapshot),
    snapshot.narrativeState?.id ?? null,
    ["individual", "overlap", "mor", "settled"].map(flag => escape[flag] === true),
    [...(snapshot.investigationClock?.hiddenDisplays || [])].sort(),
    snapshot.basemapId ?? null,
    presentation ? [presentation.segmentId ?? null, presentation.presentationSessionId ?? presentation.sessionId ?? null] : null,
  ]);
}

/**
 * Coordinate one display using its existing lifecycle runtime.
 * prepare(snapshot, { signal }) must stage without changing displayed content and
 * return { desiredIds, replaceIds, ...rendererResources }.
 * applyPrepared(prepared, { signal, joinBatch:true, snapshot }) mounts those inputs.
 * snapshot supplies the latest same-scene clock/selection at activation.
 * For ordinary controls it receives { snapshot } with semanticOnly:true and
 * joinBatch:false; that path must update unchanged active participants only.
 * restorePrevious(snapshot, { signal, joinBatch:true }) reinstalls retained logical
 * inputs at zero; discardPrepared removes only resources owned by its preparation.
 */
export function createNliSceneTransition({
  readSnapshot, prepare, applyPrepared, restorePrevious, discardPrepared = () => {}, resumeRetained = async () => {},
  isStructuralChange = (previous, next) => nliSceneStructuralKey(previous) !== nliSceneStructuralKey(next),
  runtime, now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout,
  onFailure = () => {},
  waitForEntry = async () => {},
}) {
  let displayed = readSnapshot();
  let desired = displayed;
  let displayedIds = runtime.getDesiredIds();
  let needsSceneReconcile = false;
  let generation = 0;
  let active = null;
  let queued = false;
  let disposed = false;
  let holdTimer = null;
  let requestWaiter = null;
  let holdDeadline = null;
  let holdExpiresAt = null;
  let holdOnlyRequest = false;

  function settleRequest(status, snapshot) {
    const waiter = requestWaiter;
    requestWaiter = null;
    waiter?.(snapshot ? { status, snapshot } : { status });
  }

  function discardCandidate(prepared, onError = () => {}) {
    try {
      discardPrepared(prepared);
      return true;
    } catch (error) {
      onError(error);
      return false;
    }
  }

  function clearHold() {
    if (holdTimer == null) return;
    clearTimer(holdTimer);
    holdTimer = null;
  }

  function stopActive() {
    if (!active) return;
    if (active.structuralChange) needsSceneReconcile = true;
    active.controller.abort();
    active = null;
  }

  function held(snapshot) {
    const deadline = snapshot.investigationClock?.presentationPendingUntilMs;
    if (deadline !== holdDeadline) {
      holdDeadline = deadline;
      holdExpiresAt = typeof deadline === "number" ? Math.min(deadline, now() + PREPARATION_LIMIT_MS) : null;
    }
    return holdExpiresAt != null && holdExpiresAt > now();
  }

  async function run(token) {
    const previous = displayed;
    const previousIds = [...displayedIds];
    const priorNeedsReconcile = needsSceneReconcile;
    const snapshot = desired;
    const structuralChange = needsSceneReconcile || isStructuralChange(previous, snapshot);
    const state = { controller: new AbortController(), structuralChange };
    active = state;
    const signal = state.controller.signal;
    const current = () => !disposed && generation === token && !signal.aborted;
    let prepared;
    let replaced = false;
    let restorationAttempted = false;
    let status = "ready";
    let stage = "preparation", failure = null;
    const summarize = value => ({ enabledIds: enabledIds(value), narrativeId: value.narrativeState?.id ?? null,
      sceneRevision: value.narrativeState?.revision ?? null, clockRevision: value.investigationClock?.revision ?? null,
      basemapId: value.basemapId ?? null });
    const rememberFailure = (reason, details = {}) => {
      const record = { phase: stage, reason: String(reason).slice(0, 500), ...details };
      if (failure) failure.recovery = record;
      else failure = record;
    };
    const rememberError = error => rememberFailure(error?.message || error || "Scene transition failed", {
      errorName: error?.name || "Error", stack: String(error?.stack || "").slice(0, 4000),
    });

    const phase = () => resolveMotionMode() === "reduced" ? 0 : LAYER_FADE_MS;
    async function batch(ids, requiredIds, mount) {
      if (!current()) return { status: "cancelled" };
      const handle = runtime.setDesiredIds(ids, { durationMs: phase(), requiredIds,
        readinessTimeoutMs: NLI_SCENE_READY_TIMEOUT_MS });
      const batchController = new AbortController();
      const cancel = () => batchController.abort();
      signal.addEventListener("abort", cancel, { once: true });
      const completion = runtime.waitForBatch(handle, { signal: batchController.signal });
      try {
        if (mount) await mount();
        if (!current()) return { status: "cancelled" };
        runtime.commitBatch();
        const result = await completion;
        if (result.status === "failed") rememberFailure(handle?.failure?.reason || "Scene readiness failed", handle?.failure);
        return result;
      } catch (error) {
        rememberError(error);
        batchController.abort();
        throw error;
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    }

    async function restore() {
      restorationAttempted = true;
      stage = "restoration";
      needsSceneReconcile = true;
      const restored = await batch(previousIds, previousIds, () => restorePrevious(previous, { signal, joinBatch: true }));
      needsSceneReconcile = restored.status !== "ready";
    }

    try {
      if (!structuralChange) {
        stage = "semantic";
        await applyPrepared({ snapshot }, { signal, joinBatch: false, semanticOnly: true, snapshot });
        if (!current()) return;
        displayed = desired;
      } else {
        prepared = await prepareNliScene(() => prepare(snapshot, { signal }), {
          controller: state.controller, discard: discardCandidate, setTimer, clearTimer,
        });
        if (!current()) return;
        const desiredIds = prepared.desiredIds || [];
        const replaceIds = new Set(prepared.replaceIds || []);
        if (replaceIds.size > 0 || prepared.display?.exitBeforeEntry) {
          stage = "exit";
          const keptIds = runtime.getDesiredIds().filter(id => desiredIds.includes(id) && !replaceIds.has(id));
          const exit = await batch(keptIds, keptIds);
          if (exit.status !== "ready") {
            status = exit.status;
            return;
          }
          if (!current()) return;
          replaced = true;
        }
        let activationSnapshot = desired;
        stage = 'paired-entry';
        await waitForEntry(prepared, { signal });
        if (!current()) return;
        stage = "entry";
        const entry = await batch(desiredIds, desiredIds, () => applyPrepared(prepared, {
          signal, joinBatch: true, snapshot: activationSnapshot,
        }));
        if (!current()) return;
        status = entry.status;
        if (status === "ready") {
          while (activationSnapshot !== desired && current()) {
            stage = "semantic";
            activationSnapshot = desired;
            await applyPrepared({ snapshot: activationSnapshot }, {
              signal, joinBatch: false, semanticOnly: true, snapshot: activationSnapshot,
            });
          }
          if (!current()) return;
          displayed = desired;
          displayedIds = [...desiredIds];
          needsSceneReconcile = false;
        } else if (replaced && status === "failed") {
          await restore();
          // Restoration readiness failure leaves affected resources at zero.
        } else {
          needsSceneReconcile = priorNeedsReconcile;
        }
      }
    } catch (error) {
      status = error?.timedOut || current() ? "failed" : "cancelled";
      if (status === "failed" && !failure) rememberError(error);
      if (current() && replaced && !restorationAttempted) {
        try {
          await restore();
        } catch { /* Keep the affected resources hidden if restoration also fails. */ }
      }
    } finally {
      if (prepared && (status !== "ready" || !current())) {
        const discarded = discardCandidate(prepared, error => { stage = "cleanup"; rememberError(error); });
        if (!discarded && current()) status = "failed";
      }
      if (status === "failed" && state.structuralChange && !replaced && generation === token && !disposed) {
        try { await resumeRetained(previous, { isCurrent: () => generation === token && !disposed }); }
        catch (error) { stage = "resume-retained"; rememberError(error); }
      }
      if (active === state) active = null;
      if (generation === token && !disposed) {
        if (status === "failed") {
          try { onFailure({ ...failure, generation: token, requested: summarize(snapshot), retained: summarize(previous) }); }
          catch { /* Reporting cannot prevent request completion. */ }
        }
        settleRequest(status);
      }
    }
  }

  function reconcile() {
    queued = false;
    if (disposed) return;
    clearHold();
    if (held(desired)) {
      const delay = holdExpiresAt - now();
      holdTimer = setTimer(() => { holdTimer = null; request({ holdOnly: holdOnlyRequest }); }, delay);
      return;
    }
    if (holdOnlyRequest) { settleRequest("released", desired); return; }
    void run(generation);
  }

  function request({ holdOnly = false } = {}) {
    if (disposed) return Promise.resolve({ status: "cancelled" });
    const joiningHold = holdOnly && holdOnlyRequest;
    holdOnlyRequest = holdOnly;
    const next = readSnapshot();
    // Same-scene clock/selection updates during preparation/exit belong to the
    // incoming snapshot and cannot overwrite the outgoing logical content.
    if (!holdOnly && active?.structuralChange && !isStructuralChange(desired, next) && !held(next)) {
      desired = next;
      return new Promise(resolve => {
        const previousWaiter = requestWaiter;
        requestWaiter = result => { previousWaiter?.(result); resolve(result); };
      });
    }
    desired = next;
    generation += 1;
    stopActive();
    if (!joiningHold) settleRequest("cancelled");
    const completion = new Promise(resolve => {
      const prior = joiningHold ? requestWaiter : null;
      requestWaiter = result => { prior?.(result); resolve(result); };
    });
    if (!queued) {
      queued = true;
      queueMicrotask(reconcile);
    }
    return completion;
  }

  function canRebaseDisplayed(snapshot) {
    if (disposed || active || queued || holdTimer != null) return false;
    const latest = readSnapshot();
    return !held(latest) && !isStructuralChange(latest, snapshot);
  }

  return {
    request: () => request(),
    // Uses the same bounded hold/expiry state, without preparing or drawing.
    // Repeated gate waits publish latest input and share its released outcome.
    waitForHold: () => request({ holdOnly: true }),
    canRebaseDisplayed,
    rebaseDisplayed(snapshot) {
      if (!canRebaseDisplayed(snapshot)) return false;
      displayed = snapshot; desired = snapshot; displayedIds = runtime.getDesiredIds();
      needsSceneReconcile = false; holdOnlyRequest = false;
      return true;
    },
    getDisplayedSnapshot: () => displayed,
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      clearHold();
      stopActive();
      settleRequest("cancelled");
    },
  };
}
