import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildInvestigationSettlementIndexes } from "../../frontend/src/shared/nli-investigation-timeline-data.js";
import {
  buildRouteSettlementCollisionIndex,
  deriveAchievedSettlementOutlineIds,
} from "../../frontend/src/shared/nli-route-settlement-collisions.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SETTLEMENTS_PATH = path.resolve(
  here,
  "../../public/processed/layers/nli/investigation_settlements.geojson",
);
const POLYGONS_PATH = path.resolve(
  here,
  "../../public/processed/layers/nli/investigation_polygons.geojson",
);

function loadProcessedFeatures(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, "utf8")).features || [];
}

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

  it("Nova polygon beats light outline 100 not Reim 18", () => {
    const sidecar = loadProcessedFeatures(SETTLEMENTS_PATH);
    const reim = settlement(18, square(-2, -1));
    reim.properties.locations = ["רעים"];
    const novaSite = settlement(100, square(4, 6));
    novaSite.properties.locations = ["נובה"];
    const settlementsIncludingNova100 = sidecar.length
      ? sidecar
      : [reim, novaSite];
    const indexes = buildInvestigationSettlementIndexes(settlementsIncludingNova100);
    expect(indexes.locationToOutlineObjectId.get("נובה")).toBe(100);
    expect(indexes.locationToOutlineObjectId.get("רעים")).toBe(18);
    const ids = deriveAchievedSettlementOutlineIds({
      achievedPolygonBeats: [500],
      polygonFeatures: [{ properties: { timeline_minutes: 500, מיקום: "נובה" } }],
      locationToOutlineObjectId: indexes.locationToOutlineObjectId,
    });
    expect(ids.has("100")).toBe(true);
    expect(ids.has("18")).toBe(false);
  });

  it("ignores unconfirmed approach lines when lighting settlements", () => {
    const unconfirmed = {
      type: "Feature",
      properties: {
        OBJECTID: 1001,
        route_confidence: "unconfirmed",
        parent_objectid: 10,
      },
      geometry: { type: "LineString", coordinates: [[0, 0], [10, 0]] },
    };
    const index = buildRouteSettlementCollisionIndex(
      [unconfirmed],
      [settlement(20, square(4, 6))],
    );
    expect(index.has("1001")).toBe(false);
    const ids = deriveAchievedSettlementOutlineIds({
      collisionIndex: index,
      completedRouteFeatures: [unconfirmed],
    });
    expect(ids.size).toBe(0);
  });

  it("an infiltration line that enters the Nova site polygon lights 100", () => {
    const polygons = loadProcessedFeatures(POLYGONS_PATH);
    const sidecar = loadProcessedFeatures(SETTLEMENTS_PATH);
    const novaPolygon = polygons.find((feature) => Number(feature?.properties?.OBJECTID) === 100);
    const novaSiteSettlement100 = novaPolygon
      ? {
        type: "Feature",
        properties: { outlineObjectId: 100, locations: ["נובה"] },
        geometry: novaPolygon.geometry,
      }
      : settlement(100, square(4, 6));
    const ring = novaSiteSettlement100.geometry?.type === "Polygon"
      ? novaSiteSettlement100.geometry.coordinates[0]
      : square(4, 6).coordinates[0];
    const minX = Math.min(...ring.map((point) => point[0]));
    const maxX = Math.max(...ring.map((point) => point[0]));
    const midY = (Math.min(...ring.map((point) => point[1])) + Math.max(...ring.map((point) => point[1]))) / 2;
    const lineEnteringPolygon100 = route(50, [[minX - 1, midY], [maxX + 1, midY]]);
    const index = buildRouteSettlementCollisionIndex(
      [lineEnteringPolygon100],
      sidecar.length ? sidecar : [novaSiteSettlement100],
    );
    const ids = deriveAchievedSettlementOutlineIds({
      collisionIndex: index,
      completedRouteFeatures: [lineEnteringPolygon100],
    });
    expect([...ids].map(String)).toContain("100");
  });
});
