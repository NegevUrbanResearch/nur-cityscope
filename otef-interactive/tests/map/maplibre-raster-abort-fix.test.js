/**
 * @vitest-environment jsdom
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, test, vi } from "vitest";
import { installMapLibreRasterAbortFix } from "../../frontend/src/map/maplibre-raster-abort-fix.js";

function abortError() {
  const error = new Error("AbortError");
  error.name = "AbortError";
  return error;
}

function createMapLibreWithRasterSource(loadTileImpl) {
  class RasterTileSource {
    constructor() {
      this.type = "raster";
      this.tiles = ["https://example.test/{z}/{y}/{x}"];
      this.map = {
        getPixelRatio: () => 1,
        _requestManager: {
          async transformRequest(url) {
            return { url };
          },
        },
        _refreshExpiredTiles: true,
      };
    }
    async abortTile(tile) {
      if (tile.abortController) {
        tile.abortController.abort();
        delete tile.abortController;
      }
    }
  }
  RasterTileSource.prototype.loadTile = loadTileImpl;
  return { getVersion: () => "5.24.0", RasterTileSource };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function rasterTile() {
  return {
    tileID: { canonical: { url: () => "https://example.test/same-tile" } },
    aborted: false,
    state: "loading",
  };
}

function mapLibreFiveLoadTile(getImage) {
  return async function loadTile(tile) {
    const url = tile.tileID.canonical.url(this.tiles, this.map.getPixelRatio(), this.scheme);
    tile.abortController = new AbortController();
    try {
      const response = await getImage(
        await this.map._requestManager.transformRequest(url, "Tile"),
        tile.abortController,
        this.map._refreshExpiredTiles,
      );
      delete tile.abortController;
      if (tile.aborted) {
        tile.state = "unloaded";
        return;
      }
      tile.state = response?.data ? "loaded" : "unloaded";
    } catch (err) {
      delete tile.abortController;
      if (tile.aborted) {
        tile.state = "unloaded";
      } else if (err) {
        tile.state = "errored";
        throw err;
      }
    }
  };
}

function hangingTransform(source) {
  let releaseTransform;
  source.map._requestManager.transformRequest = () => new Promise((resolve) => {
    releaseTransform = () => resolve({ url: "https://example.test/tile" });
  });
  return () => releaseTransform();
}

describe("installMapLibreRasterAbortFix", () => {
  test("the installed MapLibre 5.24 native image and texture path survives same-Tile overlap", async () => {
    const maplibregl = createRequire(import.meta.url)("maplibre-gl");
    expect(maplibregl.getVersion()).toBe("5.24.0");
    const nativeDemLoad = maplibregl.RasterDEMTileSource.prototype.loadTile;
    installMapLibreRasterAbortFix(maplibregl);
    const images = [deferred(), deferred()];
    const signals = [];
    maplibregl.addProtocol("otef-raster-test", (_request, controller) => {
      signals.push(controller.signal);
      return images[signals.length - 1].promise;
    });
    const source = new maplibregl.RasterTileSource("esri", { type: "raster", tiles: [] });
    const texture = { update: vi.fn() };
    source.map = {
      getPixelRatio: () => 1,
      _requestManager: { transformRequest: (url) => ({ url }) },
      _refreshExpiredTiles: true,
      painter: { context: { gl: {} }, getTileTexture: () => texture },
    };
    const tile = rasterTile();
    tile.tileID.canonical.url = () => "otef-raster-test://same-tile";
    try {
      const older = source.loadTile(tile);
      await Promise.resolve();
      const newer = source.loadTile(tile);
      await Promise.resolve();
      expect(signals[0].aborted).toBe(true);
      expect(signals[1].aborted).toBe(false);
      const image = new Image(256, 256);
      images[1].resolve({ data: image });
      await newer;
      images[0].resolve({ data: new Image(256, 256) });
      await older;

      expect(texture.update).toHaveBeenCalledExactlyOnceWith(image, { useMipmap: true });
      expect(tile.texture).toBe(texture);
      expect(tile.state).toBe("loaded");
      expect(Object.hasOwn(tile, "abortController")).toBe(false);
      expect(maplibregl.RasterDEMTileSource.prototype.loadTile).toBe(nativeDemLoad);
    } finally {
      maplibregl.removeProtocol("otef-raster-test");
    }
  });

  test("a newer load of the same Tile completes before the older transform without an undefined controller", async () => {
    const transforms = [deferred(), deferred()];
    const getImage = vi.fn(async (_request, controller) => {
      expect(controller?.signal).toBeDefined();
      return { data: {} };
    });
    const maplibregl = createMapLibreWithRasterSource(mapLibreFiveLoadTile(getImage));
    installMapLibreRasterAbortFix(maplibregl);
    const source = new maplibregl.RasterTileSource();
    let index = 0;
    source.map._requestManager.transformRequest = () => transforms[index++].promise;
    const tile = rasterTile();
    const older = source.loadTile(tile);
    const newer = source.loadTile(tile);

    transforms[1].resolve({ url: "https://example.test/newer" });
    await newer;
    transforms[0].resolve({ url: "https://example.test/older" });
    await older;

    expect(getImage).toHaveBeenCalledTimes(1);
    expect(tile.state).toBe("loaded");
    expect(Object.hasOwn(tile, "abortController")).toBe(false);
  });

  test("superseding a same-Tile fetch cancels only its older invocation and preserves the newer loaded state", async () => {
    const images = [deferred(), deferred()];
    const signals = [];
    const getImage = vi.fn((_request, controller) => {
      signals.push(controller.signal);
      return images[signals.length - 1].promise;
    });
    const maplibregl = createMapLibreWithRasterSource(mapLibreFiveLoadTile(getImage));
    installMapLibreRasterAbortFix(maplibregl);
    const source = new maplibregl.RasterTileSource();
    const tile = rasterTile();
    const older = source.loadTile(tile);
    await Promise.resolve();
    const newer = source.loadTile(tile);
    await Promise.resolve();

    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    images[1].resolve({ data: {} });
    await newer;
    images[0].reject(abortError());
    await older;

    expect(tile.state).toBe("loaded");
  });

  test("an older completion cannot overwrite the pending newer state or remove its cancellation controller", async () => {
    const olderImage = deferred();
    const newerTransform = deferred();
    const getImage = vi.fn(() => olderImage.promise);
    const maplibregl = createMapLibreWithRasterSource(mapLibreFiveLoadTile(getImage));
    installMapLibreRasterAbortFix(maplibregl);
    const source = new maplibregl.RasterTileSource();
    const tile = rasterTile();
    const older = source.loadTile(tile);
    await Promise.resolve();
    source.map._requestManager.transformRequest = () => newerTransform.promise;
    const newer = source.loadTile(tile);

    olderImage.resolve({ data: {} });
    await older;
    expect(tile.state).toBe("loading");
    await source.abortTile(tile);
    newerTransform.resolve({ url: "https://example.test/newer" });
    await newer;

    expect(getImage).toHaveBeenCalledTimes(1);
    expect(tile.state).toBe("unloaded");
  });

  test("a stale non-abort rejection cannot mark the newer loaded Tile errored", async () => {
    const olderImage = deferred();
    const getImage = vi.fn()
      .mockImplementationOnce(() => olderImage.promise)
      .mockResolvedValue({ data: {} });
    const maplibregl = createMapLibreWithRasterSource(mapLibreFiveLoadTile(getImage));
    installMapLibreRasterAbortFix(maplibregl);
    const source = new maplibregl.RasterTileSource();
    const tile = rasterTile();
    const older = source.loadTile(tile);
    await Promise.resolve();
    await source.loadTile(tile);
    olderImage.reject(new Error("late network failure"));
    await older;

    expect(tile.state).toBe("loaded");
  });

  test("leaves raster-DEM load and abort handling native", async () => {
    const maplibregl = createMapLibreWithRasterSource(mapLibreFiveLoadTile(vi.fn()));
    class RasterDEMTileSource extends maplibregl.RasterTileSource {
      constructor() {
        super();
        this.type = "raster-dem";
      }
      async loadTile(tile) {
        tile.abortController = new AbortController();
        tile.state = "loaded";
      }
    }
    const nativeLoad = RasterDEMTileSource.prototype.loadTile;
    maplibregl.RasterDEMTileSource = RasterDEMTileSource;
    installMapLibreRasterAbortFix(maplibregl);
    const source = new RasterDEMTileSource();
    const tile = rasterTile();
    await source.loadTile(tile);
    const signal = tile.abortController.signal;
    await source.abortTile(tile);

    expect(RasterDEMTileSource.prototype.loadTile).toBe(nativeLoad);
    expect(signal.aborted).toBe(true);
    expect(Object.hasOwn(tile, "abortController")).toBe(false);
  });

  test("does not patch a MapLibre version other than the supported 5.24.0", () => {
    const maplibregl = createMapLibreWithRasterSource(mapLibreFiveLoadTile(vi.fn()));
    const nativeLoad = maplibregl.RasterTileSource.prototype.loadTile;
    maplibregl.getVersion = () => "6.4.0";
    installMapLibreRasterAbortFix(maplibregl);
    expect(maplibregl.RasterTileSource.prototype.loadTile).toBe(nativeLoad);
  });

  test("an abort during transformRequest does not queue getImage with an undefined controller", async () => {
    const getImage = vi.fn(async (_request, abortController) => {
      expect(abortController).toBeDefined();
      expect(abortController.signal).toBeDefined();
      if (abortController.signal.aborted) throw abortError();
      return { data: {} };
    });
    const maplibregl = createMapLibreWithRasterSource(mapLibreFiveLoadTile(getImage));
    installMapLibreRasterAbortFix(maplibregl);
    const source = new maplibregl.RasterTileSource();
    const releaseTransform = hangingTransform(source);
    const tile = {
      tileID: { canonical: { url: () => "https://example.test/1/2/3" } },
      aborted: false,
      state: "loading",
    };

    const loading = source.loadTile(tile);
    await source.abortTile(tile);
    tile.aborted = true;
    releaseTransform();
    await loading;

    expect(getImage).not.toHaveBeenCalled();
    expect(tile.state).toBe("unloaded");
  });

  test("an abort in the microtask after a sync transformRequest does not queue getImage with undefined", async () => {
    const getImage = vi.fn(async (_request, abortController) => {
      expect(abortController?.signal).toBeDefined();
      if (abortController.signal.aborted) throw abortError();
      return { data: {} };
    });
    const maplibregl = createMapLibreWithRasterSource(mapLibreFiveLoadTile(getImage));
    installMapLibreRasterAbortFix(maplibregl);
    const source = new maplibregl.RasterTileSource();
    const tile = {
      tileID: { canonical: { url: () => "https://example.test/sync" } },
      aborted: false,
      state: "loading",
    };

    const loading = source.loadTile(tile);
    await source.abortTile(tile);
    tile.aborted = true;
    await loading;

    expect(getImage).not.toHaveBeenCalled();
    expect(tile.state).toBe("unloaded");
  });

  test("a completed load still hands getImage a live abort controller", async () => {
    const getImage = vi.fn(async (_request, abortController) => {
      expect(abortController?.signal?.aborted).toBe(false);
      return { data: { width: 256 } };
    });
    const maplibregl = createMapLibreWithRasterSource(mapLibreFiveLoadTile(getImage));
    installMapLibreRasterAbortFix(maplibregl);
    const source = new maplibregl.RasterTileSource();
    const tile = {
      tileID: { canonical: { url: () => "https://example.test/8/1/2" } },
      aborted: false,
      state: "loading",
    };

    await source.loadTile(tile);

    expect(getImage).toHaveBeenCalledTimes(1);
    expect(tile.state).toBe("loaded");
  });

  test("aborting one tile during transform leaves a sibling tile load intact", async () => {
    const getImage = vi.fn(async (_request, abortController) => {
      expect(abortController?.signal).toBeDefined();
      if (abortController.signal.aborted) throw abortError();
      return { data: { width: 256 } };
    });
    const maplibregl = createMapLibreWithRasterSource(mapLibreFiveLoadTile(getImage));
    installMapLibreRasterAbortFix(maplibregl);
    const source = new maplibregl.RasterTileSource();
    const pending = new Map();
    source.map._requestManager.transformRequest = (url) => new Promise((resolve) => {
      pending.set(url, () => resolve({ url }));
    });
    const tileA = {
      tileID: { canonical: { url: () => "https://example.test/a" } },
      aborted: false,
      state: "loading",
    };
    const tileB = {
      tileID: { canonical: { url: () => "https://example.test/b" } },
      aborted: false,
      state: "loading",
    };

    const loadingA = source.loadTile(tileA);
    const loadingB = source.loadTile(tileB);
    await source.abortTile(tileA);
    tileA.aborted = true;
    pending.get("https://example.test/a")();
    pending.get("https://example.test/b")();
    await loadingA;
    await loadingB;

    expect(tileA.state).toBe("unloaded");
    expect(tileB.state).toBe("loaded");
    expect(getImage).toHaveBeenCalledTimes(1);
    expect(getImage.mock.calls[0][0].url).toBe("https://example.test/b");
  });

  test("an aborted load that never settles does not poison a later load of the same URL", async () => {
    const getImage = vi.fn((_request, abortController) => {
      expect(abortController?.signal).toBeDefined();
      if (getImage.mock.calls.length === 1) return new Promise(() => {});
      if (abortController.signal.aborted) throw abortError();
      return Promise.resolve({ data: { width: 256 } });
    });
    const maplibregl = createMapLibreWithRasterSource(mapLibreFiveLoadTile(getImage));
    installMapLibreRasterAbortFix(maplibregl);
    const source = new maplibregl.RasterTileSource();
    const originalTransform = source.map._requestManager.transformRequest;
    const tileUrl = () => "https://example.test/same";
    const tileA = {
      tileID: { canonical: { url: tileUrl } },
      aborted: false,
      state: "loading",
    };
    const tileB = {
      tileID: { canonical: { url: tileUrl } },
      aborted: false,
      state: "loading",
    };

    const loadingA = source.loadTile(tileA);
    await vi.waitFor(() => {
      expect(getImage).toHaveBeenCalledTimes(1);
    });
    await source.abortTile(tileA);
    tileA.aborted = true;

    await source.loadTile(tileB);

    expect(getImage).toHaveBeenCalledTimes(2);
    expect(tileB.state).toBe("loaded");
    expect(source.map._requestManager.transformRequest).toBe(originalTransform);
    loadingA.catch(() => {});
  });

  test("is a no-op when RasterTileSource is missing", () => {
    const maplibregl = {};
    expect(() => installMapLibreRasterAbortFix(maplibregl)).not.toThrow();
    expect(installMapLibreRasterAbortFix(null)).toBeNull();
  });
});

describe("MapLibre obtain sites install the raster abort fix", () => {
  test("GIS and projection map modules apply the fix to the CDN global", () => {
    const gis = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../frontend/src/map/maplibre-map.js"),
      "utf8",
    );
    const projection = fs.readFileSync(
      path.resolve(import.meta.dirname, "../../frontend/src/projection/maplibre-projection.js"),
      "utf8",
    );
    expect(gis).toMatch(/import \{ installMapLibreRasterAbortFix \} from "\.\/maplibre-raster-abort-fix\.js"/);
    expect(gis).toMatch(/installMapLibreRasterAbortFix\(maplibregl\)/);
    expect(projection).toMatch(/import \{ installMapLibreRasterAbortFix \} from "\.\.\/map\/maplibre-raster-abort-fix\.js"/);
    expect(projection).toMatch(/installMapLibreRasterAbortFix\(maplibregl\)/);
  });
});
