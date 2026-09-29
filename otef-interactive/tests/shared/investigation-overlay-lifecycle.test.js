import { describe, expect, it } from "vitest";
import {
  addInvestigationOverlayLayer,
  completeInvestigationOverlayMount,
} from "../../frontend/src/shared/investigation-overlay-lifecycle.js";
import { getLayerLifecycleRuntime, LAYER_FADE_MS } from "../../frontend/src/shared/layer-lifecycle-fade.js";

function createHooks() {
  let time = 0;
  let frame = null;
  return {
    now: () => time,
    setTime(value) { time = value; },
    requestFrame(callback) {
      frame = callback;
      return 1;
    },
    cancelFrame() { frame = null; },
    flushFrame() {
      const current = frame;
      frame = null;
      current?.(time);
    },
  };
}

function createMap() {
  const layers = new Map();
  const paints = new Map();
  return {
    addLayer(def) {
      layers.set(def.id, def);
      for (const [key, value] of Object.entries(def.paint || {})) paints.set(`${def.id}\0${key}`, value);
    },
    removeLayer(id) {
      layers.delete(id);
      for (const key of [...paints.keys()]) {
        if (key.startsWith(`${id}\0`)) paints.delete(key);
      }
    },
    getLayer(id) { return layers.get(id) || null; },
    setPaintProperty(id, key, value) { paints.set(`${id}\0${key}`, value); },
    getPaintProperty(id, key) { return paints.get(`${id}\0${key}`); },
  };
}

describe("addInvestigationOverlayLayer", () => {
  it("does not restage an already mounted overlay", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    runtime.setDesiredIds(["nli.lines"], { durationMs: 0 });
    runtime.stageMapLayer("nli.lines", {
      id: "nli__lines__line__0",
      type: "line",
      paint: { "line-opacity": 1 },
    });
    runtime.markMemberReady("nli.lines");
    runtime.commitBatch();

    addInvestigationOverlayLayer(map, "nli.lines", {
      id: "nli-investigation-line-head-circle",
      type: "circle",
      paint: { "circle-opacity": 0.95 },
    });
    hooks.setTime(LAYER_FADE_MS);
    hooks.flushFrame();
    expect(map.getPaintProperty("nli-investigation-line-head-circle", "circle-opacity")).toBe(0.95);

    addInvestigationOverlayLayer(map, "nli.lines", {
      id: "nli-investigation-line-head-circle",
      type: "circle",
      paint: { "circle-opacity": 0.95 },
    });
    expect(map.getPaintProperty("nli-investigation-line-head-circle", "circle-opacity")).toBe(0.95);
  });

  it("restages overlay layers left on the map after instant hide", () => {
    const map = createMap();
    const runtime = getLayerLifecycleRuntime(map, createHooks());
    runtime.setDesiredIds(["nli.investigation_polygons"], { durationMs: 0 });
    addInvestigationOverlayLayer(map, "nli.investigation_polygons", {
      id: "nli-investigation-polygon-category-fill-battle",
      type: "fill",
      paint: { "fill-opacity": 0.55 },
    });
    completeInvestigationOverlayMount(map, "nli.investigation_polygons");
    runtime.commitBatch();
    expect(map.getPaintProperty("nli-investigation-polygon-category-fill-battle", "fill-opacity")).toBe(0.55);

    runtime.settleHiddenIds(["nli.investigation_polygons"]);
    runtime.setDesiredIds(["nli.investigation_polygons"], { durationMs: 0 });
    addInvestigationOverlayLayer(map, "nli.investigation_polygons", {
      id: "nli-investigation-polygon-category-fill-battle",
      type: "fill",
      paint: { "fill-opacity": 0.55 },
    });
    completeInvestigationOverlayMount(map, "nli.investigation_polygons");
    runtime.commitBatch();
    expect(map.getLayer("nli-investigation-polygon-category-fill-battle")).toBeTruthy();
    expect(map.getPaintProperty("nli-investigation-polygon-category-fill-battle", "fill-opacity")).toBe(0.55);
  });

  it("reveals every overlay layer after one mount completion, not the first addLayer", () => {
    const map = createMap();
    const runtime = getLayerLifecycleRuntime(map, createHooks());
    runtime.setDesiredIds(["nli.lines"], { durationMs: 0 });
    addInvestigationOverlayLayer(map, "nli.lines", {
      id: "nli-investigation-line-completed-carrier-line",
      type: "line",
      paint: { "line-opacity": 1 },
    });
    addInvestigationOverlayLayer(map, "nli.lines", {
      id: "nli-investigation-line-active-line",
      type: "line",
      paint: { "line-opacity": 1 },
    });
    addInvestigationOverlayLayer(map, "nli.lines", {
      id: "nli-investigation-line-head-circle",
      type: "circle",
      paint: { "circle-opacity": 0.95 },
    });
    completeInvestigationOverlayMount(map, "nli.lines");
    runtime.commitBatch();
    expect(map.getPaintProperty("nli-investigation-line-completed-carrier-line", "line-opacity")).toBe(1);
    expect(map.getPaintProperty("nli-investigation-line-active-line", "line-opacity")).toBe(1);
    expect(map.getPaintProperty("nli-investigation-line-head-circle", "circle-opacity")).toBe(0.95);
  });
});
