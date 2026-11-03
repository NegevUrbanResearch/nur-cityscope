const fs = require("fs");

test("leaflet curated loader does not short-circuit memorial point layers before dashed route integration", () => {
  const src = fs.readFileSync(
    "frontend/src/map/maplibre-curated-layer-loader.js",
    "utf8",
  );

  // Guard against regressions where memorial-only layers bypass dashed route
  // construction and only render point markers.
  expect(src.includes("if (hasMemorialPoints && !hasLineFeatures)")).toBe(false);
});

test("pink-line parking attach is not gated on pink base layer presence", () => {
  const src = fs.readFileSync(
    "frontend/src/map/maplibre-curated-layer-loader.js",
    "utf8",
  );
  expect(src).not.toContain(
    "if (!pinkLineBaseLayerInstance || !map.hasLayer(pinkLineBaseLayerInstance)) return;",
  );
});

