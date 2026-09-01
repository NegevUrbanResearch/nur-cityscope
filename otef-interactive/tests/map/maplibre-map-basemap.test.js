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
    expect(setGISBasemap(map, "dark")).toBe(true);
    expect(map.setStyle).toHaveBeenCalledWith(BASEMAP_STYLES.dark, {
      diff: false,
    });
    expect(BASEMAP_STYLES.dark).toBe("https://tiles.openfreemap.org/styles/dark");

    map.setStyle.mockClear();
    expect(setGISBasemap(map, "not-real")).toBe(false);
    expect(map.setStyle).not.toHaveBeenCalled();
  });

  it("uses the exact keyless OpenFreeMap dark style URL", async () => {
    const { BASEMAP_STYLES } = await import(
      "../../frontend/src/map/maplibre-map.js"
    );

    expect(BASEMAP_STYLES.dark).toBe("https://tiles.openfreemap.org/styles/dark");
    expect(JSON.stringify(BASEMAP_STYLES.dark)).not.toMatch(/carto/i);
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

