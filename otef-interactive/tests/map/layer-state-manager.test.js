const {
  shouldShowLayerOnGisMap,
} = require("../../frontend/src/shared/gis-layer-filter");
const {
  getLayerState,
} = require("../../frontend/src/shared/layer-state-helper");
const {
  shouldLayerBeVisible,
} = require("../../frontend/src/map-utils/visibility-controller");
const {
  applyLayerGroupsState,
} = require("../../frontend/src/map/layer-state-manager");

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
    const loadLayer = vi.fn();
    const updateVisibility = vi.fn();
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
    const loadLayer = vi.fn();
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
    const loadLayer = vi.fn().mockResolvedValue(undefined);
    const updateVisibility = vi.fn();
    const updateLegend = vi.fn();
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
    const loadLayer = vi.fn().mockResolvedValue(undefined);
    const updateVisibility = vi.fn();
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
    const loadLayer = vi.fn();
    const updateVisibility = vi.fn();
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

  test("does not re-apply same visibility repeatedly for unchanged state", () => {
    global.LayerStateHelper = { getLayerState: () => ({ enabled: true }) };
    global.VisibilityController = { shouldLayerBeVisible: () => true };

    const loadLayer = vi.fn();
    const updateVisibility = vi.fn();
    const loadedLayersMap = new Map();
    loadedLayersMap.set("map_3_future.mimushim", {});
    const deps = {
      map: { getZoom: () => 12 },
      layerRegistry: {
        _initialized: true,
        getLayerConfig: () => null,
      },
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
    const callsAfterFirstApply = updateVisibility.mock.calls.filter(
      (call) => call[0] === "map_3_future.mimushim" && call[1] === true
    ).length;
    applyLayerGroupsState(layerGroups, deps);
    const callsAfterSecondApply = updateVisibility.mock.calls.filter(
      (call) => call[0] === "map_3_future.mimushim" && call[1] === true
    ).length;
    expect(callsAfterSecondApply).toBe(callsAfterFirstApply);
  });

  test("animations subscription triggers renderer update without viewport mutation", () => {
    const calls = [];
    const mockContext = {
      _animations: {},
      _subscribers: { animations: new Set() },
      subscribe(key, callback) {
        this._subscribers[key].add(callback);
        return () => this._subscribers[key].delete(callback);
      },
      _setAnimations(next) {
        this._animations = next;
        this._subscribers.animations.forEach((cb) => cb(next));
      },
    };

    const unsub = mockContext.subscribe("animations", (next) => calls.push(next));
    mockContext._setAnimations({ "october_7th.×—×“×™×¨×”_×œ×™×©×•×‘-×¦×™×¨": true });

    expect(calls.length).toBe(1);
    expect(calls[0]["october_7th.×—×“×™×¨×”_×œ×™×©×•×‘-×¦×™×¨"]).toBe(true);
    unsub();
  });

  test("curated groups apply even when registry is not initialized while non-curated are deferred", async () => {
    const loadLayer = vi.fn().mockResolvedValue(undefined);
    const updateVisibility = vi.fn();

    const registry = {
      _initialized: false,
      init: vi.fn().mockImplementation(() => {
        registry._initialized = true;
        return Promise.resolve();
      }),
      getLayerConfig: vi.fn().mockReturnValue(null),
    };

    const deps = {
      map: { getZoom: () => 12 },
      layerRegistry: registry,
      loadLayerFromRegistry: loadLayer,
      updateLayerVisibilityFromRegistry: updateVisibility,
      loadedLayersMap: new Map(),
      updateMapLegend: () => {},
    };

    const layerGroups = [
      {
        id: "curated",
        layers: [{ id: "42", enabled: true }],
      },
      {
        id: "map_3_future",
        layers: [{ id: "mimushim", enabled: true }],
      },
    ];

    applyLayerGroupsState(layerGroups, deps);

    // First pass: only curated group should trigger a load while registry is not ready.
    const firstCallIds = loadLayer.mock.calls.map((call) => call[0]);
    expect(firstCallIds).toContain("curated.42");
    expect(firstCallIds).not.toContain("map_3_future.mimushim");

    // Allow the registry.init promise chain to run and re-apply pending state.
    await Promise.resolve();
    await Promise.resolve();

    const finalCallIds = loadLayer.mock.calls.map((call) => call[0]);
    expect(finalCallIds).toContain("curated.42");
    expect(finalCallIds).toContain("map_3_future.mimushim");
  });
});

