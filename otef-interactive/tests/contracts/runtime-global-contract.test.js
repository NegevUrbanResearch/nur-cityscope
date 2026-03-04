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

test("viewport sync supports deferred map listener attachment", () => {
  const src = read("frontend/src/map/viewport-sync.js");
  expect(src.includes("function attachViewportSyncListeners()")).toBe(true);
  expect(
    src.includes(
      "window.attachViewportSyncListeners = attachViewportSyncListeners",
    ),
  ).toBe(true);
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

