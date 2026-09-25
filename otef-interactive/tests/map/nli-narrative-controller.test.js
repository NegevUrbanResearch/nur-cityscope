import { describe, expect, test, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { NLI_NARRATIVES } from "../../frontend/src/shared/nli-narratives.js";
import { NLI_NOVA_STORY } from "../../frontend/src/shared/nli-nova-story.js";
import { EXCLUDE_SURVIVOR_FILTER, NOVA_PEOPLE_FILTER } from "../../frontend/src/map/nli-people-marker-filter.js";

function setup(options = {}) {
  const map = createFakeMapLibreMap({
    layers: [
      { id: "nli-people", type: "circle", source: "nli.people" },
      { id: "projector_base__׳™׳©׳•׳‘׳™׳__fill", type: "fill" },
      { id: "projector_base__׳©׳׳•׳×_׳™׳™׳©׳•׳‘׳™׳__symbol", type: "symbol" },
    ],
  });
  map.flyTo = vi.fn();
  map.fitBounds = vi.fn();
  map.stop = vi.fn();
  map.setFilter = vi.fn();
  const presentation = { close: vi.fn(() => true) };
  const personVisual = { hide: vi.fn() };
  const viewportSync = { beginCameraTravel: vi.fn() };
  const closeArchive = vi.fn();
  const syncTimeline = options.syncTimeline ?? vi.fn();
  const listeners = new Map();
  const dataContext = {
    getBounds: () => options.bounds ?? null,
    getEscapeOverlay: () => options.overlay ?? { mor: false },
    getInvestigationClock: () => options.clock ?? { phase: "idle" },
    correctedNow: () => 0,
    subscribe: (topic, listener) => {
      listeners.set(topic, listener);
      return () => listeners.delete(topic);
    },
  };
  return import("../../frontend/src/map/nli-narrative-controller.js").then(({ createGisNarrativeController }) => ({
    map, presentation, personVisual, viewportSync, closeArchive, listeners,
    syncTimeline,
    controller: createGisNarrativeController({
      map, dataContext, viewportSync, personVisual,
      presentation, closeArchive, storage: options.storage ?? { getItem: () => null, setItem: vi.fn() }, syncTimeline,
      onStyleLoadOverlay: options.onStyleLoadOverlay,
    }),
  }));
}

function novaStoryBoundsFit({ center, zoom, width = 1280, height = 720, margin = 80 }) {
  const worldSize = 512 * 2 ** zoom;
  const project = ([longitude, latitude]) => [
    ((longitude + 180) / 360) * worldSize,
    ((1 - Math.asinh(Math.tan((latitude * Math.PI) / 180)) / Math.PI) / 2) * worldSize,
  ];
  const centerPx = project(center);
  const bounds = [
    [34.43155, 31.39216],
    [34.47999, 31.41402],
  ].map(project);
  const minX = Math.min(...bounds.map(([x]) => x)) - centerPx[0] + width / 2;
  const maxX = Math.max(...bounds.map(([x]) => x)) - centerPx[0] + width / 2;
  const minY = Math.min(...bounds.map(([, y]) => y)) - centerPx[1] + height / 2;
  const maxY = Math.max(...bounds.map(([, y]) => y)) - centerPx[1] + height / 2;
  return minX >= margin && maxX <= width - margin && minY >= margin && maxY <= height - margin;
}

describe("GIS Segev narrative scene", () => {
  test("activates the registry-defined marker, settlement focus, and exact safe camera", async () => {
    const d = await setup();
    d.controller.apply({ id: "segev", transition: "enter", revision: 1 });
    expect(d.viewportSync.beginCameraTravel).toHaveBeenCalledWith("narrative-segev");
    expect(d.map.flyTo).toHaveBeenCalledWith({ center: NLI_NARRATIVES.segev.center, zoom: 18, essential: true, duration: 1600 });
    expect(d.personVisual.hide).toHaveBeenCalled();
    expect(d.closeArchive).toHaveBeenCalled();
    expect(d.map.getLayer("nli-narrative-focus-halo")).toBeTruthy();
    expect(d.map.getLayer("nli-narrative-focus-label").paint["text-halo-color"]).toBe("#000000");
    expect(d.syncTimeline).toHaveBeenCalled();
    expect(d.controller.isActive()).toBe(true);
  });

  test("initial inactive scene does not move, while exit restores bounds center or fallback once", async () => {
    const d = await setup({ bounds: { west: 34, east: 35, south: 31, north: 32 } });
    d.controller.apply({ id: null, transition: "initial", revision: 0 });
    expect(d.map.flyTo).not.toHaveBeenCalled();
    d.controller.apply({ id: "segev", transition: "enter", revision: 1 });
    d.controller.apply({ id: null, transition: "exit", revision: 2 });
    expect(d.presentation.close).toHaveBeenCalledTimes(2);
    expect(d.viewportSync.beginCameraTravel).toHaveBeenLastCalledWith("narrative-exit");
    expect(d.viewportSync.beginCameraTravel.mock.invocationCallOrder.at(-1))
      .toBeLessThan(d.map.flyTo.mock.invocationCallOrder.at(-1));
    expect(d.map.flyTo).toHaveBeenLastCalledWith({ center: [34.5, 31.5], zoom: 10, essential: true, duration: 1600 });
    d.controller.apply({ id: null, transition: "exit", revision: 2 });
    expect(d.map.flyTo).toHaveBeenCalledTimes(2);
  });

  test("rapid enter then exit stops stale travel and style reconstruction keeps only the latest scene", async () => {
    const d = await setup();
    d.controller.apply({ id: "segev", transition: "enter", revision: 1 });
    d.controller.apply({ id: null, transition: "exit", revision: 2 });
    expect(d.map.stop).toHaveBeenCalledTimes(2);
    d.map.wipeStyle();
    d.controller.onStyleLoad();
    expect(d.map.getLayer("nli-narrative-focus-halo")).toBeNull();
  });

  test("presentation closure while active leaves the scene untouched", async () => {
    const d = await setup();
    d.controller.apply({ id: "segev", transition: "enter", revision: 1 });
    d.map.flyTo.mockClear(); d.map.stop.mockClear(); d.personVisual.hide.mockClear();
    d.presentation.close();
    expect(d.map.flyTo).not.toHaveBeenCalled();
    expect(d.map.stop).not.toHaveBeenCalled();
    expect(d.personVisual.hide).not.toHaveBeenCalled();
    expect(d.controller.isActive()).toBe(true);
  });

  test("an already handled active reconnect restores focus without reflying", async () => {
    const d = await setup({ storage: { getItem: () => "4", setItem: vi.fn() } });
    d.controller.apply({ id: "segev", transition: "enter", revision: 4 });
    expect(d.map.flyTo).not.toHaveBeenCalled();
    expect(d.map.getLayer("nli-narrative-focus-halo")).toBeTruthy();
    expect(d.controller.isActive()).toBe(true);
  });

  test("repeated apply of the same active revision never reflys after entry", async () => {
    const d = await setup();
    d.controller.apply({ id: "segev", transition: "enter", revision: 7 });
    expect(d.map.flyTo).toHaveBeenCalledTimes(1);
    d.controller.apply({ id: "segev", transition: "enter", revision: 7 });
    expect(d.map.flyTo).toHaveBeenCalledTimes(1);
    expect(d.controller.isActive()).toBe(true);
  });

  test("idempotently closes the archive presentation on entry, replacement, and exit", async () => {
    const d = await setup();
    d.controller.apply({ id: "segev", transition: "enter", revision: 1 });
    d.controller.apply({ id: "segev", transition: "replace", revision: 2 });
    d.controller.apply({ id: null, transition: "exit", revision: 3 });
    expect(d.presentation.close).toHaveBeenCalledTimes(3);
    expect(d.closeArchive).toHaveBeenCalledTimes(3);
  });

  test("Nova entry keeps the original close zoom 15 camera", async () => {
    const d = await setup();
    d.controller.apply({ id: "nova", transition: "enter", revision: 1 });
    expect(d.viewportSync.beginCameraTravel).toHaveBeenCalledWith("narrative-nova");
    expect(d.map.flyTo).toHaveBeenCalledWith({ center: NLI_NARRATIVES.nova.center, zoom: 15, essential: true, duration: 1600 });
    expect(d.map.fitBounds).not.toHaveBeenCalled();
    expect(d.map.setFilter).toHaveBeenCalledWith("nli-people", NOVA_PEOPLE_FILTER);
  });

  test("Nova beat 4 keeps the pan, zooms out, and fits all first four story beats", async () => {
    const d = await setup();
    d.controller.apply({ id: "nova", transition: "enter", revision: 1 });
    d.map.flyTo.mockClear();
    d.controller.syncInvestigationClock({ phase: "paused", beats: NLI_NOVA_STORY.representativeMinutes, positionMs: 3 * 4000 }, 0);
    expect(d.map.flyTo).toHaveBeenCalledWith({ zoom: NLI_NARRATIVES.nova.beat4Zoom, essential: true, duration: 1000 });
    expect(novaStoryBoundsFit({ center: NLI_NARRATIVES.nova.center, zoom: NLI_NARRATIVES.nova.beat4Zoom })).toBe(true);

    d.map.flyTo.mockClear();
    d.controller.syncInvestigationClock({ phase: "paused", beats: NLI_NOVA_STORY.representativeMinutes, positionMs: 3 * 4000 + 500 }, 0);
    expect(d.map.flyTo).not.toHaveBeenCalled();
    d.controller.syncInvestigationClock({ phase: "paused", beats: NLI_NOVA_STORY.representativeMinutes, positionMs: 4 * 4000 }, 0);
    expect(d.map.flyTo).not.toHaveBeenCalled();
  });

  test("Nova opened on beat 4 starts at the original center with a slightly wider frame", async () => {
    const d = await setup({
      clock: { phase: "paused", beats: NLI_NOVA_STORY.representativeMinutes, positionMs: 3 * 4000 },
    });
    d.controller.apply({ id: "nova", transition: "enter", revision: 1 });
    expect(d.map.flyTo).toHaveBeenCalledTimes(1);
    expect(d.map.flyTo).toHaveBeenCalledWith({ center: NLI_NARRATIVES.nova.center, zoom: NLI_NARRATIVES.nova.beat4Zoom, essential: true, duration: 1600 });
  });

  test("returning to a Nova beat before Argamani restores the close camera", async () => {
    const d = await setup();
    d.controller.apply({ id: "nova", transition: "enter", revision: 1 });
    d.controller.syncInvestigationClock({ phase: "paused", beats: NLI_NOVA_STORY.representativeMinutes, positionMs: 3 * 4000 }, 0);
    d.map.flyTo.mockClear();
    d.controller.syncInvestigationClock({ phase: "paused", beats: NLI_NOVA_STORY.representativeMinutes, positionMs: 2 * 4000 }, 0);
    expect(d.map.flyTo).toHaveBeenCalledWith({ center: NLI_NARRATIVES.nova.center, zoom: 15, essential: true, duration: 1000 });
  });

  test("Mor overlay fits the route and closing it restores Nova camera", async () => {
    const d = await setup();
    d.controller.apply({ id: "nova", transition: "enter", revision: 1 });
    d.map.fitBounds.mockClear();
    d.map.flyTo.mockClear();
    d.listeners.get("escapeOverlay")({ mor: true });
    expect(d.map.fitBounds).toHaveBeenCalledWith(
      [[34.466, 31.350], [34.499, 31.400]],
      expect.objectContaining({ padding: 48, essential: true, duration: 1000 }),
    );
    d.listeners.get("escapeOverlay")({ mor: false });
    expect(d.map.flyTo).toHaveBeenLastCalledWith({ center: NLI_NARRATIVES.nova.center, zoom: 15, essential: true, duration: 1000 });
  });

  test("Mor route restores the Argamani frame when its overlay closes on beat 4", async () => {
    const d = await setup();
    d.controller.apply({ id: "nova", transition: "enter", revision: 1 });
    d.controller.syncInvestigationClock({ phase: "paused", beats: NLI_NOVA_STORY.representativeMinutes, positionMs: 3 * 4000 }, 0);
    d.listeners.get("escapeOverlay")({ mor: true });
    d.map.flyTo.mockClear();
    d.listeners.get("escapeOverlay")({ mor: false });
    expect(d.map.flyTo).toHaveBeenCalledWith({ center: NLI_NARRATIVES.nova.center, zoom: NLI_NARRATIVES.nova.beat4Zoom, essential: true, duration: 1000 });
  });

  test("Nova without flyTo leaves the camera untouched", async () => {
    const d = await setup();
    d.map.flyTo = undefined;
    expect(() => d.controller.apply({ id: "nova", transition: "enter", revision: 1 })).not.toThrow();
    expect(d.map.fitBounds).not.toHaveBeenCalled();
  });

  test("Nova beat changes during timeline resync do not issue camera commands", async () => {
    let beat = 492;
    const observedBeats = [];
    const syncTimeline = vi.fn(() => observedBeats.push(beat));
    const d = await setup({ syncTimeline });
    d.controller.apply({ id: "nova", transition: "enter", revision: 1 });
    expect(observedBeats).toEqual([492]);
    d.map.fitBounds.mockClear();
    d.map.flyTo.mockClear();
    beat = 506;
    d.controller.apply({ id: "nova", transition: "enter", revision: 1 });
    expect(observedBeats).toEqual([492, 506]);
    expect(d.map.fitBounds).not.toHaveBeenCalled();
    expect(d.map.flyTo).not.toHaveBeenCalled();
  });

  test("Nova victim filter is reapplied after style reconstruction and cleared on exit", async () => {
    const d = await setup();
    d.controller.apply({ id: "nova", transition: "enter", revision: 1 });
    d.map.setFilter.mockClear();
    d.map.wipeStyle();
    d.map.addLayer({ id: "nli-people", type: "circle", source: "nli.people" });
    d.controller.onStyleLoad();
    expect(d.map.setFilter).toHaveBeenCalledWith("nli-people", NOVA_PEOPLE_FILTER);

    d.controller.apply({ id: null, transition: "exit", revision: 2 });
    expect(d.map.setFilter).toHaveBeenLastCalledWith("nli-people", EXCLUDE_SURVIVOR_FILTER);
    d.map.setFilter.mockClear();
    d.controller.onStyleLoad();
    expect(d.map.setFilter).toHaveBeenCalledWith("nli-people", EXCLUDE_SURVIVOR_FILTER);
  });

  test("already handled Nova reconnect remounts focus without a second flyTo", async () => {
    const d = await setup({ storage: { getItem: () => "4", setItem: vi.fn() } });
    d.map.fitBounds = vi.fn();
    d.controller.apply({ id: "nova", transition: "enter", revision: 4 });
    expect(d.map.fitBounds).not.toHaveBeenCalled();
    expect(d.map.flyTo).not.toHaveBeenCalled();
  });

  test("already handled exit clears the definition and syncs without replaying side effects", async () => {
    const d = await setup({ storage: { getItem: () => "4", setItem: vi.fn() } });
    d.controller.apply({ id: null, transition: "exit", revision: 4 });
    expect(d.controller.getDefinition()).toBeNull();
    expect(d.syncTimeline).toHaveBeenCalledTimes(1);
    expect(d.map.flyTo).not.toHaveBeenCalled();
    expect(d.presentation.close).not.toHaveBeenCalled();
    expect(d.closeArchive).not.toHaveBeenCalled();
    expect(d.personVisual.hide).not.toHaveBeenCalled();
  });

  test("handled active and exit revisions restore timeline identity without camera flights", async () => {
    const timelineIds = [];
    const d = await setup({
      storage: { getItem: () => "8", setItem: vi.fn() },
      syncTimeline: vi.fn(() => timelineIds.push(d.controller.getDefinition()?.id ?? null)),
    });
    d.controller.apply({ id: "nova", transition: "enter", revision: 7 });
    d.controller.apply({ id: null, transition: "exit", revision: 8 });
    expect(timelineIds).toEqual(["nova", null]);
    expect(d.map.flyTo).not.toHaveBeenCalled();
  });

  test("GIS onStyleLoad calls onStyleLoadOverlay", async () => {
    const onStyleLoadOverlay = vi.fn();
    const d = await setup({ onStyleLoadOverlay });
    d.controller.apply({ id: "nova", transition: "enter", revision: 1 });
    onStyleLoadOverlay.mockClear();
    d.controller.onStyleLoad();
    expect(onStyleLoadOverlay).toHaveBeenCalledTimes(1);
  });

  test("GIS map-main overlay remount passes styleLoss true", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile(
      new URL("../../frontend/src/entries/map-main.js", import.meta.url),
      "utf8",
    );
    expect(source).toMatch(
      /onStyleLoadOverlay:\s*\(\)\s*=>\s*\{\s*novaEscapeCoordinator\?\.onStyleLoad\?\.\(\{\s*styleLoss:\s*true\s*\}\)/,
    );
  });

  test("Sderot flies to the settlement at zoom 15 and marks the police station", async () => {
    const d = await setup();
    d.controller.apply({ id: "sderot", transition: "enter", revision: 1 });
    expect(d.viewportSync.beginCameraTravel).toHaveBeenCalledWith("narrative-sderot");
    expect(d.map.flyTo).toHaveBeenCalledWith({
      center: NLI_NARRATIVES.sderot.center,
      zoom: 15,
      essential: true,
      duration: 1600,
    });
    expect(d.map.flyTo.mock.calls[0][0].center).not.toEqual(NLI_NARRATIVES.sderot.marker);
    const focus = d.map.getSource("nli-narrative-focus")?.data?.features?.[0];
    expect(focus?.geometry?.coordinates).toEqual(NLI_NARRATIVES.sderot.marker);
    expect(focus?.properties?.label).toBe("תחנת המשטרה");
  });

  test("Hostages flies to Nir Oz at zoom 15 and marks בית משפחת פרי", async () => {
    const d = await setup();
    d.controller.apply({ id: "hostages", transition: "enter", revision: 1 });
    expect(d.viewportSync.beginCameraTravel).toHaveBeenCalledWith("narrative-hostages");
    expect(d.map.flyTo).toHaveBeenCalledWith({
      center: NLI_NARRATIVES.hostages.center,
      zoom: 15,
      essential: true,
      duration: 1600,
    });
    const focus = d.map.getSource("nli-narrative-focus")?.data?.features?.[0];
    expect(focus?.geometry?.coordinates).toEqual(NLI_NARRATIVES.hostages.marker);
    expect(focus?.properties?.label).toBe("בית משפחת פרי");
  });

  test("replacing Sderot with Hostages flies to Nir Oz and marks בית משפחת פרי", async () => {
    const d = await setup();
    d.controller.apply({ id: "sderot", transition: "enter", revision: 1 });
    d.controller.apply({ id: "hostages", transition: "replace", revision: 2 });
    expect(d.map.flyTo).toHaveBeenNthCalledWith(2, {
      center: NLI_NARRATIVES.hostages.center,
      zoom: 15,
      essential: true,
      duration: 1600,
    });
    const focus = d.map.getSource("nli-narrative-focus")?.data?.features?.[0];
    expect(focus?.geometry?.coordinates).toEqual(NLI_NARRATIVES.hostages.marker);
  });
});
