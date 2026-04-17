import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CURATION_HTML_PATH = path.resolve(__dirname, "../../frontend/curation.html");
const CURATION_JS_PATH = path.resolve(__dirname, "../../frontend/src/curation/curation.js");

function readCurationHtml() {
  return fs.readFileSync(CURATION_HTML_PATH, "utf8");
}

function readCurationJs() {
  return fs.readFileSync(CURATION_JS_PATH, "utf8");
}

describe("curation publish dialog (HTML + source contracts)", () => {
  test("publish dialog is current-only (no history mode control)", () => {
    const html = readCurationHtml();
    expect(html.includes('id="curationModalPublish"')).toBe(true);
    expect(html.includes('id="curationPublishScopeNote"')).toBe(true);
    expect(html.includes("current revisions only")).toBe(true);
    expect(html.includes('id="curationPublishModeHistory"')).toBe(false);
    expect(html.includes("Current + history")).toBe(false);
    expect(html.includes('data-publish-mode="current_plus_history"')).toBe(false);
    expect(html.includes('type="radio"')).toBe(false);
    expect(html.includes("curation-publish-mode-option")).toBe(false);
  });

  test("layer name sync uses selected submission row from getSelectedSubmission", () => {
    const js = readCurationJs();
    expect(js.includes("syncLayerNameFromSelectedSubmission")).toBe(true);
    expect(js.includes("getSelectedSubmission")).toBe(true);
    expect(js.includes("onSelectionChange:")).toBe(true);
    expect(js.includes("syncLayerNameFromSelectedSubmission(id)")).toBe(true);
    expect(js.includes("layerNameInput()")).toBe(true);
  });

  test("publish uses getSelectedGeojson current-only default (history rows excluded from payload)", () => {
    const js = readCurationJs();
    expect(js.includes("function getSelectedGeojson(")).toBe(true);
    expect(js.includes("includeHistoryInPayload = false")).toBe(true);
    expect(js.includes("is_current === false")).toBe(true);
    expect(js.includes("publishSelectedCuratedLayer")).toBe(true);
    expect(js.includes("openPublishDialog")).toBe(true);
    expect(js.includes("confirmPublishFromDialog")).toBe(true);
    expect(js.includes('getAttribute("aria-pressed")')).toBe(false);
    expect(js.includes("setPublishModeSegmentState")).toBe(false);
  });
});
