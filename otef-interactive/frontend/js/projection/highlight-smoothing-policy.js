function computeLerpFactor(runtime, config) {
  const cfg = config || {};
  const base =
    typeof cfg.BASE_LERP === "number" ? cfg.BASE_LERP : 0.15;
  if (!cfg.ENABLE_ADAPTIVE_SMOOTHING) return base;

  const fast =
    typeof cfg.FAST_LERP === "number" ? cfg.FAST_LERP : 0.28;
  const threshold =
    typeof cfg.SPEED_THRESHOLD_PX === "number" ? cfg.SPEED_THRESHOLD_PX : 40;
  const speed = runtime && typeof runtime.speedPx === "number" ? runtime.speedPx : 0;
  return speed >= threshold ? fast : base;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { computeLerpFactor };
}

if (typeof window !== "undefined") {
  window.HighlightSmoothingPolicy = { computeLerpFactor };
}
