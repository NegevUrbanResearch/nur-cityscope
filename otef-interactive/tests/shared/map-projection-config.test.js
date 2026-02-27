const MapProjectionConfig = require('../../frontend/js/shared/map-projection-config');

describe('map-projection-config defaults', () => {
  test('exposes expected debug flags with safe defaults', () => {
    expect(MapProjectionConfig.ENABLE_MAP_LAYER_DEBUG).toBe(false);
    expect(MapProjectionConfig.ENABLE_MAP_VISIBILITY_DEBUG).toBe(false);
    expect(MapProjectionConfig.ENABLE_PROJECTION_DEBUG).toBe(false);
  });

  test('exposes projection tuning constants matching legacy behavior', () => {
    expect(MapProjectionConfig.PROJECTION_LERP_FACTOR).toBeCloseTo(0.15);
    expect(MapProjectionConfig.PROJECTION_RESIZE_DEBOUNCE_MS).toBe(200);
    expect(MapProjectionConfig.PROJECTION_FULL_EXTENT_TOLERANCE).toBe(10);
  });

  test("includes GIS performance flags with safe defaults", () => {
    expect(MapProjectionConfig.GIS_PERF).toBeDefined();
    expect(MapProjectionConfig.GIS_PERF.ENABLE_RAF_VIEWPORT_APPLY).toBe(true);
    expect(MapProjectionConfig.GIS_PERF.MIN_APPLY_INTERVAL_MS).toBe(33);
    expect(MapProjectionConfig.GIS_PERF.ANIMATE_REMOTE_VIEWPORT).toBe(false);
    expect(MapProjectionConfig.GIS_PERF.ENABLE_PREFER_CANVAS).toBe(true);
    expect(MapProjectionConfig.GIS_PERF.ENABLE_LAYER_VISIBILITY_BATCHING).toBe(true);
    expect(MapProjectionConfig.GIS_PERF.PAN_ANIMATION_ENABLED).toBe(false);
    expect(MapProjectionConfig.GIS_PERF.ZOOM_ANIMATION_ENABLED).toBe(true);
    expect(MapProjectionConfig.GIS_PERF.ZOOM_ANIMATION_DURATION_S).toBe(0.12);
    expect(MapProjectionConfig.GIS_PERF.HEAVY_LAYER_MIN_ZOOM).toEqual({
      "map_3_future.greens": 12,
      "map_3_future.land_use": 12,
    });
    expect(MapProjectionConfig.GIS_PERF.PROJECTOR_SMOOTHING).toBeDefined();
    expect(
      MapProjectionConfig.GIS_PERF.PROJECTOR_SMOOTHING.ENABLE_ADAPTIVE_SMOOTHING
    ).toBe(true);
  });
});

