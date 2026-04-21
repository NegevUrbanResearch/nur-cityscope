import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  fetchPinkLinePaths: vi.fn(),
  resolvePinkLinePackStyleBundle: vi.fn(),
  fetchPinkLineParkingLotsGeojson: vi.fn(),
}));

vi.mock("../../frontend/src/shared/curated-layer-service.js", () => ({
  fetchPinkLinePaths: h.fetchPinkLinePaths,
  resolvePinkLinePackStyleBundle: h.resolvePinkLinePackStyleBundle,
}));

vi.mock("../../frontend/src/map-utils/pink-line-parking.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchPinkLineParkingLotsGeojson: h.fetchPinkLineParkingLotsGeojson,
  };
});

import {
  createProjectionPinkLineCanvasController,
  PINK_LINE_BASE_LAYER_ID,
  PINK_LINE_CANVAS_PARKING_LAYER_ID,
} from "../../frontend/src/projection/projection-pink-line-canvas.js";

const sampleParkingGeojson = () => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [34.8, 32.0] },
      properties: {},
    },
  ],
});

describe("projection-pink-line-canvas (behavior)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.CoordUtils = {
      transformGeojsonToItm: (gj) => gj,
    };
    h.fetchPinkLinePaths.mockResolvedValue({
      basePaths: [
        [
          [32.0, 34.8],
          [32.01, 34.81],
        ],
      ],
    });
    h.resolvePinkLinePackStyleBundle.mockResolvedValue({
      styleConfigForProjection: { style: { type: "simple" } },
      styleFunction: () => ({}),
      geometryType: "line",
    });
    h.fetchPinkLineParkingLotsGeojson.mockResolvedValue(sampleParkingGeojson());
  });

  afterEach(() => {
    delete globalThis.CoordUtils;
  });

  test("registers base + parking on renderer when fetch completes with intents on", async () => {
    const renderer = {
      setLayer: vi.fn(),
      setLayerVisibility: vi.fn(),
    };
    const loadedLayers = {};
    const ctrl = createProjectionPinkLineCanvasController({
      getCanvasRenderer: () => renderer,
      loadedLayers,
    });

    await ctrl.ensureProjectionPinkLineBaseLayer();

    expect(loadedLayers[PINK_LINE_BASE_LAYER_ID]).toBeDefined();
    expect(loadedLayers[PINK_LINE_CANVAS_PARKING_LAYER_ID]).toBeDefined();
    expect(renderer.setLayer).toHaveBeenCalledWith(
      PINK_LINE_CANVAS_PARKING_LAYER_ID,
      expect.anything(),
      expect.any(Function),
      "Point",
      expect.anything(),
    );
    expect(renderer.setLayerVisibility).toHaveBeenCalledWith(
      PINK_LINE_CANVAS_PARKING_LAYER_ID,
      true,
    );
  });

  test("does not attach parking to canvas if bundle is hidden before parking fetch resolves (generation guard)", async () => {
    let resolveParking;
    const parkingPromise = new Promise((resolve) => {
      resolveParking = resolve;
    });
    h.fetchPinkLineParkingLotsGeojson.mockReturnValue(parkingPromise);

    const renderer = {
      setLayer: vi.fn(),
      setLayerVisibility: vi.fn(),
    };
    const loadedLayers = {};
    const ctrl = createProjectionPinkLineCanvasController({
      getCanvasRenderer: () => renderer,
      loadedLayers,
    });

    const basePromise = ctrl.ensureProjectionPinkLineBaseLayer();
    await Promise.resolve();
    ctrl.setProjectionPinkLineAxisGlyphsVisible(false, false);
    resolveParking(sampleParkingGeojson());
    await basePromise;

    expect(loadedLayers[PINK_LINE_CANVAS_PARKING_LAYER_ID]).toBeUndefined();
    expect(
      renderer.setLayer.mock.calls.some((c) => c[0] === PINK_LINE_CANVAS_PARKING_LAYER_ID),
    ).toBe(false);
  });

  test("setProjectionPinkLineAxisGlyphsVisible turns parking off on renderer without unloading layer entry", async () => {
    const renderer = {
      setLayer: vi.fn(),
      setLayerVisibility: vi.fn(),
    };
    const loadedLayers = {};
    const ctrl = createProjectionPinkLineCanvasController({
      getCanvasRenderer: () => renderer,
      loadedLayers,
    });
    await ctrl.ensureProjectionPinkLineBaseLayer();
    renderer.setLayerVisibility.mockClear();

    ctrl.setProjectionPinkLineAxisGlyphsVisible(true, false);

    expect(renderer.setLayerVisibility).toHaveBeenCalledWith(
      PINK_LINE_CANVAS_PARKING_LAYER_ID,
      false,
    );
    expect(loadedLayers[PINK_LINE_CANVAS_PARKING_LAYER_ID]).toBeDefined();
  });

  test("no-op visibility sync when base layer not yet loaded (no renderer error)", () => {
    const renderer = {
      setLayer: vi.fn(),
      setLayerVisibility: vi.fn(),
    };
    const loadedLayers = {};
    const ctrl = createProjectionPinkLineCanvasController({
      getCanvasRenderer: () => renderer,
      loadedLayers,
    });
    ctrl.setProjectionPinkLineAxisGlyphsVisible(true, true);
    expect(renderer.setLayerVisibility).not.toHaveBeenCalled();
  });

  test("heritage clip omits base polyline but parking still registers on canvas", async () => {
    const renderer = {
      setLayer: vi.fn(),
      setLayerVisibility: vi.fn(),
      removeLayer: vi.fn(),
    };
    const loadedLayers = {};
    const ctrl = createProjectionPinkLineCanvasController({
      getCanvasRenderer: () => renderer,
      loadedLayers,
    });

    await ctrl.ensureProjectionPinkLineBaseLayer({
      removedPaths: [
        [
          [32.0, 34.8],
          [32.01, 34.81],
        ],
      ],
    });

    expect(loadedLayers[PINK_LINE_BASE_LAYER_ID]).toBeUndefined();
    for (let i = 0; i < 30; i++) {
      await Promise.resolve();
      if (loadedLayers[PINK_LINE_CANVAS_PARKING_LAYER_ID]) break;
    }
    expect(loadedLayers[PINK_LINE_CANVAS_PARKING_LAYER_ID]).toBeDefined();
    expect(renderer.setLayer).toHaveBeenCalledWith(
      PINK_LINE_CANVAS_PARKING_LAYER_ID,
      expect.anything(),
      expect.any(Function),
      "Point",
      expect.anything(),
    );
  });
});
