import { createUuid } from "../shared/uuid.js";

function cleanupError(message) {
  return Object.assign(new Error(message), { code: "cleanup_failed" });
}

function committed(state, intent) {
  const receipt = state?.last_transition;
  return state?.active_experience === intent.target && !state.pending_transition &&
    receipt?.request_id === intent.requestId && receipt.status === "committed";
}

function waitForCleanup(dataContext, requestId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let dispose = () => {};
    let done = false;
    const finish = error => {
      if (done) return;
      done = true; clearTimeout(timer); dispose();
      error ? reject(error) : resolve();
    };
    const observe = state => {
      const pending = state?.pending_transition;
      if (!pending || pending.request_id !== requestId) return finish(new Error("The switch was superseded"));
      if (pending.cleanup_confirmed) finish();
      else if (pending.cleanup_receipt?.success === false) finish(cleanupError("The display could not close its NLI media"));
    };
    const timer = setTimeout(() => finish(cleanupError("The display has not confirmed NLI cleanup")), timeoutMs);
    dispose = dataContext.subscribe("experienceState", observe);
    if (done) dispose();
    else observe(dataContext.getExperienceState());
  });
}

/** Navigation changes experience only through the server's prepared transition. */
export function createExperienceSwitcher({ dataContext, staffRemote, requestId = createUuid, cleanupTimeoutMs = 12000, flushRegularSettings, storage = null } = {}) {
  let operation = null, uncertain = false;
  let unresolved = null;
  try { unresolved = JSON.parse(storage?.getItem("otef.experience-transition") || "null"); } catch { /* Storage may be unavailable. */ }
  const remember = intent => {
    unresolved = intent;
    try { intent ? storage?.setItem("otef.experience-transition", JSON.stringify(intent)) : storage?.removeItem("otef.experience-transition"); } catch { /* The in-document intent still allows reconciliation. */ }
  };
  async function reconcile() {
    await dataContext.refreshExperienceState();
    uncertain = false;
    const state = dataContext.getExperienceState();
    if (unresolved && state?.pending_transition?.request_id === unresolved.requestId) await dataContext.transitionExperience("abort", unresolved);
    if (!dataContext.getExperienceState()?.pending_transition) {
      remember(null);
      if (dataContext.getExperienceState()?.active_experience === "nli") await staffRemote?.resumeAfterSwitchFailure?.();
    }
  }
  async function activate(target) {
    if (uncertain || unresolved) await reconcile();
    const initial = dataContext.getExperienceState();
    if (!initial) throw new Error("Experience state is unavailable");
    if (initial.pending_transition) throw new Error("Another experience switch is in progress");
    if (initial.active_experience === target) return initial;
    const intent = { target, expectedRevision: initial.revision, requestId: requestId() };
    try {
      if (initial.active_experience === "nli") await staffRemote?.flushBookmark?.();
      else await flushRegularSettings?.();
      remember(intent);
      try { await dataContext.transitionExperience("prepare", intent); }
      catch (error) {
        await dataContext.refreshExperienceState();
        if (dataContext.getExperienceState()?.pending_transition?.request_id !== intent.requestId) throw error;
      }
      if (initial.active_experience === "nli") {
        const cleaned = await staffRemote?.suspendForExperienceSwitch?.();
        if (cleaned === false) throw cleanupError("NLI media cleanup failed");
        // A receipt may have arrived before the prepare response. Refresh before waiting.
        await dataContext.refreshExperienceState();
        await waitForCleanup(dataContext, intent.requestId, cleanupTimeoutMs);
      }
      try { await dataContext.transitionExperience("commit", intent); }
      catch (error) {
        await dataContext.refreshExperienceState();
        if (!committed(dataContext.getExperienceState(), intent)) throw error;
      }
      remember(null);
      return dataContext.getExperienceState();
    } catch (error) {
      try {
        await dataContext.refreshExperienceState();
        const current = dataContext.getExperienceState();
        if (committed(current, intent)) { remember(null); return current; }
        if (current?.pending_transition?.request_id === intent.requestId) await dataContext.transitionExperience("abort", intent);
        if (dataContext.getExperienceState()?.active_experience === "nli" && !dataContext.getExperienceState().pending_transition) {
          await staffRemote?.resumeAfterSwitchFailure?.();
        }
        if (!dataContext.getExperienceState()?.pending_transition) remember(null);
      } catch { uncertain = true; }
      throw error;
    }
  }
  return {
    async cancelPending() {
      await dataContext.refreshExperienceState();
      const state = dataContext.getExperienceState();
      const pending = state?.pending_transition;
      if (pending) await dataContext.transitionExperience("abort", {
        target: pending.target, requestId: pending.request_id, expectedRevision: pending.expected_revision ?? state.revision,
      });
      uncertain = false; remember(null);
      if (dataContext.getExperienceState()?.active_experience === "nli") await staffRemote?.resumeAfterSwitchFailure?.();
    },
    isUncertain: () => uncertain,
    canRecover: () => !!unresolved,
    activate(target) {
      if (!["regular", "nli"].includes(target)) return Promise.reject(new TypeError("Invalid experience"));
      if (operation) return operation;
      operation = activate(target).finally(() => { operation = null; });
      return operation;
    },
  };
}
