const fs = require("fs");
const path = require("path");

function read(p) {
  return fs.readFileSync(path.resolve(__dirname, "../../", p), "utf8");
}

test("bounds and rotation editor modules are callback-based (no Leaflet/canvas map APIs)", () => {
  const bounds = read("frontend/src/projection/projection-bounds-editor.js");
  const rotation = read("frontend/src/projection/projection-rotation-editor.js");

  for (const [name, src] of [
    ["projection-bounds-editor.js", bounds],
    ["projection-rotation-editor.js", rotation],
  ]) {
    expect(src, name).toMatch(/window\.Projection(Bounds|Rotation)Editor/);
    expect(src, name).toMatch(/\bfunction configure\b/);
    expect(src.toLowerCase(), name).not.toMatch(/\bleaflet\b/);
    expect(src, name).not.toMatch(/\bL\.(map|latLng|icon)\b/);
  }

  expect(bounds).toMatch(/getDisplayedImageBounds/);
  expect(bounds).toMatch(/itmToDisplayPixels/);
  expect(rotation).toMatch(/getDisplayedImageBounds/);
});

test("projection entry loads editors, injects MapLibre-safe callbacks, and wires B / R keys", () => {
  const src = read("frontend/src/entries/projection-main.js");

  expect(src).toContain('await import("../projection/projection-bounds-editor.js")');
  expect(src).toContain('await import("../projection/projection-rotation-editor.js")');

  expect(src).toContain("ProjectionBoundsEditor.configure");
  expect(src).toContain("getDisplayedImageBounds");
  expect(src).toContain("itmToDisplayPixels");
  expect(src).toContain("ProjectionRotationEditor.configure");
  expect(src).toContain("getModelBounds: () => itmBounds");
  expect(src).toContain("viewer_angle_deg: modelBoundsData.viewer_angle_deg");

  expect(src).toContain('key === "b"');
  expect(src).toContain("window.ProjectionBoundsEditor");
  expect(src).toContain("ProjectionBoundsEditor.toggle");
  expect(src).toContain('key === "r"');
  expect(src).toContain("ProjectionRotationEditor.toggle");
});
