// Shared utilities for scale/zoom conversions and visibility checks
// Used by Leaflet GIS map and related modules.

const SCALE_AT_ZOOM_0 = 591657550; // Approximate scale at Web Mercator zoom 0

/**
 * Convert map scale denominator to Web Mercator zoom level.
 * Uses the same approximation currently in leaflet-control-with-basemap.js:
 *   scale ≈ SCALE_AT_ZOOM_0 / (2^zoom)
 * so:
 *   zoom = log2(SCALE_AT_ZOOM_0 / scale)
 *
 * @param {number|null|undefined} scale
 * @returns {number|null} zoom level, or null if scale is falsy
 */
function scaleToZoom(scale) {
  if (!scale) return null;
  return Math.log2(SCALE_AT_ZOOM_0 / scale);
}

/**
 * Compute zoom range from a scaleRange object:
 *   { minScale, maxScale }
 *
 * Returns an object:
 *   { minZoom: number|null, maxZoom: number|null }
 * or null if no scaleRange is provided.
 *
 * @param {{minScale?: number|null, maxScale?: number|null}|null|undefined} scaleRange
 * @returns {{minZoom: number|null, maxZoom: number|null}|null}
 */
function computeZoomRange(scaleRange) {
  if (!scaleRange) return null;
  const minZoom = scaleRange.minScale ? scaleToZoom(scaleRange.minScale) : null;
  const maxZoom = scaleRange.maxScale ? scaleToZoom(scaleRange.maxScale) : null;
  return { minZoom, maxZoom };
}

/**
 * Check if a given zoom is within an allowed zoom range.
 * If minZoom or maxZoom are null/undefined, that side is treated as unbounded.
 *
 * @param {number} zoom
 * @param {{minZoom?: number|null, maxZoom?: number|null}|null|undefined} zoomRange
 * @returns {boolean}
 */
function isZoomInRange(zoom, zoomRange) {
  if (!zoomRange) return true;
  const { minZoom, maxZoom } = zoomRange;
  if (minZoom != null && zoom < minZoom) return false;
  if (maxZoom != null && zoom > maxZoom) return false;
  return true;
}

// Expose globals for browser consumers
if (typeof window !== 'undefined') {
  window.VisibilityUtils = {
    SCALE_AT_ZOOM_0,
    scaleToZoom,
    computeZoomRange,
    isZoomInRange
  };
}

// Export for Node/CommonJS consumers (tests, tooling)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SCALE_AT_ZOOM_0,
    scaleToZoom,
    computeZoomRange,
    isZoomInRange
  };
}

