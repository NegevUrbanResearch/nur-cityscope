import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  delete globalThis.maplibregl;
  delete globalThis.pmtiles;
});

test("forwards MapLibre canvas context attributes to the map constructor", async () => {
  const map = { fitBounds: vi.fn(), once: vi.fn() };
  const Map = vi.fn(function Map(options) { this.options = options; return map; });
  globalThis.maplibregl = { addProtocol: vi.fn(), Map };
  globalThis.pmtiles = { Protocol: class { tile() {} } };
  vi.resetModules();
  const { createProjectionMap } = await import("../../frontend/src/projection/maplibre-projection.js");
  const contextAttributes = { preserveDrawingBuffer: true, antialias: true };

  createProjectionMap("projectionMap", { center: [34.5, 31.4], bounds: [[34.2, 31.1], [34.8, 31.7]], zoom: 12 }, {
    pixelRatio: 1,
    canvasContextAttributes: contextAttributes,
  });

  expect(Map).toHaveBeenCalledOnce();
  const options = Map.mock.calls[0][0];
  expect(options.pixelRatio).toBe(1);
  expect(options.canvasContextAttributes).toEqual(contextAttributes);
  expect(options.preserveDrawingBuffer).toBeUndefined();
  expect(map.fitBounds).toHaveBeenCalledWith([[34.2, 31.1], [34.8, 31.7]], { animate: false, padding: 0 });
});
