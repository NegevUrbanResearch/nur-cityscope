import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import {
  createMorRouteCoordinator,
  MOR_ROUTE_URL,
  projectAndReverseMorRoute,
} from "../../frontend/src/shared/nli-mor-route-coordinator.js";

const sourceCollection = {
  type: "FeatureCollection",
  crs: { type: "name", properties: { name: "EPSG:3857" } },
  features: [{
    type: "Feature",
    geometry: { type: "MultiLineString", coordinates: [
      [[0, 0], [111319.49, 0]],
      [[111319.49, 0], [222638.98, 111325.14]],
    ] },
    properties: { OBJECTID: 1 },
  }],
};

function response(value) {
  return { ok: true, json: async () => value };
}

function context(initial = {}) {
  let narrative = initial.narrative || { id: null };
  let overlay = initial.overlay || { mor: false };
  const listeners = { narrativeState: new Set(), escapeOverlay: new Set() };
  return {
    getNarrativeState: () => narrative,
    getEscapeOverlay: () => overlay,
    subscribe(topic, listener) { listeners[topic]?.add(listener); return () => listeners[topic]?.delete(listener); },
    setNarrative(value) { narrative = value; listeners.narrativeState.forEach((listener) => listener(value)); },
    setOverlay(value) { overlay = value; listeners.escapeOverlay.forEach((listener) => listener(value)); },
  };
}

describe("Mor Levy route coordinator", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      expect(String(url)).toBe(MOR_ROUTE_URL);
      return response(sourceCollection);
    }));
    vi.stubGlobal("requestAnimationFrame", (callback) => { callback(1000); return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  test("projects EPSG:3857 and reverses connected parts from their source order", () => {
    const result = projectAndReverseMorRoute(sourceCollection);
    const coordinates = result.features[0].geometry.coordinates;
    expect(coordinates[0][0][0]).toBeCloseTo(2, 4);
    expect(coordinates[0][0][1]).toBeCloseTo(1, 4);
    expect(coordinates[0][1][0]).toBeCloseTo(1, 0);
    expect(coordinates[1][0]).toEqual(coordinates[0][coordinates[0].length - 1]);
    expect(result.crs).toBeUndefined();
  });

  test("places the moving head at the projected line progress", () => {
    const highLatitudeCollection = {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "MultiLineString", coordinates: [
          [[0, 0], [0, 60]],
          [[0, 60], [10, 60]],
        ] },
      }],
    };
    vi.mocked(fetch).mockResolvedValueOnce(response(highLatitudeCollection));
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const map = createFakeMapLibreMap();
    const dataContext = context({ narrative: { id: "nova" }, overlay: { mor: true } });
    const coordinator = createMorRouteCoordinator({ map, dataContext, profile: "gis" });
    return coordinator.onStyleLoad().then(() => {
      vi.spyOn(Date, "now").mockReturnValue(3100);
      map.driveAnimationFrame(3100);
      const head = map.getSource("nli-mor-route").data.features.find((feature) => feature.properties.role === "head").geometry.coordinates;

      expect(head[0]).toBeCloseTo(0, 5);
      expect(head[1]).toBeCloseTo(39.25, 1);
      coordinator.dispose();
    });
  });

  test("mounts turquoise reveal line and moving head only for nova + mor", async () => {
    const map = createFakeMapLibreMap();
    const dataContext = context({ narrative: { id: "nova" }, overlay: { mor: true } });
    const coordinator = createMorRouteCoordinator({ map, dataContext, profile: "gis" });
    await coordinator.onStyleLoad();
    expect(map.getLayer("nli-mor-route-line")?.type).toBe("line");
    expect(map.getLayer("nli-mor-route-head")?.type).toBe("circle");
    expect(map.getSource("nli-mor-route")?.data.features[0].properties.role).toBe("head");
    expect(map.getLayer("nli-mor-route-line").paint["line-color"]).toBe("#00FFC5");
    coordinator.dispose();
    expect(map.getLayer("nli-mor-route-line")).toBeFalsy();
    expect(map.getSource("nli-mor-route")).toBeFalsy();
  });

  test("updates the revealed line and meteor head through one source", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const map = createFakeMapLibreMap();
    const dataContext = context({ narrative: { id: "nova" }, overlay: { mor: true } });
    const coordinator = createMorRouteCoordinator({ map, dataContext, profile: "gis" });
    await coordinator.onStyleLoad();

    expect(map.getSource("nli-mor-route-head")).toBeFalsy();
    vi.spyOn(Date, "now").mockReturnValue(3100);
    map.driveAnimationFrame(3100);
    const source = map.getSource("nli-mor-route");
    expect(source.data.features.map((feature) => feature.properties.role)).toEqual(["line", "head"]);
    const tip = source.data.features[0].geometry.coordinates.at(-1).at(-1);
    const head = source.data.features[1].geometry.coordinates;
    expect(head[0]).toBeCloseTo(tip[0], 8);
    expect(head[1]).toBeCloseTo(tip[1], 8);
    const setDataCalls = map.calls.filter((call) => call.method === "setData");
    expect(setDataCalls.at(-1)?.id).toBe("nli-mor-route");
    coordinator.dispose();
  });

  test("turning mor off clears route and a style loss remounts current state", async () => {
    const map = createFakeMapLibreMap();
    const dataContext = context({ narrative: { id: "nova" }, overlay: { mor: true } });
    const coordinator = createMorRouteCoordinator({ map, dataContext, profile: "projection" });
    await coordinator.onStyleLoad();
    map.wipeStyle();
    await coordinator.onStyleLoad({ styleLoss: true });
    expect(map.getLayer("nli-mor-route-line")).toBeTruthy();
    dataContext.setOverlay({ mor: false });
    expect(map.getLayer("nli-mor-route-line")).toBeFalsy();
    expect(map.pendingAnimationFrameCount()).toBe(0);
    coordinator.dispose();
  });

  test("grows the line from hidden to partial to complete over time", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const map = createFakeMapLibreMap();
    const dataContext = context({ narrative: { id: "nova" }, overlay: { mor: true } });
    const coordinator = createMorRouteCoordinator({ map, dataContext, profile: "gis" });
    await coordinator.onStyleLoad();
    const initial = map.getSource("nli-mor-route").data;
    expect(initial.features.map((feature) => feature.properties.role)).toEqual(["head"]);
    vi.spyOn(Date, "now").mockReturnValue(3100);
    map.driveAnimationFrame(3100);
    const partial = map.getSource("nli-mor-route").data;
    expect(partial.features.map((feature) => feature.properties.role)).toEqual(["line", "head"]);
    vi.spyOn(Date, "now").mockReturnValue(5200);
    map.driveAnimationFrame(5200);
    const complete = map.getSource("nli-mor-route").data;
    const completeCoordinates = complete.features.find((feature) => feature.properties.role === "line").geometry.coordinates;
    expect(completeCoordinates).toHaveLength(2);
    expect(completeCoordinates[0][0][0]).toBeCloseTo(2, 4);
    expect(completeCoordinates[0][0][1]).toBeCloseTo(1, 4);
    expect(completeCoordinates[1][1]).toEqual([0, 0]);
    expect(map.pendingAnimationFrameCount()).toBe(0);
    coordinator.dispose();
  });

  test("keeps the meteor head at the route endpoint after the reveal completes", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const map = createFakeMapLibreMap();
    const dataContext = context({ narrative: { id: "nova" }, overlay: { mor: true } });
    const coordinator = createMorRouteCoordinator({ map, dataContext, profile: "gis" });
    await coordinator.onStyleLoad();

    vi.spyOn(Date, "now").mockReturnValue(5200);
    map.driveAnimationFrame(5200);

    const features = map.getSource("nli-mor-route").data.features;
    const head = features.find((feature) => feature.properties.role === "head");
    expect(head).toBeTruthy();
    expect(head.geometry.coordinates).toEqual([0, 0]);
    coordinator.dispose();
  });

  test("uses the Date clock consistently with DOM RAF timestamps", async () => {
    let now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const map = createFakeMapLibreMap();
    const dataContext = context({ narrative: { id: "nova" }, overlay: { mor: true } });
    const coordinator = createMorRouteCoordinator({ map, dataContext, profile: "gis" });
    await coordinator.onStyleLoad();
    now += 2100;
    map.driveAnimationFrame(2100);
    const partial = map.getSource("nli-mor-route").data.features;
    expect(partial.map((feature) => feature.properties.role)).toEqual(["line", "head"]);
    coordinator.dispose();
  });

  test("binds global RAF and cancel functions to the global object", async () => {
    const map = createFakeMapLibreMap();
    map.requestAnimationFrame = undefined;
    map.cancelAnimationFrame = undefined;
    let requested = 0;
    let cancelled = 0;
    vi.stubGlobal("requestAnimationFrame", function (callback) {
      expect(this).toBe(globalThis);
      requested += 1;
      return requested;
    });
    vi.stubGlobal("cancelAnimationFrame", function () {
      expect(this).toBe(globalThis);
      cancelled += 1;
    });
    const dataContext = context({ narrative: { id: "nova" }, overlay: { mor: true } });
    const coordinator = createMorRouteCoordinator({ map, dataContext, profile: "gis" });
    await coordinator.onStyleLoad();
    expect(requested).toBe(1);
    coordinator.dispose();
    expect(cancelled).toBe(1);
  });

  test("reduced motion shows completed route and no moving head", async () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    const map = createFakeMapLibreMap();
    const dataContext = context({ narrative: { id: "nova" }, overlay: { mor: true } });
    const coordinator = createMorRouteCoordinator({ map, dataContext, profile: "gis" });
    await coordinator.onStyleLoad();
    expect(map.getSource("nli-mor-route")?.data.features[0].geometry).toBeTruthy();
    expect(map.getSource("nli-mor-route")?.data.features).toHaveLength(1);
    expect(map.getSource("nli-mor-route")?.data.features[0].properties.role).toBe("line");
    coordinator.dispose();
  });
});
