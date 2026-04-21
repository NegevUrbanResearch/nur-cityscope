// tests/hotspot-refactor/projection-layer-manager-size.test.js
const fs = require("fs");

test("projection-layer-manager.js stays bounded after pink-line canvas extraction", () => {
  const src = fs.readFileSync(
    "frontend/src/projection/projection-layer-manager.js",
    "utf8",
  );
  const lines = src.split("\n").length;
  expect(lines).toBeLessThan(760);
});

test("projection-pink-line-canvas.js holds pink-line canvas bundle under 220 lines", () => {
  const src = fs.readFileSync(
    "frontend/src/projection/projection-pink-line-canvas.js",
    "utf8",
  );
  expect(src.split("\n").length).toBeLessThan(220);
});

test("projection-animation-loop.js exists and exports start/stop", async () => {
  const mod = await import(
    "../../../frontend/src/projection/projection-animation-loop.js"
  );
  expect(typeof mod.startAnimationLoop).toBe("function");
  expect(typeof mod.stopAnimationLoop).toBe("function");
});

