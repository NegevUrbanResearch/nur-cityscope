import { afterEach, describe, expect, test, vi } from "vitest";
import { MapProjectionConfig } from "../../frontend/src/shared/map-projection-config.js";
import { getLayerLifecycleRuntime, resolveLayerFadeMs } from "../../frontend/src/shared/layer-lifecycle-fade.js";
import {
  projectionModelSubscribeReady,
  releaseProjectionModelImage,
  syncProjectionModelImage,
} from "../../frontend/src/projection/projection-model-image.js";
import {
  applyProjectionSpanView,
  clearProjectionSpanView,
  createProjectionImageDescriptor,
  createProjectionImageReadiness,
  createProjectionMapDescriptor,
  drawAfterMapRender,
  computeSpanJumpTo,
  computeTesugaPostFillJumpTo,
  computeTesugaPreT3JumpTo,
  getProjectionSpanRect,
  parseProjectionSpanId,
  runWhenMapIdle,
  spanHorizontalScale,
  spanViewportUvToT3Uv,
  spanVisibleCenterInT3,
  spanWidthZoomDelta,
  uvInsideSpanRect,
} from "../../frontend/src/projection/projection-span-view.js";

test("calibrated preview draw waits for the matching MapLibre render event", async () => {
  const listeners = new Map();
  const map = {
    on: vi.fn((type, listener) => { listeners.set(type, listener); }),
    off: vi.fn((type) => listeners.delete(type)),
    triggerRepaint: vi.fn(),
  };
  const draw = vi.fn(() => true);
  let settled = false;
  const completion = drawAfterMapRender(map, draw).then((result) => { settled = true; return result; });
  await Promise.resolve();
  expect(map.triggerRepaint).toHaveBeenCalledOnce();
  expect(draw).not.toHaveBeenCalled();
  expect(settled).toBe(false);
  listeners.get("render")?.({ type: "render" });
  await expect(completion).resolves.toBe(true);
  expect(draw).toHaveBeenCalledOnce();
  expect(map.off).toHaveBeenCalledWith("render", expect.any(Function));
});

test("bounded preview draw times out without a render and removes all listeners", async () => {
  vi.useFakeTimers();
  const listeners = new Map();
  const map = {
    on: vi.fn((type, listener) => { listeners.set(type, listener); }),
    off: vi.fn((type) => listeners.delete(type)),
    triggerRepaint: vi.fn(),
  };
  const signal = new AbortController().signal;
  const removeAbort = vi.spyOn(signal, "removeEventListener");
  const completion = drawAfterMapRender(map, vi.fn(), { signal, timeoutMs: 15000 });
  await Promise.resolve();
  expect(listeners.size).toBe(2);
  vi.advanceTimersByTime(15000);
  await expect(completion).rejects.toMatchObject({ code: "projection_draw_timeout" });
  expect(listeners.size).toBe(0);
  expect(map.off).toHaveBeenCalledWith("render", expect.any(Function));
  expect(map.off).toHaveBeenCalledWith("error", expect.any(Function));
  expect(removeAbort).toHaveBeenCalledWith("abort", expect.any(Function));
  vi.useRealTimers();
});

test("image readiness publishes a generation and requests repaint after decode", async () => {
  let resolveDecode;
  const listeners = new Map();
  const image = { complete: false, naturalWidth: 0, naturalHeight: 0, src: "", decode: () => new Promise((resolve) => { resolveDecode = resolve; }), addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: (type) => listeners.delete(type) };
  const repaint = vi.fn();
  const readiness = createProjectionImageReadiness({ imageEl: image, onReady: repaint });
  readiness.setSource("model.png");
  expect(readiness.contentVersion()).toBeNull();
  image.complete = true; image.naturalWidth = 100; image.naturalHeight = 50;
  listeners.get("load")();
  resolveDecode();
  await Promise.resolve(); await Promise.resolve();
  expect(readiness.contentVersion()).toBeGreaterThan(0);
  expect(repaint).toHaveBeenCalledTimes(1);
  readiness.dispose();
  expect(listeners.size).toBe(0);
});

test("same URL reload clears old pixels and ignores replaced or disposed decodes", async () => {
  const resolves = [];
  const listeners = new Map();
  const image = { complete: true, naturalWidth: 100, naturalHeight: 50, src: "", decode: () => new Promise((resolve) => resolves.push(resolve)), addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: (type) => listeners.delete(type) };
  const repaint = vi.fn();
  const readiness = createProjectionImageReadiness({ imageEl: image, onReady: repaint });
  readiness.setSource("model.png");
  resolves.shift()(); await Promise.resolve(); await Promise.resolve();
  const first = readiness.contentVersion();
  readiness.setSource("model.png");
  expect(readiness.contentVersion()).toBeNull();
  resolves.shift()(); await Promise.resolve(); await Promise.resolve();
  expect(readiness.contentVersion()).toBeGreaterThan(first);
  readiness.setSource("other.png");
  readiness.setSource("last.png");
  resolves.shift()(); await Promise.resolve(); await Promise.resolve();
  expect(readiness.contentVersion()).toBeNull();
  readiness.dispose();
  resolves.shift()(); await Promise.resolve(); await Promise.resolve();
  expect(readiness.contentVersion()).toBeNull();
});

test("failed image decode stays unready and reports an error", async () => {
  const error = vi.fn();
  const image = { complete: true, naturalWidth: 100, naturalHeight: 50, src: "", decode: () => Promise.reject(new Error("decode failed")), addEventListener() {}, removeEventListener() {} };
  const readiness = createProjectionImageReadiness({ imageEl: image, onError: error });
  readiness.setSource("bad.png");
  await Promise.resolve(); await Promise.resolve();
  expect(readiness.contentVersion()).toBeNull();
  expect(error).toHaveBeenCalledTimes(1);
  readiness.dispose();
});

test("map descriptors stay volatile while ready images carry supplied revisions", () => {
  const map = { getCanvas: () => ({ width: 1920, height: 1080 }), getContainer: () => ({ clientWidth: 1920, clientHeight: 1080 }), project: ([x, y]) => ({ x, y }), _otefProjectionImage: { corners: [[0, 0], [100, 0], [100, 50], [0, 50]], width: 100, height: 50 } };
  const imageEl = { complete: true, naturalWidth: 100, naturalHeight: 50, style: {} };
  expect(createProjectionImageDescriptor({ map, imageEl, spanId: "left", contentVersion: 4 })?.contentVersion).toBe(4);
  expect(createProjectionMapDescriptor({ map, spanId: "left" })).not.toHaveProperty("contentVersion");
});

const MODEL_ID = "projector_base.model_base";

function fadeHooks() {
  let time = 0;
  let frame = null;
  let nextFrameId = 0;
  let nextTimerId = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTime(value) { time = value; },
    requestFrame(callback) {
      nextFrameId += 1;
      frame = { id: nextFrameId, callback };
      return nextFrameId;
    },
    cancelFrame(id) { if (frame?.id === id) frame = null; },
    flushFrame() {
      const current = frame;
      frame = null;
      current?.callback(time);
    },
    setTimer(callback, delay) {
      nextTimerId += 1;
      timers.set(nextTimerId, { callback, at: time + delay });
      return nextTimerId;
    },
    clearTimer(id) { timers.delete(id); },
    fireDueTimers() {
      for (const [id, timer] of [...timers]) {
        if (timer.at <= time) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    get pendingFrame() { return frame; },
  };
}

function warpMap() {
  return {
    getCanvas: () => ({ width: 1920, height: 1080 }),
    getContainer: () => ({ clientWidth: 1920, clientHeight: 1080 }),
    project: ([x, y]) => ({ x, y }),
    _otefProjectionImage: { corners: [[0, 0], [100, 0], [100, 50], [0, 50]], width: 100, height: 50 },
  };
}

function modelGroups(enabled) {
  return [{ id: "projector_base", enabled: true, layers: [{ id: "model_base", enabled }] }];
}

function modelImage(opacity = "0") {
  const listeners = new Map();
  return {
    complete: true,
    naturalWidth: 100,
    naturalHeight: 50,
    style: { opacity, transition: "" },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    dispatch(type) { listeners.get(type)?.(); },
  };
}

function shownModel(image, hooks, map = warpMap()) {
  const runtime = getLayerLifecycleRuntime(map, hooks);
  runtime.setDesiredIds([MODEL_ID], { durationMs: 600 });
  const requestDraw = vi.fn();
  syncProjectionModelImage({
    map,
    imageEl: image,
    layerGroups: modelGroups(true),
    modelInfo: { durationMs: 600, fromSlideshowTick: false },
    requestDraw,
  });
  runtime.commitBatch();
  return { runtime, requestDraw, map };
}

afterEach(() => {
  vi.restoreAllMocks();
});

test("a visible model stays visible without a new fade or draw", () => {
  const hooks = fadeHooks();
  const map = warpMap();
  const image = modelImage("1");
  const runtime = getLayerLifecycleRuntime(map, hooks);
  runtime.setDesiredIds([MODEL_ID], { durationMs: 600 });
  const requestDraw = vi.fn();
  const sync = () => syncProjectionModelImage({
    map,
    imageEl: image,
    layerGroups: modelGroups(true),
    modelInfo: { durationMs: 600, fromSlideshowTick: false },
    requestDraw,
  });
  sync();
  runtime.commitBatch();
  sync();
  runtime.commitBatch();
  expect(image.style.opacity).toBe("1");
  expect(requestDraw).not.toHaveBeenCalled();
  expect(hooks.pendingFrame).toBeNull();
  expect(createProjectionImageDescriptor({ map, imageEl: image, spanId: "left" }).source).toBe(image);
  runtime.setDesiredIds([], { durationMs: 600 });
  syncProjectionModelImage({
    map,
    imageEl: image,
    layerGroups: modelGroups(false),
    modelInfo: { durationMs: 600, fromSlideshowTick: false },
    requestDraw,
  });
  runtime.commitBatch();
  hooks.setTime(300);
  hooks.flushFrame();
  expect(Number(image.style.opacity)).toBeGreaterThan(0);
  expect(Number(image.style.opacity)).toBeLessThan(1);
  expect(createProjectionImageDescriptor({ map, imageEl: image, spanId: "left" }).source).toBe(image);
});

test("a model-only midpoint writes sampled opacity and asks the idle map to draw", () => {
  const hooks = fadeHooks();
  const image = modelImage("0");
  const { requestDraw, map } = shownModel(image, hooks);
  expect(map.on).toBeUndefined();
  hooks.setTime(300);
  hooks.flushFrame();
  const descriptor = createProjectionImageDescriptor({ map, imageEl: image, spanId: "left", contentVersion: 2 });
  expect(descriptor.opacity).toBeGreaterThan(0);
  expect(descriptor.opacity).toBeLessThan(1);
  expect(descriptor.source).toBe(image);
  expect(requestDraw).toHaveBeenCalled();
  hooks.setTime(600);
  hooks.flushFrame();
  hooks.setTime(900);
  hooks.flushFrame();
  expect(image.style.opacity).toBe("1");
  expect(hooks.pendingFrame).toBeNull();
});

test("a completed hide then show brings the model opacity back up", () => {
  const hooks = fadeHooks();
  const image = modelImage("0");
  const { runtime, requestDraw, map } = shownModel(image, hooks);
  hooks.setTime(600);
  hooks.flushFrame();
  expect(image.style.opacity).toBe("1");
  runtime.setDesiredIds([], { durationMs: 600 });
  syncProjectionModelImage({
    map,
    imageEl: image,
    layerGroups: modelGroups(false),
    modelInfo: { durationMs: 600, fromSlideshowTick: false },
    requestDraw,
  });
  runtime.commitBatch();
  hooks.setTime(1200);
  hooks.flushFrame();
  expect(image.style.opacity).toBe("0");
  requestDraw.mockClear();
  runtime.setDesiredIds([MODEL_ID], { durationMs: 600 });
  syncProjectionModelImage({
    map,
    imageEl: image,
    layerGroups: modelGroups(true),
    modelInfo: { durationMs: 600, fromSlideshowTick: false },
    requestDraw,
  });
  runtime.commitBatch();
  hooks.setTime(1500);
  hooks.flushFrame();
  const opacity = Number(image.style.opacity);
  expect(opacity).toBeGreaterThan(0);
  expect(opacity).toBeLessThan(1);
  expect(createProjectionImageDescriptor({ map, imageEl: image, spanId: "left" }).opacity).toBe(opacity);
  expect(requestDraw).toHaveBeenCalled();
});

test("a reversal keeps the same image and continues from the sampled factor", () => {
  const hooks = fadeHooks();
  const image = modelImage("0");
  const { runtime, map } = shownModel(image, hooks);
  hooks.setTime(300);
  hooks.flushFrame();
  const midpoint = Number(image.style.opacity);
  runtime.setDesiredIds([], { durationMs: 600 });
  syncProjectionModelImage({
    map,
    imageEl: image,
    layerGroups: modelGroups(false),
    modelInfo: { durationMs: 600, fromSlideshowTick: false },
    requestDraw: vi.fn(),
  });
  runtime.commitBatch();
  hooks.setTime(450);
  hooks.flushFrame();
  const reversed = Number(image.style.opacity);
  expect(reversed).toBeLessThan(midpoint);
  expect(reversed).toBeGreaterThan(0);
  runtime.setDesiredIds([MODEL_ID], { durationMs: 600 });
  syncProjectionModelImage({
    map,
    imageEl: image,
    layerGroups: modelGroups(true),
    modelInfo: { durationMs: 600, fromSlideshowTick: false },
    requestDraw: vi.fn(),
  });
  runtime.commitBatch();
  hooks.setTime(600);
  hooks.flushFrame();
  expect(Number(image.style.opacity)).toBeGreaterThan(reversed);
  expect(createProjectionImageDescriptor({ map, imageEl: image, spanId: "left" }).source).toBe(image);
});

test("explicit zero, reduced motion, retained refresh, and slideshow ticks snap the model", () => {
  const hooks = fadeHooks();
  const map = warpMap();
  getLayerLifecycleRuntime(map, hooks);
  const image = modelImage("0");
  const requestDraw = vi.fn();
  const snap = (modelInfo, enabled) => syncProjectionModelImage({
    map,
    imageEl: image,
    layerGroups: modelGroups(enabled),
    modelInfo,
    requestDraw,
  });
  snap({ durationMs: 0, fromSlideshowTick: false }, true);
  expect(image.style.opacity).toBe("1");
  expect(image.style.transition).toBe("none");
  image.style.opacity = "0.4";
  snap({ durationMs: resolveLayerFadeMs({}, "reduced"), fromSlideshowTick: false }, true);
  expect(image.style.opacity).toBe("1");
  image.style.opacity = "0.4";
  snap({ durationMs: resolveLayerFadeMs({ lifecycle: { retainDisabled: true } }), fromSlideshowTick: false }, false);
  expect(image.style.opacity).toBe("0");
  image.style.opacity = "0.4";
  snap({ durationMs: 0, fromSlideshowTick: true }, true);
  expect(image.style.opacity).toBe("1");
  hooks.setTime(600);
  hooks.flushFrame();
  expect(image.style.opacity).toBe("1");
  expect(requestDraw).not.toHaveBeenCalled();
  expect(hooks.pendingFrame).toBeNull();
});

test("an unready model stays hidden through the deadline, then fades when it is still desired", () => {
  const hooks = fadeHooks();
  const map = warpMap();
  const image = modelImage("0");
  image.complete = false;
  image.naturalWidth = 0;
  let markReady = null;
  const runtime = getLayerLifecycleRuntime(map, hooks);
  runtime.setDesiredIds([MODEL_ID], { durationMs: 600 });
  syncProjectionModelImage({
    map,
    imageEl: image,
    layerGroups: modelGroups(true),
    modelInfo: { durationMs: 600, fromSlideshowTick: false },
    requestDraw: vi.fn(),
    subscribeReady: ({ ready }) => { markReady = ready; },
  });
  runtime.commitBatch();
  expect(image.style.opacity).toBe("0");
  hooks.setTime(1200);
  hooks.fireDueTimers();
  expect(image.style.opacity).toBe("0");
  expect(hooks.pendingFrame).toBeNull();
  markReady();
  hooks.setTime(1500);
  hooks.flushFrame();
  expect(Number(image.style.opacity)).toBeGreaterThan(0);
  expect(Number(image.style.opacity)).toBeLessThan(1);
});

test("a deadline does not reveal a model that is no longer desired", () => {
  const hooks = fadeHooks();
  const map = warpMap();
  const image = modelImage("0");
  image.complete = false;
  image.naturalWidth = 0;
  let markReady = null;
  const runtime = getLayerLifecycleRuntime(map, hooks);
  runtime.setDesiredIds([MODEL_ID], { durationMs: 600 });
  syncProjectionModelImage({
    map,
    imageEl: image,
    layerGroups: modelGroups(true),
    modelInfo: { durationMs: 600, fromSlideshowTick: false },
    requestDraw: vi.fn(),
    subscribeReady: ({ ready }) => { markReady = ready; },
  });
  runtime.commitBatch();
  runtime.setDesiredIds([], { durationMs: 600 });
  syncProjectionModelImage({
    map,
    imageEl: image,
    layerGroups: modelGroups(false),
    modelInfo: { durationMs: 600, fromSlideshowTick: false },
    requestDraw: vi.fn(),
  });
  runtime.commitBatch();
  hooks.setTime(1200);
  hooks.fireDueTimers();
  markReady();
  hooks.flushFrame();
  expect(image.style.opacity).toBe("0");
});

test("a zero-size or errored model fails without blocking the shared batch", () => {
  const hooks = fadeHooks();
  const map = warpMap();
  const image = modelImage("0");
  image.complete = true;
  image.naturalWidth = 0;
  image.naturalHeight = 0;
  const other = modelImage("0");
  const runtime = getLayerLifecycleRuntime(map, hooks);
  const otherId = "registry.roads";
  runtime.setDesiredIds([MODEL_ID, otherId], { durationMs: 600 });
  runtime.registerElement(otherId, other, {
    subscribeReady: ({ ready }) => { ready(); },
  });
  syncProjectionModelImage({
    map,
    imageEl: image,
    layerGroups: modelGroups(true),
    modelInfo: { durationMs: 600, fromSlideshowTick: false },
    requestDraw: vi.fn(),
    subscribeReady: projectionModelSubscribeReady(image, { contentVersion: () => null }),
  });
  runtime.commitBatch();
  hooks.setTime(300);
  hooks.flushFrame();
  expect(Number(other.style.opacity)).toBeGreaterThan(0);
  expect(Number(other.style.opacity)).toBeLessThan(1);
  expect(image.style.opacity).toBe("0");

  const laterMap = warpMap();
  const laterImage = modelImage("0");
  laterImage.complete = false;
  laterImage.naturalWidth = 0;
  const laterOther = modelImage("0");
  const laterRuntime = getLayerLifecycleRuntime(laterMap, hooks);
  laterRuntime.setDesiredIds([MODEL_ID, otherId], { durationMs: 600 });
  laterRuntime.registerElement(otherId, laterOther, {
    subscribeReady: ({ ready }) => { ready(); },
  });
  syncProjectionModelImage({
    map: laterMap,
    imageEl: laterImage,
    layerGroups: modelGroups(true),
    modelInfo: { durationMs: 600, fromSlideshowTick: false },
    requestDraw: vi.fn(),
    subscribeReady: projectionModelSubscribeReady(laterImage, { contentVersion: () => null }),
  });
  laterRuntime.commitBatch();
  expect(laterOther.style.opacity).toBe("0");
  laterImage.dispatch("error");
  hooks.setTime(600);
  hooks.flushFrame();
  expect(Number(laterOther.style.opacity)).toBeGreaterThan(0);
  expect(laterImage.style.opacity).toBe("0");
});

test("a finished hide keeps a zero-size or errored model hidden until a later ready", () => {
  const hooks = fadeHooks();
  const map = warpMap();
  const image = modelImage("0");
  image.complete = true;
  image.naturalWidth = 0;
  image.naturalHeight = 0;
  const other = modelImage("0");
  const otherId = "registry.roads";
  const runtime = getLayerLifecycleRuntime(map, hooks);
  let version = null;
  let readyCalls = 0;
  const subscribeReady = (handlers) => projectionModelSubscribeReady(image, { contentVersion: () => version })({
    ready: () => {
      readyCalls += 1;
      handlers.ready();
    },
    failed: () => handlers.failed(),
  });
  const show = (ids) => {
    runtime.setDesiredIds(ids, { durationMs: 600 });
    if (ids.includes(otherId)) {
      runtime.registerElement(otherId, other, {
        subscribeReady: ({ ready }) => { ready(); },
      });
    }
    syncProjectionModelImage({
      map,
      imageEl: image,
      layerGroups: modelGroups(ids.includes(MODEL_ID)),
      modelInfo: { durationMs: 600, fromSlideshowTick: false },
      requestDraw: vi.fn(),
      subscribeReady,
    });
    runtime.commitBatch();
  };

  hooks.setTime(0);
  show([MODEL_ID, otherId]);
  hooks.setTime(300);
  hooks.flushFrame();
  expect(image.style.opacity).toBe("0");
  expect(Number(other.style.opacity)).toBeGreaterThan(0);
  expect(Number(other.style.opacity)).toBeLessThan(1);

  hooks.setTime(600);
  hooks.flushFrame();
  show([]);
  hooks.setTime(1200);
  hooks.flushFrame();
  expect(image.style.opacity).toBe("0");
  expect(other.style.opacity).toBe("0");

  show([MODEL_ID, otherId]);
  hooks.setTime(1500);
  hooks.flushFrame();
  expect(image.style.opacity).toBe("0");
  expect(readyCalls).toBe(0);
  expect(Number(other.style.opacity)).toBeGreaterThan(0);
  expect(Number(other.style.opacity)).toBeLessThan(1);

  image.naturalWidth = 100;
  image.naturalHeight = 50;
  version = 1;
  show([MODEL_ID, otherId]);
  expect(readyCalls).toBe(1);
  expect(image.style.opacity).toBe("0");
  hooks.setTime(1800);
  hooks.flushFrame();
  expect(Number(image.style.opacity)).toBeGreaterThan(0);
  expect(Number(image.style.opacity)).toBeLessThan(1);
  hooks.setTime(2100);
  hooks.flushFrame();
  expect(image.style.opacity).toBe("1");

  const errorHooks = fadeHooks();
  const errorMap = warpMap();
  const errorImage = modelImage("0");
  errorImage.complete = false;
  errorImage.naturalWidth = 0;
  errorImage.naturalHeight = 0;
  const errorOther = modelImage("0");
  const errorRuntime = getLayerLifecycleRuntime(errorMap, errorHooks);
  let errorVersion = null;
  let errorReadyCalls = 0;
  const errorSubscribe = (handlers) => projectionModelSubscribeReady(errorImage, { contentVersion: () => errorVersion })({
    ready: () => {
      errorReadyCalls += 1;
      handlers.ready();
    },
    failed: () => handlers.failed(),
  });
  const showError = (ids) => {
    errorRuntime.setDesiredIds(ids, { durationMs: 600 });
    if (ids.includes(otherId)) {
      errorRuntime.registerElement(otherId, errorOther, {
        subscribeReady: ({ ready }) => { ready(); },
      });
    }
    syncProjectionModelImage({
      map: errorMap,
      imageEl: errorImage,
      layerGroups: modelGroups(ids.includes(MODEL_ID)),
      modelInfo: { durationMs: 600, fromSlideshowTick: false },
      requestDraw: vi.fn(),
      subscribeReady: errorSubscribe,
    });
    errorRuntime.commitBatch();
  };
  errorHooks.setTime(0);
  showError([MODEL_ID, otherId]);
  errorImage.complete = true;
  errorImage.dispatch("error");
  errorHooks.setTime(300);
  errorHooks.flushFrame();
  expect(errorImage.style.opacity).toBe("0");
  expect(Number(errorOther.style.opacity)).toBeGreaterThan(0);
  showError([]);
  errorHooks.setTime(900);
  errorHooks.flushFrame();
  expect(errorImage.style.opacity).toBe("0");
  expect(errorOther.style.opacity).toBe("0");
  showError([MODEL_ID, otherId]);
  errorHooks.setTime(1200);
  errorHooks.flushFrame();
  expect(errorImage.style.opacity).toBe("0");
  expect(errorReadyCalls).toBe(0);
  expect(Number(errorOther.style.opacity)).toBeGreaterThan(0);
  expect(Number(errorOther.style.opacity)).toBeLessThan(1);
  errorImage.naturalWidth = 80;
  errorImage.naturalHeight = 40;
  errorVersion = 2;
  showError([MODEL_ID, otherId]);
  expect(errorReadyCalls).toBe(1);
  expect(errorImage.style.opacity).toBe("0");
  errorHooks.setTime(1500);
  errorHooks.flushFrame();
  expect(Number(errorImage.style.opacity)).toBeGreaterThan(0);
  expect(Number(errorImage.style.opacity)).toBeLessThan(1);
});

test("a finished hide keeps a still-loading model hidden until its readiness callback", () => {
  const hooks = fadeHooks();
  const map = warpMap();
  const image = modelImage("0");
  image.complete = false;
  image.naturalWidth = 0;
  image.naturalHeight = 0;
  let version = null;
  const runtime = getLayerLifecycleRuntime(map, hooks);
  const show = (enabled) => {
    runtime.setDesiredIds(enabled ? [MODEL_ID] : [], { durationMs: 600 });
    syncProjectionModelImage({
      map,
      imageEl: image,
      layerGroups: modelGroups(enabled),
      modelInfo: { durationMs: 600, fromSlideshowTick: false },
      requestDraw: vi.fn(),
      subscribeReady: projectionModelSubscribeReady(image, { contentVersion: () => version }),
    });
    runtime.commitBatch();
  };

  hooks.setTime(0);
  show(true);
  expect(image.style.opacity).toBe("0");
  show(false);
  hooks.setTime(600);
  hooks.flushFrame();
  expect(image.style.opacity).toBe("0");

  hooks.setTime(600);
  show(true);
  hooks.setTime(900);
  hooks.flushFrame();
  expect(image.style.opacity).toBe("0");
  expect(hooks.pendingFrame).toBeNull();

  image.naturalWidth = 100;
  image.naturalHeight = 50;
  image.complete = true;
  version = 1;
  image.dispatch("load");
  expect(image.style.opacity).toBe("0");
  hooks.setTime(1200);
  hooks.flushFrame();
  expect(Number(image.style.opacity)).toBeGreaterThan(0);
  expect(Number(image.style.opacity)).toBeLessThan(1);
  hooks.setTime(1500);
  hooks.flushFrame();
  expect(image.style.opacity).toBe("1");
});

test("style reset drops model draw callbacks", () => {
  const hooks = fadeHooks();
  const image = modelImage("0");
  const { requestDraw, map } = shownModel(image, hooks);
  hooks.setTime(300);
  hooks.flushFrame();
  expect(requestDraw).toHaveBeenCalled();
  const calls = requestDraw.mock.calls.length;
  image.style.opacity = "";
  image.style.transition = "";
  releaseProjectionModelImage(map);
  hooks.setTime(600);
  hooks.flushFrame();
  expect(requestDraw).toHaveBeenCalledTimes(calls);
});

function createDomNode(tag = "div", id = "") {
  const node = {
    id,
    tagName: String(tag).toUpperCase(),
    style: {},
    parentElement: null,
    children: [],
    get firstChild() {
      return this.children[0] ?? null;
    },
    appendChild(child) {
      if (child.parentElement) {
        child.parentElement.removeChild(child);
      }
      child.parentElement = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      child.parentElement = null;
      return child;
    },
    querySelector(sel) {
      if (!sel?.startsWith("#")) return null;
      const want = sel.slice(1);
      const walk = (n) => {
        if (n.id === want) return n;
        for (const c of n.children) {
          const found = walk(c);
          if (found) return found;
        }
        return null;
      };
      return walk(this);
    },
  };
  return node;
}

function installFakeDocument() {
  globalThis.document = {
    createElement(tag) {
      return createDomNode(tag);
    },
  };
}

function makeSpanFixture() {
  installFakeDocument();
  const containerEl = createDomNode("div", "displayContainer");
  const imageEl = createDomNode("img", "displayedImage");
  const mapContainerEl = createDomNode("div", "projectionMap");
  const canvasEl = createDomNode("canvas");
  containerEl.appendChild(imageEl);
  containerEl.appendChild(mapContainerEl);
  let zoom = 10;
  let bearing = 0;
  const jumpTo = vi.fn((opts) => {
    if (typeof opts?.zoom === "number") zoom = opts.zoom;
    if (typeof opts?.bearing === "number") bearing = opts.bearing;
  });
  const fitBounds = vi.fn();
  const map = {
    getZoom: () => zoom,
    getBearing: () => bearing,
    unproject: (p) => ({ lng: p[0], lat: p[1] }),
    jumpTo,
    fitBounds,
    getCanvas: () => canvasEl,
    getContainer: () => mapContainerEl,
  };
  return { containerEl, imageEl, mapContainerEl, canvasEl, map, jumpTo, fitBounds };
}

test("PROJECTION_SPAN matches TouchDesigner crop fractions and transform3", () => {
  const s = MapProjectionConfig.PROJECTION_SPAN;
  expect(s.LEFT_X0).toBe(0);
  expect(s.LEFT_X1).toBe(0.6);
  expect(s.RIGHT_X0).toBe(0.4);
  expect(s.RIGHT_X1).toBe(1);
  expect(s.PRE_SCALE).toBe(1.41);
  expect(s.PRE_ROTATE_DEG).toBe(-50);
  expect(s.PRE_TX).toBe(0.01);
  expect(s.PRE_TY).toBe(0);
  expect(s.POST_SCALE).toBe(2);
  expect(s.POST_TY).toBe(-0.049);
});

test("2× fill overlap is 10% of transform3 so seam names are not double-painted", () => {
  const s = MapProjectionConfig.PROJECTION_SPAN;
  const half = 1 / (2 * s.POST_SCALE);
  const left = spanVisibleCenterInT3({ x0: 0, x1: 0.6 });
  const right = spanVisibleCenterInT3({ x0: 0.4, x1: 1 });
  const leftX1 = left.x + half;
  const rightX0 = right.x - half;
  expect(s.POST_SCALE).toBe(2);
  expect(leftX1).toBeCloseTo(0.55, 5);
  expect(rightX0).toBeCloseTo(0.45, 5);
  expect(leftX1 - rightX0).toBeCloseTo(0.1, 5);
  expect(leftX1 - rightX0).toBeLessThan(0.15);
});

test("runWhenMapIdle applies immediately when the map is already idle", () => {
  const fn = vi.fn();
  const once = vi.fn();
  runWhenMapIdle({ isMoving: () => false, once }, fn);
  expect(fn).toHaveBeenCalledTimes(1);
  expect(once).not.toHaveBeenCalled();
});

test("runWhenMapIdle waits for idle only while the camera is moving", () => {
  const fn = vi.fn();
  const once = vi.fn();
  runWhenMapIdle({ isMoving: () => true, once }, fn);
  expect(fn).not.toHaveBeenCalled();
  expect(once).toHaveBeenCalledWith("idle", fn);
});

describe("parseProjectionSpanId", () => {
  test("reads span=left and span=right", () => {
    expect(parseProjectionSpanId("?span=left")).toBe("left");
    expect(parseProjectionSpanId("?prd=1&span=right")).toBe("right");
  });

  test("returns null when missing or invalid", () => {
    expect(parseProjectionSpanId("")).toBe(null);
    expect(parseProjectionSpanId("?prd=1")).toBe(null);
    expect(parseProjectionSpanId("?span=full")).toBe(null);
    expect(parseProjectionSpanId("?span=")).toBe(null);
  });
});

test("getProjectionSpanRect maps ids to crop windows", () => {
  expect(getProjectionSpanRect("left")).toEqual({ x0: 0, x1: 0.6, y0: 0, y1: 1 });
  expect(getProjectionSpanRect("right")).toEqual({ x0: 0.4, x1: 1, y0: 0, y1: 1 });
  expect(getProjectionSpanRect(null)).toBe(null);
});

test("uvInsideSpanRect classifies synthetic UV inside/outside a visible rect without changing PROJECTION_SPAN", () => {
  const spanBefore = { ...MapProjectionConfig.PROJECTION_SPAN };
  const rect = { x0: 0.25, x1: 0.75 };
  expect(uvInsideSpanRect({ u: 0.5, v: 0.5 }, rect)).toBe(true);
  expect(uvInsideSpanRect({ u: 0.25, v: 0 }, rect)).toBe(true);
  expect(uvInsideSpanRect({ u: 0.75, v: 1 }, rect)).toBe(true);
  expect(uvInsideSpanRect({ u: 0.249, v: 0.5 }, rect)).toBe(false);
  expect(uvInsideSpanRect({ u: 0.751, v: 0.5 }, rect)).toBe(false);
  expect(uvInsideSpanRect({ u: 0.5, v: -0.01 }, rect)).toBe(false);
  expect(uvInsideSpanRect({ u: 0.5, v: 1.01 }, rect)).toBe(false);
  const right = getProjectionSpanRect("right");
  const midU = (right.x0 + right.x1) / 2;
  expect(uvInsideSpanRect({ u: midU, v: 0.5 }, right)).toBe(true);
  expect(uvInsideSpanRect({ u: right.x0 - 0.01, v: 0.5 }, right)).toBe(false);
  expect(MapProjectionConfig.PROJECTION_SPAN).toEqual(spanBefore);
});

test("spanViewportUvToT3Uv inverts the applied post-fill camera", () => {
  const right = getProjectionSpanRect("right");
  const visibleCenter = spanVisibleCenterInT3(right);
  const postScale = MapProjectionConfig.PROJECTION_SPAN.POST_SCALE;
  const halfVisibleExtent = 0.5 / postScale;

  expect(spanViewportUvToT3Uv({ u: 0, v: 0 }, right, undefined, "right").u).toBeCloseTo(visibleCenter.x - halfVisibleExtent, 10);
  expect(spanViewportUvToT3Uv({ u: 0, v: 0 }, right, undefined, "right").v).toBeCloseTo(visibleCenter.y - halfVisibleExtent, 10);
  expect(spanViewportUvToT3Uv({ u: 0.5, v: 0.5 }, right, undefined, "right")).toEqual(expect.objectContaining({ u: expect.closeTo(visibleCenter.x), v: expect.closeTo(visibleCenter.y) }));
  expect(spanViewportUvToT3Uv({ u: 1, v: 1 }, right, undefined, "right").u).toBeCloseTo(visibleCenter.x + halfVisibleExtent, 10);
  expect(spanViewportUvToT3Uv({ u: 1, v: 1 }, right, undefined, "right").v).toBeCloseTo(visibleCenter.y + halfVisibleExtent, 10);
});

test("spanViewportUvToT3Uv requires explicit branch identity", () => {
  const right = getProjectionSpanRect("right");
  expect(spanViewportUvToT3Uv({ u: 0.5, v: 0.5 }, right)).toBe(null);
});

test("spanViewportUvToT3Uv rejects project results outside the live viewport", () => {
  const right = getProjectionSpanRect("right");
  expect(spanViewportUvToT3Uv({ u: -0.001, v: 0.5 }, right, undefined, "right")).toBe(null);
  expect(spanViewportUvToT3Uv({ u: 1.001, v: 0.5 }, right, undefined, "right")).toBe(null);
  expect(spanViewportUvToT3Uv({ u: 0.5, v: -0.001 }, right, undefined, "right")).toBe(null);
  expect(spanViewportUvToT3Uv({ u: 0.5, v: 1.001 }, right, undefined, "right")).toBe(null);
});

test("spanHorizontalScale is inverse width fraction", () => {
  expect(spanHorizontalScale(0, 0.6)).toBeCloseTo(1 / 0.6, 10);
  expect(spanHorizontalScale(0.4, 1)).toBeCloseTo(1 / 0.6, 10);
});

test("span fill camera zooms to the 60% Tesuga crop so 1920 samples are native", () => {
  const visLeft = spanVisibleCenterInT3({ x0: 0, x1: 0.6 });
  const visRight = spanVisibleCenterInT3({ x0: 0.4, x1: 1 });
  expect(visLeft.x).toBeCloseTo(0.3, 5);
  expect(visRight.x).toBeCloseTo(0.7, 5);
  expect(visLeft.y).toBeCloseTo(0.5 - -0.049 / 2, 5);
  const jump = computeTesugaPostFillJumpTo({
    zoom: 10 + Math.log2(1.41),
    bearing: -50,
    width: 1920,
    height: 1080,
    unproject: (p) => ({ lng: p[0], lat: p[1] }),
    x0: 0,
    x1: 0.6,
  });
  expect(jump.zoom).toBeCloseTo(10 + Math.log2(1.41 * 2), 10);
  expect(jump.bearing).toBe(-50);
  expect(jump.center.lng).toBeCloseTo(0.3 * 1920, 5);
});

test("spanWidthZoomDelta is log2 of inverse width fraction and is not a camera zoom", () => {
  expect(spanWidthZoomDelta(0, 0.6)).toBeCloseTo(Math.log2(1 / 0.6), 10);
  expect(spanWidthZoomDelta(0.4, 1)).toBeCloseTo(Math.log2(1 / 0.6), 10);
});

test("span transform3 rotate is -50 from fitBounds north-up, not stacked on viewer_angle", () => {
  const unproject = (p) => ({ lng: p[0], lat: p[1] });
  const fromNorthUp = computeTesugaPreT3JumpTo({
    zoom: 10,
    bearing: 0,
    width: 1920,
    height: 1080,
    unproject,
  });
  const fromViewerAngle = computeTesugaPreT3JumpTo({
    zoom: 10,
    bearing: -59.007,
    width: 1920,
    height: 1080,
    unproject,
  });
  expect(fromNorthUp.bearing).toBe(-50);
  expect(fromViewerAngle.bearing).toBeCloseTo(-109.007, 5);
});

test("computeTesugaPreT3JumpTo adds transform3 scale and rotate to the fitBounds camera", () => {
  const unproject = (p) => ({ lng: p[0], lat: p[1] });
  const jump = computeTesugaPreT3JumpTo({
    zoom: 10,
    bearing: 0,
    width: 1920,
    height: 1080,
    unproject,
  });
  expect(jump.animate).toBe(false);
  expect(jump.bearing).toBe(-50);
  expect(jump.zoom).toBeCloseTo(10 + Math.log2(1.41), 10);
  expect(jump.center).toEqual({ lng: (0.5 - 0.01) * 1920, lat: 0.5 * 1080 });
});

test("computeSpanJumpTo pans to crop center and keeps the same zoom", () => {
  const unproject = (p) => ({ lng: p[0], lat: p[1] });
  const jump = computeSpanJumpTo({
    zoom: 12,
    bearing: 17,
    width: 1920,
    height: 1080,
    unproject,
    x0: 0,
    x1: 0.6,
  });
  expect(jump.animate).toBe(false);
  expect(jump.bearing).toBe(17);
  expect(jump.zoom).toBe(12);
  expect(jump.zoom).not.toBeCloseTo(12 + spanWidthZoomDelta(0, 0.6), 10);
  expect(jump.center).toEqual({ lng: 0.3 * 1920, lat: 0.5 * 1080 });
});

test("applyProjectionSpanView jumpTos T3 then transform1 fill and does not wrap the map", () => {
  const { containerEl, imageEl, mapContainerEl, canvasEl, map, jumpTo, fitBounds } =
    makeSpanFixture();
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: "left" });
  expect(fitBounds).not.toHaveBeenCalled();
  expect(jumpTo).toHaveBeenCalledTimes(2);
  expect(jumpTo.mock.calls[0][0]).toEqual(
    expect.objectContaining({
      zoom: 10 + Math.log2(1.41),
      bearing: -50,
      animate: false,
    }),
  );
  expect(jumpTo.mock.calls[1][0]).toEqual(
    expect.objectContaining({
      zoom: 10 + Math.log2(1.41 * 2),
      bearing: -50,
      animate: false,
    }),
  );
  expect(containerEl.style.overflow || "").toBe("");
  expect(containerEl.querySelector("#projectionSpanFitBest")).toBe(null);
  expect(containerEl.querySelector("#projectionSpanCropFit")).toBe(null);
  expect(containerEl.querySelector("#projectionSpanPreT3")).toBe(null);
  expect(containerEl.children).toEqual([imageEl, mapContainerEl]);
  expect(mapContainerEl.style.transform || "").toBe("");
  expect(canvasEl.style.transform).toBeUndefined();
  expect(imageEl.style.transform).toContain("rotate(-50deg)");
  expect(imageEl.style.transform).toContain(`scale(${1.41 * 2})`);
  const visLeft = spanVisibleCenterInT3({ x0: 0, x1: 0.6 });
  expect(imageEl.style.transformOrigin).toBe(`${visLeft.x * 100}% ${visLeft.y * 100}%`);
});

test("applyProjectionSpanView pans the fill camera to the right-eye T3 window", () => {
  const { containerEl, imageEl, mapContainerEl, map, jumpTo } = makeSpanFixture();
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: "right" });
  expect(jumpTo).toHaveBeenCalledTimes(2);
  const fill = jumpTo.mock.calls[1][0];
  const visRight = spanVisibleCenterInT3({ x0: 0.4, x1: 1 });
  expect(fill.center.lng).toBeCloseTo(visRight.x * 1920, 5);
  expect(fill.center.lat).toBeCloseTo(visRight.y * 1080, 5);
  expect(containerEl.children).toEqual([imageEl, mapContainerEl]);
});

test("applyProjectionSpanView is idempotent and does not insert wrappers", () => {
  const { containerEl, imageEl, map, mapContainerEl } = makeSpanFixture();
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: "left" });
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: "right" });
  expect(containerEl.children).toEqual([imageEl, mapContainerEl]);
  expect(containerEl.querySelector("#projectionSpanFitBest")).toBe(null);
});

test("applyProjectionSpanView left then left does not stack bearing or fill zoom", () => {
  const { containerEl, imageEl, map } = makeSpanFixture();
  expect(map.getZoom()).toBe(10);
  expect(map.getBearing()).toBe(0);
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: "left" });
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: "left" });
  expect(map.getBearing()).toBe(-50);
  expect(map.getZoom()).toBeCloseTo(10 + Math.log2(1.41 * 2), 10);
});

test("applyProjectionSpanView unwraps leftover Tesuga wrappers", () => {
  const { containerEl, imageEl, mapContainerEl, map } = makeSpanFixture();
  const fitBest = createDomNode("div", "projectionSpanFitBest");
  const cropFit = createDomNode("div", "projectionSpanCropFit");
  const preT3 = createDomNode("div", "projectionSpanPreT3");
  containerEl.removeChild(imageEl);
  containerEl.removeChild(mapContainerEl);
  preT3.appendChild(imageEl);
  preT3.appendChild(mapContainerEl);
  cropFit.appendChild(preT3);
  fitBest.appendChild(cropFit);
  containerEl.appendChild(fitBest);
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: "left" });
  expect(containerEl.querySelector("#projectionSpanFitBest")).toBe(null);
  expect(containerEl.querySelector("#projectionSpanCropFit")).toBe(null);
  expect(containerEl.querySelector("#projectionSpanPreT3")).toBe(null);
  expect(containerEl.children).toEqual([imageEl, mapContainerEl]);
  expect(imageEl.parentElement).toBe(containerEl);
  expect(mapContainerEl.parentElement).toBe(containerEl);
});

test("applyProjectionSpanView no-ops for null span and leaves the full page untransformed", () => {
  const { containerEl, imageEl, mapContainerEl, map, jumpTo } = makeSpanFixture();
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: null });
  expect(jumpTo).not.toHaveBeenCalled();
  expect(containerEl.querySelector("#projectionSpanCropFit")).toBe(null);
  expect(containerEl.querySelector("#projectionSpanPreT3")).toBe(null);
  expect(containerEl.children).toEqual([imageEl, mapContainerEl]);
  expect(imageEl.parentElement).toBe(containerEl);
  expect(mapContainerEl.parentElement).toBe(containerEl);
  expect(imageEl.style.transform || "").toBe("");
  expect(mapContainerEl.style.transform || "").toBe("");
  expect(containerEl.style.overflow || "").toBe("");
});

test("applyProjectionSpanView unwraps Tesuga layers when span becomes null", () => {
  const { containerEl, imageEl, mapContainerEl, map } = makeSpanFixture();
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: "left" });
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: null });
  expect(containerEl.querySelector("#projectionSpanCropFit")).toBe(null);
  expect(containerEl.querySelector("#projectionSpanPreT3")).toBe(null);
  expect(containerEl.children).toEqual([imageEl, mapContainerEl]);
  expect(imageEl.parentElement).toBe(containerEl);
  expect(mapContainerEl.parentElement).toBe(containerEl);
  expect(containerEl.style.overflow || "").toBe("");
});

test("clearProjectionSpanView unwraps layers and does not jumpTo", () => {
  const { containerEl, imageEl, mapContainerEl, map, jumpTo, fitBounds } = makeSpanFixture();
  applyProjectionSpanView({ map, imageEl, containerEl, spanId: "right" });
  jumpTo.mockClear();
  clearProjectionSpanView({ map, imageEl, containerEl });
  expect(jumpTo).not.toHaveBeenCalled();
  expect(fitBounds).not.toHaveBeenCalled();
  expect(containerEl.querySelector("#projectionSpanCropFit")).toBe(null);
  expect(containerEl.querySelector("#projectionSpanPreT3")).toBe(null);
  expect(containerEl.children).toEqual([imageEl, mapContainerEl]);
  expect(imageEl.style.transform || "").toBe("");
  expect(mapContainerEl.style.transform || "").toBe("");
  expect(containerEl.style.overflow || "").toBe("");
});

test("zero-duration model readiness retains the captured strict owner batch", async () => {
  const hooks = fadeHooks(), map = warpMap(), image = modelImage("1");
  const { runtime } = shownModel(image, hooks, map);
  const handle = runtime.setDesiredIds(["nli.people_names"], { durationMs: 0, requiredIds: ["nli.people_names"] });
  const pending = runtime.getPendingBatch();
  syncProjectionModelImage({ map, imageEl: image, layerGroups: modelGroups(false),
    modelInfo: { durationMs: 0, joinBatch: true }, sealBatch: false });
  expect(runtime.getPendingBatch()).toBe(pending);
  expect(image.style.opacity).toBe("1");
  let factor;
  runtime.registerOpacityTarget("nli.people_names", value => { factor = value; });
  runtime.commitBatch();
  expect(factor).toBe(0); expect(image.style.opacity).toBe("1");
  runtime.markMemberReady("nli.people_names");
  await expect(runtime.waitForBatch(handle)).resolves.toMatchObject({ status: "ready" });
  expect(image.style.opacity).toBe("0"); expect(factor).toBe(1); runtime.dispose();
});
