import * as telemetry from "../../frontend/src/map/perf-telemetry.js";

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

  test("retains at least 1,000 scheduler samples", () => {
    for (let index = 0; index < 1100; index += 1) telemetry.record("nliSchedulerMs", index);
    expect(telemetry.summary().nliSchedulerMs.count).toBe(1000);
  });
});

