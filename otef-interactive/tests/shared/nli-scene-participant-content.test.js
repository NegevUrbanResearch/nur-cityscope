import { afterEach, expect, it, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";
import { createNliSceneDisplayBinding } from "../../frontend/src/shared/nli-scene-display-binding.js";
import { createGisNarrativeController } from "../../frontend/src/map/nli-narrative-controller.js";
import * as timeline from "../../frontend/src/shared/maplibre-investigation-timeline.js";
import { getNarrativeSceneContentKey } from "../../frontend/src/shared/maplibre-narrative-focus.js";
import { getNliNarrative } from "../../frontend/src/shared/nli-narratives.js";

afterEach(() => vi.useRealTimers());
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
const cohort = ["projector_base.ישובים", "projector_base.שמות_יישובים", "projector_base.Locations_Lines"];
async function harness({ narrative = "nova", people = false } = {}) {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const map = createFakeMapLibreMap();
  const ids = ["nli.investigation_polygons", "nli.lines", "projector_base.כביש_232", ...cohort, ...(people ? ["nli.people"] : [])];
  const state = { groups: [
    { id: "nli", layers: [{ id: "investigation_polygons", enabled: true }, { id: "lines", enabled: true }, { id: "people", enabled: people }] },
    { id: "projector_base", layers: ["כביש_232", "ישובים", "שמות_יישובים", "Locations_Lines"].map(id => ({ id, enabled: true })) },
  ], narrative: { id: narrative, revision: 1, transition: narrative ? "enter" : "exit" }, overlay: { individual: false }, clock: { phase: "ended", revision: 1 } };
  const runtime = getLayerLifecycleRuntime(map, { now: () => Date.now(), requestFrame: cb => map.requestAnimationFrame(cb), cancelFrame: id => map.cancelAnimationFrame(id) });
  const clocks = [], appliedRuns = [], held = { escape: 0, mor: 0 };
  let run = 0, requested = false;
  const escape = {
    captureSceneInput(snapshot) { const on = snapshot.escapeOverlay.individual === true; if (on && !requested) run++; requested = on; return { ...snapshot, escapePlaybackRun: run }; },
    getSceneIds: snapshot => snapshot.escapeOverlay.individual ? ["nli-nova-escape-individual"] : [],
    getSceneContentKey: (snapshot, id) => id === "nli-nova-escape-individual" ? snapshot.escapePlaybackRun : undefined,
    holdForScene() { held.escape++; },
    applySnapshot(snapshot) { appliedRuns.push(snapshot.escapePlaybackRun); if (snapshot.escapeOverlay.individual) { const id = "nli-nova-escape-individual"; if (!map.getLayer(id)) map.addLayer({ id, type: "line", paint: { "line-opacity": 1 } }); runtime.stageMapLayer(id, map.getLayer(id)); runtime.markMemberReady(id); } },
  };
  const mor = { getSceneIds: () => ["nli.mor-route"], holdForScene() { held.mor++; }, applySnapshot() { const id = "nli.mor-route"; if (!map.getLayer(id)) map.addLayer({ id, type: "line", paint: { "line-opacity": 1 } }); runtime.stageMapLayer(id, map.getLayer(id)); runtime.markMemberReady(id); } };
  for (const id of ids) { map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } }); map.addLayer({ id, source: id, type: "fill", paint: { "fill-opacity": 1 } }); }
  const controller = createGisNarrativeController({ map, managedScene: true, storage: null });
  const binding = await createNliSceneDisplayBinding({ map, runtime, narrativeController: controller, escapeCoordinator: escape, morCoordinator: mor,
    dataContext: { getLayerGroups: () => state.groups, getNarrativeState: () => state.narrative, getEscapeOverlay: () => state.overlay, getInvestigationClock: () => state.clock },
    refreshLayers: async () => { for (const id of ids) { runtime.stageMapLayer(id, map.getLayer(id)); runtime.markMemberReady(id); } },
    getTimelineSceneContentKey: (snapshot, id) => timeline.getInvestigationSceneContentKey?.(snapshot, id),
    syncTimeline: async snapshot => clocks.push(snapshot.clock || snapshot.investigationClock),
  });
  await flush();
  return { state, map, runtime, binding, clocks, held, appliedRuns,
    async request() { const result = binding.request(); await flush(); return result; },
    async advance(ms) { await vi.advanceTimersByTimeAsync(ms); map.driveAnimationFrame(Date.now()); await flush(); },
    close() { binding.dispose(); controller.dispose(); runtime.dispose(); },
  };
}

it("escape-only membership retains polygon source, static factors and continuing Mor reveal", async () => {
  const h = await harness(); const source = h.map.getSource("nli.investigation_polygons"); const clockCount = h.clocks.length;
  h.state.overlay.individual = true; h.binding.request(); await flush(); await h.advance(300);
  for (const id of ["nli.investigation_polygons", "nli.lines", "projector_base.כביש_232", ...cohort]) expect(h.map.getPaintProperty(id, "fill-opacity")).toBe(1);
  expect(h.map.getSource("nli.investigation_polygons")).toBe(source);
  expect(h.held.mor).toBe(0);
  expect(h.clocks.slice(clockCount).some(clock => clock.phase === "paused")).toBe(false);
  await h.advance(600); h.state.overlay.individual = false; h.binding.request(); await flush(); await h.advance(300);
  expect(h.map.getPaintProperty("nli.investigation_polygons", "fill-opacity")).toBe(1); h.close();
});

it("narrative replacement fades all present settlement participants in one phase", async () => {
  const h = await harness({ narrative: "segev" });
  h.state.narrative = { id: "nova", revision: 2, transition: "enter" }; h.binding.request(); await flush(); await h.advance(300);
  for (const id of cohort) expect(h.map.getPaintProperty(id, "fill-opacity")).toBeCloseTo(.5);
  await h.advance(300); for (const id of cohort) expect(h.map.getPaintProperty(id, "fill-opacity")).toBe(0);
  await h.advance(300); for (const id of cohort) expect(h.map.getPaintProperty(id, "fill-opacity")).toBeCloseTo(.5);
  await h.advance(300); for (const id of cohort) expect(h.map.getPaintProperty(id, "fill-opacity")).toBe(1); h.close();
});

it("Identity overview to Home retains the full-opacity settlement policy", async () => {
  const h = await harness({ narrative: null, people: true });
  h.state.groups[0].layers.find(layer => layer.id === "people").enabled = false; h.binding.request(); await flush(); await h.advance(300);
  for (const id of cohort) expect(h.map.getPaintProperty(id, "fill-opacity")).toBe(1); h.close();
});

it("captures replay intent before same-public-scene requests coalesce", async () => {
  const h = await harness(); h.state.overlay.individual = true; h.binding.request(); await flush(); await h.advance(600);
  h.state.overlay.individual = false; h.binding.request(); await flush(); await h.advance(200);
  h.state.overlay.individual = true; h.binding.request(); await flush();
  await h.advance(600); await h.advance(600);
  expect(h.appliedRuns.at(-1)).toBe(2); h.close();
});

it.each(["paused", "ended", "playing"])("ordinary %s transport and selection preserve participant factors", async phase => {
  const h = await harness(); h.state.clock = { phase, positionMs: 500, anchorMs: 0, revision: 9, seekKind: "jump" }; h.binding.request(); await flush();
  expect(h.runtime.getPendingBatch()).toBeNull(); for (const id of cohort) expect(h.map.getPaintProperty(id, "fill-opacity")).toBe(1); h.close();
});

it("content ownership uses actual narrative filters and orientation policy", () => {
  const segev = { narrativeState: { id: "segev" }, layerGroups: [], escapeOverlay: {}, investigationClock: {} };
  const sderot = { ...segev, narrativeState: { id: "sderot", revision: 7 } };
  expect(getNarrativeSceneContentKey(segev, "nli.people")).toBe(getNarrativeSceneContentKey(sderot, "nli.people"));
  expect(getNarrativeSceneContentKey(segev, "nli.narrative_polygon")).not.toBe(getNarrativeSceneContentKey(sderot, "nli.narrative_polygon"));
  expect(getNarrativeSceneContentKey(segev, "nli.lines")).toBeUndefined();
  expect(timeline.getInvestigationSceneContentKey(segev, "nli.lines")).toBe(timeline.getInvestigationSceneContentKey(sderot, "nli.lines"));
  expect(timeline.getInvestigationSceneContentKey(segev, "projector_base.כביש_232")).toBeUndefined();
  const semantic = { ...segev, narrativeState: { id: "segev", revision: 99 }, escapeOverlay: { individual: true, mor: true }, investigationClock: { phase: "playing", positionMs: 99, hiddenDisplays: ["projection"] }, personSelection: { personId: "x" } };
  for (const id of cohort) expect(timeline.getInvestigationSceneContentKey(segev, id)).toBe(timeline.getInvestigationSceneContentKey(semantic, id));
});

it("real polygon category and gradient sources remain mounted through escape controls", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const map = createFakeMapLibreMap();
  const runtime = getLayerLifecycleRuntime(map, { now: () => Date.now(), requestFrame: cb => map.requestAnimationFrame(cb), cancelFrame: id => map.cancelAnimationFrame(id) });
  const feature = { type: "Feature", properties: { OBJECTID: 99, Notes: "מרחב לחימה - קרב", timeline_minutes: 500 }, geometry: { type: "Polygon", coordinates: [[[34.4,31.4],[34.5,31.4],[34.5,31.5],[34.4,31.4]]] } };
  const style = { renderer: "uniqueValue", uniqueValues: { field: "Notes", classes: [{ value: "מרחב לחימה - קרב", symbol: { symbolLayers: [{ type: "fill", fillType: "gradient", interval: 1, resolvedColors: ["#8e0912"], resolvedOpacities: [.55], opacity: .55 }] } }] } };
  const state = { overlay: {} };
  const groups = [{ id: "nli", layers: [{ id: "investigation_polygons", enabled: true }] }];
  const binding = await createNliSceneDisplayBinding({ map, runtime,
    dataContext: { getLayerGroups: () => groups, getNarrativeState: () => ({ id: "nova", revision: 1 }), getEscapeOverlay: () => state.overlay, getInvestigationClock: () => ({ phase: "ended", membership: ["nli.investigation_polygons"], beats: [500] }) },
    escapeCoordinator: {
      getSceneIds: snapshot => snapshot.escapeOverlay.individual ? ["nli-nova-escape-individual"] : [],
      applySnapshot(snapshot) { if (snapshot.escapeOverlay.individual) { const id = "nli-nova-escape-individual"; if (!map.getLayer(id)) map.addLayer({ id, type: "line", paint: { "line-opacity": 1 } }); runtime.stageMapLayer(id, map.getLayer(id)); runtime.markMemberReady(id); } },
    },
    getTimelineSceneContentKey: timeline.getInvestigationSceneContentKey,
    syncTimeline: (snapshot, options) => timeline.syncInvestigationTimelineToMap(map, snapshot.investigationClock, snapshot.layerGroups, {
      ...options, narrativeFocus: getNliNarrative("nova"), featuresById: { "nli.investigation_polygons": [feature] }, settlementFeatures: [], polygonStyle: style,
      bufferedGradientFeatures: [{ ...feature, properties: { ...feature.properties, __cim_gradient_band: 0 } }], bufferedGradientSidecarStatus: "ready",
      motionMode: "reduced", now: () => Date.now(), requestAnimationFrame: cb => map.requestAnimationFrame(cb), cancelAnimationFrame: id => map.cancelAnimationFrame(id),
    }),
  });
  await flush();
  const handles = ["nli-investigation-polygon-category", "nli-investigation-polygon-buffered-gradient"].map(id => [id, map.getSource(id)]);
  handles.forEach(([, source]) => expect(source).toBeTruthy());
  const removals = () => map.calls.filter(call => ["removeLayer", "removeSource"].includes(call.method) && call.id.startsWith("nli-investigation-polygon"));
  const removed = removals().length;
  for (const individual of [true, false, true]) { state.overlay = { individual }; binding.request(); await flush(); await vi.advanceTimersByTimeAsync(600); map.driveAnimationFrame(Date.now()); await flush(); for (const [id, source] of handles) expect(map.getSource(id)).toBe(source); }
  expect(removals()).toHaveLength(removed);
  binding.dispose(); timeline.disposeInvestigationTimelineForMap(map); runtime.dispose();
});

it("manual completion adopts physical basemap membership and preserves all other participants", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const map = createFakeMapLibreMap({ layers: [{ id: "story", type: "fill", paint: { "fill-opacity": 1 } }, { id: "dark", type: "fill", paint: { "fill-opacity": 1 } }] });
  const runtime = getLayerLifecycleRuntime(map);
  const state = { requested: "dark", physical: "dark", hold: undefined };
  const binding = await createNliSceneDisplayBinding({ map, runtime,
    dataContext: { getLayerGroups: () => [{ id: "nli", layers: [{ id: "story", enabled: true }] }], getBasemap: () => state.requested, getInvestigationClock: () => ({ phase: "idle", presentationPendingUntilMs: state.hold }) },
    refreshLayers() { runtime.stageMapLayer("nli.story", map.getLayer("story")); runtime.markMemberReady("nli.story"); },
    prepareBasemap: async id => ({ mount() { runtime.stageMapLayer("nli.basemap." + id, map.getLayer(id)); runtime.markMemberReady("nli.basemap." + id); } }),
    applyBasemap: prepared => prepared.mount(), getDisplayedBasemap: () => state.physical,
  });
  await flush(); state.requested = "osm"; binding.request(); await flush(); state.physical = "osm";
  map.addLayer({ id: "osm", type: "raster", paint: { "raster-opacity": 1 } });
  const adopt = vi.fn(({ runtime: owner }) => {
    owner.dropChannels("nli.basemap.dark");
    owner.stageMapLayer("nli.basemap.osm", map.getLayer("osm"), { adoptVisible: true });
    const ids = owner.getDesiredIds().filter(id => !id.startsWith("nli.basemap.")).concat("nli.basemap.osm");
    owner.setDesiredIds(ids, { durationMs: 0, requiredIds: ids }); owner.markMemberReady("nli.basemap.osm"); owner.commitBatch(); return true;
  });
  expect(binding.adoptManualBasemap?.("osm", adopt)).toBe(true);
  expect(runtime.getDesiredIds()).toEqual(["nli.story", "nli.basemap.osm"]);
  expect(map.getPaintProperty("story", "fill-opacity")).toBe(1);
  expect(binding.getRenderSnapshot().basemapId).toBe("osm");
  state.hold = 15000; binding.request(); await flush();
  expect(binding.adoptManualBasemap("osm", adopt)).toBe(false); expect(adopt).toHaveBeenCalledTimes(1);
  binding.dispose(); runtime.dispose();
});
