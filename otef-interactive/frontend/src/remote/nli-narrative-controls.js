import { escapeHtml } from "../shared/html-utils.js";
import { normalizeNarrativeState } from "../shared/nli-narratives.js";
import { t } from "./remote-locale.js";

const DEFAULT_PRESENTATION_TIMEOUT_MS = 6000;

function escape(value) {
  return escapeHtml(String(value ?? ""));
}

function disabledAttribute(disabled) {
  return disabled ? " disabled" : "";
}

export function nliNarrativeControlsHtml(selectedPack, narrativeState, disabledReason) {
  if (!selectedPack || selectedPack.id !== "nli") return "";
  const acknowledged = normalizeNarrativeState(narrativeState);
  const active = acknowledged.id === "segev";
  const phase = narrativeState?.presentationPhase || "closed";
  const transitionPending = narrativeState?.transitionPending === true;
  const presentationPending = phase === "opening" || phase === "closing";
  const narrativeDisabled = transitionPending || !!disabledReason;
  const presentationAction = phase === "open" || phase === "closing" ? "close" : "open";
  const presentationLabelKey = presentationAction === "close"
    ? "nliNarrativePresentationClose"
    : "nliNarrativePresentationOpen";
  const presentationAriaKey = presentationAction === "close"
    ? "nliNarrativePresentationCloseAria"
    : "nliNarrativePresentationOpenAria";
  const pendingLabelKey = phase === "closing"
    ? "nliNarrativePresentationClosing"
    : "nliNarrativePresentationOpening";
  const feedback = disabledReason || narrativeState?.feedback || "";

  return `<section class="nli-narrative-sheet" aria-labelledby="nliNarrativesTitle">
    <span class="nli-narrative-title" id="nliNarrativesTitle">${escape(t("nliNarrativesTitle"))}</span>
    <div class="nli-narrative-actions">
      <button type="button" class="nli-narrative-button${active ? " is-active" : ""}" data-nli-narrative="segev" aria-pressed="${active ? "true" : "false"}" aria-label="${escape(t("nliNarrativeSegevAria"))}"${disabledAttribute(narrativeDisabled)}>${escape(t("nliNarrativeSegev"))}</button>
      ${active ? `<button type="button" class="nli-narrative-button nli-narrative-presentation" data-nli-narrative-presentation="${presentationAction}" data-nli-narrative-id="segev" aria-label="${escape(t(presentationAriaKey))}"${disabledAttribute(transitionPending || presentationPending || !!disabledReason)}>${escape(t(presentationPending ? pendingLabelKey : presentationLabelKey))}</button>` : ""}
    </div>
    ${feedback ? `<p class="nli-narrative-feedback" role="status">${escape(feedback)}</p>` : ""}
  </section>`;
}

export function consumeNliNarrativeButtonClick(event, host) {
  const target = event?.target;
  if (!target || typeof target.closest !== "function") return false;
  const presentation = target.closest("[data-nli-narrative-presentation]");
  if (presentation) {
    event.preventDefault?.();
    event.stopPropagation?.();
    const action = presentation.getAttribute("data-nli-narrative-presentation");
    const id = presentation.getAttribute("data-nli-narrative-id");
    if ((action === "open" || action === "close") && id) {
      void host?.runNarrativePresentation?.(action, id);
    }
    return true;
  }
  const narrative = target.closest("[data-nli-narrative]");
  if (!narrative) return false;
  event.preventDefault?.();
  event.stopPropagation?.();
  const id = narrative.getAttribute("data-nli-narrative");
  if (id) void host?.setNarrative?.(id);
  return true;
}

export function createNliNarrativePresentationController(options = {}) {
  const dataContext = options.dataContext;
  const onStateChange = typeof options.onStateChange === "function"
    ? options.onStateChange
    : () => {};
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(0, Number(options.timeoutMs))
    : DEFAULT_PRESENTATION_TIMEOUT_MS;
  const nextRequestId = typeof options.requestId === "function"
    ? options.requestId
    : () => globalThis.crypto?.randomUUID?.() || `narrative-${Date.now()}`;
  let state = { phase: "closed", id: null, requestId: null, error: null };
  let pending = null;
  let acknowledgedOpen = null;
  let destroyed = false;

  const publish = (changes) => {
    state = { ...state, ...changes };
    if (!destroyed) onStateChange({ ...state });
  };

  const finish = (result, phase, error = null) => {
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    const resolve = pending.resolve;
    pending = null;
    if (result.outcome === "opened" && phase === "open") {
      acknowledgedOpen = { id: result.narrativeId, requestId: result.requestId };
    } else if (phase === "closed") {
      acknowledgedOpen = null;
    }
    publish({
      phase,
      id: phase === "closed" ? null : result.narrativeId,
      requestId: null,
      error,
    });
    resolve(result);
  };

  const failPending = () => {
    if (!pending) return;
    const { previousPhase, id, requestId } = pending;
    finish(
      { outcome: "unavailable", narrativeId: id, requestId },
      previousPhase,
      "unavailable",
    );
  };

  const handleResult = (result = {}) => {
    if (
      !pending &&
      result.outcome === "closed" &&
      state.phase === "open" &&
      acknowledgedOpen?.id === result.narrativeId &&
      acknowledgedOpen?.requestId === result.requestId
    ) {
      acknowledgedOpen = null;
      publish({ phase: "closed", id: null, requestId: null, error: null });
      return true;
    }
    if (
      !pending ||
      result.requestId !== pending.requestId ||
      result.narrativeId !== pending.id
    ) return false;
    if (result.outcome === "opened") {
      finish(result, "open");
      return true;
    }
    if (result.outcome === "closed") {
      finish(result, "closed");
      return true;
    }
    if (result.outcome === "unavailable") {
      failPending();
      return true;
    }
    return false;
  };

  const unsubscribe = dataContext?.subscribe?.("narrativePresentationResult", handleResult);

  const run = (action, id) => {
    if (destroyed || (action !== "open" && action !== "close") || !id || pending) {
      return Promise.resolve({ outcome: "unavailable", narrativeId: id || null, requestId: null });
    }
    const previousPhase = state.phase === "open" ? "open" : "closed";
    const requestId = nextRequestId();
    const resultPromise = new Promise((resolve) => {
      const timeoutId = setTimeout(failPending, timeoutMs);
      pending = { action, id, requestId, previousPhase, timeoutId, resolve };
    });
    publish({
      phase: action === "open" ? "opening" : "closing",
      id,
      requestId,
      error: null,
    });
    Promise.resolve()
      .then(() => dataContext?.narrativePresentationCommand?.(action, id, requestId))
      .then((response) => {
        if (pending?.requestId !== requestId) return;
        if (response?.acknowledged !== true && response?.status !== "ok") failPending();
      })
      .catch(() => {
        if (pending?.requestId === requestId) failPending();
      });
    return resultPromise;
  };

  return {
    getState: () => ({ ...state }),
    run,
    handleResult,
    reset(activeId = null) {
      if (pending) failPending();
      if (!activeId || (state.id !== null && state.id !== activeId)) {
        publish({ phase: "closed", id: null, requestId: null, error: null });
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (pending) failPending();
      unsubscribe?.();
    },
  };
}
