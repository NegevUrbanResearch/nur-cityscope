import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { createCurationApi } from "../../frontend/src/curation/curation-api.js";
import { getSubmissionTagLabels } from "../../frontend/src/curation/curation-submissions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CURATION_HTML_PATH = path.resolve(__dirname, "../../frontend/curation.html");
const CURATION_SUBMISSIONS_SRC = path.resolve(
  __dirname,
  "../../frontend/src/curation/curation-submissions.js",
);

function readCurationHtml() {
  return fs.readFileSync(CURATION_HTML_PATH, "utf8");
}

function readCurationSubmissionsSource() {
  return fs.readFileSync(CURATION_SUBMISSIONS_SRC, "utf8");
}

describe("curation API submissionsAll", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("calls /api/supabase/submissions/ and returns array with required keys preserved", async () => {
    const row = {
      id: "00000000-0000-0000-0000-0000000000aa",
      name: "Batch A",
      type_label: "Memorials",
      has_history: true,
      has_current: true,
      extra_from_api: 42,
    };
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [row],
    });

    const api = createCurationApi();
    const out = await api.submissionsAll();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/supabase/submissions/");
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(row.id);
    expect(out[0].name).toBe(row.name);
    expect(out[0].type_label).toBe(row.type_label);
    expect(out[0].has_history).toBe(row.has_history);
    expect(out[0].has_current).toBe(row.has_current);
    expect(out[0].extra_from_api).toBe(42);
  });

  test("normalizes wrapped list shapes to an array", async () => {
    const inner = [
      {
        id: "x",
        name: "n",
        type_label: "Mixed",
        has_history: false,
        has_current: true,
      },
    ];
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ submissions: inner }),
    });
    const out = await createCurationApi().submissionsAll();
    expect(out).toEqual(inner);

    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ results: inner }),
    });
    const out2 = await createCurationApi().submissionsAll();
    expect(out2).toEqual(inner);
  });

  test("non-array success body yields empty array", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    const out = await createCurationApi().submissionsAll();
    expect(out).toEqual([]);
  });

  test("throws with server error message when not ok", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: "upstream failed" }),
    });
    await expect(createCurationApi().submissionsAll()).rejects.toThrow("upstream failed");
  });
});

describe("curation submissions list UI (HTML + source contracts)", () => {
  test("searchable submission combobox (single picker) exists in curation.html", () => {
    const html = readCurationHtml();
    expect(html.includes('id="curationSubmissionCombo"')).toBe(true);
    expect(html.includes('id="curationSubmissionSearch"')).toBe(true);
    expect(html.includes('id="curationSubmissionList"')).toBe(true);
    expect(html.includes('id="curationSubmission"')).toBe(true);
    expect(html.includes('id="curationSubmissionComboField"')).toBe(true);
    expect(html.includes('id="curationSubmissionSelectedTags"')).toBe(true);
    expect(html.includes('id="curationSubmissionSummary"')).toBe(false);
  });

  test("submissions module renders type chips (Tkuma Line / Memorials), not History", () => {
    const src = readCurationSubmissionsSource();
    expect(src.includes("curation-chip-type")).toBe(true);
    expect(src.includes("curation-chip-history")).toBe(false);
    expect(src.includes("getSubmissionTagLabels")).toBe(true);
    expect(src.includes("Tkuma Line")).toBe(true);
    expect(src.includes("Memorials")).toBe(true);
    expect(src.includes("has_history")).toBe(true);
    expect(src.includes("submissionsAll")).toBe(true);
    expect(src.includes("getSelectedSubmission")).toBe(true);
    expect(src.includes("syncSelectedTagsUi")).toBe(true);
    expect(src.includes("getSelectedTagsContainer")).toBe(true);
    expect(src.includes("preserveOnError")).toBe(true);
  });

  test("getSubmissionTagLabels never adds History (hasHistory ignored for UI tags)", () => {
    expect(
      getSubmissionTagLabels({
        typeLabel: "Mixed",
        hasHistory: true,
      }),
    ).toEqual(["Tkuma Line", "Memorials"]);
    expect(
      getSubmissionTagLabels({
        typeLabel: "Memorials",
        hasHistory: true,
      }),
    ).toEqual(["Memorials"]);
    expect(
      getSubmissionTagLabels({
        typeLabel: "Tkuma Line",
        hasHistory: false,
      }),
    ).toEqual(["Tkuma Line"]);
    expect(
      getSubmissionTagLabels({
        typeLabel: "Mixed",
        hasHistory: true,
      }).some((t) => String(t).toLowerCase().includes("history")),
    ).toBe(false);
  });

  test("closed combobox lays out selected name and tags on one row", () => {
    const html = readCurationHtml();
    expect(html.includes("has-selected-tags")).toBe(true);
    expect(
      html.includes("tag chips on the left, submission name (search) on the right"),
    ).toBe(true);
    const idx = html.indexOf(".curation-submission-combo-field.has-selected-tags");
    expect(idx).toBeGreaterThan(0);
    const slice = html.slice(idx, idx + 1100);
    expect(slice.includes("flex-direction: row-reverse")).toBe(true);
    expect(slice.includes(".curation-submission-selected-tags")).toBe(true);
  });

  test("legacy submission edit control and modal removed from HTML", () => {
    const html = readCurationHtml();
    expect(html.includes('id="curationEditSubmission"')).toBe(false);
    expect(html.includes("curationModalSubmission")).toBe(false);
    expect(html.includes('id="curationModalSubmissionName"')).toBe(false);
  });
});
