const telemetry = require("../../frontend/js/map/perf-telemetry");

describe("perf-telemetry", () => {
  beforeEach(() => {
    telemetry.reset();
  });

  test("records metrics and returns percentile summary", () => {
    telemetry.record("applyViewportMs", 10);
    telemetry.record("applyViewportMs", 30);
    telemetry.record("applyViewportMs", 20);

    const result = telemetry.summary();
    expect(result.applyViewportMs).toBeDefined();
    expect(result.applyViewportMs.count).toBe(3);
    expect(result.applyViewportMs.p95).toBeGreaterThan(0);
    expect(result.applyViewportMs.max).toBe(30);
  });
});
