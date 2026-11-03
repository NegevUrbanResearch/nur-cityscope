import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { buildIntegratedRoute } from "../../frontend/src/map-utils/pink-line-route.js";

const fixture = JSON.parse(
  readFileSync(
    path.join(__dirname, "../fixtures/pink-route-colab-golden.json"),
    "utf8",
  ),
);

function round6(seg) {
  return seg.map((p) => [Number(p[0].toFixed(6)), Number(p[1].toFixed(6))]);
}

function norm(segs) {
  return segs.map((s) => round6(s));
}

describe("pink-line-route Colab golden", () => {
  for (const c of fixture.cases) {
    it(c.name, () => {
      const { solid, removed, dashed } = buildIntegratedRoute(
        c.basePaths,
        c.userPoints,
      );
      expect(norm(solid)).toEqual(norm(c.expected.solid));
      expect(norm(removed)).toEqual(norm(c.expected.removed));
      expect(norm(dashed)).toEqual(norm(c.expected.dashed));
    });
  }
});
