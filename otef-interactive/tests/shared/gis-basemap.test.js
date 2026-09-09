import { describe, expect, test } from "vitest";
import {
  GIS_BASEMAP_IDS,
  isGisBasemapId,
  isSatelliteBasemap,
  normalizeGisBasemap,
} from "../../frontend/src/shared/gis-basemap.js";

describe("normalizeGisBasemap", () => {
  test("keeps allowlisted ids and falls back unknown values to osm", () => {
    expect(GIS_BASEMAP_IDS).toEqual([
      "osm",
      "satellite",
      "satellite_bw",
      "dark",
    ]);
    expect(normalizeGisBasemap("osm")).toBe("osm");
    expect(normalizeGisBasemap("satellite")).toBe("satellite");
    expect(normalizeGisBasemap("satellite_bw")).toBe("satellite_bw");
    expect(normalizeGisBasemap("dark")).toBe("dark");
    expect(normalizeGisBasemap("terrain")).toBe("osm");
    expect(normalizeGisBasemap(null)).toBe("osm");
    expect(isGisBasemapId("dark")).toBe(true);
    expect(isGisBasemapId("terrain")).toBe(false);
  });

  test("identifies both satellite basemap variants", () => {
    expect(isSatelliteBasemap("satellite")).toBe(true);
    expect(isSatelliteBasemap("satellite_bw")).toBe(true);
    expect(isSatelliteBasemap("dark")).toBe(false);
  });
});
