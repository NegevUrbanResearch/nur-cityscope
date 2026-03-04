const { execSync } = require("child_process");

const HOTSPOT_FILES = [
  "frontend\\src\\projection\\layer-renderer-canvas.js",
  "frontend\\src\\map\\map-legend.js",
  "frontend\\src\\map\\leaflet-control-with-basemap.js",
];

test("hotspot modules have no window.X = assignments", () => {
  for (const file of HOTSPOT_FILES) {
    let out = "";
    try {
      out = execSync(`findstr /R "window\\..*=" ${file}`, {
        stdio: ["pipe", "pipe", "ignore"],
      }).toString();
    } catch (error) {
      out = (error.stdout || "").toString();
    }
    // Filter to only lines with window.Something = (assignment pattern)
    const assignments = out
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => /window\.[A-Za-z_]+\s*=/.test(l))
      // Allow window.addEventListener and window._otefUnsubscribeFunctions
      .filter((l) => !l.includes("addEventListener"))
      .filter((l) => !l.includes("_otefUnsub"));
    expect(assignments).toEqual([]);
  }
});

test("all hotspot modules have ESM exports", () => {
  const fs = require("fs");
  for (const file of HOTSPOT_FILES) {
    const src = fs.readFileSync(file, "utf8");
    expect(src).toMatch(/export\s/);
  }
});
