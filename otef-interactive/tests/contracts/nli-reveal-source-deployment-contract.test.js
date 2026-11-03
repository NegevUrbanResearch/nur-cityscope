const fs = require("fs");
const path = require("path");

const frontend = path.resolve(__dirname, "../../frontend");
const viewerPath = path.join(frontend, "src/map/nli-reveal-presentation.js");
const viewer = fs.readFileSync(viewerPath, "utf8");
const gisHtml = fs.readFileSync(path.join(frontend, "index.html"), "utf8");
const projectionHtml = fs.readFileSync(path.join(frontend, "projection.html"), "utf8");
const packageJson = require("../../package.json");

test("source-served GIS loads local production Reveal assets without bare imports", () => {
  expect(viewer).not.toMatch(/from\s+["']reveal\.js(?:\/[^"']*)?["']/);
  expect(viewer).not.toMatch(/import\s+["']reveal\.js\/dist\/reveal\.css["']/);

  const esmImport = viewer.match(/from\s+["']([^"']*reveal\.esm\.js)["']/);
  expect(esmImport).not.toBeNull();
  const esmPath = path.resolve(path.dirname(viewerPath), esmImport[1]);
  expect(fs.existsSync(esmPath)).toBe(true);
  const sourceMap = fs.readFileSync(esmPath, "utf8").match(/sourceMappingURL=([^\s]+)/);
  expect(sourceMap).not.toBeNull();
  expect(fs.existsSync(path.resolve(path.dirname(esmPath), sourceMap[1]))).toBe(true);

  const cssLink = gisHtml.match(/<link\b[^>]*href=["']([^"']*reveal\.css)["'][^>]*>/i);
  expect(cssLink).not.toBeNull();
  expect(fs.existsSync(path.resolve(frontend, cssLink[1]))).toBe(true);
  expect(projectionHtml).not.toMatch(/reveal\.css|reveal\.esm\.js/i);
});

test("Reveal remains a production dependency for the source-served GIS viewer", () => {
  expect(packageJson.dependencies["reveal.js"]).toBe("5.2.1");
  expect(packageJson.devDependencies["reveal.js"]).toBeUndefined();
});
