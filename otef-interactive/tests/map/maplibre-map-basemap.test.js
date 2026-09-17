import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("maplibre basemap switching", () => {
  beforeEach(() => {
    vi.resetModules();
    globalThis.maplibregl = {
      addProtocol: vi.fn(),
      Map: vi.fn(),
      getRTLTextPluginStatus: vi.fn(() => "unavailable"),
      setRTLTextPlugin: vi.fn(),
    };
    globalThis.pmtiles = {
      Protocol: vi.fn(function Protocol() {
        this.tile = vi.fn();
      }),
    };
  });

  it("switches between supported GIS basemap styles", async () => {
    const { BASEMAP_STYLES, setGISBasemap } = await import(
      "../../frontend/src/map/maplibre-map.js"
    );
    const map = {
      setStyle: vi.fn(),
    };

    expect(setGISBasemap(map, "satellite")).toBe(true);
    expect(map.setStyle).toHaveBeenCalledWith(BASEMAP_STYLES.satellite, {
      diff: false,
    });

    map.setStyle.mockClear();
    expect(setGISBasemap(map, "satellite_bw")).toBe(true);
    expect(map.setStyle).toHaveBeenCalledWith(BASEMAP_STYLES.satellite_bw, {
      diff: false,
    });

    map.setStyle.mockClear();
    expect(setGISBasemap(map, "dark")).toBe(true);
    expect(map.setStyle).toHaveBeenCalledWith(BASEMAP_STYLES.dark, {
      diff: false,
    });
    expect(BASEMAP_STYLES.dark).toMatchObject({ version: 8 });
    expect(BASEMAP_STYLES.dark.sources.openmaptiles.url).toBe(
      "https://tiles.openfreemap.org/planet",
    );

    map.setStyle.mockClear();
    expect(setGISBasemap(map, "not-real")).toBe(false);
    expect(map.setStyle).not.toHaveBeenCalled();
  });

  it("renders the B&W satellite variant from the shared Esri tiles", async () => {
    const { BASEMAP_STYLES } = await import(
      "../../frontend/src/map/maplibre-map.js"
    );

    expect(BASEMAP_STYLES.satellite_bw.layers[0].paint).toEqual({
      "raster-saturation": -1,
    });
    expect(BASEMAP_STYLES.satellite_bw.sources.esri.tiles).toEqual(
      BASEMAP_STYLES.satellite.sources.esri.tiles,
    );
  });

  it("loads the local dark style as a JS module so nginx GIS can import it", () => {
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../frontend/src/map/maplibre-map.js"),
      "utf8",
    );
    expect(source).not.toMatch(/openfreemap-dark\.json/);
    expect(source).toMatch(/from "\.\/basemaps\/openfreemap-dark\.js"/);
  });

  it("uses a local OpenFreeMap dark style with Hebrew-first white place and road names", async () => {
    const { BASEMAP_STYLES } = await import(
      "../../frontend/src/map/maplibre-map.js"
    );
    const {
      DARK_BASEMAP_TEXT_COLOR,
      DARK_BASEMAP_TEXT_FIELD,
    } = await import("../../frontend/src/map/dark-basemap-labels.js");

    expect(typeof BASEMAP_STYLES.dark).toBe("object");
    expect(BASEMAP_STYLES.dark.sources.openmaptiles.url).toBe(
      "https://tiles.openfreemap.org/planet",
    );
    expect(JSON.stringify(BASEMAP_STYLES.dark)).not.toMatch(/carto/i);

    const placeAndRoadNameLayers = BASEMAP_STYLES.dark.layers.filter((layer) => {
      if (layer.type !== "symbol") return false;
      if (layer["source-layer"] === "place") return true;
      return (
        layer["source-layer"] === "transportation_name" &&
        !JSON.stringify(layer.layout?.["text-field"] ?? "").includes('"ref"')
      );
    });
    expect(placeAndRoadNameLayers.length).toBeGreaterThan(0);
    for (const layer of placeAndRoadNameLayers) {
      expect(layer.layout["text-field"]).toEqual(DARK_BASEMAP_TEXT_FIELD);
      expect(layer.paint["text-color"]).toBe(DARK_BASEMAP_TEXT_COLOR);
      expect(layer.layout["text-transform"]).toBeUndefined();
    }

    const motorway = BASEMAP_STYLES.dark.layers.find(
      (layer) => layer.id === "highway_name_motorway",
    );
    expect(motorway.layout["text-field"]).toEqual(["to-string", ["get", "ref"]]);
  });

  it("installs the RTL text plugin lazily when the GIS status is unavailable", async () => {
    await import("../../frontend/src/map/maplibre-map.js");

    expect(globalThis.maplibregl.setRTLTextPlugin).toHaveBeenCalledTimes(1);
    expect(globalThis.maplibregl.setRTLTextPlugin).toHaveBeenCalledWith(
      "https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.js",
      null,
      true,
    );
  });

  it.each(["loaded", "loading"])(
    "does not reinstall the RTL text plugin when the GIS status is %s",
    async (status) => {
      globalThis.maplibregl.getRTLTextPluginStatus.mockReturnValue(status);

      await import("../../frontend/src/map/maplibre-map.js");

      expect(globalThis.maplibregl.setRTLTextPlugin).not.toHaveBeenCalled();
    },
  );
});

