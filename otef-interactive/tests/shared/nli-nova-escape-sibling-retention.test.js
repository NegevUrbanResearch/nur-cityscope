import { afterEach, expect, it, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";
import { createNovaEscapeCoordinator, NOVA_ESCAPE_INDIVIDUAL_LAYER_ID as individualId, NOVA_ESCAPE_OVERLAP_LAYER_ID as overlapId, NOVA_FLEEING_INDIVIDUAL_URL, NOVA_FLEEING_IMPACT_INDEX_URL } from "../../frontend/src/shared/nli-nova-escape-coordinator.js";
import { NOVA_ESCAPE_IMPACT_LAYER_ID as impactId } from "../../frontend/src/shared/nli-nova-escape-impact.js";
import * as ribbons from "../../frontend/src/shared/maplibre-acrossline-ribbon.js";
import { createNliSceneDisplayBinding } from "../../frontend/src/shared/nli-scene-display-binding.js";
import { DEFAULT_INVESTIGATION_SETTLEMENTS_URL } from "../../frontend/src/shared/nli-investigation-timeline-data.js";

let cleanup;
afterEach(() => { cleanup?.(); cleanup = null; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function harness() {
  let time = 100000, frame, drawable; const drawables = new Map();
  vi.spyOn(Date, "now").mockImplementation(() => time);
  const feature = { type: "Feature", properties: { OBJECTID: 1 }, geometry: { type: "LineString", coordinates: [[34.47,31.4],[34.48,31.41]] } };
  const settlement = { type: "Feature", properties: { OBJECTID: 18, outlineObjectId: 18 }, geometry: { type: "Polygon", coordinates: [[[34.4,31.3],[34.5,31.3],[34.5,31.4],[34.4,31.3]]] } };
  const create = ribbons.createAcrossLineRibbonLayer;
  vi.spyOn(ribbons, "createAcrossLineRibbonLayer").mockImplementation(options => { drawables.set(options.id, options.onDrawable); if (options.id === individualId) { frame = options.getFrame; drawable = options.onDrawable; } return create(options); });
  vi.stubGlobal("fetch", vi.fn(async url => ({ ok: true, json: async () => String(url) === NOVA_FLEEING_IMPACT_INDEX_URL ? { schemaVersion: 1, routeIds: ["1"], parallelCrossings: [], settlementCrossings: [["1", "18", .8]] } : { type: "FeatureCollection", features: String(url) === DEFAULT_INVESTIGATION_SETTLEMENTS_URL ? [settlement] : String(url) === NOVA_FLEEING_INDIVIDUAL_URL || String(url).includes("overlapp") ? [feature] : [] } })));
  const map = createFakeMapLibreMap();
  const runtime = getLayerLifecycleRuntime(map, { now: () => time, requestFrame: cb => map.requestAnimationFrame(cb), cancelFrame: id => map.cancelAnimationFrame(id) });
  const controller = createNovaEscapeCoordinator({ map, managedScene: true, surface: "projection" });
  const snapshot = overlay => controller.captureSceneInput({ narrativeState: { id: "nova" }, escapeOverlay: { individual: true, ...overlay } });
  async function apply(next) { await controller.prepareSnapshot(next); runtime.setDesiredIds(controller.getSceneIds(next), { durationMs: 0 }); await controller.applySnapshot(next); runtime.commitBatch(); }
  const initial = snapshot({}); await apply(initial);
  cleanup = () => { controller.dispose(); runtime.dispose(); };
  return { map, runtime, controller, snapshot, apply, initial, frame: () => frame(), progress: () => frame().featureProgress(feature), drawable: () => drawable(), getDrawable: () => drawable, readyAll: () => { for (const callback of drawables.values()) callback(); }, advance(ms) { time += ms; map.driveAnimationFrame(time); } };
}

it("overlap-only scene hold preserves individual layer and its advancing reveal", async () => {
  const h = await harness(); h.drawable(); h.advance(2000); const layer = h.map.getLayer(individualId), before = h.progress();
  h.controller.holdForScene({ changedIds: [overlapId] }); h.advance(300);
  expect(h.progress()).toBeGreaterThan(before);
  await h.apply(h.snapshot({ overlap: true }));
  expect(h.map.getLayer(individualId)).toBe(layer);
  expect(h.map.getLayer(overlapId)).toBeTruthy();
  expect(h.map.calls.filter(call => call.method === "removeLayer" && call.id === individualId)).toHaveLength(0);
});

it("adding a sibling before the first drawable frame retains the pending origin reset", async () => {
  const h = await harness(); const firstDrawable = h.getDrawable();
  await h.apply(h.snapshot({ overlap: true }));
  expect(firstDrawable()).toBe(true); h.advance(1000); expect(h.progress()).toBeGreaterThan(0);
});

it("settled impact identity excludes individual replay while ribbon mode retains its real settled dependency", async () => {
  const h = await harness(); const settled = h.snapshot({ settled: true }); await h.apply(settled);
  const layer = h.map.getLayer(impactId), source = h.map.getSource(impactId);
  h.snapshot({ individual: false, settled: true }); const replay = h.snapshot({ settled: true });
  expect(h.controller.getSceneContentKey(settled, impactId)).toBe(h.controller.getSceneContentKey(replay, impactId));
  expect(h.controller.getSceneContentKey(h.initial, individualId)).not.toBe(h.controller.getSceneContentKey(settled, individualId));
  await h.apply(replay); expect(h.map.getLayer(impactId)).toBe(layer); expect(h.map.getSource(impactId)).toBe(source);
});

it("the real binding holds only the changing overlap participant", async () => {
  const h = await harness(); h.drawable(); h.advance(2000);
  const state = { overlay: { individual: true } };
  const binding = await createNliSceneDisplayBinding({ map: h.map, runtime: h.runtime, escapeCoordinator: h.controller,
    dataContext: { getLayerGroups: () => [], getNarrativeState: () => ({ id: "nova", revision: 1 }), getEscapeOverlay: () => state.overlay, getInvestigationClock: () => ({ phase: "ended" }) },
  });
  const layer = h.map.getLayer(individualId), before = h.progress();
  state.overlay = { individual: true, overlap: true }; binding.request();
  for (let i = 0; i < 40; i++) await Promise.resolve(); h.readyAll(); h.advance(300);
  expect(h.progress()).toBeGreaterThan(before); expect(h.map.getLayer(individualId)).toBe(layer);
  binding.dispose();
});

it.each([false, true])("Stop retains outgoing ribbon geometry until hidden (overlap=%s)", async overlap => {
  const h = await harness();
  const state = { overlay: { individual: true, overlap } };
  const binding = await createNliSceneDisplayBinding({ map: h.map, runtime: h.runtime, escapeCoordinator: h.controller,
    dataContext: { getLayerGroups: () => [], getNarrativeState: () => ({ id: "nova", revision: 1 }), getEscapeOverlay: () => state.overlay, getInvestigationClock: () => ({ phase: "ended" }) },
  });
  try {
    const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
    h.readyAll(); h.advance(2000); await flush();
    const before = h.progress(), sibling = h.map.getLayer(overlapId);
    expect(before).toBeGreaterThan(0);
    state.overlay = { individual: false, overlap }; binding.request(); await flush();
    expect(h.progress()).toBe(before);
    h.advance(300); await flush();
    expect(h.frame().opacity).toBeGreaterThan(0);
    expect(h.progress()).toBe(before);
    if (overlap) expect(h.map.getLayer(overlapId)).toBe(sibling);
    h.advance(300); await flush();
    expect(h.map.getLayer(individualId)).toBeFalsy();
    state.overlay = { individual: true, overlap }; binding.request(); await flush();
    h.readyAll(); h.advance(1000); await flush();
    expect(h.progress()).toBeGreaterThan(0);
    expect(h.progress()).toBeLessThan(before);
    if (overlap) expect(h.map.getLayer(overlapId)).toBe(sibling);
  } finally { binding.dispose(); }
});

it("a rapid Stop/Start replaces the departing run only after its opacity reaches zero", async () => {
  const h = await harness();
  const state = { overlay: { individual: true, overlap: true } };
  const binding = await createNliSceneDisplayBinding({ map: h.map, runtime: h.runtime, escapeCoordinator: h.controller,
    dataContext: { getLayerGroups: () => [], getNarrativeState: () => ({ id: "nova", revision: 1 }), getEscapeOverlay: () => state.overlay, getInvestigationClock: () => ({ phase: "ended" }) },
  });
  try {
    const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
    h.readyAll(); h.advance(2000); await flush();
    const ribbon = h.map.getLayer(individualId), before = h.progress();
    state.overlay = { individual: false, overlap: true }; binding.request(); await flush();
    h.advance(200); await flush();
    expect(h.frame().opacity).toBeGreaterThan(0);
    state.overlay = { individual: true, overlap: true }; binding.request(); await flush();
    expect(h.map.getLayer(individualId)).toBe(ribbon);
    expect(h.progress()).toBe(before);
    h.advance(300); await flush();
    expect(h.map.getLayer(individualId)).toBe(ribbon);
    expect(h.progress()).toBe(before);
    h.advance(300); await flush();
    expect(h.map.getLayer(individualId)).not.toBe(ribbon);
    h.readyAll(); h.advance(1000); await flush();
    expect(h.progress()).toBeGreaterThan(0);
    expect(h.progress()).toBeLessThan(before);
  } finally { binding.dispose(); }
});

it("a settled-only scene after Stop reaches full impact geometry without the departed frame", async () => {
  const h = await harness(); h.drawable(); h.advance(2000);
  expect(h.map.getSource(impactId).data.features).toHaveLength(0);
  h.controller.holdForScene();
  h.runtime.setDesiredIds([], { durationMs: 600 });
  await h.controller.applySnapshot(h.snapshot({ individual: false })); h.runtime.commitBatch();
  h.advance(600);
  expect(h.map.getLayer(individualId)).toBeFalsy();
  await h.apply(h.snapshot({ individual: false, settled: true }));
  expect(h.map.getSource(impactId).data.features.map(feature => feature.properties.outlineObjectId)).toEqual([18]);
});

it("unchanged impact geometry does not restart source loading on every reveal frame", async () => {
  const h = await harness(), source = h.map.getSource(impactId);
  const write = vi.spyOn(source, "setData");
  h.controller.setEscapeImpactIds(["18"]);
  expect(write).toHaveBeenCalledTimes(1);
  h.map.setSourceLoaded(impactId, false);
  h.controller.setEscapeImpactIds(["18"]);
  h.controller.setEscapeImpactIds(["18", "unknown"]);
  expect(write).toHaveBeenCalledTimes(1);
  h.controller.setEscapeImpactIds([]);
  expect(write).toHaveBeenCalledTimes(2);
  h.controller.setEscapeImpactIds([]);
  expect(write).toHaveBeenCalledTimes(2);
});

it("impact publication follows a replacement source even when outline IDs are unchanged", async () => {
  const h = await harness();
  h.controller.setEscapeImpactIds(["18"]);
  const oldSource = h.map.getSource(impactId), layer = h.map.getLayer(impactId);
  h.map.removeLayer(impactId); h.map.removeSource(impactId);
  h.map.addSource(impactId, { type: "geojson", data: { type: "FeatureCollection", features: [] } }); h.map.addLayer(layer);
  const source = h.map.getSource(impactId), write = vi.spyOn(source, "setData");
  expect(source).not.toBe(oldSource);
  h.controller.setEscapeImpactIds(["18"]);
  expect(write).toHaveBeenCalledTimes(1);
  expect(source.data.features.map(feature => feature.properties.outlineObjectId)).toEqual([18]);
  h.controller.setEscapeImpactIds(["18"]);
  expect(write).toHaveBeenCalledTimes(1);
});
