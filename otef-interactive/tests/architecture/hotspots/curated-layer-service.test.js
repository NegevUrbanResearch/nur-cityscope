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

test("fetchCuratedLayerData supports project-scoped curated groups", async () => {
  const originalFetch = global.fetch;
  const fakeResponse = {
    ok: true,
    json: async () => [
      {
        id: 42,
        layer_type: "geojson",
        geojson: { type: "FeatureCollection", features: [] },
      },
    ],
  };
  global.fetch = vi.fn().mockResolvedValue(fakeResponse);

  const { fetchCuratedLayerData } = await import(
    "../../../frontend/src/shared/curated-layer-service.js"
  );

  const result = await fetchCuratedLayerData("curated_myproj.42");
  expect(result).not.toBeNull();
  expect(result.layerData.id).toBe(42);

  global.fetch = originalFetch;
});
