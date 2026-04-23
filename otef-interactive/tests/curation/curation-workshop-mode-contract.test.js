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

describe("curation workshop mode (API + UI contracts)", () => {
  test("curation-api exposes workshop and unpublish-all helpers", () => {
    const api = readUtf8(CURATION_API_JS);
    expect(api.includes("async getWorkshopMode(")).toBe(true);
    expect(api.includes("/api/otef_viewport/by-table/")).toBe(true);
    expect(api.includes("async setWorkshopMode(")).toBe(true);
    expect(api.includes("workshop_auto_publish")).toBe(true);
    expect(api.includes('method: "PATCH"')).toBe(true);
    expect(api.includes("async unpublishAllCuratedLayers(")).toBe(true);
    expect(api.includes("/api/supabase/curated/unpublish-all/")).toBe(true);
  });

  test("curation.js wires workshop UI and uses API for unpublish-all", () => {
    const js = readUtf8(CURATION_JS);
    expect(js.includes("loadWorkshopModeUi")).toBe(true);
    expect(js.includes("onWorkshopModeToggle")).toBe(true);
    expect(js.includes("curationWorkshopAutoPublish")).toBe(true);
    expect(js.includes("API.getWorkshopMode")).toBe(true);
    expect(js.includes("API.setWorkshopMode")).toBe(true);
    expect(js.includes("API.unpublishAllCuratedLayers")).toBe(true);
    expect(js.includes('fetch("/api/supabase/curated/unpublish-all/')).toBe(false);
  });

  test("curation.html includes workshop auto-publish control", () => {
    const html = readUtf8(CURATION_HTML);
    expect(html.includes('id="curationWorkshopAutoPublish"')).toBe(true);
    expect(html.includes('data-i18n="curationWorkshopAutoPublish"')).toBe(true);
  });
});
