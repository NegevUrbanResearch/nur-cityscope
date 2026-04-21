import { describe, it, expect, vi } from "vitest";

vi.mock("../../frontend/src/shared/map-projection-config.js", () => ({
  default: {
    ENABLE_CURATED_OFFROAD_SPLIT: true,
    ENABLE_MAP_LAYER_DEBUG: false,
    ENABLE_MAP_VISIBILITY_DEBUG: false,
    ENABLE_PROJECTION_DEBUG: false,
    LABEL_SIZE_SCALE: 0.25,
    PROJECTION_LERP_FACTOR: 0.15,
    PROJECTION_RESIZE_DEBOUNCE_MS: 200,
    PROJECTION_FULL_EXTENT_TOLERANCE: 10,
    WMTS_PROJECTOR: { zoomOverride: null, urlOverride: null },
  },
}));

import { buildColabAlignedCuratedOverlayGeoJSON } from "../../frontend/src/shared/curated-layer-service.js";

describe("pink node order on projection overlay", () => {
  it("assigns numeric pink_node_order to every pink_line_node Point in overlay output", () => {
    const basePaths = [[[31, 34], [31.05, 34.05], [32, 35.5]]];
    const geojson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { feature_type: "pink_line_route" },
          geometry: {
            type: "LineString",
            coordinates: [
              [34.0, 31.0],
              [35.5, 32.0],
            ],
          },
        },
        {
          type: "Feature",
          properties: { feature_type: "pink_line_node" },
          geometry: { type: "Point", coordinates: [34.2, 31.2] },
        },
        {
          type: "Feature",
          properties: { feature_type: "pink_line_node" },
          geometry: { type: "Point", coordinates: [35.0, 31.8] },
        },
      ],
    };
    const out = buildColabAlignedCuratedOverlayGeoJSON(basePaths, geojson, "#F472B6");
    expect(out).toBeTruthy();
    const nodes = (out.features || []).filter(
      (f) =>
        f?.geometry?.type === "Point" &&
        String(f?.properties?.feature_type || "") === "pink_line_node",
    );
    expect(nodes.length).toBeGreaterThan(0);
    for (const f of nodes) {
      expect(typeof f.properties.pink_node_order).toBe("number");
    }
  });
});
