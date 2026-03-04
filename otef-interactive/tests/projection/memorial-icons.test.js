const curatedServiceModule = require("../../frontend/src/shared/curated-layer-service.js");
const {
  buildCuratedRouteGeoJSON,
  MEMORIAL_ICON_URLS,
} = curatedServiceModule;

describe("projection memorial icon styles for curated routes", () => {
  beforeEach(() => {
    // Stub global buildIntegratedRoute so buildCuratedRouteGeoJSON can run
    global.buildIntegratedRoute = jest.fn(() => ({
      dashed: [],
    }));
  });

  afterEach(() => {
    delete global.buildIntegratedRoute;
  });

  test("assigns _iconUrl and _iconSize in _curatedStyle for central/local memorial points", () => {
    const basePaths = [[[32, 34], [32.1, 34.1]]];
    const userPoints = [
      [32, 34],
      [32.1, 34.1],
      [32.2, 34.2],
    ];

    const pointFeatures = [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [34, 32] },
        properties: { id: 1, feature_type: "central" },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [34.1, 32.1] },
        properties: { id: 2, feature_type: "local" },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [34.2, 32.2] },
        properties: { id: 3, feature_type: "other" },
      },
    ];

    const layerColor = "#ff00aa";

    const geojson = buildCuratedRouteGeoJSON(
      basePaths,
      userPoints,
      layerColor,
      pointFeatures,
    );

    // We only care about the point features that were added to the
    // integrated route GeoJSON.
    const pointResults = (geojson.features || []).filter(
      (f) => f.geometry && f.geometry.type === "Point",
    );

    const byId = new Map(
      pointResults.map((f) => [f.properties && f.properties.id, f]),
    );

    const central = byId.get(1);
    const local = byId.get(2);
    const other = byId.get(3);

    expect(central).toBeDefined();
    expect(local).toBeDefined();
    expect(other).toBeDefined();

    expect(central.properties._curatedStyle._iconUrl).toBe(
      MEMORIAL_ICON_URLS.central,
    );
    expect(central.properties._curatedStyle._iconSize).toBeGreaterThan(0);

    expect(local.properties._curatedStyle._iconUrl).toBe(
      MEMORIAL_ICON_URLS.local,
    );
    expect(local.properties._curatedStyle._iconSize).toBeGreaterThan(0);

    expect(other.properties._curatedStyle._iconUrl).toBeUndefined();
    expect(other.properties._curatedStyle._iconSize).toBeUndefined();
    expect(other.properties._curatedStyle.fillColor).toBe(layerColor);
  });
});

