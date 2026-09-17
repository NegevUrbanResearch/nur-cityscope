import { describe, expect, test, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { NLI_NARRATIVES } from "../../frontend/src/shared/nli-narratives.js";
import { NOVA_MARKER_FILTER } from "../../frontend/src/map/nli-nova-marker-filter.js";

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
  return import("../../frontend/src/map/nli-narrative-controller.js").then(({ createGisNarrativeController }) => ({
    map, presentation, personVisual, viewportSync, closeArchive,
    syncTimeline,
    controller: createGisNarrativeController({
      map, dataContext: { getBounds: () => options.bounds ?? null }, viewportSync, personVisual,
      presentation, closeArchive, storage: options.storage ?? { getItem: () => null, setItem: vi.fn() }, syncTimeline,
      onStyleLoadOverlay: options.onStyleLoadOverlay,
    }),
  }));
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

  test("Nova flies to the site at zoom 15 and does not fitBounds", async () => {
    const d = await setup();
    d.map.fitBounds = vi.fn();
    d.controller.apply({ id: "nova", transition: "enter", revision: 1 });
    expect(d.viewportSync.beginCameraTravel).toHaveBeenCalledWith("narrative-nova");
    expect(d.map.flyTo).toHaveBeenCalledWith({
      center: NLI_NARRATIVES.nova.center,
      zoom: 15,
      essential: true,
      duration: 1600,
    });
    expect(d.map.fitBounds).not.toHaveBeenCalled();
    expect(d.map.setFilter).toHaveBeenCalledWith("nli-people", NOVA_MARKER_FILTER);
  });

  test("Nova victim filter is reapplied after style reconstruction and cleared on exit", async () => {
    const d = await setup();
    d.controller.apply({ id: "nova", transition: "enter", revision: 1 });
    d.map.setFilter.mockClear();
    d.map.wipeStyle();
    d.map.addLayer({ id: "nli-people", type: "circle", source: "nli.people" });
    d.controller.onStyleLoad();
    expect(d.map.setFilter).toHaveBeenCalledWith("nli-people", NOVA_MARKER_FILTER);

    d.controller.apply({ id: null, transition: "exit", revision: 2 });
    expect(d.map.setFilter).toHaveBeenLastCalledWith("nli-people", null);
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
      /onStyleLoadOverlay:\s*\(\)\s*=>\s*novaEscapeCoordinator\?\.onStyleLoad\?\.\(\{\s*styleLoss:\s*true\s*\}\)/,
    );
  });
});
