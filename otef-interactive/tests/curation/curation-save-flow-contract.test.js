const fs = require("fs");
const path = require("path");

const CURATION_SRC_DIR = path.resolve(__dirname, "../../frontend/src/curation");

function readCurationWorkspaceSource() {
  const files = [
    "curation.js",
    "curation-api.js",
    "curation-state.js",
    "curation-submissions.js",
    "curation-published-layers.js",
  ];
  return files
    .map((f) => fs.readFileSync(path.join(CURATION_SRC_DIR, f), "utf8"))
    .join("\n");
}

function readCurationSource() {
  return fs.readFileSync(path.join(CURATION_SRC_DIR, "curation.js"), "utf8");
}

function readCurationHtml() {
  return fs.readFileSync(
    path.resolve(__dirname, "../../frontend/curation.html"),
    "utf8",
  );
}

test("curation refresh is manual-only (no polling interval)", () => {
  const src = readCurationWorkspaceSource();
  expect(src.includes("setInterval(refresh, 30000)")).toBe(false);
});

test("submission list loads from all-submissions API (searchable list, no project merge)", () => {
  const workspace = readCurationWorkspaceSource();
  expect(workspace.includes("const optionLabel = `${project.name} - ${displayName}`;")).toBe(
    false,
  );
  expect(workspace.includes("API.submissionsAll(")).toBe(true);
  expect(workspace.includes("createSubmissionsPanel(")).toBe(true);
  const subs = fs.readFileSync(
    path.join(CURATION_SRC_DIR, "curation-submissions.js"),
    "utf8",
  );
  expect(subs.includes("curation-chip-type")).toBe(true);
  expect(subs.includes("has_history")).toBe(true);
});

test("curation sidebar title is plain submissions", () => {
  const html = readCurationHtml();
  expect(html.includes("<h2>Submissions</h2>")).toBe(true);
  expect(html.includes("Submissions (combined)")).toBe(false);
  expect(html.includes('id="curationSubmissionTypeBadge"')).toBe(false);
  expect(html.includes('id="curationSubmissionSelectedTags"')).toBe(true);
  expect(html.includes('id="curationPublishSaveGroup"')).toBe(false);
  expect(html.includes('id="curationHistoryFilter"')).toBe(false);
  expect(html.includes('id="curationUnpublishAll"')).toBe(true);
  expect(html.includes('id="curationShowOldRevisions"')).toBe(false);
  expect(html.includes('id="curationShowCurrent"')).toBe(false);
  expect(html.includes('id="curationShowHistory"')).toBe(false);
});

test("features load requests current revisions only (no history list in simplified UI)", () => {
  const orch = readCurationSource();
  expect(orch.includes("includeCurrent: true")).toBe(true);
  expect(orch.includes("includeHistory: false")).toBe(true);
});

test("history filter persisted state uses showOldRevisions", () => {
  const state = fs.readFileSync(
    path.join(CURATION_SRC_DIR, "curation-state.js"),
    "utf8",
  );
  expect(state.includes("showOldRevisions")).toBe(true);
  expect(state.includes("setHistoryFilterState")).toBe(true);
});

test("publish payload builder still drops history revisions (is_current === false)", () => {
  const orch = readCurationSource();
  const publishGeojson = fs.readFileSync(
    path.join(CURATION_SRC_DIR, "curation-publish-geojson.js"),
    "utf8",
  );
  expect(orch.includes("buildPublishGeojsonFromApiFeatures")).toBe(true);
  expect(publishGeojson.includes("is_current === false")).toBe(true);
});

test("batch edit endpoint path exists", () => {
  const src = fs.readFileSync(path.join(CURATION_SRC_DIR, "curation-api.js"), "utf8");
  expect(src.includes('"/api/supabase/curated/edit-batch/"')).toBe(true);
});

test("compute route endpoint path is centralized and declared once", () => {
  const src = fs.readFileSync(path.join(CURATION_SRC_DIR, "curation-api.js"), "utf8");
  expect(src.includes('export const CURATED_ROUTE_COMPUTE_PATH = "/api/supabase/curated/compute-route/";')).toBe(
    true,
  );
  const occurrences = (src.match(/\/api\/supabase\/curated\/compute-route\//g) || []).length;
  expect(occurrences).toBe(1);
  expect(src.includes("fetch(CURATED_ROUTE_COMPUTE_PATH, {")).toBe(true);
});

test("published layers primary list only includes active GIS-backed layer ids", () => {
  const src = fs.readFileSync(path.join(CURATION_SRC_DIR, "curation-published-layers.js"), "utf8");
  expect(src.includes("activeById.has(String(layer.id))")).toBe(true);
  expect(src.includes("curation-published-layer-card")).toBe(true);
  expect(src.includes("derivePublishedLayerUiFields")).toBe(true);
});

test("editFeaturePosition uses raw text and surfaces path/status for failures", () => {
  const src = fs.readFileSync(path.join(CURATION_SRC_DIR, "curation-api.js"), "utf8");
  expect(src.includes("await r.text()")).toBe(true);
  expect(src.includes("Failed to save edit [")).toBe(true);
  expect(src.includes("[curation] editFeaturePosition failed")).toBe(true);
});

test("unpublish all refreshes submissions list with preserveOnError after bulk remove", () => {
  const orch = readCurationSource();
  expect(orch.includes("loadSubmissions({ preserveOnError: true })")).toBe(true);
});

test("features API supports current/history filters", () => {
  const src = fs.readFileSync(path.join(CURATION_SRC_DIR, "curation-api.js"), "utf8");
  expect(src.includes("include_current")).toBe(true);
  expect(src.includes("include_history")).toBe(true);
});

test("curation orchestration has no feature metadata modal wiring", () => {
  const orch = readCurationSource();
  expect(orch.includes("saveFeatureModal")).toBe(false);
  expect(orch.includes("curationModalFeature")).toBe(false);
});

test("dead workshop map preview module file is removed", () => {
  const p = path.join(CURATION_SRC_DIR, "curation" + "-map-preview.js");
  expect(fs.existsSync(p)).toBe(false);
});

test("curation orchestrator does not import map preview", () => {
  const orch = readCurationSource();
  expect(orch.includes("curation" + "-map-preview")).toBe(false);
  expect(orch.includes("createCurationMapPreview")).toBe(false);
});
