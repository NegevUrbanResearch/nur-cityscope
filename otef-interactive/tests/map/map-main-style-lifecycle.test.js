import { afterEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { createGisBasemapStyleCoordinator, installGisStyleReload } from "../../frontend/src/entries/map-main-style-lifecycle.js";
import { createCuratedDisplayGate, createGisCuratedRefresh, loadCuratedLayerToMapLibre, removeCuratedHtmlMarkers } from "../../frontend/src/map/maplibre-curated-layer-loader.js";
import * as curatedService from "../../frontend/src/shared/curated-layer-service.js";

describe("map-main GIS style reload lifecycle", () => {
  test("wraps every GIS layer-group apply with a synchronous Nova victim filter", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../frontend/src/entries/map-main.js"),
      "utf8",
    );
    expect(source).toMatch(
      /const applyGisLayerGroups = \(groups\) => \{\s*applyLayerGroupsToMap\(map, groups\);\s*applyNarrativePeopleFilter\(map, OTEFDataContext\.getNarrativeState\?\.\(\)\?\.id \?\? null\);\s*const selectedPid = OTEFDataContext\.getPersonSelection\?\.\(\)\?\.personId;\s*if \(selectedPid\) applyPeopleFocusDim\(map, selectedPid\);\s*else clearPeopleFocusDim\(map\);\s*applyNarrativeHouseOutlineFilter\(map, OTEFDataContext\.getNarrativeState\?\.\(\)\?\.id \?\? null\);\s*raiseDarkBasemapPlaceLabels\(map\);\s*\};/,
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
    expect(refreshLayers).toHaveBeenCalledWith(expect.objectContaining({ groupsOverride: [], syncFlow: false }));
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
    expect(subscriber).toMatch(/isCurrent:\s*curatedDisplay\.begin\(/);
    expect(subscriber).toMatch(/refreshCuratedLayers\(\{[\s\S]*isCurrent:/);
    expect(source).toMatch(/createGisCuratedRefresh\(/);
    const loader = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../frontend/src/map/maplibre-curated-layer-loader.js"),
      "utf8",
    );
    const refreshStart = loader.indexOf("const refreshCuratedLayers = async");
    const loaderCall = loader.slice(loader.indexOf("await loadCuratedLayerToMapLibre", refreshStart));
    expect(loaderCall.slice(0, 240)).toMatch(/isCurrent:\s*\(\)\s*=>\s*isCurrent\(fullId\)/);
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
    });
    expect(map.getLayer("curated.scene__old")).toBeTruthy();
    expect(map.calls.filter((call) => call.method === "removeLayer")).toHaveLength(0);

    const homeCurrent = gate.begin(["curated.home"]);
    await refreshCuratedLayers({
      groupsOverride: [curatedGroup("curated.home", true), curatedGroup("curated.scene", false)],
      syncFlow: false,
      isCurrent: homeCurrent,
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
