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

describe("buildColabAlignedCuratedOverlayGeoJSON off-road", () => {
  it("includes pink_offroad_segment for long edges on stored pink_line_route", () => {
    const geojson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [34.2, 31.2] },
        },
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
      ],
    };
    const basePaths = [[[31, 34], [31.05, 34.05], [32, 35.5]]];
    const out = buildColabAlignedCuratedOverlayGeoJSON(basePaths, geojson, "#F472B6");
    const off = (out.features || []).filter(
      (f) => f?.properties?.curated_overlay_role === "pink_offroad_segment",
    );
    expect(off.length).toBeGreaterThan(0);
    expect(off[0].geometry.type).toBe("LineString");
  });
});
