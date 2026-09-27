/** Coalesces browser-output draw requests while presentation video is playing. */
export function createProjectionDrawScheduler({
  draw,
  shouldThrottle = () => false,
  shouldPause = () => false,
  maxFps = 30,
  now = () => globalThis.performance?.now?.() ?? Date.now(),
  setTimeoutImpl = (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeoutImpl = (handle) => globalThis.clearTimeout(handle),
} = {}) {
  if (typeof draw !== "function") throw new Error("projection draw scheduler requires a draw callback");
  const intervalMs = 1000 / (Number.isFinite(maxFps) && maxFps > 0 ? maxFps : 30);
  let lastDrawAt = null;
  let timer = null;
  let dirty = false;
  let drawing = false;
  let disposed = false;

  const clearPending = () => {
    if (timer !== null) clearTimeoutImpl(timer);
    timer = null;
  };
  const run = () => {
    if (disposed || drawing) return false;
    dirty = false;
    drawing = true;
    try {
      const result = draw();
      lastDrawAt = now();
      return result;
    } finally {
      drawing = false;
      if (dirty && !shouldPause()) schedule();
    }
  };
  const schedule = () => {
    if (disposed || timer !== null || !dirty) return;
    const deadline = lastDrawAt == null ? now() : lastDrawAt + intervalMs;
    const delay = Math.max(0, deadline - now());
    timer = setTimeoutImpl(() => {
      timer = null;
      if (disposed || !dirty) return;
      if (!shouldThrottle()) {
        run();
        return;
      }
      if (lastDrawAt != null && now() < lastDrawAt + intervalMs) {
        schedule();
        return;
      }
      run();
      if (dirty) schedule();
    }, delay);
  };
  const requestDraw = () => {
    if (disposed) return false;
    dirty = true;
    if (shouldPause()) return true;
    if (drawing) return true;
    if (!shouldThrottle()) {
      clearPending();
      return run();
    }
    if (lastDrawAt == null || now() >= lastDrawAt + intervalMs) {
      clearPending();
      return run();
    }
    schedule();
    return true;
  };
  const drawNow = () => {
    if (disposed) return false;
    dirty = false;
    clearPending();
    return run();
  };
  const flush = () => dirty ? drawNow() : false;
  return {
    requestDraw,
    drawNow,
    flush,
    cancel() { dirty = false; clearPending(); },
    dispose() { disposed = true; dirty = false; clearPending(); },
  };
}
