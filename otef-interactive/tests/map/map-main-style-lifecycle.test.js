import { describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { installGisStyleReload } from "../../frontend/src/entries/map-main-style-lifecycle.js";

describe("map-main GIS style reload lifecycle", () => {
  test("wraps every GIS layer-group apply with a synchronous Nova victim filter", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../frontend/src/entries/map-main.js"),
      "utf8",
    );
    expect(source).toMatch(
      /const applyGisLayerGroups = \(groups\) => \{\s*applyLayerGroupsToMap\(map, groups\);\s*applyNovaMarkerFilter\(map, OTEFDataContext\.getNarrativeState\?\.\(\)\?\.id \?\? null\);\s*\};/,
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
    const curatedRefresh = entry.slice(
      entry.indexOf("const refreshCuratedLayers"),
      entry.indexOf("// Initial curated load"),
    );
    expect(curatedRefresh).toMatch(/syncPinkLineAxisCompanionForMapLibre[\s\S]*isCurrent\(\)[\s\S]*narrativeController\.onStyleLoad/);
  });
});
