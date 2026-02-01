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
});

