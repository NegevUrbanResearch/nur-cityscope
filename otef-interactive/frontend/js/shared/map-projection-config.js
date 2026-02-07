// Shared configuration for map + projection behavior and logging.
// Keeps magic numbers and feature flags in one place so both
// Leaflet GIS map and projection display stay in sync.

// Default configuration values.
// NOTE: These defaults preserve existing behavior; change with care.
const MapProjectionConfig = {
  // Debug flags (can be toggled from devtools if needed)
  ENABLE_MAP_LAYER_DEBUG: false,
  ENABLE_MAP_VISIBILITY_DEBUG: false,
  ENABLE_PROJECTION_DEBUG: false,

  // Projection highlight smoothing (LERP factor)
  // Lower = smoother/slower, Higher = snappier
  PROJECTION_LERP_FACTOR: 0.15,

  // Projection resize debounce in milliseconds
  PROJECTION_RESIZE_DEBOUNCE_MS: 200,

  // Tolerance in ITM units when checking if a bbox matches full model extent
  PROJECTION_FULL_EXTENT_TOLERANCE: 10,

  // WMTS layer for projector (LOD / scale tuning for physical model).
  // Override zoom here to try different resolutions in the lab; set to null to use manifest default (12).
  // Approx ground resolution at 32N: 11 ~65m/px, 12 ~32m/px, 13 ~16m/px, 14 ~8m/px, 15 ~4m/px.
  WMTS_PROJECTOR: {
    zoomOverride: null, // e.g. 14 or 15 for sharper imagery on 4K at 1:40k scale
    urlOverride: null,
  },
};

// Browser global
if (typeof window !== "undefined") {
  window.MapProjectionConfig = MapProjectionConfig;
}

// Export for Node/CommonJS consumers (tests, tooling)
if (typeof module !== "undefined" && module.exports) {
  module.exports = MapProjectionConfig;
}
