import { afterEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { createCuratedDisplayGate, createProjectionCuratedRefresh, loadCuratedLayerToMapLibre, removeCuratedHtmlMarkers } from "../../frontend/src/map/maplibre-curated-layer-loader.js";
import * as curatedService from "../../frontend/src/shared/curated-layer-service.js";
import { getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";
import { syncProjectionModelImage } from "../../frontend/src/projection/projection-model-image.js";
import { syncProjectionLayers } from "../../frontend/src/projection/maplibre-projection-layers.js";
import layerRegistry from "../../frontend/src/shared/layer-registry.js";

function readProjectionEntry() {
  return fs.readFileSync(
    path.resolve(import.meta.dirname, "../../frontend/src/entries/projection-main.js"),
    "utf8",
  );
}

function polygonCollection(label) {
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { label },
      geometry: { type: "Polygon", coordinates: [[[34.4, 31.3], [34.5, 31.3], [34.5, 31.4], [34.4, 31.3]]] },
    }],
  };
}

function defer() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

describe("projection live curated refresh", () => {
  test('local scene ownership can reopen the async gate without discarding mounted source lifecycle bindings',async()=>{
    const map=createFakeMapLibreMap();const runtime=getLayerLifecycleRuntime(map);
    const refresh=createProjectionCuratedRefresh({map,displayGate:createCuratedDisplayGate(),nameFieldController:{sync(){}}});
    await refresh.applyProjectionRefresh({groupsOverride:[],reopenGate:true,keepLiveRuntime:true});
    expect(getLayerLifecycleRuntime(map)).toBe(runtime);expect(runtime.isDisposed()).toBe(false);runtime.dispose();
  });
  test("guards the live layerGroups path without queueing registry application or moving the camera", () => {
    const source = readProjectionEntry();
    const subscriber = source.slice(
      source.indexOf('OTEFDataContext.subscribe("layerGroups"'),
      source.indexOf('OTEFDataContext.subscribe("viewport"'),
    );
    expect(subscriber).toMatch(/applyProjectionRefresh\(\{/);
    expect(subscriber).not.toMatch(/projectionDisplay\.begin\(/);
    expect(source).toMatch(/displayGate:\s*projectionDisplay/);
    expect(subscriber).not.toMatch(/refreshProjectionCuratedLayers/);
    expect(source).toMatch(/updateModelVisibility:\s*\(rawGroups,\s*modelInfo\)\s*=>\s*syncProjectionModelImage\(/);
    expect(source).toMatch(/markMemberReady\(\s*["']projector_base\.model_base["']\s*\)/);
    expect(source).toMatch(/markMemberFailed\(\s*["']projector_base\.model_base["']\s*\)/);
    expect(source).toMatch(/projectionModelSubscribeReady\(/);
    expect(source).toMatch(/sealBatch:\s*false/);
    expect(source).toMatch(/releaseProjectionModelImage\(map\)/);
    const loader = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../frontend/src/map/maplibre-curated-layer-loader.js"),
      "utf8",
    );
    const refreshStart = loader.indexOf("const runProjectionCuratedRefresh = async");
    const refresh = loader.slice(refreshStart, loader.indexOf("const applyProjectionRefresh", refreshStart));
    expect(refresh.indexOf("syncProjectionLayersWithNarrative")).toBeGreaterThan(-1);
    expect(refresh.indexOf("holdUntilHidden")).toBeGreaterThan(-1);
    expect(refresh.indexOf("holdUntilHidden")).toBeLessThan(refresh.indexOf("syncProjectionLayersWithNarrative"));
    expect(refresh.indexOf("syncProjectionLayersWithNarrative")).toBeLessThan(refresh.indexOf("await Promise.all"));
    expect(refresh).toMatch(/isCurrent:\s*\(\)\s*=>\s*isCurrent\(fullId\)/);
    expect(refresh).not.toMatch(/\bflyTo\b|\bjumpTo\b|\beaseTo\b/);
    expect(source).toMatch(/createProjectionCuratedRefresh\(/);
    expect(source).toMatch(/projectionDisplay\.invalidateStyle\(\)/);
    expect(source).toMatch(/projectionDisplay\.dispose\(\)/);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    removeCuratedHtmlMarkers("curated.scene");
    removeCuratedHtmlMarkers("curated.home");
  });

  test("the latest live refresh runs without waiting for a stale same-id load", async () => {
    const oldData = defer();
    const calls = [];
    vi.spyOn(curatedService, "fetchCuratedLayerData").mockImplementation((fullId) => {
      calls.push(fullId);
      if (calls.length === 1) return oldData.promise;
      return Promise.resolve({ geojson: polygonCollection("next"), layerData: {} });
    });
    vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths: [], pinkGeojson: null });
    const map = createFakeMapLibreMap({ layers: [{ id: "curated.scene__old", type: "fill" }] });
    let alive = true;
    const gate = createCuratedDisplayGate({ isMapAlive: () => alive });
    const first = gate.begin(["curated.scene"]);
    const staleLoad = loadCuratedLayerToMapLibre(map, "curated.scene", {
      force: true,
      isCurrent: () => first("curated.scene"),
    });
    await Promise.resolve();
    expect(calls).toEqual(["curated.scene"]);
    const second = gate.begin(["curated.scene"]);
    const currentLoad = loadCuratedLayerToMapLibre(map, "curated.scene", {
      force: true,
      isCurrent: () => second("curated.scene"),
    });
    await Promise.resolve();
    expect(calls).toEqual(["curated.scene", "curated.scene"]);
    await currentLoad;
    expect(map.getLayer("curated.scene__plain__fill")).toBeTruthy();
    expect(map.getLayer("curated.scene__old")).toBeFalsy();
    const removals = map.calls.filter((call) => call.method === "removeLayer").length;
    oldData.resolve({ geojson: polygonCollection("stale"), layerData: {} });
    await staleLoad;
    expect(map.calls.filter((call) => call.method === "removeLayer").length).toBe(removals);
    expect(map.getLayer("curated.scene__plain__fill")).toBeTruthy();
    alive = false;
    gate.dispose();
    expect(second("curated.scene")).toBe(false);
  });

  test("Home and style invalidation drop the enabled load and still mount the desired replacement", async () => {
    const enabledData = defer();
    vi.spyOn(curatedService, "fetchCuratedLayerData")
      .mockReturnValueOnce(enabledData.promise)
      .mockResolvedValueOnce({ geojson: polygonCollection("home"), layerData: {} });
    vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths: [], pinkGeojson: null });
    const map = createFakeMapLibreMap();
    const gate = createCuratedDisplayGate({ isMapAlive: () => true });
    const enabled = gate.begin(["curated.scene"]);
    const enabledLoad = loadCuratedLayerToMapLibre(map, "curated.scene", {
      force: true,
      isCurrent: () => enabled("curated.scene"),
    });
    gate.invalidateStyle();
    const home = gate.begin(["curated.home"]);
    await loadCuratedLayerToMapLibre(map, "curated.home", {
      force: true,
      isCurrent: () => home("curated.home"),
    });
    enabledData.resolve({ geojson: polygonCollection("scene"), layerData: {} });
    await enabledLoad;
    expect(map.getLayer("curated.scene__plain__fill")).toBeFalsy();
    expect(map.getLayer("curated.home__plain__fill")).toBeTruthy();
    expect(enabled("curated.scene")).toBe(false);
    expect(home("curated.home")).toBe(true);
  });

  test("the live refresh keeps still-wanted markers until replacement and a stale fetch cannot restore a dropped layer", async () => {
    const removed = [];
    const added = [];
    const sceneData = defer();
    let sceneFetches = 0;
    vi.spyOn(curatedService, "fetchCuratedLayerData").mockImplementation((fullId) => {
      if (fullId === "curated.scene") {
        sceneFetches += 1;
        if (sceneFetches === 1) return Promise.resolve({ geojson: pointCollection(), layerData: {} });
        return sceneData.promise;
      }
      return Promise.resolve({ geojson: polygonCollection("home"), layerData: {} });
    });
    vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths: [], pinkGeojson: null });
    globalThis.document = { createElement: () => ({ style: {}, innerHTML: "", className: "" }) };
    const map = createFakeMapLibreMap();
    const maplibregl = markerNamespace(added, removed);
    const { applyProjectionRefresh } = createProjectionCuratedRefresh({
      map,
      resolveMaplibregl: async () => maplibregl,
    });
    await applyProjectionRefresh({
      groupsOverride: [curatedGroup("curated.scene", true)],
      isCurrent: () => true,
      layerStyleOptions: { transition: { transitionMs: 0 } },
    });
    expect(added).toHaveLength(1);
    expect(removed).toHaveLength(0);
    map.addLayer({ id: "curated.scene__old", type: "fill" });

    const gate = createCuratedDisplayGate({ isMapAlive: () => true });
    const sceneCurrent = gate.begin(["curated.scene"]);
    const staleRefresh = applyProjectionRefresh({
      affectedCuratedFullLayerIds: ["curated.scene"],
      groupsOverride: [curatedGroup("curated.scene", true)],
      isCurrent: sceneCurrent,
      layerStyleOptions: { transition: { transitionMs: 0 } },
    });
    expect(removed).toHaveLength(0);
    expect(map.getLayer("curated.scene__old")).toBeTruthy();

    const homeCurrent = gate.begin(["curated.home"]);
    await applyProjectionRefresh({
      groupsOverride: [curatedGroup("curated.home", true), curatedGroup("curated.scene", false)],
      isCurrent: homeCurrent,
      layerStyleOptions: { transition: { transitionMs: 0 } },
    });
    expect(map.getLayer("curated.scene__old")).toBeFalsy();
    expect(map.getLayer("curated.home__plain__fill")).toBeTruthy();
    expect(removed.length).toBeGreaterThan(0);

    const addedAfterDrop = added.length;
    sceneData.resolve({ geojson: pointCollection(), layerData: {} });
    await staleRefresh;
    expect(added).toHaveLength(addedAfterDrop);
    expect(map.getLayer("curated.scene__plain__fill")).toBeFalsy();
    expect(map.getLayer("curated.home__plain__fill")).toBeTruthy();
    expect(sceneCurrent("curated.scene")).toBe(false);
  });
});

function pointCollection() {
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { pink_node_order: 1, name: "node" },
      geometry: { type: "Point", coordinates: [34.5, 31.4] },
    }],
  };
}

function curatedGroup(fullId, enabled) {
  const [groupId, layerId] = fullId.split(".");
  return { id: groupId, layers: [{ id: layerId, enabled }] };
}

test("a slideshow tick keeps curated removal immediate and forwards a zero duration", async () => {
  vi.spyOn(curatedService, "fetchCuratedLayerData").mockResolvedValue({
    geojson: polygonCollection("scene"),
    layerData: {},
  });
  vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths: [], pinkGeojson: null });
  const map = createFakeMapLibreMap();
  const modelCalls = [];
  const gate = createCuratedDisplayGate({ isMapAlive: () => true });
  const begin = vi.spyOn(gate, "begin");
  const { applyProjectionRefresh } = createProjectionCuratedRefresh({
    map,
    displayGate: gate,
    updateModelVisibility: (_groups, info) => modelCalls.push(info),
  });
  await applyProjectionRefresh({
    fromSlideshowTick: true,
    groupsOverride: [curatedGroup("curated.scene", true)],
    affectedCuratedFullLayerIds: ["curated.scene"],
    layerStyleOptions: { lifecycle: { retainDisabled: true } },
  });
  expect(modelCalls.at(-1)).toEqual({ durationMs: 0, fromSlideshowTick: true });
  expect(map.getPaintProperty("curated.scene__plain__fill", "fill-opacity")).toBe(0.4);
  expect(begin).not.toHaveBeenCalled();

  await applyProjectionRefresh({
    fromSlideshowTick: true,
    groupsOverride: [curatedGroup("curated.scene", false)],
  });
  expect(map.getLayer("curated.scene__plain__fill")).toBeFalsy();
  expect(modelCalls.at(-1)).toMatchObject({ durationMs: 0, fromSlideshowTick: true });
});

test("projection refresh fades the model image with the resolved batch duration", async () => {
  let time = 0;
  let frame = null;
  const hooks = {
    now: () => time,
    requestFrame(callback) { frame = { callback }; return 1; },
    cancelFrame() { frame = null; },
    setTimer() { return 1; },
    clearTimer() {},
  };
  const map = createFakeMapLibreMap();
  getLayerLifecycleRuntime(map, hooks);
  const image = { complete: true, naturalWidth: 8, naturalHeight: 4, style: { opacity: "0", transition: "" }, addEventListener() {}, removeEventListener() {} };
  const requestDraw = vi.fn();
  const { applyProjectionRefresh } = createProjectionCuratedRefresh({
    map,
    updateModelVisibility: (groups, modelInfo) => syncProjectionModelImage({
      map,
      imageEl: image,
      layerGroups: groups,
      modelInfo,
      requestDraw,
    }),
  });
  await applyProjectionRefresh({
    groupsOverride: [{ id: "projector_base", enabled: true, layers: [{ id: "model_base", enabled: true }] }],
  });
  expect(image.style.opacity).toBe("0");
  time = 300;
  frame.callback(time);
  expect(Number(image.style.opacity)).toBeGreaterThan(0);
  expect(Number(image.style.opacity)).toBeLessThan(1);
  expect(requestDraw).toHaveBeenCalled();

  image.style.opacity = "1";
  requestDraw.mockClear();
  await applyProjectionRefresh({
    groupsOverride: [{ id: "projector_base", enabled: true, layers: [{ id: "model_base", enabled: true }] }],
  });
  expect(image.style.opacity).toBe("1");
  expect(requestDraw).not.toHaveBeenCalled();

  await applyProjectionRefresh({
    fromSlideshowTick: true,
    groupsOverride: [{ id: "projector_base", enabled: true, layers: [{ id: "model_base", enabled: false }] }],
    layerStyleOptions: { lifecycle: { retainDisabled: true } },
  });
  expect(image.style.opacity).toBe("0");
  expect(image.style.transition).toBe("none");
  expect(requestDraw).not.toHaveBeenCalled();
});

test("a same-set refresh starts a ready model and a new WMTS layer together", async () => {
  let time = 0;
  let frame = null;
  const hooks = {
    now: () => time,
    requestFrame(callback) { frame = { callback }; return 1; },
    cancelFrame() { frame = null; },
    setTimer() { return 1; },
    clearTimer() {},
  };
  const map = createFakeMapLibreMap();
  const runtime = getLayerLifecycleRuntime(map, hooks);
  const image = {
    complete: true,
    naturalWidth: 8,
    naturalHeight: 4,
    style: { opacity: "0", transition: "" },
    addEventListener() {},
    removeEventListener() {},
  };
  const wmtsId = "proj.wmts_base";
  const rasterId = `wmts__${wmtsId}__raster`;
  vi.spyOn(layerRegistry, "getLayerConfig").mockImplementation((id) => (
    id === wmtsId
      ? { fullId: wmtsId, groupId: "proj", id: "wmts_base", format: "wmts", wmts: { urlTemplate: "https://example.com/{z}/{x}/{y}.png", opacity: 1 } }
      : undefined
  ));
  const modelGroup = { id: "projector_base", enabled: true, layers: [{ id: "model_base", enabled: true }] };
  const withWmts = [modelGroup, { id: "proj", enabled: true, layers: [{ id: "wmts_base", enabled: true }] }];
  let layersJoinedOpenBatch = false;
  const { applyProjectionRefresh } = createProjectionCuratedRefresh({
    map,
    updateModelVisibility: (groups, modelInfo) => syncProjectionModelImage({
      map,
      imageEl: image,
      layerGroups: groups,
      modelInfo,
      sealBatch: false,
      requestDraw: () => {},
    }),
    syncProjectionLayersWithNarrative: (_map, groups, options) => {
      const pending = runtime.getPendingBatch();
      layersJoinedOpenBatch = !!pending && pending.sealed === false;
      syncProjectionLayers(_map, groups, options);
    },
  });
  await applyProjectionRefresh({ groupsOverride: [modelGroup] });
  time = 600;
  frame.callback(time);
  expect(image.style.opacity).toBe("1");
  try {
    layersJoinedOpenBatch = false;
    await applyProjectionRefresh({ groupsOverride: withWmts });
    expect(layersJoinedOpenBatch).toBe(true);
    expect(map.getPaintProperty(rasterId, "raster-opacity")).toBe(0);
    time = 900;
    frame.callback(time);
    const raster = Number(map.getPaintProperty(rasterId, "raster-opacity"));
    expect(raster).toBeGreaterThan(0);
    expect(raster).toBeLessThan(1);
    expect(image.style.opacity).toBe("1");
  } finally {
    vi.restoreAllMocks();
  }
});

function markerNamespace(added, removed) {
  class Marker {
    setLngLat() { return this; }
    setPopup() { return this; }
    addTo() { added.push(this); return this; }
    remove() { removed.push(this); }
  }
  class Popup {
    setHTML() { return this; }
  }
  return { Marker, Popup };
}
