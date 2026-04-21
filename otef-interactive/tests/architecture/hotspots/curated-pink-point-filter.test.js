import { describe, expect, test } from "vitest";

import { extractPinkDetourPointFeatures } from "../../../frontend/src/shared/curated-layer-service.js";

describe("extractPinkDetourPointFeatures", () => {
  test("excludes memorial central points; keeps pink_line_node for detour", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [34.78, 32.08] },
          properties: { feature_type: "central" },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [34.79, 32.09] },
          properties: { feature_type: "pink_line_node" },
        },
      ],
    };

    const detour = extractPinkDetourPointFeatures(fc);
    expect(detour).toHaveLength(1);
    expect(detour[0].feature.properties.feature_type).toBe("pink_line_node");
    expect(detour[0].latlng).toEqual([32.09, 34.79]);
  });
});
