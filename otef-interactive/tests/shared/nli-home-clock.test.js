import { afterEach, expect, it, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";
import { createNliSceneDisplayBinding } from "../../frontend/src/shared/nli-scene-display-binding.js";
import { filterGroupsForGisMap } from "../../frontend/src/shared/gis-layer-filter.js";
import { filterGazaBorderVisibility } from "../../frontend/src/shared/gaza-border-style.js";
import { HOME_CUE } from "../../frontend/src/remote/nli-staff-script.js";
import { idleNliClock } from "../../frontend/src/shared/nli-investigation-clock.js";
import { getNliClockSceneIds, syncInvestigationTimelineToMap, getInvestigationTimelineRenderSnapshot,
  disposeInvestigationTimelineForMap } from "../../frontend/src/shared/maplibre-investigation-timeline.js";

const cleanup = [];
afterEach(() => { cleanup.splice(0).forEach(close => close()); vi.useRealTimers(); });
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }
function groupsFor(ids) {
  const groups = new Map();
  for (const fullId of ids) {
    const [group, id] = fullId.split(".");
    if (!groups.has(group)) groups.set(group, { id: group, layers: [] });
    groups.get(group).layers.push({ id, enabled: true });
  }
  return [...groups.values()];
}

async function homeDisplay(surface, borderVisible) {
  vi.useFakeTimers(); vi.setSystemTime(0);
  const map = createFakeMapLibreMap();
  const images = new Map();
  map.hasImage = id => images.has(id);
  map.addImage = (id, image) => images.set(id, image);
  map.removeImage = id => images.delete(id);
  const runtime = getLayerLifecycleRuntime(map, { now: () => Date.now(),
    requestFrame: cb => map.requestAnimationFrame(cb), cancelFrame: id => map.cancelAnimationFrame(id) });
  const caption = { hidden: true, style: {}, innerHTML: "", setAttribute() {} };
  let rawGroups = groupsFor(HOME_CUE.layers);
  const context = { getLayerGroups: () => rawGroups, getGazaBorderVisible: () => borderVisible,
    getNarrativeState: () => ({ id: null }), getInvestigationClock: () => idleNliClock() };
  const binding = await createNliSceneDisplayBinding({ map, runtime, dataContext: context,
    filterGroups: groups => filterGazaBorderVisibility(surface === "gis" ? filterGroupsForGisMap(groups) : groups, borderVisible),
    getDisplaySceneIds: snapshot => getNliClockSceneIds(snapshot, surface),
    async refreshLayers({ groupsOverride }) {
      for (const group of groupsOverride) for (const layer of group.layers || []) {
        if (!layer.enabled) continue;
        const id = `${group.id}.${layer.id}`;
        const { stagedLayerDef } = runtime.stageMapLayer(id, { id, type: "line", paint: { "line-opacity": 1 } },
          { onTeardown() { map.removeLayer(id); } });
        if (!map.getLayer(id)) map.addLayer(stagedLayerDef);
        runtime.markMemberReady(id);
      }
    },
    syncTimeline: (snapshot, options) => syncInvestigationTimelineToMap(map, snapshot.investigationClock, snapshot.layerGroups, {
      ...options, displayProfile: surface, captionEl: caption, allowMapCaption: false, nliCaptionMode: "clock-only",
      sceneClockRuntime: runtime, sceneCaptionId: `nli.clock-caption.${surface}`,
      cueLayerGroups: snapshot.rawLayerGroups,
      visibilityLayerGroups: surface === "gis" ? snapshot.rawLayerGroups : snapshot.layerGroups,
      getLayerDataUrl: () => null, settlementFeatures: [], motionMode: "reduced", now: () => Date.now(),
      shelterImageFactory: () => ({ width: 1, height: 1, data: new Uint8Array(4) }),
    }),
  });
  cleanup.push(() => { binding.dispose(); disposeInvestigationTimelineForMap(map); runtime.dispose(); });
  await flush();
  async function advance() { await vi.advanceTimersByTimeAsync(600); map.driveAnimationFrame(Date.now()); await flush(); }
  await advance();
  return { map, caption, binding, runtime, async names() {
    rawGroups = groupsFor(["nli.people_names"]); binding.request(); await flush(); await advance();
  } };
}

// Matching filtered map layers against the full Home cue used to omit the clock
// lifecycle member on GIS, and hide the projection clock with the border off.
it.each([["gis", true], ["gis", false], ["projection", true], ["projection", false]])(
  "%s Home renders 06:29 at full opacity with border visibility %s", async (surface, visible) => {
    const h = await homeDisplay(surface, visible);
    expect(h.caption.hidden).toBe(false);
    expect(getInvestigationTimelineRenderSnapshot(h.map)).toMatchObject({ visible: true, sceneOpacity: 1, model: { clockLabel: "06:29" } });
    await h.names();
    expect(h.caption.hidden).toBe(true);
    expect(getInvestigationTimelineRenderSnapshot(h.map).visible).toBe(false);
  },
);
