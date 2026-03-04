const fs = require("fs");
const path = require("path");

test("index.html no longer contains long legacy js script chain", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "../../frontend/index.html"), "utf8");
  expect(html.includes('src="js/map/map-initialization.js"')).toBe(false);
  expect(html.includes('src="./src/entries/map-main.js"')).toBe(true);
});

test("projection/remote/curation pages load single module entrypoints", () => {
  const projection = fs.readFileSync(
    path.resolve(__dirname, "../../frontend/projection.html"),
    "utf8",
  );
  const remote = fs.readFileSync(
    path.resolve(__dirname, "../../frontend/remote-controller.html"),
    "utf8",
  );
  const curation = fs.readFileSync(
    path.resolve(__dirname, "../../frontend/curation.html"),
    "utf8",
  );

  expect(projection.includes('src="./src/entries/projection-main.js"')).toBe(true);
  expect(remote.includes('src="./src/entries/remote-main.js"')).toBe(true);
  expect(curation.includes('src="./src/entries/curation-main.js"')).toBe(true);

  expect(projection.includes('src="js/projection/projection-display.js"')).toBe(false);
  expect(remote.includes('src="js/remote/remote-controller.js"')).toBe(false);
  expect(curation.includes('src="js/curation/curation.js"')).toBe(false);
});
