import { ANIMATION_CONFIG } from "../config/animation-config.js";

function computeLerpFactor(runtime, config) {
  const cfg = config || {};
  const base =
    typeof cfg.BASE_LERP === "number"
      ? cfg.BASE_LERP
      : ANIMATION_CONFIG.projectorSmoothing.baseLerp;
  const adaptive =
    typeof cfg.ENABLE_ADAPTIVE_SMOOTHING === "boolean"
      ? cfg.ENABLE_ADAPTIVE_SMOOTHING
      : ANIMATION_CONFIG.projectorSmoothing.enableAdaptiveSmoothing;

  if (!adaptive) return base;

  const fast =
    typeof cfg.FAST_LERP === "number"
      ? cfg.FAST_LERP
      : ANIMATION_CONFIG.projectorSmoothing.fastLerp;
  const threshold =
    typeof cfg.SPEED_THRESHOLD_PX === "number"
      ? cfg.SPEED_THRESHOLD_PX
      : ANIMATION_CONFIG.projectorSmoothing.speedThresholdPx;

  const speed = runtime && typeof runtime.speedPx === "number" ? runtime.speedPx : 0;
  return speed >= threshold ? fast : base;
}

if (typeof window !== "undefined") {
  window.HighlightSmoothingPolicy = { computeLerpFactor };
}

export { computeLerpFactor };
