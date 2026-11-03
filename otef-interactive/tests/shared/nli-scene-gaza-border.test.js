import { afterEach, expect, it, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";
import { createNliSceneDisplayBinding } from "../../frontend/src/shared/nli-scene-display-binding.js";
import { filterGazaBorderVisibility } from "../../frontend/src/shared/gaza-border-style.js";
import { filterGroupsForGisMap } from "../../frontend/src/shared/gis-layer-filter.js";
import { isolateLayersWhileVictimNamesShown } from "../../frontend/src/shared/nli-victim-name-layer-isolation.js";

afterEach(() => vi.useRealTimers());
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const borderId = "gaza.gaza_border";

async function harness(surface) {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const map = createFakeMapLibreMap();
  const runtime = getLayerLifecycleRuntime(map, { now: () => Date.now(), requestFrame: cb => map.requestAnimationFrame(cb), cancelFrame: id => map.cancelAnimationFrame(id) });
  const raw = [{ id: "gaza", layers: [{ id: "gaza_border", enabled: true }] }, { id: "home", layers: [{ id: "land", enabled: true }] }];
  let visible = false, clock = { phase: "idle" };
  const listeners = new Map();
  const context = { getLayerGroups: () => raw, getGazaBorderVisible: () => visible, getInvestigationClock: () => clock,
    subscribe(topic, callback) { listeners.set(topic, callback); return () => listeners.delete(topic); } };
  const displayFilter = surface === "gis" ? filterGroupsForGisMap : isolateLayersWhileVictimNamesShown;
  const binding = await createNliSceneDisplayBinding({ map, dataContext: context, runtime,
    filterGroups: groups => filterGazaBorderVisibility(displayFilter(groups), visible),
    async refreshLayers({ groupsOverride }) {
      for (const group of groupsOverride) for (const layer of group.layers || []) {
        if (!layer.enabled) continue;
        const id = `${group.id}.${layer.id}`;
        const definition = { id, type: "line", paint: { "line-opacity": 1 } };
        const { stagedLayerDef } = runtime.stageMapLayer(id, definition, { onTeardown() { map.removeLayer(id); } });
        if (!map.getLayer(id)) map.addLayer(stagedLayerDef);
        runtime.markMemberReady(id);
      }
    },
  });
  await flush();
  return { raw, map, runtime, binding,
    visibility(value) { visible = value; listeners.get("gazaBorderVisibility")?.(value); },
    hold(value) { clock = value ? { phase: "idle", presentationPendingUntilMs: 15000 } : { phase: "idle" }; listeners.get("investigationClock")?.(clock); },
    async advance(ms) { await vi.advanceTimersByTimeAsync(ms); map.driveAnimationFrame(Date.now()); await flush(); },
    close() { binding.dispose(); runtime.dispose(); },
  };
}

it.each(["gis", "projection"])("%s excludes globally hidden border from required scene membership without changing scene state", async surface => {
  const h = await harness(surface);
  expect(h.binding.getDisplayedSnapshot().enabledIds).toEqual(["home.land"]);
  expect(h.runtime.getDesiredIds()).not.toContain(borderId);
  expect(h.map.getLayer(borderId)).toBeFalsy();
  expect(h.raw[0].layers[0].enabled).toBe(true);
  h.close();
});

it.each(["gis", "projection"])("%s buffers the global border override under a cue hold and tears it down only at zero", async surface => {
  const h = await harness(surface);
  h.hold(true); h.visibility(true); await flush();
  expect(h.binding.getDisplayedSnapshot().gazaBorderVisible).toBe(false);
  expect(h.map.getLayer(borderId)).toBeFalsy();
  h.hold(false); await flush(); await h.advance(300);
  expect(h.map.getPaintProperty(borderId, "line-opacity")).toBeCloseTo(.5);
  await h.advance(300);
  expect(h.binding.getDisplayedSnapshot().enabledIds).toContain(borderId);
  h.hold(true); h.visibility(false); await flush();
  expect(h.binding.getRenderSnapshot().gazaBorderVisible).toBe(true);
  expect(h.map.getPaintProperty(borderId, "line-opacity")).toBe(1);
  h.hold(false); await flush(); await h.advance(300);
  expect(h.map.getLayer(borderId)).toBeTruthy();
  expect(h.map.getPaintProperty(borderId, "line-opacity")).toBeCloseTo(.5);
  await h.advance(300);
  expect(h.map.getLayer(borderId)).toBeFalsy();
  expect(h.binding.getDisplayedSnapshot().enabledIds).not.toContain(borderId);
  expect(h.raw[0].layers[0].enabled).toBe(true);
  h.close();
});

it.each(["gis", "projection"])("%s applies an unheld global override through the scene subscription", async surface => {
  const h = await harness(surface);
  h.visibility(true); await flush(); await h.advance(600);
  expect(h.binding.getDisplayedSnapshot().enabledIds).toContain(borderId);
  expect(h.map.getPaintProperty(borderId, "line-opacity")).toBe(1);
  h.close();
});
