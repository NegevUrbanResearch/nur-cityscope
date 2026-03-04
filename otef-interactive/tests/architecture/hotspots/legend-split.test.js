// tests/hotspot-refactor/legend-split.test.js
const fs = require("fs");

test("legend-model-builder module exists", () => {
  expect(
    fs.existsSync("frontend/src/map/legend-model-builder.js"),
  ).toBe(true);
});

test("map-legend.js is under 250 lines (render-only)", () => {
  const src = fs.readFileSync("frontend/src/map/map-legend.js", "utf8");
  const lines = src.split("\n").length;
  expect(lines).toBeLessThan(250);
});

test("legend-model-builder exports buildLegendModel and symbolIRToLegendItems", async () => {
  const mod = await import(
    "../../../frontend/src/map/legend-model-builder.js"
  );
  expect(typeof mod.buildLegendModel).toBe("function");
  expect(typeof mod.symbolIRToLegendItems).toBe("function");
});
