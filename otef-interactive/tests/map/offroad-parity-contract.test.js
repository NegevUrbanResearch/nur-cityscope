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

describe("off-road parity contract", () => {
  it("includes pink_offroad_junction Point features when off-road split is on", () => {
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
      ],
    };
    const out = buildColabAlignedCuratedOverlayGeoJSON(
      [],
      geojson,
      "#FF69B4",
    );
    const junctions = (out.features || []).filter(
      (f) =>
        f?.geometry?.type === "Point" &&
        f?.properties?.curated_overlay_role === "pink_offroad_junction",
    );
    expect(junctions.length).toBeGreaterThan(0);
  });
});
