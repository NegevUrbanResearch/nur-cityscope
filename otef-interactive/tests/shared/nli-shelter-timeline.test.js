import { afterEach, beforeAll, afterAll, it, expect, vi } from "vitest";
import proj4 from "proj4";
import { createHash, webcrypto } from "node:crypto";
import fixture from "../../scripts/fixtures/nli-shelters-232.json";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import {
  syncInvestigationTimelineToMap,
  disposeInvestigationTimelineForMap,
  prepareInvestigationTimelineForStyleReload,
} from "../../frontend/src/shared/maplibre-investigation-timeline.js";
import {
  SHELTER_LAYER_ID,
  SHELTER_SOURCE_ID,
} from "../../frontend/src/shared/maplibre-nli-shelters.js";
import { buildLegendModel } from "../../frontend/src/map/legend-model-builder.js";
beforeAll(() => vi.stubGlobal("proj4", proj4));
afterAll(() => vi.unstubAllGlobals());
const doc = {
  type: "FeatureCollection",
  schemaVersion: 1,
  shelterVersion: "a",
  features: fixture.shelters.map((s) => ({
    id: s.id,
    geometry: { type: "Point", coordinates: s.coordinates },
    properties: { personPids: s.personPids },
  })),
};
const bytes = new TextEncoder().encode(JSON.stringify(doc));
const resource = {
  file: "shelters_232.geojson",
  schemaVersion: 1,
  shelterVersion: "a",
  sha256: createHash("sha256").update(bytes).digest("hex"),
};
const groups = (on = true, polygons = false) => [
  {
    id: "nli",
    layers: [
      { id: "ציר_232", enabled: on },
      { id: "investigation_polygons", enabled: polygons },
    ],
  },
];
const maps = [];
afterEach(() => maps.splice(0).forEach(disposeInvestigationTimelineForMap));
function setup() {
  const m = createFakeMapLibreMap();
  maps.push(m);
  const images = new Map();
  Object.assign(m, {
    project: ([x, y]) => ({ x: x * 100, y: y * 100 }),
    hasImage: (id) => images.has(id),
    addImage: (id, img) => images.set(id, img),
    removeImage: (id) => images.delete(id),
  });
  return m;
}
const dependencies = {
  getLayerConfig: () => ({ resources: { shelters232: resource } }),
  fetchShelterBytes: async () => bytes,
  crypto: webcrypto,
  shelterImageFactory: () => ({
    width: 56,
    height: 48,
    data: new Uint8Array(56 * 48 * 4),
  }),
  settlementFeatures: [],
  featuresById: { "nli.investigation_polygons": [], "nli.lines": [] },
  now: () => 0,
  displayProfile: "gis",
};

it("shows nine neutral icons in a 232-only idle view and hides immediately during loading", async () => {
  const m = setup();
  await syncInvestigationTimelineToMap(m, null, groups(), dependencies);
  await vi.waitFor(() =>
    expect(m.getSource(SHELTER_SOURCE_ID)?.data.features).toHaveLength(9),
  );
  expect(
    m
      .getSource(SHELTER_SOURCE_ID)
      .data.features.every((f) => !f.properties.impacted),
  ).toBe(true);
  await syncInvestigationTimelineToMap(m, null, groups(false), dependencies);
  expect(m.getLayoutProperty(SHELTER_LAYER_ID, "visibility")).toBe("none");
});
it("shares complete GIS idle polygon state, clears hidden contact, and remounts after style reload", async () => {
  const m = setup(),
    p = {
      properties: { OBJECTID: 1, timeline_minutes: 420 },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [34, 31],
            [35, 31],
            [35, 32],
            [34, 32],
            [34, 31],
          ],
        ],
      },
    };
  const deps = {
    ...dependencies,
    featuresById: {
      ...dependencies.featuresById,
      "nli.investigation_polygons": [p],
    },
  };
  await syncInvestigationTimelineToMap(m, null, groups(true, true), deps);
  await vi.waitFor(() =>
    expect(m.getSource(SHELTER_SOURCE_ID)?.data.features).toHaveLength(9),
  );
  expect(
    m
      .getSource(SHELTER_SOURCE_ID)
      .data.features.every((f) => f.properties.impacted),
  ).toBe(true);
  await syncInvestigationTimelineToMap(m, null, groups(), deps);
  expect(
    m
      .getSource(SHELTER_SOURCE_ID)
      .data.features.every((f) => !f.properties.impacted),
  ).toBe(true);
  prepareInvestigationTimelineForStyleReload(m);
  m.emit("style.load");
  await syncInvestigationTimelineToMap(m, null, groups(), deps);
  expect(m.getSource(SHELTER_SOURCE_ID).data.features).toHaveLength(9);
});
it("includes the shelter legend only with 232 and validated visible data on either surface", async () => {
  const registry = {
    _initialized: true,
    getGroups: () => [],
    getLayerConfig: () => ({
      geometryType: "line",
      resources: { shelters232: resource },
    }),
    getPackStyleJsonForLayer: () => ({
      renderer: "simple",
      defaultStyle: { color: "white", weight: 1 },
    }),
  };
  for (const surface of ["gis", "projection"])
    for (const on of [true, false])
      for (const valid of [true, false]) {
        const model = await buildLegendModel({
          surface,
          registry,
          dataContext: { getLayerGroups: () => groups(on) },
          sheltersVisible: valid,
        });
        const item = model.packs
          .flatMap((p) => p.layers)
          .flatMap((l) => l.items)
          .find((i) => i.id === "nli.shelters232:category");
        expect(!!item).toBe(on && valid);
        if (item) {
          expect(item.shape).toBe("shelter");
          expect(item.label).toBe("מיגוניות");
        }
      }
});

it("finishes scene synchronization while optional shelter bytes are still unresolved", async () => {
  const m = setup();
  let resolveBytes;
  const slow = {
    ...dependencies,
    fetchShelterBytes: () => new Promise((resolve) => (resolveBytes = resolve)),
  };
  const sync = syncInvestigationTimelineToMap(m, null, groups(), slow);
  try {
    const finished = await Promise.race([
      sync.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 25)),
    ]);
    expect(finished).toBe(true);
    expect(m.getSource(SHELTER_SOURCE_ID)).toBeNull();
  } finally {
    resolveBytes(bytes);
    await sync;
  }
});
