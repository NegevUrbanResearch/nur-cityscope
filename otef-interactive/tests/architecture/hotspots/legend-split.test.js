// tests/hotspot-refactor/legend-split.test.js
const fs = require("fs");

test("legend-model-builder module exists", () => {
  expect(
    fs.existsSync("frontend/src/map/legend-model-builder.js"),
  ).toBe(true);
});

test("legend-model-builder exports buildLegendModel and symbolIRToLegendItems", async () => {
  const mod = await import(
    "../../../frontend/src/map/legend-model-builder.js"
  );
  expect(typeof mod.buildLegendModel).toBe("function");
  expect(typeof mod.symbolIRToLegendItems).toBe("function");
});

test("GIS and projection use the single mountMapLegend lifecycle", () => {
  const integration = fs.readFileSync(
    "frontend/src/map/legend-integration.js",
    "utf8",
  );
  const mapMain = fs.readFileSync("frontend/src/entries/map-main.js", "utf8");
  const projectionMain = fs.readFileSync(
    "frontend/src/entries/projection-main.js",
    "utf8",
  );

  expect(integration).toContain('import { mountMapLegend } from "./map-legend.js"');
  expect(integration).toMatch(/const mounted = mount\(\{/);
  expect(mapMain).toMatch(
    /installMapLegendLifecycle\(\{[\s\S]*?surface:\s*"gis"/,
  );
  expect(projectionMain).toMatch(
    /installMapLegendLifecycle\(\{[\s\S]*?surface:\s*"projection"/,
  );
});
