import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { DEFAULT_PROJECTION_CONFIG as DEFAULTS } from "../../frontend/src/shared/projection-config-schema.js";

vi.mock("../../frontend/src/shared/nli-name-field-data.js", () => ({
  loadNliNameField: vi.fn(),
}));

const { createNliNameFieldController } = await import("../../frontend/src/shared/nli-name-field-controller.js");
const { loadNliNameField } = await import("../../frontend/src/shared/nli-name-field-data.js");

const field = (datasetVersion = "v1") => ({
  geojson: {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { pid: "p-1", name: "One", location: "A", visible_spans: ["left"] }, geometry: { type: "Point", coordinates: [10, 20] } },
      { type: "Feature", properties: { pid: "p-2", name: "Two", location: "B", visible_spans: ["right"] }, geometry: { type: "Point", coordinates: [30, 40] } },
    ],
  },
  byPid: new Map([
    ["p-1", { feature: { type: "Feature", properties: { pid: "p-1", name: "One", location: "A", visible_spans: ["left"] }, geometry: { type: "Point", coordinates: [10, 20] } }, sourceCoordinates: [1, 2] }],
    ["p-2", { feature: { type: "Feature", properties: { pid: "p-2", name: "Two", location: "B", visible_spans: ["right"] }, geometry: { type: "Point", coordinates: [30, 40] } }, sourceCoordinates: [3, 4] }],
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

function setup({ profile = "projection", projectionSpan, applyProjectionConfig = true, motionMode = "reduced", snapshot = { personId: null, datasetVersion: null, revision: 0 } } = {}) {
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
  if (applyProjectionConfig) controller.setProjectionConfig(DEFAULTS, 1);
  return { map, context, controller, emit, state };
}

const enable = (d) => d.controller.sync([{ id: "nli", layers: [{ id: "people_names", enabled: true }] }]);
const disable = (d) => d.controller.sync([{ id: "nli", layers: [{ id: "people_names", enabled: false }] }]);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
const projectionConfig = (tx = 0) => {
  const config = structuredClone(DEFAULTS);
  config.pre.tx = tx;
  return config;
};
const markedField = (marker, datasetVersion = "v1") => {
  const next = field(datasetVersion);
  next.geojson.features[0].properties.name = marker;
  next.byPid.get("p-1").feature.properties.name = marker;
  return next;
};
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

  it("rebuilds after a disabled projection load finishes without mounting it", async () => {
    let resolve;
    loadNliNameField.mockReturnValueOnce(new Promise((r) => { resolve = r; })).mockResolvedValueOnce(field());
    const d = setup();
    enable(d);
    await flush();
    disable(d);
    resolve(field());
    await flush();
    expect(d.map.getSource("nli-name-field")).toBeNull();
    enable(d);
    await flush();
    expect(d.map.getSource("nli-name-field").data.features).toHaveLength(2);
    expect(d.map.getLayoutProperty("nli__people_names__labels", "visibility")).toBe("none");
    expect(loadNliNameField).toHaveBeenCalledTimes(2);
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

  it("keeps projection diagnostics compatible while a requested field builds or fails", async () => {
    const build = deferred();
    loadNliNameField.mockReturnValueOnce(build.promise);
    const d = setup({ applyProjectionConfig: false });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const config = projectionConfig(0.2);
    d.controller.setProjectionConfig(config, 7);
    enable(d);

    const duringBuild = JSON.parse(d.map._dataset.nliNameField);
    expect(duringBuild).toMatchObject({
      projectionRevision: 7,
      projectionClipped: 0,
      projectionOwners: null,
      requestedRevision: 7,
      installedRevision: null,
      rebuildState: "building",
      rebuildError: null,
      owned: 0,
    });
    expect(duringBuild).not.toHaveProperty("unowned");

    build.reject(new Error("worker failed"));
    await settle();
    const afterError = JSON.parse(d.map._dataset.nliNameField);
    expect(afterError).toMatchObject({
      projectionRevision: 7,
      projectionClipped: 0,
      projectionOwners: null,
      requestedRevision: 7,
      installedRevision: null,
      rebuildState: "error",
      rebuildError: "worker failed",
      owned: 0,
    });
    expect(afterError).not.toHaveProperty("unowned");
    error.mockRestore();
    d.controller.dispose();
  });

  it("does not publish projection diagnostics before a request or installed field exists", () => {
    const d = setup({ applyProjectionConfig: false });
    enable(d);
    expect(d.map._dataset.nliNameField).toBeUndefined();
    d.controller.dispose();
  });

  it("keeps GIS diagnostics cleared until an installed field is available", async () => {
    const build = deferred();
    loadNliNameField.mockReturnValueOnce(build.promise);
    const d = setup({ profile: "gis" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    enable(d);
    expect(d.map._dataset.nliNameField).toBeUndefined();
    build.reject(new Error("worker failed"));
    await settle();
    expect(d.map._dataset.nliNameField).toBeUndefined();
    error.mockRestore();
    d.controller.dispose();
  });

  it("reports installed packed owners and lifecycle state through the projection diagnostics API", async () => {
    loadNliNameField.mockResolvedValueOnce(field());
    const d = setup({ applyProjectionConfig: false });
    d.controller.setProjectionConfig(projectionConfig(0.2), 7);
    enable(d);
    await settle();

    expect(d.controller.getProjectionNameDiagnostics()).toEqual({
      revision: 7,
      requestedRevision: 7,
      installedRevision: 7,
      clippedCount: 0,
      owners: { "p-1": "left", "p-2": "right" },
      state: "idle",
      error: null,
    });
    const diagnostics = JSON.parse(d.map._dataset.nliNameField);
    expect(diagnostics).toMatchObject({
      projectionRevision: 7,
      projectionClipped: 0,
      projectionOwners: 2,
      owned: 2,
      unowned: 0,
    });
    d.controller.dispose();
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
    disable(d);
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
    const d = setup({ projectionSpan: "right", snapshot: { personId: "p-2", datasetVersion: "v1" } });
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
    const d = setup({ projectionSpan: "left", snapshot: { personId: "p-1", datasetVersion: "v1", revision: 1 } });
    enable(d);
    await flush();
    d.emit("personSelection", { personId: "p-1", datasetVersion: "v1", revision: 2 });
    const connector = d.map.getSource("nli-name-field-connector");
    expect(connector.data.features[0].geometry.coordinates).toEqual([[10, 20], [1, 2]]);
    const span = ["in", "left", ["get", "visible_spans"]];
    expect(d.map.getLayer("nli-name-field-labels").filter).toEqual(["all", span, ["!=", ["get", "pid"], "p-1"]]);
    expect(d.map.getLayer("nli-name-field-selected").filter).toEqual(["all", span, ["==", ["get", "pid"], "p-1"]]);
    expect(d.map.getLayer("nli-name-field-selected").paint).toMatchObject({ "text-color": "#ffffff", "text-halo-width": 2 });
    d.emit("personSelection", { personId: "unknown", datasetVersion: "v1", revision: 3 });
    expect(d.map.getLayer("nli-name-field-labels").filter).toEqual(span);
    expect(d.map.getLayer("nli-name-field-selected").filter).toEqual(["all", span, ["==", ["get", "pid"], "__none__"]]);
    expect(connector.data.features).toHaveLength(0);
    expect(d.context.clearPerson).not.toHaveBeenCalled();
    d.emit("personSelection", { personId: "p-1", datasetVersion: "old", revision: 4 });
    expect(d.context.clearPerson).not.toHaveBeenCalled();
  });

  it("draws a connector only when the selected feature belongs to the projection span", async () => {
    loadNliNameField.mockResolvedValue(field());
    const left = setup({ projectionSpan: "left", applyProjectionConfig: true, snapshot: { personId: "p-2", datasetVersion: "v1" } });
    const right = setup({ projectionSpan: "right", applyProjectionConfig: true, snapshot: { personId: "p-2", datasetVersion: "v1" } });
    enable(left);
    enable(right);
    await flush();
    expect(left.map.getSource("nli-name-field-connector").data.features).toHaveLength(0);
    expect(right.map.getSource("nli-name-field-connector").data.features[0].geometry.coordinates).toEqual([[30, 40], [3, 4]]);
    expect(right.controller.getProjectionNameDiagnostics().owners).toEqual({ "p-1": "left", "p-2": "right" });
    left.controller.dispose();
    right.controller.dispose();
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

  it('does not start a projection build until a projection config is available', async () => {
    const d = setup({ applyProjectionConfig: false });
    enable(d);
    await settle();
    expect(loadNliNameField).not.toHaveBeenCalled();
    expect(d.map.getSource('nli-name-field')).toBeNull();
    expect(d.map.getLayer('nli-name-field-labels')).toBeNull();
    d.controller.dispose();
  });

  it('does not reload an already-installed field on same-state sync', async () => {
    loadNliNameField.mockResolvedValueOnce(field());
    const d = setup();
    enable(d);
    await settle();
    expect(loadNliNameField).toHaveBeenCalledTimes(1);

    enable(d);
    await settle();

    expect(loadNliNameField).toHaveBeenCalledTimes(1);
    expect(d.map.getLayer('nli-name-field-labels')).toBeTruthy();
    d.controller.dispose();
  });

  it('serializes live projection builds to one active request', () => {
    const first = deferred();
    loadNliNameField.mockReturnValueOnce(first.promise);
    const d = setup({ applyProjectionConfig: false });
    d.controller.setProjectionConfig(projectionConfig(0), 1);
    enable(d);
    expect(loadNliNameField).toHaveBeenCalledTimes(1);
    d.controller.setProjectionConfig(projectionConfig(0.1), 2);
    expect(loadNliNameField).toHaveBeenCalledTimes(1);
    d.controller.dispose();
  });

  it('starts the newest projection build after an obsolete build succeeds without mounting the old field', async () => {
    const first = deferred();
    const second = deferred();
    loadNliNameField.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const d = setup({
      applyProjectionConfig: false,
      snapshot: { personId: 'p-1', datasetVersion: 'v1' },
    });
    d.controller.setProjectionConfig(projectionConfig(0), 1);
    enable(d);
    d.controller.setProjectionConfig(projectionConfig(0.1), 2);
    first.resolve(markedField('old'));
    await settle();
    expect(loadNliNameField).toHaveBeenCalledTimes(2);
    expect(d.map.getLayer('nli-name-field-labels')).toBeNull();
    second.resolve(markedField('new'));
    await settle();
    expect(d.map.getLayer('nli-name-field-labels')).toBeTruthy();
    expect(d.map.getSource('nli-name-field').data.features[0].properties.name).toBe('new');
    expect(d.map.getLayer('nli-name-field-selected').filter).toEqual(['==', ['get', 'pid'], 'p-1']);
    expect(JSON.parse(d.map._dataset.nliNameField)).toMatchObject({ projectionRevision: 2, selectedPid: 'p-1' });
    d.controller.dispose();
  });

  it('mounts a matching replacement once, preserving selection and installed revision', async () => {
    const first = deferred();
    const second = deferred();
    loadNliNameField.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const d = setup({
      applyProjectionConfig: false,
      snapshot: { personId: 'p-1', datasetVersion: 'v1' },
    });
    d.controller.setProjectionConfig(projectionConfig(0), 1);
    enable(d);
    first.resolve(markedField('first'));
    await settle();
    expect(d.map.getSource('nli-name-field')).toBeTruthy();
    const mountedSources = () => d.map.calls.filter((call) => call.method === 'addSource' && call.id === 'nli-name-field');
    expect(mountedSources()).toHaveLength(1);
    d.controller.setProjectionConfig(projectionConfig(0.1), 2);
    expect(d.map.getSource('nli-name-field')).toBeNull();
    second.resolve(markedField('second'));
    await settle();
    expect(mountedSources()).toHaveLength(2);
    expect(d.map.getLayer('nli-name-field-selected').filter).toEqual(['==', ['get', 'pid'], 'p-1']);
    expect(d.controller.getProjectionNameDiagnostics().revision).toBe(2);
    expect(JSON.parse(d.map._dataset.nliNameField)).toMatchObject({ projectionRevision: 2, selectedPid: 'p-1' });
    d.controller.dispose();
  });

  it('rejects older and equal-conflicting revisions while treating equal-identical revisions as no-ops', async () => {
    loadNliNameField.mockResolvedValueOnce(field());
    const d = setup({ applyProjectionConfig: false });
    const config = projectionConfig(0);
    d.controller.setProjectionConfig(config, 5);
    enable(d);
    await settle();
    expect(d.controller.setProjectionConfig(config, 5)).toBe(true);
    expect(loadNliNameField).toHaveBeenCalledTimes(1);
    expect(d.controller.setProjectionConfig(projectionConfig(-0.1), 4)).toBe(false);
    expect(d.controller.setProjectionConfig(projectionConfig(-0.1), 5)).toBe(false);
    expect(loadNliNameField).toHaveBeenCalledTimes(1);
    d.controller.dispose();
  });

  it('installs only the second of two revisionless preview requests', async () => {
    const first = deferred();
    const second = deferred();
    loadNliNameField.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const d = setup({ applyProjectionConfig: false });
    const firstConfig = projectionConfig(0);
    const secondConfig = structuredClone(firstConfig);
    expect(d.controller.setProjectionConfig(firstConfig)).toBe(true);
    enable(d);
    expect(d.controller.setProjectionConfig(secondConfig)).toBe(true);
    expect(loadNliNameField).toHaveBeenCalledTimes(1);
    first.resolve(markedField('first-preview'));
    await settle();
    expect(loadNliNameField).toHaveBeenCalledTimes(2);
    expect(d.map.getLayer('nli-name-field-labels')).toBeNull();
    second.resolve(markedField('second-preview'));
    await settle();
    expect(d.map.getSource('nli-name-field').data.features[0].properties.name).toBe('second-preview');
    expect(loadNliNameField.mock.calls[0][0].projectionConfig).toEqual(firstConfig);
    expect(loadNliNameField.mock.calls[1][0].projectionConfig).toEqual(secondConfig);
    d.controller.dispose();
  });

  it('keeps a failed current build hidden and does not retry it on same-state sync', async () => {
    const failed = deferred();
    loadNliNameField.mockResolvedValueOnce(field()).mockReturnValueOnce(failed.promise);
    const d = setup({ applyProjectionConfig: false });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    d.controller.setProjectionConfig(projectionConfig(0), 1);
    enable(d);
    await settle();
    d.controller.setProjectionConfig(projectionConfig(0.1), 2);
    expect(d.map.getLayer('nli-name-field-labels')).toBeNull();
    failed.reject(new Error('worker failed'));
    await settle();
    expect(d.map.getLayer('nli-name-field-labels')).toBeNull();
    expect(JSON.parse(d.map._dataset.nliNameField)).toMatchObject({ rebuildState: 'error', rebuildError: 'worker failed' });
    enable(d);
    await settle();
    expect(loadNliNameField).toHaveBeenCalledTimes(2);
    expect(d.map.getLayer('nli-name-field-labels')).toBeNull();
    error.mockRestore();
    d.controller.dispose();
  });

  it('retries a failed request once after disable and re-enable', async () => {
    const failed = deferred();
    const retry = deferred();
    loadNliNameField.mockReturnValueOnce(failed.promise).mockReturnValueOnce(retry.promise);
    const d = setup({ applyProjectionConfig: false });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    d.controller.setProjectionConfig(projectionConfig(0), 1);
    enable(d);
    failed.reject(new Error('capacity'));
    await settle();
    expect(loadNliNameField).toHaveBeenCalledTimes(1);
    enable(d);
    expect(loadNliNameField).toHaveBeenCalledTimes(1);
    disable(d);
    enable(d);
    expect(loadNliNameField).toHaveBeenCalledTimes(2);
    retry.resolve(field());
    await settle();
    expect(d.map.getLayer('nli-name-field-labels')).toBeTruthy();
    error.mockRestore();
    d.controller.dispose();
  });

  it('does not mount a stale field on style.load while a replacement is building', async () => {
    loadNliNameField.mockResolvedValueOnce(markedField('installed'));
    const d = setup({ applyProjectionConfig: false });
    d.controller.setProjectionConfig(projectionConfig(0), 1);
    enable(d);
    await settle();
    expect(d.map.getLayer('nli-name-field-labels')).toBeTruthy();

    const build = deferred();
    loadNliNameField.mockReturnValueOnce(build.promise);
    d.controller.setProjectionConfig(projectionConfig(0.1), 2);
    d.map.remountStyle({ layers: [{ id: 'nli__people_names__labels', type: 'symbol' }] });
    expect(d.map.getLayer('nli-name-field-labels')).toBeNull();
    build.resolve(field());
    await settle();
    expect(d.map.getLayer('nli-name-field-labels')).toBeTruthy();
    d.controller.dispose();
  });

  it('reloads through the scheduler without installing the obsolete result', async () => {
    const first = deferred();
    const second = deferred();
    loadNliNameField.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const d = setup({ applyProjectionConfig: false });
    d.controller.setProjectionConfig(projectionConfig(0), 1);
    enable(d);
    d.controller.reload();
    expect(loadNliNameField).toHaveBeenCalledTimes(1);
    first.resolve(markedField('obsolete'));
    await settle();
    expect(loadNliNameField).toHaveBeenCalledTimes(2);
    expect(d.map.getLayer('nli-name-field-labels')).toBeNull();
    second.resolve(markedField('replacement'));
    await settle();
    expect(d.map.getSource('nli-name-field').data.features[0].properties.name).toBe('replacement');
    d.controller.dispose();
  });

  it('restarts the newest request after an obsolete build rejects', async () => {
    const first = deferred();
    const second = deferred();
    loadNliNameField.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const d = setup({ applyProjectionConfig: false });
    d.controller.setProjectionConfig(projectionConfig(0), 1);
    enable(d);
    d.controller.setProjectionConfig(projectionConfig(0.1), 2);
    first.reject(new Error('obsolete worker failed'));
    await settle();
    expect(loadNliNameField).toHaveBeenCalledTimes(2);
    expect(d.map.getLayer('nli-name-field-labels')).toBeNull();
    second.resolve(field());
    await settle();
    expect(d.map.getLayer('nli-name-field-labels')).toBeTruthy();
    d.controller.dispose();
  });

  it('never installs a build that resolves after disable or dispose', async () => {
    const disabledBuild = deferred();
    loadNliNameField.mockReturnValueOnce(disabledBuild.promise);
    const disabled = setup({ applyProjectionConfig: false });
    disabled.controller.setProjectionConfig(projectionConfig(0), 1);
    enable(disabled);
    disable(disabled);
    disabledBuild.resolve(field());
    await settle();
    expect(disabled.map.getLayer('nli-name-field-labels')).toBeNull();
    disabled.controller.dispose();

    const disposedBuild = deferred();
    loadNliNameField.mockReturnValueOnce(disposedBuild.promise);
    const disposed = setup({ applyProjectionConfig: false });
    disposed.controller.setProjectionConfig(projectionConfig(0), 1);
    enable(disposed);
    disposed.controller.dispose();
    disposedBuild.resolve(field());
    await settle();
    expect(disposed.map.getLayer('nli-name-field-labels')).toBeNull();
    expect(disposed.map.listenerCount('style.load')).toBe(0);
  });

  it('rejects malformed candidates before mounting them', async () => {
    const malformedCandidates = [
      { candidate: { ...field(), geojson: {} }, message: 'Invalid NLI name field data' },
      { candidate: { ...field(), diagnostics: { ...field().diagnostics, total: 1 } }, message: 'Invalid NLI name field data' },
      { candidate: { ...field(), diagnostics: { ...field().diagnostics, placed: 1 } }, message: 'Invalid NLI name field data' },
      { candidate: { ...field(), diagnostics: { ...field().diagnostics, unplaced: ['p-2'] } }, message: 'NLI name field capacity exhausted' },
      { candidate: { ...field(), byPid: new Map([['p-1', field().byPid.get('p-1')]]) }, message: 'Invalid NLI name field data' },
      {
        candidate: (() => {
          const next = field();
          next.geojson.features[1].properties.visible_spans = [];
          return next;
        })(),
        message: 'Invalid NLI name field ownership',
      },
    ];
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const { candidate, message } of malformedCandidates) {
      loadNliNameField.mockReset();
      loadNliNameField.mockResolvedValueOnce(candidate);
      const d = setup({ applyProjectionConfig: false });
      d.controller.setProjectionConfig(projectionConfig(0), 1);
      enable(d);
      await settle();
      expect(d.map.getLayer('nli-name-field-labels')).toBeNull();
      expect(JSON.parse(d.map._dataset.nliNameField).rebuildError).toBe(message);
      d.controller.dispose();
    }
    error.mockRestore();
  });

  it('rejects invalid supplied projection revisions', () => {
    const d = setup({ applyProjectionConfig: false });
    for (const revision of [-1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '2']) {
      expect(d.controller.setProjectionConfig(DEFAULTS, revision)).toBe(false);
    }
  });

  it('compares projection configs independent of object key order', () => {
    const d = setup({ applyProjectionConfig: false });
    const reverseKeys = (value) => Array.isArray(value)
      ? value.map(reverseKeys)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]))
        : value;
    const reordered = reverseKeys(DEFAULTS);
    expect(d.controller.setProjectionConfig(DEFAULTS, 7)).toBe(true);
    expect(d.controller.setProjectionConfig(reordered, 7)).toBe(true);
  });

  it('hides legacy labels on style reload while a replacement is building or errored', async () => {
    const pending = deferred();
    loadNliNameField.mockReturnValueOnce(pending.promise);
    const d = setup({ applyProjectionConfig: false });
    d.map.getLayer('nli__people_names__labels').layout.visibility = 'visible';
    d.controller.setProjectionConfig(DEFAULTS, 1);
    enable(d);
    d.map.emit('style.load');
    expect(d.map.getLayoutProperty('nli__people_names__labels', 'visibility')).toBe('none');
    pending.reject(new Error('failed'));
    await settle();
    d.map.getLayer('nli__people_names__labels').layout.visibility = 'visible';
    d.map.emit('style.load');
    expect(d.map.getLayoutProperty('nli__people_names__labels', 'visibility')).toBe('none');
  });
});
