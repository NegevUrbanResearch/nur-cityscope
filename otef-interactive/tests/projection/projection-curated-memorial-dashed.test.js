const fs = require("fs");

test("projection curated loader does not short-circuit memorial point layers before dashed route integration", () => {
  const src = fs.readFileSync(
    "frontend/src/projection/projection-layer-manager.js",
    "utf8",
  );

  // Guard against regressions where memorial points skip integrated route
  // rendering and therefore never produce dashed detour features.
  expect(src.includes("if (hasMemorialFeatures)")).toBe(false);
});

