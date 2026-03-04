function createViewportApplyScheduler(options) {
  const applyViewport = options && options.applyViewport;
  const minIntervalMs =
    (options && typeof options.minIntervalMs === "number"
      ? options.minIntervalMs
      : 33);
  const now =
    (options && typeof options.now === "function"
      ? options.now
      : () => Date.now());
  const raf =
    (options && typeof options.raf === "function"
      ? options.raf
      : (cb) => requestAnimationFrame(cb));

  if (typeof applyViewport !== "function") {
    throw new Error("createViewportApplyScheduler requires applyViewport");
  }

  let pendingViewport = null;
  let rafScheduled = false;
  let lastAppliedAt = 0;

  function run() {
    rafScheduled = false;
    if (!pendingViewport) return;

    const currentNow = now();
    const elapsed = currentNow - lastAppliedAt;
    if (elapsed < minIntervalMs) {
      if (!rafScheduled) {
        rafScheduled = true;
        raf(run);
      }
      return;
    }

    const viewportToApply = pendingViewport;
    pendingViewport = null;
    applyViewport(viewportToApply);
    lastAppliedAt = currentNow;

    if (pendingViewport && !rafScheduled) {
      rafScheduled = true;
      raf(run);
    }
  }

  function schedule(viewport) {
    pendingViewport = viewport;
    if (!rafScheduled) {
      rafScheduled = true;
      raf(run);
    }
  }

  return { schedule };
}

if (typeof window !== "undefined") {
  window.ViewportSyncScheduler = {
    createViewportApplyScheduler,
  };
}

export { createViewportApplyScheduler };
