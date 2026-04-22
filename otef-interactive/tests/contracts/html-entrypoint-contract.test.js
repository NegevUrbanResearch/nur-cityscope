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

test("remote-controller embeds curation workshop iframe with embed heartbeat contract flag", () => {
  const remote = fs.readFileSync(
    path.resolve(__dirname, "../../frontend/remote-controller.html"),
    "utf8",
  );
  expect(remote.includes('src="curation.html?embed=1"')).toBe(true);
  expect(/<iframe\b[^>]*\bid="remoteCurationFrame"/i.test(remote)).toBe(true);
});

test("remote-controller shell: Hebrew default, tab regions, and stable mount ids", () => {
  const remote = fs.readFileSync(
    path.resolve(__dirname, "../../frontend/remote-controller.html"),
    "utf8",
  );

  expect(remote).toMatch(/<html[^>]*\blang="he"/i);
  expect(remote).toMatch(/\bid="table-switcher"/);
  expect(remote).toMatch(/\bid="warningOverlay"/);
  expect(remote).toMatch(/\bid="remoteMain"/);
  expect(remote).toMatch(/\bid="remoteTabPanels"/);
  expect(remote).toMatch(/\bid="remoteBottomNav"/);
  expect(remote).toMatch(/\brole="tablist"/);

  expect(remote).toMatch(
    /data-remote-tab="navigation"[^>]*\bid="remote-panel-navigation"/i,
  );
  expect(remote).toMatch(/data-remote-tab="layers"[^>]*\bid="remote-panel-layers"/i);
  expect(remote).toMatch(/data-remote-tab="curation"[^>]*\bid="remote-panel-curation"/i);

  expect(remote).toMatch(/\bid="remote-tab-navigation"[^>]*\baria-controls="remote-panel-navigation"/i);
  expect(remote).toMatch(/\bid="remote-tab-layers"[^>]*\baria-controls="remote-panel-layers"/i);
  expect(remote).toMatch(/\bid="remote-tab-curation"[^>]*\baria-controls="remote-panel-curation"/i);

  expect(remote).toMatch(/\bid="remoteLayerHost"/);
  expect(remote).toMatch(/\bid="layerSheet"/);
  expect(remote).toMatch(/\bid="layerPanelContent"/);
  expect(remote).toMatch(/\bid="remoteLocaleToggle"/);
  expect(remote).toMatch(/\bid="panNorth"/);
  expect(remote).toMatch(/\bid="zoomSlider"/);
  expect(remote).toMatch(/\bid="joystickZone"/);
});

test("remote-controller locale toggle contract (delta)", () => {
  const remote = fs.readFileSync(
    path.resolve(__dirname, "../../frontend/remote-controller.html"),
    "utf8",
  );

  const toggleRegion = remote.match(
    /class="remote-locale-toggle"[\s\S]*?\bid="remoteLocaleToggle"/i,
  );
  expect(toggleRegion).toBeTruthy();
  expect(toggleRegion[0]).toMatch(/role="group"/);
  expect(toggleRegion[0]).toMatch(/data-i18n-aria="localeGroupAria"/);

  expect(remote).toMatch(/id="remoteLocaleHe"[^>]*>[\s\S]*?עברית/);
  expect(remote).toMatch(/id="remoteLocaleEn"[^>]*>[\s\S]*?English/);
});
