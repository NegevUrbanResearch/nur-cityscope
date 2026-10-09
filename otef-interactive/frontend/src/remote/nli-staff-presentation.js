import { messageForLocale } from "./remote-locale.js";

const COMMAND_TIMEOUT_MS = 6000;
const ACTIONS = new Set(["open", "previous", "next", "close"]);

function uuid() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `presentation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createNliStaffPresentationController({ dataContext, onStateChange = () => {} } = {}) {
  let state = { phase: "closed", segmentId: null, sessionId: null, slide: null, range: null, retryOpenSegmentId: null };
  let session = null;
  let priorGeneration = 0;
  let pending = null;
  let openObservation = null;
  let forcedClosePromise = null;
  let destroyed = false;
  const unsubscribe = dataContext?.subscribe?.("narrativePresentationResult", onResult);

  function publish(patch) {
    state = { ...state, ...patch };
    onStateChange(state);
  }

  function matches(result, command) {
    return result?.segmentId === command.segmentId &&
      result?.presentationSessionId === command.presentationSessionId &&
      result?.presentationGeneration === command.presentationGeneration &&
      result?.sequence === command.sequence && result?.requestId === command.requestId;
  }

  function rememberOpenedResponder(request, result) {
    if (session?.id !== request.command.presentationSessionId ||
        session.generation !== request.command.presentationGeneration) return;
    const responderId = result.sourceId ?? null;
    const newResponder = !session.responderIds.has(responderId);
    session.responderIds.add(responderId);
    if (pending?.command.presentationAction === "close" &&
        pending.command.presentationSessionId === session.id &&
        pending.closeRequiresKnownResponders && newResponder) {
      pending.closeResponders.add(responderId);
    }
  }

  function onResult(result) {
    if (!pending || !matches(result, pending.command)) {
      if (openObservation && matches(result, openObservation.command) && result.outcome === "opened") {
        rememberOpenedResponder(openObservation, result);
      }
      return;
    }
    const request = pending;
    if (request.scene && request.command.presentationAction === "open" && result.outcome === "ready") {
      request.resolvePrepared(true);
      return;
    }
    const successful = (request.command.presentationAction === "open" && result.outcome === "opened") ||
      (["next", "previous"].includes(request.command.presentationAction) && result.outcome === "ready") ||
      (request.command.presentationAction === "close" && result.outcome === "closed");
    const responderId = result.sourceId ?? null;
    const knownResponder = session?.responderIds?.has(responderId) === true;

    // A GIS without this session can report `closed` as a no-op. It cannot
    // confirm that a viewer which actually opened the session has closed.
    if (request.command.presentationAction === "close" && successful) {
      if (request.closeRequiresKnownResponders && !knownResponder) return;
      if (request.closeRequiresKnownResponders) {
        request.closeResponders.delete(responderId);
        if (request.closeResponders.size > 0) return;
      }
    }

    if (!successful) {
      if (request.command.presentationAction === "close") {
        if (request.closeRequiresKnownResponders && !knownResponder) return;
        request.lastFailure = result;
        return;
      }
      // Keep Open and navigation requests pending so a later correlated
      // success from another GIS can win. The existing deadline settles a
      // request that receives only unsuccessful replies.
      request.lastFailure = result;
      return;
    }

    pending = null;
    request.transport.abort();
    if (request.command.presentationAction === "open") {
      rememberOpenedResponder(request, result);
      openObservation = request;
    } else {
      clearTimeout(request.timer);
      session?.responderIds?.add(responderId);
    }
    if (request.command.presentationAction === "close") {
      session = null;
      publish({
        phase: "closed",
        sessionId: null,
        segmentId: null,
        slide: null,
        range: null,
        retryOpenSegmentId: request.command.segmentId,
      });
    } else {
      publish({
        phase: "open",
        segmentId: request.command.segmentId,
        sessionId: request.command.presentationSessionId,
        slide: Number.isInteger(result.slide) ? result.slide : state.slide,
        range: Array.isArray(result.range) ? result.range : state.range,
        retryOpenSegmentId: request.command.presentationAction === "open" ? null : state.retryOpenSegmentId,
      });
    }
    request.resolve(true);
  }

  function finishWithResult(request) {
    if (pending !== request) return;
    pending = null;
    clearTimeout(request.timer);
    const action = request.command.presentationAction;
    const retainSession = action !== "open";
    if (action === "open") state = { ...state, retryOpenSegmentId: request.command.segmentId };
    if (!retainSession) session = null;
    publish({
      phase: "failed",
      segmentId: request.command.segmentId,
      sessionId: retainSession ? session?.id ?? null : null,
      slide: null,
      range: null,
    });
    request.resolve(false);
  }

  function setFailed(retainSession = true) {
    if (!retainSession) session = null;
    publish({
      phase: "failed",
      sessionId: retainSession ? session?.id ?? null : null,
      slide: null,
      range: null,
    });
  }

  function dispatch(action, segmentId, options = {}) {
    const previousSession = session, previousState = { ...state };
    if (destroyed || !ACTIONS.has(action) || typeof dataContext?.narrativePresentationCommand !== "function") {
      setFailed(Boolean(session));
      return Promise.resolve(false);
    }
    if (pending) return pending.promise;
    if (action === "open") {
      if (openObservation) clearTimeout(openObservation.timer);
      openObservation = null;
      const id = uuid();
      const generation = Math.max(Date.now(), priorGeneration + 1);
      priorGeneration = generation;
      session = { id, generation, segmentId, sequence: 0, responderIds: new Set() };
    }
    if (!session || (segmentId && segmentId !== session.segmentId)) return Promise.resolve(false);
    const targetSegment = session.segmentId;
    const command = {
      presentationAction: action,
      segmentId: targetSegment,
      presentationSessionId: session.id,
      presentationGeneration: session.generation,
      sequence: ++session.sequence,
      requestId: uuid(),
    };
    const phase = action === "open" ? "opening" : action === "close" ? "closing" : "applying";
    publish({ phase, segmentId: targetSegment, sessionId: session.id });
    let resolveRequest;
    const promise = new Promise((resolve) => { resolveRequest = resolve; });
    const closeResponders = action === "close" ? new Set(session.responderIds) : null;
    const request = {
      command,
      promise,
      scene: options.scene === true,
      resolvePrepared: options.resolvePrepared || (() => {}),
      resolve(value) {
        request.resolvePrepared(value);
        options.signal?.removeEventListener("abort", request.cancel);
        if (!value && request.scene) {
          session = previousSession;
          publish(previousSession ? previousState : { phase: "failed", sessionId: null, retryOpenSegmentId: targetSegment });
          // Existing Close cancels only this candidate generation on the GIS.
          void Promise.resolve().then(() => dataContext.narrativePresentationCommand({
            ...command, presentationAction: "close", sequence: command.sequence + 1, requestId: uuid(),
          })).catch(() => {});
        }
        resolveRequest(value);
      },
      timer: null,
      transport: new AbortController(),
      closeResponders,
      closeRequiresKnownResponders: Boolean(closeResponders?.size),
    };
    request.cancel = () => {
      if (pending !== request) return;
      pending = null; clearTimeout(request.timer); request.transport.abort(); request.resolve(false);
    };
    pending = request;
    options.signal?.addEventListener("abort", request.cancel, { once: true });
    request.timer = setTimeout(() => {
      if (pending === request) {
        request.transport.abort();
        if (request.lastFailure) {
          finishWithResult(request);
        } else {
          pending = null;
          if (request.command.presentationAction === "open") {
            state = { ...state, retryOpenSegmentId: request.command.segmentId };
          }
          setFailed(true);
          request.resolve(false);
        }
      }
      if (openObservation === request) openObservation = null;
    }, COMMAND_TIMEOUT_MS);
    function sendCommand() {
      try { return dataContext.narrativePresentationCommand(command, { signal: request.transport.signal }); }
      catch (error) { return Promise.reject(error); }
    }
    Promise.resolve(sendCommand()).catch(() => {
      if (pending !== request) return;
      pending = null;
      clearTimeout(request.timer);
      if (request.command.presentationAction === "open") {
        state = { ...state, retryOpenSegmentId: request.command.segmentId };
      }
      setFailed(true);
      request.resolve(false);
      if (openObservation === request) openObservation = null;
    });
    if (options.signal?.aborted) request.cancel();
    return promise;
  }

  function prepareScene(segmentId, { signal } = {}) {
    if (pending) pending.cancel();
    let resolvePrepared;
    const prepared = new Promise(resolve => { resolvePrepared = resolve; });
    const opened = dispatch("open", segmentId, { scene: true, signal, resolvePrepared });
    const request = pending;
    if (!request) resolvePrepared(false);
    return { prepared, opened, cancel: () => request?.cancel() };
  }

  function closeScene({ signal } = {}) {
    if (pending?.scene) pending.cancel();
    if (!session) return { prepared: Promise.resolve(true), opened: Promise.resolve(true), cancel() {} };
    const opened = dispatch("close", session.segmentId, { signal });
    const request = pending;
    return { prepared: Promise.resolve(true), opened, cancel: () => request?.cancel() };
  }

  async function run(action, segmentId) {
    if (pending) return false;
    return dispatch(action, segmentId);
  }

  function replace(segmentId) {
    if (pending) {
      const request = pending;
      pending = null;
      clearTimeout(request.timer);
      request.transport.abort();
      request.resolve(false);
    }
    return dispatch("open", segmentId);
  }

  function clearSessionlessFailure() {
    if (!session && state.phase === "failed") {
      publish({ phase: "closed", segmentId: null, sessionId: null, slide: null, range: null });
    }
  }

  function closeForStepChange() {
    if (forcedClosePromise) return forcedClosePromise;
    forcedClosePromise = (async () => {
      const active = pending;
      if (active) {
        const ok = await active.promise;
        if (active.command.presentationAction === "close") {
          clearSessionlessFailure();
          return ok;
        }
      }
      if (!session) {
        clearSessionlessFailure();
        return true;
      }
      if (pending) await pending.promise;
      if (!session) {
        clearSessionlessFailure();
        return true;
      }
      const closed = await dispatch("close", session.segmentId);
      clearSessionlessFailure();
      return closed;
    })().finally(() => { forcedClosePromise = null; });
    return forcedClosePromise;
  }

  function releaseFailedSession() {
    if (pending || state.phase !== "failed" || !session) return false;
    if (openObservation) {
      clearTimeout(openObservation.timer);
      openObservation.transport.abort();
    }
    openObservation = null;
    session = null;
    publish({ phase: "released", segmentId: null, sessionId: null, slide: null, range: null });
    return true;
  }

  function recoverOpen(segmentId) {
    if (state.segmentId !== segmentId || !releaseFailedSession()) return Promise.resolve(false);
    return dispatch("open", segmentId);
  }

  return {
    run,
    prepareScene,
    closeScene,
    replace,
    recoverOpen,
    releaseFailedSession,
    closeForStepChange,
    getState: () => ({ ...state, range: state.range ? [...state.range] : null }),
    destroy() {
      destroyed = true;
      unsubscribe?.();
      if (pending) {
        clearTimeout(pending.timer);
        pending.transport.abort();
        pending.resolve(false);
        pending = null;
      }
      if (openObservation) {
        clearTimeout(openObservation.timer);
        openObservation.transport.abort();
      }
      openObservation = null;
      session = null;
    },
  };
}

function slideControls(step, state, locale, labels, disabled, hideNext = false) {
  const range = state?.range;
  const relative = Array.isArray(range) && Number.isInteger(state.slide)
    ? `${state.slide - range[0] + 1} / ${range[1] - range[0] + 1}`
    : "";
  const title = step.title?.[locale] || step.title?.he || "";
  const disabledAttr = disabled ? " disabled" : "";
  const nextButton = hideNext ? "" : `<button type="button" class="btn" data-presentation-action="next"${disabledAttr}>${labels.next}</button>`;
  return `<section class="presentation-controls" aria-label="${title}">
    <div class="presentation-controls-heading"><span>${title}</span><span class="presentation-counter">${relative}</span></div>
    <div class="presentation-slide-actions">
      <button type="button" class="btn btn--outline" data-presentation-action="previous"${disabledAttr}>${labels.previous}</button>
      ${nextButton}
    </div>
    <button type="button" class="btn btn--outline presentation-close" data-presentation-action="close"${disabledAttr}>${labels.close}</button>
  </section>`;
}

export function nliPresentationUsesRemoteControls(presentation) {
  return Boolean(presentation) && presentation.controls !== false;
}

export function presentationControlsHtml(step, state, locale, mutationBusy = false) {
  const presentation = step?.presentation;
  if (!nliPresentationUsesRemoteControls(presentation)) return "";
  const labels = {
    open: messageForLocale(locale, "presentationOpen"),
    previous: messageForLocale(locale, "presentationPrevious"),
    next: messageForLocale(locale, "presentationNext"),
    close: messageForLocale(locale, "presentationClose"),
    unavailable: messageForLocale(locale, "presentationUnavailable"),
    recoverOpen: messageForLocale(locale, "presentationRecoverOpen"),
    recoverHome: messageForLocale(locale, "presentationRecoverHome"),
  };
  const sameSegment = state?.segmentId === presentation.segmentId;
  if (["opening", "applying", "closing"].includes(state?.phase) && sameSegment) {
    const range = state.range;
    const knownRange = Array.isArray(range) && range.length === 2 &&
      Number.isInteger(range[0]) && Number.isInteger(range[1]) && range[1] >= range[0];
    const pendingAtKnownTerminalSlide = state.phase !== "opening" && Boolean(state.sessionId) &&
      knownRange && Number.isInteger(state.slide) && state.slide === range[1];
    return slideControls(step, state, locale, labels, true, pendingAtKnownTerminalSlide);
  }
  if (state?.phase === "failed" && sameSegment) {
    const retryAction = state.sessionId ? "close" : "open";
    const retryLabel = retryAction === "close" ? labels.close : labels.open;
    const recovery = state.sessionId ? `<button type="button" class="btn" data-presentation-action="recover-open"${mutationBusy ? " disabled" : ""}>${labels.recoverOpen}</button><button type="button" class="btn btn--outline" data-presentation-action="recover-home"${mutationBusy ? " disabled" : ""}>${labels.recoverHome}</button>` : "";
    return `<p class="presentation-unavailable" role="status">${labels.unavailable}</p><div class="presentation-controls"><button type="button" class="btn" data-presentation-action="${retryAction}">${retryLabel}</button>${recovery}</div>`;
  }
  const active = state?.phase === "open" && sameSegment;
  if (!active) {
    if ((presentation.open !== "manual" && state?.retryOpenSegmentId !== presentation.segmentId) || state?.phase !== "closed") return "";
    return `<div class="presentation-controls"><button type="button" class="btn" data-presentation-action="open"${mutationBusy ? " disabled" : ""}>${labels.open}</button></div>`;
  }
  const range = state.range;
  const knownRange = Array.isArray(range) && range.length === 2 &&
    Number.isInteger(range[0]) && Number.isInteger(range[1]) && range[1] >= range[0];
  const atKnownTerminalSlide = active && knownRange && Number.isInteger(state.slide) && state.slide === range[1];
  return slideControls(step, state, locale, labels, mutationBusy, atKnownTerminalSlide);
}

export function createNliStaffPresentationButtonHandler({
  getCurrentStep,
  getNavigationGeneration,
  run,
  nextFromExplicitClose = () => {},
  resumeFromExplicitClose = () => {},
} = {}) {
  return async (action) => {
    const step = getCurrentStep?.();
    const presentation = step?.presentation;
    if (!presentation) return false;
    const intent = getNavigationGeneration?.();
    const ok = await run(action, presentation.segmentId);
    if (!ok || action !== "close" || intent !== getNavigationGeneration?.() || step !== getCurrentStep?.()) return ok;
    if (presentation.onClose === "next") nextFromExplicitClose();
    else if (presentation.onClose === "resume") resumeFromExplicitClose();
    return true;
  };
}

export function shouldAutoOpenNliPresentation({ item, index, currentScript, currentStep, cueStatus } = {}) {
  const destination = item?.steps?.[index];
  return Boolean(destination?.presentation?.open === "auto" && currentScript === item &&
    currentStep === destination && cueStatus === "ready");
}
