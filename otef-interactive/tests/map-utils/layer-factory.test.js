describe('layer-factory: createGeoJsonLayer', () => {
  beforeEach(() => {
    global.L = {
      geoJSON: jest.fn((geojson, options) => ({ geojson, options })),
      circleMarker: jest.fn((latlng, opts) => ({ latlng, opts })),
      popup: jest.fn(() => ({
        setLatLng: function () { return this; },
        setContent: function () { return this; },
        openOn: function () { return this; }
      }))
    };

    // Minimal StyleApplicator mock
    global.StyleApplicator = {
      getLeafletStyle: jest.fn(() => () => ({
        fillColor: '#ff0000',
        color: '#000000',
        weight: 2,
        fillOpacity: 0.5
      }))
    };

    // popup renderer mock
    global.renderPopupContent = jest.fn(() => '<div>popup</div>');
  });

  afterEach(() => {
    delete global.L;
    delete global.StyleApplicator;
    delete global.renderPopupContent;
    jest.resetModules();
  });

  test('creates a GeoJSON layer with correct pane for polygon', () => {
    const layerConfig = {
      geometryType: 'polygon',
      ui: {},
      style: {}
    };
    const geojson = { type: 'FeatureCollection', features: [] };
    const map = {}; // not used in this simple test

    const { createGeoJsonLayer } = require('../../frontend/js/map-utils/layer-factory');

    const layer = createGeoJsonLayer({
      fullLayerId: 'group.layer',
      layerConfig,
      geojson,
      map
    });

    expect(layer).not.toBeNull();
    expect(layer.options.pane).toBe('overlayPolygon');
  });

  test('creates a GeoJSON layer with correct pane for line', () => {
    const layerConfig = {
      geometryType: 'line',
      ui: {},
      style: {}
    };
    const geojson = { type: 'FeatureCollection', features: [] };
    const map = {};

    const { createGeoJsonLayer } = require('../../frontend/js/map-utils/layer-factory');

    const layer = createGeoJsonLayer({
      fullLayerId: 'group.layer',
      layerConfig,
      geojson,
      map
    });

    expect(layer.options.pane).toBe('overlayLine');
  });
});

describe('layer-factory: createPmtilesLayer', () => {
  beforeEach(() => {
    global.protomapsL = {
      PolygonSymbolizer: jest.fn(function (opts) { this.opts = opts; }),
      LineSymbolizer: jest.fn(function (opts) { this.opts = opts; }),
      leafletLayer: jest.fn((opts) => ({ opts }))
    };

    global.StyleApplicator = {
      getLeafletStyle: jest.fn(() => () => ({
        fillColor: '#00ff00',
        color: '#000000',
        weight: 1,
        fillOpacity: 0.7,
        opacity: 1.0
      }))
    };
  });

  afterEach(() => {
    delete global.protomapsL;
    delete global.StyleApplicator;
    jest.resetModules();
  });

  test('creates a PMTiles layer with correct pane for line', () => {
    const layerConfig = {
      geometryType: 'line',
      style: {}
    };

    const { createPmtilesLayer } = require('../../frontend/js/map-utils/layer-factory');

    const layer = createPmtilesLayer({
      fullLayerId: 'group.layer',
      layerConfig,
      dataUrl: 'https://example.com/data.pmtiles'
    });

    expect(layer).not.toBeNull();
    expect(layer.opts.pane).toBe('overlayLine');
  });

  test('advanced PMTiles layer uses symbolizer with draw(ctx, geom, z, feature) and single paint rule', () => {
    global.protomapsL = {
      leafletLayer: jest.fn((opts) => ({ opts }))
    };

    const { createPmtilesLayer } = require('../../frontend/js/map-utils/layer-factory');

    const layer = createPmtilesLayer({
      fullLayerId: 'group.land_use',
      layerConfig: {
        geometryType: 'polygon',
        name: 'Land Use',
        style: { complexity: 'advanced', defaultStyle: { fillColor: '#888' } }
      },
      dataUrl: 'https://example.com/landuse.pmtiles'
    });

    expect(layer).not.toBeNull();
    expect(layer.opts.paintRules).toBeDefined();
    expect(layer.opts.paintRules.length).toBe(1);
    expect(layer.opts.paintRules[0].dataLayer).toBe('layer');
    expect(typeof layer.opts.paintRules[0].symbolizer.draw).toBe('function');
  });
});

