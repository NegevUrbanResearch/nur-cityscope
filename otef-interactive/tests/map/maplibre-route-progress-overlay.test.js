import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  disposeRouteProgressOverlaysForMap,
  routeProgressGroupKey,
  syncRouteProgressOverlaysToMap,
} from "../../frontend/src/shared/maplibre-route-progress-overlay.js";

describe("maplibre-route-progress-overlay", () => {
  beforeEach(() => {
    let id = 0;
    vi.stubGlobal("requestAnimationFrame", (cb) => {
      return ++id;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    delete globalThis.MapProjectionConfig;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("routeProgressGroupKey merges hyphen and underscore ציר suffix", () => {
    expect(routeProgressGroupKey("october_7th.חדירה_לישוב-ציר")).toBe("october_7th::חדירה_לישוב");
    expect(routeProgressGroupKey("october_7th.חדירה_לישוב_ציר")).toBe("october_7th::חדירה_לישוב");
  });

  it("syncRouteProgressOverlaysToMap adds GeoJSON source and line layer when trail animation is on", async () => {
    globalThis.MapProjectionConfig = {
      PROJECTION_LAYER_ANIMATIONS: {
        LAYER_OVERRIDES: {
          "october_7th.חדירה_לישוב_ציר": { ENABLE_FLOW: true, MODE: "trail", SPEED: 22 },
        },
      },
    };

    const geojson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [34.5, 31.4],
              [34.51, 31.41],
            ],
          },
        },
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [34.5005, 31.402],
              [34.515, 31.416],
            ],
          },
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => geojson,
      }),
    );

    const lineId = "october_7th__חדירה_לישוב_ציר__line__0";
    const layers = [{ id: lineId, type: "line", source: "src1", paint: { "line-color": "#ff0000" } }];
    const sources = { src1: { type: "vector" } };

    const map = {
      getStyle: vi.fn(() => ({ layers, sources })),
      getLayer: vi.fn((id) => layers.find((l) => l.id === id)),
      getSource: vi.fn((id) => sources[id]),
      getPaintProperty: vi.fn((id, prop) => {
        if (id === lineId && prop === "line-color") return "#ff0000";
        if (id === lineId && prop === "line-width") return 3;
        if (id === lineId && prop === "line-opacity") return 1;
        return undefined;
      }),
      setPaintProperty: vi.fn(),
      removePaintProperty: vi.fn(),
      addSource: vi.fn((sid, spec) => {
        sources[sid] = spec;
      }),
      addLayer: vi.fn((spec) => {
        if (spec && spec.id) {
          layers.push({
            id: spec.id,
            type: spec.type,
            source: spec.source,
            paint: spec.paint || {},
          });
        }
      }),
      removeLayer: vi.fn((lid) => {
        const i = layers.findIndex((l) => l.id === lid);
        if (i >= 0) layers.splice(i, 1);
      }),
      removeSource: vi.fn((sid) => {
        delete sources[sid];
      }),
    };

    const layerGroups = [
      {
        id: "october_7th",
        enabled: true,
        layers: [{ id: "חדירה_לישוב_ציר", enabled: true }],
      },
    ];

    await syncRouteProgressOverlaysToMap(
      map,
      { "october_7th.חדירה_לישוב-ציר": true },
      layerGroups,
      {
        getLayerDataUrl: () => "https://example.com/route.geojson",
      },
    );

    expect(fetch).toHaveBeenCalled();
    expect(map.addSource).toHaveBeenCalled();
    const addSrc = map.addSource.mock.calls[0];
    expect(addSrc[1].type).toBe("geojson");
    expect(addSrc[1].lineMetrics).toBe(true);
    expect(map.addLayer).toHaveBeenCalled();
    const addLy = map.addLayer.mock.calls[0][0];
    expect(addLy.type).toBe("line");
    expect(addLy.paint["line-gradient"]).toBeDefined();
    expect(map.addLayer.mock.calls.some((c) => c[0] && c[0].type === "circle")).toBe(true);
    const headSource = map.addSource.mock.calls.find((c) => String(c[0]).endsWith("__head"));
    expect(headSource).toBeTruthy();
    expect(headSource[1].data.features.length).toBe(2);
    expect(map.setPaintProperty).toHaveBeenCalledWith(lineId, "line-opacity", 0);

    disposeRouteProgressOverlaysForMap(map);
    expect(map.removeLayer).toHaveBeenCalled();
    expect(map.removeSource).toHaveBeenCalled();
  });

  it("uses visibilityLayerGroups for enabled check when layerGroups is GIS-filtered empty", async () => {
    globalThis.MapProjectionConfig = {
      PROJECTION_LAYER_ANIMATIONS: {
        LAYER_OVERRIDES: {
          "october_7th.חדירה_לישוב_ציר": { ENABLE_FLOW: true, MODE: "trail", SPEED: 22 },
        },
      },
    };

    const geojson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [34.5, 31.4],
              [34.51, 31.41],
            ],
          },
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => geojson,
      }),
    );

    const lineId = "october_7th__חדירה_לישוב_ציר__line__0";
    const layers = [{ id: lineId, type: "line", source: "src1", paint: { "line-color": "#ff0000" } }];
    const sources = { src1: { type: "vector" } };

    const map = {
      getStyle: vi.fn(() => ({ layers, sources })),
      getLayer: vi.fn((id) => layers.find((l) => l.id === id)),
      getSource: vi.fn((id) => sources[id]),
      getPaintProperty: vi.fn((id, prop) => {
        if (id === lineId && prop === "line-color") return "#ff0000";
        if (id === lineId && prop === "line-width") return 3;
        if (id === lineId && prop === "line-opacity") return 1;
        return undefined;
      }),
      setPaintProperty: vi.fn(),
      removePaintProperty: vi.fn(),
      addSource: vi.fn((sid, spec) => {
        sources[sid] = spec;
      }),
      addLayer: vi.fn((spec) => {
        if (spec && spec.id) {
          layers.push({
            id: spec.id,
            type: spec.type,
            source: spec.source,
            paint: spec.paint || {},
          });
        }
      }),
      removeLayer: vi.fn((lid) => {
        const i = layers.findIndex((l) => l.id === lid);
        if (i >= 0) layers.splice(i, 1);
      }),
      removeSource: vi.fn((sid) => {
        delete sources[sid];
      }),
    };

    const rawVisibility = [
      {
        id: "october_7th",
        enabled: true,
        layers: [{ id: "חדירה_לישוב_ציר", enabled: true }],
      },
    ];

    await syncRouteProgressOverlaysToMap(
      map,
      { "october_7th.חדירה_לישוב-ציר": true },
      [],
      {
        getLayerDataUrl: () => "https://example.com/route.geojson",
        visibilityLayerGroups: rawVisibility,
      },
    );

    expect(fetch).toHaveBeenCalled();
    expect(map.addSource).toHaveBeenCalled();
    disposeRouteProgressOverlaysForMap(map);
  });

  it("creates overlay when route layer is enabled but group.enabled is false", async () => {
    globalThis.MapProjectionConfig = {
      PROJECTION_LAYER_ANIMATIONS: {
        LAYER_OVERRIDES: {
          "october_7th.חדירה_לישוב_ציר": { ENABLE_FLOW: true, MODE: "trail", SPEED: 22 },
        },
      },
    };

    const geojson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: [
              [34.5, 31.4],
              [34.51, 31.41],
            ],
          },
        },
      ],
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => geojson,
      }),
    );

    const lineId = "october_7th__חדירה_לישוב_ציר__line__0";
    const layers = [{ id: lineId, type: "line", source: "src1", paint: { "line-color": "#ff0000" } }];
    const sources = { src1: { type: "vector" } };

    const map = {
      getStyle: vi.fn(() => ({ layers, sources })),
      getLayer: vi.fn((id) => layers.find((l) => l.id === id)),
      getSource: vi.fn((id) => sources[id]),
      getPaintProperty: vi.fn((id, prop) => {
        if (id === lineId && prop === "line-color") return "#ff0000";
        if (id === lineId && prop === "line-width") return 3;
        if (id === lineId && prop === "line-opacity") return 1;
        return undefined;
      }),
      setPaintProperty: vi.fn(),
      removePaintProperty: vi.fn(),
      addSource: vi.fn((sid, spec) => {
        sources[sid] = spec;
      }),
      addLayer: vi.fn((spec) => {
        if (spec && spec.id) {
          layers.push({
            id: spec.id,
            type: spec.type,
            source: spec.source,
            paint: spec.paint || {},
          });
        }
      }),
      removeLayer: vi.fn((lid) => {
        const i = layers.findIndex((l) => l.id === lid);
        if (i >= 0) layers.splice(i, 1);
      }),
      removeSource: vi.fn((sid) => {
        delete sources[sid];
      }),
    };

    const rawVisibility = [
      {
        id: "october_7th",
        enabled: false,
        layers: [{ id: "חדירה_לישוב_ציר", enabled: true }],
      },
    ];

    await syncRouteProgressOverlaysToMap(
      map,
      { "october_7th.חדירה_לישוב-ציר": true },
      [],
      {
        getLayerDataUrl: () => "https://example.com/route.geojson",
        visibilityLayerGroups: rawVisibility,
      },
    );

    expect(fetch).toHaveBeenCalled();
    expect(map.addSource).toHaveBeenCalled();
    disposeRouteProgressOverlaysForMap(map);
  });
});
