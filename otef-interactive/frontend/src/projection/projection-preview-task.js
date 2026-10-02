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
