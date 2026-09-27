import { readFileSync } from "fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import * as curatedService from "../../frontend/src/shared/curated-layer-service.js";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import {
  leafletStyleToMapLibre,
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
