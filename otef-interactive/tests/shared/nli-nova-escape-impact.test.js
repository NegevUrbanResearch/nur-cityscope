import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { idleNliClock, playNliClock } from "../../frontend/src/shared/nli-investigation-clock.js";
import { INVESTIGATION_POLYGONS_FULL_ID } from "../../frontend/src/shared/nli-investigation-beats.js";
import {
  disposeInvestigationTimelineForMap,
  syncInvestigationTimelineToMap,
} from "../../frontend/src/shared/maplibre-investigation-timeline.js";
import { NLI_NARRATIVES } from "../../frontend/src/shared/nli-narratives.js";
import {
  createNovaEscapeCoordinator,
  NOVA_FLEEING_IMPACT_INDEX_URL,
} from "../../frontend/src/shared/nli-nova-escape-coordinator.js";
import {
  NOVA_ESCAPE_IMPACT_LAYER_ID,
  escapeImpactOutlineIds,
  firstFleeingLineCrossingProgress,
  firstFleeingPolygonCrossingProgress,
  novaParallelImpactFeatureIds,
  shouldIncludeNarrativeSettlementOutline,
} from "../../frontend/src/shared/nli-nova-escape-impact.js";
import * as routeSettlementCollisions from "../../frontend/src/shared/nli-route-settlement-collisions.js";

const INDIVIDUAL_URL = "/otef-interactive/public/processed/layers/nli/fleeing_route.geojson";
const OVERLAP_URL = "/otef-interactive/public/processed/layers/nli/fleeing_route_overlapp.geojson";

const square = (minX, maxX, minY = -1, maxY = 1) => ({
  type: "Polygon",
  coordinates: [[
    [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY], [minX, minY],
  ]],
});

const polygon = (id, geometry, extra = {}) => ({
  type: "Feature",
  properties: { OBJECTID: id, outlineObjectId: id, ...extra },
  geometry,
});

const line = (id, coordinates) => ({
  type: "Feature",
  properties: { OBJECTID: id },
  geometry: { type: "LineString", coordinates },
});

const reim18 = polygon(18, square(4, 6), { locations: ["רעים"] });
const beeri19 = polygon(19, square(4, 6, 3, 5), { locations: ["בארי"] });
const nova100 = polygon(100, square(-1, 1), { locations: ["נובה"] });

const pathEnteringBeeri19 = line(1, [[0, 4], [10, 4]]);
const pathStartingAtFacilityInsidePolygon100 = line(1, [[0, 0], [10, 0]]);
const pathEnteringReim18 = line(1, [[0, 0], [10, 0]]);
const hubPaths = [line(1, [[0, 0], [10, 0]])];
const settlements = [reim18, beeri19, nova100];

const individualCollection = {
  type: "FeatureCollection",
  features: [pathEnteringBeeri19],
};

function jsonResponse(data) {
  return {
    ok: true,
    json: async () => data,
  };
}

function infiltrationImpactOutlineIds(map) {
  const data = map.getSource("nli-investigation-settlement-impact")?.data;
  return (data?.features || []).map((feature) => String(
    feature?.properties?.outlineObjectId ?? feature?.properties?.OBJECTID,
  ));
}

function createHostMap() {
  return createFakeMapLibreMap({
    layers: [
      { id: "nli__investigation_polygons__fill__0", type: "fill", source: "nli__investigation_polygons" },
      { id: "nli__investigation_polygons__line__1", type: "line", source: "nli__investigation_polygons" },
    ],
    paints: {
      "nli__investigation_polygons__fill__0": { "fill-opacity": 0.4, "fill-color": "#f79009" },
      "nli__investigation_polygons__line__1": { "line-opacity": 1, "line-width": 1.6, "line-color": "#b54708" },
    },
    sources: {
      nli__investigation_polygons: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
  });
}

describe("Nova escape-impact outlines", () => {
  let maps = [];

  beforeEach(() => {
    maps = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const href = String(url);
      if (href === OVERLAP_URL) return jsonResponse({ type: "FeatureCollection", features: [] });
      if (href === INDIVIDUAL_URL) return jsonResponse(individualCollection);
      if (href === NOVA_FLEEING_IMPACT_INDEX_URL) {
        return jsonResponse({
          schemaVersion: 1,
          routeIds: ["1"],
          parallelCrossings: [],
          settlementCrossings: [],
        });
      }
      return jsonResponse({ type: "FeatureCollection", features: [] });
    }));
  });

  afterEach(() => {
    for (const map of maps) disposeInvestigationTimelineForMap(map);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("path that enters a non-origin yeshuv lights f57a00 not incident red", () => {
    const collisionSpy = vi.spyOn(routeSettlementCollisions, "buildRouteSettlementCollisionIndex");
    const ids = escapeImpactOutlineIds({
      contacts: [{ routeId: "1", outlineObjectId: "19", u: 0.4 }],
      progressByObjectId: { "1": 0.4 },
    });
    expect(ids.has("19")).toBe(true);
    expect(collisionSpy).not.toHaveBeenCalled();
  });

  test("progress 0 does not treat Reim as origin just because the path starts at the Nova facility", () => {
    expect(escapeImpactOutlineIds({
      routes: [pathStartingAtFacilityInsidePolygon100],
      settlements: [reim18],
      progressByObjectId: { "1": 0 },
    }).has("18")).toBe(false);
  });

  test("a path that later enters Reim does include outline 18", () => {
    expect(escapeImpactOutlineIds({
      routes: [pathEnteringReim18],
      settlements: [reim18],
      progressByObjectId: { "1": 1 },
    }).has("18")).toBe(true);
  });

  test("second call with the same route and settlement arrays does not rebuild the collision index", () => {
    const spy = vi.spyOn(routeSettlementCollisions, "buildRouteSettlementCollisionIndex");
    const routes = [pathEnteringReim18];
    const settlementList = [reim18, beeri19];
    escapeImpactOutlineIds({
      routes,
      settlements: settlementList,
      progressByObjectId: { "1": 0.4 },
    });
    const firstCalls = spy.mock.calls.length;
    expect(firstCalls).toBeGreaterThan(0);
    escapeImpactOutlineIds({
      routes,
      settlements: settlementList,
      progressByObjectId: { "1": 0.8 },
    });
    expect(spy).toHaveBeenCalledTimes(firstCalls);
  });

  test("progress 0.1 lights early Reim only; progress 1 lights Reim and a later yeshuv", () => {
    const path = line(1, [[0, 0], [10, 0]]);
    const earlyReim = polygon(18, square(0.5, 1.5));
    const laterYeshuv = polygon(19, square(8, 10));
    const routes = [path];
    const settlementList = [earlyReim, laterYeshuv];
    const early = escapeImpactOutlineIds({
      routes,
      settlements: settlementList,
      progressByObjectId: { "1": 0.1 },
    });
    expect(early.has("18")).toBe(true);
    expect(early.has("19")).toBe(false);
    const done = escapeImpactOutlineIds({
      routes,
      settlements: settlementList,
      progressByObjectId: { "1": 1 },
    });
    expect(done.has("18")).toBe(true);
    expect(done.has("19")).toBe(true);
  });

  test("investigation polygon 100 is not a yeshuv escape-impact id", () => {
    expect(escapeImpactOutlineIds({
      routes: hubPaths, settlements, progressByObjectId: { "1": 1 },
    }).has("100")).toBe(false);
  });

  test("path that stays inside a yeshuv without crossing its ring still lights escape-impact", () => {
    const ids = escapeImpactOutlineIds({
      routes: [line(1, [[4.5, 0], [5.5, 0]])],
      settlements: [reim18],
      progressByObjectId: { "1": 1 },
    });
    expect(ids.has("18")).toBe(true);
  });

  test("Nova idle clock does not paint outline 18 on the infiltration impact layer", async () => {
    const map = createHostMap();
    maps.push(map);
    const hidden = [{ id: "nli", layers: [
      { id: "investigation_polygons", enabled: false },
      { id: "lines", enabled: false },
    ] }];
    await syncInvestigationTimelineToMap(map, idleNliClock(), hidden, {
      settlementFeatures: [reim18, beeri19],
      narrativeFocus: NLI_NARRATIVES.nova,
      now: () => 0,
      getLayerDataUrl: () => null,
    });
    expect(infiltrationImpactOutlineIds(map)).not.toContain("18");
  });

  test("Nova narrative does not inject a yeshuv outline even if one is present", () => {
    expect(shouldIncludeNarrativeSettlementOutline(NLI_NARRATIVES.nova)).toBe(false);
    expect(shouldIncludeNarrativeSettlementOutline({
      ...NLI_NARRATIVES.nova,
      focusSettlementOutlineId: 18,
    })).toBe(false);
    expect(shouldIncludeNarrativeSettlementOutline(NLI_NARRATIVES.segev)).toBe(true);
  });

  test("layer id is not the infiltration impact overlay", () => {
    expect(NOVA_ESCAPE_IMPACT_LAYER_ID).not.toBe("nli-investigation-settlement-impact-outline");
  });

  test("red infiltration outline and fleeing orange stay two distinct strokes", async () => {
    const map = createHostMap();
    maps.push(map);
    const coordinator = createNovaEscapeCoordinator({
      map,
      profile: "gis",
      surface: "projection",
    });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
    coordinator.setEscapeImpactIds(["19"]);
    const groups = [{ id: "nli", layers: [{ id: "investigation_polygons", enabled: true }] }];
    await syncInvestigationTimelineToMap(map, playNliClock(
      idleNliClock(),
      [INVESTIGATION_POLYGONS_FULL_ID],
      [400],
      0,
    ), groups, {
      featuresById: {
        [INVESTIGATION_POLYGONS_FULL_ID]: [{
          properties: { OBJECTID: 1, timeline_minutes: 400, מיקום: "בארי" },
          geometry: beeri19.geometry,
        }],
      },
      settlementFeatures: [beeri19],
      locationToOutlineObjectId: { בארי: 19 },
      narrativeFocus: NLI_NARRATIVES.nova,
      now: () => 0,
      getLayerDataUrl: () => null,
    });
    expect(map.getLayer("nli-investigation-settlement-impact-outline")).toBeTruthy();
    expect(map.getLayer("nli-nova-escape-impact-outline")).toBeTruthy();
    expect(map.getPaintProperty("nli-investigation-settlement-impact-outline", "line-color")).toBe("#c31f4f");
    expect(map.getPaintProperty("nli-nova-escape-impact-outline", "line-color")).toBe("#f57a00");
    coordinator.dispose();
  });

  test("impact source does not export nli-nova-site-outline", () => {
    const src = fs.readFileSync(
      new URL("../../frontend/src/shared/nli-nova-escape-impact.js", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/nli-nova-site-outline/);
    expect(src).not.toMatch(/NOVA_SITE_OUTLINE_LAYER_ID/);
  });

  test("GIS coordinator never mounts nli-nova-site-outline", async () => {
    const map = createFakeMapLibreMap();
    const coordinator = createNovaEscapeCoordinator({
      map,
      profile: "gis",
      surface: "gis",
    });
    await coordinator.sync({ id: "nova" }, { individual: true, overlap: false });
    expect(map.getLayer("nli-nova-site-outline")).toBeFalsy();
    expect(map.getLayer("nli-nova-escape-individual")).toBeFalsy();
    coordinator.dispose();
  });
});

describe("Nova parallel-impact", () => {
  test("OBJECTID 100 never enters parallel-impact at progress 0", () => {
    const ids = novaParallelImpactFeatureIds({
      routes: [pathStartingAtFacilityInsidePolygon100],
      features: [nova100, polygon(99, square(8, 10), { מיקום: "נובה" })],
      progressByObjectId: { 1: 0 },
    });
    expect(ids.has("polygon:100")).toBe(false);
  });

  test("surrounding Nova polygon lights when the revealed segment first intersects it", () => {
    const neighbor = polygon(99, square(4, 6), { מיקום: "נובה" });
    const route = line(1, [[0, 0], [10, 0]]);
    const before = novaParallelImpactFeatureIds({
      routes: [route],
      features: [nova100, neighbor],
      progressByObjectId: { 1: 0.05 },
    });
    const after = novaParallelImpactFeatureIds({
      routes: [route],
      features: [nova100, neighbor],
      progressByObjectId: { 1: 1 },
    });
    expect(before.has("polygon:100")).toBe(true);
    expect(after.has("polygon:100")).toBe(true);
    expect(after.has("polygon:99")).toBe(true);
  });

  test("firstFleeingPolygonCrossingProgress counts a segment that crosses with both endpoints outside", () => {
    const parts = [[[0, 0], [10, 0]]];
    const geom = {
      type: "Polygon",
      coordinates: [[[4, -1], [6, -1], [6, 1], [4, 1], [4, -1]]],
    };
    const u = firstFleeingPolygonCrossingProgress(parts, geom);
    expect(u).toBeGreaterThan(0.3);
    expect(u).toBeLessThan(0.7);
  });

  test("multipart polygon crossing uses cumulative u", () => {
    const parts = [[[0, 0], [1, 0]], [[4, 0], [10, 0]]];
    const geom = {
      type: "Polygon",
      coordinates: [[[5, -1], [7, -1], [7, 1], [5, 1], [5, -1]]],
    };
    const u = firstFleeingPolygonCrossingProgress(parts, geom);
    expect(u).toBeGreaterThan(0.2);
  });

  test("firstFleeingLineCrossingProgress intersects polylines with cumulative u", () => {
    const parts = [[[0, 0], [10, 0]]];
    const geom = { type: "LineString", coordinates: [[5, -1], [5, 1]] };
    const u = firstFleeingLineCrossingProgress(parts, geom);
    expect(u).toBeCloseTo(0.5, 5);
  });

  test("same numeric OBJECTID lights only the crossed kind", () => {
    const route = line(24, [[0, 0], [10, 0]]);
    const crossedPolygon = polygon(1, square(8, 10));
    const uncrossedLine = line(1, [[0, 5], [10, 5]]);
    const ids = novaParallelImpactFeatureIds({
      routes: [route],
      features: [crossedPolygon, uncrossedLine],
      progressByObjectId: { 24: 1 },
    });
    expect(ids.has("polygon:1")).toBe(true);
    expect(ids.has("line:1")).toBe(false);
    expect(ids.has("1")).toBe(false);
  });
});
