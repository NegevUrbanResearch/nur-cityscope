function getRemoteViewportSetViewOptions(perfConfig, deltas) {
  const perf = perfConfig || {};
  const fallbackDuration =
    typeof perf.REMOTE_ANIMATION_DURATION_S === "number"
      ? perf.REMOTE_ANIMATION_DURATION_S
      : 0.12;
  const d = deltas || {};
  const isZoomChange = Math.abs(d.zoomDiff || 0) > 0.01;

  if (isZoomChange && perf.ZOOM_ANIMATION_ENABLED !== false) {
    return {
      animate: true,
      duration:
        typeof perf.ZOOM_ANIMATION_DURATION_S === "number"
          ? perf.ZOOM_ANIMATION_DURATION_S
          : 0.12,
    };
  }

  return {
    animate: !!perf.PAN_ANIMATION_ENABLED || !!perf.ANIMATE_REMOTE_VIEWPORT,
    duration: fallbackDuration,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { getRemoteViewportSetViewOptions };
}

if (typeof window !== "undefined") {
  window.ViewportApplyPolicy = { getRemoteViewportSetViewOptions };
}
