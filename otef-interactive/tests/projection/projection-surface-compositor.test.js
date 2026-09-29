import { expect, test, vi } from "vitest";
import { createProjectionSurfaceCompositor, resolveProjectionSceneLayers } from "../../frontend/src/projection/projection-surface-compositor.js";
import { createProjectionImageDescriptor } from "../../frontend/src/projection/projection-span-view.js";
import { getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";
import { syncProjectionModelImage } from "../../frontend/src/projection/projection-model-image.js";

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

test("a model-only midpoint opacity is the opacity the warped renderer receives", () => {
  let time = 0;
  let frame = null;
  const hooks = {
    now: () => time,
    requestFrame(callback) { frame = { callback }; return 1; },
    cancelFrame() { frame = null; },
    setTimer() { return 1; },
    clearTimer() {},
  };
  const map = {
    getCanvas: () => ({ width: 1920, height: 1080 }),
    getContainer: () => ({ clientWidth: 1920, clientHeight: 1080 }),
    project: ([x, y]) => ({ x, y }),
    _otefProjectionImage: { corners: [[0, 0], [100, 0], [100, 50], [0, 50]], width: 100, height: 50 },
  };
  const image = { complete: true, naturalWidth: 100, naturalHeight: 50, style: { opacity: "0", transition: "" }, addEventListener() {}, removeEventListener() {} };
  const runtime = getLayerLifecycleRuntime(map, hooks);
  runtime.setDesiredIds(["projector_base.model_base"], { durationMs: 600 });
  const requestDraw = vi.fn();
  syncProjectionModelImage({
    map,
    imageEl: image,
    layerGroups: [{ id: "projector_base", enabled: true, layers: [{ id: "model_base", enabled: true }] }],
    modelInfo: { durationMs: 600, fromSlideshowTick: false },
    requestDraw,
  });
  runtime.commitBatch();
  time = 300;
  frame.callback(time);
  const descriptor = createProjectionImageDescriptor({ map, imageEl: image, spanId: "left", contentVersion: 1 });
  const draw = vi.fn();
  const compositor = createProjectionSurfaceCompositor({ renderer: { draw }, sources: { image: descriptor } });
  compositor.draw();
  expect(draw.mock.calls[0][0].layers[0].opacity).toBeGreaterThan(0);
  expect(draw.mock.calls[0][0].layers[0].opacity).toBeLessThan(1);
  expect(requestDraw).toHaveBeenCalled();
  expect(map.on).toBeUndefined();
});

test("keeps a composition error local to browser mode", () => {
  const renderer = { draw: vi.fn(() => { throw new Error("bad adapter"); }) };
  const compositor = createProjectionSurfaceCompositor({ renderer });
  expect(() => compositor.draw()).toThrow("bad adapter");
});
