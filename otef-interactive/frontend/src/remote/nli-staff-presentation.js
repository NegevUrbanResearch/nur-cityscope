import { messageForLocale } from "./remote-locale.js";

const COMMAND_TIMEOUT_MS = 6000;
const ACTIONS = new Set(["open", "previous", "next", "close"]);

function uuid() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `presentation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createNliStaffPresentationController({ dataContext, onStateChange = () => {} } = {}) {
  let state = { phase: "closed", segmentId: null, sessionId: null, slide: null, range: null };
  let session = null;
  let priorGeneration = 0;
  let pending = null;
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

  function onResult(result) {
    if (!pending || !matches(result, pending.command)) return;
    const request = pending;
    pending = null;
    clearTimeout(request.timer);
    if (result.outcome === "unavailable") {
      session = null;
      publish({ phase: "failed", sessionId: null, segmentId: request.command.segmentId, slide: null, range: null });
      request.resolve(false);
      return;
    }
    const successful = (request.command.presentationAction === "open" && result.outcome === "opened") ||
      (["next", "previous"].includes(request.command.presentationAction) && result.outcome === "ready") ||
      (request.command.presentationAction === "close" && result.outcome === "closed");
    if (!successful) {
      publish({ phase: "failed", segmentId: request.command.segmentId, sessionId: null, slide: null, range: null });
      request.resolve(false);
      return;
    }
    if (request.command.presentationAction === "close") {
      session = null;
      publish({ phase: "closed", sessionId: null, segmentId: null, slide: null, range: null });
    } else {
      publish({
        phase: "open",
        segmentId: request.command.segmentId,
        sessionId: request.command.presentationSessionId,
        slide: Number.isInteger(result.slide) ? result.slide : state.slide,
        range: Array.isArray(result.range) ? result.range : state.range,
      });
    }
    request.resolve(true);
  }

  function setFailed(retainSession = true) {
    if (!retainSession) session = null;
    publish({ phase: "failed", sessionId: null, slide: null, range: null });
  }

  function dispatch(action, segmentId) {
    if (destroyed || !ACTIONS.has(action) || typeof dataContext?.narrativePresentationCommand !== "function") {
      setFailed(Boolean(session));
      return Promise.resolve(false);
    }
    if (pending) return pending.promise;
    if (action === "open") {
      const id = uuid();
      const generation = Math.max(Date.now(), priorGeneration + 1);
      priorGeneration = generation;
      session = { id, generation, segmentId, sequence: 0 };
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
    const request = { command, promise, resolve: resolveRequest, timer: null };
    pending = request;
    request.timer = setTimeout(() => {
      if (pending !== request) return;
      pending = null;
      setFailed(true);
      request.resolve(false);
    }, COMMAND_TIMEOUT_MS);
    Promise.resolve(dataContext.narrativePresentationCommand(command)).catch(() => {
      if (pending !== request) return;
      pending = null;
      clearTimeout(request.timer);
      setFailed(true);
      request.resolve(false);
    });
    return promise;
  }

  async function run(action, segmentId) {
    if (pending) return false;
    return dispatch(action, segmentId);
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

  return {
    run,
    closeForStepChange,
    getState: () => ({ ...state, range: state.range ? [...state.range] : null }),
    destroy() {
      destroyed = true;
      unsubscribe?.();
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(false);
        pending = null;
      }
      session = null;
    },
  };
}

export function presentationControlsHtml(step, state, locale) {
  const presentation = step?.presentation;
  if (!presentation) return "";
  const labels = {
    open: messageForLocale(locale, "presentationOpen"),
    previous: messageForLocale(locale, "presentationPrevious"),
    next: messageForLocale(locale, "presentationNext"),
    close: messageForLocale(locale, "presentationClose"),
    unavailable: messageForLocale(locale, "presentationUnavailable"),
  };
  if (state?.phase === "failed" && state.segmentId === presentation.segmentId) {
    return `<p class="presentation-unavailable" role="status">${labels.unavailable}</p>`;
  }
  const active = state?.phase === "open" && state.segmentId === presentation.segmentId;
  if (!active) {
    if (presentation.open !== "manual" || state?.phase !== "closed") return "";
    return `<div class="presentation-controls"><button type="button" class="btn" data-presentation-action="open">${labels.open}</button></div>`;
  }
  const range = state.range;
  const relative = Array.isArray(range) && Number.isInteger(state.slide)
    ? `${state.slide - range[0] + 1} / ${range[1] - range[0] + 1}`
    : "";
  const title = step.title?.[locale] || step.title?.he || "";
  return `<section class="presentation-controls" aria-label="${title}">
    <div class="presentation-controls-heading"><span>${title}</span><span class="presentation-counter">${relative}</span></div>
    <div class="presentation-slide-actions">
      <button type="button" class="btn btn--outline" data-presentation-action="previous">${labels.previous}</button>
      <button type="button" class="btn" data-presentation-action="next">${labels.next}</button>
    </div>
    <button type="button" class="btn btn--outline presentation-close" data-presentation-action="close">${labels.close}</button>
  </section>`;
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
