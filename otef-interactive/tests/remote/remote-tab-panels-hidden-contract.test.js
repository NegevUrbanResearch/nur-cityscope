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
});

test("remote-styles: navigation place-search label stays accessible but visually hidden", () => {
  const css = readRemoteStyles();
  const label = cssBlock(css, ".place-search-label");

  expect(label).toMatch(/position:\s*absolute/);
  expect(label).toMatch(/width:\s*1px/);
  expect(label).toMatch(/height:\s*1px/);
  expect(label).toMatch(/overflow:\s*hidden/);
  expect(label).toMatch(/clip-path:\s*inset\(50%\)/);
});
