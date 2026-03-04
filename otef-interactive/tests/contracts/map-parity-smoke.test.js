test("map options consume centralized zoom config", async () => {
  const { buildMapOptions } = await import("../../frontend/src/map/map-options.js");
  const opts = buildMapOptions({});
  expect(opts.minZoom).toBe(10);
  expect(opts.maxZoom).toBe(19);
});
