// tests/hotspot-refactor/leaflet-control-split.test.js
const fs = require("fs");

test("leaflet-curated-layer-loader module exists", () => {
  expect(
    fs.existsSync("frontend/src/map/leaflet-curated-layer-loader.js"),
  ).toBe(true);
});

test("map-geojson-layer-loader and map-pmtiles-layer-loader modules exist", () => {
  expect(
    fs.existsSync("frontend/src/map/map-geojson-layer-loader.js"),
  ).toBe(true);
  expect(
    fs.existsSync("frontend/src/map/map-pmtiles-layer-loader.js"),
  ).toBe(true);
});

test("leaflet-control-with-basemap is under 350 lines after full split", () => {
  const src = fs.readFileSync(
    "frontend/src/map/leaflet-control-with-basemap.js",
    "utf8",
  );
  const lines = src.split("\n").length;
  expect(lines).toBeLessThan(350);
});

test("leaflet-curated-layer-loader exports loadCuratedLayerFromAPI", async () => {
  const mod = await import(
    "../../../frontend/src/map/leaflet-curated-layer-loader.js"
  );
  expect(typeof mod.loadCuratedLayerFromAPI).toBe("function");
});

test("map-geojson-layer-loader exports loadGeoJSONLayer", async () => {
  const mod = await import(
    "../../../frontend/src/map/map-geojson-layer-loader.js"
  );
  expect(typeof mod.loadGeoJSONLayer).toBe("function");
});

test("map-pmtiles-layer-loader exports loadPMTilesLayer", async () => {
  const mod = await import(
    "../../../frontend/src/map/map-pmtiles-layer-loader.js"
  );
  expect(typeof mod.loadPMTilesLayer).toBe("function");
});
