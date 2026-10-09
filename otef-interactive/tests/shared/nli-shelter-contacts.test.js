import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import proj4 from "proj4";
import {
  buildShelterContactIndex,
  deriveShelterImpactIds,
  SHELTER_ITM,
} from "../../frontend/src/shared/nli-shelter-contacts.js";
import { orientInvestigationLineFeature } from "../../frontend/src/shared/nli-investigation-route-geometry.js";
import { splitCompositeLineFrame } from "../../frontend/src/shared/nli-unconfirmed-route-progress.js";

beforeAll(() => vi.stubGlobal("proj4", proj4));
afterAll(() => vi.unstubAllGlobals());

const xy = (x, y) => proj4(SHELTER_ITM, "EPSG:4326", [200000 + x, 600000 + y]);
const point = (id, x = 0, y = 0) => ({
  id,
  geometry: { type: "Point", coordinates: xy(x, y) },
});
const line = (id, parts, props = {}) => ({
  properties: { OBJECTID: id, ...props },
  geometry: {
    type: parts[0][0] instanceof Array ? "MultiLineString" : "LineString",
    coordinates:
      parts[0][0] instanceof Array
        ? parts.map((p) => p.map((c) => xy(...c)))
        : parts.map((c) => xy(...c)),
  },
});
const polygon = (id, rings, props = {}) => ({
  properties: { OBJECTID: id, timeline_minutes: 420, ...props },
  geometry: {
    type: "Polygon",
    coordinates: rings.map((r) => r.map((c) => xy(...c))),
  },
});
const box = (a, b) => [
  [a, a],
  [b, a],
  [b, b],
  [a, b],
  [a, a],
];
function index(
  shelters,
  polygonFeatures = [],
  lineFeatures = [],
  toleranceMeters = 25,
) {
  return buildShelterContactIndex({
    shelters,
    polygonFeatures,
    lineFeatures,
    toleranceMeters,
  });
}
function impact(contactIndex, options = {}) {
  return deriveShelterImpactIds({
    contactIndex,
    frame: { achievedPolygonBeats: [420] },
    polygonVisible: true,
    ...options,
  });
}

describe("source-centered shelter contacts", () => {
  it("handles filled polygons, holes, tolerance and independent neighbors", () => {
    const poly = polygon(1, [box(-100, 100), box(-40, 40)]);
    const i = index(
      [
        point("hole"),
        point("filled", 70),
        point("edge", 110),
        point("far", 140),
      ],
      [poly],
    );
    expect([...impact(i)]).toEqual(["filled", "edge"]);
    expect([...impact(i, { polygonVisible: false })]).toEqual([]);
    expect([...impact(i, { frame: { achievedPolygonObjectIds: [] } })]).toEqual(
      [],
    );
    expect([
      ...impact(i, { frame: { achievedPolygonObjectIds: [1] } }),
    ]).toEqual(["filled", "edge"]);
    expect([...impact(i, { frame: { achievedPolygonBeats: [419] } })]).toEqual(
      [],
    );
  });
  it("handles MultiPolygon and excludes fire sites", () => {
    const poly = polygon(2, [box(-10, 10)]);
    poly.geometry = {
      type: "MultiPolygon",
      coordinates: [poly.geometry.coordinates],
    };
    expect([...impact(index([point("a")], [poly]))]).toEqual(["a"]);
    poly.properties.Notes = "שריפה";
    expect([...impact(index([point("a")], [poly]))]).toEqual([]);
  });
  it("tests source tolerance independently of optical offsets", () => {
    const l = line(3, [
      [-100, 20],
      [100, 20],
    ]);
    const s = { ...point("a"), properties: { displayOffset: [500, 500] } };
    expect([
      ...impact(index([s], [], [l], 19), { confirmedCompleted: [l] }),
    ]).toEqual([]);
    expect([
      ...impact(index([s], [], [l], 25), { confirmedCompleted: [l] }),
    ]).toEqual(["a"]);
    expect([
      ...impact(index([s], [], [l], 20), { confirmedCompleted: [l] }),
    ]).toEqual(["a"]);
  });
  it("reveals at the first contact, and removes it on backward progress", () => {
    const l = line(4, [
      [-100, 0],
      [100, 0],
    ]);
    const i = index([point("a")], [], [l]);
    const active = (p) => ({
      confirmedActive: [{ feature: l, progress: p, clipGeometry: true }],
    });
    expect([...impact(i, active(0.374))]).toEqual([]);
    expect([...impact(i, active(0.376))]).toEqual(["a"]);
    expect([...impact(i, active(0.1))]).toEqual([]);
  });
  it("orients once before splitting reversed confirmed and approach features", () => {
    const l = line(
      5,
      [
        [100, 0],
        [-100, 0],
      ],
      { flow_direction: "reverse" },
    );
    const approach = line(
      6,
      [
        [-200, 0],
        [-100, 0],
      ],
      { route_confidence: "unconfirmed", parent_objectid: 5 },
    );
    const i = index([point("a")], [], [l, approach]);
    const frame = (p) =>
      splitCompositeLineFrame({
        activeFeatures: [l, approach].map(orientInvestigationLineFeature),
        activeProgress: p,
      });
    expect([...impact(i, frame(0.2))]).toEqual([]);
    expect([...impact(i, frame(0.57))]).toEqual([]);
    expect([...impact(i, frame(0.59))]).toEqual(["a"]);
  });
  it("distinguishes short-part gradient contact from longest-part clipping", () => {
    const l = line(7, [
      [
        [-500, 500],
        [500, 500],
      ],
      [
        [-100, 0],
        [100, 0],
      ],
    ]);
    const i = index([point("a")], [], [l]);
    expect([
      ...impact(i, {
        confirmedActive: [{ feature: l, progress: 0.38, clipGeometry: false }],
      }),
    ]).toEqual(["a"]);
    expect([
      ...impact(i, {
        confirmedActive: [{ feature: l, progress: 0.9, clipGeometry: true }],
      }),
    ]).toEqual([]);
    expect([...impact(i, { confirmedCompleted: [l] })]).toEqual(["a"]);
  });
  it("starting inside requires a nonempty confirmed reveal; excludes unconfirmed routes", () => {
    const l = line(8, [
      [0, 0],
      [100, 0],
    ]);
    const i = index([point("a")], [], [l]);
    expect([
      ...impact(i, { confirmedActive: [{ feature: l, progress: 0 }] }),
    ]).toEqual([]);
    expect([
      ...impact(i, { confirmedActive: [{ feature: l, progress: 0.01 }] }),
    ]).toEqual(["a"]);
    const un = line(
      9,
      [
        [-100, 0],
        [100, 0],
      ],
      { route_confidence: "unconfirmed" },
    );
    expect([
      ...impact(index([point("a")], [], [un]), { confirmedCompleted: [un] }),
    ]).toEqual([]);
  });
  it("ignores degenerate and unknown geometry without creating contact", () => {
    const l = line(10, [
      [100, 100],
      [100, 100],
    ]);
    expect([
      ...impact(index([point("a")], [], [l]), { confirmedCompleted: [l] }),
    ]).toEqual([]);
  });
});
