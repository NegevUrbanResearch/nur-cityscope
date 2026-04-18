import { describe, expect, test } from "vitest";
import { buildIntegratedRoute } from "../../frontend/src/map-utils/pink-line-route.js";

describe("buildIntegratedRoute removed (heritage base segments)", () => {
  test("returns solid, dashed, and removed; removed is empty when base or users missing", () => {
    expect(buildIntegratedRoute([], [])).toEqual({
      solid: [],
      dashed: [],
      removed: [],
    });

    const base = [
      [
        [32.0, 34.0],
        [32.01, 34.0],
      ],
    ];
    const noUsers = buildIntegratedRoute(base, []);
    expect(noUsers.removed).toEqual([]);
    expect(noUsers.dashed).toEqual([]);
    expect(noUsers.solid).toHaveLength(1);
  });

  test("when detour replaces multiple base edges, removed contains that base subpath with dashed matching endpoints", () => {
    const basePaths = [
      [
        [32.0, 34.0],
        [32.01, 34.0],
        [32.02, 34.0],
        [32.03, 34.0],
      ],
    ];
    const { dashed, removed } = buildIntegratedRoute(basePaths, [[32.015, 34.05]]);
    expect(removed).toHaveLength(1);
    expect(dashed).toHaveLength(1);
    const heritage = removed[0];
    const detour = dashed[0];
    expect(heritage.length).toBeGreaterThan(1);
    expect(detour[0]).toEqual(heritage[0]);
    expect(detour[detour.length - 1]).toEqual(heritage[heritage.length - 1]);
  });

  test("when best interval is a single base vertex, removed may be empty while dashed still has a detour", () => {
    const basePaths = [
      [
        [32.0, 34.0],
        [32.02, 34.0],
        [32.04, 34.0],
      ],
    ];
    const { dashed, removed } = buildIntegratedRoute(basePaths, [[32.02, 34.02]]);
    expect(removed).toEqual([]);
    expect(dashed.length).toBe(1);
    expect(dashed[0].length).toBeGreaterThanOrEqual(2);
  });
});
