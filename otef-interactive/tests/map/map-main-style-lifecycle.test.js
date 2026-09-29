import { afterEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { createGisBasemapStyleCoordinator, installGisStyleReload } from "../../frontend/src/entries/map-main-style-lifecycle.js";
import { applyLayerGroupsToMap } from "../../frontend/src/map/maplibre-layer-manager.js";
import { createCuratedDisplayGate, createGisCuratedRefresh, loadCuratedLayerToMapLibre, removeCuratedHtmlMarkers } from "../../frontend/src/map/maplibre-curated-layer-loader.js";
import * as curatedService from "../../frontend/src/shared/curated-layer-service.js";
import { LAYER_FADE_MS, LAYER_FADE_READY_TIMEOUT_MS, getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";

const { bridgeMock, registryMock } = vi.hoisted(() => ({
  bridgeMock: { irToMapLibreLayers: vi.fn() },
  registryMock: {
    getLayerConfig: vi.fn(),
    getLayerDataUrl: vi.fn(),
    getLayerPMTilesUrl: vi.fn(),
  },
}));

vi.mock("../../frontend/src/shared/maplibre-style-bridge.js", () => ({
  irToMapLibreLayers: bridgeMock.irToMapLibreLayers,
}));

vi.mock("../../frontend/src/shared/layer-registry.js", () => ({
  default: registryMock,
}));

describe("map-main GIS style reload lifecycle", () => {
  test("wraps every GIS layer-group apply with a synchronous Nova victim filter", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../frontend/src/entries/map-main.js"),
      "utf8",
    );
    expect(source).toMatch(
      /const applyGisLayerGroups = \(groups, layerStyleOptions\) => \{\s*applyLayerGroupsToMap\(map, groups, layerStyleOptions\);\s*applyNarrativePeopleFilter\(map, OTEFDataContext\.getNarrativeState\?\.\(\)\?\.id \?\? null\);\s*const selectedPid = OTEFDataContext\.getPersonSelection\?\.\(\)\?\.personId;\s*if \(selectedPid\) applyPeopleFocusDim\(map, selectedPid\);\s*else clearPeopleFocusDim\(map\);\s*applyNarrativeHouseOutlineFilter\(map, OTEFDataContext\.getNarrativeState\?\.\(\)\?\.id \?\? null\);\s*raiseGisPlaceLabels\(\);\s*\};/,
    );
    expect(source.match(/applyLayerGroupsToMap\(/g)).toHaveLength(1);
  });

  test("reapplies ordinary layers before bringing the selected overlay to front", async () => {
    const map = createFakeMapLibreMap({ layers: [{ id: "otef-person-selection-halo" }] });
    const selected = { bringToFront: vi.fn(() => map.moveLayer("otef-person-selection-halo")) };
    const refreshLayers = vi.fn(async () => {
      map.addLayer({ id: "nli__people__circle", type: "circle" });
    });
    installGisStyleReload({ map, refreshLayers, personVisual: selected, getLayerGroups: () => [] });
    map.emit("style.load");
    await Promise.resolve();
    expect(refreshLayers).toHaveBeenCalledWith(expect.objectContaining({
      groupsOverride: [],
      syncFlow: false,
      reopenGate: true,
    }));
    expect(selected.bringToFront).toHaveBeenCalledTimes(1);
    expect(map.getStyle().layers.at(-1).id).toBe("otef-person-selection-halo");
  });

  test("a newer basemap generation detaches the stale style listener and reconstructs the active narrative last", async () => {
    const map = createFakeMapLibreMap();
    const refreshLayers = vi.fn(async () => {});
    const personVisual = { bringToFront: vi.fn() };
    const narrativeController = { onStyleLoad: vi.fn() };
    installGisStyleReload({ map, refreshLayers, personVisual, narrativeController, getLayerGroups: () => ["satellite"] });
    installGisStyleReload({ map, refreshLayers, personVisual, narrativeController, getLayerGroups: () => ["dark"] });
    expect(map.listenerCount("style.load")).toBe(1);
    map.emit("style.load");
    await Promise.resolve();
    expect(refreshLayers).toHaveBeenCalledTimes(1);
    expect(refreshLayers).toHaveBeenCalledWith(expect.objectContaining({ groupsOverride: ["dark"], syncFlow: false }));
    expect(narrativeController.onStyleLoad).toHaveBeenCalledTimes(1);
  });

  test("a basemap request does not register style.load or reconstruct overlays", async () => {
    const map = createFakeMapLibreMap();
    const refreshLayers = vi.fn(async () => {});
    const personVisual = { bringToFront: vi.fn() };
    const narrativeController = { onStyleLoad: vi.fn() };
    const onStyleLoad = vi.fn();
    const coordinator = createGisBasemapStyleCoordinator({
      map,
      initialBasemap: "dark",
      setBasemap: vi.fn(() => true),
      refreshLayers,
      personVisual,
      narrativeController,
      getLayerGroups: () => ["satellite"],
      onStyleLoad,
    });

    expect(coordinator.request("satellite")).toBe(true);
    expect(map.listenerCount("style.load")).toBe(0);
    map.emit("style.load");
    await Promise.resolve();
    expect(refreshLayers).not.toHaveBeenCalled();
    expect(personVisual.bringToFront).not.toHaveBeenCalled();
    expect(narrativeController.onStyleLoad).not.toHaveBeenCalled();
    expect(onStyleLoad).not.toHaveBeenCalled();
  });

  test("the map-main coordinator call site does not remount overlays for a basemap change", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../frontend/src/entries/map-main.js"),
      "utf8",
    );
    const lifecycle = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../frontend/src/entries/map-main-style-lifecycle.js"),
      "utf8",
    );
    const start = source.indexOf("const basemapCoordinator = createGisBasemapStyleCoordinator({");
    const end = source.indexOf("registerDisposer(() => basemapCoordinator.dispose())", start);
    const call = source.slice(start, end);
    expect(call).not.toContain("refreshLayers");
    expect(call).not.toContain("onStyleLoad");
    expect(call).not.toContain("clearAllLayers");
    expect(call).not.toContain("personVisual");
    expect(call).not.toContain("narrativeController");
    expect(source).toContain("installMapLegendLifecycle({");
    const requestStart = lifecycle.indexOf("const request = ");
    const request = lifecycle.slice(requestStart, lifecycle.indexOf("return {", requestStart));
    expect(request).not.toContain("installGisStyleReload");
    expect(request).not.toContain("style.load");
    expect(request).not.toContain("refreshLayers");
  });

  test("synchronous rejection keeps the earlier requested id and its settlement", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let settleSatellite;
    const setBasemap = vi.fn((map, id, options = {}) => {
      if (id === "osm") return false;
      settleSatellite = options.onSettled;
      return true;
    });
    const coordinator = createGisBasemapStyleCoordinator({
      map: createFakeMapLibreMap(),
      initialBasemap: "dark",
      setBasemap,
    });

    expect(coordinator.request("satellite")).toBe(true);
    expect(coordinator.request("osm")).toBe(false);
    expect(coordinator.getRequestedBasemap()).toBe("satellite");
    expect(settleSatellite).toEqual(expect.any(Function));
    settleSatellite({ status: "failed", basemapId: "dark" });
    expect(coordinator.getRequestedBasemap()).toBe("dark");
    warn.mockRestore();
  });

  test("an invalid basemap id does not advance generation or drop an in-flight settlement", () => {
    let settleSatellite;
    const setBasemap = vi.fn((map, id, options = {}) => {
      if (id === "satellite") settleSatellite = options.onSettled;
      return id !== "not-real";
    });
    const coordinator = createGisBasemapStyleCoordinator({
      map: createFakeMapLibreMap(),
      initialBasemap: "dark",
      setBasemap,
    });

    expect(coordinator.request("satellite")).toBe(true);
    expect(coordinator.request("not-real")).toBe(false);
    expect(setBasemap).toHaveBeenCalledTimes(1);
    expect(coordinator.getRequestedBasemap()).toBe("satellite");
    settleSatellite({ status: "completed", basemapId: "satellite" });
    expect(coordinator.getRequestedBasemap()).toBe("satellite");
  });

  test("synchronous settlement records the retained id before the setter returns", () => {
    const completed = createGisBasemapStyleCoordinator({
      map: createFakeMapLibreMap(),
      initialBasemap: "dark",
      setBasemap: vi.fn((map, id, options = {}) => {
        expect(options.onSettled).toEqual(expect.any(Function));
        options.onSettled({ status: "completed", basemapId: id });
        return true;
      }),
    });
    expect(completed.request("satellite")).toBe(true);
    expect(completed.getRequestedBasemap()).toBe("satellite");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failed = createGisBasemapStyleCoordinator({
      map: createFakeMapLibreMap(),
      initialBasemap: "dark",
      setBasemap: vi.fn((map, id, options = {}) => {
        options.onSettled({ status: "failed", basemapId: "dark" });
        return true;
      }),
    });
    expect(failed.request("satellite")).toBe(true);
    expect(failed.getRequestedBasemap()).toBe("dark");
    warn.mockRestore();
  });

  test("failure allows the same target again and a pending duplicate stays a no-op", () => {
    const pending = new Map();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setBasemap = vi.fn((map, id, options = {}) => {
      pending.set(id, options.onSettled);
      return true;
    });
    const coordinator = createGisBasemapStyleCoordinator({
      map: createFakeMapLibreMap(),
      initialBasemap: "dark",
      setBasemap,
    });

    expect(coordinator.request("satellite")).toBe(true);
    expect(coordinator.request("satellite")).toBe(false);
    expect(setBasemap).toHaveBeenCalledTimes(1);
    const settle = pending.get("satellite");
    expect(settle).toEqual(expect.any(Function));
    settle({ status: "failed", basemapId: "dark" });
    expect(coordinator.getRequestedBasemap()).toBe("dark");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("satellite"));

    expect(coordinator.request("satellite")).toBe(true);
    expect(setBasemap).toHaveBeenCalledTimes(2);
    expect(coordinator.request("satellite")).toBe(false);
    expect(setBasemap).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  test("a stale settlement does not replace the latest requested id", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const settlements = [];
    const setBasemap = vi.fn((map, id, options = {}) => {
      settlements.push(options.onSettled);
      return true;
    });
    const coordinator = createGisBasemapStyleCoordinator({
      map: createFakeMapLibreMap(),
      initialBasemap: "dark",
      setBasemap,
    });

    expect(coordinator.request("satellite")).toBe(true);
    expect(coordinator.request("osm")).toBe(true);
    expect(settlements[0]).toEqual(expect.any(Function));
    settlements[0]({ status: "completed", basemapId: "satellite" });
    expect(coordinator.getRequestedBasemap()).toBe("osm");
    settlements[1]({ status: "failed", basemapId: "dark" });
    expect(coordinator.getRequestedBasemap()).toBe("dark");
    warn.mockRestore();
  });

  test("dispose ignores a late settlement", () => {
    let settle;
    const setBasemap = vi.fn((map, id, options = {}) => {
      settle = options.onSettled;
      return true;
    });
    const coordinator = createGisBasemapStyleCoordinator({
      map: createFakeMapLibreMap(),
      initialBasemap: "dark",
      setBasemap,
    });

    expect(coordinator.request("satellite")).toBe(true);
    coordinator.dispose();
    expect(settle).toEqual(expect.any(Function));
    settle({ status: "failed", basemapId: "dark" });
    expect(coordinator.getRequestedBasemap()).toBe("satellite");
  });

  test("curated refresh restores the narrative marker above a later curated layer only while current", async () => {
    const map = createFakeMapLibreMap({ layers: [{ id: "nli-narrative-focus" }] });
    const refreshLayers = vi.fn(async () => {
      map.addLayer({ id: "curated_workshop__new-layer", type: "fill" });
    });
    const narrativeController = {
      onStyleLoad: vi.fn(() => map.moveLayer("nli-narrative-focus")),
    };
    installGisStyleReload({ map, refreshLayers, narrativeController, getLayerGroups: () => [] });
    map.emit("style.load");
    await Promise.resolve();

    expect(narrativeController.onStyleLoad).toHaveBeenCalledTimes(1);
    expect(map.getStyle().layers.at(-1).id).toBe("nli-narrative-focus");

    const entry = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../frontend/src/entries/map-main.js"),
      "utf8",
    );
    const loader = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../frontend/src/map/maplibre-curated-layer-loader.js"),
      "utf8",
    );
    const refreshStart = loader.indexOf("const refreshCuratedLayers = async");
    const curatedRefresh = loader.slice(refreshStart, loader.indexOf("return {", refreshStart));
    expect(curatedRefresh).toMatch(/syncPinkLine\(map, groupsAsArray\);\s*if \(!isCurrent\(\)\) return;\s*getNarrativeController\(\)\?\.onStyleLoad/);
    expect(entry).toMatch(/getNarrativeController:\s*\(\)\s*=>\s*narrativeController/);
  });

  test("the live layerGroups subscriber carries generation, liveness, and desired-id checks into the loader", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../frontend/src/entries/map-main.js"),
      "utf8",
    );
    const subscriber = source.slice(
      source.indexOf('OTEFDataContext.subscribe("layerGroups"'),
      source.indexOf("// Curated layers (Supabase-synced overlays"),
    );
    expect(subscriber).not.toMatch(/curatedDisplay\.begin\(/);
    expect(source).toMatch(/displayGate:\s*curatedDisplay/);
    expect(subscriber).toMatch(/refreshCuratedLayers\(\{/);
    expect(source).toMatch(/createGisCuratedRefresh\(/);
    const loader = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../frontend/src/map/maplibre-curated-layer-loader.js"),
      "utf8",
    );
    const refreshStart = loader.indexOf("const refreshCuratedLayers = async");
    const loaderCall = loader.slice(loader.indexOf("loadCuratedLayerToMapLibre", refreshStart));
    expect(loaderCall.slice(0, 400)).toMatch(/isCurrent/);
    const batchSession = loader.slice(
      loader.indexOf("function createCuratedBatchSession"),
      loader.indexOf("export function createGisCuratedRefresh"),
    );
    expect(batchSession).toMatch(/sameSet/);
    expect(source).not.toMatch(/curatedDisplay\.invalidateStyle\(\)/);
    expect(source).toMatch(/curatedDisplay\.dispose\(\)/);
    const applyAt = loader.indexOf("applyLayerGroups(", refreshStart);
    const loadAwaitAt = loader.indexOf("await loadCuratedLayerToMapLibre", refreshStart);
    expect(applyAt).toBeGreaterThan(refreshStart);
    expect(applyAt).toBeLessThan(loadAwaitAt);
  });
});

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

describe("GIS live curated display freshness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    removeCuratedHtmlMarkers("curated.scene");
    removeCuratedHtmlMarkers("curated.home");
  });

  test("enable then Home drops the stale fetch and still mounts the desired Home load", async () => {
    const sceneData = defer();
    const homeData = defer();
    vi.spyOn(curatedService, "fetchCuratedLayerData")
      .mockReturnValueOnce(sceneData.promise)
      .mockReturnValueOnce(homeData.promise);
    vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths: [], pinkGeojson: null });
    const map = createFakeMapLibreMap();
    let alive = true;
    const gate = createCuratedDisplayGate({ isMapAlive: () => alive });
    const sceneCurrent = gate.begin(["curated.scene"]);
    const sceneLoad = loadCuratedLayerToMapLibre(map, "curated.scene", {
      force: true,
      isCurrent: () => sceneCurrent("curated.scene"),
    });
    const homeCurrent = gate.begin(["curated.home"]);
    const homeLoad = loadCuratedLayerToMapLibre(map, "curated.home", {
      force: true,
      isCurrent: () => homeCurrent("curated.home"),
    });
    homeData.resolve({ geojson: polygonCollection("home"), layerData: {} });
    await homeLoad;
    sceneData.resolve({ geojson: polygonCollection("scene"), layerData: {} });
    await sceneLoad;
    expect(map.getLayer("curated.scene__plain__fill")).toBeFalsy();
    expect(map.getLayer("curated.home__plain__fill")).toBeTruthy();
  });

  test("style reload and dispose drop an in-flight load, then the current desired load mounts", async () => {
    const staleData = defer();
    vi.spyOn(curatedService, "fetchCuratedLayerData")
      .mockReturnValueOnce(staleData.promise)
      .mockResolvedValueOnce({ geojson: polygonCollection("next"), layerData: {} });
    vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths: [], pinkGeojson: null });
    const map = createFakeMapLibreMap();
    let alive = true;
    const gate = createCuratedDisplayGate({ isMapAlive: () => alive });
    const first = gate.begin(["curated.scene"]);
    const staleLoad = loadCuratedLayerToMapLibre(map, "curated.scene", {
      force: true,
      isCurrent: () => first("curated.scene"),
    });
    gate.invalidateStyle();
    const next = gate.begin(["curated.scene"]);
    await loadCuratedLayerToMapLibre(map, "curated.scene", {
      force: true,
      isCurrent: () => next("curated.scene"),
    });
    staleData.resolve({ geojson: polygonCollection("stale"), layerData: {} });
    await staleLoad;
    expect(map.getLayer("curated.scene__plain__fill")).toBeTruthy();

    const disposedData = defer();
    curatedService.fetchCuratedLayerData.mockReturnValueOnce(disposedData.promise);
    const beforeDispose = gate.begin(["curated.home"]);
    const disposedLoad = loadCuratedLayerToMapLibre(map, "curated.home", {
      force: true,
      isCurrent: () => beforeDispose("curated.home"),
    });
    alive = false;
    gate.dispose();
    disposedData.resolve({ geojson: polygonCollection("disposed"), layerData: {} });
    await disposedLoad;
    expect(map.getLayer("curated.home__plain__fill")).toBeFalsy();
  });

  test("an affected refresh keeps a still-wanted layer until replacement and a stale fetch cannot restore a dropped layer", async () => {
    const sceneData = defer();
    vi.spyOn(curatedService, "fetchCuratedLayerData").mockImplementation((fullId) => {
      if (fullId === "curated.scene") return sceneData.promise;
      return Promise.resolve({ geojson: polygonCollection("home"), layerData: {} });
    });
    vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths: [], pinkGeojson: null });
    const map = createFakeMapLibreMap({ layers: [{ id: "curated.scene__old", type: "fill" }] });
    const gate = createCuratedDisplayGate({ isMapAlive: () => true });
    const { refreshCuratedLayers } = createGisCuratedRefresh({ map });
    const sceneCurrent = gate.begin(["curated.scene"]);
    const staleRefresh = refreshCuratedLayers({
      affectedCuratedFullLayerIds: ["curated.scene"],
      groupsOverride: [curatedGroup("curated.scene", true)],
      syncFlow: false,
      isCurrent: sceneCurrent,
      layerStyleOptions: { transition: { transitionMs: 0 } },
    });
    expect(map.getLayer("curated.scene__old")).toBeTruthy();
    expect(map.calls.filter((call) => call.method === "removeLayer")).toHaveLength(0);

    const homeCurrent = gate.begin(["curated.home"]);
    await refreshCuratedLayers({
      groupsOverride: [curatedGroup("curated.home", true), curatedGroup("curated.scene", false)],
      syncFlow: false,
      isCurrent: homeCurrent,
      layerStyleOptions: { transition: { transitionMs: 0 } },
    });
    expect(map.getLayer("curated.scene__old")).toBeFalsy();
    expect(map.getLayer("curated.home__plain__fill")).toBeTruthy();

    sceneData.resolve({ geojson: polygonCollection("scene"), layerData: {} });
    await staleRefresh;
    expect(map.getLayer("curated.scene__plain__fill")).toBeFalsy();
    expect(map.getLayer("curated.scene__old")).toBeFalsy();
    expect(map.getLayer("curated.home__plain__fill")).toBeTruthy();
    expect(sceneCurrent("curated.scene")).toBe(false);
    expect(homeCurrent("curated.home")).toBe(true);
  });
});

function curatedGroup(fullId, enabled) {
  const [groupId, layerId] = fullId.split(".");
  return { id: groupId, layers: [{ id: layerId, enabled }] };
}

function createLifecycleHooks() {
  let time = 0;
  let frame = null;
  let nextFrameId = 0;
  let nextTimerId = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTime(value) { time = value; },
    requestFrame(callback) {
      nextFrameId += 1;
      frame = { id: nextFrameId, callback };
      return nextFrameId;
    },
    cancelFrame(id) { if (frame?.id === id) frame = null; },
    flushFrame() {
      const current = frame;
      frame = null;
      current?.callback(time);
    },
    setTimer(callback, delay) {
      nextTimerId += 1;
      timers.set(nextTimerId, { callback, at: time + delay });
      return nextTimerId;
    },
    clearTimer(id) { timers.delete(id); },
    fireDueTimers() {
      for (const [id, timer] of [...timers]) {
        if (timer.at <= time) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
}

async function settle() {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

function markerNamespace(added, removed) {
  class Marker {
    constructor(options = {}) {
      this.element = options.element || { style: {} };
    }
    getElement() { return this.element; }
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

describe("GIS curated and registry refresh batches", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    removeCuratedHtmlMarkers("curated.scene");
    removeCuratedHtmlMarkers("curated.home");
    removeCuratedHtmlMarkers("curated.4");
    removeCuratedHtmlMarkers("curated.42");
    removeCuratedHtmlMarkers("curated.a");
    removeCuratedHtmlMarkers("curated.b");
    removeCuratedHtmlMarkers("curated.points");
  });

  test("defers map and HTML cleanup until factor 0 and reverses from the sampled factor", async () => {
    vi.spyOn(curatedService, "fetchCuratedLayerData").mockResolvedValue({
      geojson: pointCollection(),
      layerData: {},
    });
    vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths: [], pinkGeojson: null });
    globalThis.document = { createElement: () => ({ style: {}, innerHTML: "", className: "" }) };
    const added = [];
    const removed = [];
    const map = createFakeMapLibreMap();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const narrative = { onStyleLoad: vi.fn() };
    const { refreshCuratedLayers } = createGisCuratedRefresh({
      map,
      resolveMaplibregl: async () => markerNamespace(added, removed),
      getNarrativeController: () => narrative,
    });

    await refreshCuratedLayers({
      groupsOverride: [curatedGroup("curated.points", true)],
      syncFlow: false,
    });
    expect(narrative.onStyleLoad).toHaveBeenCalledTimes(1);
    expect(added).toHaveLength(1);
    expect(added[0].getElement().style.opacity).toBe("0");
    hooks.setTime(LAYER_FADE_MS);
    hooks.flushFrame();
    expect(added[0].getElement().style.opacity).toBe("1");

    const hide = refreshCuratedLayers({
      groupsOverride: [curatedGroup("curated.points", false)],
      syncFlow: false,
    });
    await hide;
    expect(removed).toHaveLength(0);
    expect(added[0].getElement().style.opacity).toBe("1");
    hooks.setTime(LAYER_FADE_MS + 300);
    hooks.flushFrame();
    expect(Number(added[0].getElement().style.opacity)).toBeCloseTo(0.5);
    expect(removed).toHaveLength(0);

    await refreshCuratedLayers({
      groupsOverride: [curatedGroup("curated.points", true)],
      syncFlow: false,
    });
    hooks.setTime(LAYER_FADE_MS + 300 + LAYER_FADE_MS);
    hooks.flushFrame();
    expect(Number(added[0].getElement().style.opacity)).toBeCloseTo(1);
    expect(removed).toHaveLength(0);
    expect(added).toHaveLength(1);
  });

  test("curated.4 teardown does not remove curated.42, and point HTML stays out of the generic manager", async () => {
    vi.spyOn(curatedService, "fetchCuratedLayerData").mockImplementation((fullId) => Promise.resolve({
      geojson: fullId === "curated.points" ? pointCollection() : polygonCollection(fullId),
      layerData: {},
    }));
    vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths: [], pinkGeojson: null });
    globalThis.document = { createElement: () => ({ style: {}, innerHTML: "", className: "" }) };
    const added = [];
    const removed = [];
    const map = createFakeMapLibreMap();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const { refreshCuratedLayers } = createGisCuratedRefresh({
      map,
      applyLayerGroups: (groups, options) => applyLayerGroupsToMap(map, groups, options),
      resolveMaplibregl: async () => markerNamespace(added, removed),
    });
    await refreshCuratedLayers({
      groupsOverride: [
        curatedGroup("curated.4", true),
        curatedGroup("curated.42", true),
        curatedGroup("curated.points", true),
      ],
      syncFlow: false,
    });
    hooks.setTime(LAYER_FADE_MS);
    hooks.flushFrame();
    const markerCount = added.length;

    await refreshCuratedLayers({
      groupsOverride: [
        curatedGroup("curated.4", false),
        curatedGroup("curated.42", true),
        curatedGroup("curated.points", true),
      ],
      syncFlow: false,
    });
    expect(map.getLayer("curated.42__plain__fill")).toBeTruthy();
    expect(map.getLayer("curated.4__plain__fill")).toBeTruthy();
    applyLayerGroupsToMap(map, []);
    expect(removed).toHaveLength(0);
    expect(added).toHaveLength(markerCount);

    hooks.setTime(LAYER_FADE_MS * 2);
    hooks.flushFrame();
    expect(map.getLayer("curated.4__plain__fill")).toBeFalsy();
    expect(map.getLayer("curated.42__plain__fill")).toBeTruthy();
    expect(map.getPaintProperty("curated.42__plain__fill", "fill-opacity")).toBeCloseTo(0.4);
  });

  test("keeps a same-set refresh on the pending gate and transfers an affected replacement at the current factor", async () => {
    const replacement = defer();
    let sceneFetches = 0;
    vi.spyOn(curatedService, "fetchCuratedLayerData").mockImplementation(() => {
      sceneFetches += 1;
      if (sceneFetches === 1) return Promise.resolve({ geojson: polygonCollection("first"), layerData: {} });
      return replacement.promise;
    });
    vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths: [], pinkGeojson: null });
    const map = createFakeMapLibreMap();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const gate = createCuratedDisplayGate({ isMapAlive: () => true });
    const begin = vi.spyOn(gate, "begin");
    const { refreshCuratedLayers } = createGisCuratedRefresh({ map, displayGate: gate });

    await refreshCuratedLayers({
      groupsOverride: [curatedGroup("curated.scene", true)],
      syncFlow: false,
    });
    expect(begin).toHaveBeenCalledTimes(1);
    hooks.setTime(300);
    hooks.flushFrame();
    expect(map.getPaintProperty("curated.scene__plain__fill", "fill-opacity")).toBeCloseTo(0.2);

    await refreshCuratedLayers({
      groupsOverride: [curatedGroup("curated.scene", true)],
      syncFlow: false,
    });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(sceneFetches).toBe(1);
    expect(map.getPaintProperty("curated.scene__plain__fill", "fill-opacity")).toBeCloseTo(0.2);

    const affected = refreshCuratedLayers({
      affectedCuratedFullLayerIds: ["curated.scene"],
      groupsOverride: [curatedGroup("curated.scene", true)],
      syncFlow: false,
    });
    await settle();
    expect(map.getLayer("curated.scene__plain__fill")).toBeTruthy();
    expect(map.calls.filter((call) => call.method === "removeLayer" && call.id === "curated.scene__plain__fill")).toHaveLength(0);
    replacement.resolve({ geojson: polygonCollection("next"), layerData: {} });
    await affected;
    expect(map.getLayer("curated.scene__plain__fill")).toBeTruthy();
    expect(map.getPaintProperty("curated.scene__plain__fill", "fill-opacity")).toBeCloseTo(0.2);
    expect(begin).toHaveBeenCalledTimes(2);
  });

  test("waits for a curated GeoJSON source before joining the shared reveal", async () => {
    vi.spyOn(curatedService, "fetchCuratedLayerData").mockResolvedValue({
      geojson: polygonCollection("scene"),
      layerData: {},
    });
    vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths: [], pinkGeojson: null });
    const map = createFakeMapLibreMap();
    let sourceLoaded = false;
    map.isSourceLoaded = vi.fn(() => sourceLoaded);
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const { refreshCuratedLayers } = createGisCuratedRefresh({ map });

    await refreshCuratedLayers({
      groupsOverride: [curatedGroup("curated.scene", true)],
      syncFlow: false,
    });
    hooks.setTime(300);
    hooks.flushFrame();
    expect(map.getPaintProperty("curated.scene__plain__fill", "fill-opacity")).toBe(0);

    sourceLoaded = true;
    map.emit("sourcedata", { sourceId: "curated.scene__plain__src" });
    hooks.setTime(600);
    hooks.flushFrame();
    expect(map.getPaintProperty("curated.scene__plain__fill", "fill-opacity")).toBeCloseTo(0.2);
  });

  test("force-replaces curated HTML at the sampled factor without retaining the old element", async () => {
    vi.spyOn(curatedService, "fetchCuratedLayerData").mockResolvedValue({
      geojson: pointCollection(),
      layerData: {},
    });
    vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths: [], pinkGeojson: null });
    globalThis.document = { createElement: () => ({ style: {}, innerHTML: "", className: "" }) };
    const added = [];
    const removed = [];
    const map = createFakeMapLibreMap();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const { refreshCuratedLayers } = createGisCuratedRefresh({
      map,
      resolveMaplibregl: async () => markerNamespace(added, removed),
    });

    await refreshCuratedLayers({
      groupsOverride: [curatedGroup("curated.points", true)],
      syncFlow: false,
    });
    hooks.setTime(300);
    hooks.flushFrame();
    const oldElement = added[0].getElement();
    expect(oldElement.style.opacity).toBe("0.5");

    await refreshCuratedLayers({
      affectedCuratedFullLayerIds: ["curated.points"],
      groupsOverride: [curatedGroup("curated.points", true)],
      syncFlow: false,
    });
    const newElement = added[1].getElement();
    expect(removed).toContain(added[0]);
    expect(newElement.style.opacity).toBe("0.5");

    hooks.setTime(450);
    hooks.flushFrame();
    expect(oldElement.style.opacity).toBe("0.5");
    expect(newElement.style.opacity).toBe("0.75");
  });

  test("reveals registry expressions and curated layers together when preparations finish 400ms apart", async () => {
    const first = defer();
    const second = defer();
    vi.spyOn(curatedService, "fetchCuratedLayerData").mockImplementation((fullId) => (
      fullId === "curated.a" ? first.promise : second.promise
    ));
    vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths: [], pinkGeojson: null });
    registryMock.getLayerConfig.mockImplementation((id) => (
      id === "borders.ring" ? { format: "geojson" } : undefined
    ));
    registryMock.getLayerDataUrl.mockReturnValue("/borders.geojson");
    bridgeMock.irToMapLibreLayers.mockImplementation((fullId) => [{
      id: `${fullId}-circle`,
      type: "circle",
      paint: {
        "circle-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.4, 10, 0.8],
        "circle-stroke-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.2, 10, 1],
      },
      layout: {},
    }]);
    const map = createFakeMapLibreMap();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const { refreshCuratedLayers } = createGisCuratedRefresh({
      map,
      applyLayerGroups: (groups, options) => applyLayerGroupsToMap(map, groups, options),
    });
    const refresh = refreshCuratedLayers({
      groupsOverride: [
        { id: "borders", layers: [{ id: "ring", enabled: true }] },
        curatedGroup("curated.a", true),
        curatedGroup("curated.b", true),
      ],
      syncFlow: false,
    });
    await settle();
    expect(map.getPaintProperty("borders.ring-circle", "circle-opacity")).toEqual(
      ["interpolate", ["linear"], ["zoom"], 0, 0, 10, 0],
    );
    expect(map.getLayer("curated.a__plain__fill")).toBeFalsy();

    hooks.setTime(400);
    first.resolve({ geojson: polygonCollection("a"), layerData: {} });
    await settle();
    expect(map.getPaintProperty("curated.a__plain__fill", "fill-opacity")).toBe(0);
    expect(map.getPaintProperty("borders.ring-circle", "circle-stroke-opacity")).toEqual(
      ["interpolate", ["linear"], ["zoom"], 0, 0, 10, 0],
    );

    hooks.setTime(800);
    second.resolve({ geojson: polygonCollection("b"), layerData: {} });
    await refresh;
    expect(map.getPaintProperty("curated.b__plain__fill", "fill-opacity")).toBe(0);
    hooks.setTime(1100);
    hooks.flushFrame();
    expect(map.getPaintProperty("curated.a__plain__fill", "fill-opacity")).toBeCloseTo(0.2);
    expect(map.getPaintProperty("curated.b__plain__fill", "fill-opacity")).toBeCloseTo(0.2);
    expect(map.getPaintProperty("borders.ring-circle", "circle-opacity")).toEqual(
      ["interpolate", ["linear"], ["zoom"], 0, 0.2, 10, 0.4],
    );
    expect(map.getPaintProperty("borders.ring-circle", "circle-stroke-opacity")).toEqual(
      ["interpolate", ["linear"], ["zoom"], 0, 0.1, 10, 0.5],
    );
  });

  test("a failed curated member and a late member do not block the ready member", async () => {
    const late = defer();
    vi.spyOn(curatedService, "fetchCuratedLayerData").mockImplementation((fullId) => {
      if (fullId === "curated.a") return Promise.resolve({ geojson: polygonCollection("a"), layerData: {} });
      if (fullId === "curated.b") return Promise.reject(new Error("curated failed"));
      return late.promise;
    });
    vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths: [], pinkGeojson: null });
    const map = createFakeMapLibreMap();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const { refreshCuratedLayers } = createGisCuratedRefresh({ map });
    const refresh = refreshCuratedLayers({
      groupsOverride: [
        curatedGroup("curated.a", true),
        curatedGroup("curated.b", true),
        curatedGroup("curated.home", true),
      ],
      syncFlow: false,
    });
    await settle();
    hooks.setTime(300);
    hooks.flushFrame();
    expect(map.getPaintProperty("curated.a__plain__fill", "fill-opacity")).toBe(0);
    expect(map.getLayer("curated.b__plain__fill")).toBeFalsy();
    expect(map.getLayer("curated.home__plain__fill")).toBeFalsy();

    hooks.setTime(LAYER_FADE_READY_TIMEOUT_MS);
    hooks.fireDueTimers();
    hooks.setTime(LAYER_FADE_READY_TIMEOUT_MS + 300);
    hooks.flushFrame();
    expect(map.getPaintProperty("curated.a__plain__fill", "fill-opacity")).toBeCloseTo(0.2);
    expect(map.getLayer("curated.home__plain__fill")).toBeFalsy();

    late.resolve({ geojson: polygonCollection("home"), layerData: {} });
    await refresh;
    expect(map.getPaintProperty("curated.home__plain__fill", "fill-opacity")).toBe(0);
    hooks.setTime(LAYER_FADE_READY_TIMEOUT_MS + 600);
    hooks.flushFrame();
    expect(map.getPaintProperty("curated.home__plain__fill", "fill-opacity")).toBeCloseTo(0.2);
    expect(map.getLayer("curated.b__plain__fill")).toBeFalsy();
  });

  test("a rejected curated load does not keep a ready sibling hidden", async () => {
    vi.spyOn(curatedService, "fetchCuratedLayerData").mockImplementation((fullId) => (
      fullId === "curated.b"
        ? Promise.reject(new Error("curated failed"))
        : Promise.resolve({ geojson: polygonCollection(fullId), layerData: {} })
    ));
    vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths: [], pinkGeojson: null });
    const map = createFakeMapLibreMap();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const { refreshCuratedLayers } = createGisCuratedRefresh({ map });
    await refreshCuratedLayers({
      groupsOverride: [curatedGroup("curated.a", true), curatedGroup("curated.b", true)],
      syncFlow: false,
    });
    hooks.setTime(300);
    hooks.flushFrame();
    expect(map.getPaintProperty("curated.a__plain__fill", "fill-opacity")).toBeCloseTo(0.2);
    expect(map.getLayer("curated.b__plain__fill")).toBeFalsy();
  });

  test("a same-set republish cannot stop an outgoing fade, and style invalidation drops a stale load", async () => {
    const stale = defer();
    let fetches = 0;
    vi.spyOn(curatedService, "fetchCuratedLayerData").mockImplementation(() => {
      fetches += 1;
      if (fetches === 1) return Promise.resolve({ geojson: polygonCollection("scene"), layerData: {} });
      return stale.promise;
    });
    vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths: [], pinkGeojson: null });
    const map = createFakeMapLibreMap();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const gate = createCuratedDisplayGate({ isMapAlive: () => true });
    const { refreshCuratedLayers } = createGisCuratedRefresh({ map, displayGate: gate });
    await refreshCuratedLayers({
      groupsOverride: [curatedGroup("curated.scene", true)],
      syncFlow: false,
    });
    hooks.setTime(LAYER_FADE_MS);
    hooks.flushFrame();

    await refreshCuratedLayers({
      groupsOverride: [curatedGroup("curated.scene", false)],
      syncFlow: false,
    });
    await refreshCuratedLayers({
      groupsOverride: [curatedGroup("curated.scene", false)],
      syncFlow: false,
    });
    hooks.setTime(LAYER_FADE_MS * 2);
    hooks.flushFrame();
    expect(map.getLayer("curated.scene__plain__fill")).toBeFalsy();

    const pending = refreshCuratedLayers({
      groupsOverride: [curatedGroup("curated.home", true)],
      syncFlow: false,
    });
    await settle();
    gate.invalidateStyle();
    const current = refreshCuratedLayers({
      groupsOverride: [curatedGroup("curated.home", true)],
      syncFlow: false,
      reopenGate: true,
    });
    stale.resolve({ geojson: polygonCollection("stale"), layerData: {} });
    await pending;
    await current;
    expect(map.getLayer("curated.home__plain__fill")).toBeTruthy();
    expect(fetches).toBeGreaterThan(1);
  });

  test("a duration-0 slideshow refresh keeps still-enabled curated and drops a changed pack at once", async () => {
    vi.spyOn(curatedService, "fetchCuratedLayerData").mockImplementation((fullId) => Promise.resolve({
      geojson: fullId === "curated.points" ? pointCollection() : polygonCollection(fullId),
      layerData: {},
    }));
    vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths: [], pinkGeojson: null });
    registryMock.getLayerConfig.mockImplementation((id) => (
      id === "borders.ring" ? { format: "geojson" } : undefined
    ));
    registryMock.getLayerDataUrl.mockReturnValue("/borders.geojson");
    bridgeMock.irToMapLibreLayers.mockImplementation((fullId) => [{
      id: `${fullId}-circle`,
      type: "circle",
      paint: { "circle-opacity": 0.8 },
      layout: {},
    }]);
    globalThis.document = { createElement: () => ({ style: {}, innerHTML: "", className: "" }) };
    const added = [];
    const removed = [];
    const map = createFakeMapLibreMap();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const groups = [
      { id: "borders", layers: [{ id: "ring", enabled: true }] },
      curatedGroup("curated.scene", true),
      curatedGroup("curated.points", true),
    ];
    const { refreshCuratedLayers } = createGisCuratedRefresh({
      map,
      applyLayerGroups: (nextGroups, options) => applyLayerGroupsToMap(map, nextGroups, options),
      resolveMaplibregl: async () => markerNamespace(added, removed),
    });
    await refreshCuratedLayers({ groupsOverride: groups, syncFlow: false });
    expect(map.getLayer("borders.ring-circle")).toBeTruthy();
    expect(map.getLayer("curated.scene__plain__fill")).toBeTruthy();
    expect(added.length).toBeGreaterThan(0);
    const markerCount = added.length;

    await refreshCuratedLayers({
      fromSlideshowTick: true,
      groupsOverride: groups,
      layerStyleOptions: { lifecycle: { retainDisabled: true } },
      syncFlow: false,
    });
    expect(map.getLayer("curated.scene__plain__fill")).toBeTruthy();
    expect(removed).toHaveLength(0);
    expect(added).toHaveLength(markerCount);

    await refreshCuratedLayers({
      fromSlideshowTick: true,
      groupsOverride: [
        { id: "borders", layers: [{ id: "ring", enabled: true }] },
        curatedGroup("curated.scene", true),
        curatedGroup("curated.points", false),
      ],
      layerStyleOptions: { lifecycle: { retainDisabled: true } },
      syncFlow: false,
    });
    expect(removed.length).toBeGreaterThan(0);
    expect(map.getLayer("curated.scene__plain__fill")).toBeTruthy();
    expect(hooks.now()).toBe(0);
  });

  test("a supabase reload with no affected ids reconstructs mounted curated, and a same-set publish does not", async () => {
    const replacement = defer();
    let fetches = 0;
    vi.spyOn(curatedService, "fetchCuratedLayerData").mockImplementation(() => {
      fetches += 1;
      if (fetches === 1) return Promise.resolve({ geojson: polygonCollection("first"), layerData: {} });
      return replacement.promise;
    });
    vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths: [], pinkGeojson: null });
    const map = createFakeMapLibreMap();
    const hooks = createLifecycleHooks();
    getLayerLifecycleRuntime(map, hooks);
    const groups = [curatedGroup("curated.scene", true)];
    const { refreshCuratedLayers } = createGisCuratedRefresh({
      map,
      getLayerGroups: () => groups,
    });
    const sceneLabel = () => map.getSource("curated.scene__plain__src")?.data?.features?.[0]?.properties?.label;

    await refreshCuratedLayers({ groupsOverride: groups, syncFlow: false });
    hooks.setTime(300);
    hooks.flushFrame();
    expect(map.getPaintProperty("curated.scene__plain__fill", "fill-opacity")).toBeCloseTo(0.2);
    expect(sceneLabel()).toBe("first");

    await refreshCuratedLayers({ groupsOverride: groups, syncFlow: false });
    expect(fetches).toBe(1);
    expect(sceneLabel()).toBe("first");

    vi.useFakeTimers();
    try {
      const { syncCuratedMapLayersAfterSupabasePull } = await import(
        "../../frontend/src/map/map-curated-supabase-sync.js"
      );
      const pending = syncCuratedMapLayersAfterSupabasePull({
        reloadCuratedOnMap: (options = {}) => refreshCuratedLayers({
          ...options,
          syncFlow: false,
        }),
      });
      vi.advanceTimersByTime(400);
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      expect(fetches).toBe(2);
      expect(sceneLabel()).toBe("first");
      replacement.resolve({ geojson: polygonCollection("next"), layerData: {} });
      await pending;
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      expect(sceneLabel()).toBe("next");
      expect(map.getPaintProperty("curated.scene__plain__fill", "fill-opacity")).toBeCloseTo(0.2);
    } finally {
      vi.useRealTimers();
    }
  });
});
