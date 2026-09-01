import { describe, expect, it } from "vitest";
import {
  buildLinePathMetrics,
  buildLineProgressGradient,
  pointAtLineProgress,
} from "../../frontend/src/shared/maplibre-line-progress-primitives.js";

const EPSILON = 0.00015;

function gradientStops(expression) {
  return expression.slice(3).filter((_, index) => index % 2 === 0);
}

describe("maplibre line-progress primitives", () => {
  it("returns zero metrics for an empty path", () => {
    expect(buildLinePathMetrics([])).toEqual({ cumulative: [0], total: 0 });
  });

  it("returns zero metrics and the first point for a single-point path", () => {
    const coords = [[34, 31]];
    const metrics = buildLinePathMetrics(coords);

    expect(metrics).toEqual({ cumulative: [0], total: 0 });
    expect(pointAtLineProgress(coords, metrics, 0.5)).toEqual([34, 31]);
  });

  it("uses cumulative segment lengths for nonuniform paths", () => {
    const coords = [[0, 0], [3, 0], [3, 4]];
    const metrics = buildLinePathMetrics(coords);

    expect(metrics.cumulative).toEqual([0, 3, 7]);
    expect(metrics.total).toBe(7);
    expect(pointAtLineProgress(coords, metrics, 3 / 7)).toEqual([3, 0]);
    expect(pointAtLineProgress(coords, metrics, 0.5)).toEqual([3, 0.5]);
  });

  it("clamps progress outside a path to its endpoints", () => {
    const coords = [[0, 0], [10, 0]];
    const metrics = buildLinePathMetrics(coords);

    expect(pointAtLineProgress(coords, metrics, -1)).toEqual([0, 0]);
    expect(pointAtLineProgress(coords, metrics, 2)).toEqual([10, 0]);
  });

  it.each([0, EPSILON, 0.5, 1 - EPSILON, 1])(
    "builds strictly increasing gradient stops at fraction %s",
    (fraction) => {
      const expression = buildLineProgressGradient(fraction, "rgb(1,2,3)", "rgba(1,2,3,0)");
      const stops = gradientStops(expression);

      expect(expression.slice(0, 3)).toEqual(["interpolate", ["linear"], ["line-progress"]]);
      expect(stops[0]).toBe(0);
      expect(stops.at(-1)).toBe(1);
      expect(stops.every((stop, index) => index === 0 || stop > stops[index - 1])).toBe(true);
    },
  );

  it("keeps the opaque color through the reveal point and fades to transparent", () => {
    expect(buildLineProgressGradient(0.5, "rgb(1,2,3)", "rgba(1,2,3,0)")).toEqual([
      "interpolate",
      ["linear"],
      ["line-progress"],
      0,
      "rgb(1,2,3)",
      0.5,
      "rgb(1,2,3)",
      0.50015,
      "rgba(1,2,3,0)",
      1,
      "rgba(1,2,3,0)",
    ]);
  });
});
