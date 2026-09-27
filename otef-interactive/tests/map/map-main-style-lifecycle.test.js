import { afterEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { installGisStyleReload } from "../../frontend/src/entries/map-main-style-lifecycle.js";
import { createCuratedDisplayGate, createGisCuratedRefresh, loadCuratedLayerToMapLibre, removeCuratedHtmlMarkers } from "../../frontend/src/map/maplibre-curated-layer-loader.js";
import * as curatedService from "../../frontend/src/shared/curated-layer-service.js";

describe("map-main GIS style reload lifecycle", () => {
  test("wraps every GIS layer-group apply with a synchronous Nova victim filter", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../frontend/src/entries/map-main.js"),
      "utf8",
    );
    expect(source).toMatch(
      /const applyGisLayerGroups = \(groups\) => \{\s*applyLayerGroupsToMap\(map, groups\);\s*applyNarrativePeopleFilter\(map, OTEFDataContext\.getNarrativeState\?\.\(\)\?\.id \?\? null\);\s*applyNarrativeHouseOutlineFilter\(map, OTEFDataContext\.getNarrativeState\?\.\(\)\?\.id \?\? null\);\s*raiseDarkBasemapPlaceLabels\(map\);\s*\};/,
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

  test("the production basemap request path accepts dark after an unloaded satellite request", async () => {
    const { createGisBasemapStyleCoordinator } = await import(
      "../../frontend/src/entries/map-main-style-lifecycle.js"
    );
    const map = createFakeMapLibreMap();
    const setBasemap = vi.fn(() => true);
    const refreshLayers = vi.fn(async () => {});
    const coordinator = createGisBasemapStyleCoordinator({
      map,
      initialBasemap: "dark",
      setBasemap,
      refreshLayers,
      getLayerGroups: () => [],
    });

    expect(coordinator.request("satellite_bw")).toBe(true);
    expect(coordinator.request("dark")).toBe(true);
    expect(setBasemap).toHaveBeenNthCalledWith(1, map, "satellite_bw");
    expect(setBasemap).toHaveBeenNthCalledWith(2, map, "dark");
    map.emit("style.load");
    await Promise.resolve();
    expect(refreshLayers).toHaveBeenCalledWith(expect.objectContaining({ basemap: "dark" }));
    expect(coordinator.getRequestedBasemap()).toBe("dark");
  });

  test("a superseded async style refresh cannot perform stale follow-up ordering", async () => {
    const map = createFakeMapLibreMap();
    let releaseSatellite;
    const mutations = [];
    const refreshLayers = vi.fn(({ basemap, isCurrent }) => new Promise((resolve) => {
      if (basemap === "satellite_bw") {
        releaseSatellite = () => {
          if (isCurrent()) mutations.push("satellite-mutation");
          resolve();
        };
        return;
      }
      if (isCurrent()) mutations.push("dark-mutation");
      resolve();
    }));
    const personVisual = { bringToFront: vi.fn(() => mutations.push("person")) };
    const narrativeController = { onStyleLoad: vi.fn(() => mutations.push("narrative")) };
    const { createGisBasemapStyleCoordinator } = await import(
      "../../frontend/src/entries/map-main-style-lifecycle.js"
    );
    const coordinator = createGisBasemapStyleCoordinator({
      map,
      initialBasemap: "dark",
      setBasemap: () => true,
      refreshLayers,
      personVisual,
      narrativeController,
    });

    coordinator.request("satellite_bw");
    map.emit("style.load");
    await Promise.resolve();
    coordinator.request("dark");
    releaseSatellite();
    await Promise.resolve();
    expect(mutations).not.toContain("satellite-mutation");
    expect(personVisual.bringToFront).not.toHaveBeenCalled();
    expect(narrativeController.onStyleLoad).not.toHaveBeenCalled();
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
    expect(source).toMatch(/curatedDisplay\.invalidateStyle\(\)/);
    expect(source).toMatch(/curatedDisplay\.dispose\(\)/);
    const applyAt = loader.indexOf("applyLayerGroups(", refreshStart);
    const awaitAt = loader.indexOf("await ", refreshStart);
    expect(applyAt).toBeGreaterThan(refreshStart);
    expect(applyAt).toBeLessThan(awaitAt);
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
