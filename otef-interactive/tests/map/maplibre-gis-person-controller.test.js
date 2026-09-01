import { describe, expect, test, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import {
  createGisPersonController,
  isPeopleLayerEnabled,
  resolveGisPersonHit,
} from "../../frontend/src/map/maplibre-gis-person-controller.js";
import { attachGisFeaturePopups } from "../../frontend/src/map/maplibre-gis-popups.js";

const person = (pid = "p-1") => ({
  pid,
  coordinates: [34.5, 31.4],
  name: `Person ${pid}`,
  location: "Gaza envelope",
});

function setup({ selection = {}, snapshot = { personId: null, datasetVersion: null, revision: 0 }, groups } = {}) {
  const map = createFakeMapLibreMap();
  map.queryRenderedFeatures = vi.fn(() => []);
  const state = { snapshot, groups: groups || [{ id: "nli", layers: [{ id: "people", enabled: true }] }] };
  const listeners = new Map();
  const context = {
    getPersonSelection: vi.fn(() => state.snapshot),
    getLayerGroups: vi.fn(() => state.groups),
    subscribe: vi.fn((key, callback) => {
      listeners.set(key, callback);
      return () => listeners.delete(key);
    }),
    selectPerson: vi.fn(async () => ({ ok: true })),
    clearPerson: vi.fn(async () => ({ ok: true })),
  };
  const visual = {
    load: vi.fn(async () => ({ datasetVersion: "v1" })),
    resolve: vi.fn(async (pid, version) => version === "v1" ? person(pid) : null),
    show: vi.fn(),
    hide: vi.fn(),
    isInsidePaddedViewport: vi.fn(() => true),
    dispose: vi.fn(),
    ...selection,
  };
  const controller = createGisPersonController({ map, context, visual });
  const emit = (key, value) => {
    state[key === "personSelection" ? "snapshot" : "groups"] = value;
    listeners.get(key)?.(value);
  };
  return { map, context, visual, controller, emit };
}

function setupImmediate({ snapshot, groups }) {
  const d = setup({ snapshot, groups });
  const originalSubscribe = d.context.subscribe;
  d.context.subscribe = vi.fn((key, callback) => {
    const dispose = originalSubscribe(key, callback);
    callback(key === "personSelection" ? d.context.getPersonSelection() : d.context.getLayerGroups());
    return dispose;
  });
  d.controller.dispose();
  d.controller = createGisPersonController({ map: d.map, context: d.context, visual: d.visual });
  return d;
}

describe("GIS person hit resolution", () => {
  test("requires the exact nli.people source and a PID", () => {
    expect(resolveGisPersonHit([
      { source: "nli.people_names", properties: { pid: "p-0" } },
      { source: "nli.people", properties: { pid: "p-1" } },
    ])).toMatchObject({ source: "nli.people", properties: { pid: "p-1" } });
    expect(resolveGisPersonHit([{ source: "nli.people", properties: {} }])).toBeNull();
    expect(resolveGisPersonHit([{ source: "nli.people_names", properties: { pid: "p-1" } }])).toBeNull();
  });

  test("recognizes only an enabled nli.people layer", () => {
    expect(isPeopleLayerEnabled([{ id: "nli", layers: [{ id: "people", enabled: true }] }])).toBe(true);
    expect(isPeopleLayerEnabled([{ id: "nli", layers: [{ id: "people", enabled: false }] }])).toBe(false);
    expect(isPeopleLayerEnabled([{ id: "other", layers: [{ id: "people", enabled: true }] }])).toBe(false);
  });
});

describe("GIS person controller", () => {
  test("loads the runtime version and sends exact PID selection without optimistic rendering", async () => {
    const d = setup();
    d.map.queryRenderedFeatures.mockReturnValue([{ source: "nli.people", properties: { pid: 7 } }]);
    d.controller.handleMapClick({ point: { x: 10, y: 12 }, lngLat: [34.5, 31.4] });
    await Promise.resolve();
    expect(d.context.selectPerson).toHaveBeenCalledWith("7", "v1");
    expect(d.visual.show).not.toHaveBeenCalled();
    d.emit("personSelection", { personId: "7", datasetVersion: "v1", revision: 1 });
    await Promise.resolve();
    expect(d.visual.show).toHaveBeenCalledWith(expect.objectContaining({ pid: "7" }), expect.objectContaining({ focus: true }));
  });

  test("hydrates an acknowledged selection through the exact local dataset version", async () => {
    const d = setup({ snapshot: { personId: "p-2", datasetVersion: "v1", revision: 4 } });
    d.emit("personSelection", { personId: "p-2", datasetVersion: "v1", revision: 4 });
    await Promise.resolve();
    expect(d.visual.resolve).toHaveBeenCalledWith("p-2", "v1");
    expect(d.visual.show).toHaveBeenCalledWith(expect.objectContaining({ pid: "p-2" }), expect.objectContaining({ focus: true }));
  });

  test("empty space and another feature hide immediately and clear the acknowledged state", () => {
    const d = setup({ snapshot: { personId: "p-1", datasetVersion: "v1", revision: 2 } });
    d.map.queryRenderedFeatures.mockReturnValue([{ source: "nli.nli_catalog", properties: {} }]);
    d.controller.handleMapClick({ point: { x: 1, y: 2 } });
    expect(d.visual.hide).toHaveBeenCalled();
    expect(d.context.clearPerson).toHaveBeenCalledTimes(1);
    d.controller.handleMapClick({ point: { x: 1, y: 2 } });
    expect(d.context.clearPerson).toHaveBeenCalledTimes(1);
  });

  test("a people hit outranks an overlapping non-person feature", async () => {
    const d = setup();
    d.map.queryRenderedFeatures.mockReturnValue([
      { source: "nli.nli_catalog", properties: { pid: "wrong" } },
      { source: "nli.people", properties: { pid: "p-3" } },
    ]);
    d.controller.handleMapClick({ point: { x: 1, y: 2 } }, d.map.queryRenderedFeatures());
    await Promise.resolve();
    expect(d.context.selectPerson).toHaveBeenCalledWith("p-3", "v1");
    expect(d.context.clearPerson).not.toHaveBeenCalled();
  });

  test("hidden people layer blocks only a new local people hit", async () => {
    const d = setup({ groups: [{ id: "nli", layers: [{ id: "people", enabled: false }] }] });
    const features = [{ source: "nli.people", properties: { pid: "p-hidden" } }];
    expect(d.controller.handleMapClick({ point: { x: 1, y: 2 } }, features)).toBe(false);
    await Promise.resolve();
    expect(d.context.selectPerson).not.toHaveBeenCalled();
    expect(d.context.clearPerson).not.toHaveBeenCalled();
  });

  test("resolves and preserves acknowledged shared selection while the people layer is hidden", async () => {
    const d = setup({
      snapshot: { personId: "p-1", datasetVersion: "v1", revision: 2 },
      groups: [{ id: "nli", layers: [{ id: "people", enabled: false }] }],
    });
    d.emit("personSelection", d.context.getPersonSelection());
    await Promise.resolve();
    expect(d.visual.resolve).toHaveBeenCalledWith("p-1", "v1");
    expect(d.visual.show).toHaveBeenCalled();
    d.context.clearPerson.mockClear();
    d.visual.hide.mockClear();
    d.emit("layerGroups", [{ id: "nli", layers: [{ id: "people", enabled: true }] }]);
    d.emit("layerGroups", [{ id: "nli", layers: [{ id: "people", enabled: false }] }]);
    expect(d.context.clearPerson).not.toHaveBeenCalled();
    expect(d.visual.hide).not.toHaveBeenCalled();
    expect(d.visual.show).toHaveBeenCalled();
  });

  test("initial visibility is established before an immediate selection callback", async () => {
    const d = setupImmediate({
      snapshot: { personId: "p-1", datasetVersion: "v1", revision: 2 },
      groups: [{ id: "nli", layers: [{ id: "people", enabled: false }] }],
    });
    await Promise.resolve();
    expect(d.context.clearPerson).not.toHaveBeenCalled();
    expect(d.visual.resolve).toHaveBeenCalledWith("p-1", "v1");
    expect(d.visual.show).toHaveBeenCalled();
  });

  test("shares one map click arbiter across person, non-person, and empty paths", async () => {
    const d = setup({ snapshot: { personId: "p-4", datasetVersion: "v1", revision: 4 } });
    const order = [];
    d.context.clearPerson.mockImplementation(async () => {
      order.push("clearPerson");
      return { ok: true };
    });
    const popup = {
      remove: vi.fn(),
      setLngLat: vi.fn().mockReturnThis(),
      setHTML: vi.fn(() => { order.push("setHTML"); return popup; }),
      addTo: vi.fn().mockReturnThis(),
    };
    d.map.queryRenderedFeatures
      .mockReturnValueOnce([{ source: "nli.people", properties: { pid: "p-4" } }])
      .mockReturnValueOnce([{ source: "nli.nli_catalog", properties: { name_he: "ordinary" } }])
      .mockReturnValueOnce([]);
    const dispose = attachGisFeaturePopups(d.map, { Popup: vi.fn(function Popup() { return popup; }) }, {
      onGisClick: d.controller.handleMapClick,
      getLayerConfig: () => ({ ui: { popup: { fields: [{ key: "name_he" }] } } }),
    });
    expect(d.map.listenerCount("click")).toBe(1);
    d.map.emit("click", { point: { x: 1, y: 2 }, lngLat: [34.5, 31.4] });
    await Promise.resolve();
    expect(d.context.selectPerson).toHaveBeenCalledWith("p-4", "v1");
    d.map.emit("click", { point: { x: 1, y: 2 }, lngLat: [34.5, 31.4] });
    expect(popup.setHTML).toHaveBeenCalled();
    expect(order).toEqual(["clearPerson", "setHTML"]);
    d.map.emit("click", { point: { x: 1, y: 2 }, lngLat: [34.5, 31.4] });
    expect(d.visual.hide).toHaveBeenCalled();
    dispose();
    d.controller.dispose();
  });

  test("stale hydration cannot render an older replacement", async () => {
    const releases = [];
    const d = setup({ selection: { resolve: vi.fn((pid) => new Promise((resolve) => releases.push({ pid, resolve }))) } });
    d.emit("personSelection", { personId: "p-1", datasetVersion: "v1", revision: 1 });
    d.emit("personSelection", { personId: "p-2", datasetVersion: "v1", revision: 2 });
    releases.find((entry) => entry.pid === "p-1").resolve(person("p-1"));
    await Promise.resolve();
    expect(d.visual.show).not.toHaveBeenCalled();
    releases.find((entry) => entry.pid === "p-2").resolve(person("p-2"));
    await Promise.resolve();
    expect(d.visual.show).toHaveBeenCalledWith(expect.objectContaining({ pid: "p-2" }), expect.any(Object));
  });

  test("movement clears only when the selected point leaves the padded viewport", async () => {
    const d = setup({ snapshot: { personId: "p-1", datasetVersion: "v1", revision: 2 } });
    d.emit("personSelection", { personId: "p-1", datasetVersion: "v1", revision: 2 });
    await Promise.resolve();
    d.map.emit("moveend");
    d.visual.isInsidePaddedViewport.mockReturnValueOnce(true).mockReturnValueOnce(false);
    d.map.emit("moveend");
    expect(d.context.clearPerson).not.toHaveBeenCalled();
    d.map.emit("moveend");
    expect(d.context.clearPerson).toHaveBeenCalledTimes(1);
  });

  test("a camera move caused by remote focus does not clear the selection", async () => {
    const d = setup({ snapshot: { personId: "p-1", datasetVersion: "v1", revision: 2 } });
    d.emit("personSelection", { personId: "p-1", datasetVersion: "v1", revision: 2 });
    await Promise.resolve();
    d.visual.isInsidePaddedViewport.mockReturnValue(false);
    d.map.emit("moveend");
    expect(d.context.clearPerson).not.toHaveBeenCalled();
  });

  test("disabling the full people layer does not hide or clear shared selection", () => {
    const d = setup({ snapshot: { personId: "p-1", datasetVersion: "v1", revision: 2 } });
    d.emit("layerGroups", [{ id: "nli", layers: [{ id: "people", enabled: false }] }]);
    expect(d.visual.hide).not.toHaveBeenCalled();
    expect(d.context.clearPerson).not.toHaveBeenCalled();
    d.emit("layerGroups", [{ id: "nli", layers: [{ id: "people", enabled: false }] }]);
    expect(d.context.clearPerson).not.toHaveBeenCalled();
    expect(d.visual.hide).not.toHaveBeenCalled();
  });

  test("disposal removes listeners and blocks late selection work", async () => {
    const d = setup();
    d.controller.dispose();
    d.map.emit("click", { point: { x: 1, y: 2 } });
    d.emit("personSelection", { personId: "p-9", datasetVersion: "v1", revision: 9 });
    await Promise.resolve();
    expect(d.context.selectPerson).not.toHaveBeenCalled();
    expect(d.visual.show).not.toHaveBeenCalled();
    expect(d.visual.dispose).toHaveBeenCalledTimes(1);
    expect(d.map.listenerCount("click")).toBe(0);
    expect(d.map.listenerCount("moveend")).toBe(0);
  });
});
