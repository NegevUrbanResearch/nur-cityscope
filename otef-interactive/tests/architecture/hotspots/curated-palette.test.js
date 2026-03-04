const { execSync } = require("child_process");

test("curated palette is defined only in ui-config.js", () => {
  let out = "";
  try {
    out = execSync(
      'rg -n "CURATED.*PALETTE" frontend/src --glob "!**/config/*"',
      { stdio: ["pipe", "pipe", "ignore"] },
    ).toString();
  } catch (error) {
    out = (error.stdout || "").toString();
  }
  expect(out.trim()).toBe("");
});

test("ui-config exports curated palette with hash function", async () => {
  const { UI_CONFIG } = await import(
    "../../../frontend/src/config/ui-config.js"
  );
  expect(UI_CONFIG.curatedPalette).toHaveLength(6);
  expect(typeof UI_CONFIG.getCuratedColor).toBe("function");
  const color = UI_CONFIG.getCuratedColor("test-layer-id");
  expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
});
