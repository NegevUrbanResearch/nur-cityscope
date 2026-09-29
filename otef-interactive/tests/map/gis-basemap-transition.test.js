import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  GIS_BASEMAP_FADE_MS,
  GIS_BASEMAP_SOURCE_WAIT_MS,
} from "../../frontend/src/shared/gis-basemap.js";
import { transitionGisBasemap } from "../../frontend/src/map/gis-basemap-transition.js";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";

const OVERLAYS = Object.freeze([
  { id: "investigation-fill", type: "fill", source: "investigation" },
  { id: "people-foreground", type: "symbol", source: "people" },
]);

const OVERLAY_SOURCES = Object.freeze({
  investigation: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
  people: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
});

const STYLES = Object.freeze({
  dark: {
    version: 8,
    sources: {
      ne2_shaded: {
        type: "raster",
        tiles: ["https://tiles.example.test/ne2/{z}/{x}/{y}.png"],
        tileSize: 256,
      },
      openmaptiles: { type: "vector", url: "https://tiles.example.test/planet" },
    },
    sprite: "https://tiles.example.test/sprite",
    glyphs: "https://tiles.example.test/fonts/{fontstack}/{range}.pbf",
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#111111" } },
      { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water" },
      { id: "hillshade", type: "raster", source: "ne2_shaded" },
      {
        id: "place_city",
        type: "symbol",
        source: "openmaptiles",
        "source-layer": "place",
      },
    ],
  },
  osm: {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tiles.example.test/osm/{z}/{x}/{y}.png"],
        tileSize: 256,
      },
    },
    layers: [{ id: "osm-tiles", type: "raster", source: "osm" }],
  },
  satellite: {
    version: 8,
    sources: {
      esri: {
        type: "raster",
        tiles: ["https://tiles.example.test/esri/{z}/{y}/{x}"],
        tileSize: 256,
      },
    },
    layers: [{ id: "esri-tiles", type: "raster", source: "esri" }],
  },
  satellite_bw: {
    version: 8,
    sources: {
      esri: {
        type: "raster",
        tiles: ["https://tiles.example.test/esri/{z}/{y}/{x}"],
        tileSize: 256,
      },
    },
    layers: [
      {
        id: "esri-tiles",
        type: "raster",
        source: "esri",
        paint: { "raster-saturation": -1 },
      },
    ],
  },
});

const DARK_LAYER_IDS = new Set(STYLES.dark.layers.map((layer) => layer.id));
const liveMaps = [];

function layerIds(map) {
  return map.getStyle().layers.map((layer) => layer.id);
}

function physicalGroupCount(map) {
  const layers = map.getStyle().layers;
  let count = 0;
  if (layers.some((layer) => layer.id === "osm-tiles")) count += 1;
  if (layers.some((layer) => layer.id === "esri-tiles")) count += 1;
  if (layers.some((layer) => DARK_LAYER_IDS.has(layer.id))) count += 1;
  return count;
}

function installGroupCeiling(map) {
  const addLayer = map.addLayer.bind(map);
  const removeLayer = map.removeLayer.bind(map);
  map.addLayer = (layer, beforeId) => {
    addLayer(layer, beforeId);
    const count = physicalGroupCount(map);
    if (count > 2) {
      throw new Error(`expected at most 2 basemap groups, saw ${count}: ${layerIds(map).join(" > ")}`);
    }
  };
  map.removeLayer = (id) => {
    removeLayer(id);
    const count = physicalGroupCount(map);
    if (count > 2) {
      throw new Error(`expected at most 2 basemap groups after removing ${id}, saw ${count}: ${layerIds(map).join(" > ")}`);
    }
  };
}

function track(map) {
  installGroupCeiling(map);
  liveMaps.push(map);
  return map;
}

function overlayListenerBaseline(map) {
  return {
    sourcedata: map.listenerCount("sourcedata"),
    error: map.listenerCount("error"),
    render: map.listenerCount("render"),
  };
}

function expectIdleListeners(map, baseline) {
  expect(map.listenerCount("sourcedata")).toBe(baseline.sourcedata);
  expect(map.listenerCount("error")).toBe(baseline.error);
  expect(map.listenerCount("render")).toBe(baseline.render);
}

function expectOverlaysRemain(map) {
  const ids = layerIds(map);
  expect(ids.indexOf("people-foreground")).toBeGreaterThan(ids.indexOf("investigation-fill"));
  expect(map.calls.some((call) => (
    call.method === "removeLayer"
    && (call.id === "investigation-fill" || call.id === "people-foreground")
  ))).toBe(false);
}

function expectRasterPaintOnly(map) {
  for (const call of map.calls) {
    if (call.method !== "setPaintProperty") continue;
    expect(call.id === "osm-tiles" || call.id === "esri-tiles").toBe(true);
    expect([
      "raster-opacity",
      "raster-opacity-transition",
      "raster-saturation",
      "raster-saturation-transition",
    ]).toContain(call.key);
  }
  expect(map.calls.some((call) => call.method === "setStyle")).toBe(false);
}

function repaintCount(map) {
  return map.calls.filter((call) => call.method === "triggerRepaint").length;
}

function emitSuccessfulTile(map, sourceId) {
  map.setSourceLoaded(sourceId, true);
  map.emit("sourcedata", {
    sourceId,
    dataType: "source",
    sourceDataType: "content",
    tile: { state: "loaded" },
  });
}

async function finishRenderedFade(map, settled, basemapId, evictIds = []) {
  await vi.advanceTimersByTimeAsync(GIS_BASEMAP_FADE_MS + GIS_BASEMAP_SOURCE_WAIT_MS);
  expect(settled).not.toHaveBeenCalled();
  for (const id of evictIds) expect(map.getLayer(id)).not.toBeNull();

  map.emit("render");
  await vi.advanceTimersByTimeAsync(GIS_BASEMAP_FADE_MS - 1);
  map.emit("render");
  expect(settled).not.toHaveBeenCalled();
  for (const id of evictIds) expect(map.getLayer(id)).not.toBeNull();

  const repaints = repaintCount(map);
  await vi.advanceTimersByTimeAsync(1);
  expect(repaintCount(map)).toBe(repaints + 1);
  expect(settled).not.toHaveBeenCalled();
  for (const id of evictIds) expect(map.getLayer(id)).not.toBeNull();

  map.emit("render");
  expect(settled).toHaveBeenCalledTimes(1);
  expect(settled).toHaveBeenCalledWith({ status: "completed", basemapId });
  for (const id of evictIds) expect(map.getLayer(id)).toBeNull();
  expectOverlaysRemain(map);
  expectRasterPaintOnly(map);
}

function createDarkMap() {
  return track(createFakeMapLibreMap({
    layers: [
      { id: "background", type: "background" },
      { id: "water", type: "fill", source: "openmaptiles" },
      ...OVERLAYS,
      { id: "place_city", type: "symbol", source: "openmaptiles", "source-layer": "place" },
    ],
    sources: {
      openmaptiles: { type: "vector", url: "https://tiles.example.test/planet" },
      ...OVERLAY_SOURCES,
    },
  }));
}

function createOsmMap() {
  return track(createFakeMapLibreMap({
    layers: [
      { id: "osm-tiles", type: "raster", source: "osm" },
      ...OVERLAYS,
    ],
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tiles.example.test/osm/{z}/{x}/{y}.png"],
        tileSize: 256,
      },
      ...OVERLAY_SOURCES,
    },
    paints: { "osm-tiles": { "raster-opacity": 1 } },
  }));
}

function createEsriMap(saturation) {
  return track(createFakeMapLibreMap({
    layers: [
      { id: "esri-tiles", type: "raster", source: "esri" },
      ...OVERLAYS,
    ],
    sources: {
      esri: {
        type: "raster",
        tiles: ["https://tiles.example.test/esri/{z}/{y}/{x}"],
        tileSize: 256,
      },
      ...OVERLAY_SOURCES,
    },
    paints: {
      "esri-tiles": { "raster-opacity": 1, "raster-saturation": saturation },
    },
  }));
}

function request(map, basemapId, onSettled) {
  return transitionGisBasemap(map, basemapId, { styles: STYLES, onSettled });
}

describe("transitionGisBasemap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    while (liveMaps.length) liveMaps.pop().remove();
    vi.useRealTimers();
  });

  test("publishes the fade and source-wait budgets", () => {
    expect(GIS_BASEMAP_FADE_MS).toBe(600);
    expect(GIS_BASEMAP_SOURCE_WAIT_MS).toBe(2000);
  });

  test("rejects an unusable map or unknown id without settling or normalizing to osm", () => {
    const settled = vi.fn();
    const map = createDarkMap();
    const before = layerIds(map);

    expect(transitionGisBasemap(null, "osm", { styles: STYLES, onSettled: settled })).toBe(false);
    expect(transitionGisBasemap({}, "dark", { styles: STYLES, onSettled: settled })).toBe(false);
    expect(request(map, "terrain", settled)).toBe(false);
    expect(transitionGisBasemap(map, "satellite", { onSettled: settled })).toBe(false);

    expect(settled).not.toHaveBeenCalled();
    expect(layerIds(map)).toEqual(before);
    expect(map.getLayer("osm-tiles")).toBeNull();
    expect(map.calls.some((call) => call.method === "setStyle")).toBe(false);
  });

  test("settles the same completed id without changing layers", () => {
    const map = createDarkMap();
    const settled = vi.fn();
    const before = layerIds(map);
    const calls = map.calls.length;

    expect(request(map, "dark", settled)).toBe(true);

    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith({ status: "completed", basemapId: "dark" });
    expect(layerIds(map)).toEqual(before);
    expect(map.calls.slice(calls).filter((call) => call.method !== "remove")).toEqual([]);
  });

  test("accepts a duplicate pending id without restarting the wait or settling twice", async () => {
    const map = createDarkMap();
    const first = vi.fn();
    const second = vi.fn();
    const baseline = overlayListenerBaseline(map);

    expect(request(map, "osm", first)).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    const calls = map.calls.length;
    const listeners = map.listenerCount("sourcedata");

    expect(request(map, "osm", second)).toBe(true);

    expect(second).not.toHaveBeenCalled();
    expect(map.calls.length).toBe(calls);
    expect(map.listenerCount("sourcedata")).toBe(listeners);
    expect(map.getPaintProperty("osm-tiles", "raster-opacity")).toBe(0);

    await vi.advanceTimersByTimeAsync(500);
    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith({ status: "failed", basemapId: "dark" });
    expect(second).not.toHaveBeenCalled();
    expect(map.getLayer("osm-tiles")).toBeNull();
    expectIdleListeners(map, baseline);
  });

  test("fades satellite to black and white on the shared layer and publishes only after rendered completion", async () => {
    const map = createEsriMap(0);
    const settled = vi.fn();
    const baseline = overlayListenerBaseline(map);

    const callsBefore = map.calls.length;
    expect(request(map, "satellite_bw", settled)).toBe(true);

    expect(map.calls.slice(callsBefore).filter((call) => call.method === "addSource" || call.method === "addLayer")).toEqual([]);
    expect(map.getSource("esri")).not.toBeNull();
    expect(map.getLayer("esri-tiles")).not.toBeNull();
    const transitionAt = map.calls.findIndex((call) => (
      call.method === "setPaintProperty"
      && call.id === "esri-tiles"
      && call.key === "raster-saturation-transition"
    ));
    const valueAt = map.calls.findIndex((call) => (
      call.method === "setPaintProperty"
      && call.id === "esri-tiles"
      && call.key === "raster-saturation"
    ));
    expect(map.calls[transitionAt].value).toEqual({ duration: GIS_BASEMAP_FADE_MS, delay: 0 });
    expect(map.calls[valueAt].value).toBe(-1);
    expect(transitionAt).toBeLessThan(valueAt);
    expect(map.calls.some((call) => call.key === "raster-opacity" || call.key === "raster-opacity-transition")).toBe(false);

    await finishRenderedFade(map, settled, "satellite_bw");
    expect(map.getPaintProperty("esri-tiles", "raster-saturation")).toBe(-1);
    expect(map.getLayer("esri-tiles")).not.toBeNull();
    expect(map.getSource("esri")).not.toBeNull();
    expectIdleListeners(map, baseline);
  });

  test("fades black and white back to color on the same layer after rendered completion", async () => {
    const map = createEsriMap(-1);
    const settled = vi.fn();

    expect(request(map, "satellite", settled)).toBe(true);

    expect(map.calls.filter((call) => call.method === "addLayer" || call.method === "removeLayer")).toEqual([]);
    const valueAt = map.calls.findIndex((call) => call.key === "raster-saturation" && call.value === 0);
    const transitionAt = map.calls.findIndex((call) => call.key === "raster-saturation-transition");
    expect(transitionAt).toBeGreaterThan(-1);
    expect(transitionAt).toBeLessThan(valueAt);
    expect(map.calls[transitionAt].value).toEqual({ duration: GIS_BASEMAP_FADE_MS, delay: 0 });

    await finishRenderedFade(map, settled, "satellite");
    expect(map.getPaintProperty("esri-tiles", "raster-saturation")).toBe(0);
    expect(physicalGroupCount(map)).toBe(1);
  });

  test("covers dark with black and white below overlays and above compacted place labels", async () => {
    const map = createDarkMap();
    const settled = vi.fn();

    expect(request(map, "satellite_bw", settled)).toBe(true);

    expect(layerIds(map)).toEqual([
      "background",
      "water",
      "place_city",
      "esri-tiles",
      "investigation-fill",
      "people-foreground",
    ]);
    expect(map.getPaintProperty("esri-tiles", "raster-opacity")).toBe(0);
    expect(map.getPaintProperty("esri-tiles", "raster-opacity-transition")).toEqual({ duration: 0, delay: 0 });
    expect(map.getPaintProperty("esri-tiles", "raster-saturation")).toBe(-1);
    expect(map.getSource("ne2_shaded")).toBeNull();
    expect(map.getLayer("hillshade")).toBeNull();
    const addAt = map.calls.findIndex((call) => call.method === "addLayer" && call.id === "esri-tiles");
    expect(map.calls[addAt].beforeId).toBe("investigation-fill");
    expect(map.calls.slice(addAt + 1).some((call) => call.method === "setPaintProperty")).toBe(false);

    emitSuccessfulTile(map, "esri");
    expect(map.getPaintProperty("esri-tiles", "raster-opacity")).toBe(1);
    expect(map.getLayer("background")).not.toBeNull();

    await finishRenderedFade(map, settled, "satellite_bw", ["background", "water", "place_city"]);
    expect(map.getSource("openmaptiles")).toBeNull();
    expect(map.getSource("esri")).not.toBeNull();
    expect(layerIds(map)).toEqual(["esri-tiles", "investigation-fill", "people-foreground"]);
  });

  test("covers dark with osm only after the incoming source is ready", async () => {
    const map = createDarkMap();
    const settled = vi.fn();
    const baseline = overlayListenerBaseline(map);

    expect(request(map, "osm", settled)).toBe(true);
    expect(map.getPaintProperty("osm-tiles", "raster-opacity")).toBe(0);
    expect(layerIds(map).indexOf("osm-tiles")).toBeLessThan(layerIds(map).indexOf("investigation-fill"));
    expect(layerIds(map).indexOf("place_city")).toBeLessThan(layerIds(map).indexOf("osm-tiles"));

    emitSuccessfulTile(map, "osm");
    expect(map.getPaintProperty("osm-tiles", "raster-opacity")).toBe(1);
    const fadeAt = map.calls.findIndex((call) => call.key === "raster-opacity-transition" && call.value?.duration === GIS_BASEMAP_FADE_MS);
    const opacityAt = map.calls.findIndex((call) => call.key === "raster-opacity" && call.value === 1);
    expect(fadeAt).toBeLessThan(opacityAt);

    await finishRenderedFade(map, settled, "osm", ["background", "water", "place_city"]);
    expect(map.getSource("openmaptiles")).toBeNull();
    expect(map.getSource("osm")).not.toBeNull();
    expectIdleListeners(map, baseline);
  });

  test("covers osm with satellite above the outgoing raster and below overlays", async () => {
    const map = createOsmMap();
    const settled = vi.fn();

    expect(request(map, "satellite", settled)).toBe(true);
    expect(layerIds(map)).toEqual([
      "osm-tiles",
      "esri-tiles",
      "investigation-fill",
      "people-foreground",
    ]);
    expect(map.getPaintProperty("esri-tiles", "raster-opacity")).toBe(0);
    expect(map.calls.find((call) => call.method === "addLayer" && call.id === "esri-tiles").beforeId).toBe("investigation-fill");

    emitSuccessfulTile(map, "esri");
    expect(map.getLayer("osm-tiles")).not.toBeNull();
    await finishRenderedFade(map, settled, "satellite", ["osm-tiles"]);
    expect(map.getSource("osm")).toBeNull();
    expect(map.getSource("esri")).not.toBeNull();
    expect(map.getPaintProperty("esri-tiles", "raster-opacity")).toBe(1);
  });

  test("reveals dark under a fixed raster beforeId in forward style order and fades the raster out", async () => {
    const map = createEsriMap(-1);
    const settled = vi.fn();
    const baseline = overlayListenerBaseline(map);

    const callsBefore = map.calls.length;
    expect(request(map, "dark", settled)).toBe(true);

    const added = map.calls.slice(callsBefore).filter((call) => call.method === "addLayer");
    expect(added.map((call) => [call.id, call.beforeId])).toEqual([
      ["background", "esri-tiles"],
      ["water", "esri-tiles"],
      ["place_city", "esri-tiles"],
    ]);
    expect(map.calls.slice(callsBefore).filter((call) => call.method === "addSource").map((call) => call.id)).toEqual(["openmaptiles"]);
    expect(map.getSource("ne2_shaded")).toBeNull();
    expect(map.getLayer("hillshade")).toBeNull();
    expect(layerIds(map)).toEqual([
      "background",
      "water",
      "place_city",
      "esri-tiles",
      "investigation-fill",
      "people-foreground",
    ]);
    expect(map.getPaintProperty("esri-tiles", "raster-opacity")).toBe(1);

    emitSuccessfulTile(map, "openmaptiles");
    expect(map.getPaintProperty("esri-tiles", "raster-opacity")).toBe(0);
    const fadeAt = map.calls.findIndex((call) => (
      call.id === "esri-tiles"
      && call.key === "raster-opacity-transition"
      && call.value?.duration === GIS_BASEMAP_FADE_MS
    ));
    const opacityAt = map.calls.findIndex((call) => call.id === "esri-tiles" && call.key === "raster-opacity" && call.value === 0);
    expect(fadeAt).toBeLessThan(opacityAt);

    await finishRenderedFade(map, settled, "dark", ["esri-tiles"]);
    expect(map.getSource("esri")).toBeNull();
    expect(map.getSource("openmaptiles")).not.toBeNull();
    expect(layerIds(map)).toEqual([
      "background",
      "water",
      "place_city",
      "investigation-fill",
      "people-foreground",
    ]);
    expectIdleListeners(map, baseline);
  });

  test("requires a successful tile for a new source and ignores metadata, visibility, and unrelated events", async () => {
    const map = createDarkMap();
    const settled = vi.fn();

    expect(request(map, "osm", settled)).toBe(true);
    map.setSourceLoaded("osm", true);
    map.emit("sourcedata", { sourceId: "osm", sourceDataType: "metadata", isSourceLoaded: true });
    map.emit("sourcedata", {
      sourceId: "osm",
      sourceDataType: "visibility",
      tile: { state: "loaded" },
    });
    map.emit("sourcedata", {
      sourceId: "investigation",
      sourceDataType: "content",
      tile: { state: "loaded" },
    });
    map.emit("error", { sourceId: "investigation", error: new Error("unrelated") });
    map.emit("error", { error: new Error("map") });

    await vi.advanceTimersByTimeAsync(400);
    expect(map.getPaintProperty("osm-tiles", "raster-opacity")).toBe(0);
    expect(settled).not.toHaveBeenCalled();

    map.emit("sourcedata", {
      sourceId: "osm",
      sourceDataType: "content",
      tile: { state: "loaded" },
    });
    expect(map.getPaintProperty("osm-tiles", "raster-opacity")).toBe(1);
    expect(settled).not.toHaveBeenCalled();
  });

  test("accepts a MapLibre tile event that omits sourceDataType", () => {
    const map = createDarkMap();
    const settled = vi.fn();

    expect(request(map, "osm", settled)).toBe(true);
    map.setSourceLoaded("osm", false);
    map.emit("sourcedata", {
      sourceId: "osm",
      dataType: "source",
      tile: { state: "loaded" },
    });
    expect(map.getPaintProperty("osm-tiles", "raster-opacity")).toBe(0);

    map.setSourceLoaded("osm", true);
    map.emit("sourcedata", {
      sourceId: "osm",
      dataType: "source",
      sourceDataType: "idle",
    });
    expect(map.getPaintProperty("osm-tiles", "raster-opacity")).toBe(1);
    expect(settled).not.toHaveBeenCalled();
  });

  test("starts the fade on a loaded MapLibre tile event without sourceDataType", () => {
    const map = createDarkMap();
    expect(request(map, "satellite", vi.fn())).toBe(true);
    map.setSourceLoaded("esri", true);
    map.emit("sourcedata", {
      sourceId: "esri",
      dataType: "source",
      tile: { state: "loaded" },
    });
    expect(map.getPaintProperty("esri-tiles", "raster-opacity")).toBe(1);
  });

  test("does not treat idle alone as tile evidence", async () => {
    const map = createDarkMap();
    const settled = vi.fn();
    expect(request(map, "osm", settled)).toBe(true);
    map.setSourceLoaded("osm", true);
    map.emit("sourcedata", {
      sourceId: "osm",
      dataType: "source",
      sourceDataType: "idle",
    });
    await vi.advanceTimersByTimeAsync(GIS_BASEMAP_SOURCE_WAIT_MS);
    expect(settled).toHaveBeenCalledWith({ status: "failed", basemapId: "dark" });
    expect(map.getLayer("osm-tiles")).toBeNull();
  });

  test("registers readiness listeners before adding the candidate source", () => {
    const map = createEsriMap(0);
    const original = map.addSource.bind(map);
    let listenersDuringAdd = null;
    map.addSource = (id, spec) => {
      if (id === "openmaptiles") {
        listenersDuringAdd = {
          sourcedata: map.listenerCount("sourcedata"),
          error: map.listenerCount("error"),
        };
        original(id, spec);
        emitSuccessfulTile(map, id);
        return;
      }
      original(id, spec);
    };

    expect(request(map, "dark", vi.fn())).toBe(true);

    expect(listenersDuringAdd).toEqual({ sourcedata: 1, error: 1 });
    expect(map.getPaintProperty("esri-tiles", "raster-opacity")).toBe(0);
  });

  test("fails immediately when the incoming source errors even if it reports loaded", () => {
    const map = createDarkMap();
    const settled = vi.fn();
    const baseline = overlayListenerBaseline(map);

    expect(request(map, "satellite", settled)).toBe(true);
    map.setSourceLoaded("esri", true);
    map.emit("error", { sourceId: "esri", error: new Error("tile failure") });

    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith({ status: "failed", basemapId: "dark" });
    expect(map.getLayer("esri-tiles")).toBeNull();
    expect(map.getSource("esri")).toBeNull();
    expect(map.getLayer("background")).not.toBeNull();
    expect(map.getLayer("place_city")).not.toBeNull();
    expectIdleListeners(map, baseline);
  });

  test("fails all-404 tile responses that never produce successful tile evidence", () => {
    const map = createDarkMap();
    const settled = vi.fn();

    expect(request(map, "satellite", settled)).toBe(true);
    map.setSourceLoaded("esri", true);
    map.emit("sourcedata", {
      sourceId: "esri",
      sourceDataType: "content",
      tile: { state: "errored" },
      error: { status: 404 },
    });
    map.emit("sourcedata", {
      sourceId: "esri",
      sourceDataType: "content",
      tile: { state: "errored" },
      error: { status: 404 },
    });

    expect(settled).toHaveBeenCalledWith({ status: "failed", basemapId: "dark" });
    expect(map.getLayer("esri-tiles")).toBeNull();
    expect(map.getPaintProperty("esri-tiles", "raster-opacity")).not.toBe(1);
    expect(layerIds(map)).toContain("background");
    expectOverlaysRemain(map);
  });

  test("fails a new source after the 2000ms budget without fading anyway", async () => {
    const map = createDarkMap();
    const settled = vi.fn();
    const baseline = overlayListenerBaseline(map);

    expect(request(map, "osm", settled)).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(settled).not.toHaveBeenCalled();
    expect(map.getPaintProperty("osm-tiles", "raster-opacity")).toBe(0);
    expect(map.getLayer("background")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(GIS_BASEMAP_SOURCE_WAIT_MS - 400 - 1);
    expect(settled).not.toHaveBeenCalled();
    expect(map.getLayer("osm-tiles")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith({ status: "failed", basemapId: "dark" });
    expect(map.getLayer("osm-tiles")).toBeNull();
    expect(map.getSource("osm")).toBeNull();
    expect(map.getSource("openmaptiles")).not.toBeNull();
    expectIdleListeners(map, baseline);

    const retry = vi.fn();
    expect(request(map, "dark", retry)).toBe(true);
    expect(retry).toHaveBeenCalledWith({ status: "completed", basemapId: "dark" });
  });

  test("the 2000ms readiness deadline is absolute and does not pause for camera motion", async () => {
    const map = createDarkMap();
    const settled = vi.fn();

    map.setCameraMoving(true);
    expect(request(map, "osm", settled)).toBe(true);
    await vi.advanceTimersByTimeAsync(GIS_BASEMAP_SOURCE_WAIT_MS - 1);
    expect(settled).not.toHaveBeenCalled();
    expect(map.getLayer("osm-tiles")).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toHaveBeenCalledWith({ status: "failed", basemapId: "dark" });
    expect(map.getLayer("osm-tiles")).toBeNull();
    expect(map.listenerCount("move")).toBe(0);
    expect(map.listenerCount("moveend")).toBe(0);
  });

  test("starts the fade during camera motion once tile evidence and a loaded source coincide", () => {
    const map = createDarkMap();
    const settled = vi.fn();

    map.setCameraMoving(true);
    expect(request(map, "satellite_bw", settled)).toBe(true);
    emitSuccessfulTile(map, "esri");

    expect(map.getPaintProperty("esri-tiles", "raster-opacity")).toBe(1);
    expect(map.getLayer("background")).not.toBeNull();
    expect(settled).not.toHaveBeenCalled();
  });

  test("a matching source error fails the attempt even while the camera is moving", () => {
    const map = createDarkMap();
    const settled = vi.fn();

    map.setCameraMoving(true);
    expect(request(map, "osm", settled)).toBe(true);
    map.emit("error", { sourceId: "osm", error: new Error("blocked") });

    expect(settled).toHaveBeenCalledWith({ status: "failed", basemapId: "dark" });
    expect(map.getLayer("osm-tiles")).toBeNull();
  });

  test("restores the outgoing raster when the incoming source errors during the fade", () => {
    const map = createEsriMap(0);
    const settled = vi.fn();
    const baseline = overlayListenerBaseline(map);

    expect(request(map, "dark", settled)).toBe(true);
    emitSuccessfulTile(map, "openmaptiles");
    expect(map.getPaintProperty("esri-tiles", "raster-opacity")).toBe(0);
    map.emit("render");
    map.emit("error", { sourceId: "openmaptiles", error: new Error("dropped") });

    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith({ status: "failed", basemapId: "satellite" });
    expect(map.getPaintProperty("esri-tiles", "raster-opacity")).toBe(1);
    expect(map.getPaintProperty("esri-tiles", "raster-opacity-transition")).toEqual({ duration: 0, delay: 0 });
    expect(map.getPaintProperty("esri-tiles", "raster-saturation")).toBe(0);
    expect(map.getLayer("background")).toBeNull();
    expect(map.getSource("openmaptiles")).toBeNull();
    expect(map.getLayer("esri-tiles")).not.toBeNull();
    expectIdleListeners(map, baseline);
  });

  test("does not revert a visible incoming group when the camera requests more tiles at completion", async () => {
    const map = createEsriMap(-1);
    const settled = vi.fn();

    expect(request(map, "dark", settled)).toBe(true);
    emitSuccessfulTile(map, "openmaptiles");
    expect(map.getPaintProperty("esri-tiles", "raster-opacity")).toBe(0);

    map.emit("render");
    await vi.advanceTimersByTimeAsync(GIS_BASEMAP_FADE_MS);
    map.setSourceLoaded("openmaptiles", false);
    map.setCameraMoving(true);
    map.emit("render");

    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith({ status: "completed", basemapId: "dark" });
    expect(map.getLayer("esri-tiles")).toBeNull();
    expect(map.getLayer("background")).not.toBeNull();
    expect(map.getSource("openmaptiles")).not.toBeNull();
  });

  test("restores outgoing ground when incoming tiles are outstanding at the completion frame", async () => {
    const map = createDarkMap();
    const settled = vi.fn();

    expect(request(map, "osm", settled)).toBe(true);
    emitSuccessfulTile(map, "osm");
    map.emit("render");
    await vi.advanceTimersByTimeAsync(GIS_BASEMAP_FADE_MS);
    map.setSourceLoaded("osm", false);
    map.emit("render");

    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith({ status: "completed", basemapId: "osm" });
    expect(map.getLayer("osm-tiles")).not.toBeNull();
    expect(map.getSource("osm")).not.toBeNull();
    expect(map.getLayer("background")).toBeNull();
  });

  test("interrupts a waiting cover, removes the candidate, and starts only from the completed id", () => {
    const map = createDarkMap();
    const first = vi.fn();
    const second = vi.fn();

    expect(request(map, "satellite", first)).toBe(true);
    expect(request(map, "osm", second)).toBe(true);

    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(map.getLayer("esri-tiles")).toBeNull();
    expect(map.getSource("esri")).toBeNull();
    expect(map.getPaintProperty("osm-tiles", "raster-opacity")).toBe(0);
    expect(map.getLayer("background")).not.toBeNull();
    expect(physicalGroupCount(map)).toBe(2);
    expect(map.listenerCount("sourcedata")).toBe(1);
  });

  test("cancels a cover back to dark immediately and restores label-bearing dark ground", () => {
    const map = createDarkMap();
    const cover = vi.fn();
    const back = vi.fn();
    const baseline = overlayListenerBaseline(map);

    expect(request(map, "satellite", cover)).toBe(true);
    emitSuccessfulTile(map, "esri");
    expect(map.getPaintProperty("esri-tiles", "raster-opacity")).toBe(1);

    expect(request(map, "dark", back)).toBe(true);

    expect(cover).not.toHaveBeenCalled();
    expect(back).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledWith({ status: "completed", basemapId: "dark" });
    expect(map.getLayer("esri-tiles")).toBeNull();
    expect(map.getSource("esri")).toBeNull();
    expect(layerIds(map)).toEqual([
      "background",
      "water",
      "place_city",
      "investigation-fill",
      "people-foreground",
    ]);
    expect(physicalGroupCount(map)).toBe(1);
    expectIdleListeners(map, baseline);
  });

  test("restores retained raster opacity before a third id replaces an in-flight reveal", () => {
    const map = createEsriMap(-1);
    const reveal = vi.fn();
    const next = vi.fn();

    expect(request(map, "dark", reveal)).toBe(true);
    emitSuccessfulTile(map, "openmaptiles");
    expect(map.getPaintProperty("esri-tiles", "raster-opacity")).toBe(0);

    const originalAdd = map.addLayer.bind(map);
    map.addLayer = (layer, beforeId) => {
      if (layer.id === "osm-tiles") {
        expect(map.getPaintProperty("esri-tiles", "raster-opacity")).toBe(1);
        expect(map.getPaintProperty("esri-tiles", "raster-opacity-transition")).toEqual({ duration: 0, delay: 0 });
        expect(map.getPaintProperty("esri-tiles", "raster-saturation")).toBe(-1);
      }
      originalAdd(layer, beforeId);
    };

    expect(request(map, "osm", next)).toBe(true);

    expect(reveal).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(map.getLayer("background")).toBeNull();
    expect(map.getSource("openmaptiles")).toBeNull();
    expect(map.getPaintProperty("esri-tiles", "raster-opacity")).toBe(1);
    expect(map.getPaintProperty("esri-tiles", "raster-saturation")).toBe(-1);
    expect(map.getPaintProperty("osm-tiles", "raster-opacity")).toBe(0);
    expect(physicalGroupCount(map)).toBe(2);
  });

  test("returns from an in-flight reveal to the original raster without a reverse fade", () => {
    const map = createOsmMap();
    const reveal = vi.fn();
    const back = vi.fn();
    const baseline = overlayListenerBaseline(map);

    expect(request(map, "dark", reveal)).toBe(true);
    emitSuccessfulTile(map, "openmaptiles");
    const calls = map.calls.length;
    back.mockImplementation(() => {
      expect(map.getPaintProperty("osm-tiles", "raster-opacity")).toBe(1);
      expect(map.getPaintProperty("osm-tiles", "raster-opacity-transition")).toEqual({ duration: 0, delay: 0 });
    });

    expect(request(map, "osm", back)).toBe(true);

    expect(reveal).not.toHaveBeenCalled();
    expect(back).toHaveBeenCalledWith({ status: "completed", basemapId: "osm" });
    expect(map.getLayer("background")).toBeNull();
    expect(map.calls.slice(calls).some((call) => (
      call.key === "raster-opacity-transition" && call.value?.duration === GIS_BASEMAP_FADE_MS
    ))).toBe(false);
    expectIdleListeners(map, baseline);
  });

  test("interrupts toward the sibling esri id from the completed saturation, not the candidate", () => {
    const map = createEsriMap(0);
    const cover = vi.fn();
    const sibling = vi.fn();

    expect(request(map, "osm", cover)).toBe(true);
    const stamp = map.calls.length;
    expect(request(map, "satellite_bw", sibling)).toBe(true);

    expect(cover).not.toHaveBeenCalled();
    expect(sibling).not.toHaveBeenCalled();
    expect(map.getLayer("osm-tiles")).toBeNull();
    expect(map.getSource("osm")).toBeNull();
    const next = map.calls.slice(stamp);
    const restoreAt = next.findIndex((call) => call.key === "raster-saturation-transition" && call.value?.duration === 0);
    const animateAt = next.findIndex((call) => call.key === "raster-saturation-transition" && call.value?.duration === GIS_BASEMAP_FADE_MS);
    expect(restoreAt).toBeGreaterThan(-1);
    expect(animateAt).toBeGreaterThan(restoreAt);
    expect(map.getPaintProperty("esri-tiles", "raster-saturation")).toBe(-1);
    expect(physicalGroupCount(map)).toBe(1);
  });

  test("snaps an in-flight saturation back to the completed value before leaving for a third id", () => {
    const map = createEsriMap(0);
    const fade = vi.fn();
    const next = vi.fn();

    expect(request(map, "satellite_bw", fade)).toBe(true);
    expect(map.getPaintProperty("esri-tiles", "raster-saturation")).toBe(-1);

    const originalAdd = map.addLayer.bind(map);
    map.addLayer = (layer, beforeId) => {
      if (layer.id === "osm-tiles") {
        expect(map.getPaintProperty("esri-tiles", "raster-saturation")).toBe(0);
        expect(map.getPaintProperty("esri-tiles", "raster-saturation-transition")).toEqual({ duration: 0, delay: 0 });
        expect(map.getPaintProperty("esri-tiles", "raster-opacity")).toBe(1);
      }
      originalAdd(layer, beforeId);
    };

    expect(request(map, "osm", next)).toBe(true);

    expect(fade).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(map.getPaintProperty("osm-tiles", "raster-opacity")).toBe(0);
    expect(map.getPaintProperty("esri-tiles", "raster-saturation")).toBe(0);
    expect(physicalGroupCount(map)).toBe(2);
  });

  test("drops superseded callbacks so they cannot mutate layers or settle", async () => {
    const map = createDarkMap();
    const first = vi.fn();
    const second = vi.fn();
    const baseline = overlayListenerBaseline(map);

    expect(request(map, "osm", first)).toBe(true);
    expect(request(map, "dark", second)).toBe(true);
    expect(second).toHaveBeenCalledWith({ status: "completed", basemapId: "dark" });
    const ids = layerIds(map);
    const calls = map.calls.length;

    await vi.advanceTimersByTimeAsync(GIS_BASEMAP_SOURCE_WAIT_MS + GIS_BASEMAP_FADE_MS);
    map.emit("sourcedata", {
      sourceId: "osm",
      sourceDataType: "content",
      tile: { state: "loaded" },
    });
    map.emit("error", { sourceId: "osm", error: new Error("late") });
    map.emit("render");
    map.emit("render");

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(layerIds(map)).toEqual(ids);
    expect(map.calls.length).toBe(calls);
    expectIdleListeners(map, baseline);
  });

  test("cancels work when the map is removed during waiting or fading", async () => {
    const waiting = createDarkMap();
    const waitingSettled = vi.fn();
    const waitingBaseline = overlayListenerBaseline(waiting);
    expect(request(waiting, "osm", waitingSettled)).toBe(true);
    const waitingIds = layerIds(waiting);
    waiting.remove();
    const waitingCalls = waiting.calls.length;
    await vi.advanceTimersByTimeAsync(GIS_BASEMAP_SOURCE_WAIT_MS + GIS_BASEMAP_FADE_MS);
    waiting.emit("sourcedata", {
      sourceId: "osm",
      sourceDataType: "content",
      tile: { state: "loaded" },
    });
    waiting.emit("error", { sourceId: "osm", error: new Error("late") });
    waiting.emit("render");
    expect(waitingSettled).not.toHaveBeenCalled();
    expect(layerIds(waiting)).toEqual(waitingIds);
    expect(waiting.calls.length).toBe(waitingCalls);
    expectIdleListeners(waiting, waitingBaseline);
    expect(waiting.listenerCount("remove")).toBe(0);

    const fading = createEsriMap(0);
    const fadingSettled = vi.fn();
    const fadingBaseline = overlayListenerBaseline(fading);
    expect(request(fading, "satellite_bw", fadingSettled)).toBe(true);
    fading.emit("render");
    const fadingIds = layerIds(fading);
    const saturation = fading.getPaintProperty("esri-tiles", "raster-saturation");
    fading.remove();
    const fadingCalls = fading.calls.length;
    await vi.advanceTimersByTimeAsync(GIS_BASEMAP_FADE_MS);
    fading.emit("render");
    expect(fadingSettled).not.toHaveBeenCalled();
    expect(layerIds(fading)).toEqual(fadingIds);
    expect(fading.getPaintProperty("esri-tiles", "raster-saturation")).toBe(saturation);
    expect(fading.calls.length).toBe(fadingCalls);
    expectIdleListeners(fading, fadingBaseline);
    expect(fading.listenerCount("remove")).toBe(0);
  });

  test("keeps a losing source that an overlay still references and removes one that nothing uses", async () => {
    const retained = createOsmMap();
    retained.addLayer({ id: "overlay-osm-ref", type: "raster", source: "osm" });
    const retainedSettled = vi.fn();
    expect(request(retained, "dark", retainedSettled)).toBe(true);
    emitSuccessfulTile(retained, "openmaptiles");
    await finishRenderedFade(retained, retainedSettled, "dark", ["osm-tiles"]);
    expect(retained.getSource("osm")).not.toBeNull();
    expect(retained.getLayer("overlay-osm-ref")).not.toBeNull();
    expect(retained.getSource("esri")).toBeNull();

    const removed = createOsmMap();
    removed.setSourceLoaded("osm", true);
    const removedSettled = vi.fn();
    expect(request(removed, "satellite", removedSettled)).toBe(true);
    emitSuccessfulTile(removed, "esri");
    await finishRenderedFade(removed, removedSettled, "satellite", ["osm-tiles"]);
    expect(removed.getSource("osm")).toBeNull();

    const osmSourceAdds = retained.calls.filter((call) => call.method === "addSource" && call.id === "osm").length;
    retained.setSourceLoaded("osm", true);
    const again = vi.fn();
    expect(request(retained, "osm", again)).toBe(true);
    expect(retained.getPaintProperty("osm-tiles", "raster-opacity")).toBe(1);
    expect(retained.calls.filter((call) => call.method === "addSource" && call.id === "osm")).toHaveLength(osmSourceAdds);
  });
});
