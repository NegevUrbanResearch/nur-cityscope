// Shared configuration for map + projection behavior and logging.
// Keeps magic numbers and feature flags in one place so both
// Leaflet GIS map and projection display stay in sync.

// Default configuration values.
// NOTE: These defaults preserve existing behavior; change with care.
const PROJECTION_SLIDESHOW = {
  enabledByDefault: false,
  intervalMs: 10000,
  crossfadeMs: 1200,
  warmupLeadMs: 500,
  packOrder: [
    "future_development",
    "october_7th",
    "greens",
    "land_use",
    "muniplicity_transport",
  ],
  // Registry / context packs that must not appear in projection slideshow rotation and
  // must remain fully off for the whole presentation (defense in depth in slideshow runtime).
  // Includes: base projector context, Gaza pack, and merged Moreshet / workshop axis (no pink driving layers in presentation).
  excludedPresentationPackIds: ["projector_base", "gaza", "curated_moresht_axis"],
  ignoreLiveLayerUpdatesWhileActive: true,
  // Reserved for future WMTS staging; v1 uses vector path only.
  wmtsFadePolicy: "instant-after-vector-fade",
};

const MapProjectionConfig = {
  // When true, long two-point edges on stored `pink_line_route` are re-drawn in the
  // off-road style on a dedicated high z-index pane (Colab parity). Default on for GIS + projection.
  ENABLE_CURATED_OFFROAD_SPLIT: true,

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

  // MapLibre GL canvas pixel ratio for the projection map only (supersampling when > devicePixelRatio).
  // null -> browser default (usually devicePixelRatio; TouchDesigner Web Browser is often 1).
  // Try 1.25–2 for a sharper map at the cost of GPU memory (canvas backing ≈ layout × this).
  // URL `?mapPixelRatio=` / `?mpr=` overrides this (see projection-main).
  PROJECTION_MAP_PIXEL_RATIO: null,

  // Projection-layer animation policy.
  // Supports line-flow animation even when style.animation metadata is absent,
  // using per-layer overrides keyed by full layer id ("pack.layer").
  PROJECTION_LAYER_ANIMATIONS: {
    ENABLED_BY_DEFAULT: false,
    MAX_FPS: 30,
    DEFAULT_SPEED: 0,
    DEFAULT_DASH_ARRAY: null,
    LAYER_OVERRIDES: {
      // Oct 7 route line(s): use canonical underscore ids; alias lookup also matches hyphen ids.
      "october_7th.חדירה_לישוב_ציר": {
        ENABLE_FLOW: true,
        SPEED: 10,
        MODE: "trail",
        HEAD_RADIUS: 3.2,
        HIDE_HEAD_AT_END: true,
      },
      "october_7th.מאבק_וגבורה_ציר": {
        ENABLE_FLOW: true,
        SPEED: 10,
        MODE: "trail",
        HEAD_RADIUS: 3.2,
        HIDE_HEAD_AT_END: true,
      },
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
    ZOOM_ANIMATION_ENABLED: false,
    ZOOM_ANIMATION_DURATION_S: 0.12,

    // Prefer canvas for vector paths to reduce SVG/DOM pressure on dense layers.
    ENABLE_PREFER_CANVAS: true,

    // Reduce duplicate visibility toggles during frequent state updates.
    ENABLE_LAYER_VISIBILITY_BATCHING: true,
    ANIMATION_MAX_FPS: 30,

    // Optional per-layer low-zoom guardrails for especially heavy packs.
    // Supports both exact fullLayerId and group-prefix keys (e.g. "greens").
    HEAVY_LAYER_MIN_ZOOM: {
      "map_3_future.greens": 12,
      "map_3_future.land_use": 12,
      greens: 12,
      land_use: 12,
      "greens.מישורי_הצפה": 13,
      "map_3_future.מישורי_הצפה": 13,
      "greens.נחלים": 13,
      "map_3_future.נחלים": 13,
    },

    // Adaptive projector highlight smoothing.
    PROJECTOR_SMOOTHING: {
      ENABLE_ADAPTIVE_SMOOTHING: true,
      BASE_LERP: 0.15,
      FAST_LERP: 0.28,
      SPEED_THRESHOLD_PX: 40,
    },
  },

  PROJECTION_SLIDESHOW,
};

// Browser global
if (typeof window !== "undefined") {
  window.MapProjectionConfig = MapProjectionConfig;
}

export default MapProjectionConfig;
export { MapProjectionConfig };
