const fs = require("fs");
const path = require("path");

function read(p) {
  return fs.readFileSync(path.resolve(__dirname, "../../", p), "utf8");
}

test("map entry bootstraps maplibre runtime modules", () => {
  const src = read("frontend/src/entries/map-main.js");
  const idxCreateMap = src.indexOf(
    'import { createGISMap } from "../map/maplibre-map.js";',
  );
  const idxViewportSync = src.indexOf(
    'import { setupViewportSync } from "../map/maplibre-viewport-sync.js";',
  );
  const idxLayerManager = src.indexOf(
    'import { applyLayerGroupsToMap } from "../map/maplibre-layer-manager.js";',
  );

  expect(idxCreateMap).toBeGreaterThan(-1);
  expect(idxViewportSync).toBeGreaterThan(-1);
  expect(idxLayerManager).toBeGreaterThan(-1);
  expect(src.includes("../map/map-initialization.js")).toBe(false);
  expect(src.includes("../map/leaflet-control-with-basemap.js")).toBe(false);
  expect(src.includes("../map/viewport-sync.js")).toBe(false);
  expect(src.includes("loadLegacyScriptChain")).toBe(false);
});

test("entrypoints do not require window.TableSwitcher constructor", () => {
  const mapEntry = read("frontend/src/entries/map-main.js");
  const projectionEntry = read("frontend/src/entries/projection-main.js");

  expect(mapEntry.includes("window.TableSwitcher")).toBe(false);
  expect(projectionEntry.includes("window.TableSwitcher")).toBe(false);
});
