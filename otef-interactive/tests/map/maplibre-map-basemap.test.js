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
    expect(setGISBasemap(map, "not-real")).toBe(false);
    expect(map.setStyle).not.toHaveBeenCalled();
  });
});
