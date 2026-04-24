import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { itmBboxToWgs84SwNe } from "../../frontend/src/map-utils/itm-bbox-to-wgs84-bounds.js";

describe("itmBboxToWgs84SwNe", () => {
  beforeEach(() => {
    globalThis.proj4 = vi.fn((from, to, xy) => {
      void from;
      void to;
      const [x, y] = xy;
      return [x + 0.001 * y, y + 0.001 * x];
    });
  });
  afterEach(() => {
    delete globalThis.proj4;
  });

  it("projects four ITM corners and returns axis-aligned WGS84 hull", () => {
    const bbox = [100_000, 500_000, 101_000, 501_000];
    const hull = itmBboxToWgs84SwNe(bbox);
    expect(globalThis.proj4).toHaveBeenCalledTimes(4);
    expect(globalThis.proj4.mock.calls.slice(0, 4).map((call) => call[2])).toEqual([
      [100_000, 500_000],
      [101_000, 500_000],
      [101_000, 501_000],
      [100_000, 501_000],
    ]);
    expect(hull).toHaveLength(4);
    const [w, s, e, n] = hull;
    expect(w <= e).toBe(true);
    expect(s <= n).toBe(true);
    const sw = globalThis.proj4.mock.results[0].value;
    const ne = globalThis.proj4.mock.results[2].value;
    const naiveW = Math.min(sw[0], ne[0]);
    const naiveE = Math.max(sw[0], ne[0]);
    const naiveS = Math.min(sw[1], ne[1]);
    const naiveN = Math.max(sw[1], ne[1]);
    expect(w).toBeLessThanOrEqual(naiveW + 1e-9);
    expect(e).toBeGreaterThanOrEqual(naiveE - 1e-9);
    expect(s).toBeLessThanOrEqual(naiveS + 1e-9);
    expect(n).toBeGreaterThanOrEqual(naiveN - 1e-9);
  });

  it("returns null when proj4 missing or bbox invalid", () => {
    delete globalThis.proj4;
    expect(itmBboxToWgs84SwNe([0, 0, 1, 1])).toBeNull();
    globalThis.proj4 = vi.fn(() => [0, 0]);
    expect(itmBboxToWgs84SwNe(null)).toBeNull();
    expect(itmBboxToWgs84SwNe([0, 0, Number.NaN, 1])).toBeNull();
  });

  it("returns null when proj4 returns non-finite coordinates", () => {
    globalThis.proj4 = vi
      .fn(() => [0, 0])
      .mockImplementationOnce(() => [Number.NaN, 1]);
    expect(itmBboxToWgs84SwNe([100_000, 500_000, 101_000, 501_000])).toBeNull();
  });

  it("returns null when proj4 throws on first call", () => {
    globalThis.proj4 = vi.fn().mockImplementationOnce(() => {
      throw new Error("proj4 projection failed");
    });
    expect(itmBboxToWgs84SwNe([0, 0, 1, 1])).toBeNull();
  });
});
