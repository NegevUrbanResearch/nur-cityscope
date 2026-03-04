const {
  computeLerpFactor,
} = require("../../frontend/src/projection/highlight-smoothing-policy");

describe("highlight-smoothing-policy", () => {
  test("adaptive smoothing increases lerp during high velocity", () => {
    const cfg = {
      ENABLE_ADAPTIVE_SMOOTHING: true,
      BASE_LERP: 0.15,
      FAST_LERP: 0.3,
      SPEED_THRESHOLD_PX: 40,
    };
    const low = computeLerpFactor({ speedPx: 5 }, cfg);
    const high = computeLerpFactor({ speedPx: 80 }, cfg);
    expect(high).toBeGreaterThan(low);
  });

  test("returns base lerp when adaptive smoothing disabled", () => {
    const cfg = {
      ENABLE_ADAPTIVE_SMOOTHING: false,
      BASE_LERP: 0.2,
      FAST_LERP: 0.3,
      SPEED_THRESHOLD_PX: 40,
    };
    expect(computeLerpFactor({ speedPx: 100 }, cfg)).toBe(0.2);
  });
});

