import { SCRIPTS } from "./nli-staff-script.js";

const HOME = Object.freeze({ scriptId: null, step: 0, returnTo: null });
const scriptFor = id => SCRIPTS.find(script => script.id === id);

export function normalizeNliBookmark(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.scriptId === null) return { ...HOME };
  const script = scriptFor(raw.scriptId);
  const step = Number.isInteger(raw.step) ? script?.steps[raw.step] : null;
  if (!step || Array.isArray(step.branch)) return null;
  let returnTo = null;
  if (raw.returnTo != null) {
    if (!Number.isInteger(raw.returnTo.step) || !scriptFor(raw.returnTo.id)?.steps[raw.returnTo.step]) return null;
    returnTo = { id: raw.returnTo.id, step: raw.returnTo.step };
  }
  return { scriptId: script.id, step: raw.step, returnTo };
}

/** Serializes confirmed authored intent without replaying any scene commands. */
export function createNliBookmarkPersistence({ dataContext }) {
  let confirmed = { ...HOME };
  let epoch = 0;
  let tail = Promise.resolve();
  return {
    hydrate(bookmark) {
      epoch += 1;
      confirmed = normalizeNliBookmark(bookmark) || { ...HOME };
      return normalizeNliBookmark(confirmed);
    },
    get: () => normalizeNliBookmark(confirmed),
    save(bookmark) {
      const next = normalizeNliBookmark(bookmark);
      if (!next) return Promise.reject(new TypeError("Invalid authored NLI bookmark"));
      const scope = dataContext.captureExperienceScope?.();
      const generation = epoch;
      const current = () => generation === epoch && (!scope || dataContext.isExperienceScopeCurrent?.(scope) !== false);
      const save = async () => {
        if (!current()) throw new Error("NLI bookmark activation was superseded");
        const result = await dataContext.saveNliBookmark?.(next);
        if (result?.ok === false) throw new Error("NLI bookmark was not acknowledged");
        if (!current()) throw new Error("NLI bookmark activation was superseded");
        confirmed = next;
        return normalizeNliBookmark(confirmed);
      };
      tail = tail.then(save, save);
      // A later flush still observes rejection; avoid an unhandled interval before it.
      void tail.catch(() => {});
      return tail;
    },
    flush: () => tail,
    dispose() { epoch += 1; },
  };
}

/** Existing archive controller validates correlation before updating its phase. */
export function closeNliArchiveForExperienceSwitch(archive, dataContext, { timeoutMs = 6500 } = {}) {
  if (archive.getArchivePhase() === "closed") {
    return Promise.resolve(archive.getRefreshRestriction?.() !== "owned_session");
  }
  return new Promise(resolve => {
    let finished = false;
    let closeSent = archive.getArchivePhase() === "closing";
    let unsubscribe = () => {};
    const finish = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(result);
    };
    const sendClose = () => {
      if (finished || closeSent || archive.getArchivePhase() !== "open") return;
      closeSent = true;
      Promise.resolve(archive.closeArchive()).then(accepted => {
        if (accepted === false) finish(false);
      }, () => finish(false));
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    unsubscribe = dataContext.subscribe("archiveWindowResult", result => {
      const phase = archive.getArchivePhase();
      if (closeSent && result?.outcome === "closed" && phase === "closed") finish(true);
      else if (result?.outcome === "unavailable") finish(false);
      else sendClose();
    });
    sendClose();
  });
}
