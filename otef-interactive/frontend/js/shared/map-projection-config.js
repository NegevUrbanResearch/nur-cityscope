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
};

// Browser global
if (typeof window !== 'undefined') {
  window.MapProjectionConfig = MapProjectionConfig;
}

// Export for Node/CommonJS consumers (tests, tooling)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MapProjectionConfig;
}

