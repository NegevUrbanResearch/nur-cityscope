const fs = require("fs");
const path = require("path");

function read(relPath) {
  const abs = path.resolve(__dirname, "..", "..", relPath);
  return fs.readFileSync(abs, "utf8");
}

test("remote controller imports orientation transform helper explicitly", () => {
  const source = read("frontend/src/remote/remote-controller.js");
  expect(source).toMatch(
    /from\s+["']\.\.\/shared\/orientation-transform\.js["']/,
  );
  expect(source).toMatch(/rotateViewerVectorToItm/);
});

test("layer sheet and legend model builder import layer-name utilities explicitly", () => {
  const layerSheetSource = read("frontend/src/remote/layer-sheet-controller.js");
  const legendModelSource = read("frontend/src/map/legend-model-builder.js");

  expect(layerSheetSource).toMatch(
    /from\s+["']\.\.\/shared\/layer-name-utils\.js["']/,
  );
  expect(legendModelSource).toMatch(
    /from\s+["']\.\.\/shared\/layer-name-utils\.js["']/,
  );
});
