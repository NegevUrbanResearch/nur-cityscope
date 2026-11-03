import { describe, it, expect } from "vitest";
import { optimizePinkNodeVisitOrder } from "../../frontend/src/map-utils/pink-route-optimizer.js";

describe("optimizePinkNodeVisitOrder", () => {
  it("returns same order for 0–2 nodes", () => {
    expect(optimizePinkNodeVisitOrder([]).length).toBe(0);
    const one = [{ id: "a", lat: 31, lng: 34 }];
    expect(optimizePinkNodeVisitOrder(one).map((n) => n.id)).toEqual(["a"]);
    const two = [
      { id: "x", lat: 31.0, lng: 34.0 },
      { id: "y", lat: 31.01, lng: 34.01 },
    ];
    expect(optimizePinkNodeVisitOrder(two).map((n) => n.id)).toEqual([
      "x",
      "y",
    ]);
  });

  // Colab `routeOptimizer.ts` insertionHeuristic trace for this input order (c,a,b).
  it("three-node golden order (replace expected if Colab trace differs)", () => {
    const nodes = [
      { id: "c", lat: 31.78, lng: 35.21 },
      { id: "a", lat: 31.76, lng: 35.19 },
      { id: "b", lat: 31.77, lng: 35.2 },
    ];
    expect(optimizePinkNodeVisitOrder(nodes).map((n) => n.id)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });
});
