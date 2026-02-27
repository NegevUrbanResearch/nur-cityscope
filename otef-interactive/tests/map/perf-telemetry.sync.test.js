const telemetry = require("../../frontend/js/map/perf-telemetry");

describe("perf-telemetry sync metrics", () => {
  beforeEach(() => {
    telemetry.reset();
  });

  test("captures drift-related metrics in summary", () => {
    telemetry.record("syncDriftPx", 2);
    telemetry.record("syncDriftPx", 8);
    const result = telemetry.summary();
    expect(result.syncDriftPx).toBeDefined();
    expect(result.syncDriftPx.p95).toBeGreaterThan(0);
  });
});
