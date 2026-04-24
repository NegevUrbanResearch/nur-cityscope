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
  const images = new Set();

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
    hasImage: vi.fn((imageId) => images.has(imageId)),
    addImage: vi.fn((imageId) => {
      images.add(imageId);
    }),
    removeImage: vi.fn((imageId) => {
      images.delete(imageId);
    }),
    addLayer: vi.fn((layerDef) => {
      layers.add(layerDef.id);
    }),
    getLayer: vi.fn((layerId) => (layers.has(layerId) ? { id: layerId } : undefined)),
    removeLayer: vi.fn((layerId) => {
      layers.delete(layerId);
    }),
    _layers: layers,
    _images: images,
  };

  return map;
}

const enabledGroups = [{ id: "group_a", layers: [{ id: "layer_1", enabled: true }] }];

function withCanvasStub(run) {
  const prevDoc = globalThis.document;
  const ctxStub = {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    getImageData: (x, y, w, h) => ({
      width: w,
      height: h,
      data: new Uint8ClampedArray(w * h * 4),
    }),
  };
  globalThis.document = {
    createElement: (tag) => {
      if (tag !== "canvas") return {};
      return {
        width: 0,
        height: 0,
        getContext: (t) => (t === "2d" ? ctxStub : null),
      };
    },
  };

  try {
    run();
  } finally {
    if (prevDoc === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = prevDoc;
    }
  }
}

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

  it("registers hatch pattern images and strips metadata before addLayer", () => {
    const map = createMapMock();
    const patternId = "hatch_#f00_0_8_1";
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: "group_a.layer_1__fill",
        type: "fill",
        paint: { "fill-pattern": patternId },
        layout: {},
        _hatchPattern: {
          patternId,
          color: "#f00",
          rotation: 0,
          separation: 8,
          width: 1,
        },
      },
    ]);
    withCanvasStub(() => {
      applyLayerGroupsToMap(map, enabledGroups);
    });

    expect(map.hasImage).toHaveBeenCalledWith(patternId);
    expect(map.addImage).toHaveBeenCalledWith(
      patternId,
      expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }),
    );
    const added = map.addLayer.mock.calls.find(
      (c) => c[0]?.id === "group_a.layer_1__fill",
    );
    expect(added).toBeDefined();
    expect(added[0]).not.toHaveProperty("_hatchPattern");
    expect(added[0]).not.toHaveProperty("_hatchPatterns");
  });

  it("removes hatch image when layer is disabled and no longer referenced", () => {
    const map = createMapMock();
    const patternId = "hatch_#f00_0_8_1";
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: "group_a.layer_1__fill",
        type: "fill",
        paint: { "fill-pattern": patternId },
        layout: {},
        _hatchPattern: {
          patternId,
          color: "#f00",
          rotation: 0,
          separation: 8,
          width: 1,
        },
      },
    ]);

    withCanvasStub(() => {
      applyLayerGroupsToMap(map, enabledGroups);
      applyLayerGroupsToMap(map, []);
    });

    expect(map.addImage).toHaveBeenCalledWith(
      patternId,
      expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }),
    );
    expect(map.removeImage).toHaveBeenCalledWith(patternId);
    expect(map._images.has(patternId)).toBe(false);
  });

  it("rolls back layers, source, and hatch refs when hatch registration fails", () => {
    const map = createMapMock();
    const firstPattern = "hatch_#f00_0_8_1";
    const failingPattern = "hatch_#0f0_45_10_2";
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: "group_a.layer_1__fill_a",
        type: "fill",
        paint: { "fill-pattern": firstPattern },
        layout: {},
        _hatchPattern: {
          patternId: firstPattern,
          color: "#f00",
          rotation: 0,
          separation: 8,
          width: 1,
        },
      },
      {
        id: "group_a.layer_1__fill_b",
        type: "fill",
        paint: { "fill-pattern": failingPattern },
        layout: {},
        _hatchPattern: {
          patternId: failingPattern,
          color: "#0f0",
          rotation: 45,
          separation: 10,
          width: 2,
        },
      },
    ]);

    map.addImage.mockImplementation((imageId) => {
      if (imageId === failingPattern) {
        throw new Error("boom");
      }
      map._images.add(imageId);
    });

    withCanvasStub(() => {
      applyLayerGroupsToMap(map, enabledGroups);
      applyLayerGroupsToMap(map, enabledGroups);
    });

    expect(map.addSource).toHaveBeenCalledTimes(2);
    expect(map.removeSource).toHaveBeenCalledTimes(2);
    expect(map.removeLayer).toHaveBeenCalledWith("group_a.layer_1__fill_a");
    expect(map.removeImage).toHaveBeenCalledWith(firstPattern);
    expect(map._images.has(firstPattern)).toBe(false);
  });

  it("skips format image layers (DOM-backed) and does not retry addSource on each sync", () => {
    const map = createMapMock();
    const imageGroups = [{ id: "projector_base", layers: [{ id: "model_base", enabled: true }] }];
    registryMock.getLayerConfig.mockReturnValue({ format: "image" });

    applyLayerGroupsToMap(map, imageGroups);
    applyLayerGroupsToMap(map, imageGroups);

    expect(map.addSource).not.toHaveBeenCalled();
    expect(bridgeMock.irToMapLibreLayers).not.toHaveBeenCalled();
  });

  it("skips geometryType image layers without MapLibre sources", () => {
    const map = createMapMock();
    const imageGroups = [{ id: "g", layers: [{ id: "x", enabled: true }] }];
    registryMock.getLayerConfig.mockReturnValue({ format: "geojson", geometryType: "image" });

    applyLayerGroupsToMap(map, imageGroups);

    expect(map.addSource).not.toHaveBeenCalled();
  });
});
