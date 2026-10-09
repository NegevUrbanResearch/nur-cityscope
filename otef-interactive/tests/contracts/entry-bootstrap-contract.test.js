const fs = require("fs");
const path = require("path");

function read(p) {
  return fs.readFileSync(path.resolve(__dirname, "../../", p), "utf8");
}

test("map entry does not poll Supabase curated heartbeat", () => {
  const src = read("frontend/src/entries/map-main.js");
  expect(src.includes("startCuratedSupabaseHeartbeat")).toBe(false);
});

test("map entry bootstraps maplibre runtime modules", () => {
  const src = read("frontend/src/entries/map-main.js");
  const idxCreateMap = src.search(/import \{[^}]*createGISMap[^}]*setGISBasemap[^}]*maplibregl[^}]*\} from "\.\.\/map\/maplibre-map\.js"/);
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
  expect(src.includes("attachGisFeaturePopups")).toBe(true);
  expect(src.includes("../map/maplibre-gis-popups.js")).toBe(true);
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

test("projection entry wires MapLibre curated pipeline (manual Supabase sync via workshop)", () => {
  const src = read("frontend/src/entries/projection-main.js");
  const refreshSrc = read("frontend/src/map/maplibre-curated-layer-loader.js");
  expect(src.includes("createProjectionCuratedRefresh")).toBe(true);
  expect(refreshSrc.includes("loadCuratedLayerToMapLibre")).toBe(true);
  expect(refreshSrc.includes("removeCuratedHtmlMarkers")).toBe(true);
  expect(refreshSrc.includes("removeCuratedLayersByPrefix")).toBe(true);
  expect(src.includes("refreshProjectionCuratedLayers")).toBe(true);
  expect(src.includes("loadProjectionCuratedLayers")).toBe(true);
  expect(src.includes("startCuratedSupabaseHeartbeat")).toBe(false);
  expect(src.includes('OTEFDataContext.init("otef")')).toBe(true);
  expect(src.includes("syncCuratedMapLayersAfterSupabasePull")).toBe(true);
  expect(src.includes("otef-curated-geojson-refresh")).toBe(true);
  expect(src.includes("projectionCuratedRefreshChain")).toBe(true);
  expect(refreshSrc.includes("layerStyleOptions")).toBe(true);
  expect(refreshSrc).toContain("syncProjectionLayersWithNarrative(map, currentGroups, plan.joined)");
  expect(refreshSrc).toContain("joined: withJoinedBatch(layerStyleOptions, durationMs)");
  expect(refreshSrc).toMatch(/function withJoinedBatch\(layerStyleOptions, durationMs\)[\s\S]{0,500}joinBatch: true/);
  expect(src).toMatch(/nameFieldController\.setProjectionConfig\(\s*DEFAULT_PROJECTION_CONFIG\s*\)/);
  expect(src).toMatch(/if \(map\.loaded\(\) \|\| map\._loaded\) map\.fire\("load"\)/);
  expect(refreshSrc.includes("removeCuratedLayersByPrefix(map, fullId, layerStyleOptions)")).toBe(true);
  expect(refreshSrc).toContain("hasMapLibreLayerWithPrefix(targetMap, fullId)");
  expect(refreshSrc).toContain("!curatedContentMounted(map, id)");
  expect(refreshSrc.includes("fromSlideshowTick,")).toBe(true);
  expect(refreshSrc.includes("loadCuratedLayerToMapLibre(map, fullId,")).toBe(true);
  expect(src.includes("skipInitialVectorLayerSync")).toBe(false);
  const curatedSubscription = /OTEFDataContext\.subscribe\(\s*["']layerGroups["']\s*,\s*\(\)\s*=>\s*\{[\s\S]{0,400}?groupsOverride:\s*getEffectiveProjectionLayerGroups\(\)/;
  expect(src).toMatch(curatedSubscription);
  expect(src).not.toMatch(/OTEFDataContext\.subscribe\(\s*["']layerGroups["']\s*,\s*\(\s*groups\s*\)[\s\S]{0,800}?groupsOverride:\s*groups/);
});
