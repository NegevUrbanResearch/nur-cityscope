import { readFileSync } from "fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import * as curatedService from "../../frontend/src/shared/curated-layer-service.js";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import {
  leafletStyleToMapLibre,
  createGisCuratedRefresh,
  createProjectionCuratedRefresh,
  loadCuratedLayerToMapLibre,
  maplibreLineDashFromLeafletPx,
  maplibreLineDashWithLeafletOffset,
  removeCuratedHtmlMarkers,
} from "../../frontend/src/map/maplibre-curated-layer-loader.js";
import {
  pinkProjectionFallbackLineStyle,
  routeLineStylesForDisplayColor,
} from "../../frontend/src/map-utils/pink-route-map-styles.js";
import { planPinkCuratedOverlayLayers } from "../../frontend/src/map/pink-curated-overlay-plan.js";

function parseDashString(dashArray) {
  if (!dashArray) return null;
  const parts = String(dashArray)
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  return parts.length >= 2 ? parts : null;
}

describe("maplibreLineDashWithLeafletOffset (Colab dual proposed)", () => {
  test("applies no transform when offset is 0 or missing", () => {
    expect(maplibreLineDashWithLeafletOffset([10, 8], 0)).toEqual([10, 8]);
  });

  test("10/8 pattern + offset 9 interleaves vs base (one period, even-length dasharray)", () => {
    const out = maplibreLineDashWithLeafletOffset([10, 8], 9);
    expect(out).toEqual([1, 8, 9, 0]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(18);
    expect(out).not.toEqual([10, 8]);
  });

  test("round-trips to same line-space period length as the base pattern", () => {
    const base = [10, 8];
    const T = 18;
    const o = maplibreLineDashWithLeafletOffset(base, 9);
    expect(o.reduce((a, b) => a + b, 0)).toBe(T);
  });
});

describe("curated loader force cleanup contract", () => {
  test("force cleanup hard-removes at replacement commit after both fetches", () => {
    const src = readFileSync("frontend/src/map/maplibre-curated-layer-loader.js", "utf8");
    const body = src.slice(src.indexOf("export async function loadCuratedLayerToMapLibre"));
    const fetchData = body.indexOf("await fetchCuratedLayerData");
    const fetchPink = body.indexOf("await fetchPinkLinePaths");
    const remove = body.indexOf("commitReplacement()");
    expect(fetchData).toBeGreaterThan(-1);
    expect(fetchPink).toBeGreaterThan(fetchData);
    expect(remove).toBeGreaterThan(fetchPink);
    expect(body).toContain("removeCuratedLayersByPrefix(map, fullLayerId)");
    expect(body).not.toContain("removeCuratedLayersByPrefix(map, fullLayerId, opts.layerStyleOptions)");
  });
});

function polygonCollection() {
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: {},
      geometry: { type: "Polygon", coordinates: [[[34.4, 31.3], [34.5, 31.3], [34.5, 31.4], [34.4, 31.3]]] },
    }],
  };
}

function pointCollection() {
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { pink_node_order: 1, name: "node" },
      geometry: { type: "Point", coordinates: [34.5, 31.4] },
    }],
  };
}

function lineCollection() {
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [[34.4, 31.3], [34.5, 31.4]] },
    }],
  };
}

function defer() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function markerNamespace(added, removed) {
  class Marker {
    setLngLat() { return this; }
    setPopup() { return this; }
    addTo() { added.push(this); return this; }
    remove() { removed.push(this); }
  }
  class Popup {
    setHTML() { return this; }
  }
  return { Marker, Popup };
}

describe("curated loader display freshness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    removeCuratedHtmlMarkers("curated.1");
    removeCuratedHtmlMarkers("curated.2");
    delete globalThis.document;
  });

  test("a current load removes the previous layer only after both fetches resolve", async () => {
    const data = defer();
    const pink = defer();
    vi.spyOn(curatedService, "fetchCuratedLayerData").mockReturnValue(data.promise);
    vi.spyOn(curatedService, "fetchPinkLinePaths").mockReturnValue(pink.promise);
    const map = createFakeMapLibreMap({ layers: [{ id: "curated.1__old", type: "fill" }] });
    const pending = loadCuratedLayerToMapLibre(map, "curated.1", { force: true });
    await Promise.resolve();
    expect(map.getLayer("curated.1__old")).toBeTruthy();
    expect(map.calls.filter((call) => call.method === "addLayer")).toHaveLength(0);

    data.resolve({ geojson: polygonCollection(), layerData: {} });
    await Promise.resolve();
    await Promise.resolve();
    expect(map.getLayer("curated.1__old")).toBeTruthy();
    expect(map.calls.filter((call) => call.method === "addLayer")).toHaveLength(0);

    pink.resolve({ basePaths: [], pinkGeojson: null });
    await pending;
    expect(map.getLayer("curated.1__old")).toBeFalsy();
    expect(map.getLayer("curated.1__plain__fill")).toBeTruthy();
  });

  test("a load that goes stale during fetchCuratedLayerData does not add, remove, or touch markers", async () => {
    const data = defer();
    vi.spyOn(curatedService, "fetchCuratedLayerData").mockReturnValue(data.promise);
    vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths: [], pinkGeojson: null });
    const added = [];
    const removed = [];
    globalThis.document = { createElement: () => ({ style: {}, innerHTML: "", className: "" }) };
    const map = createFakeMapLibreMap({ layers: [{ id: "curated.1__old", type: "fill" }] });
    let current = true;
    const pending = loadCuratedLayerToMapLibre(map, "curated.1", {
      force: true,
      maplibregl: markerNamespace(added, removed),
      isCurrent: () => current,
    });
    await Promise.resolve();
    current = false;
    data.resolve({ geojson: pointCollection(), layerData: {} });
    await pending;
    expect(map.getLayer("curated.1__old")).toBeTruthy();
    expect(map.calls.filter((call) => call.method === "addLayer" || call.method === "removeLayer")).toHaveLength(0);
    expect(added).toHaveLength(0);
    expect(removed).toHaveLength(0);
  });

  test("a load that goes stale during fetchPinkLinePaths does not add or remove", async () => {
    const pink = defer();
    vi.spyOn(curatedService, "fetchCuratedLayerData").mockResolvedValue({
      geojson: polygonCollection(),
      layerData: {},
    });
    vi.spyOn(curatedService, "fetchPinkLinePaths").mockReturnValue(pink.promise);
    const map = createFakeMapLibreMap({ layers: [{ id: "curated.1__old", type: "fill" }] });
    let current = true;
    const pending = loadCuratedLayerToMapLibre(map, "curated.1", {
      force: true,
      isCurrent: () => current,
    });
    await Promise.resolve();
    await Promise.resolve();
    current = false;
    pink.resolve({ basePaths: [], pinkGeojson: null });
    await pending;
    expect(map.getLayer("curated.1__old")).toBeTruthy();
    expect(map.calls.filter((call) => call.method === "addLayer" || call.method === "removeLayer")).toHaveLength(0);
  });

  test("a stale same-id finalizer cannot remove the newer replacement", async () => {
    const oldData = defer();
    const newData = defer();
    vi.spyOn(curatedService, "fetchCuratedLayerData")
      .mockReturnValueOnce(oldData.promise)
      .mockReturnValueOnce(newData.promise);
    vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths: [], pinkGeojson: null });
    const map = createFakeMapLibreMap({ layers: [{ id: "curated.1__old", type: "fill" }] });
    const mutations = [];
    const addLayer = map.addLayer.bind(map);
    const removeLayer = map.removeLayer.bind(map);
    const addSource = map.addSource.bind(map);
    const removeSource = map.removeSource.bind(map);
    map.addLayer = (layer, beforeId) => { mutations.push(`add:${layer.id}`); return addLayer(layer, beforeId); };
    map.removeLayer = (id) => { mutations.push(`remove:${id}`); return removeLayer(id); };
    map.addSource = (id, spec) => { mutations.push(`addSource:${id}`); return addSource(id, spec); };
    map.removeSource = (id) => { mutations.push(`removeSource:${id}`); return removeSource(id); };
    let oldCurrent = true;
    const oldLoad = loadCuratedLayerToMapLibre(map, "curated.1", {
      force: true,
      isCurrent: () => oldCurrent,
    });
    await Promise.resolve();
    oldCurrent = false;
    const replacement = loadCuratedLayerToMapLibre(map, "curated.1", {
      force: true,
      isCurrent: () => true,
    });
    newData.resolve({ geojson: polygonCollection(), layerData: {} });
    await replacement;
    expect(map.getLayer("curated.1__plain__fill")).toBeTruthy();
    const mutationsAfterReplacement = mutations.length;
    oldData.resolve({ geojson: polygonCollection(), layerData: {} });
    await oldLoad;
    expect(mutations.length).toBe(mutationsAfterReplacement);
    expect(map.getLayer("curated.1__plain__fill")).toBeTruthy();
    expect(map.getLayer("curated.1__old")).toBeFalsy();
  });

  test("a stale pink-base fetch cannot add the base layer or the curated fallback", async () => {
    const innerPink = defer();
    vi.spyOn(curatedService, "fetchCuratedLayerData").mockResolvedValue({
      geojson: lineCollection(),
      layerData: {},
    });
    vi.spyOn(curatedService, "fetchPinkLinePaths")
      .mockResolvedValueOnce({ basePaths: [[[31.3, 34.4], [31.4, 34.5]]], pinkGeojson: null })
      .mockReturnValueOnce(innerPink.promise);
    const map = createFakeMapLibreMap();
    let current = true;
    const pending = loadCuratedLayerToMapLibre(map, "curated.1", {
      force: true,
      isCurrent: () => current,
    });
    await Promise.resolve();
    await Promise.resolve();
    current = false;
    innerPink.resolve({ basePaths: [[[31.3, 34.4], [31.4, 34.5]]], pinkGeojson: null });
    await pending;
    expect(map.getLayer("pink_line_base__line")).toBeFalsy();
    expect(map.getLayer("curated.1__fallback__0")).toBeFalsy();
    expect(map.calls.filter((call) => call.method === "addLayer" || call.method === "removeLayer")).toHaveLength(0);
  });
});

function expectNumberArrayClose(actual, expected) {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(actual[i]).toBeCloseTo(expected[i], 10);
  }
}

describe("maplibreLineDashFromLeafletPx (px → line-width–unit parity)", () => {
  test("scales Colab proposed dash + offset the same as leafletStyleToMapLibre (weight 6)", () => {
    const w = 6;
    const parts = [10, 8];
    const o = 9;
    const fromHelper = maplibreLineDashFromLeafletPx(w, parts, o);
    const { paint } = leafletStyleToMapLibre({
      weight: w,
      dashArray: "10 8",
      dashOffset: "9",
    });
    expectNumberArrayClose(fromHelper, paint["line-dasharray"]);
  });

  test("no offset: offroad 6 10 at weight 4 matches px/w normalization", () => {
    const w = 4;
    const { paint } = leafletStyleToMapLibre({
      weight: w,
      dashArray: "6 10",
    });
    expectNumberArrayClose(paint["line-dasharray"], [6 / w, 10 / w]);
  });

  test("scaled dasharray keeps primary vs secondary interleave: same w, same M/L period", () => {
    const w = 6;
    const sec = maplibreLineDashFromLeafletPx(w, [10, 8], null);
    const pri = maplibreLineDashFromLeafletPx(w, [10, 8], 9);
    expect(sec.length).toBe(2);
    expect(pri.length).toBe(4);
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    expect(sum(pri)).toBeCloseTo(sum(sec), 10);
  });
});

describe("proposed line vs proposedSecondary paint (palette dual stack)", () => {
  test("primary dasharray differs from secondary after offset; same effective period", () => {
    const styles = routeLineStylesForDisplayColor("#16A34A");
    expect(styles.proposedSecondary).toBeDefined();
    const sec = parseDashString(styles.proposedSecondary.dashArray);
    const priBase = parseDashString(styles.proposedLine.dashArray);
    const offset = Number(styles.proposedLine.dashOffset);
    expect(sec).toEqual([10, 8]);
    expect(priBase).toEqual([10, 8]);
    expect(offset).toBe(9);
    const pri = maplibreLineDashWithLeafletOffset(priBase, offset);
    expect(pri).not.toEqual(sec);
    expect(pri.reduce((a, b) => a + b, 0)).toBe(sec.reduce((a, b) => a + b, 0));
  });

  test("leafletStyleToMapLibre: secondary is unphased; primary encodes Colab dash offset (line-width units)", () => {
    const styles = routeLineStylesForDisplayColor("#16A34A");
    const w = styles.proposedLine.weight;
    const { paint: secP } = leafletStyleToMapLibre(styles.proposedSecondary);
    const { paint: priP } = leafletStyleToMapLibre(styles.proposedLine);
    expectNumberArrayClose(secP["line-dasharray"], [10 / w, 8 / w]);
    expectNumberArrayClose(
      priP["line-dasharray"],
      maplibreLineDashFromLeafletPx(w, [10, 8], 9),
    );
    expect(secP["line-color"]).not.toEqual(priP["line-color"]);
  });
});

describe("pink projection fallback stroke (MapLibre)", () => {
  test("uses Colab proposed dash tokens normalized like default proposed line", () => {
    const s = pinkProjectionFallbackLineStyle("#00d4ff");
    const w = s.weight;
    const { paint } = leafletStyleToMapLibre(s);
    expect(paint["line-width"]).toBe(w);
    expect(paint["line-color"]).toBe("#00d4ff");
    expectNumberArrayClose(paint["line-dasharray"], [10 / w, 8 / w]);
  });
});

describe("curated polyline op order: halo → secondary → primary", () => {
  test("planPinkCuratedOverlayLayers emits proposed styleKeys before primary so Map groups draw secondary under primary", () => {
    const ops = planPinkCuratedOverlayLayers({
      hasDetourPoints: true,
      hasStoredPinkRoute: true,
      includeProposedSecondary: true,
      solid: [[[-1, 0], [0, 0]]],
      removed: [
        [
          [0, 0],
          [0, 1],
        ],
      ],
      proposedPathsLatLng: [
        [
          [1, 1],
          [2, 2],
        ],
      ],
    });

    const styleKeys = [];
    /** @type {Map<string, true>} */
    const seen = new Map();
    for (const op of ops) {
      if (op.kind !== "polyline") continue;
      if (!seen.has(op.styleKey)) {
        seen.set(op.styleKey, true);
        styleKeys.push(op.styleKey);
      }
    }

    const iHalo = styleKeys.indexOf("proposedHalo");
    const iSec = styleKeys.indexOf("proposedSecondary");
    const iPri = styleKeys.indexOf("proposedLine");
    expect(iHalo).toBeGreaterThanOrEqual(0);
    expect(iSec).toBeGreaterThanOrEqual(0);
    expect(iPri).toBeGreaterThanOrEqual(0);
    expect(iHalo).toBeLessThan(iSec);
    expect(iSec).toBeLessThan(iPri);
  });
});


describe("curated batch membership", () => {
  test("registry-only toggles start a new batch even with unchanged curated IDs", async () => {
    const { getLayerLifecycleRuntime } = await import("../../frontend/src/shared/layer-lifecycle-fade.js");
    const map = createFakeMapLibreMap(); let time = 0; let frame;
    const runtime = getLayerLifecycleRuntime(map, { now: () => time, requestFrame: cb => { frame=cb; return 1; }, cancelFrame: () => {} });
    const factors = [];
    const refresh = createGisCuratedRefresh({ map, applyLayerGroups: groups => {
      if (groups[0]?.layers[0]?.enabled) {
        runtime.registerOpacityTarget("home.model", factor => factors.push(factor));
        runtime.markMemberReady("home.model");
      }
    }});
    await refresh.refreshCuratedLayers({ groupsOverride: [{ id: "home", layers: [{ id: "model", enabled: true }] }] });
    time=600; frame?.();
    expect(factors.at(-1)).toBe(1);
    await refresh.refreshCuratedLayers({ groupsOverride: [] });
    expect(factors.at(-1)).toBe(1);
    time=900; frame?.();
    expect(factors.at(-1)).toBeCloseTo(0.5);
    time=1200; frame?.();
    expect(factors.at(-1)).toBe(0);
  });
});


test("joined curated refresh preserves the coordinator's strict full-membership handle and seal ownership", async () => {
  const { getLayerLifecycleRuntime } = await import("../../frontend/src/shared/layer-lifecycle-fade.js");
  const map = createFakeMapLibreMap();
  const runtime = getLayerLifecycleRuntime(map);
  const ids = ["home.model", "scene.clock", "scene.names"];
  const handle = runtime.setDesiredIds(ids, { durationMs:600,requiredIds:ids });
  const refresh = createGisCuratedRefresh({ map, applyLayerGroups: () => {
    runtime.registerOpacityTarget("home.model", () => {});
    runtime.markMemberReady("home.model");
  }});
  await refresh.refreshCuratedLayers({ groupsOverride:[{ id:"home",layers:[{ id:"model",enabled:true }] }],layerStyleOptions:{ lifecycle:{ joinBatch:true } } });
  expect(runtime.getPendingBatch()).toBe(handle);
  expect(handle.sealed).toBe(false);
  expect(runtime.getDesiredIds()).toEqual(ids);
  runtime.dispose();
});


test.each(["gis", "projection"])("stale %s curated failures cannot fail a newer captured batch", async (display) => {
  const { getLayerLifecycleRuntime } = await import("../../frontend/src/shared/layer-lifecycle-fade.js");
  let rejectData;
  const data = new Promise((resolve, reject) => { rejectData = reject; });
  const fetch = vi.spyOn(curatedService, "fetchCuratedLayerData").mockReturnValue(data);
  const map = createFakeMapLibreMap();
  const runtime = getLayerLifecycleRuntime(map);
  let current = true;
  const factory = display === "gis" ? createGisCuratedRefresh : createProjectionCuratedRefresh;
  const refresh = factory({ map });
  const run = refresh.refreshCuratedLayers || refresh.runProjectionCuratedRefresh;
  const old = run({ groupsOverride:[{ id:"curated",layers:[{ id:"1",enabled:true }] }], isCurrent:() => current });
  await Promise.resolve(); await Promise.resolve();
  expect(fetch).toHaveBeenCalled();
  current = false;
  const handle = runtime.setDesiredIds(["curated.1"], { durationMs:0,requiredIds:["curated.1"] });
  runtime.registerOpacityTarget("curated.1", () => {});
  runtime.markMemberReady("curated.1"); runtime.commitBatch();
  rejectData(new Error("superseded load"));
  await old;
  expect(await runtime.waitForBatch(handle)).toEqual({ status:"ready" });
  expect(runtime.getRenderedReadiness().failedIds).toEqual([]);
  fetch.mockRestore(); runtime.dispose();
});


test("zero-duration joined curated resources stage hidden until the captured batch is sealed", async () => {
  const { getLayerLifecycleRuntime } = await import("../../frontend/src/shared/layer-lifecycle-fade.js");
  const data = vi.spyOn(curatedService, "fetchCuratedLayerData").mockResolvedValue({ geojson:polygonCollection(),layerData:{} });
  const pink = vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths:[] });
  const map = createFakeMapLibreMap();
  const runtime = getLayerLifecycleRuntime(map);
  const handle = runtime.setDesiredIds(["curated.1"], { durationMs:0,requiredIds:["curated.1"] });
  const refresh = createGisCuratedRefresh({ map });
  await refresh.refreshCuratedLayers({ groupsOverride:[{ id:"curated",layers:[{ id:"1",enabled:true }] }],layerStyleOptions:{ lifecycle:{ joinBatch:true },transition:{ transitionMs:0 } } });
  expect(runtime.getPendingBatch()).toBe(handle);
  expect(map.getPaintProperty("curated.1__plain__fill","fill-opacity")).toBe(0);
  runtime.commitBatch();
  expect(await runtime.waitForBatch(handle)).toEqual({ status:"ready" });
  expect(map.getPaintProperty("curated.1__plain__fill","fill-opacity")).toBe(0.4);
  data.mockRestore(); pink.mockRestore(); runtime.dispose();
});


test.each(["gis", "projection"].flatMap(display => ["ready", "failed"].map(outcome => ({ display, outcome }))))(
  "zero-duration joined $display curated exits retain outgoing resources until the captured batch is $outcome", async ({ display, outcome }) => {
    const { getLayerLifecycleRuntime } = await import("../../frontend/src/shared/layer-lifecycle-fade.js");
    const data = vi.spyOn(curatedService, "fetchCuratedLayerData").mockResolvedValue({ geojson:polygonCollection(), layerData:{} });
    const pink = vi.spyOn(curatedService, "fetchPinkLinePaths").mockResolvedValue({ basePaths:[] });
    const map = createFakeMapLibreMap();
    const runtime = getLayerLifecycleRuntime(map);
    const factory = display === "gis" ? createGisCuratedRefresh : createProjectionCuratedRefresh;
    const refresh = factory({ map });
    const run = refresh.refreshCuratedLayers || refresh.runProjectionCuratedRefresh;
    const options = { lifecycle:{ joinBatch:true }, transition:{ transitionMs:0 } };
    runtime.setDesiredIds(["curated.1"], { durationMs:0, requiredIds:["curated.1"] });
    await run({ groupsOverride:[{ id:"curated", layers:[{ id:"1", enabled:true }] }], layerStyleOptions:options });
    runtime.commitBatch();
    const layerId = "curated.1__plain__fill";
    const sourceId = map.getLayer(layerId).source;
    expect(map.getPaintProperty(layerId, "fill-opacity")).toBe(0.4);
    const handle = runtime.setDesiredIds(["incoming", "missing"], { durationMs:0, requiredIds:["incoming", "missing"] });
    const incomingFactors = [];
    runtime.registerOpacityTarget("incoming", factor => incomingFactors.push(factor));
    runtime.markMemberReady("incoming");
    await run({ groupsOverride:[], layerStyleOptions:options });
    expect(runtime.getPendingBatch()).toBe(handle);
    expect(handle.sealed).toBe(false);
    expect(incomingFactors.at(-1)).toBe(0);
    expect(map.getLayer(layerId)).toBeTruthy();
    expect(map.getSource(sourceId)).toBeTruthy();
    expect(map.getPaintProperty(layerId, "fill-opacity")).toBe(0.4);
    runtime.commitBatch();
    expect(map.getLayer(layerId)).toBeTruthy();
    expect(incomingFactors.at(-1)).toBe(0);
    runtime.registerOpacityTarget("missing", () => {});
    if (outcome === "ready") runtime.markMemberReady("missing");
    else runtime.markMemberFailed("missing");
    expect(await runtime.waitForBatch(handle)).toEqual({ status:outcome });
    expect(incomingFactors.at(-1)).toBe(outcome === "ready" ? 1 : 0);
    expect(Boolean(map.getLayer(layerId))).toBe(outcome === "failed");
    expect(Boolean(map.getSource(sourceId))).toBe(outcome === "failed");
    if (outcome === "failed") expect(map.getPaintProperty(layerId, "fill-opacity")).toBe(0.4);
    data.mockRestore(); pink.mockRestore(); runtime.dispose();
  },
);
