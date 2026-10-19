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

/**
 * Regression: `.remote-tab-panel { display:flex }` must not keep `[hidden]` panels
 * in the flex layout (UA [hidden] loses to author rules of equal-ish specificity).
 */
test("remote-styles: hidden tab panels are display:none (out of layout)", () => {
  const css = readRemoteStyles();
  expect(css).toMatch(/\.remote-tab-panel\[hidden\]\s*\{[^}]*display:\s*none/s);
});

test("remote-styles: National Library tab is placed at the left edge", () => {
  const css = readRemoteStyles();
  expect(css).toMatch(
    /\.remote-bottom-nav__tab\[data-remote-tab="curation"\]\s*\{[^}]*order:\s*-1/s,
  );
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

test("regular layer sheet does not host NLI panes, narrative controls, or timeline timers", () => {
  const css = readRemoteStyles();
  expect(css).not.toMatch(/\.nli-bottom-dock\s*\{/);
  expect(css).not.toMatch(/\.layers-variant-c--nli\s*\{/);
  expect(css).not.toMatch(/\.sheet-content--nli\s*\{/);
  expect(css).not.toMatch(/\.nli-pack-panes\s*\{/);
  expect(css).not.toMatch(/\.nli-narrative-sheet\s*\{/);
  expect(css).toMatch(/\.nli-tl-sheet\s*\{/);
  expect(css).toMatch(/\.nli-nova-escape-toggles\s*\{/);

  const source = fs.readFileSync(
    path.resolve(__dirname, "../../frontend/src/remote/layer-sheet-controller.js"),
    "utf8",
  );
  expect(source).not.toMatch(/nliPackPaneSwitchHtml|setNliPackPane|nliNarrativeControlsHtml|nliTimelineHostMethods/);
  expect(source).not.toMatch(/_subscribeDataContext\("investigationClock"/);
  expect(source).not.toMatch(/_syncNliPlayheadTicker|_syncNliEndedTimer|_ensureNliFeatureCache/);
  expect(source).toMatch(/group\.id !== "nli"/);
});

test("remote teardown destroys the LayerSheet-owned narrative lifecycle", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../frontend/src/remote/remote-controller.js"),
    "utf8",
  );
  expect(source).toMatch(/beforeunload[\s\S]*layerSheetController[\s\S]*\.destroy/);
});

test("National Library tab launches the staff remote page", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../frontend/src/remote/remote-controller.js"),
    "utf8",
  );
  expect(source).toMatch(/NLI_STAFF_REMOTE_HREF = "nli-staff-remote\.html"/);
  expect(source).toMatch(/LAUNCHER_REMOTE_TAB_KEYS = new Set\(\["curation"\]\)/);
  expect(source).toMatch(/searchParams\.set\("from", "remote"\)/);
});
