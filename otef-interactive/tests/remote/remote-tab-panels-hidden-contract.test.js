import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readRemoteStyles() {
  return fs.readFileSync(
    path.resolve(__dirname, "../../frontend/css/remote-styles.css"),
    "utf8",
  );
}

function cssBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "s"));
  expect(match, `Missing CSS block for ${selector}`).toBeTruthy();
  return match[1];
}

/**
 * Regression: `.remote-tab-panel { display:flex }` must not keep `[hidden]` panels
 * in the flex layout (UA [hidden] loses to author rules of equal-ish specificity).
 */
test("remote-styles: hidden tab panels are display:none (out of layout)", () => {
  const css = readRemoteStyles();
  expect(css).toMatch(/\.remote-tab-panel\[hidden\]\s*\{[^}]*display:\s*none/s);
});

test("remote-styles: disabled workshop tab is faded and placed at the left edge", () => {
  const css = readRemoteStyles();
  expect(css).toMatch(
    /\.remote-bottom-nav__tab\[data-remote-tab="curation"\]\s*\{[^}]*order:\s*-1/s,
  );
  expect(css).toMatch(
    /\.remote-bottom-nav__tab--disabled,\s*\.remote-bottom-nav__tab:disabled\s*\{[^}]*opacity:\s*0\.42/s,
  );
});

test("remote-styles: basemap control lives as a compact layers-tab toolbar", () => {
  const css = readRemoteStyles();
  const layerHost = cssBlock(css, ".remote-layer-host");
  const basemapControl = cssBlock(css, ".layers-basemap-control");
  const basemapTitle = cssBlock(css, ".layers-basemap-control .basemap-control-title");
  const localeShell = cssBlock(css, ".remote-locale-toggle");
  const localeButton = cssBlock(css, ".remote-locale-btn");
  const localeActive = cssBlock(css, ".remote-locale-btn.is-active");

  expect(layerHost).toMatch(/display:\s*flex/);
  expect(layerHost).toMatch(/flex-direction:\s*column/);
  expect(basemapControl).toMatch(/display:\s*flex/);
  expect(basemapControl).toMatch(/justify-content:\s*space-between/);
  expect(basemapControl).toMatch(/align-items:\s*center/);
  expect(basemapTitle).not.toMatch(/position:\s*absolute/);
  expect(basemapTitle).toMatch(/white-space:\s*nowrap/);

  expect(localeShell).toMatch(/display:\s*grid/);
  expect(localeShell).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  expect(localeShell).toMatch(/gap:\s*2px/);
  expect(localeShell).toMatch(/padding:\s*2px/);
  expect(localeShell).toMatch(/border-radius:\s*var\(--rounded-sm\)/);
  expect(localeShell).toMatch(/background:\s*rgba\(38,\s*35,\s*32,\s*0\.72\)/);

  expect(localeButton).toMatch(/min-height:\s*30px/);
  expect(localeButton).toMatch(/border-radius:\s*6px/);

  expect(localeActive).toMatch(/background:\s*var\(--color-surface\)/);
  expect(localeActive).toMatch(/color:\s*var\(--color-primary\)/);
  expect(css).toMatch(/\.basemap-satellite-wrapper\s*\{[^}]*position:\s*relative/s);
  expect(css).toMatch(/\.basemap-satellite-variants\s*\{[^}]*position:\s*absolute/s);
  expect(css).toMatch(/\.basemap-satellite-variants\s*\{[^}]*top:\s*calc\(100%/s);
  expect(css).toMatch(/\.basemap-satellite-variants\s*\{[^}]*max-inline-size:\s*min\(/s);
  expect(css).toMatch(/\.basemap-satellite-parent\[aria-expanded="true"\]\s+\.basemap-disclosure-indicator\s*\{[^}]*transform:/s);
  expect(css).not.toMatch(/\.basemap-variant-row\s*\{/);
  expect(cssBlock(css, ".basemap-primary-row")).toMatch(/grid-template-columns:\s*repeat\(3/);
  expect(cssBlock(css, ".basemap-satellite-variants")).toMatch(/width:\s*min\(10rem/);
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../frontend/src/remote/remote-controller.js"),
    "utf8",
  );
  expect(source).toMatch(/parentWrapper\?\.append\?\.\(variants\)/);
});

test("basemap state keeps durable active selection independent from the popover", async () => {
  const { deriveBasemapControlState } = await import(
    "../../frontend/src/remote/remote-controller.js"
  );
  expect(deriveBasemapControlState("satellite", false)).toEqual({
    parentActive: true,
    colorPressed: true,
    bwPressed: false,
    disabled: false,
  });
  expect(deriveBasemapControlState("satellite_bw", true)).toEqual({
    parentActive: true,
    colorPressed: false,
    bwPressed: true,
    disabled: true,
  });
  expect(deriveBasemapControlState("osm", false).parentActive).toBe(false);
  expect(deriveBasemapControlState("dark", false).parentActive).toBe(false);
});

test("remote-styles: NLI pack panes do not use an absolute overlay dock", () => {
  const css = readRemoteStyles();
  expect(css).not.toMatch(/\.nli-bottom-dock\s*\{/);
  expect(css).not.toMatch(/\.layers-variant-c--nli\s*\{/);
  expect(css).not.toMatch(/\.sheet-content--nli\s*\{/);
  expect(css).not.toMatch(/--nli-bottom-dock-height,\s*14\.5rem/);
  const panes = cssBlock(css, ".nli-pack-panes");
  const paneBtn = cssBlock(css, ".nli-pack-pane");
  expect(panes).toMatch(/display:\s*grid/);
  expect(paneBtn).toMatch(/min-height:\s*44px/);
  expect(panes).not.toMatch(/direction:\s*ltr/);

  const source = fs.readFileSync(
    path.resolve(__dirname, "../../frontend/src/remote/layer-sheet-controller.js"),
    "utf8",
  );
  expect(source).toMatch(/nliPackPaneSwitchHtml/);
  expect(source).toMatch(/setNliPackPane/);
  expect(source).toMatch(/nliNarrativeControlsHtml\(/);
  expect(source).toMatch(/focusedGroupId === "nli"[\s\S]*_syncNliPlayheadTicker/);
  expect(source).not.toMatch(/_syncNliDockMeasurement/);
  expect(source.indexOf("${narrativeSheet}")).toBeLessThan(source.indexOf("${nliSheet}"));
});

test("remote teardown destroys the LayerSheet-owned narrative lifecycle", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../frontend/src/remote/remote-controller.js"),
    "utf8",
  );
  expect(source).toMatch(/beforeunload[\s\S]*layerSheetController[\s\S]*\.destroy/);
});
