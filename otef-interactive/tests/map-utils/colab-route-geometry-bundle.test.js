import { describe, expect, test } from "vitest";
import { parseColabRouteGeometryBundle } from "../../frontend/src/map-utils/colab-route-geometry-bundle.js";

describe("parseColabRouteGeometryBundle", () => {
  test("rejects unsupported detour_export_version", () => {
    const raw = {
      detour_export_version: 999,
      integrated_route: { solid: [], removed: [] },
      detour_paint: { road: [], offroad: [], junctions: [] },
    };
    const out = parseColabRouteGeometryBundle(raw);
    expect(out.ok).toBe(false);
  });

  test("accepts detour_export_version as string \"1\"", () => {
    const raw = {
      detour_export_version: "1",
      integrated_route: { solid: [], removed: [] },
      detour_paint: { road: [], offroad: [], junctions: [] },
    };
    const out = parseColabRouteGeometryBundle(raw);
    expect(out.ok).toBe(true);
  });

  test("flips wire [lng,lat] polyline to [lat,lng] for internal use", () => {
    const raw = {
      detour_export_version: 1,
      integrated_route: {
        solid: [{ coordinates: [[34.0, 31.0], [34.01, 31.01]] }],
        removed: [],
      },
      detour_paint: { road: [], offroad: [], junctions: [] },
    };
    const out = parseColabRouteGeometryBundle(raw);
    expect(out.ok).toBe(true);
    expect(out.integratedRoute.solid[0]).toEqual([
      [31.0, 34.0],
      [31.01, 34.01],
    ]);
  });
});
