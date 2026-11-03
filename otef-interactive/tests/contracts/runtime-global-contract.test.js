const fs = require("fs");
const path = require("path");

function read(filePath) {
  return fs.readFileSync(path.resolve(__dirname, "../../", filePath), "utf8");
}

test("table switcher scripts explicitly export browser globals", () => {
  const switcher = read("frontend/src/shared/table-switcher.js");
  const popup = read("frontend/src/shared/table-switcher-popup.js");

  expect(switcher.includes("window.TableSwitcher = TableSwitcher")).toBe(true);
  expect(popup.includes("window.TableSwitcherPopup = TableSwitcherPopup")).toBe(
    true,
  );
});

test("maplibre viewport sync exports setup function without window globals", () => {
  const src = read("frontend/src/map/maplibre-viewport-sync.js");
  expect(src.includes("export function setupViewportSync(")).toBe(true);
  expect(src.includes("window.attachViewportSyncListeners")).toBe(false);
});

test("layer name utils keeps direct global function contracts", () => {
  const src = read("frontend/src/shared/layer-name-utils.js");
  expect(
    src.includes(
      "window.parseLayerNameWithGeometrySuffix = parseLayerNameWithGeometrySuffix",
    ),
  ).toBe(true);
  expect(
    src.includes(
      "window.normalizeLayerBaseName = normalizeLayerBaseName",
    ),
  ).toBe(true);
});

