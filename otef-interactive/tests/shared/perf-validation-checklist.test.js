const fs = require("fs");
const path = require("path");

describe("perf validation checklist doc", () => {
  test("defines baseline and target thresholds", () => {
    const docPath = path.resolve(
      __dirname,
      "../../docs/perf-validation-checklist.md"
    );
    const text = fs.readFileSync(docPath, "utf8");

    expect(text).toContain("## Baseline Capture");
    expect(text).toContain("## Post-Change Capture");
    expect(text).toContain("## Pass Criteria");
    expect(text).toContain("25% improvement");
    expect(text).toContain("p95 applyViewportMs");
    expect(text).toContain("heavy layer time-to-visible");
    expect(text).toContain("desync duration");
  });
});
