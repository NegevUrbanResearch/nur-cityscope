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
  beginSlideshowStage,
  buildPmtilesUrl,
  clearAllLayers,
  commitSlideshowReveal,
  fadeOutAndRemoveEnabledFullIds,
  getVectorSourceLayerName,
  registerCuratedLayerIds,
  stageLayerHidden,
} from "../../frontend/src/map/maplibre-layer-manager.js";

function createMapMock() {
  const sources = new Set();
  const layers = new Set();
  const images = new Set();
  /** @type {Map<string, Record<string, unknown>>} */
  const paintByLayerId = new Map();

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
      paintByLayerId.delete(layerId);
    }),
    setPaintProperty: vi.fn((layerId, name, value) => {
      if (!paintByLayerId.has(layerId)) {
        paintByLayerId.set(layerId, {});
      }
      paintByLayerId.get(layerId)[name] = value;
    }),
    getPaintProperty: vi.fn((layerId, name) => paintByLayerId.get(layerId)?.[name]),
    _layers: layers,
    _images: images,
    _paintByLayerId: paintByLayerId,
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
    setLineJoin: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
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

  it("rolls back all style layers for fullId when a later addLayer throws", () => {
    const map = createMapMock();
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      { id: "group_a.layer_1-fill", type: "fill" },
      { id: "group_a.layer_1-line", type: "line" },
    ]);
    map.addLayer.mockImplementation((def) => {
      if (def.id === "group_a.layer_1-line") {
        throw new Error("second layer failed");
      }
      map._layers.add(def.id);
    });

    applyLayerGroupsToMap(map, enabledGroups);

    expect(map.removeLayer).toHaveBeenCalledWith("group_a.layer_1-fill");
    expect(map.removeSource).toHaveBeenCalledWith("group_a.layer_1");
    expect(map._layers.has("group_a.layer_1-fill")).toBe(false);
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

  it("applies layer when layer.enabled=true even if group.enabled=false", () => {
    const map = createMapMock();
    bridgeMock.irToMapLibreLayers.mockReturnValue([{ id: "greens.agri-fill", type: "fill" }]);
    applyLayerGroupsToMap(map, [
      { id: "greens", enabled: false, layers: [{ id: "agri", enabled: true }] },
    ]);
    expect(map.addSource).toHaveBeenCalledWith("greens.agri", expect.any(Object));
    expect(map.addLayer).toHaveBeenCalled();
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

  it("registers marker line square images and strips metadata before addLayer", () => {
    const map = createMapMock();
    const imageId = "otef_mlsq_v1_#f00_#0f0_5_1_9";
    const spec = {
      imageId,
      size: 5,
      fill: "#f00",
      stroke: "#0f0",
      strokeWidth: 1,
      side: 9,
    };
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: "group_a.layer_1__ml",
        type: "symbol",
        paint: {},
        layout: { "icon-image": imageId, "symbol-placement": "line" },
        _markerLineSquarePattern: spec,
      },
    ]);
    withCanvasStub(() => {
      applyLayerGroupsToMap(map, enabledGroups);
    });

    expect(map.hasImage).toHaveBeenCalledWith(imageId);
    expect(map.addImage).toHaveBeenCalledWith(
      imageId,
      expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }),
    );
    const added = map.addLayer.mock.calls.find((c) => c[0]?.id === "group_a.layer_1__ml");
    expect(added).toBeDefined();
    expect(added[0]).not.toHaveProperty("_markerLineSquarePattern");
    expect(added[0]).not.toHaveProperty("_markerLineSquarePatterns");
  });

  it("registers all marker line square pattern variants and does not double-ref duplicate ids", () => {
    const map = createMapMock();
    const idA = "otef_mlsq_v1_#a_#b_5_1_9";
    const idB = "otef_mlsq_v1_#c_#d_5_1_9";
    const specA = { imageId: idA, size: 5, fill: "#a", stroke: "#b", strokeWidth: 1, side: 9 };
    const specB = { imageId: idB, size: 5, fill: "#c", stroke: "#d", strokeWidth: 1, side: 9 };
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: "group_a.layer_1__ml_uv",
        type: "symbol",
        paint: {},
        layout: {},
        _markerLineSquarePatterns: [specA, specB, specA],
      },
    ]);
    withCanvasStub(() => {
      applyLayerGroupsToMap(map, enabledGroups);
    });
    expect(map.addImage).toHaveBeenCalledWith(
      idA,
      expect.objectContaining({ width: expect.any(Number) }),
    );
    expect(map.addImage).toHaveBeenCalledWith(
      idB,
      expect.objectContaining({ width: expect.any(Number) }),
    );
    expect(map.addImage.mock.calls.filter((c) => c[0] === idA)).toHaveLength(1);
  });

  it("removes marker line square image when layer is disabled and no longer referenced", () => {
    const map = createMapMock();
    const imageId = "otef_mlsq_v1_#f00_#0f0_5_1_9";
    const spec = {
      imageId,
      size: 5,
      fill: "#f00",
      stroke: "#0f0",
      strokeWidth: 1,
      side: 9,
    };
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: "group_a.layer_1__ml",
        type: "symbol",
        paint: {},
        layout: { "icon-image": imageId, "symbol-placement": "line" },
        _markerLineSquarePattern: spec,
      },
    ]);

    withCanvasStub(() => {
      applyLayerGroupsToMap(map, enabledGroups);
      applyLayerGroupsToMap(map, []);
    });

    expect(map.addImage).toHaveBeenCalledWith(
      imageId,
      expect.objectContaining({ width: expect.any(Number), height: expect.any(Number) }),
    );
    expect(map.removeImage).toHaveBeenCalledWith(imageId);
    expect(map._images.has(imageId)).toBe(false);
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

  it("uses explicit sourceLayer from config for PMTiles vector source-layer (GIS/projection path)", () => {
    const map = createMapMock();
    const prevWin = globalThis.window;
    globalThis.window = { location: { origin: "http://localhost" } };
    try {
      bridgeMock.irToMapLibreLayers.mockReturnValue([
        { id: "greens.agri__fill", type: "fill", paint: { "fill-color": "#f00" }, layout: {} },
      ]);
      registryMock.getLayerConfig.mockReturnValue({
        pmtilesFile: "agri.pmtiles",
        sourceLayer: "agri_tiles",
        id: "agri",
        style: {},
      });
      registryMock.getLayerPMTilesUrl.mockReturnValue("/processed/layers/greens/agri.pmtiles");

      applyLayerGroupsToMap(map, [
        { id: "greens", layers: [{ id: "agri", enabled: true }] },
      ]);

      const added = map.addLayer.mock.calls.find((c) => c[0]?.id === "greens.agri__fill");
      expect(added).toBeDefined();
      expect(added[0]["source-layer"]).toBe("agri_tiles");
    } finally {
      if (prevWin === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = prevWin;
      }
    }
  });

  it("uses source_layer snake_case when sourceLayer is absent", () => {
    expect(
      getVectorSourceLayerName("g.l", { pmtilesFile: "f.pmtiles", source_layer: "layer_a", id: "l" }),
    ).toBe("layer_a");
  });

  it("prioritizes explicit sourceLayer over source_layer", () => {
    expect(
      getVectorSourceLayerName("greens.agri", {
        pmtilesFile: "agri.pmtiles",
        sourceLayer: "camel_case_wins",
        source_layer: "snake_case",
        id: "agri",
      }),
    ).toBe("camel_case_wins");
  });

  it("uses tiling pipeline default source-layer when no explicit sourceLayer is set", () => {
    expect(getVectorSourceLayerName("greens.agri", { id: "agri" })).toBe("layer");
  });

  it("buildPmtilesUrl returns null when path is empty", () => {
    expect(buildPmtilesUrl("")).toBeNull();
    expect(buildPmtilesUrl(null)).toBeNull();
  });

  it("buildPmtilesUrl resolves origin from globalThis.location or globalThis.window", () => {
    const prevLoc = globalThis.location;
    const prevWin = globalThis.window;
    try {
      Object.defineProperty(globalThis, "location", {
        value: { origin: "https://a.example" },
        configurable: true,
      });
      expect(buildPmtilesUrl("/tiles/x.pmtiles")).toBe("pmtiles://https://a.example/tiles/x.pmtiles");
      Object.defineProperty(globalThis, "location", {
        value: undefined,
        configurable: true,
      });
      globalThis.window = { location: { origin: "https://b.example" } };
      expect(buildPmtilesUrl("/p/y.pmtiles")).toBe("pmtiles://https://b.example/p/y.pmtiles");
    } finally {
      Object.defineProperty(globalThis, "location", { value: prevLoc, configurable: true });
      globalThis.window = prevWin;
    }
  });

  it("buildPmtilesUrl returns null when no origin is available (non-browser)", () => {
    const prevLoc = globalThis.location;
    const prevWin = globalThis.window;
    try {
      Object.defineProperty(globalThis, "location", { value: undefined, configurable: true });
      globalThis.window = undefined;
      expect(buildPmtilesUrl("/x.pmtiles")).toBeNull();
    } finally {
      Object.defineProperty(globalThis, "location", { value: prevLoc, configurable: true });
      globalThis.window = prevWin;
    }
  });

  it("adds PMTiles vector layer using default source-layer when manifest omits sourceLayer", () => {
    const map = createMapMock();
    const prevWin = globalThis.window;
    globalThis.window = { location: { origin: "http://localhost" } };

    try {
      bridgeMock.irToMapLibreLayers.mockReturnValue([
        { id: "g.l-f", type: "fill", paint: {}, layout: {} },
      ]);
      registryMock.getLayerConfig.mockReturnValue({
        pmtilesFile: "x.pmtiles",
        id: "l",
      });
      registryMock.getLayerPMTilesUrl.mockReturnValue("/p/x.pmtiles");

      applyLayerGroupsToMap(map, [{ id: "g", layers: [{ id: "l", enabled: true }] }]);

      expect(map.addSource).toHaveBeenCalledWith(
        "g.l",
        expect.objectContaining({ type: "vector", url: "pmtiles://http://localhost/p/x.pmtiles" }),
      );
      expect(map.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ id: "g.l-f", source: "g.l", "source-layer": "layer" }),
      );
    } finally {
      if (prevWin === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = prevWin;
      }
    }
  });

  it("applyLayerGroupsToMap keeps curated pack when only the logical fullLayerId is registered", () => {
    const map = createMapMock();
    const logicalId = "curated_moresht_axis.solidLine";
    const layerA = `${logicalId}__proposedLine__0`;
    const layerB = `${logicalId}__solidLine__0`;
    map._layers.add(layerA);
    map._layers.add(layerB);
    registerCuratedLayerIds(map, logicalId, `${logicalId}__src`, [layerA, layerB]);

    map.removeLayer.mockClear();

    applyLayerGroupsToMap(map, [
      { id: "curated_moresht_axis", layers: [{ id: "solidLine", enabled: true }] },
    ]);

    expect(map.removeLayer).not.toHaveBeenCalled();
  });

  it("applyLayerGroupsToMap prunes per-source state keys (not OTEF layer ids) so they must not be registered", () => {
    const map = createMapMock();
    const logicalId = "curated_moresht_axis.solidLine";
    const internalKey = `${logicalId}__proposedLine__src`;
    const layerId = `${logicalId}__proposedLine__0`;
    map._layers.add(layerId);
    registerCuratedLayerIds(map, internalKey, internalKey, [layerId]);

    map.removeLayer.mockClear();

    applyLayerGroupsToMap(map, [
      { id: "curated_moresht_axis", layers: [{ id: "solidLine", enabled: true }] },
    ]);

    expect(map.removeLayer).toHaveBeenCalledWith(layerId);
  });

  it("stageLayerHidden zeros numeric circle-opacity and records restore target", () => {
    const { stagedLayerDef, targetOpacity } = stageLayerHidden({
      id: "group_a.layer_1-pts",
      type: "circle",
      paint: {
        "circle-radius": 5,
        "circle-color": "#112233",
        "circle-opacity": 0.72,
      },
      layout: {},
    });
    expect(stagedLayerDef.paint["circle-opacity"]).toBe(0);
    expect(targetOpacity).toEqual({ "circle-opacity": 0.72 });
  });

  it("fadeOutAndRemoveEnabledFullIds animates circle-opacity to 0 before remove", async () => {
    vi.useFakeTimers();
    const map = createMapMock();
    const fullId = "pack.points";
    const layerId = "pack.points-circle";
    map.addSource(fullId);
    map._layers.add(layerId);
    registerCuratedLayerIds(map, fullId, fullId, [layerId]);
    map.setPaintProperty(layerId, "circle-opacity", 0.55);

    const p = fadeOutAndRemoveEnabledFullIds(map, [fullId], 90);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      layerId,
      "circle-opacity-transition",
      { duration: 90, delay: 0 },
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(layerId, "circle-opacity", 0);

    await vi.advanceTimersByTimeAsync(90);
    await p;

    expect(map.removeLayer).toHaveBeenCalledWith(layerId);
    expect(map.removeSource).toHaveBeenCalledWith(fullId);
    vi.useRealTimers();
  });

  it("beginSlideshowStage hides new layers then commitSlideshowReveal sets paint transitions and targets", () => {
    const map = createMapMock();
    const layerId = "group_a.layer_1-fill";
    bridgeMock.irToMapLibreLayers.mockReturnValue([
      {
        id: layerId,
        type: "fill",
        paint: { "fill-color": "#f00", "fill-opacity": 0.85 },
        layout: {},
      },
    ]);

    const staged = beginSlideshowStage(map, enabledGroups, {
      transition: { transitionMs: 400 },
    });

    const addedDef = map.addLayer.mock.calls.find((c) => c[0]?.id === layerId)?.[0];
    expect(addedDef).toBeDefined();
    expect(addedDef.paint["fill-opacity"]).toBe(0);
    expect(staged.addedLayerIds).toContain(layerId);
    expect(staged.targetOpacityByLayerId[layerId]).toEqual({ "fill-opacity": 0.85 });
    expect(staged.stagedFullIds).toContain("group_a.layer_1");

    map.setPaintProperty.mockClear();
    commitSlideshowReveal(map, staged, 250);

    expect(map.setPaintProperty).toHaveBeenCalledWith(
      layerId,
      "fill-opacity-transition",
      { duration: 250, delay: 0 },
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(layerId, "fill-opacity", 0.85);
  });

  it("fadeOutAndRemoveEnabledFullIds sets paint to 0 with transition then removes after timeout", async () => {
    vi.useFakeTimers();
    const map = createMapMock();
    const fullId = "pack.layer_x";
    const layerId = "pack.layer_x-fill";
    map.addSource(fullId);
    map._layers.add(layerId);
    registerCuratedLayerIds(map, fullId, fullId, [layerId]);
    map.setPaintProperty(layerId, "fill-opacity", 0.75);

    const p = fadeOutAndRemoveEnabledFullIds(map, [fullId], 120);
    expect(map.setPaintProperty).toHaveBeenCalledWith(
      layerId,
      "fill-opacity-transition",
      { duration: 120, delay: 0 },
    );
    expect(map.setPaintProperty).toHaveBeenCalledWith(layerId, "fill-opacity", 0);

    await vi.advanceTimersByTimeAsync(120);
    await p;

    expect(map.removeLayer).toHaveBeenCalledWith(layerId);
    expect(map.removeSource).toHaveBeenCalledWith(fullId);
    vi.useRealTimers();
  });

  it("fadeOutAndRemoveEnabledFullIds with transitionMs 0 removes immediately without fade", () => {
    const map = createMapMock();
    const fullId = "g.l";
    const layerId = "g.l-fill";
    map.addSource(fullId);
    map._layers.add(layerId);
    registerCuratedLayerIds(map, fullId, fullId, [layerId]);

    map.setPaintProperty.mockClear();
    void fadeOutAndRemoveEnabledFullIds(map, [fullId], 0);

    expect(map.setPaintProperty).not.toHaveBeenCalled();
    expect(map.removeLayer).toHaveBeenCalledWith(layerId);
    expect(map.removeSource).toHaveBeenCalledWith(fullId);
  });
});
