import { describe, expect, it, vi } from "vitest";
import { HOME_CUE, TIMELINE, NARRATIVES } from "../../frontend/src/remote/nli-staff-script.js";
import { INVESTIGATION_POLYGONS_FULL_ID } from "../../frontend/src/shared/nli-investigation-beats.js";
import { endNliClock, idleNliClock, playNliClock } from "../../frontend/src/shared/nli-investigation-clock.js";
import { deriveInvestigationFrame } from "../../frontend/src/shared/nli-investigation-visual-state.js";
import { getNliNarrative } from "../../frontend/src/shared/nli-narratives.js";
import { NLI_NOVA_STORY } from "../../frontend/src/shared/nli-nova-story.js";

vi.mock("../../frontend/src/map/maplibre-map.js", () => ({
  createGISMap: vi.fn(),
  setGISBasemap: vi.fn(),
}));

import { composeGisClockPreviewScene } from "../../frontend/src/map/clock-preview.js";

const GROUPS = [
  { id: "projector_base", layers: [{ id: "ישובים", enabled: true, style: { color: "red" } }] },
  { id: "nli", layers: [{ id: "investigation_polygons", enabled: true }] },
];

describe("GIS clock preview scenes", () => {
  it("uses independent Home and Timeline recipes with the shared idle start clock", () => {
    const home = composeGisClockPreviewScene("home", GROUPS, 1234);
    const timeline = composeGisClockPreviewScene("timeline", GROUPS, 1234);

    expect(home.clock.phase).toBe("idle");
    expect(timeline.clock.phase).toBe("idle");
    expect(home.captionMinute).toBeNull();
    expect(timeline.captionMinute).toBeNull();
    expect(home.cue.layers).toEqual(HOME_CUE.layers);
    expect(timeline.cue.layers).toEqual(TIMELINE.steps.at(-1).cue.layers);
    expect(home.cue).not.toBe(HOME_CUE);
    expect(timeline.cue).not.toBe(TIMELINE.steps.at(-1).cue);
    expect(home.cue.layers).not.toBe(HOME_CUE.layers);
    expect(timeline.cue.layers).not.toBe(TIMELINE.steps.at(-1).cue.layers);
    expect(home.groups).not.toBe(GROUPS);
    expect(home.groups[0]).not.toBe(GROUPS[0]);
    home.groups[0].layers[0].enabled = false;
    expect(GROUPS[0].layers[0].enabled).toBe(true);
  });

  it.each(["segev", "nova", "sderot", "hostages", "hostages_all"])(
    "%s uses its existing narrative camera, cue, basemap, and idle time",
    (sceneId) => {
      const scene = composeGisClockPreviewScene(sceneId, GROUPS, 1234);
      const narrative = getNliNarrative(sceneId);
      const script = NARRATIVES.find((item) => item.id === (sceneId === "hostages_all" ? "hostages" : sceneId));
      const step = sceneId === "hostages_all" ? script.steps.at(-1) : script.steps[0];

      expect(scene.narrative).toEqual(narrative);
      expect(scene.center).toEqual(narrative.center);
      expect(scene.zoom).toBe(narrative.zoom);
      expect(scene.basemap).toBe(narrative.basemap);
      expect(scene.clock.phase).toBe("idle");
      expect(scene.captionMinute).toBe(narrative.idleClockMinutes ?? 389);
      expect(scene.cue.layers).toEqual(step.cue.layers);
      expect(scene.cue.layers).not.toBe(step.cue.layers);
    },
  );

  it("does not let a selected preview scene mutate source cue definitions", () => {
    const beforeHome = structuredClone(HOME_CUE);
    const beforeTimeline = structuredClone(TIMELINE.steps.at(-1).cue);
    const beforeNarratives = structuredClone(NARRATIVES);

    for (const id of ["home", "timeline", "segev", "nova", "sderot", "hostages", "hostages_all"]) {
      const scene = composeGisClockPreviewScene(id, GROUPS, 1234);
      scene.cue.layers.push("preview-only.layer");
      scene.groups[0].layers[0].enabled = false;
    }

    expect(HOME_CUE).toEqual(beforeHome);
    expect(TIMELINE.steps.at(-1).cue).toEqual(beforeTimeline);
    expect(NARRATIVES).toEqual(beforeNarratives);
  });

  it("composes an ended Nova explainer clock that reveals the 14 story polygons", () => {
    const scene = composeGisClockPreviewScene("nova", GROUPS, 1234, { novaExplainers: true });
    expect(scene.clock).toEqual(endNliClock(playNliClock(
      idleNliClock({ serverNowMs: 1234 }),
      [INVESTIGATION_POLYGONS_FULL_ID],
      NLI_NOVA_STORY.representativeMinutes,
      1234,
    )));
    const frame = deriveInvestigationFrame(scene.clock, 1234, scene.clock.membership, { narrativeId: "nova" });
    expect(frame.narrative.phase).toBe("ended");
    expect(frame.achievedPolygonObjectIds).toHaveLength(14);
    expect(new Set(frame.achievedPolygonObjectIds).size).toBe(14);
    expect(frame.achievedPolygonObjectIds).not.toContain(107);
    expect(scene.cue.layers).toEqual(NARRATIVES.find((item) => item.id === "nova").steps[0].cue.layers);
  });

  it("keeps an ordinary Nova preview on the idle clock when explainer mode is absent", () => {
    const scene = composeGisClockPreviewScene("nova", GROUPS, 1234);
    expect(scene.clock.phase).toBe("idle");
    expect(scene.captionMinute).toBe(getNliNarrative("nova").idleClockMinutes);
    const frame = deriveInvestigationFrame(scene.clock, 1234, scene.clock.membership, { narrativeId: "nova" });
    expect(frame.achievedPolygonObjectIds ?? []).toHaveLength(0);
  });
});
