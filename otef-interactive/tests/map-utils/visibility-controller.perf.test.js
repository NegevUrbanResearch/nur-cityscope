const {
  shouldLayerBeVisible,
} = require("../../frontend/js/map-utils/visibility-controller");

describe("visibility-controller perf guardrails", () => {
  afterEach(() => {
    delete global.MapProjectionConfig;
  });

  test("blocks configured heavy layer below min zoom even if enabled", () => {
    global.MapProjectionConfig = {
      GIS_PERF: {
        HEAVY_LAYER_MIN_ZOOM: {
          "map_3_future.greens": 12,
        },
      },
    };

    const helper = {
      getLayerState: () => ({ enabled: true }),
    };

    const allowed = shouldLayerBeVisible({
      fullLayerId: "map_3_future.greens",
      scaleRange: null,
      zoom: 11,
      layerStateHelper: helper,
    });

    expect(allowed).toBe(false);
  });

  test("allows configured heavy layer at or above min zoom when enabled", () => {
    global.MapProjectionConfig = {
      GIS_PERF: {
        HEAVY_LAYER_MIN_ZOOM: {
          "map_3_future.greens": 12,
        },
      },
    };

    const helper = {
      getLayerState: () => ({ enabled: true }),
    };

    const allowed = shouldLayerBeVisible({
      fullLayerId: "map_3_future.greens",
      scaleRange: null,
      zoom: 12,
      layerStateHelper: helper,
    });

    expect(allowed).toBe(true);
  });

  test("does not affect unlisted layers", () => {
    global.MapProjectionConfig = {
      GIS_PERF: {
        HEAVY_LAYER_MIN_ZOOM: {
          "map_3_future.greens": 12,
        },
      },
    };
    const helper = {
      getLayerState: () => ({ enabled: true }),
    };
    const allowed = shouldLayerBeVisible({
      fullLayerId: "map_3_future.some_other_layer",
      scaleRange: null,
      zoom: 10,
      layerStateHelper: helper,
    });
    expect(allowed).toBe(true);
  });
});
