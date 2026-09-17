import { describe, expect, test, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { NLI_NARRATIVES } from "../../frontend/src/shared/nli-narratives.js";
import { NARRATIVE_FOCUS_RENDERER_IDS } from "../../frontend/src/shared/maplibre-narrative-focus.js";
import { createProjectionNarrativeController } from "../../frontend/src/projection/projection-narrative-controller.js";
import { syncInvestigationTimelineToMap } from "../../frontend/src/shared/maplibre-investigation-timeline.js";
import { idleNliClock } from "../../frontend/src/shared/nli-investigation-clock.js";

function setup(options = {}) {
  const map = createFakeMapLibreMap({
    layers: [
      { id: "nli-people", type: "circle", source: "nli.people" },
      { id: "projector_base__יישובים__fill", type: "fill" },
      { id: "projector_base__שמות_יישובים__symbol", type: "symbol" },
      { id: "projector_base__Locations_Lines__line", type: "line" },
    ],
  });
  map.flyTo = vi.fn();
  map.jumpTo = vi.fn();
  map.easeTo = vi.fn();
  map.setFilter = vi.fn();
  const syncTimeline = vi.fn();
  return {
    map,
    syncTimeline,
    controller: createProjectionNarrativeController({
      map,
      syncTimeline,
      onStyleLoadOverlay: options.onStyleLoadOverlay,
    }),
  };
}

describe("projection Segev narrative focus", () => {
  test("applies Be'eri focus without the Segev family marker or label, and never moves the projection camera", () => {
    const { map, syncTimeline, controller } = setup();

    controller.apply({ id: "segev", transition: "enter", revision: 1 });

    expect(controller.getDefinition()).toBe(NLI_NARRATIVES.segev);
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.halo)).toBeFalsy();
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.label)).toBeFalsy();
    expect(map.getSource(NARRATIVE_FOCUS_RENDERER_IDS.source)).toBeFalsy();
    expect(syncTimeline).toHaveBeenCalledTimes(1);
    expect(map.flyTo).not.toHaveBeenCalled();
    expect(map.jumpTo).not.toHaveBeenCalled();
    expect(map.easeTo).not.toHaveBeenCalled();
  });

  test("Nova uses the existing place name and does not mount the red registry marker", () => {
    const { map, syncTimeline, controller } = setup();

    controller.apply({ id: "nova", transition: "enter", revision: 1 });

    expect(controller.getDefinition()).toBe(NLI_NARRATIVES.nova);
    expect(NLI_NARRATIVES.nova.focusSettlement).toBe("נובה");
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.halo)).toBeFalsy();
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.label)).toBeFalsy();
    expect(map.getSource(NARRATIVE_FOCUS_RENDERER_IDS.source)).toBeFalsy();
    expect(syncTimeline).toHaveBeenCalledTimes(1);
    expect(map.flyTo).not.toHaveBeenCalled();
  });

  test("Nova applies the victim filter immediately and clears it on exit", () => {
    const { map, controller } = setup();

    controller.apply({ id: "nova", transition: "enter", revision: 1 });
    expect(map.setFilter).toHaveBeenCalledWith("nli-people", ["==", ["get", "location"], "Nova"]);

    controller.apply({ id: null, transition: "exit", revision: 2 });
    expect(map.setFilter).toHaveBeenLastCalledWith("nli-people", null);
  });

  test("Nova reapplies the victim filter after projection style reconstruction", () => {
    const { map, controller } = setup();
    controller.apply({ id: "nova", transition: "enter", revision: 1 });
    map.setFilter.mockClear();
    map.wipeStyle();
    map.addLayer({ id: "nli-people", type: "circle", source: "nli.people" });

    controller.onStyleLoad();

    expect(map.setFilter).toHaveBeenCalledWith("nli-people", ["==", ["get", "location"], "Nova"]);
  });

  test("does not remount a Segev marker after the host layers are rebuilt", () => {
    const { map, syncTimeline, controller } = setup();
    controller.apply({ id: "segev", transition: "enter", revision: 1 });
    map.wipeStyle();

    controller.onStyleLoad();

    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.halo)).toBeFalsy();
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.label)).toBeFalsy();
    expect(syncTimeline).toHaveBeenCalledTimes(2);
  });

  test("clears the marker and settlement focus on exit or replacement without projection presentation DOM", () => {
    const { map, syncTimeline, controller } = setup();
    controller.apply({ id: "segev", transition: "enter", revision: 1 });
    controller.apply({ id: null, transition: "exit", revision: 2 });

    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.halo)).toBeNull();
    expect(map.getSource(NARRATIVE_FOCUS_RENDERER_IDS.source)).toBeNull();
    expect(controller.getDefinition()).toBeNull();
    expect(syncTimeline).toHaveBeenCalledTimes(2);
    expect(map.flyTo).not.toHaveBeenCalled();
    expect(map.jumpTo).not.toHaveBeenCalled();
    expect(map.easeTo).not.toHaveBeenCalled();
  });

  test("disposes by resynchronizing normal timeline state before removing its marker", () => {
    const map = createFakeMapLibreMap();
    let controller;
    const timelineFocuses = [];
    controller = createProjectionNarrativeController({
      map,
      syncTimeline: () => timelineFocuses.push(controller.getDefinition()),
    });
    controller.apply({ id: "segev", transition: "enter", revision: 1 });

    controller.dispose();

    expect(timelineFocuses).toEqual([NLI_NARRATIVES.segev, null]);
    expect(controller.getDefinition()).toBeNull();
    expect(map.getSource(NARRATIVE_FOCUS_RENDERER_IDS.source)).toBeNull();
  });

  test("keeps the Be'eri outline after rebuilt projection layers without a Segev family marker", async () => {
    const map = createFakeMapLibreMap();
    const hiddenGroups = [{ id: "nli", layers: [
      { id: "investigation_polygons", enabled: false },
      { id: "lines", enabled: false },
    ] }];
    const beeriOutline = {
      type: "Feature",
      properties: { outlineObjectId: 19, OBJECTID: 19 },
      geometry: { type: "Polygon", coordinates: [[[34.45, 31.42], [34.46, 31.42], [34.46, 31.43], [34.45, 31.42]]] },
    };
    let controller;
    const pendingSyncs = [];
    controller = createProjectionNarrativeController({
      map,
      syncTimeline: () => {
        const sync = syncInvestigationTimelineToMap(map, idleNliClock(), hiddenGroups, {
          narrativeFocus: controller.getDefinition(),
          settlementFeatures: [beeriOutline],
          now: () => 0,
        });
        pendingSyncs.push(sync);
      },
    });

    controller.apply({ id: "segev", transition: "enter", revision: 1 });
    await Promise.all(pendingSyncs);
    expect(map.getSource("nli-investigation-settlement-impact").data.features).toEqual([beeriOutline]);
    expect(map.getLayer("nli-investigation-settlement-impact-outline")).toBeTruthy();
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.halo)).toBeFalsy();
    expect(map.getLayer(NARRATIVE_FOCUS_RENDERER_IDS.label)).toBeFalsy();

    map.addLayer({ id: "curated-after-narrative", type: "fill", source: "curated" });
    controller.onStyleLoad();
    await Promise.all(pendingSyncs);
    expect(map.getSource("nli-investigation-settlement-impact").data.features).toEqual([beeriOutline]);
    expect(map.getSource(NARRATIVE_FOCUS_RENDERER_IDS.source)).toBeFalsy();

    controller.dispose();
    await Promise.all(pendingSyncs);
    expect(map.getSource("nli-investigation-settlement-impact")).toBeNull();
    expect(map.getSource(NARRATIVE_FOCUS_RENDERER_IDS.source)).toBeNull();
  });

  test("projection onStyleLoad calls onStyleLoadOverlay", () => {
    const onStyleLoadOverlay = vi.fn();
    const { controller } = setup({ onStyleLoadOverlay });
    controller.apply({ id: "nova", transition: "enter", revision: 1 });
    onStyleLoadOverlay.mockClear();
    controller.onStyleLoad();
    expect(onStyleLoadOverlay).toHaveBeenCalledTimes(1);
  });

  test("projection overlay remount does not pass styleLoss true", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(
      new URL("../../frontend/src/entries/projection-main.js", import.meta.url),
      "utf8",
    ));
    expect(source).toMatch(/onStyleLoadOverlay:\s*\(\)\s*=>\s*novaEscapeCoordinator\?\.onStyleLoad\?\.\(\)/);
    expect(source).not.toMatch(/onStyleLoad\?\.\(\{\s*styleLoss:\s*true\s*\}\)/);
  });

  test("has no presentation or camera dependencies", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(
      new URL("../../frontend/src/projection/projection-narrative-controller.js", import.meta.url),
      "utf8",
    ));

    expect(source).not.toContain("iframe");
    expect(source).not.toContain("Canva");
    expect(source).not.toContain("flyTo");
    expect(source).not.toContain("jumpTo");
    expect(source).not.toContain("easeTo");
  });
});
