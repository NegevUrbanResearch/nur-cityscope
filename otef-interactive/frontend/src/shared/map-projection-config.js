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

  // Global scale factor for label font sizes on the projector (canvas renderer only).
  // 1.0  -> use sizes exported from styles.json as-is
  // <1.0 -> shrink labels relative to exported sizes (e.g. 0.35 for ~1/3 size)
  // >1.0 -> enlarge labels (generally not recommended)
  LABEL_SIZE_SCALE: 0.25,

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

  // Projection-layer animation policy.
  // Supports line-flow animation even when style.animation metadata is absent,
  // using per-layer overrides keyed by full layer id ("pack.layer").
  PROJECTION_LAYER_ANIMATIONS: {
    ENABLED_BY_DEFAULT: false,
    MAX_FPS: 30,
    DEFAULT_SPEED: 0,
    DEFAULT_DASH_ARRAY: null,
    LAYER_OVERRIDES: {
      // Example:
      // "map_2_oct_7.some_line_layer": {
      //   ENABLE_FLOW: true,
      //   ENABLED_BY_DEFAULT: true,
      //   SPEED: 10,
      //   DASH_ARRAY: [8, 6],
      // },
    },
  },

  // GIS map performance controls.
  // Defaults are conservative and should improve responsiveness without feature changes.
  GIS_PERF: {
    // Coalesce remote viewport updates through RAF and avoid over-applying.
    ENABLE_RAF_VIEWPORT_APPLY: true,
    MIN_APPLY_INTERVAL_MS: 33, // ~30 FPS max apply cadence

    // Keep follower updates snappy; animation can create backlog under heavy load.
    ANIMATE_REMOTE_VIEWPORT: false,
    REMOTE_ANIMATION_DURATION_S: 0.12,
    PAN_ANIMATION_ENABLED: false,
    ZOOM_ANIMATION_ENABLED: true,
    ZOOM_ANIMATION_DURATION_S: 0.12,

    // Prefer canvas for vector paths to reduce SVG/DOM pressure on dense layers.
    ENABLE_PREFER_CANVAS: true,

    // Reduce duplicate visibility toggles during frequent state updates.
    ENABLE_LAYER_VISIBILITY_BATCHING: true,
    ANIMATION_MAX_FPS: 30,

    // Optional per-layer low-zoom guardrails for especially heavy packs.
    // Example: { "map_3_future.greens": 12 }
    HEAVY_LAYER_MIN_ZOOM: {
      "map_3_future.greens": 12,
      "map_3_future.land_use": 12,
    },

    // Adaptive projector highlight smoothing.
    PROJECTOR_SMOOTHING: {
      ENABLE_ADAPTIVE_SMOOTHING: true,
      BASE_LERP: 0.15,
      FAST_LERP: 0.28,
      SPEED_THRESHOLD_PX: 40,
    },
  },
};

// Browser global
if (typeof window !== "undefined") {
  window.MapProjectionConfig = MapProjectionConfig;
}

export default MapProjectionConfig;
export { MapProjectionConfig };
