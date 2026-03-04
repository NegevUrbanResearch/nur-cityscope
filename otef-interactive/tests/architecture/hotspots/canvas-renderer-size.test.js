// tests/hotspot-refactor/canvas-renderer-size.test.js
const fs = require("fs");

test("layer-renderer-canvas is under 550 lines after dead code removal and bugfixes", () => {
  const src = fs.readFileSync(
    "frontend/src/projection/layer-renderer-canvas.js",
    "utf8",
  );
  const lines = src.split("\n").length;
  expect(lines).toBeLessThan(550);
});

test("layer-renderer-canvas does not contain legacy _drawPolygon method", () => {
  const src = fs.readFileSync(
    "frontend/src/projection/layer-renderer-canvas.js",
    "utf8",
  );
  expect(src.includes("_drawPolygon(")).toBe(false);
  expect(src.includes("_drawLineString(")).toBe(false);
  expect(src.includes("_drawPoint(")).toBe(false);
  expect(src.includes("_createHatchPattern(")).toBe(false);
});

test("CanvasLayerRenderer exposes coordToPixel mapping for ITM coordinates", async () => {
  const mod = await import(
    "../../../frontend/src/projection/layer-renderer-canvas.js"
  );
  const { CanvasLayerRenderer } = mod;

  // Bypass DOM-dependent constructor by creating a bare instance
  const renderer = Object.create(CanvasLayerRenderer.prototype);

  // Simple 10x10 ITM square mapped to a 100x50 display area
  renderer.modelBounds = {
    west: 0,
    east: 10,
    south: 0,
    north: 10,
  };
  renderer.displayBounds = {
    offsetX: 0,
    offsetY: 0,
    width: 100,
    height: 50,
  };
  renderer.dpr = 1;

  const center = renderer._coordToPixel([5, 5]);
  expect(center.x).toBeCloseTo(50, 3);
  expect(center.y).toBeCloseTo(25, 3);
});
