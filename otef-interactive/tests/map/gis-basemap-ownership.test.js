import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";
import * as basemap from "../../frontend/src/map/gis-basemap-transition.js";
import { createNliSceneDisplayBinding } from "../../frontend/src/shared/nli-scene-display-binding.js";
import { createGisBasemapStyleCoordinator } from "../../frontend/src/entries/map-main-style-lifecycle.js";

const raster = source => ({ version: 8, sources: { [source]: { type: "raster", tiles: ["https://example.test/{z}/{x}/{y}"] } }, layers: [{ id: `${source}-tiles`, type: "raster", source, paint: { "raster-opacity": 1 } }] });
const satellite = raster("esri");
const styles = { dark: { version: 8, sources: { openmaptiles: { type: "vector" } }, layers: [{ id: "background", type: "background", paint: { "background-opacity": 1 } }, { id: "water", type: "fill", source: "openmaptiles", paint: { "fill-opacity": 1 } }] }, osm: raster("osm"), satellite, satellite_bw: { ...satellite, layers: [{ ...satellite.layers[0], paint: { "raster-opacity": 1, "raster-saturation": -1 } }] } };
let close;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { close?.(); close = null; vi.useRealTimers(); });

async function harness() {
  const map = createFakeMapLibreMap({ sources: styles.dark.sources, layers: styles.dark.layers });
  map.setSourceLoaded("openmaptiles", true);
  map.style = { tileManagers: { openmaptiles: { getRenderableIds: () => ["dark"] }, esri: { getRenderableIds: () => ["satellite"] }, osm: { getRenderableIds: () => ["osm"] } } };
  const runtime = getLayerLifecycleRuntime(map, { now: () => Date.now(), requestFrame: cb => map.requestAnimationFrame(cb), cancelFrame: id => map.cancelAnimationFrame(id) });
  close = () => { runtime.dispose(); map.remove(); };
  const advance = async ms => { await vi.advanceTimersByTimeAsync(ms); map.driveAnimationFrame(Date.now()); };
  const loaded = sourceId => { map.setSourceLoaded(sourceId, true); map.emit("sourcedata", { sourceId, sourceDataType: "content", tile: { state: "loaded" } }); };
  const mount = async id => {
    const preparing = basemap.transitionGisBasemap(map, id, { styles, managedScene: { runtime } });
    loaded(id === "dark" ? "openmaptiles" : id === "osm" ? "osm" : "esri");
    const candidate = await preparing;
    runtime.setDesiredIds([candidate.fullId], { durationMs: 600, requiredIds: [candidate.fullId] }); candidate.mount(); runtime.commitBatch(); await advance(600); candidate.complete();
    return candidate;
  };
  await mount("dark");
  const manual = async (id, onSettled = vi.fn()) => {
    basemap.transitionGisBasemap(map, id, { styles, onSettled }); loaded(id === "dark" ? "openmaptiles" : id === "osm" ? "osm" : "esri");
    map.emit("render"); await advance(400); map.emit("render"); return onSettled;
  };
  return { map, runtime, advance, mount, manual };
}

it("adopts completed manual physical channels and basemap identity only after rendered completion", async () => {
  const h = await harness();
  const onSettled = vi.fn(); basemap.transitionGisBasemap(h.map, "satellite", { styles, onSettled });
  expect(basemap.adoptDisplayedGisBasemap?.(h.map, "satellite", { styles, runtime: h.runtime })).toBe(false);
  h.map.setSourceLoaded("esri", true); h.map.emit("sourcedata", { sourceId: "esri", sourceDataType: "content", tile: { state: "loaded" } });
  h.map.emit("render"); await h.advance(400); h.map.emit("render");
  expect(onSettled).toHaveBeenCalledWith({ status: "completed", basemapId: "satellite" });
  const source = h.map.getSource("esri"), layer = h.map.getLayer("esri-tiles");
  expect(basemap.adoptDisplayedGisBasemap?.(h.map, "satellite", { styles, runtime: h.runtime })).toBe(true);
  expect(h.runtime.getDesiredIds()).toEqual(["nli.basemap.esri"]); expect(h.runtime.getRenderedReadiness().ready).toBe(true);
  expect(h.map.getSource("esri")).toBe(source); expect(h.map.getLayer("esri-tiles")).toBe(layer); expect(h.map.getPaintProperty("esri-tiles", "raster-opacity")).toBe(1);
  await h.mount("dark"); expect(h.map.getSource("esri")).toBeFalsy(); expect(h.map.getLayer("esri-tiles")).toBeFalsy();
});

it("current managed owner cleans a reused same-ID source after unrelated retained membership clears departure listeners", async () => {
  const h = await harness(); await h.mount("satellite"); const oldSource = h.map.getSource("esri"); await h.mount("dark");
  await h.mount("satellite_bw"); expect(h.map.getSource("esri")).not.toBe(oldSource);
  h.runtime.setDesiredIds(["nli.basemap.esri"], { durationMs: 0 }); h.runtime.commitBatch();
  await h.mount("dark"); expect(h.map.getLayer("esri-tiles")).toBeFalsy(); expect(h.map.getSource("esri")).toBeFalsy();
});

it("rejects adoption during a pending manual or unrelated lifecycle trajectory without changing it", async () => {
  const h = await harness(); await h.manual("satellite");
  h.map.addLayer({ id: "people", type: "circle", paint: { "circle-opacity": 1 } });
  h.runtime.setDesiredIds(["nli.basemap.dark", "nli.people"], { durationMs: 600 }); h.runtime.stageMapLayer("nli.people", h.map.getLayer("people")); h.runtime.markMemberReady("nli.people"); h.runtime.commitBatch(); await h.advance(200);
  const opacity = h.map.getPaintProperty("people", "circle-opacity"), desired = h.runtime.getDesiredIds();
  expect(basemap.adoptDisplayedGisBasemap?.(h.map, "satellite", { styles, runtime: h.runtime })).toBe(false);
  expect(h.runtime.getDesiredIds()).toEqual(desired); expect(h.map.getPaintProperty("people", "circle-opacity")).toBe(opacity);
});

it("manual saturation adoption preserves the same ESRI source, layer and cache", async () => {
  const h = await harness(); await h.mount("satellite");
  const source = h.map.getSource("esri"), layer = h.map.getLayer("esri-tiles"), cache = h.map.style.tileManagers.esri;
  await h.manual("satellite_bw"); expect(basemap.adoptDisplayedGisBasemap?.(h.map, "satellite_bw", { styles, runtime: h.runtime })).toBe(true);
  expect(h.map.getSource("esri")).toBe(source); expect(h.map.getLayer("esri-tiles")).toBe(layer); expect(h.map.style.tileManagers.esri).toBe(cache); expect(h.map.getPaintProperty("esri-tiles", "raster-saturation")).toBe(-1);
});

it("an old manual completion cannot adopt or remove a replacement source with the same ID", async () => {
  const h = await harness(), settled = vi.fn();
  basemap.transitionGisBasemap(h.map, "satellite", { styles, onSettled: settled });
  h.map.setSourceLoaded("esri", true); h.map.emit("sourcedata", { sourceId: "esri", sourceDataType: "content", tile: { state: "loaded" } }); h.map.emit("render");
  h.map.removeLayer("esri-tiles"); h.map.removeSource("esri"); h.map.addSource("esri", satellite.sources.esri); h.map.addLayer(satellite.layers[0]); h.map.setSourceLoaded("esri", true);
  const replacement = h.map.getSource("esri"), layer = h.map.getLayer("esri-tiles");
  await h.advance(400); h.map.emit("render");
  expect(settled).not.toHaveBeenCalledWith({ status: "completed", basemapId: "satellite" });
  expect(basemap.adoptDisplayedGisBasemap(h.map, "satellite", { styles, runtime: h.runtime })).toBe(false);
  expect(h.map.getSource("esri")).toBe(replacement); expect(h.map.getLayer("esri-tiles")).toBe(layer);
});

it("does not adopt a completed record after style replacement recreates the same physical IDs", async () => {
  const h = await harness(); await h.manual("satellite");
  h.map.setStyle(satellite); const source = h.map.getSource("esri"), layer = h.map.getLayer("esri-tiles");
  expect(basemap.adoptDisplayedGisBasemap(h.map, "satellite", { styles, runtime: h.runtime })).toBe(false);
  expect(h.map.getSource("esri")).toBe(source); expect(h.map.getLayer("esri-tiles")).toBe(layer);
});

it("adopts only the basemap membership while retaining unrelated visible channels and source handles", async () => {
  const h = await harness(); h.map.addSource("people", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  h.map.addLayer({ id: "people", type: "circle", source: "people", paint: { "circle-opacity": .7 } });
  h.runtime.setDesiredIds(["nli.basemap.dark", "nli.people"], { durationMs: 0 }); h.runtime.stageMapLayer("nli.people", h.map.getLayer("people"), { adoptVisible: true }); h.runtime.markMemberReady("nli.people"); h.runtime.commitBatch();
  const layer = h.map.getLayer("people"), source = h.map.getSource("people");
  await h.manual("satellite"); expect(basemap.adoptDisplayedGisBasemap(h.map, "satellite", { styles, runtime: h.runtime })).toBe(true);
  expect(new Set(h.runtime.getDesiredIds())).toEqual(new Set(["nli.people", "nli.basemap.esri"]));
  expect(h.map.getLayer("people")).toBe(layer); expect(h.map.getSource("people")).toBe(source); expect(h.map.getPaintProperty("people", "circle-opacity")).toBe(.7);
});

it("consumes completed manual basemap adoption once after an unrelated semantic tween settles", async () => {
  const h = await harness(), state = { basemap: "dark" }, completions = [];
  let binding;
  const coordinator = createGisBasemapStyleCoordinator({ map: h.map, initialBasemap: "dark", setBasemap(target, id, options = {}) {
    return basemap.transitionGisBasemap(target, id, { styles, onSettled(result) {
      options.onSettled?.(result);
      if (result.status !== "completed" || coordinator.getRequestedBasemap() !== result.basemapId) return;
      const adopt = () => {
        if (coordinator.getRequestedBasemap() !== result.basemapId) return false;
        const accepted = binding.adoptManualBasemap(result.basemapId, ({ runtime }) => basemap.adoptDisplayedGisBasemap(h.map, result.basemapId, { styles, runtime }));
        completions.push(accepted); return accepted;
      };
      if (!adopt()) basemap.deferDisplayedGisBasemapAdoption?.(h.map, result.basemapId, { runtime: h.runtime, onReady: adopt });
    } });
  } });
  h.map.addLayer({ id: "story", type: "fill", paint: { "fill-opacity": 1 } });
  binding = await createNliSceneDisplayBinding({ map: h.map, runtime: h.runtime,
    dataContext: { getLayerGroups: () => [{ id: "nli", layers: [{ id: "story", enabled: true }] }], getBasemap: () => state.basemap, getInvestigationClock: () => ({ phase: "idle" }) },
    refreshLayers() { h.runtime.stageMapLayer("nli.story", h.map.getLayer("story")); h.runtime.markMemberReady("nli.story"); },
    requestManualBasemap: id => coordinator.request(id),
    prepareBasemap: (id, { signal } = {}) => basemap.transitionGisBasemap(h.map, id, { styles, managedScene: { runtime: h.runtime, signal } }),
    applyBasemap: candidate => candidate.mount(), discardBasemap: candidate => candidate?.discard(), getDisplayedBasemap: () => basemap.getDisplayedGisBasemap(h.map, styles),
  });
  const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
  const closeMap = close; close = () => { binding.dispose(); coordinator.dispose(); closeMap(); };
  await flush(); h.runtime.updateEffectivePaint("nli.story", "story", "fill-opacity", .2, { tweenMs: 600 });
  state.basemap = "osm"; await binding.request(); await flush();
  h.map.setSourceLoaded("osm", true); h.map.emit("sourcedata", { sourceId: "osm", sourceDataType: "content", tile: { state: "loaded" } }); h.map.emit("render");
  await h.advance(410); h.map.emit("render"); await flush();
  const source = h.map.getSource("osm"), layer = h.map.getLayer("osm-tiles"), during = h.map.getPaintProperty("story", "fill-opacity");
  expect(completions).toEqual([false]); expect(h.runtime.getRenderedReadiness().moving).toBe(true); expect(during).toBeGreaterThan(.2); expect(during).toBeLessThan(1);
  await h.advance(240); h.map.emit("render"); await flush();
  expect(completions).toEqual([false, true]); expect(h.runtime.getDesiredIds()).toContain("nli.basemap.osm"); expect(h.runtime.getDesiredIds()).not.toContain("nli.basemap.dark");
  expect(binding.getDisplayedSnapshot().basemapId).toBe("osm"); expect(binding.getRenderSnapshot().basemapId).toBe("osm");
  expect(h.map.getPaintProperty("story", "fill-opacity")).toBe(.2); expect(h.map.getSource("osm")).toBe(source); expect(h.map.getLayer("osm-tiles")).toBe(layer);
  h.map.emit("render"); expect(completions).toEqual([false, true]);
});

it.each(["new managed request", "style replacement", "same-ID source replacement", "runtime disposal"])("cancels deferred manual ownership on %s", async cause => {
  const h = await harness(); await h.manual("satellite");
  h.map.addLayer({ id: "story", type: "fill", paint: { "fill-opacity": 1 } });
  h.runtime.stageMapLayer("nli.story", h.map.getLayer("story"), { adoptVisible: true });
  h.runtime.updateEffectivePaint("nli.story", "story", "fill-opacity", .2, { tweenMs: 600 });
  const ready = vi.fn(), baseline = h.map.listenerCount("render");
  expect(basemap.deferDisplayedGisBasemapAdoption(h.map, "satellite", { runtime: h.runtime, onReady: ready })).toBe(true);
  expect(h.map.listenerCount("render")).toBe(baseline + 1);
  if (cause === "new managed request") await h.mount("dark");
  else if (cause === "style replacement") h.map.setStyle(satellite);
  else if (cause === "runtime disposal") h.runtime.dispose();
  else { h.map.removeLayer("esri-tiles"); h.map.removeSource("esri"); h.map.addSource("esri", satellite.sources.esri); h.map.addLayer(satellite.layers[0]); }
  await h.advance(650); h.map.emit("render");
  expect(ready).not.toHaveBeenCalled(); expect(h.map.listenerCount("render")).toBe(baseline);
});
