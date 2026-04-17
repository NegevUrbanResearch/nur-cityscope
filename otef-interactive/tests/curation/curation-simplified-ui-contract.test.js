import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(__dirname, "../../frontend");
const CURATION_HTML = path.join(FRONTEND, "curation.html");
const CURATION_JS = path.join(FRONTEND, "src/curation/curation.js");
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
    expect(html.includes('id="curationFeatures"')).toBe(true);
    expect(html.includes('id="curationStatus"')).toBe(true);
    expect(html.includes('id="curationPublishModeHistory"')).toBe(false);
    expect(html.includes("Current + history")).toBe(false);
    expect(html.includes('id="curationPublishScopeNote"')).toBe(true);
  });

  test("curation.js loads features with current-only revisions and omits map / edit flows", () => {
    const js = readUtf8(CURATION_JS);
    const apiJs = readUtf8(CURATION_API_JS);
    expect(js.includes("includeHistory: false")).toBe(true);
    expect(js.includes("createCurationMapPreview")).toBe(false);
    expect(js.includes("curation-map-preview")).toBe(false);
    expect(js.includes("curationHistoryFilter")).toBe(false);
    expect(js.includes("openFeatureModal")).toBe(false);
    expect(js.includes("savePendingEdits")).toBe(false);
    expect(js.includes("curationUnpublishAll")).toBe(true);
    expect(js.includes("API.unpublishAllCuratedLayers")).toBe(true);
    expect(apiJs.includes("/api/supabase/curated/unpublish-all/")).toBe(true);
    expect(js.includes("curation-feature-row--pick")).toBe(true);
    expect(js.includes("curationPublishModeHistory")).toBe(false);
    expect(js.includes("setPublishModeSegmentState")).toBe(false);
    expect(js.includes("publishSelectedCuratedLayer")).toBe(true);
  });
});
