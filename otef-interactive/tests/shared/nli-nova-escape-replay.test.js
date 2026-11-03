import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { createNovaEscapeCoordinator, NOVA_ESCAPE_INDIVIDUAL_LAYER_ID, NOVA_FLEEING_INDIVIDUAL_URL, NOVA_FLEEING_IMPACT_INDEX_URL } from "../../frontend/src/shared/nli-nova-escape-coordinator.js";
import { getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";
import * as ribbons from "../../frontend/src/shared/maplibre-acrossline-ribbon.js";

const feature = { type: "Feature", properties: { OBJECTID: 1 }, geometry: { type: "LineString", coordinates: [[34.47, 31.4], [34.48, 31.41]] } };
const collection = { type: "FeatureCollection", features: [feature] };
const empty = { type: "FeatureCollection", features: [] };
let time, getFrame, onDrawable, cleanup;
beforeEach(() => {
  time = 100000;
  vi.spyOn(Date, "now").mockImplementation(() => time);
  const create = ribbons.createAcrossLineRibbonLayer;
  vi.spyOn(ribbons, "createAcrossLineRibbonLayer").mockImplementation(options => {
    if (options.id === NOVA_ESCAPE_INDIVIDUAL_LAYER_ID) { getFrame = options.getFrame; onDrawable = options.onDrawable; }
    return create(options);
  });
  vi.stubGlobal("fetch", vi.fn(async url => ({ ok: true, json: async () => String(url) === NOVA_FLEEING_INDIVIDUAL_URL ? collection : String(url) === NOVA_FLEEING_IMPACT_INDEX_URL ? { schemaVersion: 1, routeIds: ["1"], parallelCrossings: [], settlementCrossings: [] } : empty })));
});
afterEach(() => { cleanup?.(); cleanup = null; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function harness() {
  const map = createFakeMapLibreMap();
  const runtime = getLayerLifecycleRuntime(map, { now: () => time, requestFrame: callback => map.requestAnimationFrame(callback), cancelFrame: id => map.cancelAnimationFrame(id) });
  const controller = createNovaEscapeCoordinator({ map, managedScene: true, surface: "projection", profile: "projection" });
  cleanup = () => { controller.dispose(); runtime.dispose(); };
  const capture = (individual, extra = {}) => {
    const snapshot = { narrativeState: { id: "nova" }, escapeOverlay: { individual, overlap: false, mor: false, settled: false }, ...extra };
    return controller.captureSceneInput?.(snapshot) ?? snapshot;
  };
  const mount = async snapshot => {
    await controller.prepareSnapshot(snapshot);
    runtime.setDesiredIds(controller.getSceneIds(snapshot), { durationMs: 0 });
    await controller.applySnapshot(snapshot); runtime.commitBatch();
    controller.debugNoteRibbonDrawable();
  };
  const progress = () => getFrame().featureProgress(feature);
  const advance = ms => { time += ms; map.driveAnimationFrame(time); };
  const first = capture(true); await mount(first);
  return { map, runtime, controller, capture, mount, progress, advance, first };
}

describe("managed explicit escape replay", () => {
  it("restarts a completed reveal after Stop while retaining the old drawable frame until zero", async () => {
    const h = await harness(); h.advance(30000); expect(h.progress()).toBe(1);
    const oldRibbon = h.map.getLayer(NOVA_ESCAPE_INDIVIDUAL_LAYER_ID);
    const stop = h.capture(false); h.controller.holdForScene();
    h.runtime.setDesiredIds([], { durationMs: 600 }); await h.controller.applySnapshot(stop); h.runtime.commitBatch();
    h.advance(300); expect(h.map.getLayer(NOVA_ESCAPE_INDIVIDUAL_LAYER_ID)).toBe(oldRibbon); expect(h.progress()).toBe(1); expect(getFrame().revealPaused).toBe(true);
    h.advance(300); expect(h.map.getLayer(NOVA_ESCAPE_INDIVIDUAL_LAYER_ID)).toBeFalsy();
    await h.mount(h.capture(true)); expect(h.progress()).toBe(0);
    h.advance(1000); expect(h.progress()).toBeGreaterThan(0); expect(h.progress()).toBeLessThan(1);
  });

  it("captures Stop then Start before off activation as a new run requiring replacement at zero", async () => {
    const h = await harness(); h.advance(2000); const progress = h.progress();
    const oldDrawable = onDrawable;
    h.capture(false); h.controller.holdForScene(); h.advance(200);
    const replay = h.capture(true);
    expect(h.progress()).toBe(progress);
    expect(h.controller.getSceneContentKey?.(replay, NOVA_ESCAPE_INDIVIDUAL_LAYER_ID)).not.toBe(h.controller.getSceneContentKey?.(h.first, NOVA_ESCAPE_INDIVIDUAL_LAYER_ID));
    await h.controller.prepareSnapshot(replay);
    expect(h.progress()).toBe(progress);
    h.runtime.setDesiredIds([], { durationMs: 600 }); h.runtime.commitBatch(); h.advance(600);
    await h.mount(replay); expect(h.progress()).toBe(0); h.advance(1000); expect(h.progress()).toBeGreaterThan(0);
    const restarted = h.progress(); expect(oldDrawable()).toBe(false); expect(h.progress()).toBe(restarted);
    h.advance(1000); expect(h.map.getLayer(NOVA_ESCAPE_INDIVIDUAL_LAYER_ID)).toBeTruthy();
  });

  it("retains partial outgoing geometry after logical Stop is acknowledged during its fade", async () => {
    const h = await harness(); h.advance(2000); const progress = h.progress(), ribbon = h.map.getLayer(NOVA_ESCAPE_INDIVIDUAL_LAYER_ID);
    const stop = h.capture(false); h.controller.holdForScene();
    h.runtime.setDesiredIds([], { durationMs: 600 }); await h.controller.applySnapshot(stop); h.runtime.commitBatch();
    h.advance(300); expect(h.progress()).toBe(progress); expect(h.map.getLayer(NOVA_ESCAPE_INDIVIDUAL_LAYER_ID)).toBe(ribbon);
    h.advance(300); expect(h.map.getLayer(NOVA_ESCAPE_INDIVIDUAL_LAYER_ID)).toBeFalsy();
  });

  it("captures immutable run intent without treating unrelated fields or duplicate reads as starts", async () => {
    const h = await harness(); const source = { narrativeState: { id: "nova" }, escapeOverlay: { individual: true } };
    const same = h.controller.captureSceneInput(source);
    expect(source).not.toHaveProperty("escapePlaybackRun"); expect(same).not.toBe(source); expect(same.escapePlaybackRun).toBe(h.first.escapePlaybackRun);
    h.capture(false); const next = h.capture(true); expect(next.escapePlaybackRun).toBe(h.first.escapePlaybackRun + 1);
    expect(h.capture(true).escapePlaybackRun).toBe(next.escapePlaybackRun);
    expect(h.controller.getSceneContentKey(next, "nli.investigation_polygons")).toBeUndefined();
    expect(h.controller.getSceneContentKey(next, NOVA_ESCAPE_INDIVIDUAL_LAYER_ID)).not.toBe(h.controller.getSceneContentKey(h.first, NOVA_ESCAPE_INDIVIDUAL_LAYER_ID));
  });

  it("retains origin and layer identity for same-run hold and reversal", async () => {
    const h = await harness(); h.advance(2000); const progress = h.progress(), ribbon = h.map.getLayer(NOVA_ESCAPE_INDIVIDUAL_LAYER_ID);
    h.controller.holdForScene(); h.advance(200); await h.controller.applySnapshot(h.capture(true));
    expect(h.progress()).toBe(progress); expect(h.map.getLayer(NOVA_ESCAPE_INDIVIDUAL_LAYER_ID)).toBe(ribbon);
    h.advance(1000); expect(h.progress()).toBeGreaterThan(progress);
  });

  it("does not capture a new route run for presenter Replay, clock revisions, selection or Mor", async () => {
    const h = await harness(); h.advance(2000); const before = h.progress();
    const semantic = h.capture(true, { investigationClock: { phase: "playing", revision: 23, positionMs: 0, anchorMs: time }, personSelection: { personId: "p1" } });
    expect(semantic.escapePlaybackRun).toBe(h.first.escapePlaybackRun);
    await h.controller.applySnapshot(semantic); expect(h.progress()).toBe(before);
    const mor = h.capture(true, { escapeOverlay: { individual: true, mor: true } });
    expect(mor.escapePlaybackRun).toBe(h.first.escapePlaybackRun);
    await h.controller.applySnapshot(mor); expect(h.progress()).toBe(before);
  });

  it("style remount preserves the current run and disposal prevents capture from reviving it", async () => {
    const h = await harness(); h.advance(2000); const before = h.progress();
    h.map.wipeStyle(); h.controller.resetStyle(); await h.controller.applySnapshot(h.capture(true));
    h.controller.debugNoteRibbonDrawable(); expect(h.progress()).toBe(before);
    h.controller.dispose(); const late = h.capture(false); await h.controller.applySnapshot(late); await h.controller.applySnapshot(h.capture(true));
    expect(h.map.getLayer(NOVA_ESCAPE_INDIVIDUAL_LAYER_ID)).toBeFalsy(); expect(h.map.pendingAnimationFrameCount()).toBe(0);
  });
});
