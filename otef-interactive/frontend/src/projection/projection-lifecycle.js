function abortError() {
  const error = new Error("projection runtime was disposed");
  error.name = "AbortError";
  return error;
}

export function createSimpleAbortSignal() {
  let aborted = false;
  const listeners = new Set();
  const signal = {
    get aborted() { return aborted; },
    addEventListener(type, listener) {
      if (type === "abort" && typeof listener === "function") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "abort") listeners.delete(listener);
    },
  };
  return {
    signal,
    abort() {
      if (aborted) return;
      aborted = true;
      for (const listener of [...listeners]) listener.call(signal, { type: "abort" });
      listeners.clear();
    },
  };
}

export function createProjectionLifecycle() {
  const fallback = typeof AbortController === "function" ? null : createSimpleAbortSignal();
  const controller = fallback ? null : new AbortController();
  const signal = controller?.signal || fallback.signal;
  let disposed = false;
  return {
    signal,
    get disposed() { return disposed; },
    isAlive() { return !disposed && !signal.aborted; },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (controller) controller.abort();
      else fallback.abort();
    },
    abortError,
  };
}
