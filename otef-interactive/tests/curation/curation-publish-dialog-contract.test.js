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
  test("default publish option is Current only (segment pressed, history not)", () => {
    const html = readCurationHtml();
    expect(html.includes('id="curationPublishModeCurrent"')).toBe(true);
    expect(html.includes('id="curationPublishModeHistory"')).toBe(true);
    const currentIdx = html.indexOf('id="curationPublishModeCurrent"');
    const historyIdx = html.indexOf('id="curationPublishModeHistory"');
    expect(currentIdx).toBeGreaterThanOrEqual(0);
    expect(historyIdx).toBeGreaterThan(currentIdx);
    const sliceToHistory = html.slice(0, historyIdx);
    expect(/id="curationPublishModeCurrent"[\s\S]*?aria-pressed="true"/.test(sliceToHistory)).toBe(
      true,
    );
    expect(
      /id="curationPublishModeHistory"[\s\S]{0,160}aria-pressed="false"/.test(html),
    ).toBe(true);
  });

  test("publish dialog exposes segmented Current only and Current + history options", () => {
    const html = readCurationHtml();
    expect(html.includes('id="curationModalPublish"')).toBe(true);
    expect(html.includes("Current only")).toBe(true);
    expect(html.includes("Current + history")).toBe(true);
    expect(html.includes('data-publish-mode="current_only"')).toBe(true);
    expect(html.includes('data-publish-mode="current_plus_history"')).toBe(true);
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

  test("publish payload respects history inclusion flag on getSelectedGeojson", () => {
    const js = readCurationJs();
    expect(js.includes("function getSelectedGeojson(")).toBe(true);
    expect(js.includes("includeHistoryInPayload")).toBe(true);
    expect(js.includes("is_current === false")).toBe(true);
    expect(js.includes("publishWithOptions(")).toBe(true);
    expect(js.includes("openPublishDialog")).toBe(true);
    expect(js.includes('getAttribute("aria-pressed")')).toBe(true);
    expect(js.includes("setPublishModeSegmentState")).toBe(true);
  });
});
