import { beforeEach, describe, expect, it, vi } from "vitest";

describe("maplibre basemap switching", () => {
  beforeEach(() => {
    vi.resetModules();
    globalThis.maplibregl = {
      addProtocol: vi.fn(),
      Map: vi.fn(),
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
    expect(BASEMAP_STYLES.dark.sources.carto.tiles).toEqual([
      "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    ]);
    expect(BASEMAP_STYLES.dark.sources.carto.tileSize).toBe(256);

    map.setStyle.mockClear();
    expect(setGISBasemap(map, "not-real")).toBe(false);
    expect(map.setStyle).not.toHaveBeenCalled();
  });
});

