import { expect, test, vi } from "vitest";
import { createProjectionSurfaceCompositor, resolveProjectionSceneLayers } from "../../frontend/src/projection/projection-surface-compositor.js";

test('names render between map and upper caption/pattern/legend layers', () => {
  expect(resolveProjectionSceneLayers({ legend: {}, names: {}, image: {}, caption: {}, map: {}, pattern: {} }).map((layer) => layer.id))
    .toEqual(['image', 'map', 'names', 'caption', 'pattern', 'legend']);
});

test("resolves scene order and passes explicit descriptors without readback", () => {
  const draw = vi.fn();
  const renderer = { draw };
  const image = {}, map = {}, caption = {}, pattern = {}, legend = {};
  const compositor = createProjectionSurfaceCompositor({ renderer, sources: { image: { source: image }, map: { source: map }, caption: { source: caption }, pattern: { source: pattern }, legend: { source: legend } } });
  expect(resolveProjectionSceneLayers({ image: { source: image }, map: { source: map }, caption: { source: {} }, legend: { source: {} }, pattern: { source: {} } }).map((x) => x.id))
    .toEqual(["image", "map", "caption", "pattern", "legend"]);
  compositor.draw();
  expect(draw).toHaveBeenCalledWith({ layers: [
    { source: image, id: "image" }, { source: map, id: "map" }, { source: caption, id: "caption" }, { source: pattern, id: "pattern" }, { source: legend, id: "legend" },
  ] });
  expect(draw.mock.calls[0][0]).not.toHaveProperty("readPixels");
});

test("rejects a scene value that was not converted to a texture descriptor", () => {
  const compositor = createProjectionSurfaceCompositor({ renderer: { draw: vi.fn() }, sources: { image: {} } });
  expect(() => compositor.draw()).toThrow(/explicit texture descriptor/);
});

test("keeps a composition error local to browser mode", () => {
  const renderer = { draw: vi.fn(() => { throw new Error("bad adapter"); }) };
  const compositor = createProjectionSurfaceCompositor({ renderer });
  expect(() => compositor.draw()).toThrow("bad adapter");
});
