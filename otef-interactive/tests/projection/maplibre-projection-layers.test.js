import { beforeEach, describe, expect, it, vi } from "vitest";

const { applyLayerGroupsToMapMock } = vi.hoisted(() => ({
  applyLayerGroupsToMapMock: vi.fn(),
}));

vi.mock("../../frontend/src/map/maplibre-layer-manager.js", () => ({
  applyLayerGroupsToMap: applyLayerGroupsToMapMock,
}));

const registryMock = vi.hoisted(() => {
  const r = {
    getLayerConfig: vi.fn(),
    getLayerMaskConfig: vi.fn((id) => {
      const c = r.getLayerConfig(id);
      return c?.mask ?? null;
    }),
    getLayerMaskAssetUrl: vi.fn((id, mask) => {
      if (!mask?.file) return null;
      const packId = mask.packId || (id && String(id).split(".")[0]) || null;
      if (!packId) return null;
      return `https://example.test/processed/${packId}/${mask.file}`;
    }),
  };
  return r;
});

vi.mock("../../frontend/src/shared/layer-registry.js", () => ({
  default: registryMock,
}));

import {
  addWmtsSource,
  syncProjectionLayers,
} from "../../frontend/src/projection/maplibre-projection-layers.js";

const originalFetch = globalThis.fetch;

/** Drain microtasks so async masked-WMTS paths complete in tests. */
function flushPromises() {
  return Promise.resolve().then(() => Promise.resolve());
}

function createMapMock() {
  const sources = new Set();
  const layers = new Set();

  return {
    addSource: vi.fn((sourceId) => {
      sources.add(sourceId);
    }),
    getSource: vi.fn((sourceId) => (sources.has(sourceId) ? { id: sourceId } : undefined)),
    removeSource: vi.fn((sourceId) => {
      sources.delete(sourceId);
    }),
    addLayer: vi.fn((layerDef) => {
      layers.add(layerDef.id);
    }),
    getLayer: vi.fn((layerId) => (layers.has(layerId) ? { id: layerId } : undefined)),
    removeLayer: vi.fn((layerId) => {
      layers.delete(layerId);
    }),
    setPaintProperty: vi.fn(),
    setLayoutProperty: vi.fn(),
    _sources: sources,
    _layers: layers,
  };
}

describe("maplibre-projection-layers", () => {
  beforeEach(() => {
    globalThis.fetch = originalFetch;
    applyLayerGroupsToMapMock.mockClear();
    registryMock.getLayerConfig.mockReset();
    registryMock.getLayerMaskConfig.mockClear();
    registryMock.getLayerMaskAssetUrl.mockClear();
    globalThis.proj4 = vi.fn((from, to, coords) => {
      const f = String(from);
      const t = String(to);
      if (f.includes("2039") && t.includes("4326")) {
        return [coords[0] / 200000 + 34.2, coords[1] / 200000 + 31.2];
      }
      if (f.includes("4326") && t.includes("2039")) {
        return [(coords[0] - 34.2) * 200000, (coords[1] - 31.2) * 200000];
      }
      return coords;
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("only resolves WMTS for rows with valid group and layer ids (no malformed fullIds)", () => {
    const map = createMapMock();
    const fullId = "proj.wmts_base";
    registryMock.getLayerConfig.mockImplementation((id) => {
      if (String(id).includes("undefined") || id === ".wmts_base" || id === "proj.") {
        return { format: "wmts", wmts: { urlTemplate: "https://bad.com/{z}/{x}/{y}" } };
      }
      if (id === fullId) {
        return {
          fullId,
          format: "wmts",
          wmts: { urlTemplate: "https://example.com/{z}/{x}/{y}.png" },
        };
      }
      return { format: "geojson" };
    });

    syncProjectionLayers(map, [
      { layers: [{ id: "wmts_base", enabled: true }] },
      { id: "proj", layers: [{ id: "wmts_base", enabled: true }] },
    ]);

    expect(map.addSource).toHaveBeenCalledTimes(1);
    expect(map.addSource).toHaveBeenCalledWith(
      `wmts__${fullId}`,
      expect.objectContaining({ type: "raster" }),
    );
  });

  it("syncProjectionLayers applies base layers without WMTS then adds WMTS source", () => {
    const map = createMapMock();
    const fullId = "proj.wmts_base";
    registryMock.getLayerConfig.mockImplementation((id) => {
      if (id === fullId) {
        return {
          fullId,
          groupId: "proj",
          id: "wmts_base",
          format: "wmts",
          wmts: { urlTemplate: "https://example.com/{z}/{x}/{y}.png", opacity: 0.9 },
        };
      }
      return { format: "geojson" };
    });

    const groups = [{ id: "proj", layers: [{ id: "wmts_base", enabled: true }] }];
    syncProjectionLayers(map, groups);

    expect(applyLayerGroupsToMapMock).toHaveBeenCalledTimes(1);
    const passedGroups = applyLayerGroupsToMapMock.mock.calls[0][1];
    expect(passedGroups[0].layers[0].enabled).toBe(false);

    expect(map.addSource).toHaveBeenCalledWith(
      `wmts__${fullId}`,
      expect.objectContaining({ type: "raster", tiles: ["https://example.com/{z}/{x}/{y}.png"] }),
    );
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: `wmts__${fullId}__raster`, type: "raster" }),
    );
  });

  it("with group disabled and WMTS layer enabled, still adds WMTS; applyLayerGroupsToMap still sees WMTS off in clone", () => {
    const map = createMapMock();
    const fullId = "proj.wmts_base";
    registryMock.getLayerConfig.mockImplementation((id) => {
      if (id === fullId) {
        return {
          fullId,
          groupId: "proj",
          id: "wmts_base",
          format: "wmts",
          wmts: { urlTemplate: "https://example.com/{z}/{x}/{y}.png", opacity: 0.9 },
        };
      }
      return { format: "geojson" };
    });

    const groups = [
      { id: "proj", enabled: false, layers: [{ id: "wmts_base", enabled: true }] },
    ];
    syncProjectionLayers(map, groups);

    expect(applyLayerGroupsToMapMock).toHaveBeenCalledTimes(1);
    const passedGroups = applyLayerGroupsToMapMock.mock.calls[0][1];
    expect(passedGroups[0].enabled).toBe(false);
    expect(passedGroups[0].layers[0].enabled).toBe(false);

    expect(map.addSource).toHaveBeenCalledWith(
      `wmts__${fullId}`,
      expect.objectContaining({ type: "raster", tiles: ["https://example.com/{z}/{x}/{y}.png"] }),
    );
    expect(map.addLayer).toHaveBeenCalledWith(
      expect.objectContaining({ id: `wmts__${fullId}__raster`, type: "raster" }),
    );
  });

  it("syncProjectionLayers removes WMTS source and layer when disabled", () => {
    const map = createMapMock();
    const fullId = "proj.wmts_base";
    registryMock.getLayerConfig.mockImplementation((id) => {
      if (id === fullId) {
        return {
          fullId,
          groupId: "proj",
          id: "wmts_base",
          format: "wmts",
          wmts: { urlTemplate: "https://example.com/t/{z}/{x}/{y}", opacity: 1 },
        };
      }
      return { format: "geojson" };
    });

    const enabled = [{ id: "proj", layers: [{ id: "wmts_base", enabled: true }] }];
    const disabled = [{ id: "proj", layers: [{ id: "wmts_base", enabled: false }] }];

    syncProjectionLayers(map, enabled);
    expect(map._sources.has(`wmts__${fullId}`)).toBe(true);
    expect(map._layers.has(`wmts__${fullId}__raster`)).toBe(true);

    syncProjectionLayers(map, disabled);

    expect(map.removeLayer).toHaveBeenCalledWith(`wmts__${fullId}__raster`);
    expect(map.removeSource).toHaveBeenCalledWith(`wmts__${fullId}`);
    expect(map._sources.has(`wmts__${fullId}`)).toBe(false);
    expect(map._layers.has(`wmts__${fullId}__raster`)).toBe(false);
  });

  it("addWmtsSource does not track fullId when addSource throws", () => {
    const map = createMapMock();
    const fullId = "g.w";
    map.addSource.mockImplementation(() => {
      throw new Error("addSource failed");
    });

    addWmtsSource(map, {
      fullId,
      groupId: "g",
      id: "w",
      wmts: { urlTemplate: "https://x/{z}/{x}/{y}" },
    });

    syncProjectionLayers(map, []);

    expect(map.removeLayer).not.toHaveBeenCalled();
    expect(map.removeSource).not.toHaveBeenCalled();
  });

  it("addWmtsSource rolls back source when addLayer throws", () => {
    const map = createMapMock();
    const fullId = "g.w";
    map.addLayer.mockImplementation(() => {
      throw new Error("addLayer failed");
    });

    addWmtsSource(map, {
      fullId,
      groupId: "g",
      id: "w",
      wmts: { urlTemplate: "https://x/{z}/{x}/{y}" },
    });

    expect(map._sources.has(`wmts__${fullId}`)).toBe(false);
    expect(map._layers.has(`wmts__${fullId}__raster`)).toBe(false);
    expect(map.removeSource).toHaveBeenCalledWith(`wmts__${fullId}`);
  });

  it("retries WMTS add on a later sync after addSource failure", () => {
    const map = createMapMock();
    const fullId = "proj.wmts_base";
    registryMock.getLayerConfig.mockImplementation((id) => {
      if (id === fullId) {
        return {
          fullId,
          groupId: "proj",
          id: "wmts_base",
          format: "wmts",
          wmts: { urlTemplate: "https://example.com/{z}/{x}/{y}.png" },
        };
      }
      return { format: "geojson" };
    });

    let addSourceCalls = 0;
    map.addSource.mockImplementation((sourceId) => {
      addSourceCalls += 1;
      if (addSourceCalls === 1) {
        throw new Error("transient");
      }
      map._sources.add(sourceId);
    });

    const groups = [{ id: "proj", layers: [{ id: "wmts_base", enabled: true }] }];
    syncProjectionLayers(map, groups);
    expect(addSourceCalls).toBe(1);
    expect(map._sources.has(`wmts__${fullId}`)).toBe(false);

    map.addSource.mockImplementation((sourceId) => {
      map._sources.add(sourceId);
    });
    syncProjectionLayers(map, groups);
    expect(map._sources.has(`wmts__${fullId}`)).toBe(true);
    expect(map._layers.has(`wmts__${fullId}__raster`)).toBe(true);
  });

  it("updates opacity when WMTS source and layer already exist", () => {
    const map = createMapMock();
    const fullId = "g.w";
    const sourceId = `wmts__${fullId}`;
    const layerId = `${sourceId}__raster`;
    map._sources.add(sourceId);
    map._layers.add(layerId);

    addWmtsSource(map, {
      fullId,
      wmts: { urlTemplate: "https://x/{z}/{x}/{y}", opacity: 0.5 },
    });

    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(map.setPaintProperty).toHaveBeenCalledWith(layerId, "raster-opacity", 0.5);
    expect(map.setLayoutProperty).toHaveBeenCalledWith(layerId, "visibility", "visible");
  });

  it("masked WMTS (include) fetches mask GeoJSON and sets raster bounds", async () => {
    const map = createMapMock();
    const fullId = "gaza.satellite_imagery";
    const maskGeo = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [34.2, 31.2],
                [34.5, 31.2],
                [34.5, 31.5],
                [34.2, 31.5],
                [34.2, 31.2],
              ],
            ],
          },
        },
      ],
    };
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(maskGeo),
      }),
    );

    registryMock.getLayerConfig.mockImplementation((id) => {
      if (id === fullId) {
        return {
          fullId,
          groupId: "gaza",
          id: "satellite_imagery",
          format: "wmts",
          wmts: { urlTemplate: "https://tiles.example/{z}/{x}/{y}", opacity: 0.2 },
          mask: { type: "geojson", file: "gaza_boundary.geojson" },
        };
      }
      return { format: "geojson" };
    });

    syncProjectionLayers(map, [{ id: "gaza", layers: [{ id: "satellite_imagery", enabled: true }] }]);
    await flushPromises();

    expect(globalThis.fetch).toHaveBeenCalled();
    expect(map.addSource).toHaveBeenCalledWith(
      `wmts__${fullId}`,
      expect.objectContaining({
        type: "raster",
        bounds: expect.any(Array),
      }),
    );
    expect(map.addSource.mock.calls[0][1].bounds.length).toBe(4);
  });

  it("mask.exclude still loads mask GeoJSON and sets raster bounds (bbox cap only, not a polygon hole)", async () => {
    const map = createMapMock();
    const fullId = "projector_base.satellite_imagery";
    const maskGeo = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [34.2, 31.2],
                [34.4, 31.2],
                [34.4, 31.4],
                [34.2, 31.4],
                [34.2, 31.2],
              ],
            ],
          },
        },
      ],
    };
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(maskGeo),
      }),
    );

    registryMock.getLayerConfig.mockImplementation((id) => {
      if (id === fullId) {
        return {
          fullId,
          groupId: "projector_base",
          id: "satellite_imagery",
          format: "wmts",
          wmts: { urlTemplate: "https://tiles.example/{z}/{x}/{y}", opacity: 0.2 },
          mask: { type: "geojson", file: "gaza_boundary.geojson", packId: "gaza", exclude: true },
        };
      }
      return { format: "geojson" };
    });

    addWmtsSource(map, registryMock.getLayerConfig(fullId));
    await flushPromises();

    expect(globalThis.fetch).toHaveBeenCalled();
    expect(map.addSource).toHaveBeenCalledWith(
      `wmts__${fullId}`,
      expect.objectContaining({
        type: "raster",
        tiles: ["https://tiles.example/{z}/{x}/{y}"],
        bounds: expect.any(Array),
      }),
    );
    expect(map.addSource.mock.calls[0][1].bounds.length).toBe(4);
  });

  it("masked WMTS omitted when mask asset URL cannot be resolved (fail closed)", async () => {
    const map = createMapMock();
    const fullId = "proj.wmts_masked";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    registryMock.getLayerConfig.mockImplementation((id) => {
      if (id === fullId) {
        return {
          fullId,
          groupId: "proj",
          id: "wmts_masked",
          format: "wmts",
          wmts: { urlTemplate: "https://tiles.example/{z}/{x}/{y}" },
          mask: { type: "geojson" },
        };
      }
      return { format: "geojson" };
    });

    addWmtsSource(map, registryMock.getLayerConfig(fullId));
    await flushPromises();

    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("fail closed"));
    warn.mockRestore();
  });

  it("masked WMTS omitted when mask fetch is not ok (fail closed)", async () => {
    const map = createMapMock();
    const fullId = "gaza.satellite_imagery";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 500,
      }),
    );

    registryMock.getLayerConfig.mockImplementation((id) => {
      if (id === fullId) {
        return {
          fullId,
          groupId: "gaza",
          id: "satellite_imagery",
          format: "wmts",
          wmts: { urlTemplate: "https://tiles.example/{z}/{x}/{y}" },
          mask: { type: "geojson", file: "gaza_boundary.geojson" },
        };
      }
      return { format: "geojson" };
    });

    syncProjectionLayers(map, [{ id: "gaza", layers: [{ id: "satellite_imagery", enabled: true }] }]);
    await flushPromises();

    expect(map._sources.has(`wmts__${fullId}`)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("fail closed"));
    warn.mockRestore();
  });

  it("masked WMTS omitted when mask GeoJSON produces no bbox (fail closed)", async () => {
    const map = createMapMock();
    const fullId = "gaza.satellite_imagery";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ type: "FeatureCollection", features: [] }),
      }),
    );

    registryMock.getLayerConfig.mockImplementation((id) => {
      if (id === fullId) {
        return {
          fullId,
          groupId: "gaza",
          id: "satellite_imagery",
          format: "wmts",
          wmts: { urlTemplate: "https://tiles.example/{z}/{x}/{y}" },
          mask: { type: "geojson", file: "gaza_boundary.geojson" },
        };
      }
      return { format: "geojson" };
    });

    syncProjectionLayers(map, [{ id: "gaza", layers: [{ id: "satellite_imagery", enabled: true }] }]);
    await flushPromises();

    expect(map._sources.has(`wmts__${fullId}`)).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("fail closed"));
    warn.mockRestore();
  });

  it("failure-safe: disabling masked WMTS before mask fetch completes does not leave sources", async () => {
    const map = createMapMock();
    const fullId = "gaza.satellite_imagery";
    let releaseFetch;
    const fetchGate = new Promise((r) => {
      releaseFetch = r;
    });

    globalThis.fetch = vi.fn(() =>
      fetchGate.then(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  geometry: {
                    type: "Polygon",
                    coordinates: [
                      [
                        [34.2, 31.2],
                        [34.3, 31.2],
                        [34.3, 31.3],
                        [34.2, 31.3],
                        [34.2, 31.2],
                      ],
                    ],
                  },
                },
              ],
            }),
        }),
      ),
    );

    registryMock.getLayerConfig.mockImplementation((id) => {
      if (id === fullId) {
        return {
          fullId,
          groupId: "gaza",
          id: "satellite_imagery",
          format: "wmts",
          wmts: { urlTemplate: "https://tiles.example/{z}/{x}/{y}", opacity: 0.2 },
          mask: { type: "geojson", file: "gaza_boundary.geojson" },
        };
      }
      return { format: "geojson" };
    });

    const enabled = [{ id: "gaza", layers: [{ id: "satellite_imagery", enabled: true }] }];
    const disabled = [{ id: "gaza", layers: [{ id: "satellite_imagery", enabled: false }] }];

    syncProjectionLayers(map, enabled);
    syncProjectionLayers(map, disabled);
    releaseFetch();
    await flushPromises();

    expect(map._sources.has(`wmts__${fullId}`)).toBe(false);
    expect(map._layers.has(`wmts__${fullId}__raster`)).toBe(false);
  });
});
