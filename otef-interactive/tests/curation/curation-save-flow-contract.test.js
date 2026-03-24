const fs = require("fs");
const path = require("path");

const CURATION_SRC_DIR = path.resolve(__dirname, "../../frontend/src/curation");

function readCurationWorkspaceSource() {
  const files = [
    "curation.js",
    "curation-api.js",
    "curation-state.js",
    "curation-map-preview.js",
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

test("dragging nodes does not write immediately to API", () => {
  const workspace = readCurationWorkspaceSource();
  expect(workspace.includes('marker.on("dragend", async')).toBe(true);
  expect(workspace.includes("{ preserveView: true }")).toBe(true);
  expect(
    workspace.includes("Moved node locally. Click 'Save source edits' to persist changes."),
  ).toBe(true);
  const orch = readCurationSource();
  expect(orch.includes("async function savePendingEdits()")).toBe(true);
  expect(orch.includes("await API.editFeaturesBatch(")).toBe(true);
  expect(orch.includes("for (const edit of group)")).toBe(true);
});

test("map preview ignores stale async showPreview runs (sequence guard)", () => {
  const src = fs.readFileSync(
    path.join(CURATION_SRC_DIR, "curation-map-preview.js"),
    "utf8",
  );
  expect(src.includes("showPreviewSeq")).toBe(true);
  expect(src.includes("if (mySeq !== showPreviewSeq) return")).toBe(true);
});

test("submission list is combined by submission id (no project prefix labels)", () => {
  const workspace = readCurationWorkspaceSource();
  expect(workspace.includes("const optionLabel = `${project.name} - ${displayName}`;")).toBe(
    false,
  );
  expect(workspace.includes("inferSubmissionTypeLabel(")).toBe(true);
  expect(workspace.includes("[${typeLabel}] ${displayName}")).toBe(true);
  expect(workspace.includes("submissionOrder.forEach((submissionId) => {")).toBe(true);
});

test("curation sidebar title is plain submissions", () => {
  const html = readCurationHtml();
  expect(html.includes("<h2>Submissions</h2>")).toBe(true);
  expect(html.includes("Submissions (combined)")).toBe(false);
  expect(html.includes('id="curationSubmissionTypeBadge"')).toBe(true);
  expect(html.includes('id="curationShowCurrent"')).toBe(true);
  expect(html.includes('id="curationShowHistory"')).toBe(true);
});

test("batch edit endpoint path exists", () => {
  const src = fs.readFileSync(path.join(CURATION_SRC_DIR, "curation-api.js"), "utf8");
  expect(src.includes('"/api/supabase/curated/edit-batch/"')).toBe(true);
});

test("published layers primary list only includes active GIS-backed layer ids", () => {
  const src = fs.readFileSync(path.join(CURATION_SRC_DIR, "curation-published-layers.js"), "utf8");
  expect(src.includes("activeById.has(String(layer.id))")).toBe(true);
});

test("editFeaturePosition uses raw text and surfaces path/status for failures", () => {
  const src = fs.readFileSync(path.join(CURATION_SRC_DIR, "curation-api.js"), "utf8");
  expect(src.includes("await r.text()")).toBe(true);
  expect(src.includes("Failed to save edit [")).toBe(true);
  expect(src.includes("[curation] editFeaturePosition failed")).toBe(true);
});

test("save flow surfaces backend warning payloads", () => {
  const orch = readCurationSource();
  expect(orch.includes("result && result.warning")).toBe(true);
  expect(orch.includes("Warning:")).toBe(true);
});

test("features API supports current/history filters", () => {
  const src = fs.readFileSync(path.join(CURATION_SRC_DIR, "curation-api.js"), "utf8");
  expect(src.includes("include_current")).toBe(true);
  expect(src.includes("include_history")).toBe(true);
});

test("modal feature save refreshes preview without resetting map bounds", () => {
  const orch = readCurationSource();
  expect(orch.includes("function saveFeatureModal()")).toBe(true);
  expect(orch.includes("mapCtl.showPreview(")).toBe(true);
  const block = orch.slice(orch.indexOf("function saveFeatureModal()"));
  expect(block.includes("{ preserveView: true }")).toBe(true);
});
