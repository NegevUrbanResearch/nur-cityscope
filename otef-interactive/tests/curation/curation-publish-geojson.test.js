import { describe, expect, test } from "vitest";
import { buildPublishGeojsonFromApiFeatures } from "../../frontend/src/curation/curation-publish-geojson.js";

describe("buildPublishGeojsonFromApiFeatures", () => {
  test("drops rows explicitly marked not current", () => {
    const fc = buildPublishGeojsonFromApiFeatures([
      {
        geometry: { type: "Point", coordinates: [1, 2] },
        properties: { id: "a", is_current: false },
      },
      {
        geometry: { type: "Point", coordinates: [3, 4] },
        properties: { id: "b", is_current: true },
      },
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties.id).toBe("b");
  });

  test("keeps rows with is_current true or omitted", () => {
    const fc = buildPublishGeojsonFromApiFeatures([
      { geometry: { type: "Point", coordinates: [0, 0] }, properties: { id: "explicit", is_current: true } },
      { geometry: { type: "Point", coordinates: [1, 1] }, properties: { id: "implicit" } },
    ]);
    expect(fc.features.map((f) => f.properties.id).sort()).toEqual(["explicit", "implicit"]);
  });

  test("ignores null and non-object entries", () => {
    const fc = buildPublishGeojsonFromApiFeatures([
      null,
      "not-a-feature",
      { geometry: { type: "Point", coordinates: [2, 2] }, properties: { id: "ok" } },
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties.id).toBe("ok");
  });

  test("non-array input yields empty collection", () => {
    const fc = buildPublishGeojsonFromApiFeatures(null);
    expect(fc).toEqual({ type: "FeatureCollection", features: [] });
  });

  test("preserves collection-level CRS when provided", () => {
    const crs = { type: "name", properties: { name: "EPSG:2039" } };
    const fc = buildPublishGeojsonFromApiFeatures(
      [{ geometry: { type: "Point", coordinates: [219529.584, 626907.39] }, properties: { id: "itm" } }],
      { crs },
    );
    expect(fc.crs).toEqual(crs);
  });

  test("optional stamp adds display_color and submission_name on each feature", () => {
    const fc = buildPublishGeojsonFromApiFeatures(
      [
        {
          geometry: { type: "Point", coordinates: [34, 32] },
          properties: { id: "a" },
        },
      ],
      null,
      { display_color: "#FF69B4", submission_name: "Batch A" },
    );
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties.display_color).toBe("#FF69B4");
    expect(fc.features[0].properties.submission_name).toBe("Batch A");
  });
});

