import { describe, expect, test } from "vitest";
import { clipPinkBasePathsExcludingRemoved } from "../../frontend/src/map-utils/pink-line-route.js";

describe("clipPinkBasePathsExcludingRemoved", () => {
  test("splits one heritage segment when removed is a contiguous vertex subpath", () => {
    // Steps must stay within MAX_HERITAGE_GAP_METERS (~3.5 km) so normalizeHeritageSegments
    // keeps a single run (otherwise singleton vertices are dropped and clipping yields []).
    const base = [
      [31.0, 34.0],
      [31.0001, 34.0001],
      [31.0002, 34.0002],
      [31.0003, 34.0003],
    ];
    const removed = [
      [31.0001, 34.0001],
      [31.0002, 34.0002],
    ];
    const out = clipPinkBasePathsExcludingRemoved([base], [removed]);
    expect(out.length).toBe(2);
    expect(out[0]).toEqual([
      [31.0, 34.0],
      [31.0001, 34.0001],
    ]);
    expect(out[1]).toEqual([
      [31.0002, 34.0002],
      [31.0003, 34.0003],
    ]);
  });

  test("returns full paths when removed does not match any vertex run", () => {
    const base = [
      [31.0, 34.0],
      [31.0001, 34.0001],
    ];
    const removed = [[40, 35]];
    const out = clipPinkBasePathsExcludingRemoved([base], [removed]);
    expect(out.length).toBe(1);
    expect(out[0]).toEqual(base);
  });

  test("clips when removed is densified / not on pack vertices (projection fallback)", () => {
    const base = [
      [31.0, 34.0],
      [31.0001, 34.0001],
      [31.0002, 34.0002],
      [31.0003, 34.0003],
    ];
    // Midpoints along edges — fails strict subpath match, still lies on the polyline for projection
    const removed = [
      [31.00005, 34.00005],
      [31.00015, 34.00015],
      [31.00025, 34.00025],
    ];
    const out = clipPinkBasePathsExcludingRemoved([base], [removed]);
    expect(out.length).toBe(2);
    expect(out[0].length).toBeGreaterThanOrEqual(2);
    expect(out[1].length).toBeGreaterThanOrEqual(2);
  });

  test("no-op when removed list is empty", () => {
    const base = [
      [31.0, 34.0],
      [31.0001, 34.0001],
    ];
    const out = clipPinkBasePathsExcludingRemoved([base], []);
    expect(out).toEqual([base]);
  });
});
