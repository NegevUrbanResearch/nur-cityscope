import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GIS_BASEMAP_FADE_MS } from "../../frontend/src/shared/gis-basemap.js";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";

describe("maplibre basemap switching", () => {
  beforeEach(() => {
    vi.resetModules();
    globalThis.maplibregl = {
      addProtocol: vi.fn(),
      Map: vi.fn(),
      getRTLTextPluginStatus: vi.fn(() => "unavailable"),
      setRTLTextPlugin: vi.fn(),
    };
    globalThis.pmtiles = {
      Protocol: vi.fn(function Protocol() {
        this.tile = vi.fn();
      }),
    };
  });

  it("validates basemap ids and delegates without setStyle or timeline reload preparation", async () => {
    vi.useFakeTimers();
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../frontend/src/map/maplibre-map.js"),
      "utf8",
    );
    const { BASEMAP_STYLES, setGISBasemap } = await import(
      "../../frontend/src/map/maplibre-map.js"
    );
    const settled = vi.fn();
    const map = createFakeMapLibreMap({
      layers: [
        { id: "background", type: "background" },
        { id: "place_city", type: "symbol", source: "openmaptiles", "source-layer": "place" },
      ],
      sources: {
        openmaptiles: BASEMAP_STYLES.dark.sources.openmaptiles,
      },
    });

    try {
      expect(setGISBasemap(map, "not-real", { onSettled: settled })).toBe(false);
      expect(setGISBasemap(null, "satellite", { onSettled: settled })).toBe(false);
      expect(settled).not.toHaveBeenCalled();
      expect(map.calls.some((call) => call.method === "setStyle")).toBe(false);
      expect(source).not.toMatch(/prepareInvestigationTimelineForStyleReload/);
      expect(source).not.toMatch(/setStyle\(/);

      expect(setGISBasemap(map, "satellite", { onSettled: settled })).toBe(true);
      expect(map.getSource("esri").tiles).toEqual(BASEMAP_STYLES.satellite.sources.esri.tiles);
      expect(map.getLayer("esri-tiles")).toBeTruthy();
      expect(map.calls.some((call) => call.method === "setStyle")).toBe(false);
      expect(map.listenerCount("style.load")).toBe(0);
    } finally {
      map.remove();
      vi.useRealTimers();
    }
  });

  it("renders the B&W satellite variant from the shared Esri tiles", async () => {
    const { BASEMAP_STYLES } = await import(
      "../../frontend/src/map/maplibre-map.js"
    );

    expect(BASEMAP_STYLES.satellite_bw.layers[0].paint).toEqual({
      "raster-saturation": -1,
    });
    expect(BASEMAP_STYLES.satellite_bw.sources.esri.tiles).toEqual(
      BASEMAP_STYLES.satellite.sources.esri.tiles,
    );
  });

  it("loads the local dark style as a JS module so nginx GIS can import it", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../frontend/src/map/maplibre-map.js"),
      "utf8",
    );
    expect(source).not.toMatch(/openfreemap-dark\.json/);
    expect(source).toMatch(/from "\.\/basemaps\/openfreemap-dark\.js"/);
  });

  it("uses a local OpenFreeMap dark style with Hebrew-first white place and road names", async () => {
    const { BASEMAP_STYLES } = await import(
      "../../frontend/src/map/maplibre-map.js"
    );
    const {
      DARK_BASEMAP_PLACE_TEXT_FONT,
      DARK_BASEMAP_TEXT_COLOR,
      DARK_BASEMAP_TEXT_FIELD,
    } = await import("../../frontend/src/map/dark-basemap-labels.js");

    expect(typeof BASEMAP_STYLES.dark).toBe("object");
    expect(BASEMAP_STYLES.dark.sources.openmaptiles.url).toBe(
      "https://tiles.openfreemap.org/planet",
    );
    expect(JSON.stringify(BASEMAP_STYLES.dark)).not.toMatch(/carto/i);

    const placeAndRoadNameLayers = BASEMAP_STYLES.dark.layers.filter((layer) => {
      if (layer.type !== "symbol") return false;
      if (layer["source-layer"] === "place") return true;
      return (
        layer["source-layer"] === "transportation_name" &&
        !JSON.stringify(layer.layout?.["text-field"] ?? "").includes('"ref"')
      );
    });
    expect(placeAndRoadNameLayers.length).toBeGreaterThan(0);
    for (const layer of placeAndRoadNameLayers) {
      expect(layer.layout["text-field"]).toEqual(DARK_BASEMAP_TEXT_FIELD);
      expect(layer.paint["text-color"]).toBe(DARK_BASEMAP_TEXT_COLOR);
      expect(layer.layout["text-transform"]).toBeUndefined();
      if (layer["source-layer"] === "place") {
        expect(layer.layout["text-font"]).toEqual(DARK_BASEMAP_PLACE_TEXT_FONT);
        const size = layer.layout["text-size"];
        const usesZoom = JSON.stringify(size).includes('"zoom"');
        if (usesZoom) {
          expect(["interpolate", "step"]).toContain(size[0]);
        } else {
          expect(size[0]).toBe("case");
        }
        expect(layer.paint["text-opacity"][0]).toBe("case");
      } else {
        expect(layer.layout["text-font"]).toEqual(["Arial"]);
      }
    }
    expect(BASEMAP_STYLES.dark.glyphs).toBeUndefined();
    expect(JSON.stringify(BASEMAP_STYLES.dark)).not.toContain("wood-pattern");
    const woodland = BASEMAP_STYLES.dark.layers.find((layer) => layer.id === "landcover_wood");
    expect(woodland.paint["fill-pattern"]).toBeUndefined();
    expect(woodland.paint["fill-color"]).toBeTruthy();
    expect(BASEMAP_STYLES.dark["font-faces"]["Guttman Hatzvi"][0].url).toBe(
      "./fonts/Guttman-Hatzvi.ttf",
    );

    const motorway = BASEMAP_STYLES.dark.layers.find(
      (layer) => layer.id === "highway_name_motorway",
    );
    expect(motorway.layout["text-field"]).toEqual(["to-string", ["get", "ref"]]);
  });

  it("installs the RTL text plugin lazily when the GIS status is unavailable", async () => {
    await import("../../frontend/src/map/maplibre-map.js");

    expect(globalThis.maplibregl.setRTLTextPlugin).toHaveBeenCalledTimes(1);
    expect(globalThis.maplibregl.setRTLTextPlugin).toHaveBeenCalledWith(
      "https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.js",
      null,
      true,
    );
  });

  it.each(["loaded", "loading"])(
    "does not reinstall the RTL text plugin when the GIS status is %s",
    async (status) => {
      globalThis.maplibregl.getRTLTextPluginStatus.mockReturnValue(status);

      await import("../../frontend/src/map/maplibre-map.js");

      expect(globalThis.maplibregl.setRTLTextPlugin).not.toHaveBeenCalled();
    },
  );

  it("copies the dark sprite onto raster styles without treating font-faces as readiness", async () => {
    const { BASEMAP_STYLES } = await import("../../frontend/src/map/maplibre-map.js");

    expect(BASEMAP_STYLES.dark.sprite).toBe(
      "https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
    );
    for (const id of ["osm", "satellite", "satellite_bw"]) {
      expect(BASEMAP_STYLES[id].sprite).toBe(BASEMAP_STYLES.dark.sprite);
      expect(BASEMAP_STYLES[id]["font-faces"]).toBeUndefined();
    }
  });
});

const DARK_SPRITE = "https://tiles.openfreemap.org/sprites/ofm_f384/ofm";
const liveBasemapMaps = [];

function investigationOverlayLayers() {
  return [
    { id: "investigation-fill", type: "fill", paint: { "fill-opacity": 1 } },
    { id: "nli__people_names__labels", type: "symbol" },
    { id: "otef-person-selection-halo", type: "circle" },
  ];
}

function layerIds(map) {
  return map.getStyle().layers.map((layer) => layer.id);
}

function expectDarkLabelsAboveInvestigation(map) {
  const ids = layerIds(map);
  const fill = ids.indexOf("investigation-fill");
  const place = ids.indexOf("place_city");
  const people = ids.indexOf("nli__people_names__labels");
  const selection = ids.indexOf("otef-person-selection-halo");
  expect(map.getLayer("investigation-fill")?.paint?.["fill-opacity"]).toBe(1);
  expect(place).toBeGreaterThan(fill);
  expect(people).toBeGreaterThan(place);
  expect(selection).toBeGreaterThan(people);
  expect(map.calls.some((call) => call.method === "setStyle")).toBe(false);
  expect(map.listenerCount("style.load")).toBe(0);
}

async function finishReveal(map) {
  map.setSourceLoaded("openmaptiles", true);
  map.emit("sourcedata", {
    sourceId: "openmaptiles",
    dataType: "source",
    sourceDataType: "content",
    tile: { state: "loaded" },
  });
  map.emit("render");
  await vi.advanceTimersByTimeAsync(GIS_BASEMAP_FADE_MS);
  map.emit("render");
}

describe("setGISBasemap sprite and dark label restoration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    globalThis.maplibregl = {
      addProtocol: vi.fn(),
      Map: vi.fn(),
      getRTLTextPluginStatus: vi.fn(() => "unavailable"),
      setRTLTextPlugin: vi.fn(),
    };
    globalThis.pmtiles = {
      Protocol: vi.fn(function Protocol() {
        this.tile = vi.fn();
      }),
    };
  });

  afterEach(() => {
    while (liveBasemapMaps.length) liveBasemapMaps.pop().remove();
    vi.useRealTimers();
  });

  it("calls setSprite once when the style has no sprite and does not reload an existing sprite", async () => {
    const { BASEMAP_STYLES, setGISBasemap } = await import(
      "../../frontend/src/map/maplibre-map.js"
    );
    const missing = createFakeMapLibreMap({
      layers: [{ id: "osm-tiles", type: "raster", source: "osm" }],
      sources: { osm: BASEMAP_STYLES.osm.sources.osm },
      paints: { "osm-tiles": { "raster-opacity": 1 } },
    });
    liveBasemapMaps.push(missing);

    expect(setGISBasemap(missing, "dark")).toBe(true);
    expect(missing.calls.filter((call) => call.method === "setSprite")).toEqual([
      { method: "setSprite", url: DARK_SPRITE },
    ]);
    expect(missing.calls.some((call) => call.method === "setStyle")).toBe(false);

    const present = createFakeMapLibreMap({
      layers: [{ id: "osm-tiles", type: "raster", source: "osm" }],
      sources: { osm: BASEMAP_STYLES.osm.sources.osm },
      paints: { "osm-tiles": { "raster-opacity": 1 } },
      sprite: DARK_SPRITE,
    });
    liveBasemapMaps.push(present);
    expect(setGISBasemap(present, "dark")).toBe(true);
    expect(present.calls.filter((call) => call.method === "setSprite")).toEqual([]);
    expect(present.calls.some((call) => call.method === "setStyle")).toBe(false);
  });

  it("restores dark labels after a completed reveal without a layer remount", async () => {
    const { BASEMAP_STYLES, setGISBasemap } = await import(
      "../../frontend/src/map/maplibre-map.js"
    );
    const map = createFakeMapLibreMap({
      layers: [
        { id: "osm-tiles", type: "raster", source: "osm" },
        ...investigationOverlayLayers(),
      ],
      sources: { osm: BASEMAP_STYLES.osm.sources.osm },
      paints: { "osm-tiles": { "raster-opacity": 1 } },
      sprite: DARK_SPRITE,
    });
    liveBasemapMaps.push(map);
    const settled = vi.fn();

    expect(setGISBasemap(map, "dark", { onSettled: settled })).toBe(true);
    expect(map.getLayer("investigation-fill")).toBeTruthy();
    expect(map.calls.some((call) => call.method === "setStyle")).toBe(false);
    await finishReveal(map);

    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith({ status: "completed", basemapId: "dark" });
    expectDarkLabelsAboveInvestigation(map);
  });

  it("restores dark labels after a failed cover without a layer remount", async () => {
    const { BASEMAP_STYLES, setGISBasemap } = await import(
      "../../frontend/src/map/maplibre-map.js"
    );
    const map = createFakeMapLibreMap({
      layers: [
        { id: "background", type: "background" },
        { id: "place_city", type: "symbol", source: "openmaptiles", "source-layer": "place" },
        ...investigationOverlayLayers(),
      ],
      sources: { openmaptiles: BASEMAP_STYLES.dark.sources.openmaptiles },
      sprite: DARK_SPRITE,
    });
    liveBasemapMaps.push(map);
    const settled = vi.fn();

    expect(setGISBasemap(map, "satellite", { onSettled: settled })).toBe(true);
    expect(map.getLayer("investigation-fill")).toBeTruthy();
    map.emit("error", { sourceId: "esri" });

    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith({ status: "failed", basemapId: "dark" });
    expectDarkLabelsAboveInvestigation(map);
    expect(map.getLayer("esri-tiles")).toBeNull();
  });

  it("restores dark labels when an in-flight cover is cancelled back to dark", async () => {
    const { BASEMAP_STYLES, setGISBasemap } = await import(
      "../../frontend/src/map/maplibre-map.js"
    );
    const map = createFakeMapLibreMap({
      layers: [
        { id: "background", type: "background" },
        { id: "place_city", type: "symbol", source: "openmaptiles", "source-layer": "place" },
        ...investigationOverlayLayers(),
      ],
      sources: { openmaptiles: BASEMAP_STYLES.dark.sources.openmaptiles },
      sprite: DARK_SPRITE,
    });
    liveBasemapMaps.push(map);
    const coverSettled = vi.fn();
    const returnSettled = vi.fn();

    expect(setGISBasemap(map, "satellite", { onSettled: coverSettled })).toBe(true);
    expect(setGISBasemap(map, "dark", { onSettled: returnSettled })).toBe(true);

    expect(coverSettled).not.toHaveBeenCalled();
    expect(returnSettled).toHaveBeenCalledTimes(1);
    expect(returnSettled).toHaveBeenCalledWith({ status: "completed", basemapId: "dark" });
    expectDarkLabelsAboveInvestigation(map);
    expect(map.getLayer("esri-tiles")).toBeNull();
  });

  it("retries a failed basemap directly and ignores a duplicate while that retry is pending", async () => {
    const { BASEMAP_STYLES, setGISBasemap } = await import(
      "../../frontend/src/map/maplibre-map.js"
    );
    const map = createFakeMapLibreMap({
      layers: [
        { id: "background", type: "background" },
        { id: "place_city", type: "symbol", source: "openmaptiles", "source-layer": "place" },
      ],
      sources: { openmaptiles: BASEMAP_STYLES.dark.sources.openmaptiles },
      sprite: DARK_SPRITE,
    });
    liveBasemapMaps.push(map);
    const first = vi.fn();
    const duplicate = vi.fn();
    const retry = vi.fn();

    expect(setGISBasemap(map, "satellite", { onSettled: first })).toBe(true);
    const callsDuringPending = map.calls.length;
    expect(setGISBasemap(map, "satellite", { onSettled: duplicate })).toBe(true);
    expect(duplicate).not.toHaveBeenCalled();
    expect(map.calls.length).toBe(callsDuringPending);
    map.emit("error", { sourceId: "esri" });
    expect(first).toHaveBeenCalledWith({ status: "failed", basemapId: "dark" });

    expect(setGISBasemap(map, "satellite", { onSettled: retry })).toBe(true);
    expect(retry).not.toHaveBeenCalled();
    expect(map.getLayer("esri-tiles")).toBeTruthy();
    expect(map.calls.some((call) => call.method === "setStyle")).toBe(false);
  });
});

