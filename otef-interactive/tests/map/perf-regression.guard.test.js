const MapProjectionConfig = require("../../frontend/js/shared/map-projection-config");

describe("perf regression guards", () => {
  test("keeps remote viewport animation disabled by default", () => {
    expect(MapProjectionConfig.GIS_PERF.ANIMATE_REMOTE_VIEWPORT).toBe(false);
  });

  test("keeps RAF coalescing enabled by default", () => {
    expect(MapProjectionConfig.GIS_PERF.ENABLE_RAF_VIEWPORT_APPLY).toBe(true);
    expect(MapProjectionConfig.GIS_PERF.MIN_APPLY_INTERVAL_MS).toBeGreaterThan(0);
  });

  test("projection flow guardrail: animation frame budget metadata exists", () => {
    expect(MapProjectionConfig.GIS_PERF.ANIMATION_MAX_FPS).toBeGreaterThan(0);
  });
});
