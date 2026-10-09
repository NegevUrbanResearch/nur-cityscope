import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";
import { createMorRouteCoordinator, MOR_ROUTE_SCENE_ID, MOR_ROUTE_SOURCE_ID, MOR_ROUTE_LAYER_ID, MOR_ROUTE_HEAD_LAYER_ID } from "../../frontend/src/shared/nli-mor-route-coordinator.js";

const route = { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: [[34.47, 31.4], [34.48, 31.41]] } }] };
const snapshot = { narrativeState: { id: "nova" }, escapeOverlay: { mor: true } };
let close;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => route }))); });
afterEach(() => { close?.(); close = null; vi.unstubAllGlobals(); vi.useRealTimers(); });

async function harness() {
  const map = createFakeMapLibreMap();
  const add = map.addSource.bind(map); map.addSource = (id, data) => { const result = add(id, data); if (id === MOR_ROUTE_SOURCE_ID) map.setSourceLoaded(id, false); return result; };
  const runtime = getLayerLifecycleRuntime(map, { now: () => Date.now(), requestFrame: cb => map.requestAnimationFrame(cb), cancelFrame: id => map.cancelAnimationFrame(id) });
  const controller = createMorRouteCoordinator({ map, managedScene: true });
  close = () => { controller.dispose(); runtime.dispose(); };
  await controller.prepareSnapshot(snapshot);
  const handle = runtime.setDesiredIds([MOR_ROUTE_SCENE_ID], { durationMs: 0, requiredIds: [MOR_ROUTE_SCENE_ID] }), completion = runtime.waitForBatch(handle);
  await controller.applySnapshot(snapshot); runtime.commitBatch();
  const writes = () => map.calls.filter(c => c.method === "setData" && c.id === MOR_ROUTE_SOURCE_ID);
  const head = () => map.getSource(MOR_ROUTE_SOURCE_ID)?.data.features.find(f => f.properties.role === "head")?.geometry.coordinates;
  const loaded = () => { map.setSourceLoaded(MOR_ROUTE_SOURCE_ID, true); map.emit("sourcedata", { sourceId: MOR_ROUTE_SOURCE_ID, sourceDataType: "content" }); };
  const advance = async ms => { await vi.advanceTimersByTimeAsync(ms); for(let i=0;i<3;i++)map.driveAnimationFrame(Date.now()); };
  return { map, runtime, controller, completion, writes, head, loaded, advance };
}

it("keeps the initial source stable until current-source readiness, then starts the existing reveal clock", async () => {
  const h = await harness(), initial = h.head();
  expect(h.writes()).toHaveLength(0); await h.advance(800); expect(h.writes()).toHaveLength(0); expect(h.head()).toEqual(initial);
  h.loaded(); expect(await h.completion).toEqual({ status: "ready" }); expect(h.head()).toEqual(initial);
  await h.advance(1000); expect(h.head()).not.toEqual(initial); expect(h.head()[0]).toBeCloseTo(34.471, 4);
});

it("readiness timeout retires the staged physical source without hidden RAF writes", async () => {
  const h = await harness(); await h.advance(1200); expect(await h.completion).toEqual({ status: "failed" });
  expect(h.map.getSource(MOR_ROUTE_SOURCE_ID)).toBeFalsy(); expect(h.map.getLayer(MOR_ROUTE_LAYER_ID)).toBeFalsy();
  const writes = h.writes().length; await h.advance(1000); expect(h.writes()).toHaveLength(writes); expect(writes).toBe(0);
});

it("a late readiness event cannot revive a source after logical Stop and zero departure", async () => {
  const h = await harness(); h.controller.holdForScene(); h.runtime.setDesiredIds([], { durationMs: 0 });
  await h.controller.applySnapshot({ ...snapshot, escapeOverlay: { mor: false } }); h.runtime.commitBatch();
  h.loaded(); await h.advance(500); expect(h.map.getSource(MOR_ROUTE_SOURCE_ID)).toBeFalsy(); expect(h.writes()).toHaveLength(0);
});

it("source identity replacement invalidates old readiness without touching the replacement", async () => {
  const h = await harness();
  h.map.removeLayer(MOR_ROUTE_HEAD_LAYER_ID); h.map.removeLayer(MOR_ROUTE_LAYER_ID); h.map.removeSource(MOR_ROUTE_SOURCE_ID);
  h.map.addSource(MOR_ROUTE_SOURCE_ID, { type: "geojson", data: route }); const replacement = h.map.getSource(MOR_ROUTE_SOURCE_ID);
  h.loaded(); await h.advance(1200); expect(await h.completion).toEqual({ status: "failed" }); expect(h.map.getSource(MOR_ROUTE_SOURCE_ID)).toBe(replacement);
  expect(h.writes()).toHaveLength(0); h.controller.dispose(); expect(h.map.getSource(MOR_ROUTE_SOURCE_ID)).toBe(replacement);
});

it("same-run hold resumes the sampled head without restarting or replacing the source", async () => {
  const h = await harness(); h.loaded(); await h.completion; await h.advance(2000);
  const head = h.head(), source = h.map.getSource(MOR_ROUTE_SOURCE_ID); h.controller.holdForScene(); await h.advance(300);
  expect(h.head()).toEqual(head); await h.controller.applySnapshot(snapshot); expect(h.map.getSource(MOR_ROUTE_SOURCE_ID)).toBe(source); expect(h.head()).toEqual(head);
  await h.advance(1000); expect(h.head()).not.toEqual(head);
});

it("style reset and disposal reject callbacks from the old physical mount", async () => {
  const h = await harness(), old = [...h.map._listeners.get("sourcedata")];
  h.map.wipeStyle(); h.controller.resetStyle(); h.map.addSource(MOR_ROUTE_SOURCE_ID, { type: "geojson", data: route }); const replacement = h.map.getSource(MOR_ROUTE_SOURCE_ID);
  h.map.setSourceLoaded(MOR_ROUTE_SOURCE_ID, true); for(const callback of old)callback({ sourceId: MOR_ROUTE_SOURCE_ID });
  h.controller.dispose(); await h.advance(1300); expect(h.map.getSource(MOR_ROUTE_SOURCE_ID)).toBe(replacement); expect(h.writes()).toHaveLength(0);
});

it("readiness received during a same-run hold waits for resume before starting its origin", async () => {
  const h = await harness(), initial = h.head(); h.controller.holdForScene(); await h.advance(200); h.loaded(); await h.completion;
  expect(h.writes()).toHaveLength(0); await h.advance(300); expect(h.head()).toEqual(initial);
  h.controller.resumeForScene(); await h.advance(0); expect(h.head()).toEqual(initial); await h.advance(1000); expect(h.head()[0]).toBeCloseTo(34.471, 4);
});

it("reduced motion waits for initial readiness with the full route and never schedules reveal writes", async () => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
  const h = await harness(); expect(h.map.getSource(MOR_ROUTE_SOURCE_ID).data.features).toHaveLength(1); expect(h.writes()).toHaveLength(0);
  h.loaded(); expect(await h.completion).toEqual({ status: "ready" }); await h.advance(1000); expect(h.writes()).toHaveLength(0); expect(h.map.pendingAnimationFrameCount()).toBe(0);
});

it("a current initial-source error retires the staged mount without starting its reveal", async () => {
  const h = await harness(); h.map.emit("error", { error: { sourceId: MOR_ROUTE_SOURCE_ID, message: "worker failed" } });
  expect(await h.completion).toEqual({ status: "failed" }); expect(h.map.getSource(MOR_ROUTE_SOURCE_ID)).toBeFalsy();
  await h.advance(1000); expect(h.writes()).toHaveLength(0);
});

it("runtime disposal stops a ready route's separate RAF from writing again", async () => {
  const h = await harness(); h.loaded(); await h.completion; await h.advance(1000);
  const writes = h.writes().length; h.runtime.dispose(); await h.advance(1000);
  expect(h.writes()).toHaveLength(writes); expect(h.map.pendingAnimationFrameCount()).toBe(0);
});

it("a captured initial-source readiness callback cannot start the route after runtime disposal", async () => {
  const h = await harness(), callbacks = [...h.map._listeners.get("sourcedata")]; h.runtime.dispose();
  h.map.setSourceLoaded(MOR_ROUTE_SOURCE_ID, true); for(const callback of callbacks)callback({ sourceId: MOR_ROUTE_SOURCE_ID });
  await h.advance(1000); expect(h.writes()).toHaveLength(0); expect(h.map.pendingAnimationFrameCount()).toBe(0);
});
