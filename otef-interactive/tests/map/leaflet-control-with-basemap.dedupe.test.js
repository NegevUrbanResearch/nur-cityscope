describe("leaflet-control-with-basemap load dedupe", () => {
  beforeEach(() => {
    jest.resetModules();

    global.window = global.window || {};
    global.document = global.document || {
      createElement: () => {
        const el = {};
        Object.defineProperty(el, "textContent", {
          set(v) {
            this._text = v;
            this.innerHTML = String(v);
          },
          get() {
            return this._text;
          },
        });
        return el;
      },
    };

    const mapLayers = new Set();
    global.map = {
      addLayer: jest.fn((layer) => {
        mapLayers.add(layer);
      }),
      removeLayer: jest.fn((layer) => {
        mapLayers.delete(layer);
      }),
      hasLayer: jest.fn((layer) => mapLayers.has(layer)),
      getZoom: jest.fn(() => 14),
      on: jest.fn(),
    };

    global.CoordUtils = {
      transformGeojsonToWgs84: (g) => g,
      transformGeojsonFrom3857ToWgs84: (g) => g,
    };

    global.LayerFactory = {
      createGeoJsonLayer: jest.fn(() => ({
        options: {},
      })),
    };

    global.layerRegistry = {
      _initialized: true,
      init: jest.fn(async () => {}),
      getGroups: jest.fn(() => []),
      getLayerConfig: jest.fn(() => ({
        style: {},
      })),
      getLayerPMTilesUrl: jest.fn(() => null),
      getLayerDataUrl: jest.fn(() => "/fake.geojson"),
    };

    global.LayerStateHelper = {
      getLayerState: jest.fn(() => ({ enabled: true })),
    };

    global.VisibilityController = {
      shouldLayerBeVisible: jest.fn(() => true),
    };
  });

  afterEach(() => {
    delete global.map;
    delete global.CoordUtils;
    delete global.LayerFactory;
    delete global.layerRegistry;
    delete global.LayerStateHelper;
    delete global.VisibilityController;
    delete global.fetch;
    if (global.window) {
      delete global.window.getMapLayerLoaderAPI;
      delete global.window.pmtilesLayersWithConfigs;
    }
  });

  test("deduplicates concurrent loads of the same layer id", async () => {
    let resolveFetch;
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const mod = require("../../frontend/src/map/leaflet-control-with-basemap.js");
    const api = mod.getMapLayerLoaderAPI();
    const layerId = "october_7th.sample_line";

    const p1 = api.loadLayerFromRegistry(layerId);
    const p2 = api.loadLayerFromRegistry(layerId);

    resolveFetch({
      ok: true,
      json: async () => ({
        type: "FeatureCollection",
        features: [],
      }),
    });

    await Promise.all([p1, p2]);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.LayerFactory.createGeoJsonLayer).toHaveBeenCalledTimes(1);
    expect(api.loadedLayersMap.has(layerId)).toBe(true);
  });
});


