import { afterEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import * as curatedService from "../../frontend/src/shared/curated-layer-service.js";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";
import { createNliSceneDisplayBinding } from "../../frontend/src/shared/nli-scene-display-binding.js";
import { createGisCuratedRefresh, createProjectionCuratedRefresh } from "../../frontend/src/map/maplibre-curated-layer-loader.js";
import { applyLayerGroupsToMap } from "../../frontend/src/map/maplibre-layer-manager.js";
import { syncCuratedMapLayersAfterSupabasePull } from "../../frontend/src/map/map-curated-supabase-sync.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }

test.each([["gis", false], ["projection", false], ["gis", true], ["projection", true]])(
  "%s curated broadcast refresh retains basemap/readiness during membership change=%s", async (profile, membershipChange) => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  vi.spyOn(curatedService, "fetchCuratedLayerData").mockResolvedValue({ layerData: {}, geojson: {
    type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: {
      type: "Polygon", coordinates: [[[34, 31], [35, 31], [35, 32], [34, 31]]],
    } }],
  } });
  vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths: [] });
  const map = createFakeMapLibreMap({ layers: [{ id: "background", type: "background", paint: { "background-opacity": 1 } }],
    paints: { background: { "background-opacity": 1 } } });
  const runtime = getLayerLifecycleRuntime(map, { now: () => Date.now(),
    requestFrame: callback => map.requestAnimationFrame(callback), cancelFrame: id => map.cancelAnimationFrame(id) });
  const state = { groups: [{ id: "curated_moresht_axis", layers: [
    { id: "67", enabled: true }, { id: "68", enabled: membershipChange },
  ] }] };
  const listeners = new Map();
  const context = { getLayerGroups: () => state.groups, getBasemap: () => "dark",
    subscribe(topic, callback) { listeners.set(topic, callback); return () => listeners.delete(topic); } };
  const apply = (target, groups, options) => applyLayerGroupsToMap(target, groups, options);
  const refresh = profile === "gis"
    ? createGisCuratedRefresh({ map, getLayerGroups: () => state.groups, applyLayerGroups: (groups, options) => apply(map, groups, options) }).refreshCuratedLayers
    : createProjectionCuratedRefresh({ map, getLayerGroups: () => state.groups, syncProjectionLayersWithNarrative: apply }).applyProjectionRefresh;
  const binding = await createNliSceneDisplayBinding({ map, dataContext: context, runtime, refreshLayers: refresh,
    prepareBasemap: async () => ({ mount() {
      runtime.stageMapLayer("nli.basemap.dark", map.getLayer("background"), { adoptVisible: true });
      runtime.markMemberReady("nli.basemap.dark");
    } }), applyBasemap: candidate => candidate.mount(), getDisplayedBasemap: () => "dark" });
  try {
    await flush();
    if (membershipChange) {
      state.groups[0].layers[1].enabled = false;
      listeners.get("layerGroups")?.();
      await flush();
    }
    vi.stubGlobal("OTEFDataContext", { refreshLayerGroupsFromApi: vi.fn(async () => listeners.get("layerGroups")?.()) });
    vi.stubGlobal("LayerStateHelper", { getEffectiveLayerGroups: () => state.groups });
    const unownedApply = vi.fn();
    const result = syncCuratedMapLayersAfterSupabasePull({
      pullPayload: { affected_curated_full_layer_ids: ["curated_moresht_axis.67"] },
      getSceneBinding: () => binding,
      reloadCuratedOnMap: refresh,
      applyLayerGroupsState: unownedApply,
      mapDeps: {},
    });
    for (let i = 0; i < 22; i++) {
      await vi.advanceTimersByTimeAsync(100); map.driveAnimationFrame(Date.now()); await flush();
    }
    await result;
    expect(runtime.getDesiredIds()).toContain("nli.basemap.dark");
    expect(map.getLayer("background")).toBeTruthy();
    expect(map.getPaintProperty("background", "background-opacity")).toBe(1);
    expect(runtime.getRenderedReadiness().ready).toBe(true);
    expect(runtime.getDesiredIds()).not.toContain("curated_moresht_axis.68");
    expect(map.getStyle().layers.some(layer => layer.id.startsWith("curated_moresht_axis.68__"))).toBe(false);
    expect(unownedApply).not.toHaveBeenCalled();
    expect(curatedService.fetchCuratedLayerData).toHaveBeenCalledTimes(membershipChange ? 3 : 2);
  } finally { binding.dispose(); runtime.dispose(); map.remove(); }
});

test.each(["map-main", "projection-main"])("%s curated event supplies its scene owner to the debounce", entry => {
  const source = readFileSync(`frontend/src/entries/${entry}.js`, "utf8");
  const handler = source.slice(source.indexOf("const onCuratedRefresh ="));
  expect(handler).toMatch(/getSceneBinding:\s*\(\)\s*=>/);
});
