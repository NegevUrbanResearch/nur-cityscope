// tests/hotspot-refactor/projection-layer-manager-size.test.js
const fs = require("fs");

test("projection-layer-manager.js is under 700 lines after animation extraction", () => {
  const src = fs.readFileSync(
    "frontend/src/projection/projection-layer-manager.js",
    "utf8",
  );
  const lines = src.split("\n").length;
  expect(lines).toBeLessThan(700);
});

test("projection-animation-loop.js exists and exports start/stop", async () => {
  const mod = await import(
    "../../../frontend/src/projection/projection-animation-loop.js"
  );
  expect(typeof mod.startAnimationLoop).toBe("function");
  expect(typeof mod.stopAnimationLoop).toBe("function");
});

