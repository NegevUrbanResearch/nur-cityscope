export const ANIMATION_CONFIG = Object.freeze({
  enabledByDefault: true,
  maxFps: 30,
  flow: Object.freeze({
    maxFps: 30,
    defaultEnabled: true,
  }),
  projectionLayers: Object.freeze({
    enabledByDefault: false,
    maxFps: 30,
    defaultSpeed: 0,
    defaultDashArray: null,
    // Layer-level overrides keyed by full layer id (e.g. "pack.layer")
    // Preserve current behavior by defaulting to no overrides.
    layerOverrides: Object.freeze({}),
  }),
  projectorSmoothing: Object.freeze({
    enableAdaptiveSmoothing: true,
    baseLerp: 0.15,
    fastLerp: 0.28,
    speedThresholdPx: 40,
  }),
});
