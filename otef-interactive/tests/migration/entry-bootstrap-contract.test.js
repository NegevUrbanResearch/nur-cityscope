const fs = require("fs");
const path = require("path");

function read(p) {
  return fs.readFileSync(path.resolve(__dirname, "../../", p), "utf8");
}

test("map entry loads map-initialization after map dependency modules", () => {
  const src = read("frontend/src/entries/map-main.js");
  const idxInit = src.indexOf('"../map/map-initialization.js"');
  const idxLeafletLoader = src.indexOf('"../map/leaflet-control-with-basemap.js"');
  const idxViewportSync = src.indexOf('"../map/viewport-sync.js"');

  expect(idxInit).toBeGreaterThan(idxLeafletLoader);
  expect(idxInit).toBeGreaterThan(idxViewportSync);
  expect(src.includes("loadLegacyScriptChain")).toBe(false);
});

test("entrypoints do not require window.TableSwitcher constructor", () => {
  const mapEntry = read("frontend/src/entries/map-main.js");
  const projectionEntry = read("frontend/src/entries/projection-main.js");

  expect(mapEntry.includes("window.TableSwitcher")).toBe(false);
  expect(projectionEntry.includes("window.TableSwitcher")).toBe(false);
});
