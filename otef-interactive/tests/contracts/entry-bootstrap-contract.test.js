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
    'from "../map/maplibre-layer-manager.js"',
  );

  expect(idxCreateMap).toBeGreaterThan(-1);
  expect(idxViewportSync).toBeGreaterThan(-1);
  expect(idxLayerManager).toBeGreaterThan(-1);
  expect(src.includes("applyLayerGroupsToMap")).toBe(true);
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

test("projection entry wires MapLibre curated pipeline and Supabase heartbeat", () => {
  const src = read("frontend/src/entries/projection-main.js");
  expect(src.includes("loadCuratedLayerToMapLibre")).toBe(true);
  expect(src.includes("removeCuratedHtmlMarkers")).toBe(true);
  expect(src.includes("removeCuratedLayersByPrefix")).toBe(true);
  expect(src.includes("refreshProjectionCuratedLayers")).toBe(true);
  expect(src.includes("loadProjectionCuratedLayers")).toBe(true);
  expect(src.includes("startCuratedSupabaseHeartbeat")).toBe(true);
  expect(src.includes('table: "otef"')).toBe(true);
  expect(src.includes("syncCuratedMapLayersAfterSupabasePull")).toBe(true);
});
