// Visibility controller: central place to decide if a layer should be visible
// given zoom level, scaleRange, and OTEFDataContext layer state.
//
// This is intentionally framework-agnostic: it does not call map.addLayer/
// removeLayer directly. Callers are expected to use the predicate results.

import { computeZoomRange, isZoomInRange } from "./visibility-utils.js";

const scaleUtils =
  typeof window !== "undefined" && window.VisibilityUtils
    ? window.VisibilityUtils
    : { computeZoomRange, isZoomInRange };

// Use local alias names to avoid colliding with any global functions
const zoomUtils = scaleUtils || {};
const computeZoomRangeFn = zoomUtils.computeZoomRange;
const isZoomInRangeFn = zoomUtils.isZoomInRange;

/**
 * Decide if a layer *should* be visible at the given zoom, based on:
 * - scaleRange (from layerConfig.style.scaleRange)
 * - layer enabled state in OTEFDataContext (via LayerStateHelper)
 *
 * @param {Object} options
 * @param {string} options.fullLayerId
 * @param {{minScale?: number|null, maxScale?: number|null}|null|undefined} options.scaleRange
 * @param {number} options.zoom - current map zoom level
 * @param {Object} [options.layerStateHelper] - optional helper with getLayerState()
 * @returns {boolean}
 */
function shouldLayerBeVisible(options) {
  const {
    fullLayerId,
    scaleRange,
    zoom,
    layerStateHelper
  } = options || {};

  if (!fullLayerId || typeof zoom !== 'number' || Number.isNaN(zoom)) {
    return false;
  }

  // 1) Check zoom against scaleRange
  if (computeZoomRangeFn && isZoomInRangeFn) {
    const zoomRange = computeZoomRangeFn(scaleRange || null);
    if (!isZoomInRangeFn(zoom, zoomRange)) {
      return false;
    }
  }

  // 1.5) Optional hard guardrail for configured heavy layers at low zoom.
  const heavyMinZoom =
    typeof MapProjectionConfig !== "undefined" &&
    MapProjectionConfig.GIS_PERF &&
    MapProjectionConfig.GIS_PERF.HEAVY_LAYER_MIN_ZOOM
      ? MapProjectionConfig.GIS_PERF.HEAVY_LAYER_MIN_ZOOM[fullLayerId]
      : undefined;
  if (typeof heavyMinZoom === "number" && zoom < heavyMinZoom) {
    return false;
  }

  // 2) Check enabled state via layerStateHelper (if provided)
  if (layerStateHelper && typeof layerStateHelper.getLayerState === 'function') {
    const state = layerStateHelper.getLayerState(fullLayerId);
    if (!state || !state.enabled) {
      return false;
    }
  }

  // If we passed both checks, the layer is allowed to be visible
  return true;
}

export { shouldLayerBeVisible };

