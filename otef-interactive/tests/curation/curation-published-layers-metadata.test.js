import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { chipClassForTag } from "../../frontend/src/curation/curation-submissions.js";
import { sanitizeCssColor } from "../../frontend/src/curation/curation-color-utils.js";
import {
  extractColorFromGeojsonData,
  extractInfoTagsFromGeojsonData,
  formatUpdatedAtForUi,
  getGeojsonDataFromGisLayerRecord,
  normalizeGisLayerGeojsonInput,
} from "../../frontend/src/curation/curation-published-layers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLISHED_SRC = path.resolve(__dirname, "../../frontend/src/curation/curation-published-layers.js");

describe("chipClassForTag (shared with published layer chips)", () => {
  test("maps Memorials and Tkuma Line to type classes; other labels stay neutral", () => {
    expect(chipClassForTag("Memorials")).toContain("type-memorial");
    expect(chipClassForTag("Tkuma Line")).toContain("type-moreshet");
    expect(chipClassForTag("Custom label")).toBe("curation-chip");
    expect(chipClassForTag("Custom label")).not.toContain("type-moreshet");
  });
});

describe("published layer metadata helpers", () => {
  test("extractColorFromGeojsonData reads stroke from first feature", () => {
    const c = extractColorFromGeojsonData({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { stroke: "#aabbcc" }, geometry: { type: "Point", coordinates: [0, 0] } },
      ],
    });
    expect(c).toBe("#aabbcc");
  });

  test("extractColorFromGeojsonData reads display_color from feature properties", () => {
    const c = extractColorFromGeojsonData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { display_color: "#00aa11" },
          geometry: { type: "Point", coordinates: [0, 0] },
        },
      ],
    });
    expect(c).toBe("#00aa11");
  });

  test("getGeojsonDataFromGisLayerRecord prefers data then geojson and parses JSON strings", () => {
    const fc = { type: "FeatureCollection", features: [] };
    expect(getGeojsonDataFromGisLayerRecord({ data: fc })).toBe(fc);
    expect(getGeojsonDataFromGisLayerRecord({ geojson: fc, data: null })).toBe(fc);
    expect(
      getGeojsonDataFromGisLayerRecord({
        data: JSON.stringify({ type: "FeatureCollection", features: [] }),
      }),
    ).toEqual({ type: "FeatureCollection", features: [] });
    expect(normalizeGisLayerGeojsonInput("not json")).toBe(null);
  });

  test("sanitizeCssColor rejects unsafe strings", () => {
    expect(sanitizeCssColor("#f00")).toBe("#f00");
    expect(sanitizeCssColor("rgb(1,2,3)")).toBe("rgb(1,2,3)");
    expect(sanitizeCssColor("rgb( 0 , 128 , 255 )")).toBe("rgb( 0 , 128 , 255 )");
    expect(sanitizeCssColor("rgba(0,0,0,0.5)")).toBe("rgba(0,0,0,0.5)");
    expect(sanitizeCssColor("rgba(0,0,0,.25)")).toBe("rgba(0,0,0,.25)");
    expect(sanitizeCssColor('url("evil")')).toBe(null);
    expect(sanitizeCssColor("expression(alert(1))")).toBe(null);
    expect(sanitizeCssColor('rgb(1,2,3);background:url("x")')).toBe(null);
    expect(sanitizeCssColor("rgb(256,0,0)")).toBe(null);
    expect(sanitizeCssColor("rgb(01,2,3)")).toBe(null);
    expect(sanitizeCssColor("rgba(0,0,0,2)")).toBe(null);
    expect(sanitizeCssColor("rgba(0,0,0,1e-3)")).toBe(null);
  });

  test("extractInfoTagsFromGeojsonData infers from geometry when no type_label", () => {
    expect(
      extractInfoTagsFromGeojsonData({
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
          },
        ],
      }),
    ).toEqual(["Tkuma Line"]);
    expect(
      extractInfoTagsFromGeojsonData({
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: [0, 0] },
          },
        ],
      }),
    ).toEqual(["Memorials"]);
  });

  test("extractInfoTagsFromGeojsonData uses type_label via submission tag rules", () => {
    expect(
      extractInfoTagsFromGeojsonData({
        features: [{ type: "Feature", properties: { type_label: "Memorials" }, geometry: null }],
      }),
    ).toEqual(["Memorials"]);
    expect(
      extractInfoTagsFromGeojsonData({
        features: [{ type: "Feature", properties: { type_label: "Mixed" }, geometry: null }],
      }),
    ).toEqual(["Tkuma Line", "Memorials"]);
  });

  test("extractInfoTagsFromGeojsonData ignores unrecognized type_label and uses geometry", () => {
    expect(
      extractInfoTagsFromGeojsonData({
        features: [
          {
            type: "Feature",
            properties: { type_label: "CustomOrUnknown" },
            geometry: { type: "Point", coordinates: [0, 0] },
          },
        ],
      }),
    ).toEqual(["Memorials"]);
    expect(
      extractInfoTagsFromGeojsonData({
        features: [
          {
            type: "Feature",
            properties: { type_label: "CustomOrUnknown" },
            geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
          },
        ],
      }),
    ).toEqual(["Tkuma Line"]);
    expect(
      extractInfoTagsFromGeojsonData({
        features: [
          {
            type: "Feature",
            properties: { type_label: "Central" },
            geometry: null,
          },
        ],
      }),
    ).toEqual([]);
  });

  test("formatUpdatedAtForUi returns em dash for missing/invalid", () => {
    expect(formatUpdatedAtForUi("")).toBe("—");
    expect(formatUpdatedAtForUi(null)).toBe("—");
    expect(formatUpdatedAtForUi("not-a-date")).toBe("—");
  });

  test("formatUpdatedAtForUi formats ISO timestamps", () => {
    const s = formatUpdatedAtForUi("2026-04-17T12:30:00.000Z");
    expect(s).not.toBe("—");
    expect(s.length).toBeGreaterThan(6);
  });
});

describe("published layers panel source contracts", () => {
  test("no debug foot row or loaded-submission success toast copy in template", () => {
    const src = fs.readFileSync(PUBLISHED_SRC, "utf8");
    expect(src.includes("curation-published-layer-foot")).toBe(false);
    expect(src.includes("Loaded submission ${sid}")).toBe(false);
    expect(src.includes('Loaded submission "${label}"')).toBe(false);
    expect(src.includes("getSubmissionDisplayName")).toBe(true);
    expect(src.includes("resolveSubmissionIdByDisplayName")).toBe(true);
  });
});
