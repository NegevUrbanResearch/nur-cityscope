import { describe, expect, it } from "vitest";
import {
  PROJECTION_HATCH_SEPARATION_MULTIPLIER,
  PROJECTION_HATCH_WIDTH_MULTIPLIER,
  projectionHatchRasterParams,
  quantizeProjectionHatchSeparation,
  quantizeProjectionHatchWidth,
} from "../frontend/src/shared/hatch-projection-presentation.js";

describe("hatch-projection-presentation (projection MapLibre only)", () => {
  it("uses separation multiplier 0.8 and width multiplier 1.0 for explicit tuning", () => {
    expect(PROJECTION_HATCH_SEPARATION_MULTIPLIER).toBe(0.8);
    expect(PROJECTION_HATCH_WIDTH_MULTIPLIER).toBe(1.0);
  });

  it("rounds separation and width to whole pixels (avoids subpixel antialiased stripes)", () => {
    const p = projectionHatchRasterParams({ separation: 10, width: 2 });
    expect(p.separation).toBe(8);
    expect(p.width).toBe(2);
  });

  it("clamps width and separation to at least 1", () => {
    expect(quantizeProjectionHatchSeparation(0.2)).toBe(1);
    expect(quantizeProjectionHatchWidth(0.3)).toBe(1);
  });

  it("defaults non-finite width in quantize to 1", () => {
    expect(quantizeProjectionHatchWidth(Number.NaN)).toBe(1);
  });
});
