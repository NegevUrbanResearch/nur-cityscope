import { afterEach, expect, it, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";
import { createNliSceneDisplayBinding } from "../../frontend/src/shared/nli-scene-display-binding.js";
import { createNliNameFieldController } from "../../frontend/src/shared/nli-name-field-controller.js";
import { isolateLayersWhileVictimNamesShown } from "../../frontend/src/shared/nli-victim-name-layer-isolation.js";
import { syncProjectionModelImage } from "../../frontend/src/projection/projection-model-image.js";
import { DEFAULT_PROJECTION_CONFIG } from "../../frontend/src/shared/projection-config-schema.js";

afterEach(() => vi.useRealTimers());
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const homeIds = ["projector_base.SEA", "geometry.house", "labels.place", "projector_base.model_base"];
const namesId = "nli.people_names";
const groups = names => [
  ...homeIds.map(id => { const [group, layer] = id.split("."); return { id: group, layers: [{ id: layer, enabled: true }] }; }),
  { id: "nli", layers: [{ id: "people_names", enabled: names }] },
];
const field = () => {
  const feature = { type: "Feature", properties: { pid: "p1", name: "Name", visible_spans: ["left"] }, geometry: { type: "Point", coordinates: [34,31] } };
  return { geojson: { type: "FeatureCollection", features: [feature] }, byPid: new Map([["p1", { feature, sourceCoordinates: [34,31] }]]),
    diagnostics: { total: 1, placed: 1, unplaced: [] }, datasetVersion: "accepted", fontSize: 12, referenceZoom: 10, heading: 35 };
};
async function harness(loadField = async () => field(), { markers = false } = {}) {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const map = createFakeMapLibreMap(); map.getZoom = () => 10; map.getBearing = () => 0; map.getPitch = () => 0; map.getCenter = () => ({ lng: 34, lat: 31 });
  map.setFilter = (id, filter) => { map.getLayer(id).filter = filter; };
  map.getContainer = () => ({ dataset: {} });
  const runtime = getLayerLifecycleRuntime(map, { now: () => Date.now(), requestFrame: cb => map.requestAnimationFrame(cb), cancelFrame: id => map.cancelAnimationFrame(id) });
  for (const id of homeIds) {
    map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id, source: id, type: "fill", paint: { "fill-opacity": 1 } });
    runtime.stageMapLayer(id, map.getLayer(id), { adoptVisible: true });
  }
  const image = { style: { opacity: "1" }, complete: true, naturalWidth: 100 };
  let raw = groups(false), command = null;
  if (markers) {
    raw.find(group => group.id === "nli").layers.push({ id: "people", enabled: true });
    map.addLayer({ id: "people", type: "circle", paint: { "circle-opacity": 1 } });
    runtime.stageMapLayer("nli.people", map.getLayer("people"), { adoptVisible: true });
  }
  const context = { getLayerGroups: () => raw, getInvestigationClock: () => ({ phase: "idle" }),
    getPersonSelection: () => ({}), subscribe: () => () => {} };
  const controller = createNliNameFieldController({ map, context, loadField, managedScene: true, motionMode: "full" });
  controller.setProjectionConfig(DEFAULT_PROJECTION_CONFIG, 1);
  let namesFactor = 0; const recordFactor = value => { namesFactor = value; };
  const binding = await createNliSceneDisplayBinding({ map, dataContext: context, runtime,
    filterGroups: isolateLayersWhileVictimNamesShown,
    getPresentationCommand: () => command,
    refreshLayers: async ({ groupsOverride }) => {
      syncProjectionModelImage({ map, imageEl: image, layerGroups: groupsOverride, modelInfo: { durationMs: 600 }, sealBatch: false });
      const desired = groupsOverride.flatMap(g => g.layers.filter(l => l.enabled).map(l => g.id + "." + l.id));
      for (const id of homeIds) if (desired.includes(id)) { runtime.stageMapLayer(id, map.getLayer(id)); runtime.markMemberReady(id); }
      if (desired.includes("nli.people")) { runtime.stageMapLayer("nli.people", map.getLayer("people")); runtime.markMemberReady("nli.people"); }
    },
    prepareDisplay: (snapshot, options) => controller.prepareScene(snapshot, options),
    applyDisplay: (prepared, options) => { controller.applyScene(prepared, { ...options, runtime }); if (runtime.getDesiredIds().includes(namesId)) runtime.registerOpacityTarget(namesId, recordFactor); },
    discardDisplay: prepared => controller.discardScene(prepared),
  });
  await flush();
  return { map, runtime, controller, binding, image, factor: () => namesFactor,
    wall(value) { raw = groups(value); return binding.request(); },
    presentation(value) { command = value; return binding.request(); },
    async advance(ms) { await vi.advanceTimersByTimeAsync(ms); map.driveAnimationFrame(Date.now()); await flush(); },
    close() { binding.dispose(); controller.dispose(); runtime.dispose(); },
  };
}
it("Identity markers finish exiting before the names field starts, without revealing Home between them", async () => {
  const h = await harness(undefined, { markers: true }); const pending = h.wall(true); await flush();
  await h.advance(300);
  expect(h.map.getPaintProperty("people", "circle-opacity")).toBeCloseTo(.5);
  expect(h.factor()).toBe(0); expect(h.map.getSource("nli-name-field")).toBeFalsy();
  await h.advance(300);
  expect(h.map.getPaintProperty("people", "circle-opacity")).toBe(0);
  for (const id of homeIds) expect(h.map.getPaintProperty(id, "fill-opacity")).toBe(0);
  await h.advance(300); expect(h.factor()).toBeCloseTo(.5);
  await h.advance(300); await pending; h.close();
});
it("Home resources and legacy names share one crossfade and inverse without removal at positive opacity", async () => {
  const h = await harness(); const pending = h.wall(true); await flush();
  await h.advance(300);
  for (const id of homeIds) { expect(h.map.getLayer(id)).toBeTruthy(); expect(h.map.getPaintProperty(id, "fill-opacity")).toBeCloseTo(.5); }
  expect(Number(h.image.style.opacity)).toBeCloseTo(.5);
  expect(h.factor()).toBeCloseTo(.5);
  expect(h.map.getSource("nli-name-field")).toBeTruthy();
  await h.advance(300); await pending;
  const inverse = h.wall(false); await flush(); await h.advance(300);
  expect(h.map.getSource("nli-name-field")).toBeTruthy();
  expect(Number(h.image.style.opacity)).toBeCloseTo(.5);
  expect(h.factor()).toBeCloseTo(.5);
  for (const id of homeIds) expect(h.map.getPaintProperty(id, "fill-opacity")).toBeCloseTo(.5);
  await h.advance(300); await inverse; expect(h.map.getSource("nli-name-field")).toBeFalsy(); h.close();
});
it("cold preparation failure preserves Home resources and a late cancelled candidate cannot mount", async () => {
  let resolve;
  const h = await harness(() => new Promise(r => { resolve = r; }));
  const pending = h.wall(true); await flush();
  for (const id of homeIds) expect(h.map.getPaintProperty(id, "fill-opacity")).toBe(1);
  h.wall(false); await flush(); resolve(field()); await flush();
  await expect(pending).resolves.toEqual({ status: "cancelled" });
  expect(h.map.getSource("nli-name-field")).toBeFalsy(); h.close();
});
it("same-session close removes visible presentation intent from structural snapshot", async () => {
  const h = await harness();
  const open = { presentationAction: "open", segmentId: "names_wall", presentationSessionId: "a" };
  await h.presentation(open); await flush();
  expect(h.binding.getRenderSnapshot().presentationCommand).toEqual(open);
  await h.presentation({ ...open, presentationAction: "close" }); await flush();
  expect(h.binding.getRenderSnapshot().presentationCommand).toBeNull(); h.close();
});

it("failed cold names preparation retains every outgoing Home resource", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const h = await harness(async () => { throw new Error("cold candidate failed"); });
  await expect(h.wall(true)).resolves.toEqual({ status: "failed" });
  for (const id of homeIds) expect(h.map.getPaintProperty(id, "fill-opacity")).toBe(1);
  expect(h.image.style.opacity).toBe("1");
  expect(h.map.getSource("nli-name-field")).toBeFalsy(); h.close(); warning.mockRestore();
});
