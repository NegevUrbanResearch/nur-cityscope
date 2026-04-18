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
import { routeLineStylesForDisplayColor } from "../../frontend/src/map-utils/pink-route-map-styles.js";

describe("projection planner halo + stroke (Colab parity)", () => {
  it("emits halo LineString then proposed stroke for each planner dashed segment when no stored route", () => {
    // Vertices must stay within MAX_HERITAGE_GAP_METERS so heritage normalization yields segments (plan sample coords are too sparse).
    const basePaths = [[[31, 34], [31.001, 34.001], [31.002, 34.002]]];
    const geojson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { feature_type: "pink_line_node" },
          geometry: { type: "Point", coordinates: [34.2, 31.2] },
        },
      ],
    };
    const styles = routeLineStylesForDisplayColor(null);
    const out = buildColabAlignedCuratedOverlayGeoJSON(basePaths, geojson, "#FF69B4");
    expect(out).toBeTruthy();
    const lines = (out.features || []).filter((f) => f?.geometry?.type === "LineString");
    const weights = lines.map((f) => f.properties?._curatedStyle?.weight).filter((w) => w != null);
    expect(weights).toContain(styles.proposedHalo.weight);
    expect(weights).toContain(styles.proposedLine.weight);
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });
});
