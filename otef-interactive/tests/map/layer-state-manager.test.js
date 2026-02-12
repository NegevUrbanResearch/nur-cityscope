const {
  shouldShowLayerOnGisMap,
} = require("../../frontend/js/shared/gis-layer-filter");
const {
  getLayerState,
} = require("../../frontend/js/shared/layer-state-helper");
const {
  shouldLayerBeVisible,
} = require("../../frontend/js/map-utils/visibility-controller");
const {
  applyLayerGroupsState,
} = require("../../frontend/js/map/layer-state-manager");

describe("layer-state-manager: applyLayerGroupsState", () => {
  beforeEach(() => {
    global.shouldShowLayerOnGisMap = shouldShowLayerOnGisMap;
    global.LayerStateHelper = { getLayerState };
    global.VisibilityController = { shouldLayerBeVisible };
  });

  afterEach(() => {
    delete global.shouldShowLayerOnGisMap;
    delete global.LayerStateHelper;
    delete global.VisibilityController;
  });

  test("no-ops when layerGroups is null or not an array", () => {
    const loadLayer = jest.fn();
    const updateVisibility = jest.fn();
    const deps = {
      map: { getZoom: () => 12 },
      layerRegistry: { _initialized: true, getLayerConfig: () => null },
      loadLayerFromRegistry: loadLayer,
      updateLayerVisibilityFromRegistry: updateVisibility,
      loadedLayersMap: new Map(),
      updateMapLegend: () => {},
    };

    applyLayerGroupsState(null, deps);
    applyLayerGroupsState([], deps);
    applyLayerGroupsState("not-array", deps);

    expect(loadLayer).not.toHaveBeenCalled();
    expect(updateVisibility).not.toHaveBeenCalled();
  });

  test("no-ops when deps.layerRegistry is missing", () => {
    const loadLayer = jest.fn();
    const deps = {
      map: { getZoom: () => 12 },
      layerRegistry: null,
      loadLayerFromRegistry: loadLayer,
      updateLayerVisibilityFromRegistry: () => {},
      loadedLayersMap: new Map(),
      updateMapLegend: () => {},
    };
    const layerGroups = [{ id: "g1", layers: [{ id: "l1", enabled: true }] }];

    applyLayerGroupsState(layerGroups, deps);

    expect(loadLayer).not.toHaveBeenCalled();
  });

  test("requests load and sets visibility for enabled GIS-visible layers", async () => {
    const loadLayer = jest.fn().mockResolvedValue(undefined);
    const updateVisibility = jest.fn();
    const updateLegend = jest.fn();
    const loadedLayersMap = new Map();
    const deps = {
      map: { getZoom: () => 12 },
      layerRegistry: { _initialized: true, getLayerConfig: () => null },
      loadLayerFromRegistry: loadLayer,
      updateLayerVisibilityFromRegistry: updateVisibility,
      loadedLayersMap,
      updateMapLegend: updateLegend,
    };
    const layerGroups = [
      {
        id: "map_3_future",
        layers: [
          { id: "mimushim", enabled: true },
          { id: "other", enabled: false },
        ],
      },
    ];

    applyLayerGroupsState(layerGroups, deps);

    expect(loadLayer).toHaveBeenCalledTimes(1);
    expect(loadLayer).toHaveBeenCalledWith("map_3_future.mimushim");
    expect(updateVisibility).toHaveBeenCalledWith("map_3_future.other", false);
    await Promise.resolve();
    expect(updateVisibility).toHaveBeenCalledWith(
      "map_3_future.mimushim",
      true
    );
    expect(updateLegend).toHaveBeenCalled();
  });

  test("skips projector_base-only layers (GIS filter)", () => {
    const loadLayer = jest.fn().mockResolvedValue(undefined);
    const updateVisibility = jest.fn();
    const deps = {
      map: { getZoom: () => 12 },
      layerRegistry: { _initialized: true, getLayerConfig: () => null },
      loadLayerFromRegistry: loadLayer,
      updateLayerVisibilityFromRegistry: updateVisibility,
      loadedLayersMap: new Map(),
      updateMapLegend: () => {},
    };
    const layerGroups = [
      {
        id: "projector_base",
        layers: [
          { id: "model_base", enabled: true },
          { id: "Tkuma_Area_LIne", enabled: true },
        ],
      },
    ];

    applyLayerGroupsState(layerGroups, deps);

    expect(loadLayer).toHaveBeenCalledTimes(1);
    expect(loadLayer).toHaveBeenCalledWith("projector_base.Tkuma_Area_LIne");
    expect(updateVisibility).not.toHaveBeenCalledWith(
      "projector_base.model_base",
      expect.anything()
    );
  });

  test("when layer already in loadedLayersMap, only updates visibility", () => {
    const loadLayer = jest.fn();
    const updateVisibility = jest.fn();
    const loadedLayersMap = new Map();
    loadedLayersMap.set("map_3_future.mimushim", {});
    const deps = {
      map: { getZoom: () => 12 },
      layerRegistry: { _initialized: true, getLayerConfig: () => null },
      loadLayerFromRegistry: loadLayer,
      updateLayerVisibilityFromRegistry: updateVisibility,
      loadedLayersMap,
      updateMapLegend: () => {},
    };
    const layerGroups = [
      {
        id: "map_3_future",
        layers: [{ id: "mimushim", enabled: true }],
      },
    ];

    applyLayerGroupsState(layerGroups, deps);

    expect(loadLayer).not.toHaveBeenCalled();
    expect(updateVisibility).toHaveBeenCalledWith(
      "map_3_future.mimushim",
      true
    );
  });
});
