import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";

vi.mock("../../frontend/src/shared/nli-name-field-data.js", () => ({
  loadNliNameField: vi.fn(),
}));

const { createNliNameFieldController } = await import("../../frontend/src/shared/nli-name-field-controller.js");
const { loadNliNameField } = await import("../../frontend/src/shared/nli-name-field-data.js");

const field = (datasetVersion = "v1") => ({
  geojson: {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { pid: "p-1", name: "One", location: "A" }, geometry: { type: "Point", coordinates: [10, 20] } },
      { type: "Feature", properties: { pid: "p-2", name: "Two", location: "B" }, geometry: { type: "Point", coordinates: [30, 40] } },
    ],
  },
  byPid: new Map([
    ["p-1", { feature: { type: "Feature", properties: { pid: "p-1", name: "One", location: "A" }, geometry: { type: "Point", coordinates: [10, 20] } }, sourceCoordinates: [1, 2] }],
    ["p-2", { feature: { type: "Feature", properties: { pid: "p-2", name: "Two", location: "B" }, geometry: { type: "Point", coordinates: [30, 40] } }, sourceCoordinates: [3, 4] }],
  ]),
  referenceZoom: 10,
  fontSize: 12,
  heading: 41,
  diagnostics: { placed: 2, total: 2, unplaced: [] },
  datasetVersion,
});
const groupedField = () => {
  const data = field();
  data.geojson.features[0].properties.group_id = 'nova';
  data.geojson.features[1].properties.group_id = 'beeri';
  data.groupGeojson = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { group_id: 'nova', name: 'נובה', place_ids: ['custom-reim-parking'], visible_spans: ['left'] }, geometry: { type: 'Point', coordinates: [11, 21] } },
    { type: 'Feature', properties: { group_id: 'beeri', name: 'בארי', place_ids: ['yeshuv-0399'], visible_spans: ['right'] }, geometry: { type: 'Point', coordinates: [31, 41] } },
  ] };
  return data;
};

function setup({ profile = "projection", projectionSpan, motionMode = "reduced", snapshot = { personId: null, datasetVersion: null, revision: 0 } } = {}) {
  const map = createFakeMapLibreMap({ layers: [
    { id: "nli__people_names__labels", type: "symbol", layout: { visibility: "visible" } },
  ] });
  map.getZoom = vi.fn(() => 10);
  map.getBearing = vi.fn(() => 0);
  map.getPitch = vi.fn(() => 0);
  map.getCenter = vi.fn(() => ({ lng: 34.5, lat: 31.4 }));
  map.stop = vi.fn();
  map.easeTo = vi.fn();
  map.fitBounds = vi.fn();
  map._dataset = {};
  map.getContainer = () => ({ dataset: map._dataset });
  map.setFilter = (id, filter) => { map.getLayer(id).filter = filter; };
  const listeners = new Map();
  const state = { snapshot, groups: [{ id: "nli", layers: [{ id: "people_names", enabled: false }] }] };
  const context = {
    getPersonSelection: vi.fn(() => state.snapshot),
    subscribe: vi.fn((topic, callback) => {
      listeners.set(topic, callback);
      return () => listeners.delete(topic);
    }),
    clearPerson: vi.fn(),
  };
  const emit = (topic, value) => {
    if (topic === "personSelection") state.snapshot = value;
    listeners.get(topic)?.(value);
  };
  const controller = createNliNameFieldController({ map, context, displayProfile: profile, projectionSpan, loadField: loadNliNameField, motionMode });
  return { map, context, controller, emit, state };
}

const enable = (d) => d.controller.sync([{ id: "nli", layers: [{ id: "people_names", enabled: true }] }]);
const disable = (d) => d.controller.sync([{ id: "nli", layers: [{ id: "people_names", enabled: false }] }]);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeEach(() => loadNliNameField.mockReset());
afterEach(() => vi.useRealTimers());

describe("createNliNameFieldController", () => {
  it("dims settlement labels updated during the reveal without waiting for idle", async () => {
    loadNliNameField.mockResolvedValueOnce(field());
    const d = setup();
    const id = 'projector_base__שמות_יישובים__labels';
    enable(d);
    await flush();
    d.map.addLayer({ id, type: 'symbol', paint: { 'text-opacity': 0.8 } });
    d.map.setPaintProperty(id, 'text-opacity', 0.8);
    d.map.emit('styledata');
    expect(d.map.getPaintProperty(id, 'text-opacity')).toBe(0.18);
    d.controller.dispose();
    expect(d.map.getPaintProperty(id, 'text-opacity')).toBe(0.8);
    expect(d.map.listenerCount('styledata')).toBe(0);
  });

  it('retains name layers during a collective exit and cancels removal when enabled again', async () => {
    vi.useFakeTimers();
    loadNliNameField.mockResolvedValueOnce(field());
    const d=setup({motionMode:'full'});
    enable(d); await vi.advanceTimersByTimeAsync(3000);
    disable(d);
    expect(d.map.getLayer('nli-name-field-labels')).toBeTruthy();
    await vi.advanceTimersByTimeAsync(200); enable(d);
    await vi.advanceTimersByTimeAsync(1000);
    expect(d.map.getLayer('nli-name-field-labels')).toBeTruthy();
    disable(d); await vi.advanceTimersByTimeAsync(700);
    expect(d.map.getLayer('nli-name-field-labels')).toBeNull();
    d.controller.dispose(); vi.useRealTimers();
  });
  it('cancels place focus even when person selection was already empty', async () => {
    loadNliNameField.mockResolvedValueOnce(groupedField());
    const d=setup(); enable(d); await flush();
    d.emit('navigationCommand',{placeId:'custom-reim-parking'});
    d.emit('navigationCommand',{cancelFocus:true});
    expect(JSON.parse(d.map._dataset.nliNameField).selectedGroup).toBeNull();
    expect(d.map.getSource('nli-name-place-selection').data.features).toEqual([]);
  });
  it("loads once and never restores legacy overlapping labels", async () => {
    loadNliNameField.mockResolvedValueOnce(field());
    const d = setup();
    enable(d);
    await flush();
    expect(loadNliNameField).toHaveBeenCalledTimes(1);
    expect(d.map.getSource("nli-name-field")).toBeTruthy();
    expect(d.map.getLayer("nli-name-field-labels")).toBeTruthy();
    expect(d.map.getLayer("nli-name-field-labels").layout["text-max-width"]).toBeGreaterThanOrEqual(1000);
    expect(d.map.getLayer("nli-name-field-selected").layout["text-max-width"]).toBeGreaterThanOrEqual(1000);
    expect(d.map.getLayoutProperty("nli__people_names__labels", "visibility")).toBe("none");
    disable(d);
    expect(d.map.getLayer("nli-name-field-labels")).toBeNull();
    expect(d.map.getLayoutProperty("nli__people_names__labels", "visibility")).toBe("none");
  });

  it("does not resurrect a delayed load after disable or dispose", async () => {
    let resolve;
    loadNliNameField.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const d = setup();
    enable(d);
    disable(d);
    resolve(field());
    await flush();
    expect(d.map.getSource("nli-name-field")).toBeNull();
    d.controller.dispose();
    expect(d.map.listenerCount("style.load")).toBe(0);
  });

  it("mounts complete cached geometry when re-enabled after a disabled load finishes", async () => {
    let resolve;
    loadNliNameField.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    const d = setup();
    enable(d);
    await flush();
    disable(d);
    resolve(field());
    await flush();
    enable(d);
    expect(d.map.getSource("nli-name-field").data.features).toHaveLength(2);
    expect(d.map.getLayoutProperty("nli__people_names__labels", "visibility")).toBe("none");
    expect(loadNliNameField).toHaveBeenCalledTimes(1);
  });

  it("scales overview text with zoom and uses comfortable detail text on both labels", async () => {
    loadNliNameField.mockResolvedValueOnce(field());
    const d = setup({ profile: "gis" });
    d.map.getZoom = vi.fn(() => 10);
    enable(d);
    await flush();
    const size = d.map.getLayer("nli-name-field-labels").layout["text-size"];
    expect(size).toEqual(["interpolate", ["exponential", 2], ["zoom"], 0, 12 / 2 ** 10, 24, 12 * 2 ** 14]);
    expect(d.map.getLayer("nli-name-field-selected").layout["text-size"]).toEqual(["interpolate", ["exponential", 2], ["zoom"], 0, 12 / 2 ** 10, 24, 12 * 2 ** 14]);
    expect(d.map.getLayer("nli-name-field-labels").layout["text-allow-overlap"]).toBe(true);
    d.map.getZoom.mockReturnValue(11);
    d.map.emit("zoom");
    expect(d.map.calls).toContainEqual({ method: "setLayoutProperty", id: "nli-name-field-labels", key: "text-size", value: 14 });
    expect(d.map.calls).toContainEqual({ method: "setLayoutProperty", id: "nli-name-field-selected", key: "text-size", value: 16 });
    expect(d.map.calls).toContainEqual({ method: "setLayoutProperty", id: "nli-name-field-labels", key: "text-allow-overlap", value: false });
    expect(d.map.calls).toContainEqual({ method: "setLayoutProperty", id: "nli-name-field-labels", key: "text-ignore-placement", value: false });
    d.map.getZoom.mockReturnValue(9);
    d.map.emit("zoom");
    expect(d.map.calls.filter((call) => call.method === "setLayoutProperty" && call.id === "nli-name-field-selected" && call.key === "text-size").at(-1).value).toEqual(["interpolate", ["exponential", 2], ["zoom"], 0, 12 / 2 ** 10, 24, 12 * 2 ** 14]);
    expect(d.map.calls.filter((call) => call.method === "setLayoutProperty" && call.id === "nli-name-field-labels" && call.key === "text-allow-overlap").at(-1).value).toBe(true);
  });

  it("publishes DOM diagnostics without exposing feature data and clears them on disable", async () => {
    loadNliNameField.mockResolvedValueOnce(field());
    const d = setup({ snapshot: { personId: "p-1", datasetVersion: "v1" } });
    enable(d);
    await flush();
    expect(JSON.parse(d.map._dataset.nliNameField)).toMatchObject({ mode: "display", placed: 2, total: 2, unplaced: 0, selectedPid: "p-1" });
    disable(d);
    expect(d.map._dataset.nliNameField).toBeUndefined();
  });

  it("keeps legacy labels hidden when loading fails", async () => {
    loadNliNameField.mockRejectedValueOnce(new Error("capacity"));
    const d = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    enable(d);
    await flush();
    expect(d.map.getLayoutProperty("nli__people_names__labels", "visibility")).toBe("none");
    expect(d.map.getLayer("nli-name-field-labels")).toBeNull();
    error.mockRestore();
  });

  it("retries a failed field without showing legacy labels", async () => {
    loadNliNameField.mockRejectedValueOnce(new Error("capacity")).mockResolvedValueOnce(field());
    const d = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    enable(d);
    await flush();
    expect(d.map.getLayoutProperty("nli__people_names__labels", "visibility")).toBe("none");
    enable(d);
    await flush();
    expect(loadNliNameField).toHaveBeenCalledTimes(2);
    expect(d.map.getSource("nli-name-field").data.features).toHaveLength(2);
    expect(d.map.getLayoutProperty("nli__people_names__labels", "visibility")).toBe("none");
    error.mockRestore();
  });

  it("removes partially mounted owned resources if MapLibre rejects a layer", async () => {
    loadNliNameField.mockResolvedValueOnce(field());
    const d = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const addLayer = d.map.addLayer.bind(d.map);
    d.map.addLayer = (layer, before) => {
      if (layer.id === "nli-name-field-selected") throw new Error("style changed");
      return addLayer(layer, before);
    };
    enable(d);
    await flush();
    expect(d.map.getLayer("nli-name-field-labels")).toBeNull();
    expect(d.map.getSource("nli-name-field")).toBeNull();
    expect(d.map.getSource("nli-name-field-connector")).toBeNull();
    expect(d.map.getLayoutProperty("nli__people_names__labels", "visibility")).toBe("none");
    error.mockRestore();
  });

  it("remounts on style load using cached geometry and restores selected connector", async () => {
    loadNliNameField.mockResolvedValueOnce(field());
    const d = setup({ snapshot: { personId: "p-2", datasetVersion: "v1" } });
    enable(d);
    await flush();
    d.map.remountStyle({ layers: [{ id: "nli__people_names__labels", type: "symbol" }] });
    expect(loadNliNameField).toHaveBeenCalledTimes(1);
    expect(d.map.getSource("nli-name-field").data.features).toHaveLength(2);
    expect(d.map.getSource("nli-name-field-connector").data.features[0].geometry.coordinates).toEqual([[30, 40], [3, 4]]);
  });

  it("cleans a failed style-load mount and retries on the next sync", async () => {
    loadNliNameField.mockResolvedValueOnce(field());
    const d = setup();
    enable(d);
    await flush();
    const originalAddLayer = d.map.addLayer.bind(d.map);
    let failOnce = true;
    d.map.addLayer = (layer, before) => {
      if (failOnce && layer.id === "nli-name-field-selected") {
        failOnce = false;
        throw new Error("style changed during mount");
      }
      return originalAddLayer(layer, before);
    };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => d.map.remountStyle({ layers: [
      { id: "nli__people_names__labels", type: "symbol", layout: { visibility: "visible" } },
    ] })).not.toThrow();
    expect(d.map.getSource("nli-name-field")).toBeNull();
    expect(d.map.getLayer("nli-name-field-labels")).toBeNull();
    expect(d.map.getLayoutProperty("nli__people_names__labels", "visibility")).toBe("none");
    enable(d);
    expect(d.map.getSource("nli-name-field")).toBeTruthy();
    expect(d.map.getLayer("nli-name-field-selected")).toBeTruthy();
    expect(loadNliNameField).toHaveBeenCalledTimes(1);
    error.mockRestore();
    d.controller.dispose();
  });

  it("does not reload on unrelated sync calls and projection geometry stays fixed", async () => {
    loadNliNameField.mockResolvedValueOnce(field());
    const d = setup({ profile: "projection" });
    enable(d);
    await flush();
    const source = d.map.getSource("nli-name-field");
    const initial = source.data;
    d.controller.sync([{ id: "other", layers: [{ id: "x", enabled: true }] }]);
    d.map.emit("zoom");
    expect(loadNliNameField).toHaveBeenCalledTimes(1);
    expect(source.data).toBe(initial);
  });

  it("switches GIS geometry at the detail threshold and returns to display geometry", async () => {
    loadNliNameField.mockResolvedValueOnce(field());
    const d = setup({ profile: "gis" });
    d.map.getZoom = vi.fn(() => 10);
    enable(d);
    await flush();
    const source = d.map.getSource("nli-name-field");
    expect(source.data.features[0].geometry.coordinates).toEqual([10, 20]);
    d.map.getZoom.mockReturnValue(11);
    d.map.emit("zoom");
    expect(source.data.features[0].geometry.coordinates).toEqual([1, 2]);
    d.map.getZoom.mockReturnValue(9);
    d.map.emit("zoom");
    expect(source.data.features[0].geometry.coordinates).toEqual([10, 20]);
  });

  it("validates selection and draws an exact source connector", async () => {
    loadNliNameField.mockResolvedValueOnce(field());
    const d = setup({ snapshot: { personId: "p-1", datasetVersion: "v1", revision: 1 } });
    enable(d);
    await flush();
    d.emit("personSelection", { personId: "p-1", datasetVersion: "v1", revision: 2 });
    const connector = d.map.getSource("nli-name-field-connector");
    expect(connector.data.features[0].geometry.coordinates).toEqual([[10, 20], [1, 2]]);
    expect(d.map.getLayer("nli-name-field-labels").filter).toEqual(["!=", ["get", "pid"], "p-1"]);
    expect(d.map.getLayer("nli-name-field-selected").filter).toEqual(["==", ["get", "pid"], "p-1"]);
    expect(d.map.getLayer("nli-name-field-selected").paint).toMatchObject({ "text-color": "#ffffff", "text-halo-width": 2 });
    d.emit("personSelection", { personId: "unknown", datasetVersion: "v1", revision: 3 });
    expect(d.map.getLayer("nli-name-field-labels").filter).toBeNull();
    expect(d.map.getLayer("nli-name-field-selected").filter).toEqual(["==", ["get", "pid"], "__none__"]);
    expect(connector.data.features).toHaveLength(0);
    expect(d.context.clearPerson).not.toHaveBeenCalled();
    d.emit("personSelection", { personId: "p-1", datasetVersion: "old", revision: 4 });
    expect(d.context.clearPerson).not.toHaveBeenCalled();
  });

  it("keeps projection span filtering on base and selected labels through selection changes", async () => {
    const data = field();
    data.geojson.features[0].properties.visible_spans = ["left"];
    data.geojson.features[1].properties.visible_spans = ["right"];
    loadNliNameField.mockResolvedValueOnce(data);
    const d = setup({ projectionSpan: "left" });
    enable(d);
    await flush();
    const span = ["in", "left", ["get", "visible_spans"]];
    expect(d.map.getLayer("nli-name-field-labels").filter).toEqual(span);
    expect(d.map.getLayer("nli-name-field-selected").filter).toEqual(["all", span, ["==", ["get", "pid"], "__none__"]]);
    d.emit("personSelection", { personId: "p-1", datasetVersion: "v1" });
    expect(d.map.getLayer("nli-name-field-labels").filter).toEqual(["all", span, ["!=", ["get", "pid"], "p-1"]]);
    expect(d.map.getLayer("nli-name-field-selected").filter).toEqual(["all", span, ["==", ["get", "pid"], "p-1"]]);
    d.emit("personSelection", { personId: null, datasetVersion: "v1" });
    expect(d.map.getLayer("nli-name-field-labels").filter).toEqual(span);
    expect(d.map.getLayer("nli-name-field-selected").filter).toEqual(["all", span, ["==", ["get", "pid"], "__none__"]]);
  });

  it("publishes local diagnostics and reloads without adding listeners", async () => {
    loadNliNameField.mockResolvedValueOnce(field("v1")).mockResolvedValueOnce(field("v2"));
    const d = setup();
    enable(d);
    await flush();
    expect(JSON.parse(d.map._dataset.nliNameField)).toMatchObject({ mode: "display", placed: 2, total: 2 });
    const styleListeners = d.map.listenerCount("style.load");
    d.controller.reload();
    await flush();
    expect(loadNliNameField).toHaveBeenCalledTimes(2);
    expect(d.map.listenerCount("style.load")).toBe(styleListeners);
    d.controller.dispose();
    expect(d.map._dataset.nliNameField).toBeUndefined();
  });
  it('applies a place command received before load, highlights only that group, and clears on person selection', async () => {
    let finishLoad;
    loadNliNameField.mockReturnValueOnce(new Promise(resolve => { finishLoad = resolve; }));
    const d = setup({ projectionSpan: 'left' });
    enable(d);
    await flush();
    d.emit('navigationCommand', { placeId: 'custom-reim-parking' });
    finishLoad(groupedField());
    await flush();
    expect(d.map.getSource('nli-name-place-selection').data.features[0].geometry.coordinates).toEqual([11, 21]);
    expect(d.map.getLayer('nli-name-field-labels').paint['text-color']).toBe('#ffffff');
    expect(d.map.getPaintProperty('nli-name-field-labels', 'text-opacity')).toEqual([
      'case', ['==', ['get', 'group_id'], 'nova'], 1, 0.18,
    ]);
    expect(JSON.parse(d.map._dataset.nliNameField).selectedGroup).toBe('nova');
    d.emit('personSelection', { personId: null, datasetVersion: null, revision: 1 });
    expect(JSON.parse(d.map._dataset.nliNameField).selectedGroup).toBeNull();
    expect(d.map.getSource('nli-name-place-selection').data.features).toEqual([]);
    d.emit('navigationCommand', { placeId: 'custom-reim-parking' });
    d.emit('personSelection', { personId: 'p-1', datasetVersion: 'v1' });
    expect(d.map.getLayer('nli-name-field-labels').paint['text-color']).toBe('#ffffff');
    expect(d.map.getSource('nli-name-place-selection').data.features).toEqual([]);
    expect(JSON.parse(d.map._dataset.nliNameField).selectedGroup).toBeNull();
    d.controller.dispose();
    expect(d.map.getLayer('nli-name-place-selection-label')).toBeNull();
    expect(d.map.getSource('nli-name-place-selection')).toBeNull();
    expect(d.context.subscribe).toHaveBeenCalledWith('navigationCommand', expect.any(Function));
  });

  it('starts the names phase without a previous place highlight after toggling off and on', async () => {
    loadNliNameField.mockResolvedValueOnce(groupedField());
    const d=setup(); enable(d); await flush();
    d.emit('navigationCommand', {placeId:'custom-reim-parking'});
    disable(d); enable(d);
    expect(JSON.parse(d.map._dataset.nliNameField).selectedGroup).toBeNull();
  });

  it('keeps the selected source marker while GIS names switch to detail geometry', async () => {
    loadNliNameField.mockResolvedValueOnce(groupedField());
    const d = setup({ profile: 'gis' });
    d.map.getZoom = vi.fn(() => 10);
    enable(d);
    await flush();
    d.emit('navigationCommand', { placeId: 'yeshuv-0399' });
    expect(d.map.getSource('nli-name-place-selection').data.features).toHaveLength(1);
    expect(d.map.getLayer('nli-name-place-selection-label').filter).toEqual([
      '!', ['in', ['get', 'group_id'], ['literal', ['beeri']]],
    ]);
    d.map.getZoom.mockReturnValue(11);
    d.map.emit('zoom');
    expect(d.map.getSource('nli-name-place-selection').data.features).toHaveLength(1);
    d.map.getZoom.mockReturnValue(9);
    d.map.emit('zoom');
    expect(d.map.getSource('nli-name-place-selection').data.features).toHaveLength(1);
  });
});
