// otef-interactive/tests/map-utils/pink-line-route-mergepaths.test.js
import { describe, it, expect } from "vitest";
import { buildIntegratedRoute } from "../../frontend/src/map-utils/pink-line-route.js";

describe("mergePaths / heritage join", () => {
  it("does not create a huge jump when two axis runs meet with a tiny gap", () => {
    const basePaths = [
      [[32.0, 34.0], [32.0001, 34.0001]],
      [[32.0002, 34.0002], [32.0003, 34.0003]],
    ];
    const userPoints = [[32.00015, 34.00015]];
    const { solid, removed, dashed } = buildIntegratedRoute(basePaths, userPoints);
    const allSegs = [...solid, ...removed, ...dashed];
    const maxEdge = Math.max(
      ...allSegs.flatMap((seg) => {
        let m = 0;
        for (let i = 1; i < seg.length; i++) {
          const [a, b] = [seg[i - 1], seg[i]];
          const dx = a[0] - b[0];
          const dy = a[1] - b[1];
          m = Math.max(m, Math.hypot(dx, dy));
        }
        return [m];
      }),
    );
    expect(maxEdge).toBeLessThan(0.05);
  });
});
