import { describe, expect, it } from "vitest";
import {
  buildRouteSettlementCollisionIndex,
  deriveAchievedSettlementOutlineIds,
} from "../../frontend/src/shared/nli-route-settlement-collisions.js";

const route = (objectId, coordinates, flowDirection = "forward") => ({
  type: "Feature",
  properties: { OBJECTID: objectId, flow_direction: flowDirection },
  geometry: { type: "LineString", coordinates },
});

const settlement = (outlineObjectId, geometry) => ({
  type: "Feature",
  properties: { outlineObjectId },
  geometry,
});

const square = (minX, maxX) => ({
  type: "Polygon",
  coordinates: [[
    [minX, -1], [maxX, -1], [maxX, 1], [minX, 1], [minX, -1],
  ]],
});

describe("route-to-settlement collision index", () => {
  it("indexes first contact progress for LineString routes and Polygon outlines", () => {
    const index = buildRouteSettlementCollisionIndex(
      [route(10, [[0, 0], [2, 0], [10, 0]])],
      [settlement(20, square(4, 6))],
    );

    expect(index.get("10")).toEqual([
      { outlineObjectId: "20", progress: 0.4 },
    ]);
  });

  it("uses the first contacted member of a MultiPolygon", () => {
    const geometry = {
      type: "MultiPolygon",
      coordinates: [square(7, 8).coordinates, square(3, 4).coordinates],
    };
    const index = buildRouteSettlementCollisionIndex(
      [route(11, [[0, 0], [10, 0]])],
      [settlement(21, geometry)],
    );

    expect(index.get("11")).toEqual([
      { outlineObjectId: "21", progress: 0.3 },
    ]);
  });

  it("omits settlements with no boundary collision", () => {
    const index = buildRouteSettlementCollisionIndex(
      [route(12, [[0, 3], [10, 3]])],
      [settlement(22, square(4, 6))],
    );

    expect(index.get("12")).toEqual([]);
  });

  it("measures first contact along reviewed reverse feature orientation", () => {
    const index = buildRouteSettlementCollisionIndex(
      [route(13, [[0, 0], [10, 0]], "reverse")],
      [settlement(23, square(2, 3))],
    );

    expect(index.get("13")).toEqual([
      { outlineObjectId: "23", progress: 0.7 },
    ]);
  });

  it("uses the renderer's latitude-adjusted path metric for collision progress", () => {
    const index = buildRouteSettlementCollisionIndex(
      [route(14, [[0, 60], [10, 60], [10, 65]])],
      [settlement(24, {
        type: "Polygon",
        coordinates: [[[5, 59], [6, 59], [6, 61], [5, 61], [5, 59]]],
      })],
    );

    expect(index.get("14")[0].progress).toBeCloseTo(0.25, 2);
  });
});

describe("settlement outline achievement", () => {
  it("unions achieved polygon associations and reached route collisions", () => {
    const achieved = deriveAchievedSettlementOutlineIds({
      achievedPolygonBeats: [400],
      polygonFeatures: [{ properties: { timeline_minutes: 400, מיקום: "A" } }],
      locationToOutlineObjectId: new Map([["A", 30]]),
      collisionIndex: new Map([
        ["1", [{ outlineObjectId: "31", progress: 0.25 }]],
        ["2", [{ outlineObjectId: "32", progress: 0.75 }]],
      ]),
      completedRouteFeatures: [route(1, [[0, 0], [1, 0]])],
      activeRouteFeatures: [route(2, [[0, 0], [1, 0]])],
      activeRouteProgress: 0.8,
    });

    expect([...achieved].sort()).toEqual(["30", "31", "32"]);
  });

  it("does not let route geometry activate investigation polygons", () => {
    const achieved = deriveAchievedSettlementOutlineIds({
      achievedPolygonBeats: [],
      polygonFeatures: [{ properties: { timeline_minutes: 400, מיקום: "A" } }],
      locationToOutlineObjectId: { A: 30 },
      collisionIndex: new Map([["1", [{ outlineObjectId: "31", progress: 0.25 }]]]),
      activeRouteFeatures: [route(1, [[0, 0], [1, 0]])],
      activeRouteProgress: 0.5,
    });

    expect([...achieved]).toEqual(["31"]);
  });
});
