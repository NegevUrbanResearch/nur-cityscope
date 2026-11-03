import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(__dirname, "../../frontend");
const CURATION_HTML = path.join(FRONTEND, "curation.html");
const CURATION_JS = path.join(FRONTEND, "src/curation/curation.js");
const CURATION_PUBLISH_GEOJSON_JS = path.join(FRONTEND, "src/curation/curation-publish-geojson.js");
const CURATION_API_JS = path.join(FRONTEND, "src/curation/curation-api.js");

function readUtf8(p) {
  return fs.readFileSync(p, "utf8");
}

describe("curation simplified UI (HTML + orchestration contracts)", () => {
  test("curation.html drops map, history filter, feature edit modal, and save-edits control", () => {
    const html = readUtf8(CURATION_HTML);
    expect(html.includes('id="curationMap"')).toBe(false);
    expect(html.includes("leaflet")).toBe(false);
    expect(html.includes('id="curationHistoryFilter"')).toBe(false);
    expect(html.includes('id="curationModalFeature"')).toBe(false);
    expect(html.includes('id="curationSaveEdits"')).toBe(false);
    expect(html.includes('id="curationPublishSaveGroup"')).toBe(false);
    expect(html.includes('id="curationUnpublishAll"')).toBe(true);
    expect(html.includes('id="curationSubmissionCombo"')).toBe(true);
    expect(html.includes('id="curationPublishedLayers"')).toBe(true);
    expect(html.includes("curation-published-layers")).toBe(true);
    expect(html.includes("max-width: 899px")).toBe(true);
    expect(html.includes(".curation-published-layers.curation-features")).toBe(true);
    expect(html.includes('id="curationFeatures"')).toBe(false);
    expect(html.includes('id="curationLayerName"')).toBe(false);
    expect(html.includes('id="curationStatus"')).toBe(true);
    expect(html.includes('id="curationPublishModeHistory"')).toBe(false);
    expect(html.includes("Current + history")).toBe(false);
    expect(html.includes('id="curationPublishScopeNote"')).toBe(false);
    expect(html.includes('id="curationModalPublish"')).toBe(false);
  });

  test("T27: curation.html has no h2 in submissions chrome or publish blocks; combo + publish remain", () => {
    const html = readUtf8(CURATION_HTML);
    expect((html.match(/<h2\b/gi) || []).length).toBe(0);
    expect(html.includes('id="curationSubmissionCombo"')).toBe(true);
    expect(html.includes('id="curationPublish"')).toBe(true);
    const bodyIdx = html.indexOf("<body");
    const fromBody = bodyIdx >= 0 ? html.slice(bodyIdx) : html;
    const comboIdx = fromBody.indexOf('id="curationSubmissionCombo"');
    const comboSlice = fromBody.slice(comboIdx, comboIdx + 8000);
    expect(comboSlice.includes("curation-submissions-toolbar")).toBe(false);
    expect((comboSlice.match(/<h2\b/gi) || []).length).toBe(0);
    const pubIdx = fromBody.indexOf('id="curationPublish"');
    expect(pubIdx).toBeGreaterThan(0);
    const publishBlock = fromBody.slice(
      Math.max(0, pubIdx - 400),
      fromBody.indexOf("</section>", pubIdx) + 12,
    );
    expect((publishBlock.match(/<h2\b/gi) || []).length).toBe(0);
  });

  test("T27: published section label is a div with role=heading (aria-level=2), not h2", () => {
    const html = readUtf8(CURATION_HTML);
    expect(html).toMatch(/class="curation-published-heading"[^>]*\brole="heading"/);
    expect(html).toMatch(/class="curation-published-heading"[^>]*\baria-level="2"/);
    expect((html.match(/<h2\b/gi) || []).length).toBe(0);
  });

  test("curation.js loads features with current-only revisions and omits map / edit flows", () => {
    const js = readUtf8(CURATION_JS);
    const publishGeojsonJs = readUtf8(CURATION_PUBLISH_GEOJSON_JS);
    const apiJs = readUtf8(CURATION_API_JS);
    expect(js.includes("includeHistory: false")).toBe(true);
    expect(js.includes("createCurationMapPreview")).toBe(false);
    expect(js.includes("curation" + "-map-preview")).toBe(false);
    expect(js.includes("curationHistoryFilter")).toBe(false);
    expect(js.includes("openFeatureModal")).toBe(false);
    expect(js.includes("savePendingEdits")).toBe(false);
    expect(js.includes("curationUnpublishAll")).toBe(true);
    expect(js.includes("API.unpublishAllCuratedLayers")).toBe(true);
    expect(apiJs.includes("/api/supabase/curated/unpublish-all/")).toBe(true);
    expect(js.includes("curation-feature-row--pick")).toBe(false);
    expect(js.includes("getPublishLayerNameFromSelection")).toBe(true);
    expect(js.includes("getSelectedSubmission")).toBe(true);
    expect(js.includes("buildPublishGeojsonFromApiFeatures")).toBe(true);
    expect(js.includes("curation-publish-geojson")).toBe(true);
    expect(publishGeojsonJs.includes("is_current === false")).toBe(true);
    expect(js.includes("curationPublishModeHistory")).toBe(false);
    expect(js.includes("setPublishModeSegmentState")).toBe(false);
    expect(js.includes("publishSelectedCuratedLayer")).toBe(true);
    expect(js.includes("remote controller Layers sheet")).toBe(false);
    expect(js.includes("curationPublishedSuccess")).toBe(true);
  });
});
