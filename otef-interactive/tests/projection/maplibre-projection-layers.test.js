import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import {
  LAYER_FADE_MS,
  LAYER_FADE_READY_TIMEOUT_MS,
  getLayerLifecycleRuntime,
} from "../../frontend/src/shared/layer-lifecycle-fade.js";

it('suppresses only projection name symbols after layer installation when Canvas is active', () => {
  const visibility = new Map();
  const map = { getLayer: (id) => ['nli__people_names__labels', 'nli-name-field-labels', 'nli-name-field-selected', 'other'].includes(id) ? { id } : null,
    setLayoutProperty: (id, key, value) => visibility.set(id, [key, value]) };
  syncProjectionLayers(map, [], { suppressCanvasNameSymbols: true });
  expect([...visibility.keys()]).toEqual(['nli__people_names__labels', 'nli-name-field-labels', 'nli-name-field-selected']);
  expect([...visibility.values()]).toEqual(Array(3).fill(['visibility', 'none']));
  visibility.clear();
  syncProjectionLayers(map, [], {});
  expect(visibility.size).toBe(0);
});

it('suppresses only the settlement text layer in browser outputs', () => {
  const visibility = new Map();
  const removed = [];
  const map = {
    getLayer: (id) => ['projector_base__שמות_יישובים__labels', 'projector_base__שמות_יישובים__glow', 'other'].includes(id) ? { id } : null,
    getSource: (id) => (id === 'projector_base.שמות_יישובים' ? { id } : null),
    setLayoutProperty: (id, key, value) => visibility.set(id, [key, value]),
    removeLayer: (id) => removed.push(id),
    removeSource: (id) => removed.push(`source:${id}`),
  };
  syncProjectionLayers(map, [], { suppressSettlementSymbols: true });
  expect([...visibility.keys()]).toEqual(['projector_base__שמות_יישובים__labels']);
  expect([...visibility.values()]).toEqual([['visibility', 'none']]);
  expect(removed).toEqual([]);
  expect(map.getSource('projector_base.שמות_יישובים')).toEqual({ id: 'projector_base.שמות_יישובים' });
  expect(map.getLayer('projector_base__שמות_יישובים__glow')).toEqual({ id: 'projector_base__שמות_יישובים__glow' });
});

const originalFetch = globalThis.fetch;

/** Drain microtasks so async masked-WMTS paths complete in tests. */
function flushPromises() {
  return Promise.resolve()
    .then(() => Promise.resolve())
    .then(() => Promise.resolve())
    .then(() => Promise.resolve())
    .then(() => Promise.resolve());
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

  it("syncProjectionLayers forwards transition options into applyLayerGroupsToMap", () => {
    const map = createMapMock();
    const groups = [{ id: "proj", layers: [{ id: "x", enabled: true }] }];
    registryMock.getLayerConfig.mockReturnValue({ format: "geojson" });

    syncProjectionLayers(map, groups, {
      transition: { stageHidden: true, transitionMs: 50 },
    });

    expect(applyLayerGroupsToMapMock).toHaveBeenCalledTimes(1);
    expect(applyLayerGroupsToMapMock.mock.calls[0][2]).toEqual({
      applyProjectionHatchPresentation: true,
      transition: { stageHidden: true, transitionMs: 50 },
    });
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
    expect(applyLayerGroupsToMapMock.mock.calls[0][2]).toEqual({
      applyProjectionHatchPresentation: true,
    });

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
    expect(applyLayerGroupsToMapMock.mock.calls[0][2]).toEqual({
      applyProjectionHatchPresentation: true,
    });

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

  it("drops an in-flight masked WMTS when disable wins before the 100ms mask resolution", async () => {
    const map = createPaintMap();
    const hooks = createLifecycleHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const fullId = "gaza.satellite_imagery";
    const release = holdMaskFetch();
    registryMock.getLayerConfig.mockImplementation((id) => (
      id === fullId ? maskedConfig(fullId) : { format: "geojson" }
    ));
    const enabled = [{ id: "gaza", layers: [{ id: "satellite_imagery", enabled: true }] }];
    const disabled = [{ id: "gaza", layers: [{ id: "satellite_imagery", enabled: false }] }];
    runtime.setDesiredIds([fullId], { durationMs: LAYER_FADE_MS });
    syncProjectionLayers(map, enabled, { lifecycle: { joinBatch: true } });
    hooks.setTime(100);
    runtime.setDesiredIds([], { durationMs: LAYER_FADE_MS });
    syncProjectionLayers(map, disabled, { lifecycle: { joinBatch: true } });
    release.resolve();
    await flushPromises();
    expect(map.getLayer(`wmts__${fullId}__raster`)).toBeFalsy();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("ignores an older masked completion after disable and re-enable, and reuses one pending request", async () => {
    const map = createPaintMap();
    const fullId = "gaza.satellite_imagery";
    const first = holdMaskFetch();
    registryMock.getLayerConfig.mockImplementation((id) => (
      id === fullId ? maskedConfig(fullId) : { format: "geojson" }
    ));
    const enabled = [{ id: "gaza", layers: [{ id: "satellite_imagery", enabled: true }] }];
    const disabled = [{ id: "gaza", layers: [{ id: "satellite_imagery", enabled: false }] }];
    const runtime = getLayerLifecycleRuntime(map, createLifecycleHooks());
    runtime.setDesiredIds([fullId], { durationMs: LAYER_FADE_MS });
    syncProjectionLayers(map, enabled, { lifecycle: { joinBatch: true } });
    syncProjectionLayers(map, enabled, { lifecycle: { joinBatch: true } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    runtime.setDesiredIds([], { durationMs: LAYER_FADE_MS });
    syncProjectionLayers(map, disabled, { lifecycle: { joinBatch: true } });
    const second = holdMaskFetch();
    runtime.setDesiredIds([fullId], { durationMs: LAYER_FADE_MS });
    syncProjectionLayers(map, enabled, { lifecycle: { joinBatch: true } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    first.resolve();
    await flushPromises();
    expect(map.getLayer(`wmts__${fullId}__raster`)).toBeFalsy();
    syncProjectionLayers(map, enabled, { lifecycle: { joinBatch: true } });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    second.resolve();
    await flushPromises();
    expect(map.getLayer(`wmts__${fullId}__raster`)).toBeTruthy();
    expect(map.getPaintProperty(`wmts__${fullId}__raster`, "raster-opacity")).toBe(0);
  });

  it("stages sync and masked rasters at factor 0 and shares a registry deadline", async () => {
    const map = createPaintMap();
    const hooks = createLifecycleHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const syncId = "proj.wmts_base";
    const maskedId = "gaza.satellite_imagery";
    const release = holdMaskFetch();
    registryMock.getLayerConfig.mockImplementation((id) => {
      if (id === syncId) {
        return {
          fullId: syncId,
          format: "wmts",
          wmts: { urlTemplate: "https://example.com/{z}/{x}/{y}.png", opacity: 0.5 },
        };
      }
      if (id === maskedId) return maskedConfig(maskedId);
      return { format: "geojson" };
    });
    map.isSourceLoaded = vi.fn(() => false);
    runtime.setDesiredIds(["borders.ring", syncId, maskedId], { durationMs: LAYER_FADE_MS });
    runtime.stageMapLayer("borders.ring", {
      id: "borders.ring-fill",
      type: "fill",
      paint: { "fill-opacity": 0.8 },
    }, {
      subscribeReady: ({ ready }) => { ready(); return undefined; },
    });
    map.addLayer({ id: "borders.ring-fill", type: "fill", paint: { "fill-opacity": 0 } });
    syncProjectionLayers(map, [
      { id: "proj", layers: [{ id: "wmts_base", enabled: true }] },
      { id: "gaza", layers: [{ id: "satellite_imagery", enabled: true }] },
    ], { lifecycle: { joinBatch: true } });
    expect(applyLayerGroupsToMapMock).toHaveBeenCalledWith(
      map,
      expect.any(Array),
      expect.objectContaining({
        lifecycle: { joinBatch: true },
        transition: expect.objectContaining({ transitionMs: LAYER_FADE_MS }),
      }),
    );
    expect(map.getPaintProperty(`wmts__${syncId}__raster`, "raster-opacity")).toBe(0);
    runtime.commitBatch();
    hooks.flushFrame();
    expect(map.getPaintProperty("borders.ring-fill", "fill-opacity")).toBe(0);
    expect(map.getPaintProperty(`wmts__${syncId}__raster`, "raster-opacity")).toBe(0);

    map.isSourceLoaded.mockReturnValue(true);
    map.emit("sourcedata", { sourceId: `wmts__${syncId}` });
    expect(map.getPaintProperty(`wmts__${syncId}__raster`, "raster-opacity")).toBe(0);
    hooks.setTime(LAYER_FADE_READY_TIMEOUT_MS);
    hooks.fireDueTimers();
    hooks.setTime(LAYER_FADE_READY_TIMEOUT_MS + 300);
    hooks.flushFrame();
    expect(map.getPaintProperty("borders.ring-fill", "fill-opacity")).toBeCloseTo(0.4);
    expect(map.getPaintProperty(`wmts__${syncId}__raster`, "raster-opacity")).toBeCloseTo(0.25);
    expect(map.getLayer(`wmts__${maskedId}__raster`)).toBeFalsy();

    release.resolve();
    await flushPromises();
    expect(map.getPaintProperty(`wmts__${maskedId}__raster`, "raster-opacity")).toBe(0);
    hooks.setTime(LAYER_FADE_READY_TIMEOUT_MS + 600);
    hooks.flushFrame();
    expect(map.getPaintProperty(`wmts__${maskedId}__raster`, "raster-opacity")).toBeCloseTo(0.1);
  });

  it("removes an unloaded WMTS sourcedata listener when the layer is disabled", () => {
    const map = createPaintMap();
    const runtime = getLayerLifecycleRuntime(map, createLifecycleHooks());
    const fullId = "proj.wmts_base";
    registryMock.getLayerConfig.mockImplementation((id) => (
      id === fullId
        ? { fullId, format: "wmts", wmts: { urlTemplate: "https://example.com/{z}/{x}/{y}.png", opacity: 0.5 } }
        : { format: "geojson" }
    ));
    map.isSourceLoaded = vi.fn(() => false);
    const enabled = [{ id: "proj", layers: [{ id: "wmts_base", enabled: true }] }];
    const disabled = [{ id: "proj", layers: [{ id: "wmts_base", enabled: false }] }];
    const joined = { lifecycle: { joinBatch: true } };

    runtime.setDesiredIds([fullId], { durationMs: LAYER_FADE_MS });
    syncProjectionLayers(map, enabled, joined);
    expect(map.on).toHaveBeenCalledWith("sourcedata", expect.any(Function));

    runtime.setDesiredIds([], { durationMs: LAYER_FADE_MS });
    syncProjectionLayers(map, disabled, joined);

    expect(map.off).toHaveBeenCalledWith("sourcedata", expect.any(Function));
  });

  it("does not accumulate unloaded WMTS sourcedata listeners when restaged", () => {
    const map = createPaintMap();
    const runtime = getLayerLifecycleRuntime(map, createLifecycleHooks());
    const fullId = "proj.wmts_base";
    const config = {
      fullId,
      format: "wmts",
      wmts: { urlTemplate: "https://example.com/{z}/{x}/{y}.png", opacity: 0.5 },
    };
    const joined = { lifecycle: { joinBatch: true } };
    map.isSourceLoaded = vi.fn(() => false);
    runtime.setDesiredIds([fullId], { durationMs: LAYER_FADE_MS });

    addWmtsSource(map, config, joined);
    expect(map.listenerCount("sourcedata")).toBe(1);

    map.removeLayer(`wmts__${fullId}__raster`);
    addWmtsSource(map, config, joined);
    expect(map.listenerCount("sourcedata")).toBe(1);

    runtime.dispose();
    expect(map.listenerCount("sourcedata")).toBe(0);
  });

  it("preserves a mounted WMTS factor across disable and re-enable", () => {
    const map = createPaintMap();
    const hooks = createLifecycleHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const fullId = "proj.wmts_base";
    const layerId = `wmts__${fullId}__raster`;
    registryMock.getLayerConfig.mockImplementation((id) => (
      id === fullId
        ? { fullId, format: "wmts", wmts: { urlTemplate: "https://example.com/{z}/{x}/{y}.png", opacity: 0.5 } }
        : { format: "geojson" }
    ));
    const enabled = [{ id: "proj", layers: [{ id: "wmts_base", enabled: true }] }];
    const disabled = [{ id: "proj", layers: [{ id: "wmts_base", enabled: false }] }];
    runtime.setDesiredIds([fullId], { durationMs: LAYER_FADE_MS });
    syncProjectionLayers(map, enabled, { lifecycle: { joinBatch: true } });
    runtime.commitBatch();
    hooks.setTime(LAYER_FADE_MS);
    hooks.flushFrame();
    expect(map.getPaintProperty(layerId, "raster-opacity")).toBeCloseTo(0.5);

    runtime.setDesiredIds([], { durationMs: LAYER_FADE_MS });
    syncProjectionLayers(map, disabled, { lifecycle: { joinBatch: true } });
    runtime.commitBatch();
    hooks.setTime(LAYER_FADE_MS + 300);
    hooks.flushFrame();
    expect(map.getLayer(layerId)).toBeTruthy();
    expect(map.getPaintProperty(layerId, "raster-opacity")).toBeCloseTo(0.25);

    runtime.setDesiredIds([fullId], { durationMs: LAYER_FADE_MS });
    syncProjectionLayers(map, enabled, { lifecycle: { joinBatch: true } });
    runtime.commitBatch();
    expect(map.addSource).toHaveBeenCalledTimes(1);
    hooks.setTime(LAYER_FADE_MS + 600);
    hooks.flushFrame();
    expect(map.getPaintProperty(layerId, "raster-opacity")).toBeCloseTo(0.375);
  });

  it("keeps retained WMTS immediate when the joined duration is zero", () => {
    const map = createPaintMap();
    const fullId = "proj.wmts_base";
    registryMock.getLayerConfig.mockImplementation((id) => (
      id === fullId
        ? { fullId, format: "wmts", wmts: { urlTemplate: "https://example.com/{z}/{x}/{y}.png", opacity: 0.5 } }
        : { format: "geojson" }
    ));
    map.isSourceLoaded = () => false;
    syncProjectionLayers(map, [{ id: "proj", layers: [{ id: "wmts_base", enabled: true }] }], {
      lifecycle: { retainDisabled: true, joinBatch: true },
    });
    expect(map.getPaintProperty(`wmts__${fullId}__raster`, "raster-opacity")).toBe(0.5);
  });

  it("a stale masked completion cannot fail the replacement raster", async () => {
    const map = createPaintMap();
    const hooks = createLifecycleHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const fullId = "gaza.satellite_imagery";
    const layerId = `wmts__${fullId}__raster`;
    const queued = queueMaskFetches();
    map.isSourceLoaded = vi.fn(() => false);
    registryMock.getLayerConfig.mockImplementation((id) => (
      id === fullId ? maskedConfig(fullId) : { format: "geojson" }
    ));
    const enabled = [{ id: "gaza", layers: [{ id: "satellite_imagery", enabled: true }] }];
    const disabled = [{ id: "gaza", layers: [{ id: "satellite_imagery", enabled: false }] }];
    const joined = { lifecycle: { joinBatch: true } };

    runtime.setDesiredIds([fullId], { durationMs: LAYER_FADE_MS });
    syncProjectionLayers(map, enabled, joined);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    runtime.setDesiredIds([], { durationMs: LAYER_FADE_MS });
    syncProjectionLayers(map, disabled, joined);
    runtime.setDesiredIds([fullId], { durationMs: LAYER_FADE_MS });
    syncProjectionLayers(map, enabled, joined);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    queued.resolve(1, { ok: true, json: () => Promise.resolve(maskGeoJson()) });
    await flushPromises();
    expect(map.getLayer(layerId)).toBeTruthy();
    expect(map.getPaintProperty(layerId, "raster-opacity")).toBe(0);

    queued.resolve(0, { ok: false, status: 503, json: async () => ({}) });
    await flushPromises();
    syncProjectionLayers(map, enabled, joined);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);

    map.isSourceLoaded.mockReturnValue(true);
    map.emit("sourcedata", { sourceId: `wmts__${fullId}` });
    runtime.commitBatch();
    hooks.setTime(LAYER_FADE_MS);
    hooks.flushFrame();
    expect(map.getPaintProperty(layerId, "raster-opacity")).toBeCloseTo(0.2);
  });
});

function maskedConfig(fullId) {
  return {
    fullId,
    groupId: "gaza",
    id: "satellite_imagery",
    format: "wmts",
    wmts: { urlTemplate: "https://tiles.example/{z}/{x}/{y}", opacity: 0.2 },
    mask: { type: "geojson", file: "gaza_boundary.geojson" },
  };
}

function maskGeoJson() {
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[[34.2, 31.2], [34.3, 31.2], [34.3, 31.3], [34.2, 31.3], [34.2, 31.2]]],
      },
    }],
  };
}

function holdMaskFetch() {
  let resolve;
  const gate = new Promise((done) => { resolve = done; });
  globalThis.fetch = vi.fn(() => gate.then(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(maskGeoJson()),
  })));
  return { resolve: () => resolve() };
}

function queueMaskFetches() {
  const resolvers = [];
  globalThis.fetch = vi.fn(() => new Promise((resolve) => {
    resolvers.push(resolve);
  }));
  return {
    resolve(index, body) {
      resolvers[index](body);
    },
  };
}

function createLifecycleHooks() {
  let time = 0;
  let frame = null;
  let nextFrameId = 0;
  let nextTimerId = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTime(value) { time = value; },
    requestFrame(callback) {
      nextFrameId += 1;
      frame = { id: nextFrameId, callback };
      return nextFrameId;
    },
    cancelFrame(id) { if (frame?.id === id) frame = null; },
    flushFrame() {
      const current = frame;
      frame = null;
      current?.callback(time);
    },
    setTimer(callback, delay) {
      nextTimerId += 1;
      timers.set(nextTimerId, { callback, at: time + delay });
      return nextTimerId;
    },
    clearTimer(id) { timers.delete(id); },
    fireDueTimers() {
      for (const [id, timer] of [...timers]) {
        if (timer.at <= time) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
  };
}

function createPaintMap() {
  const sources = new Set();
  const layers = new Map();
  const paint = new Map();
  const listeners = new Map();
  const map = {
    addSource: vi.fn((sourceId) => { sources.add(sourceId); }),
    getSource: vi.fn((sourceId) => (sources.has(sourceId) ? { id: sourceId } : undefined)),
    removeSource: vi.fn((sourceId) => { sources.delete(sourceId); }),
    addLayer: vi.fn((layerDef) => {
      layers.set(layerDef.id, layerDef);
      paint.set(layerDef.id, { ...(layerDef.paint || {}) });
    }),
    getLayer: vi.fn((layerId) => layers.get(layerId)),
    removeLayer: vi.fn((layerId) => {
      layers.delete(layerId);
      paint.delete(layerId);
    }),
    setPaintProperty: vi.fn((layerId, key, value) => {
      const current = paint.get(layerId) || {};
      current[key] = value;
      paint.set(layerId, current);
    }),
    getPaintProperty: vi.fn((layerId, key) => paint.get(layerId)?.[key]),
    setLayoutProperty: vi.fn(),
    on: vi.fn((type, listener) => {
      const set = listeners.get(type) || new Set();
      set.add(listener);
      listeners.set(type, set);
    }),
    off: vi.fn((type, listener) => { listeners.get(type)?.delete(listener); }),
    emit(type, event) {
      for (const listener of [...(listeners.get(type) || [])]) listener(event);
    },
    listenerCount(type) {
      return listeners.get(type)?.size || 0;
    },
    _sources: sources,
    _layers: layers,
  };
  return map;
}
