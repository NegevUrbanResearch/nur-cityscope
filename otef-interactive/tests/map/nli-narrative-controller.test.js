import { describe, expect, test, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { NLI_NARRATIVES } from "../../frontend/src/shared/nli-narratives.js";

function setup(options = {}) {
  const map = createFakeMapLibreMap({
    layers: [
      { id: "projector_base__׳™׳©׳•׳‘׳™׳__fill", type: "fill" },
      { id: "projector_base__׳©׳׳•׳×_׳™׳™׳©׳•׳‘׳™׳__symbol", type: "symbol" },
    ],
  });
  map.flyTo = vi.fn();
  map.stop = vi.fn();
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
});
