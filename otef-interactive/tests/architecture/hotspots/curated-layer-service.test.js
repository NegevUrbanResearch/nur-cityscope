// tests/hotspot-refactor/curated-layer-service.test.js
const fs = require("fs");

test("curated-layer-service module exists", () => {
  expect(
    fs.existsSync("frontend/src/shared/curated-layer-service.js"),
  ).toBe(true);
});

test("curated-layer-service exports shared functions", async () => {
  const mod = await import(
    "../../../frontend/src/shared/curated-layer-service.js"
  );
  expect(typeof mod.fetchCuratedLayerData).toBe("function");
  expect(typeof mod.extractPointFeatures).toBe("function");
  expect(typeof mod.fetchPinkLinePaths).toBe("function");
  expect(typeof mod.buildCuratedRouteGeoJSON).toBe("function");
});
