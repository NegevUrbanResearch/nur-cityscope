export const PROJECTION_CONFIG = Object.freeze({
  labelSizeScale: 0.25,
  smoothing: Object.freeze({
    baseLerp: 0.15,
    fastLerp: 0.28,
    speedThresholdPx: 40,
  }),
  resizeDebounceMs: 200,
  fullExtentTolerance: 10,
  wmts: Object.freeze({
    zoomOverride: null,
    urlOverride: null,
  }),
});
