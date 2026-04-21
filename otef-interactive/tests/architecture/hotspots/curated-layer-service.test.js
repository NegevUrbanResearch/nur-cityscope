// tests/hotspot-refactor/curated-layer-service.test.js
const fs = require("fs");

const { layerRegistryMock } = vi.hoisted(() => ({
  layerRegistryMock: {
    init: vi.fn().mockResolvedValue(undefined),
    getLayerDataUrl: vi.fn(() => null),
    getAllLayerIds: vi.fn(() => []),
    getPackStyleJsonForLayer: vi.fn(() => null),
    getLayerConfig: vi.fn(() => null),
  },
}));

vi.mock("../../../frontend/src/shared/layer-registry.js", () => ({
  default: layerRegistryMock,
}));

const PACK_LAYER_IDS = [
  "future_development.הציר_הורוד_חדש",
  "future_development.הקו_הורוד",
];

const geojsonWithLine = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [34.78, 32.08],
          [34.79, 32.09],
        ],
      },
      properties: {},
    },
  ],
};

const geojsonPointsOnly = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [34.78, 32.08] },
      properties: {},
    },
  ],
};

test("curated-layer-service module exists", () => {
  expect(
    fs.existsSync("frontend/src/shared/curated-layer-service.js"),
  ).toBe(true);
});

test("curated-layer-service exports shared functions", async () => {
  const mod = await import(
    "../../../frontend/src/shared/curated-layer-service.js"
  );
  expect(typeof mod.fetchCuratedLayerData).toBe("function");
  expect(typeof mod.extractPointFeatures).toBe("function");
  expect(typeof mod.fetchPinkLinePaths).toBe("function");
  expect(typeof mod.buildCuratedRouteGeoJSON).toBe("function");
  expect(typeof mod.buildColabAlignedCuratedOverlayGeoJSON).toBe("function");
  expect(typeof mod.resolvePinkLinePackStyleBundle).toBe("function");
});

test("fetchCuratedLayerData supports project-scoped curated groups", async () => {
  const originalFetch = global.fetch;
  const fakeResponse = {
    ok: true,
    json: async () => [
      {
        id: 42,
        layer_type: "geojson",
        geojson: { type: "FeatureCollection", features: [] },
      },
    ],
  };
  global.fetch = vi.fn().mockResolvedValue(fakeResponse);

  const { fetchCuratedLayerData } = await import(
    "../../../frontend/src/shared/curated-layer-service.js"
  );

  const result = await fetchCuratedLayerData("curated_myproj.42");
  expect(result).not.toBeNull();
  expect(result.layerData.id).toBe(42);

  global.fetch = originalFetch;
});

describe("fetchPinkLinePaths", () => {
  const packUrl =
    "/otef-interactive/public/processed/layers/future_development/pink.geojson";

  beforeEach(() => {
    vi.clearAllMocks();
    layerRegistryMock.init.mockResolvedValue(undefined);
    layerRegistryMock.getLayerDataUrl.mockReturnValue(null);
    layerRegistryMock.getAllLayerIds.mockReturnValue([]);
    layerRegistryMock.getPackStyleJsonForLayer.mockReturnValue(null);
    layerRegistryMock.getLayerConfig.mockReturnValue(null);
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("uses pack URL when available and does not call /api/pink-line/", async () => {
    layerRegistryMock.getAllLayerIds.mockReturnValue([]);
    layerRegistryMock.getLayerDataUrl.mockImplementation((id) => {
      expect(PACK_LAYER_IDS).toContain(id);
      return packUrl;
    });
    const fetchMock = globalThis.fetch;
    fetchMock.mockImplementation((url) => {
      if (url === packUrl) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(geojsonWithLine),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    const { fetchPinkLinePaths } = await import(
      "../../../frontend/src/shared/curated-layer-service.js"
    );
    const out = await fetchPinkLinePaths();

    expect(out.basePaths.length).toBeGreaterThan(0);
    expect(out.pinkGeojson).toEqual(geojsonWithLine);
    expect(layerRegistryMock.init).toHaveBeenCalled();
    expect(layerRegistryMock.getLayerDataUrl).toHaveBeenCalledWith(
      PACK_LAYER_IDS[0],
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(packUrl);
    expect(
      fetchMock.mock.calls.some((c) => c[0] === "/api/pink-line/"),
    ).toBe(false);
  });

  test("prefers הציר_הורוד_חדש over הקו_הורוד when registry lists both", async () => {
    layerRegistryMock.getAllLayerIds.mockReturnValue([
      "future_development.הקו_הורוד",
      "future_development.הציר_הורוד_חדש",
    ]);
    layerRegistryMock.getLayerDataUrl.mockReturnValue(packUrl);
    const fetchMock = globalThis.fetch;
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(geojsonWithLine),
    });

    const { fetchPinkLinePaths } = await import(
      "../../../frontend/src/shared/curated-layer-service.js"
    );
    await fetchPinkLinePaths();

    expect(layerRegistryMock.getLayerDataUrl.mock.calls[0][0]).toBe(
      PACK_LAYER_IDS[0],
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("first fetch is pack URL only (single request)", async () => {
    layerRegistryMock.getLayerDataUrl.mockReturnValue(packUrl);
    const fetchMock = globalThis.fetch;
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(geojsonWithLine),
    });

    const { fetchPinkLinePaths } = await import(
      "../../../frontend/src/shared/curated-layer-service.js"
    );
    await fetchPinkLinePaths();

    expect(fetchMock.mock.calls[0][0]).toBe(packUrl);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("pack-only: when pack URL is missing, returns empty and never calls /api/pink-line/", async () => {
    layerRegistryMock.getLayerDataUrl.mockReturnValue(null);
    const fetchMock = globalThis.fetch;
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(geojsonWithLine),
    });

    const { fetchPinkLinePaths } = await import(
      "../../../frontend/src/shared/curated-layer-service.js"
    );
    const out = await fetchPinkLinePaths();

    expect(out.basePaths.length).toBe(0);
    expect(out.pinkGeojson).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some((c) => c[0] === "/api/pink-line/"),
    ).toBe(false);
  });

  test("pack-only: when pack fetch is not ok, returns empty and never calls /api/pink-line/", async () => {
    layerRegistryMock.getLayerDataUrl.mockReturnValue(packUrl);
    const fetchMock = globalThis.fetch;
    fetchMock.mockImplementation((url) => {
      if (url === packUrl) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    const { fetchPinkLinePaths } = await import(
      "../../../frontend/src/shared/curated-layer-service.js"
    );
    const out = await fetchPinkLinePaths();

    expect(out.basePaths.length).toBe(0);
    expect(out.pinkGeojson).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe(packUrl);
    expect(
      fetchMock.mock.calls.some((c) => c[0] === "/api/pink-line/"),
    ).toBe(false);
  });

  test("pack-only: when pack GeoJSON has no line paths, returns empty and never calls /api/pink-line/", async () => {
    layerRegistryMock.getLayerDataUrl.mockImplementation((id) =>
      PACK_LAYER_IDS.includes(id) ? packUrl : null,
    );
    const fetchMock = globalThis.fetch;
    fetchMock.mockImplementation((url) => {
      if (url === packUrl) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(geojsonPointsOnly),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    const { fetchPinkLinePaths } = await import(
      "../../../frontend/src/shared/curated-layer-service.js"
    );
    const out = await fetchPinkLinePaths();

    expect(out.basePaths.length).toBe(0);
    expect(out.pinkGeojson).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe(packUrl);
    expect(
      fetchMock.mock.calls.some((c) => c[0] === "/api/pink-line/"),
    ).toBe(false);
  });

  test("pack-only: when pack load throws, returns empty and never calls /api/pink-line/", async () => {
    layerRegistryMock.getLayerDataUrl.mockImplementation(() => {
      throw new Error("registry failure");
    });
    const fetchMock = globalThis.fetch;
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(geojsonWithLine),
    });

    const { fetchPinkLinePaths } = await import(
      "../../../frontend/src/shared/curated-layer-service.js"
    );
    const out = await fetchPinkLinePaths();

    expect(out.basePaths.length).toBe(0);
    expect(out.pinkGeojson).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some((c) => c[0] === "/api/pink-line/"),
    ).toBe(false);
  });
});

describe("resolvePinkLinePackStyleBundle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    layerRegistryMock.init.mockResolvedValue(undefined);
    layerRegistryMock.getLayerDataUrl.mockReturnValue(null);
    layerRegistryMock.getAllLayerIds.mockReturnValue([]);
    layerRegistryMock.getPackStyleJsonForLayer.mockReturnValue(null);
    layerRegistryMock.getLayerConfig.mockReturnValue(null);
  });

  test("uses .lyrx-aligned fallback when pack styles.json has no pink-line entry", async () => {
    const { resolvePinkLinePackStyleBundle } = await import(
      "../../../frontend/src/shared/curated-layer-service.js"
    );
    const bundle = await resolvePinkLinePackStyleBundle();
    expect(bundle.sourceFullLayerId).toBeNull();
    expect(bundle.leafletPolylineOptions.color.toLowerCase()).toBe("#ff69b4");
    expect(bundle.leafletPolylineOptions.weight).toBe(5);
    expect(bundle.leafletPolylineOptions.opacity).toBe(0.9);
  });

  test("uses first matching pack style by pink-line id priority", async () => {
    const packStyle = {
      renderer: "simple",
      defaultStyle: { color: "#112233", weight: 2.5, opacity: 1 },
    };
    layerRegistryMock.getPackStyleJsonForLayer.mockImplementation((id) => {
      if (id === PACK_LAYER_IDS[0]) {
        return packStyle;
      }
      return null;
    });
    layerRegistryMock.getLayerConfig.mockReturnValue({ geometryType: "line" });

    const { resolvePinkLinePackStyleBundle } = await import(
      "../../../frontend/src/shared/curated-layer-service.js"
    );
    const bundle = await resolvePinkLinePackStyleBundle();

    expect(bundle.sourceFullLayerId).toBe(PACK_LAYER_IDS[0]);
    expect(bundle.leafletPolylineOptions.color.toLowerCase()).toBe("#ff69b4");
    expect(bundle.leafletPolylineOptions.weight).toBe(5);
    expect(bundle.styleConfigForProjection.style).toEqual(packStyle);
  });

  test("falls through to legacy id when newer id has no styles.json entry", async () => {
    const legacyStyle = {
      renderer: "simple",
      defaultStyle: { color: "#aabbcc", weight: 3, opacity: 0.9 },
    };
    layerRegistryMock.getPackStyleJsonForLayer.mockImplementation((id) => {
      if (id === PACK_LAYER_IDS[0]) {
        return null;
      }
      if (id === PACK_LAYER_IDS[1]) {
        return legacyStyle;
      }
      return null;
    });
    layerRegistryMock.getLayerConfig.mockReturnValue({ geometryType: "line" });

    const { resolvePinkLinePackStyleBundle } = await import(
      "../../../frontend/src/shared/curated-layer-service.js"
    );
    const bundle = await resolvePinkLinePackStyleBundle();

    expect(bundle.sourceFullLayerId).toBe(PACK_LAYER_IDS[1]);
    expect(bundle.leafletPolylineOptions.color.toLowerCase()).toBe("#ff69b4");
    expect(bundle.leafletPolylineOptions.weight).toBe(5);
    expect(bundle.leafletPolylineOptions.opacity).toBe(0.9);
  });
});
