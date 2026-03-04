const { execSync } = require("child_process");

test("no window-based module coupling remains in src", () => {
  const allowed = [
    "window.MapProjectionConfig",
    "window.shouldShowLayerOnGisMap",
    "window.normalizeLayerBaseName",
    "window.parseLayerNameWithGeometrySuffix",
    "window.WmtsLayerRenderer",
    "window.CanvasLayerRenderer",
    "window.pmtilesLayersWithConfigs",
    "window.getMapLayerLoaderAPI",
  ];
  let out = "";
  try {
    out = execSync(
      'rg -n "window\\.[A-Za-z0-9_]+\\s*=.*(Layer|Config|Helper|Renderer)" frontend/src',
      { stdio: ["pipe", "pipe", "ignore"] },
    ).toString();
  } catch (error) {
    out = (error.stdout || "").toString();
  }
  const unexpected = out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !allowed.some((token) => line.includes(token)));
  expect(unexpected).toEqual([]);
});
