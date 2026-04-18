import * as telemetry from "../../frontend/src/map/perf-telemetry.js";

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

