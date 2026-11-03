const { execSync } = require("child_process");

test("symbolFromSimpleStyle is not duplicated in map-legend", () => {
  let out = "";
  try {
    out = execSync(
      'rg -n "function symbolFromSimpleStyle" frontend/src/map/map-legend.js',
      { stdio: ["pipe", "pipe", "ignore"] },
    ).toString();
  } catch (error) {
    out = (error.stdout || "").toString();
  }
  expect(out.trim()).toBe("");
});

test("AdvancedStyleEngine exposes symbolFromSimpleStyle as public static", async () => {
  const mod = await import(
    "../../../frontend/src/map-utils/advanced-style-engine.js"
  );
  const Engine =
    mod.default && typeof mod.default === "function"
      ? mod.default
      : mod.default?.default || mod;
  expect(typeof Engine.symbolFromSimpleStyle).toBe("function");
  const result = Engine.symbolFromSimpleStyle({
    fillColor: "#ff0000",
    fillOpacity: 0.5,
    strokeColor: "#000000",
    strokeWidth: 2,
  });
  expect(result.symbolLayers).toHaveLength(2);
  expect(result.symbolLayers[0].type).toBe("fill");
  expect(result.symbolLayers[1].type).toBe("stroke");
});
