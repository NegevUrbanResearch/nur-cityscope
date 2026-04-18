import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import MapProjectionConfig from "../../frontend/src/shared/map-projection-config.js";
import {
  findOffroadTwoPointSegments,
  haversineMeters,
  parsePinkLineRouteFromGeojson,
  resolveFirstDisplayColorFromGeojson,
  sanitizeDisplayColorHex,
} from "../../frontend/src/map/leaflet-curated-pink-helpers.js";
import { OFFICIAL_NETWORK_GAP_METERS } from "../../frontend/src/map-utils/pink-route-map-styles.js";

describe("leaflet-curated-pink-helpers", () => {
  it("parsePinkLineRouteFromGeojson maps GeoJSON lng,lat to Leaflet lat,lng paths", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { feature_type: "other" },
          geometry: { type: "LineString", coordinates: [[1, 2], [3, 4]] },
        },
        {
          type: "Feature",
          properties: { feature_type: "pink_line_route", display_color: "#ABCDEF" },
          geometry: {
            type: "LineString",
            coordinates: [
              [34.0, 31.0],
              [34.001, 31.0],
            ],
          },
        },
      ],
    };
    const { feature, pathsLatLng } = parsePinkLineRouteFromGeojson(fc);
    expect(feature?.properties?.feature_type).toBe("pink_line_route");
    expect(pathsLatLng).toHaveLength(1);
    expect(pathsLatLng[0]).toEqual([
      [31.0, 34.0],
      [31.0, 34.001],
    ]);
  });

  it("parsePinkLineRouteFromGeojson returns first pink_line_route only", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { feature_type: "pink_line_route" },
          geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
        },
        {
          type: "Feature",
          properties: { feature_type: "pink_line_route" },
          geometry: { type: "LineString", coordinates: [[2, 2], [3, 3]] },
        },
      ],
    };
    const { pathsLatLng } = parsePinkLineRouteFromGeojson(fc);
    expect(pathsLatLng[0][0]).toEqual([0, 0]);
  });

  it("resolveFirstDisplayColorFromGeojson picks first sanitized display_color", () => {
    const fc = {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { display_color: "nope" }, geometry: { type: "Point", coordinates: [0, 0] } },
        { type: "Feature", properties: { display_color: "#aabbcc" }, geometry: { type: "Point", coordinates: [1, 1] } },
      ],
    };
    expect(resolveFirstDisplayColorFromGeojson(fc)).toBe("#AABBCC");
  });

  it("sanitizeDisplayColorHex normalizes valid 6-digit hex", () => {
    expect(sanitizeDisplayColorHex("#00ffaa")).toBe("#00FFAA");
    expect(sanitizeDisplayColorHex("#00ff")).toBe(null);
  });

  it("haversineMeters is ~111km for one degree latitude", () => {
    const m = haversineMeters(0, 0, 1, 0);
    expect(m).toBeGreaterThan(110000);
    expect(m).toBeLessThan(111400);
  });

  it("findOffroadTwoPointSegments flags edges longer than gap", () => {
    const paths = [[[0, 0], [1, 0]]];
    const segs = findOffroadTwoPointSegments(paths, OFFICIAL_NETWORK_GAP_METERS);
    expect(segs.length).toBe(1);
    expect(segs[0].length).toBe(2);
  });
});

describe("map-projection-config curated off-road default", () => {
  it("ENABLE_CURATED_OFFROAD_SPLIT defaults true for GIS + projection parity", () => {
    expect(MapProjectionConfig.ENABLE_CURATED_OFFROAD_SPLIT).toBe(true);
  });
});

describe("leaflet-curated-layer-loader Task 5 wiring", () => {
  it("loader imports Colab stack symbols and supports opts.force", async () => {
    const mod = await import("../../frontend/src/map/leaflet-curated-layer-loader.js");
    expect(typeof mod.loadCuratedLayerFromAPI).toBe("function");
    const src = readFileSync("frontend/src/map/leaflet-curated-layer-loader.js", "utf8");
    expect(src).toContain("extractPinkDetourPointFeatures");
    expect(src).toContain("routeLineStylesForDisplayColor");
    expect(src).toContain("STORED_PINK_ROUTE_OFFROAD_GAP_METERS");
    expect(src).toContain("opts.force");
    expect(src).toContain("ENABLE_CURATED_OFFROAD_SPLIT");
    expect(src).toContain("planPinkCuratedOverlayLayers");
    expect(src).toContain("pink-curated-overlay-plan");
  });
});
