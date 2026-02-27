const fs = require("fs");
const path = require("path");

describe("perf validation checklist sync additions", () => {
  test("includes zoom smoothness and drift thresholds", () => {
    const docPath = path.resolve(
      __dirname,
      "../../docs/perf-validation-checklist.md"
    );
    const text = fs.readFileSync(docPath, "utf8");
    expect(text).toContain("p95 zoomApplyMs");
    expect(text).toContain("p95 panApplyMs");
    expect(text).toContain("p95 syncDriftPx");
    expect(text).toContain("Zoom feel");
    expect(text).toContain("Drift target");
  });
});
