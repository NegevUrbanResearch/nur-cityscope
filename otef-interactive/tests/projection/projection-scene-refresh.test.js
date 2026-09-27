import { afterEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { createCuratedDisplayGate, createProjectionCuratedRefresh, loadCuratedLayerToMapLibre, removeCuratedHtmlMarkers } from "../../frontend/src/map/maplibre-curated-layer-loader.js";
import * as curatedService from "../../frontend/src/shared/curated-layer-service.js";

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
  test("guards the live layerGroups path without queueing registry application or moving the camera", () => {
    const source = readProjectionEntry();
    const subscriber = source.slice(
      source.indexOf('OTEFDataContext.subscribe("layerGroups"'),
      source.indexOf('OTEFDataContext.subscribe("viewport"'),
    );
    expect(subscriber).toMatch(/applyProjectionRefresh\(\{/);
    expect(subscriber).toMatch(/isCurrent:\s*projectionDisplay\.begin\(/);
    expect(subscriber).not.toMatch(/refreshProjectionCuratedLayers/);
    const loader = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../frontend/src/map/maplibre-curated-layer-loader.js"),
      "utf8",
    );
    const refreshStart = loader.indexOf("const runProjectionCuratedRefresh = async");
    const refresh = loader.slice(refreshStart, loader.indexOf("const applyProjectionRefresh", refreshStart));
    expect(refresh.indexOf("syncProjectionLayersWithNarrative")).toBeGreaterThan(-1);
    expect(refresh.indexOf("syncProjectionLayersWithNarrative")).toBeLessThan(refresh.indexOf("await"));
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
    });
    expect(removed).toHaveLength(0);
    expect(map.getLayer("curated.scene__old")).toBeTruthy();

    const homeCurrent = gate.begin(["curated.home"]);
    await applyProjectionRefresh({
      groupsOverride: [curatedGroup("curated.home", true), curatedGroup("curated.scene", false)],
      isCurrent: homeCurrent,
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
