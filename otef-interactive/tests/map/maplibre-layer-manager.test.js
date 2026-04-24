import { beforeEach, describe, expect, it, vi } from "vitest";

const { bridgeMock, registryMock } = vi.hoisted(() => ({
  bridgeMock: {
    irToMapLibreLayers: vi.fn(),
  },
  registryMock: {
    getLayerConfig: vi.fn(),
    getLayerDataUrl: vi.fn(),
    getLayerPMTilesUrl: vi.fn(),
  },
}));

vi.mock("../../frontend/src/shared/maplibre-style-bridge.js", () => ({
  irToMapLibreLayers: bridgeMock.irToMapLibreLayers,
}));

vi.mock("../../frontend/src/shared/layer-registry.js", () => ({
  default: registryMock,
}));

import {
  applyLayerGroupsToMap,
  clearAllLayers,
} from "../../frontend/src/map/maplibre-layer-manager.js";

function createMapMock() {
  const sources = new Set();
  const layers = new Set();

  const map = {
    addSource: vi.fn((sourceId) => {
      sources.add(sourceId);
    }),
    getSource: vi.fn((sourceId) =>
      sources.has(sourceId) ? { id: sourceId } : undefined,
    ),
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
    _layers: layers,
  };

  return map;
}

const enabledGroups = [{ id: "group_a", layers: [{ id: "layer_1", enabled: true }] }];

describe("maplibre-layer-manager", () => {
  beforeEach(() => {
    bridgeMock.irToMapLibreLayers.mockReset();
    registryMock.getLayerConfig.mockReset();
    registryMock.getLayerDataUrl.mockReset();
    registryMock.getLayerPMTilesUrl.mockReset();

    registryMock.getLayerConfig.mockReturnValue({ format: "geojson" });
    registryMock.getLayerDataUrl.mockReturnValue("/data/layer.geojson");
  });

  it("rolls back source and retries when no style layer is added", () => {
    const map = createMapMock();
    bridgeMock.irToMapLibreLayers.mockReturnValue([{ id: "group_a.layer_1-fill", type: "fill" }]);
    map.addLayer.mockImplementation(() => {
      throw new Error("addLayer failed");
    });

    applyLayerGroupsToMap(map, enabledGroups);
    applyLayerGroupsToMap(map, enabledGroups);

    expect(map.addSource).toHaveBeenCalledTimes(2);
    expect(map.removeSource).toHaveBeenCalledTimes(2);
  });

  it("tracks state per map instance (no cross-map leakage)", () => {
    const mapA = createMapMock();
    const mapB = createMapMock();
    bridgeMock.irToMapLibreLayers.mockReturnValue([{ id: "group_a.layer_1-fill", type: "fill" }]);

    applyLayerGroupsToMap(mapA, enabledGroups);
    applyLayerGroupsToMap(mapB, enabledGroups);

    expect(mapA.addSource).toHaveBeenCalledTimes(1);
    expect(mapB.addSource).toHaveBeenCalledTimes(1);
  });

  it("clearAllLayers removes source even when style layer is already orphaned", () => {
    const map = createMapMock();
    bridgeMock.irToMapLibreLayers.mockReturnValue([{ id: "group_a.layer_1-fill", type: "fill" }]);

    applyLayerGroupsToMap(map, enabledGroups);

    // Simulate out-of-band style mutation where the layer was removed elsewhere.
    map._layers.clear();
    clearAllLayers(map);

    expect(map.removeSource).toHaveBeenCalledWith("group_a.layer_1");
  });
});
