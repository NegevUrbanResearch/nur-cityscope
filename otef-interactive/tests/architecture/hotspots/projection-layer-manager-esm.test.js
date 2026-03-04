const fs = require("fs");
const { execSync } = require("child_process");

test("projection-layer-manager is not wrapped in a module-level IIFE", () => {
  const src = fs.readFileSync(
    "frontend/src/projection/projection-layer-manager.js",
    "utf8",
  );
  // The file should NOT start with (function(){ or have })(); as the last statement
  // (Async arrow IIFEs inside functions like `(async () => { ... })()` are fine)
  const lines = src.split(/\r?\n/).map((l) => l.trim());
  const nonEmptyLines = lines.filter(Boolean);
  // First meaningful line should not be an IIFE opening
  const firstCode = nonEmptyLines.find(
    (l) => !l.startsWith("//") && !l.startsWith("import"),
  );
  expect(firstCode).not.toMatch(/^\(function/);
  // Last meaningful line should not be });
  const lastCode = nonEmptyLines[nonEmptyLines.length - 1];
  expect(lastCode).not.toBe("})();");
});

test("projection-layer-manager has ESM exports and no window global", () => {
  const src = fs.readFileSync(
    "frontend/src/projection/projection-layer-manager.js",
    "utf8",
  );
  expect(src).toMatch(/export\s*\{/);
  expect(src.includes("window.ProjectionLayerManager")).toBe(false);
});

test("projection-display.js does not reference window.ProjectionLayerManager", () => {
  let out = "";
  try {
    out = execSync(
      'findstr /C:"window.ProjectionLayerManager" frontend\\src\\projection\\projection-display.js',
      { stdio: ["pipe", "pipe", "ignore"] },
    ).toString();
  } catch (error) {
    out = (error.stdout || "").toString();
  }
  expect(out.trim()).toBe("");
});
