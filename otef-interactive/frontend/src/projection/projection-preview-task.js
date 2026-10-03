function abortError() {
  return Object.assign(new Error("Projection preview task cancelled"), { name: "AbortError" });
}

export function cancelProjectionPreviewNames({ abort, rollback, pending } = {}) {
  abort?.();
  rollback?.();
  return Promise.resolve(pending).catch(() => {});
}

export function settleProjectionPreviewTaskOnAbort(task, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal?.removeEventListener?.("abort", onAbort);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => finish(reject, abortError());
    signal?.addEventListener?.("abort", onAbort, { once: true });
    Promise.resolve(task).then((value) => finish(resolve, value), (error) => finish(reject, error));
    if (signal?.aborted) onAbort();
  });
}

export async function rollbackProjectionPreviewApply({ isCurrent, signal, rollback, redraw }) {
  if (typeof isCurrent !== "function" || !isCurrent() || signal?.aborted) return false;
  const controller = new AbortController();
  const abortRollback = () => controller.abort();
  signal?.addEventListener?.("abort", abortRollback, { once: true });
  try {
    if (!isCurrent() || signal?.aborted) return false;
    rollback?.({ isCurrent, signal: controller.signal });
    if (!isCurrent() || signal?.aborted || controller.signal.aborted) return false;
    await redraw?.(controller.signal);
    return isCurrent() && !signal?.aborted && !controller.signal.aborted;
  } finally {
    signal?.removeEventListener?.("abort", abortRollback);
  }
}

export async function commitProjectionPreviewNamesCandidate({ prepare, isCurrent, commit, draw, finalize, rollback }) {
  try {
    await prepare();
    if (!isCurrent()) throw abortError();
    commit();
    if (draw() !== true) throw new Error("Projection names draw failed");
    finalize();
    return { committed: true };
  } catch (error) {
    rollback();
    draw();
    throw error;
  }
}
