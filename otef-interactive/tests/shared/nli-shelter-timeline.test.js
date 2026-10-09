import { afterEach, beforeAll, afterAll, it, expect, vi } from "vitest";
import proj4 from "proj4";
import { createHash, webcrypto } from "node:crypto";
import fixture from "../../scripts/fixtures/nli-shelters-232.json";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import {
  syncInvestigationTimelineToMap,
  disposeInvestigationTimelineForMap,
  prepareInvestigationTimelineForStyleReload,
  getInvestigationSceneContentKey,
} from "../../frontend/src/shared/maplibre-investigation-timeline.js";
import { createNliSceneDisplayBinding } from "../../frontend/src/shared/nli-scene-display-binding.js";
import { createGisNarrativeController } from "../../frontend/src/map/nli-narrative-controller.js";
import { createProjectionNarrativeController } from "../../frontend/src/projection/projection-narrative-controller.js";
import {
  SHELTER_LAYER_ID,
  SHELTER_SOURCE_ID,
} from "../../frontend/src/shared/maplibre-nli-shelters.js";
import { buildLegendModel } from "../../frontend/src/map/legend-model-builder.js";
import { publishNovaShelterDestinations } from "../../frontend/src/shared/nli-shelter-nova-state.js";
import { playNliClock, seekNliClock } from "../../frontend/src/shared/nli-investigation-clock.js";
import { getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";
beforeAll(() => vi.stubGlobal("proj4", proj4));
afterAll(() => vi.unstubAllGlobals());
const doc = {
  type: "FeatureCollection",
  schemaVersion: 1,
  shelterVersion: "a",
  novaRoutesSHA256: "accepted",
  features: fixture.shelters.map((s) => ({
    id: s.id,
    geometry: { type: "Point", coordinates: s.coordinates },
    properties: { personPids: s.personPids, novaRouteObjectIds: s === fixture.shelters[0] ? ["19"] : [] },
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
afterEach(() => vi.useRealTimers());
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

it.each(["gis", "projection"])("%s restricts shelters to overview, timeline, Nova, identity and Shura map states", async displayProfile => {
  const m = setup();
  for (const narrativeId of [null, "nova", "segev", "sderot", "hostages", "hostages_all", null]) {
    await syncInvestigationTimelineToMap(m, null, groups(), {
      ...dependencies, displayProfile, narrativeFocus: narrativeId ? { id: narrativeId } : null,
    });
    if (narrativeId === null || narrativeId === "nova") {
      await vi.waitFor(() => expect(m.getLayoutProperty(SHELTER_LAYER_ID, "visibility")).toBe("visible"));
    } else expect(m.getLayoutProperty(SHELTER_LAYER_ID, "visibility")).toBe("none");
  }
});

it("retains shelters until the global scene departure fade finishes and fades them back in", async () => {
  const m = setup();
  let time = 0, callback;
  const runtime = getLayerLifecycleRuntime(m, {
    now: () => time,
    requestFrame: fn => { callback = fn; return 1; }, cancelFrame: () => {},
  });
  runtime.setDesiredIds(["nli.shelters232"]);
  const deps = { ...dependencies, joinBatch: true };
  await syncInvestigationTimelineToMap(m, null, groups(), deps);
  await vi.waitFor(() => expect(m.getSource(SHELTER_SOURCE_ID)?.data.features).toHaveLength(9));
  expect(m.getPaintProperty(SHELTER_LAYER_ID, "icon-opacity")).toBe(0);
  runtime.commitBatch(); time = 600; callback(time);
  expect(m.getPaintProperty(SHELTER_LAYER_ID, "icon-opacity")).toBe(1);
  runtime.setDesiredIds([]);
  await syncInvestigationTimelineToMap(m, null, groups(), { ...deps, narrativeFocus: { id: "segev" } });
  runtime.commitBatch(); time = 900; callback(time);
  expect(m.getLayoutProperty(SHELTER_LAYER_ID, "visibility")).toBe("visible");
  expect(m.getPaintProperty(SHELTER_LAYER_ID, "icon-opacity")).toBeCloseTo(.5);
  time = 1200; callback(time);
  expect(!m.getLayer(SHELTER_LAYER_ID) || m.getLayoutProperty(SHELTER_LAYER_ID, "visibility") === "none").toBe(true);
  runtime.setDesiredIds(["nli.shelters232"]);
  await syncInvestigationTimelineToMap(m, null, groups(), deps);
  await vi.waitFor(() => expect(m.getLayoutProperty(SHELTER_LAYER_ID, "visibility")).toBe("visible"));
  runtime.commitBatch(); time = 1500; callback(time);
  expect(m.getPaintProperty(SHELTER_LAYER_ID, "icon-opacity")).toBeCloseTo(.5);
  time = 1800; callback(time);
  expect(m.getPaintProperty(SHELTER_LAYER_ID, "icon-opacity")).toBe(1);
  runtime.dispose();
});

it("optional pending shelter bytes do not hold the global scene readiness barrier", async () => {
  const m = setup();
  const runtime = getLayerLifecycleRuntime(m);
  runtime.setDesiredIds(["nli.shelters232"], { durationMs: 0, requiredIds: ["nli.shelters232"] });
  await syncInvestigationTimelineToMap(m, null, groups(), {
    ...dependencies, joinBatch: true, fetchShelterBytes: () => new Promise(() => {}),
  });
  runtime.commitBatch();
  expect(runtime.getRenderedReadiness().ready).toBe(true);
  runtime.dispose();
});

it("missing browser projection geometry cannot fail the scene and recovers on the next geometry event", async () => {
  const m = setup();
  const canvas = { dataset: {}, clientWidth: 1920, clientHeight: 1080 };
  m.getCanvas = () => canvas;
  const runtime = getLayerLifecycleRuntime(m);
  let mapping;
  const diagnostic = vi.fn();
  runtime.setDesiredIds(["nli.shelters232"], { durationMs: 0, requiredIds: ["nli.shelters232"] });
  await syncInvestigationTimelineToMap(m, null, groups(), {
    ...dependencies, displayProfile: "projection", joinBatch: true,
    getShelterProjectionPresentation: () => mapping, onShelterDiagnostic: diagnostic,
  });
  runtime.commitBatch();
  await vi.waitFor(() => expect(JSON.parse(m.getCanvas().dataset.nliShelters).status).toBe("ready"));
  expect(runtime.getRenderedReadiness().ready).toBe(true);
  expect(diagnostic).not.toHaveBeenCalled();
  mapping = dependencies.getShelterProjectionPresentation();
  m.emit("nli-shelter-presentation-change");
  expect(m.getLayoutProperty(SHELTER_LAYER_ID, "visibility")).toBe("visible");
  runtime.dispose();
});

it.each(["gis", "projection"])("%s camera events cannot remount shelters from the departing scene after the global exit", async displayProfile => {
  const m = setup();
  let time = 0, callback;
  const runtime = getLayerLifecycleRuntime(m, {
    now: () => time, requestFrame: fn => { callback = fn; return 1; }, cancelFrame: () => {},
  });
  runtime.setDesiredIds(["nli.shelters232"]);
  await syncInvestigationTimelineToMap(m, null, groups(), { ...dependencies, displayProfile, joinBatch: true });
  await vi.waitFor(() => expect(m.getLayer(SHELTER_LAYER_ID)).toBeTruthy());
  runtime.commitBatch(); time = 600; callback(time);
  runtime.setDesiredIds([], { requiredIds: [] });
  runtime.commitBatch(); time = 1200; callback(time);
  expect(m.getLayer(SHELTER_LAYER_ID)).toBeFalsy();
  // The next scene moves the camera before its timeline inputs are installed.
  for (const event of ["move", "resize", "nli-shelter-presentation-change"]) m.emit(event);
  expect(m.getLayer(SHELTER_LAYER_ID)).toBeFalsy();
  runtime.dispose();
});

it("a late projection shelter response cannot revive Segev, and a subsequent Nova entry recovers", async () => {
  const m = setup();
  let time = 0, callback;
  const runtime = getLayerLifecycleRuntime(m, {
    now: () => time, requestFrame: fn => { callback = fn; return 1; }, cancelFrame: () => {},
  });
  let deliver;
  const deps = { ...dependencies, displayProfile: "projection", joinBatch: true };
  runtime.setDesiredIds(["nli.shelters232"], { durationMs: 0, requiredIds: ["nli.shelters232"] });
  await syncInvestigationTimelineToMap(m, null, groups(), {
    ...deps, fetchShelterBytes: () => new Promise(resolve => { deliver = resolve; }),
  });
  runtime.commitBatch(); runtime.setDesiredIds([], { durationMs: 0, requiredIds: [] }); runtime.commitBatch();
  await syncInvestigationTimelineToMap(m, null, groups(), { ...deps, narrativeFocus: { id: "segev" } });
  deliver(bytes);
  for (let i = 0; i < 35; i++) await Promise.resolve();
  m.emit("move");
  expect(m.getLayer(SHELTER_LAYER_ID)).toBeFalsy();
  runtime.setDesiredIds(["nli.shelters232"], { durationMs: 0, requiredIds: ["nli.shelters232"] });
  await syncInvestigationTimelineToMap(m, null, groups(), { ...deps, narrativeFocus: { id: "nova" } });
  runtime.commitBatch();
  await vi.waitFor(() => expect(m.getLayoutProperty(SHELTER_LAYER_ID, "visibility")).toBe("visible"));
  time = 600; callback?.(time);
  expect(runtime.getRenderedReadiness().ready).toBe(true);
  runtime.dispose();
});

it.each(["gis", "projection"])("%s completes forward and reverse scene transitions with camera updates and shelters", async displayProfile => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const m = setup();
  m.setFilter = (id, filter) => { m.getLayer(id).filter = filter; };
  const runtime = getLayerLifecycleRuntime(m, {
    now: () => Date.now(), requestFrame: fn => m.requestAnimationFrame(fn), cancelFrame: id => m.cancelAnimationFrame(id),
  });
  let narrative = null;
  let projectionMapping = dependencies.getShelterProjectionPresentation();
  const failures = [];
  const diagnostic = vi.fn();
  const context = {
    getLayerGroups: () => groups(), getNarrativeState: () => ({ id: narrative, revision: 1, transition: "enter" }),
    getInvestigationClock: () => ({ phase: "idle" }), getBasemap: () => "dark", subscribe: () => () => {},
  };
  const controller = displayProfile === "projection"
    ? createProjectionNarrativeController({ map: m })
    : createGisNarrativeController({ map: m, managedScene: true });
  const binding = await createNliSceneDisplayBinding({
    map: m, runtime, dataContext: context, narrativeController: controller,
    getTimelineSceneContentKey: getInvestigationSceneContentKey,
    refreshLayers: async () => {
      const layer = { id: "test-road-232", type: "line", paint: { "line-opacity": 1 } };
      const staged = runtime.stageMapLayer("nli.ציר_232", layer);
      if (!m.getLayer(layer.id)) m.addLayer(staged.stagedLayerDef);
      runtime.markMemberReady("nli.ציר_232");
    },
    // Scene cameras move before the new timeline adapter has received its inputs.
    applyDisplay: () => {
      if (displayProfile === "projection") {
        projectionMapping = undefined;
        setTimeout(() => {
          projectionMapping = dependencies.getShelterProjectionPresentation();
          m.emit("nli-shelter-presentation-change");
        }, 200);
      }
      m.emit("move");
    },
    syncTimeline: (snapshot, options) => syncInvestigationTimelineToMap(m, snapshot.investigationClock, snapshot.layerGroups, {
      ...dependencies, ...options, displayProfile,
      getShelterProjectionPresentation: () => projectionMapping, onShelterDiagnostic: diagnostic,
      narrativeFocus: snapshot.narrativeState.id ? { id: snapshot.narrativeState.id } : null,
    }),
    onSceneFailed: failure => failures.push(failure),
  });
  try {
    for (const id of [null, "segev", "nova", "segev", null, "sderot", "nova", "hostages", "hostages_all", null]) {
      narrative = id;
      void binding.request();
      for (let frame = 0; frame < 30; frame++) {
        await vi.advanceTimersByTimeAsync(50);
        m.driveAnimationFrame(Date.now());
      }
      expect(binding.getDisplayedSnapshot().narrativeState.id).toBe(id);
      expect(failures).toEqual([]);
      expect(runtime.getRenderedReadiness().ready).toBe(true);
      expect(Boolean(m.getLayer(SHELTER_LAYER_ID)) && m.getLayoutProperty(SHELTER_LAYER_ID, "visibility") === "visible").toBe(id === null || id === "nova");
    }
    // A new request supersedes a transition while it is still fading.
    for (const id of ["segev", "nova", "segev", "sderot", "hostages", "nova"]) {
      narrative = id; void binding.request();
      await vi.advanceTimersByTimeAsync(100); m.driveAnimationFrame(Date.now());
      m.emit("move");
    }
    for (let frame = 0; frame < 40; frame++) {
      await vi.advanceTimersByTimeAsync(50); m.driveAnimationFrame(Date.now());
    }
    expect(binding.getDisplayedSnapshot().narrativeState.id).toBe("nova");
    expect(failures).toEqual([]);
    expect(runtime.getRenderedReadiness().ready).toBe(true);
    expect(diagnostic).not.toHaveBeenCalled();
  } finally { binding.dispose(); controller.dispose(); runtime.dispose(); }
});
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
  getShelterProjectionPresentation: () => ({ inputCapture: true,
    sourceDimensions: { width: 1920, height: 1080 }, outputResolution: { width: 1920, height: 1080 } }),
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
it.each(["gis", "projection"])("%s focuses the selected person's shelter only in the Identity scene", async displayProfile => {
  const m = setup();
  const identity = groups();
  identity[0].layers.push({ id: "people", enabled: true });
  let personId = null;
  const deps = { ...dependencies, displayProfile, getPersonSelection: () => ({ personId }) };
  await syncInvestigationTimelineToMap(m, null, identity, deps);
  await vi.waitFor(() => expect(m.getSource(SHELTER_SOURCE_ID)?.data.features).toHaveLength(9));
  expect(m.getPaintProperty(SHELTER_LAYER_ID, "icon-opacity")).toBe(1);

  personId = fixture.shelters[0].personPids[0];
  await syncInvestigationTimelineToMap(m, null, identity, deps);
  expect(m.getPaintProperty(SHELTER_LAYER_ID, "icon-opacity")).toEqual([
    "case", ["in", ["get", "shelterId"], ["literal", [fixture.shelters[0].id]]], 1, 0,
  ]);
  expect(m.getPaintProperty(SHELTER_LAYER_ID, "icon-opacity-transition")).toEqual({ duration: 400, delay: 0 });

  personId = "person-without-shelter";
  await syncInvestigationTimelineToMap(m, null, identity, deps);
  expect(m.getPaintProperty(SHELTER_LAYER_ID, "icon-opacity")).toBe(0);

  personId = null;
  await syncInvestigationTimelineToMap(m, null, identity, deps);
  expect(m.getPaintProperty(SHELTER_LAYER_ID, "icon-opacity")).toBe(1);

  personId = fixture.shelters[0].personPids[0];
  await syncInvestigationTimelineToMap(m, null, groups(), deps);
  expect(m.getPaintProperty(SHELTER_LAYER_ID, "icon-opacity")).toBe(1);
});
it("composes shelter focus fading with the scene lifecycle", async () => {
  const m = setup();
  let time = 0, callback;
  const runtime = getLayerLifecycleRuntime(m, {
    now: () => time,
    requestFrame: fn => { callback = fn; return 1; }, cancelFrame: () => {},
  });
  runtime.setDesiredIds(["nli.shelters232"], { durationMs: 0, requiredIds: ["nli.shelters232"] });
  const identity = groups();
  identity[0].layers.push({ id: "people", enabled: true });
  let personId = null;
  const deps = { ...dependencies, joinBatch: true, getPersonSelection: () => ({ personId }) };
  await syncInvestigationTimelineToMap(m, null, identity, deps);
  await vi.waitFor(() => expect(m.getSource(SHELTER_SOURCE_ID)?.data.features).toHaveLength(9));
  runtime.commitBatch();
  expect(runtime.getRenderedReadiness().ready).toBe(true);

  personId = fixture.shelters[0].personPids[0];
  await syncInvestigationTimelineToMap(m, null, identity, { ...deps, joinBatch: false });
  time = 200; callback(time);
  expect(m.getPaintProperty(SHELTER_LAYER_ID, "icon-opacity")).not.toBe(1);
  time = 400; callback(time);
  expect(m.getPaintProperty(SHELTER_LAYER_ID, "icon-opacity")).toEqual([
    "case", ["in", ["get", "shelterId"], ["literal", [fixture.shelters[0].id]]], 1, 0,
  ]);
  runtime.dispose();
});
it.each(["gis", "projection"])("%s combines destinations with contact and resets scene-specific victim state", async displayProfile => {
  const m = setup();
  const deps = { ...dependencies, displayProfile, narrativeFocus: { id: "nova" } };
  await syncInvestigationTimelineToMap(m, null, groups(), deps);
  await vi.waitFor(() => expect(m.getSource(SHELTER_SOURCE_ID)?.data.features).toHaveLength(9));
  const red = () => m.getSource(SHELTER_SOURCE_ID).data.features.filter(f => f.properties.impacted).map(f => f.id);
  expect(red()).toEqual([]);
  publishNovaShelterDestinations(m, { routeSHA256: "accepted", completedRouteIds: ["19"] });
  expect(red()).toEqual([fixture.shelters[0].id]);
  const polygon = { properties: { OBJECTID: 97, timeline_minutes: 492 }, geometry: {
    type: "Polygon", coordinates: [[[34,31],[35,31],[35,32],[34,32],[34,31]]],
  } };
  await syncInvestigationTimelineToMap(m, { phase: "ended", beats: [492,506,540,630,720], membership: ["nli.investigation_polygons"] }, groups(true,true), {
    ...deps, featuresById: { ...deps.featuresById, "nli.investigation_polygons": [polygon] },
  });
  publishNovaShelterDestinations(m, null);
  expect(red()).toHaveLength(9);
  const victims = groups(); victims[0].layers.push({ id: "people", enabled: true });
  await syncInvestigationTimelineToMap(m, { phase: "ended", beats: [492,506,540,630,720], membership: ["nli.investigation_polygons", "nli.lines"] }, victims, deps);
  expect(red()).toHaveLength(9);
  await syncInvestigationTimelineToMap(m, null, victims, { ...dependencies, displayProfile });
  expect(red()).toHaveLength(9);
  await syncInvestigationTimelineToMap(m, null, groups(), { ...dependencies, displayProfile });
  expect(red()).toEqual([]);
});
it("general timeline reveals all victim shelters at noon and reverses on an earlier beat without fleeing routes", async () => {
  const m = setup(), visible = groups(true, true);
  const clock = playNliClock(null, ["nli.investigation_polygons"], [630, 720, 780], 0);
  await syncInvestigationTimelineToMap(m, seekNliClock(clock, 0, 0), visible, dependencies);
  await vi.waitFor(() => expect(m.getSource(SHELTER_SOURCE_ID)?.data.features).toHaveLength(9));
  const redCount = () => m.getSource(SHELTER_SOURCE_ID).data.features.filter(f => f.properties.impacted).length;
  expect(redCount()).toBe(0);
  await syncInvestigationTimelineToMap(m, seekNliClock(clock, 1, 0), visible, dependencies);
  expect(redCount()).toBe(9);
  await syncInvestigationTimelineToMap(m, seekNliClock(clock, 0, 0), visible, dependencies);
  expect(redCount()).toBe(0);
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
