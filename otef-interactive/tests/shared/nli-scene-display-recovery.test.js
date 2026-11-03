import { afterEach, expect, it, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";
import { createNliSceneDisplayBinding } from "../../frontend/src/shared/nli-scene-display-binding.js";
import { createMorRouteCoordinator } from "../../frontend/src/shared/nli-mor-route-coordinator.js";
import { transitionGisBasemap } from "../../frontend/src/map/gis-basemap-transition.js";
import { NARRATIVE_FOCUS_SCENE_ID, getNarrativeSceneContentKey } from "../../frontend/src/shared/maplibre-narrative-focus.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function flush() { for (let i=0;i<50;i++) await Promise.resolve(); }
function common() {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const map = createFakeMapLibreMap();
  const state = { groups: [], narrative: { id: null }, overlay: {}, clock: { phase: "idle" } };
  const runtimeForStyle = () => getLayerLifecycleRuntime(map, { now: () => Date.now(), requestFrame: cb => map.requestAnimationFrame(cb), cancelFrame: id => map.cancelAnimationFrame(id) });
  const context = { getLayerGroups: () => state.groups, getNarrativeState: () => state.narrative, getEscapeOverlay: () => state.overlay, getInvestigationClock: () => state.clock };
  return { map, state, context, runtimeForStyle, runtime: runtimeForStyle() };
}
it("a throwing style remount can recover on a later explicit cue", async () => {
  const h = common(); let fail = false;
  const reports = [];
  vi.spyOn(console, "warn").mockImplementation((message, diagnostic) => { if (diagnostic) reports.push(diagnostic); });
  const binding = await createNliSceneDisplayBinding({ map: h.map, dataContext: h.context, runtime: h.runtime, runtimeForStyle: h.runtimeForStyle,
    prepareDisplay: async () => { if (fail) throw new Error("Decoded presentation no longer exists"); },
  });
  await flush(); fail = true;
  await expect(binding.onStyleLoad()).resolves.toEqual({ status: "failed" });
  expect(reports).toMatchObject([{ phase: "normal-return", reason: "Decoded presentation no longer exists" }]);
  expect(binding.isManaging()).toBe(false);
  fail = false; h.state.narrative = { id: "nova" };
  const result = await binding.request();
  const observed = { advertisedManaging: binding.isManaging(), result, displayed: binding.getDisplayedSnapshot().narrativeState.id };
  binding.dispose(); h.runtimeForStyle().dispose();
  expect(observed.result).toEqual({ status: "ready" });
  expect(observed.displayed).toBe("nova");
});
it("strict source failure during style remount can recover on explicit cue", async () => {
  const h = common(); let failed = false;
  const reports = [];
  vi.spyOn(console, "warn").mockImplementation((message, diagnostic) => { if (diagnostic) reports.push(diagnostic); });
  h.state.groups = [{ id: "nli", layers: [{ id: "people", enabled: true }] }];
  h.map.addSource("people", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  h.map.addLayer({ id: "people", source: "people", type: "circle", paint: { "circle-opacity": .8 } });
  const binding = await createNliSceneDisplayBinding({ map: h.map, dataContext: h.context, runtime: h.runtime, runtimeForStyle: h.runtimeForStyle,
    refreshLayers: async () => { const r = h.runtimeForStyle(); r.stageMapLayer("nli.people", h.map.getLayer("people")); if (failed) r.markMemberFailed("nli.people"); else r.markMemberReady("nli.people"); },
  });
  await flush(); failed = true; await binding.onStyleLoad(); await flush();
  expect(reports).toMatchObject([{ phase: "normal-return", reason: "member-failed", failedIds: ["nli.people"] }]);
  failed = false; const result = await binding.request(); await flush();
  const observed = { result, readiness: h.runtimeForStyle().getRenderedReadiness(), opacity: h.map.getPaintProperty("people", "circle-opacity") };
  binding.dispose(); h.runtimeForStyle().dispose();
  expect(observed.readiness.ready).toBe(true);
  expect(observed.opacity).toBeCloseTo(.8);
});
it("a real managed basemap preparation timeout during style remount can recover", async () => {
  const h = common();
  const styles = {
    dark: { sources: { openmaptiles: { type: "vector", tiles: ["https://example.invalid/{z}/{x}/{y}.pbf"] } }, layers: [{ id: "background", type: "background", paint: { "background-color": "#111" } }, { id: "water", source: "openmaptiles", "source-layer": "water", type: "fill", paint: { "fill-opacity": 1 } }] },
    osm: { sources: { osm: { type: "raster", tiles: ["https://example.invalid/{z}/{x}/{y}.png"] } }, layers: [{ id: "osm-tiles", type: "raster", source: "osm" }] },
    satellite: { sources: { esri: { type: "raster", tiles: ["https://example.invalid/{z}/{x}/{y}.png"] } }, layers: [{ id: "esri-tiles", type: "raster", source: "esri" }] },
    satellite_bw: { sources: { esri: { type: "raster", tiles: ["https://example.invalid/{z}/{x}/{y}.png"] } }, layers: [{ id: "esri-tiles", type: "raster", source: "esri" }] },
  };
  h.map.addSource("openmaptiles", styles.dark.sources.openmaptiles);
  for (const layer of styles.dark.layers) h.map.addLayer(layer);
  h.map.setSourceLoaded("openmaptiles", true);
  h.map.style = { tileManagers: { openmaptiles: { getRenderableIds: () => ["dark-tile"] } } };
  h.context.getBasemap = () => "dark";
  const binding = await createNliSceneDisplayBinding({ map: h.map, dataContext: h.context, runtime: h.runtime, runtimeForStyle: h.runtimeForStyle,
    prepareBasemap: (id, { signal } = {}) => transitionGisBasemap(h.map, id, { styles, managedScene: { runtime: h.runtimeForStyle(), signal } }),
    applyBasemap: candidate => candidate.mount(), discardBasemap: candidate => candidate?.discard(),
  });
  await flush(); h.map.setSourceLoaded("openmaptiles", false);
  let remountResult; const remount = binding.onStyleLoad().then(result => { remountResult = result; }, error => { remountResult = { error: error.message }; });
  await flush(); await vi.advanceTimersByTimeAsync(2001); await remount;
  expect(remountResult).toEqual({ status: "failed" });
  expect(binding.isManaging()).toBe(false);
  h.map.setSourceLoaded("openmaptiles", true); h.state.narrative = { id: "nova" };
  const result = await binding.request();
  const observed = { remountResult, advertisedManaging: binding.isManaging(), result, displayed: binding.getDisplayedSnapshot().narrativeState.id };
  binding.dispose(); h.runtimeForStyle().dispose(); h.map.remove();
  expect(observed.result).toEqual({ status: "ready" });
});
it("normal return bounds a stalled real Mor asset fetch and lets a newer cue proceed", async () => {
  const h = common(); let managed = true, capturedSignal;
  vi.stubGlobal("fetch", vi.fn((_url, { signal }) => new Promise((_resolve, reject) => { capturedSignal = signal; signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); })));
  const mor = createMorRouteCoordinator({ map: h.map, managedScene: true });
  const binding = await createNliSceneDisplayBinding({ map: h.map, dataContext: h.context, runtime: h.runtime, runtimeForStyle: h.runtimeForStyle, morCoordinator: mor, isManaged: () => managed });
  await flush(); managed = false; binding.suspend(); managed = true;
  h.state.narrative = { id: "nova" }; h.state.overlay = { mor: true };
  let settled = false; const resume = binding.resumeNormal().then(result => { settled = true; return result; }); await flush();
  await vi.advanceTimersByTimeAsync(15001); await flush();
  h.state.narrative = { id: null }; h.state.overlay = {}; const replacement = await binding.request();
  const observed = { settled, fetchAborted: capturedSignal.aborted, replacement, advertisedManaging: binding.isManaging() };
  binding.dispose(); await resume; mor.dispose(); h.runtimeForStyle().dispose();
  expect(observed.settled).toBe(true);
  expect(observed.fetchAborted).toBe(true);
  expect(observed.replacement).toEqual({ status: "ready" });
});
it("failed distinct scene mount resumes retained real Mor reveal", async () => {
  const h = common();
  const route = { type: "FeatureCollection", crs: { type: "name", properties: { name: "EPSG:3857" } }, features: [{ type: "Feature", properties: { OBJECTID: 1 }, geometry: { type: "MultiLineString", coordinates: [[[0,0],[111319.49,0]], [[111319.49,0],[222638.98,111325.14]]] } }] };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => route })));
  h.state.narrative = { id: "nova" }; h.state.overlay = { mor: true };
  const mor = createMorRouteCoordinator({ map: h.map, managedScene: true });
  await mor.prepareSnapshot({ narrativeState: h.state.narrative, escapeOverlay: h.state.overlay });
  let failMount = false;
  const binding = await createNliSceneDisplayBinding({ map: h.map, dataContext: h.context, runtime: h.runtime, runtimeForStyle: h.runtimeForStyle, morCoordinator: mor,
    refreshLayers: async () => { if (failMount) throw new Error("incoming layer mount failed"); },
  });
  await flush(); const initialGeometry = JSON.stringify(h.map.getSource("nli-mor-route").data);
  await vi.advanceTimersByTimeAsync(1000); h.map.driveAnimationFrame(Date.now()); await flush();
  const source = h.map.getSource("nli-mor-route"); const before = JSON.stringify(source.data);
  expect(before).not.toBe(initialGeometry); expect(h.map.pendingAnimationFrameCount()).toBeGreaterThan(0);
  failMount = true; h.state.groups = [{ id: "nli", layers: [{ id: "people", enabled: true }] }];
  const result = await binding.request(); await flush();
  expect(binding.getRenderSnapshot().enabledIds).toEqual([]);
  expect(h.map.pendingAnimationFrameCount()).toBeGreaterThan(0);
  failMount = false; h.state.groups = []; h.state.clock = { phase: "paused", positionMs: 1000 };
  const returned = await binding.request(); await flush();
  await vi.advanceTimersByTimeAsync(3000); h.map.driveAnimationFrame(Date.now()); await flush();
  const observed = { result, returned, sourceRetained: source === h.map.getSource("nli-mor-route"), opacity: h.map.getPaintProperty("nli-mor-route-line", "line-opacity"), scheduledFrames: h.map.pendingAnimationFrameCount(), revealAdvanced: JSON.stringify(source.data) !== before };
  binding.dispose(); mor.dispose(); h.runtimeForStyle().dispose();
  expect(observed.sourceRetained).toBe(true);
  expect(observed.opacity).toBeCloseTo(.6);
  expect(observed.revealAdvanced).toBe(true);
});

it("a newer normal cue supersedes preparation even when its producer ignores abort", async () => {
  const h = common(); let managed = true, signal, finishOld;
  const discarded = [];
  const binding = await createNliSceneDisplayBinding({ map: h.map, dataContext: h.context, runtime: h.runtime, runtimeForStyle: h.runtimeForStyle, isManaged: () => managed,
    prepareDisplay: async (snapshot, options) => {
      if (snapshot.narrativeState?.id !== "nova") return null;
      signal = options.signal;
      return new Promise(resolve => { finishOld = resolve; });
    }, discardDisplay: candidate => { if (candidate) discarded.push(candidate); },
  });
  await flush(); managed = false; binding.suspend(); managed = true;
  h.state.narrative = { id: "nova" }; const old = binding.resumeNormal(); await flush();
  h.state.narrative = { id: "segev" }; const latest = binding.request(); await flush();
  expect(signal.aborted).toBe(true);
  await expect(old).resolves.toEqual({ status: "cancelled" });
  await expect(latest).resolves.toEqual({ status: "ready" });
  const candidate = { old: true }; finishOld(candidate); await flush();
  expect(discarded).toEqual([candidate]);
  expect(binding.getDisplayedSnapshot().narrativeState.id).toBe("segev");
  expect(binding.isManaging()).toBe(true);
  binding.dispose(); h.runtimeForStyle().dispose();
});
it("initial preparation is bounded and discards a candidate delivered after timeout", async () => {
  const h = common(); let signal, finish; const discarded = [];
  let result;
  const initial = createNliSceneDisplayBinding({ map: h.map, dataContext: h.context, runtime: h.runtime,
    prepareDisplay: (_snapshot, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); },
    discardDisplay: candidate => { if (candidate) discarded.push(candidate); },
  }).then(binding => { result = "ready"; binding.dispose(); }, () => { result = "failed"; });
  await flush(); await vi.advanceTimersByTimeAsync(15000); await flush();
  expect(result).toBe("failed"); expect(signal.aborted).toBe(true);
  const candidate = { late: true }; finish(candidate); await initial; await flush();
  expect(discarded).toEqual([candidate]); expect(vi.getTimerCount()).toBe(0);
  h.runtime.dispose();
});
it("style reconstruction bounds ignored cancellation and waits for an explicit retry", async () => {
  const h = common(); let fail = false, signal, finish; let attempts = 0; const discarded = [];
  const binding = await createNliSceneDisplayBinding({ map: h.map, dataContext: h.context, runtime: h.runtime, runtimeForStyle: h.runtimeForStyle,
    prepareDisplay: (_snapshot, options) => {
      attempts++; if (!fail) return null;
      signal = options.signal; return new Promise(resolve => { finish = resolve; });
    }, discardDisplay: candidate => { if (candidate) discarded.push(candidate); },
  });
  await flush(); fail = true; let result;
  const style = binding.onStyleLoad().then(value => { result = value; }); await flush();
  await vi.advanceTimersByTimeAsync(15000); await flush();
  expect(result).toEqual({ status: "failed" }); expect(signal.aborted).toBe(true);
  expect(binding.isManaging()).toBe(false);
  const count = attempts; const late = { late: true }; finish(late); await style; await flush();
  await vi.advanceTimersByTimeAsync(15000); await flush(); expect(attempts).toBe(count);
  expect(discarded).toEqual([late]); fail = false;
  await expect(binding.request()).resolves.toEqual({ status: "ready" });
  binding.dispose(); h.runtimeForStyle().dispose();
});

it("superseding reconstruction preserves a consumed hold expiry for the same deadline", async () => {
  const h = common(); let managed = true, oldSignal, finish;
  h.state.clock = { phase: "idle" };
  const binding = await createNliSceneDisplayBinding({ map: h.map, dataContext: h.context, runtime: h.runtime, runtimeForStyle: h.runtimeForStyle, isManaged: () => managed,
    prepareDisplay: (snapshot, options) => {
      if (snapshot.narrativeState?.id !== "nova") return null;
      oldSignal = options.signal; return new Promise(resolve => { finish = resolve; });
    },
  });
  await flush(); managed = false; binding.suspend(); managed = true;
  h.state.narrative = { id: "nova" }; h.state.clock = { phase: "paused", presentationPendingUntilMs: 90000 };
  const first = binding.request(); await flush();
  await vi.advanceTimersByTimeAsync(15000); await flush(); expect(oldSignal).toBeDefined();
  h.state.narrative = { id: "segev" }; const latest = binding.request(); await flush();
  expect(oldSignal.aborted).toBe(true);
  await expect(first).resolves.toEqual({ status: "cancelled" });
  await expect(latest).resolves.toEqual({ status: "ready" });
  expect(Date.now()).toBe(15000); expect(binding.getDisplayedSnapshot().narrativeState.id).toBe("segev");
  finish(null); await flush(); binding.dispose(); h.runtimeForStyle().dispose();
});
it("a staged basemap is discarded once if later display preparation times out", async () => {
  const h = common(); let managed = true, stall = false, finish; const basemap = {}, discarded = [];
  const binding = await createNliSceneDisplayBinding({ map: h.map, dataContext: h.context, runtime: h.runtime, runtimeForStyle: h.runtimeForStyle, isManaged: () => managed,
    prepareBasemap: () => stall ? basemap : null, discardBasemap: candidate => { if (candidate) discarded.push(candidate); },
    prepareDisplay: () => stall ? new Promise(resolve => { finish = resolve; }) : null,
  });
  await flush(); managed = false; binding.suspend(); managed = true; stall = true;
  const resume = binding.resumeNormal(); await flush(); await vi.advanceTimersByTimeAsync(15000); await flush();
  await expect(resume).resolves.toEqual({ status: "failed" }); expect(discarded).toEqual([basemap]);
  finish(null); await flush(); expect(discarded).toEqual([basemap]);
  binding.dispose(); h.runtimeForStyle().dispose();
});
it("obsolete distinct-mount completion cannot release a newer scene hold", async () => {
  const h = common(); let failMount, held = false; const resume = vi.fn(() => { held = false; });
  h.state.narrative = { id: "nova" }; h.state.overlay = { mor: true };
  const binding = await createNliSceneDisplayBinding({ map: h.map, dataContext: h.context, runtime: h.runtime, runtimeForStyle: h.runtimeForStyle,
    morCoordinator: {
      getSceneIds: snapshot => snapshot.escapeOverlay?.mor ? ["nli-mor-route"] : [],
      applySnapshot() { h.runtime.registerOpacityTarget("nli-mor-route", () => {}); h.runtime.markMemberReady("nli-mor-route"); },
      holdForScene: () => { held = true; }, resumeForScene: resume,
    },
    refreshLayers: ({ groupsOverride }) => groupsOverride.length ? new Promise((_resolve, reject) => { failMount = reject; }) : undefined,
  });
  await flush(); h.state.groups = [{ id: "nli", layers: [{ id: "people", enabled: true }] }]; h.state.overlay = { mor: false };
  const first = binding.request(); await flush(); expect(held).toBe(true);
  h.state.clock = { phase: "paused", presentationPendingUntilMs: 15000 }; h.state.narrative = { id: "nova" };
  const latest = binding.request(); await flush(); failMount(new Error("obsolete mount")); await flush();
  await expect(first).resolves.toEqual({ status: "cancelled" }); expect(resume).not.toHaveBeenCalled(); expect(held).toBe(true);
  binding.dispose(); await expect(latest).resolves.toEqual({ status: "cancelled" }); h.runtimeForStyle().dispose();
});

it("failed unrelated catalog mount preserves the authoritative playing clock and completed-line flow", async () => {
  const { syncInvestigationTimelineToMap, disposeInvestigationTimelineForMap, getInvestigationSceneContentKey } = await import("../../frontend/src/shared/maplibre-investigation-timeline.js");
  const h = common(); let fail = false; const clocks = [];
  h.state.groups = [{ id: "nli", layers: [{ id: "lines", enabled: true }] }];
  h.state.clock = { phase: "playing", membership: ["nli.lines"], beats: [435, 560], loop: false, positionMs: 3000, anchorMs: 0, revision: 1 };
  const deps = { now: () => Date.now(), featuresById: { "nli.lines": [{ type: "Feature", properties: { OBJECTID: 1, timeline_minutes: 435 }, geometry: { type: "LineString", coordinates: [[34.4,31.4],[34.5,31.5]] } }] }, settlementFeatures: [], requestAnimationFrame: cb => h.map.requestAnimationFrame(cb), cancelAnimationFrame: id => h.map.cancelAnimationFrame(id) };
  const binding = await createNliSceneDisplayBinding({ map: h.map, dataContext: h.context, runtime: h.runtime, runtimeForStyle: h.runtimeForStyle,
    refreshLayers: async () => {
      if (fail) throw new Error("distinct catalog mount failed");
      h.runtime.registerOpacityTarget("nli.lines", () => {}); h.runtime.markMemberReady("nli.lines");
    },
    syncTimeline: async (snapshot, options) => { clocks.push(snapshot.investigationClock); await syncInvestigationTimelineToMap(h.map, snapshot.investigationClock, snapshot.layerGroups, { ...deps, ...options }); },
    getTimelineSceneContentKey: getInvestigationSceneContentKey,
  });
  await flush(); const source = h.map.getSource("nli-investigation-line-completed-motion"); expect(source).toBeTruthy(); expect(source.data.features).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(1000); h.map.driveAnimationFrame(Date.now()); await flush();
  fail = true; h.state.groups = [...h.state.groups, { id: "extra", layers: [{ id: "incoming", enabled: true }] }];
  await expect(binding.request()).resolves.toEqual({ status: "failed" });
  expect(clocks.some(clock => clock.phase === "paused")).toBe(false);
  expect(clocks.at(-1)).toMatchObject({ phase: "playing", anchorMs: 0, positionMs: 3000, revision: 1 });
  expect(binding.getRenderSnapshot().investigationClock).toEqual(h.state.clock);
  expect(h.map.getSource("nli-investigation-line-completed-motion")).toBe(source);
  const dash = h.map.getPaintProperty("nli-investigation-line-completed-motion-line", "line-dasharray");
  await vi.advanceTimersByTimeAsync(66); h.map.driveAnimationFrame(Date.now()); await flush();
  expect(h.map.getPaintProperty("nli-investigation-line-completed-motion-line", "line-dasharray")).not.toEqual(dash);
  binding.dispose(); disposeInvestigationTimelineForMap(h.map); h.runtimeForStyle().dispose();
});

it("retained recovery preserves a newer Pause received during a same-content basemap preparation", async () => {
  const h = common(); let basemap = "dark", rejectPreparation, fail = false; const clocks = [];
  h.context.getBasemap = () => basemap; h.state.clock = { phase: "playing", anchorMs: 0, positionMs: 0 };
  const binding = await createNliSceneDisplayBinding({ map: h.map, dataContext: h.context, runtime: h.runtime,
    prepareDisplay: () => fail ? new Promise((_resolve, reject) => { rejectPreparation = reject; }) : null,
    syncTimeline: snapshot => { clocks.push(snapshot.investigationClock); },
  });
  await flush(); h.state.clock = { ...h.state.clock, presentationPendingUntilMs: 15000 }; binding.request(); await flush();
  basemap = "satellite_bw"; fail = true; h.state.clock = { phase: "playing", anchorMs: 0, positionMs: 0 };
  const failed = binding.request(); await flush();
  h.state.clock = { phase: "paused", anchorMs: null, positionMs: 345 }; const pause = binding.request(); await flush();
  rejectPreparation(new Error("basemap scene display failed"));
  await expect(failed).resolves.toEqual({ status: "failed" }); await expect(pause).resolves.toEqual({ status: "failed" });
  expect(clocks.at(-1)).toEqual(h.state.clock);
  expect(binding.getRenderSnapshot().basemapId).toBe("dark");
  binding.dispose(); h.runtime.dispose();
});

it.each([
  ["Pause", { phase: "paused", anchorMs: null, positionMs: 2345, seekKind: "none", revision: 2, serverNowMs: 23, alarmOnsetOriginMs: 21 }, {}, true],
  ["Stop", { phase: "paused", anchorMs: null, positionMs: 0, seekKind: "none", revision: 2, serverNowMs: 23 }, {}, true],
  ["different narrative", { phase: "paused", anchorMs: null, positionMs: 2345, revision: 2 }, { narrative: { id: "sderot" } }, false],
  ["different clock membership", { phase: "paused", anchorMs: null, positionMs: 2345, revision: 2, membership: ["nli.investigation_polygons"] }, {}, false],
  ["different clock beats", { phase: "paused", anchorMs: null, positionMs: 2345, revision: 2, beats: [435, 570] }, {}, false],
  ["different clock window", { phase: "paused", anchorMs: null, positionMs: 2345, revision: 2, leadInMinutes: 435 }, {}, false],
])("failed distinct catalog mount applies only compatible retained-story clock: %s", async (_name, update, sceneUpdate, compatible) => {
  const h = common(); const clocks = []; let rejectMount;
  const failPreparation = !!sceneUpdate.narrative;
  h.state.groups = [{ id: "nli", layers: [{ id: "lines", enabled: true }] }];
  h.state.narrative = { id: "segev" };
  const original = { phase: "playing", anchorMs: 0, positionMs: 1000, membership: ["nli.lines"], beats: [435, 560], loop: false, leadInMinutes: 420, revision: 1 };
  h.state.clock = original;
  const binding = await createNliSceneDisplayBinding({ map: h.map, dataContext: h.context, runtime: h.runtime,
    narrativeController: {
      getSceneIds: snapshot => snapshot.narrativeState?.id ? [NARRATIVE_FOCUS_SCENE_ID] : [],
      getSceneContentKey: getNarrativeSceneContentKey,
      applySnapshot() { h.runtime.registerOpacityTarget(NARRATIVE_FOCUS_SCENE_ID, () => {}); h.runtime.markMemberReady(NARRATIVE_FOCUS_SCENE_ID); },
    },
    refreshLayers: ({ groupsOverride }) => {
      if (groupsOverride.length > 1 && !failPreparation) return new Promise((_resolve, reject) => { rejectMount = reject; });
      h.runtime.registerOpacityTarget("nli.lines", () => {}); h.runtime.markMemberReady("nli.lines");
    },
    prepareDisplay: snapshot => snapshot.enabledIds.length > 1 && failPreparation ? new Promise((_resolve, reject) => { rejectMount = reject; }) : null,
    syncTimeline: snapshot => { clocks.push(snapshot.investigationClock); },
  });
  await flush();
  h.state.groups = [...h.state.groups, { id: "extra", layers: [{ id: "incoming", enabled: true }] }];
  const scene = binding.request(); await flush(); expect(rejectMount).toBeTypeOf("function");
  Object.assign(h.state, sceneUpdate); h.state.clock = { ...original, ...update };
  const control = binding.request(); await flush();
  rejectMount(new Error("distinct incoming mount failed"));
  if (!compatible && sceneUpdate.narrative) {
    // Changing the narrative supersedes the old operation; fail its new preparation before replacement.
    await expect(scene).resolves.toEqual({ status: "cancelled" });
  } else await expect(scene).resolves.toEqual({ status: "failed" });
  await expect(control).resolves.toEqual({ status: "failed" });
  const expected = compatible ? h.state.clock : original;
  expect(clocks.at(-1)).toEqual(expected);
  expect(binding.getRenderSnapshot().investigationClock).toEqual(expected);
  expect(binding.getRenderSnapshot().enabledIds).toEqual(["nli.lines"]);
  binding.dispose(); h.runtime.dispose();
});
