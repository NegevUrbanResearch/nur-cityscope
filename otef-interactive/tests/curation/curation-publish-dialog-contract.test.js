import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CURATION_HTML_PATH = path.resolve(__dirname, "../../frontend/curation.html");
const CURATION_JS_PATH = path.resolve(__dirname, "../../frontend/src/curation/curation.js");
const CURATION_PUBLISH_GEOJSON_PATH = path.resolve(
  __dirname,
  "../../frontend/src/curation/curation-publish-geojson.js",
);

function readCurationHtml() {
  return fs.readFileSync(CURATION_HTML_PATH, "utf8");
}

function readCurationJs() {
  return fs.readFileSync(CURATION_JS_PATH, "utf8");
}

function readPublishGeojsonJs() {
  return fs.readFileSync(CURATION_PUBLISH_GEOJSON_PATH, "utf8");
}

describe("curation publish flow (HTML + source contracts)", () => {
  test("no publish confirmation modal (direct publish from toolbar)", () => {
    const html = readCurationHtml();
    expect(html.includes('id="curationModalPublish"')).toBe(false);
    expect(html.includes('id="curationPublishScopeNote"')).toBe(false);
    expect(html.includes('id="curationModalPublishConfirm"')).toBe(false);
    expect(html.includes('id="curationPublishModeHistory"')).toBe(false);
    expect(html.includes("Current + history")).toBe(false);
    expect(html.includes('data-publish-mode="current_plus_history"')).toBe(false);
    expect(html.includes("curation-publish-mode-option")).toBe(false);
  });

  test("layer name comes from selected submission row (getSelectedSubmission), not a text field", () => {
    const js = readCurationJs();
    expect(js.includes("getPublishLayerNameFromSelection")).toBe(true);
    expect(js.includes("getSelectedSubmission")).toBe(true);
    expect(js.includes("onSelectionChange:")).toBe(true);
    expect(js.includes("layerNameInput")).toBe(false);
    expect(js.includes("curationLayerName")).toBe(false);
  });

  test("publish loads full current-only GeoJSON from API and excludes history rows from payload", () => {
    const js = readCurationJs();
    const publishGeojsonJs = readPublishGeojsonJs();
    expect(js.includes("buildPublishGeojsonFromApiFeatures")).toBe(true);
    expect(js.includes("curation-publish-geojson")).toBe(true);
    expect(publishGeojsonJs.includes("export function buildPublishGeojsonFromApiFeatures")).toBe(true);
    expect(publishGeojsonJs.includes("is_current === false")).toBe(true);
    expect(js.includes("publishSelectedCuratedLayer")).toBe(true);
    expect(js.includes("API.features(")).toBe(true);
    expect(js.includes("includeHistory: false")).toBe(true);
    expect(js.includes("openPublishDialog")).toBe(false);
    expect(js.includes("confirmPublishFromDialog")).toBe(false);
    expect(js.includes('getAttribute("aria-pressed")')).toBe(false);
    expect(js.includes("setPublishModeSegmentState")).toBe(false);
  });
});
