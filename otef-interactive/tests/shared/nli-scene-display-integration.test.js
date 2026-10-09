import { afterEach, expect, it, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { createGisNarrativeController } from "../../frontend/src/map/nli-narrative-controller.js";
import { getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";

afterEach(() => vi.useRealTimers());
it("managed narratives do not independently subscribe to raw escape flags", () => {
  const subscribe = vi.fn();
  const controller = createGisNarrativeController({ map: createFakeMapLibreMap(), dataContext: { subscribe }, managedScene: true });
  expect(subscribe).not.toHaveBeenCalledWith("escapeOverlay", expect.any(Function));
  controller.dispose();
});
it("managed focus paint joins the real runtime instead of appearing at authored opacity", () => {
  const map = createFakeMapLibreMap();
  const runtime = getLayerLifecycleRuntime(map);
  runtime.setDesiredIds(["nli.scene-focus"], { durationMs: 600, requiredIds: ["nli.scene-focus"] });
  const controller = createGisNarrativeController({ map, managedScene: true });
  controller.apply({ id: "segev", revision: 1, transition: "enter" });
  expect(map.getPaintProperty("nli-narrative-focus-label", "text-opacity")).toBe(0);
  controller.dispose(); runtime.dispose();
});
async function flush() { for (let i = 0; i < 35; i++) await Promise.resolve(); }
async function bindingHarness({ fail = false } = {}) {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const map = createFakeMapLibreMap({ layers: [{ id: "people", type: "circle", source: "nli.people", paint: { "circle-opacity": 1 } }] });
  map.setFilter = (id, filter) => { map.getLayer(id).filter = filter; };
  const runtimeForStyle = () => getLayerLifecycleRuntime(map, { now: () => Date.now(), requestFrame: callback => map.requestAnimationFrame(callback), cancelFrame: id => map.cancelAnimationFrame(id) });
  const runtime = runtimeForStyle();
  runtime.setDesiredIds(["nli.people"], { durationMs: 0 });
  runtime.stageMapLayer("nli.people", map.getLayer("people"), { adoptVisible: true }); runtime.commitBatch();
  const state = { layerGroups: [{ id: "nli", layers: [{ id: "people", enabled: true }] }], narrativeState: { id: "segev", revision: 1, transition: "enter" }, escapeOverlay: {}, investigationClock: { phase: "idle" }, personSelection: {}, basemap: "dark" };
  const listeners = new Map();
  const context = Object.fromEntries(Object.keys(state).map(key => ["get" + key[0].toUpperCase() + key.slice(1), () => state[key]]));
  context.subscribe = (topic, callback) => { listeners.set(topic, callback); return () => listeners.delete(topic); };
  const controller = createGisNarrativeController({ map, managedScene: true });
  let failures = fail ? 1 : 0;
  const manual = [], clocks = [], groups = [];
  const { createNliSceneDisplayBinding } = await import("../../frontend/src/shared/nli-scene-display-binding.js");
  const binding = await createNliSceneDisplayBinding({ map, dataContext: context, runtime, runtimeForStyle,
    narrativeController: controller,
    refreshLayers: async ({ groupsOverride }) => { groups.push(groupsOverride); const active = runtimeForStyle(); active.stageMapLayer("nli.people", map.getLayer("people")); if (failures-- > 0) active.markMemberFailed("nli.people"); else active.markMemberReady("nli.people"); },
    syncTimeline: async snapshot => { clocks.push(snapshot.investigationClock); },
    requestManualBasemap: value => { manual.push(value); },
  });
  return { map, runtime, state, binding, clocks, groups, manual,
    failNextMounts(count) { failures = count; },
    emit(topic) { listeners.get(topic)?.(state[topic]); },
    async advance(ms) { await vi.advanceTimersByTimeAsync(ms); map.driveAnimationFrame(Date.now()); await flush(); },
    close() { binding.dispose(); controller.dispose(); runtimeForStyle().dispose(); },
  };
}
it("captures mutable groups and holds real focus/filter/timeline inputs until common exit reaches zero", async () => {
  const h = await bindingHarness();
  const filter = h.map.getLayer("people").filter;
  const focus = h.map.getSource("nli-narrative-focus").data;
  h.state.investigationClock = { phase: "paused", presentationPendingUntilMs: 15000 }; h.emit("investigationClock");
  h.state.layerGroups[0].layers[0].enabled = false; h.emit("layerGroups");
  h.state.narrativeState = { id: "nova", revision: 2, transition: "enter" }; h.emit("narrativeState");
  await flush();
  expect(h.binding.getDisplayedSnapshot().layerGroups[0].layers[0].enabled).toBe(true);
  expect(h.map.getLayer("people").filter).toEqual(filter);
  expect(h.map.getSource("nli-narrative-focus").data).toBe(focus);
  h.state.layerGroups[0].layers[0].enabled = true;
  h.state.investigationClock = { phase: "paused", positionMs: 400 }; h.emit("investigationClock"); await flush();
  await h.advance(300);
  expect(h.map.getSource("nli-narrative-focus").data).toBe(focus);
  expect(h.map.getPaintProperty("people", "circle-opacity")).toBeCloseTo(.5);
  expect(h.map.getPaintProperty("nli-narrative-focus-label", "text-opacity")).toBeCloseTo(.5);
  await h.advance(300);
  expect(h.map.getSource("nli-narrative-focus").data.features[0].properties.label).not.toBe(focus.features[0].properties.label);
  await h.advance(600);
  expect(h.binding.getDisplayedSnapshot().narrativeState.id).toBe("nova");
  expect(h.clocks.at(-1).positionMs).toBe(400); h.close();
});
it("ordinary manual basemap then Pause and selection never starts a scene fade", async () => {
  const h = await bindingHarness();
  h.state.basemap = "satellite_bw"; h.emit("basemap"); await flush();
  h.state.investigationClock = { phase: "paused" }; h.emit("investigationClock");
  h.state.personSelection = { personId: "p1" }; h.emit("personSelection"); await flush();
  expect(h.manual).toEqual(["satellite_bw"]);
  expect(h.runtime.getPendingBatch()).toBeNull();
  expect(h.binding.getDisplayedSnapshot().basemapId).toBe("satellite_bw");
  expect(h.map.getPaintProperty("people", "circle-opacity")).toBe(1); h.close();
});
it("shared-ID replacement failure restores real focus inputs and does not reveal partial content", async () => {
  const h = await bindingHarness();
  const old = h.map.getSource("nli-narrative-focus").data;
  h.state.narrativeState = { id: "nova", revision: 2, transition: "enter" }; h.emit("narrativeState"); await flush();
  // Inject source failure after replacement mounts, not into the preparation.
  const mount = h.map.addSource.bind(h.map);
  h.map.addSource = (id, spec) => { mount(id, spec); if (id === "nli-narrative-focus" && spec.data.features[0]?.properties.label !== old.features[0].properties.label) queueMicrotask(() => h.map.emit("error", { sourceId: "nli-narrative-focus" })); };
  await h.advance(600); await h.advance(600);
  expect(h.binding.getDisplayedSnapshot().narrativeState.id).toBe("segev");
  expect(h.map.getSource("nli-narrative-focus").data.features[0].properties.label).toBe(old.features[0].properties.label); h.close();
});
it("managed escape and Mor controllers have supplied-snapshot paths and no raw topic route", async () => {
  const { createNovaEscapeCoordinator } = await import("../../frontend/src/shared/nli-nova-escape-coordinator.js");
  const { createMorRouteCoordinator } = await import("../../frontend/src/shared/nli-mor-route-coordinator.js");
  const subscribe = vi.fn(); const map = createFakeMapLibreMap();
  const escape = createNovaEscapeCoordinator({ map, managedScene: true, dataContext: { subscribe }, surface: "gis" });
  const mor = createMorRouteCoordinator({ map, managedScene: true, dataContext: { subscribe } });
  expect(subscribe).not.toHaveBeenCalled();
  expect(escape.prepareSnapshot).toBeTypeOf("function"); expect(mor.prepareSnapshot).toBeTypeOf("function");
  escape.dispose(); mor.dispose();
});
it("restoration failure leaves the affected real paint group hidden and reports once", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const h = await bindingHarness(); h.failNextMounts(2);
  h.state.narrativeState = { id: "nova", revision: 2, transition: "enter" }; h.emit("narrativeState"); await flush();
  await h.advance(600); await h.advance(1800);
  expect(h.binding.getDisplayedSnapshot().narrativeState.id).toBe("segev");
  expect(h.map.getPaintProperty("people", "circle-opacity")).toBe(0);
  expect(h.map.getPaintProperty("nli-narrative-focus-label", "text-opacity")).toBe(0);
  expect(warning).toHaveBeenCalledTimes(1); const mounts = h.groups.length;
  await h.advance(15000); expect(h.groups.length).toBe(mounts); h.close(); warning.mockRestore();
});
it("200 ms reversal retains the same outgoing content and samples a continuous factor", async () => {
  const h = await bindingHarness(); const old = h.map.getSource("nli-narrative-focus").data;
  h.state.narrativeState = { id: "nova", revision: 2, transition: "enter" }; h.emit("narrativeState"); await flush(); await h.advance(200);
  const factor = h.map.getPaintProperty("people", "circle-opacity");
  h.state.narrativeState = { id: "segev", revision: 3, transition: "enter" }; h.emit("narrativeState"); await flush();
  expect(h.map.getPaintProperty("people", "circle-opacity")).toBeCloseTo(factor);
  expect(h.map.getSource("nli-narrative-focus").data).toBe(old);
  await h.advance(600); expect(h.binding.getDisplayedSnapshot().narrativeState.id).toBe("segev"); h.close();
});
it("returning after replacement exits the mounted content before restoring latest content", async () => {
  const h = await bindingHarness();
  h.state.narrativeState = { id: "nova", revision: 2, transition: "enter" }; h.emit("narrativeState"); await flush(); await h.advance(600); await h.advance(200);
  const nova = h.map.getSource("nli-narrative-focus").data;
  h.state.narrativeState = { id: "segev", revision: 3, transition: "enter" }; h.emit("narrativeState"); await flush();
  expect(h.map.getSource("nli-narrative-focus").data).toBe(nova);
  await h.advance(600); expect(h.map.getSource("nli-narrative-focus").data.features[0].properties.label).not.toBe(nova.features[0].properties.label);
  await h.advance(600); expect(h.binding.getDisplayedSnapshot().narrativeState.id).toBe("segev"); h.close();
});
it("style replacement cancels old callbacks and remounts a functioning coordinator", async () => {
  const h = await bindingHarness();
  const stale = [...h.map._listeners.get("sourcedata")];
  h.state.narrativeState = { id: "nova", revision: 2, transition: "enter" }; h.emit("narrativeState"); await flush(); await h.advance(200);
  h.map.removeLayer("nli-narrative-focus-label"); h.map.removeSource("nli-narrative-focus");
  await h.binding.onStyleLoad(); await flush();
  for (const callback of stale) callback({ sourceId: "nli-narrative-focus", isSourceLoaded: true });
  await h.advance(600); await h.advance(600);
  expect(h.binding.getDisplayedSnapshot().narrativeState.id).toBe("nova");
  h.state.investigationClock = { phase: "paused", positionMs: 99 }; h.emit("investigationClock"); await flush();
  expect(h.binding.getDisplayedSnapshot().investigationClock.positionMs).toBe(99); h.close();
});
it("mid-fade resources remain drawable while strict point-capture settlement is false", async () => {
  const h = await bindingHarness();
  h.state.narrativeState = { id: "nova", revision: 2, transition: "enter" }; h.emit("narrativeState"); await flush(); await h.advance(300);
  expect(h.map.getPaintProperty("people", "circle-opacity")).toBeCloseTo(.5);
  expect(h.runtime.getRenderedReadiness().ready).toBe(false);
  expect(h.map.getLayer("people")).toBeTruthy();
  expect(h.map.getSource("nli-narrative-focus")).toBeTruthy();
  expect(h.map.getPaintProperty("nli-narrative-focus-label", "text-opacity")).toBeCloseTo(.5); h.close();
});

it("production projection refresh leaves outgoing timeline companions mounted until the owner reaches zero", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const { createProjectionCuratedRefresh } = await import("../../frontend/src/map/maplibre-curated-layer-loader.js");
  const { syncInvestigationTimelineToMap, disposeInvestigationTimelineForMap } = await import("../../frontend/src/shared/maplibre-investigation-timeline.js");
  const { createNliSceneDisplayBinding } = await import("../../frontend/src/shared/nli-scene-display-binding.js");
  const map = createFakeMapLibreMap();
  const runtime = getLayerLifecycleRuntime(map, { now: () => Date.now(), requestFrame: cb => map.requestAnimationFrame(cb), cancelFrame: id => map.cancelAnimationFrame(id) });
  const state = { groups: [{ id: "nli", layers: [{ id: "lines", enabled: true }] }], clock: { phase: "idle" } };
  const listeners = new Map();
  const deps = { displayProfile: "projection", now: () => Date.now(), featuresById: { "nli.lines": [{ type: "Feature", properties: { OBJECTID: 1, timeline_minutes: 435 }, geometry: { type: "LineString", coordinates: [[34.4,31.4],[34.5,31.5]] } }] }, settlementFeatures: [], requestAnimationFrame: cb => map.requestAnimationFrame(cb), cancelAnimationFrame: id => map.cancelAnimationFrame(id) };
  const flowCalls = [];
  const refresh = createProjectionCuratedRefresh({ map, syncFlowAnimations() { flowCalls.push(1); void syncInvestigationTimelineToMap(map, state.clock, state.groups, deps); } });
  const binding = await createNliSceneDisplayBinding({ map, runtime,
    dataContext: { getLayerGroups: () => state.groups, getInvestigationClock: () => state.clock, subscribe: (topic, cb) => { listeners.set(topic, cb); return () => listeners.delete(topic); } },
    refreshLayers: refresh.applyProjectionRefresh,
    syncTimeline: (snapshot, options) => syncInvestigationTimelineToMap(map, snapshot.investigationClock, snapshot.layerGroups, { ...deps, ...options }),
  });
  await flush(); const outgoing = map.getStyle().layers.filter(layer => layer.id.startsWith("nli-investigation-line-")).map(layer => layer.id); expect(outgoing.length).toBeGreaterThan(1);
  state.groups = []; listeners.get("layerGroups")(); await flush();
  expect(outgoing.filter(id => !map.getLayer(id))).toEqual([]);
  expect(flowCalls).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(300); for (let i=0;i<3;i++) map.driveAnimationFrame(Date.now()); await flush();
  expect(outgoing.filter(id => !map.getLayer(id))).toEqual([]);
  await vi.advanceTimersByTimeAsync(300); for (let i=0;i<3;i++) map.driveAnimationFrame(Date.now()); await flush();
  expect(outgoing.some(id => !map.getLayer(id))).toBe(true);
  binding.dispose(); disposeInvestigationTimelineForMap(map); runtime.dispose();
});

it.each(["slideshow", "calibration"])("return from %s reconciles current normal inputs without another topic emission", async () => {
  const { createNliSceneDisplayBinding } = await import("../../frontend/src/shared/nli-scene-display-binding.js");
  const map = createFakeMapLibreMap(); const runtime = getLayerLifecycleRuntime(map);
  let managed = true; const state = { groups: [], narrative: { id: "segev" }, clock: { phase: "idle" }, selection: { personId: "a" } };
  const applied = [];
  const binding = await createNliSceneDisplayBinding({ map, runtime, isManaged: () => managed,
    dataContext: { getLayerGroups: () => state.groups, getNarrativeState: () => state.narrative, getInvestigationClock: () => state.clock, getPersonSelection: () => state.selection },
    onSnapshotApplied: snapshot => applied.push(snapshot),
  });
  await flush(); managed = false;
  expect(binding.suspend).toBeTypeOf("function"); binding.suspend();
  state.narrative = { id: "sderot" }; state.clock = { phase: "paused", positionMs: 123 }; state.selection = { personId: "b" };
  await binding.request(); managed = true;
  expect(binding.isManaging()).toBe(false);
  await binding.resumeNormal(); await flush();
  expect(binding.getRenderSnapshot().narrativeState.id).toBe("sderot");
  expect(binding.getDisplayedSnapshot().investigationClock.positionMs).toBe(123);
  expect(applied.at(-1).personSelection.personId).toBe("b");
  expect(binding.isManaging()).toBe(true); binding.dispose(); runtime.dispose();
});
it("a newer mode epoch cancels pending normal return preparation", async () => {
  const { createNliSceneDisplayBinding } = await import("../../frontend/src/shared/nli-scene-display-binding.js");
  const map = createFakeMapLibreMap(); const runtime = getLayerLifecycleRuntime(map); let managed = true, prepareSignal, resolve, holdPreparation = false;
  const binding = await createNliSceneDisplayBinding({ map, runtime, isManaged: () => managed, dataContext: { getLayerGroups: () => [] },
    prepareDisplay: async (_snapshot, options) => { if (!holdPreparation) return; prepareSignal = options.signal; await new Promise(done => { resolve = done; }); },
  });
  await flush(); managed = false; binding.suspend(); managed = true; holdPreparation = true; const resume = binding.resumeNormal(); await flush();
  managed = false; binding.suspend(); expect(prepareSignal.aborted).toBe(true);
  resolve(); await expect(resume).resolves.toEqual({ status: "cancelled" });
  expect(binding.isManaging()).toBe(false); binding.dispose(); runtime.dispose();
});

it.each(["source", "prepare", "mount"])("failed normal return (%s) relinquishes ownership and a recovered explicit cue settles", async kind => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { createNliSceneDisplayBinding } = await import("../../frontend/src/shared/nli-scene-display-binding.js");
  const map = createFakeMapLibreMap({ sources: { "nli.people": { type: "geojson", data: { type: "FeatureCollection", features: [] } } } });
  map.addLayer({ id: "people", type: "circle", source: "nli.people", paint: { "circle-opacity": 1 } });
  const runtime = getLayerLifecycleRuntime(map, { now: () => Date.now(), requestFrame: cb => map.requestAnimationFrame(cb), cancelFrame: id => map.cancelAnimationFrame(id) });
  let managed = true, failure = null, preparations = 0;
  const state = { narrative: { id: null }, groups: [{ id: "nli", layers: [{ id: "people", enabled: true }] }] };
  const binding = await createNliSceneDisplayBinding({ map, runtime, isManaged: () => managed,
    dataContext: { getLayerGroups: () => state.groups, getNarrativeState: () => state.narrative },
    prepareDisplay: async () => { preparations++; if (failure === "prepare") throw new Error("normal preparation failed"); },
    refreshLayers: async () => {
      runtime.stageMapLayer("nli.people", map.getLayer("people"));
      if (failure === "source") runtime.markMemberFailed("nli.people"); else runtime.markMemberReady("nli.people");
      if (failure === "mount") throw new Error("normal mount failed");
    },
    applyDisplay: async (_prepared, { snapshot }) => map.getSource("nli.people").setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: { narrativeId: snapshot.narrativeState.id }, geometry: { type: "Point", coordinates: [34.4,31.4] } }] }),
  });
  await flush(); managed = false; binding.suspend(); managed = true;
  failure = kind; state.narrative = { id: "sderot" };
  await expect(binding.resumeNormal()).resolves.toEqual({ status: "failed" });
  expect(binding.isManaging()).toBe(false);
  expect(binding.getDisplayedSnapshot().narrativeState.id).toBeNull();
  expect(binding.getRenderSnapshot().narrativeState.id).toBeNull();
  const attempts = preparations; await vi.advanceTimersByTimeAsync(2000); await flush(); expect(preparations).toBe(attempts);
  failure = null; state.narrative = { id: "segev" };
  await expect(binding.request()).resolves.toEqual({ status: "ready" }); await flush();
  expect(binding.isManaging()).toBe(true);
  expect(binding.getDisplayedSnapshot().narrativeState.id).toBe("segev");
  expect(map.getSource("nli.people").data.features[0].properties.narrativeId).toBe("segev");
  expect(runtime.getRenderedReadiness().ready).toBe(true);
  binding.dispose(); runtime.dispose(); warning.mockRestore();
});

async function failedReturnHoldHarness() {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const { createNliSceneDisplayBinding } = await import("../../frontend/src/shared/nli-scene-display-binding.js");
  const map = createFakeMapLibreMap({ sources: { "nli.people": { type: "geojson", data: { type: "FeatureCollection", features: [] } } } });
  map.addLayer({ id: "people", type: "circle", source: "nli.people", paint: { "circle-opacity": 1 } });
  const runtime = getLayerLifecycleRuntime(map, { now: () => Date.now(), requestFrame: cb => map.requestAnimationFrame(cb), cancelFrame: id => map.cancelAnimationFrame(id) });
  let managed = true, failed = false, preparations = 0;
  const state = { narrative: { id: null }, clock: { phase: "idle" }, selection: {}, groups: [{ id: "nli", layers: [{ id: "people", enabled: true }] }] };
  const writes = [], applied = [];
  const binding = await createNliSceneDisplayBinding({ map, runtime, isManaged: () => managed,
    dataContext: { getLayerGroups: () => state.groups, getNarrativeState: () => state.narrative, getInvestigationClock: () => state.clock, getPersonSelection: () => state.selection },
    prepareDisplay: async () => { preparations++; if (failed) throw new Error("normal prepare failed"); },
    refreshLayers: async () => { runtime.stageMapLayer("nli.people", map.getLayer("people")); runtime.markMemberReady("nli.people"); },
    applyDisplay: async (_candidate, { snapshot }) => {
      map.getLayer("people").filter = ["==", "narrativeId", snapshot.narrativeState.id];
      map.getSource("nli.people").setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: { narrativeId: snapshot.narrativeState.id }, geometry: { type: "Point", coordinates: [34.4,31.4] } }] });
      writes.push(snapshot.narrativeState.id);
    },
    onSnapshotApplied: snapshot => applied.push(snapshot),
  });
  await flush(); managed = false; binding.suspend(); managed = true; failed = true;
  await expect(binding.resumeNormal()).resolves.toEqual({ status: "failed" }); failed = false;
  writes.length = 0; applied.length = 0;
  return { map, runtime, binding, state, writes, applied, preparations: () => preparations,
    setManaged: value => { managed = value; }, close() { binding.dispose(); runtime.dispose(); } };
}
it("suspended recovery buffers sequential held topics and applies only the released latest snapshot", async () => {
  const h = await failedReturnHoldHarness(); const oldData = h.map.getSource("nli.people").data; const oldFilter = h.map.getLayer("people").filter;
  const prepared = h.preparations();
  h.state.clock = { phase: "idle", presentationPendingUntilMs: 15000 }; h.state.narrative = { id: "segev" }; const held = h.binding.request();
  h.state.narrative = { id: "sderot" }; h.state.selection = { personId: "p1" }; h.binding.request();
  h.state.narrative = { id: "nova" }; h.state.clock = { phase: "paused", positionMs: 777, presentationPendingUntilMs: 15000 }; h.binding.request();
  await flush(); await vi.advanceTimersByTimeAsync(300); await flush();
  expect(h.writes).toEqual([]); expect(h.preparations()).toBe(prepared);
  expect(h.map.getSource("nli.people").data).toBe(oldData); expect(h.map.getLayer("people").filter).toBe(oldFilter);
  expect(h.binding.getDisplayedSnapshot().narrativeState.id).toBeNull();
  h.state.clock = { phase: "paused", positionMs: 777 }; const release = h.binding.request(); await flush();
  await expect(release).resolves.toEqual({ status: "ready" }); await expect(held).resolves.toEqual({ status: "ready" });
  expect(new Set(h.writes)).toEqual(new Set(["nova"]));
  expect(h.binding.getDisplayedSnapshot().personSelection.personId).toBe("p1");
  expect(h.applied.at(-1).investigationClock.positionMs).toBe(777); h.close();
});
it("suspended recovery consumes capped hold expiry once without another emission", async () => {
  const h = await failedReturnHoldHarness(); const prepared = h.preparations();
  h.state.clock = { phase: "idle", presentationPendingUntilMs: 90000 }; h.state.narrative = { id: "segev" }; const held = h.binding.request(); await flush();
  await vi.advanceTimersByTimeAsync(5000); h.state.narrative = { id: "sderot" }; h.binding.request(); await flush();
  await vi.advanceTimersByTimeAsync(9999); await flush(); expect(h.writes).toEqual([]); expect(h.preparations()).toBe(prepared);
  await vi.advanceTimersByTimeAsync(1); await flush(); await expect(held).resolves.toEqual({ status: "ready" });
  expect(new Set(h.writes)).toEqual(new Set(["sderot"])); expect(h.binding.getDisplayedSnapshot().narrativeState.id).toBe("sderot");
  const attempts = h.preparations(); await vi.advanceTimersByTimeAsync(15000); await flush(); expect(h.preparations()).toBe(attempts); h.close();
});
it("a newer mode cancels suspended recovery hold and cannot release obsolete inputs later", async () => {
  const h = await failedReturnHoldHarness(); const prepared = h.preparations();
  h.state.clock = { phase: "idle", presentationPendingUntilMs: 15000 }; h.state.narrative = { id: "segev" }; const held = h.binding.request(); await flush();
  h.setManaged(false); h.binding.suspend(); await expect(held).resolves.toEqual({ status: "cancelled" });
  await vi.advanceTimersByTimeAsync(20000); await flush(); expect(h.writes).toEqual([]); expect(h.preparations()).toBe(prepared);
  h.setManaged(true); h.state.clock = { phase: "idle" }; h.state.narrative = { id: "sderot" };
  await expect(h.binding.request()).resolves.toEqual({ status: "ready" }); await flush();
  expect(new Set(h.writes)).toEqual(new Set(["sderot"])); h.close();
});
