const { buildMapOptions } = require("../../frontend/src/map/map-options");

describe("map-options", () => {
  test("returns Leaflet map options with preferCanvas enabled by config", () => {
    const opts = buildMapOptions({ ENABLE_PREFER_CANVAS: true });
    expect(opts.preferCanvas).toBe(true);
    expect(opts.zoomControl).toBe(false);
    expect(opts.maxBoundsViscosity).toBe(1.0);
  });

  test("preferCanvas defaults to false when not configured", () => {
    const opts = buildMapOptions();
    expect(opts.preferCanvas).toBe(false);
  });
});

