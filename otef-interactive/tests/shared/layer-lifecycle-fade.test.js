import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LAYER_FADE_MS,
  LAYER_FADE_READY_TIMEOUT_MS,
  getLayerLifecycleRuntime,
  resolveLayerFadeMs,
  setPaintChannelsRememberedListener,
} from "../../frontend/src/shared/layer-lifecycle-fade.js";
import { mixOpacityExpression, scaleOpacityExpression } from "../../frontend/src/shared/layer-opacity-expression.js";

function createHooks() {
  let time = 0;
  let frame = null;
  let nextFrameId = 0;
  let nextTimerId = 0;
  const timers = new Map();
  const clearedTimers = [];
  const cancelledFrames = [];
  let frameRequests = 0;

  return {
    now: () => time,
    setTime(value) {
      time = value;
    },
    requestFrame(callback) {
      frameRequests += 1;
      nextFrameId += 1;
      frame = { id: nextFrameId, callback };
      return nextFrameId;
    },
    cancelFrame(id) {
      cancelledFrames.push(id);
      if (frame?.id === id) frame = null;
    },
    flushFrame() {
      const current = frame;
      frame = null;
      current?.callback(time);
    },
    setTimer(callback, delay) {
      nextTimerId += 1;
      timers.set(nextTimerId, { callback, at: time + delay, delay });
      return nextTimerId;
    },
    clearTimer(id) {
      clearedTimers.push(id);
      timers.delete(id);
    },
    fireDueTimers() {
      for (const [id, timer] of [...timers]) {
        if (timer.at <= time) {
          timers.delete(id);
          timer.callback();
        }
      }
    },
    get frameRequests() {
      return frameRequests;
    },
    get pendingFrame() {
      return frame;
    },
    get clearedTimers() {
      return clearedTimers;
    },
    get cancelledFrames() {
      return cancelledFrames;
    },
    get timerCount() {
      return timers.size;
    },
  };
}

function createMap() {
  const layers = new Map();
  const paints = new Map();
  return {
    addLayer(def) {
      layers.set(def.id, def);
      for (const [key, value] of Object.entries(def.paint || {})) {
        paints.set(`${def.id}\0${key}`, value);
      }
    },
    getLayer(id) {
      return layers.get(id) || null;
    },
    setPaintProperty(id, key, value) {
      const mapKey = `${id}\0${key}`;
      if (value === undefined) paints.delete(mapKey);
      else paints.set(mapKey, value);
    },
    getPaintProperty(id, key) {
      return paints.get(`${id}\0${key}`);
    },
  };
}

function paintOf(map, layerId, property) {
  return map.getPaintProperty(layerId, property);
}

function layerDef(id, paint, type = "fill") {
  return { id, type, paint };
}

function stage(runtime, map, fullId, def, bindings) {
  const staged = runtime.stageMapLayer(fullId, def, bindings);
  map.addLayer(staged.stagedLayerDef);
  return staged;
}

describe("resolveLayerFadeMs", () => {
  it("uses 600 as the default duration", () => {
    expect(LAYER_FADE_MS).toBe(600);
    expect(LAYER_FADE_READY_TIMEOUT_MS).toBe(1200);
    expect(resolveLayerFadeMs()).toBe(600);
    expect(resolveLayerFadeMs({})).toBe(600);
  });

  it("applies reduced, retain, and stage-hidden before an explicit duration", () => {
    const explicit = { transition: { transitionMs: 250 } };
    expect(resolveLayerFadeMs(explicit, "reduced")).toBe(0);
    expect(resolveLayerFadeMs({
      lifecycle: { retainDisabled: true },
      transition: { transitionMs: 250, stageHidden: true },
    }, "reduced")).toBe(0);
    expect(resolveLayerFadeMs({ lifecycle: { retainDisabled: true }, ...explicit }, "full")).toBe(0);
    expect(resolveLayerFadeMs({ transition: { stageHidden: true, transitionMs: 250 } }, "full")).toBe(0);
    expect(resolveLayerFadeMs({ lifecycle: { retainDisabled: false }, transition: { stageHidden: false, transitionMs: 250 } }, "full")).toBe(250);
    expect(resolveLayerFadeMs({ transition: { transitionMs: 0 } }, "full")).toBe(0);
  });

  it("clamps finite numeric durations at 0 and falls through for nonfinite or nonnumeric values", () => {
    expect(resolveLayerFadeMs({ transition: { transitionMs: -1 } }, "full")).toBe(0);
    expect(resolveLayerFadeMs({ transition: { transitionMs: -0.01 } }, "full")).toBe(0);
    expect(resolveLayerFadeMs({ transition: { transitionMs: 0 } }, "full")).toBe(0);
    expect(resolveLayerFadeMs({ transition: { transitionMs: 250 } }, "full")).toBe(250);
    for (const transitionMs of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "600", null, false]) {
      expect(resolveLayerFadeMs({ transition: { transitionMs } }, "full")).toBe(600);
    }
  });
});

describe("layer lifecycle runtime", () => {
  it("returns one runtime per map and replaces it after dispose", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    expect(getLayerLifecycleRuntime(map, hooks)).toBe(runtime);
    expect(getLayerLifecycleRuntime(createMap(), hooks)).not.toBe(runtime);
    runtime.dispose();
    expect(getLayerLifecycleRuntime(map, hooks)).not.toBe(runtime);
  });

  it("reuses the original clock after dispose when the next get omits hooks", () => {
    const map = createMap();
    const hooks = createHooks();
    const first = getLayerLifecycleRuntime(map, hooks);
    first.dispose();
    const second = getLayerLifecycleRuntime(map);
    second.setDesiredIds(["a"], { durationMs: 600 });
    const staged = second.stageMapLayer("a", layerDef("a", { "fill-opacity": 1 }));
    map.addLayer(staged.stagedLayerDef);
    second.markMemberReady("a");
    second.commitBatch();
    hooks.setTime(300);
    hooks.flushFrame();
    expect(paintOf(map, "a", "fill-opacity")).toBeCloseTo(0.5);
  });

  it("reports a paint channel only when that fullId registered it", () => {
    const map = createMap();
    const runtime = getLayerLifecycleRuntime(map, createHooks());
    expect(runtime.hasPaintChannel("people", "circle-opacity")).toBe(false);
    runtime.stageMapLayer("people", layerDef("people-circle", { "circle-radius": 4 }, "circle"));
    expect(runtime.hasPaintChannel("people", "circle-opacity")).toBe(true);
    expect(runtime.hasPaintChannel("people", "fill-opacity")).toBe(false);
    expect(runtime.readAuthoredOpacity("people", "circle-opacity")).toBeUndefined();
  });

  it("fades two incoming and two outgoing layers from a shared linear clock", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const torn = [];
    runtime.setDesiredIds(["out-a", "out-b"], { durationMs: 0 });
    stage(runtime, map, "out-a", layerDef("out-a", { "fill-opacity": 1 }), {
      onTeardown: () => torn.push("out-a"),
    });
    stage(runtime, map, "out-b", layerDef("out-b", { "fill-opacity": 1 }));
    runtime.commitBatch();

    hooks.setTime(0);
    runtime.setDesiredIds(["in-a", "in-b"], { durationMs: 600 });
    const staged = stage(runtime, map, "in-a", layerDef("in-a", {
      "circle-opacity": 1,
      "circle-stroke-opacity": 0.4,
      "circle-color": "#000",
    }, "circle"));
    expect(staged.stagedLayerDef.paint["circle-opacity"]).toBe(0);
    expect(staged.stagedLayerDef.paint["circle-stroke-opacity"]).toBe(0);
    expect(staged.stagedLayerDef.paint["circle-color"]).toBe("#000");
    stage(runtime, map, "in-b", layerDef("in-b", { "line-opacity": 1 }, "line"), {
      onTeardown: () => torn.push("in-b"),
    });
    runtime.markMemberReady("in-a");
    runtime.commitBatch();
    expect(hooks.frameRequests).toBe(0);
    hooks.setTime(100);
    runtime.markMemberReady("in-b");
    expect(hooks.pendingFrame).toBeTruthy();
    hooks.setTime(400);
    hooks.flushFrame();
    expect(paintOf(map, "in-a", "circle-opacity")).toBeCloseTo(0.5);
    expect(paintOf(map, "in-a", "circle-stroke-opacity")).toBeCloseTo(0.2);
    expect(paintOf(map, "in-b", "line-opacity")).toBeCloseTo(0.5);
    expect(paintOf(map, "out-a", "fill-opacity")).toBeCloseTo(0.5);
    expect(paintOf(map, "out-b", "fill-opacity")).toBeCloseTo(0.5);
    expect(paintOf(map, "in-a", "circle-opacity-transition")).toEqual({ duration: 0, delay: 0 });
    hooks.setTime(700);
    hooks.flushFrame();
    expect(paintOf(map, "in-a", "circle-opacity")).toBe(1);
    expect(paintOf(map, "in-a", "circle-stroke-opacity")).toBe(0.4);
    expect(paintOf(map, "in-b", "line-opacity")).toBe(1);
    expect(paintOf(map, "out-a", "fill-opacity")).toBe(0);
    expect(paintOf(map, "out-b", "fill-opacity")).toBe(0);
    expect(torn).toEqual(["out-a"]);
    hooks.flushFrame();
    expect(torn).toEqual(["out-a"]);
    expect(hooks.pendingFrame).toBeNull();
  });

  it("reverses from the midpoint and preserves an unchanged trajectory", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    runtime.setDesiredIds(["keep", "flip"], { durationMs: 600 });
    stage(runtime, map, "keep", layerDef("keep", { "fill-opacity": 1 }));
    stage(runtime, map, "flip", layerDef("flip", { "fill-opacity": 1 }));
    runtime.markMemberReady("keep");
    runtime.markMemberReady("flip");
    runtime.commitBatch();
    hooks.setTime(300);
    hooks.flushFrame();
    expect(paintOf(map, "keep", "fill-opacity")).toBeCloseTo(0.5);
    expect(paintOf(map, "flip", "fill-opacity")).toBeCloseTo(0.5);

    runtime.setDesiredIds(["keep"], { durationMs: 600 });
    runtime.commitBatch();
    hooks.setTime(600);
    hooks.flushFrame();
    expect(paintOf(map, "keep", "fill-opacity")).toBeCloseTo(1);
    expect(paintOf(map, "flip", "fill-opacity")).toBeCloseTo(0.25);
  });

  it("preserves the pending batch, guards, deadline, and active trajectory on same-set publish", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const teardowns = [];
    hooks.setTime(0);
    runtime.setDesiredIds(["a", "b"], { durationMs: 600 });
    const token = runtime.beginRequest("a");
    stage(runtime, map, "a", layerDef("a", { "fill-opacity": 1 }), {
      onTeardown: () => teardowns.push("a"),
    });
    stage(runtime, map, "b", layerDef("b", { "fill-opacity": 1 }));
    const pending = runtime.getPendingBatch();
    expect(pending.deadlineAt).toBe(1200);
    expect(pending.membership.slice().sort()).toEqual(["a", "b"]);
    const clearedBefore = hooks.clearedTimers.length;

    hooks.setTime(250);
    runtime.setDesiredIds(["a", "b"], { durationMs: 50, sameSet: true });
    expect(runtime.getPendingBatch()).toBe(pending);
    expect(pending.deadlineAt).toBe(1200);
    expect(pending.membership.slice().sort()).toEqual(["a", "b"]);
    expect(runtime.isRequestCurrent("a", token)).toBe(true);
    expect(hooks.clearedTimers.length).toBe(clearedBefore);
    expect(teardowns).toEqual([]);

    runtime.markMemberReady("a");
    runtime.markMemberReady("b");
    runtime.commitBatch();
    hooks.setTime(550);
    hooks.flushFrame();
    expect(paintOf(map, "a", "fill-opacity")).toBeCloseTo(0.5);
    runtime.setDesiredIds(["a", "b"], { durationMs: 600, sameSet: true });
    hooks.setTime(850);
    hooks.flushFrame();
    expect(paintOf(map, "a", "fill-opacity")).toBeCloseTo(1);
    expect(runtime.isRequestCurrent("a", token)).toBe(true);
  });

  it("settles immediately for a zero duration and restores transitions without a frame", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const transition = { duration: 300, delay: 10 };
    const teardowns = [];
    const duration = resolveLayerFadeMs({ transition: { transitionMs: 40 } }, "reduced");
    expect(duration).toBe(0);
    runtime.setDesiredIds(["shown"], { durationMs: duration });
    stage(runtime, map, "shown", layerDef("shown", {
      "fill-opacity": 0.8,
      "fill-opacity-transition": transition,
      "fill-color": "#123456",
    }));
    runtime.commitBatch();
    expect(paintOf(map, "shown", "fill-opacity")).toBe(0.8);
    expect(paintOf(map, "shown", "fill-opacity-transition")).toEqual(transition);
    expect(paintOf(map, "shown", "fill-color")).toBe("#123456");
    runtime.setDesiredIds(["hidden"], { durationMs: 0 });
    stage(runtime, map, "hidden", layerDef("hidden", { "fill-opacity": 1 }), {
      onTeardown: () => teardowns.push("hidden"),
    });
    runtime.commitBatch();
    runtime.setDesiredIds([], { durationMs: 0 });
    runtime.commitBatch();
    expect(teardowns).toEqual(["hidden"]);
    expect(hooks.frameRequests).toBe(0);
  });

  it("restores omitted opacity and omitted transitions at factor 1", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    runtime.setDesiredIds(["bare"], { durationMs: 600 });
    const staged = stage(runtime, map, "bare", layerDef("bare", { "fill-color": "#fff" }));
    expect(staged.stagedLayerDef.paint["fill-opacity"]).toBe(0);
    expect(runtime.readAuthoredOpacity("bare", "fill-opacity")).toBeUndefined();
    runtime.markMemberReady("bare");
    runtime.commitBatch();
    hooks.setTime(300);
    hooks.flushFrame();
    expect(paintOf(map, "bare", "fill-opacity")).toBeCloseTo(0.5);
    expect(paintOf(map, "bare", "fill-opacity-transition")).toEqual({ duration: 0, delay: 0 });
    hooks.setTime(600);
    hooks.flushFrame();
    expect(paintOf(map, "bare", "fill-opacity")).toBeUndefined();
    expect(paintOf(map, "bare", "fill-opacity-transition")).toBeUndefined();
    expect(hooks.pendingFrame).toBeNull();
  });

  it("samples DOM opacity with CSS transitions disabled on the same clock", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const element = { style: {} };
    const draws = [];
    runtime.setDesiredIds(["model"], { durationMs: 600 });
    runtime.registerElement("model", element, { onFrameDraw: () => draws.push(element.style.opacity) });
    expect(element.style.opacity).toBe("0");
    expect(element.style.transition).toBe("none");
    runtime.markMemberReady("model");
    runtime.commitBatch();
    hooks.setTime(300);
    hooks.flushFrame();
    expect(element.style.opacity).toBe("0.5");
    expect(element.style.transition).toBe("none");
    expect(draws).toEqual(["0.5"]);
    hooks.setTime(600);
    hooks.flushFrame();
    expect(element.style.opacity).toBe("1");
    const drawsAfter = draws.length;
    hooks.setTime(900);
    hooks.flushFrame();
    expect(draws.length).toBe(drawsAfter);
    expect(hooks.pendingFrame).toBeNull();
  });

  it("updates effective opacity without replacing the authored value", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    runtime.setDesiredIds(["people"], { durationMs: 600 });
    stage(runtime, map, "people", layerDef("people", { "circle-opacity": 1 }, "circle"));
    runtime.markMemberReady("people");
    runtime.commitBatch();
    hooks.setTime(300);
    hooks.flushFrame();
    runtime.updateEffectiveOpacity("people", "circle-opacity", 0.4);
    hooks.flushFrame();
    expect(runtime.readAuthoredOpacity("people", "circle-opacity")).toBe(1);
    expect(paintOf(map, "people", "circle-opacity")).toBeCloseTo(0.2);
    hooks.setTime(600);
    hooks.flushFrame();
    expect(paintOf(map, "people", "circle-opacity")).toBe(0.4);
  });

  it("rewrites expression opacity from the authored value on every frame", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const authored = ["match", ["get", "status"], "a", 0.5, 1];
    runtime.setDesiredIds(["fill"], { durationMs: 600 });
    stage(runtime, map, "fill", layerDef("fill", { "fill-opacity": authored }));
    runtime.markMemberReady("fill");
    runtime.commitBatch();
    hooks.setTime(300);
    hooks.flushFrame();
    expect(paintOf(map, "fill", "fill-opacity")).toEqual(scaleOpacityExpression(authored, 0.5));
    hooks.setTime(450);
    hooks.flushFrame();
    expect(paintOf(map, "fill", "fill-opacity")).toEqual(scaleOpacityExpression(authored, 0.75));
  });

  it("drops replaced channels and transfers the current factor", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    runtime.setDesiredIds(["edited"], { durationMs: 600 });
    stage(runtime, map, "edited", layerDef("edited-old", { "fill-opacity": 1 }));
    runtime.markMemberReady("edited");
    runtime.commitBatch();
    hooks.setTime(300);
    hooks.flushFrame();
    expect(paintOf(map, "edited-old", "fill-opacity")).toBeCloseTo(0.5);
    runtime.dropChannels("edited");
    stage(runtime, map, "edited", layerDef("edited-new", { "fill-opacity": 0.4 }));
    hooks.flushFrame();
    expect(paintOf(map, "edited-old", "fill-opacity")).toBeCloseTo(0.5);
    expect(paintOf(map, "edited-new", "fill-opacity")).toBeCloseTo(0.2);
    hooks.setTime(600);
    hooks.flushFrame();
    expect(paintOf(map, "edited-old", "fill-opacity")).toBeCloseTo(0.5);
    expect(paintOf(map, "edited-new", "fill-opacity")).toBeCloseTo(0.4);
  });

  it("applies the sampled factor synchronously to a replacement DOM element", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const oldElement = { style: {} };
    const newElement = { style: {} };
    runtime.setDesiredIds(["edited"], { durationMs: 600 });
    runtime.registerElement("edited", oldElement);
    runtime.markMemberReady("edited");
    runtime.commitBatch();
    hooks.setTime(300);
    hooks.flushFrame();
    expect(oldElement.style.opacity).toBe("0.5");

    runtime.dropChannels("edited");
    runtime.registerElement("edited", newElement);

    expect(newElement.style.opacity).toBe("0.5");
    hooks.setTime(450);
    hooks.flushFrame();
    expect(oldElement.style.opacity).toBe("0.5");
    expect(newElement.style.opacity).toBe("0.75");
  });

  it("commits members with different ready times together and cleans listeners", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const unsubscribed = [];
    hooks.setTime(0);
    runtime.setDesiredIds(["early", "late"], { durationMs: 600 });
    stage(runtime, map, "early", layerDef("early", { "fill-opacity": 1 }), {
      subscribeReady: () => () => unsubscribed.push("early"),
    });
    stage(runtime, map, "late", layerDef("late", { "fill-opacity": 1 }), {
      subscribeReady: () => () => unsubscribed.push("late"),
    });
    runtime.commitBatch();
    hooks.setTime(100);
    runtime.markMemberReady("early");
    expect(hooks.frameRequests).toBe(0);
    expect(runtime.getPendingBatch()).toBeTruthy();
    hooks.setTime(400);
    runtime.markMemberReady("late");
    hooks.setTime(700);
    hooks.flushFrame();
    expect(paintOf(map, "early", "fill-opacity")).toBeCloseTo(0.5);
    expect(paintOf(map, "late", "fill-opacity")).toBeCloseTo(0.5);
    expect(unsubscribed.slice().sort()).toEqual(["early", "late"]);
    expect(hooks.timerCount).toBe(0);
    expect(runtime.getPendingBatch()).toBeNull();
  });

  it("replaces readiness subscriptions when a member is restaged or resubscribed", () => {
    const map = createMap();
    const runtime = getLayerLifecycleRuntime(map, createHooks());
    const unsubscribed = [];
    const subscribe = (name) => () => () => unsubscribed.push(name);

    runtime.stageMapLayer("layer", layerDef("first", { "fill-opacity": 1 }), {
      subscribeReady: subscribe("first stage"),
    });
    runtime.stageMapLayer("layer", layerDef("second", { "fill-opacity": 1 }), {
      subscribeReady: subscribe("second stage"),
    });
    expect(unsubscribed).toEqual(["first stage"]);

    runtime.subscribeMemberReady("layer", subscribe("first direct"));
    expect(unsubscribed).toEqual(["first stage", "second stage"]);
    runtime.subscribeMemberReady("layer", subscribe("second direct"));
    expect(unsubscribed).toEqual(["first stage", "second stage", "first direct"]);

    runtime.dispose();
    expect(unsubscribed).toEqual([
      "first stage",
      "second stage",
      "first direct",
      "second direct",
    ]);
  });

  it("commits ready members at the deadline and gives later desired content a fresh fade", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    hooks.setTime(0);
    runtime.setDesiredIds(["ready", "cold"], { durationMs: 600 });
    stage(runtime, map, "ready", layerDef("ready", { "fill-opacity": 1 }));
    stage(runtime, map, "cold", layerDef("cold", { "fill-opacity": 1 }));
    runtime.markMemberReady("ready");
    hooks.setTime(1200);
    hooks.fireDueTimers();
    expect(paintOf(map, "cold", "fill-opacity")).toBe(0);
    hooks.setTime(1500);
    hooks.flushFrame();
    expect(paintOf(map, "ready", "fill-opacity")).toBeCloseTo(0.5);
    expect(paintOf(map, "cold", "fill-opacity")).toBe(0);
    runtime.markMemberReady("cold");
    hooks.setTime(1800);
    hooks.flushFrame();
    expect(paintOf(map, "ready", "fill-opacity")).toBeCloseTo(1);
    expect(paintOf(map, "cold", "fill-opacity")).toBeCloseTo(0.5);
    expect(hooks.timerCount).toBe(0);
  });

  it("starts one late fade and ignores a second ready signal", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const unsubscribed = [];
    hooks.setTime(0);
    runtime.setDesiredIds(["warm", "cold"], { durationMs: 600 });
    stage(runtime, map, "warm", layerDef("warm", { "fill-opacity": 1 }));
    stage(runtime, map, "cold", layerDef("cold", { "fill-opacity": 1 }), {
      subscribeReady: () => () => unsubscribed.push("cold"),
    });
    runtime.markMemberReady("warm");
    hooks.setTime(1200);
    hooks.fireDueTimers();
    expect(unsubscribed).toEqual([]);
    hooks.setTime(1500);
    runtime.markMemberReady("cold");
    expect(unsubscribed).toEqual(["cold"]);
    hooks.setTime(1800);
    hooks.flushFrame();
    expect(paintOf(map, "cold", "fill-opacity")).toBeCloseTo(0.5);
    runtime.markMemberReady("cold");
    expect(unsubscribed).toEqual(["cold"]);
    expect(paintOf(map, "cold", "fill-opacity")).toBeCloseTo(0.5);
    hooks.setTime(2100);
    hooks.flushFrame();
    expect(paintOf(map, "cold", "fill-opacity")).toBe(1);
    expect(hooks.pendingFrame).toBeNull();
  });

  it("adopts a hidden mounted member into the replacement batch and never reveals the dropped one", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const torn = [];
    let peakDropped = 0;
    const trackingMap = {
      ...map,
      setPaintProperty(id, key, value) {
        map.setPaintProperty(id, key, value);
        if (id === "dropped" && key === "fill-opacity" && typeof value === "number") {
          peakDropped = Math.max(peakDropped, value);
        }
      },
    };
    const trackingRuntime = getLayerLifecycleRuntime(trackingMap, hooks);
    hooks.setTime(0);
    trackingRuntime.setDesiredIds(["kept", "dropped"], { durationMs: 600 });
    const droppedToken = trackingRuntime.beginRequest("dropped");
    const keptToken = trackingRuntime.beginRequest("kept");
    stage(trackingRuntime, trackingMap, "kept", layerDef("kept", { "fill-opacity": 1 }));
    stage(trackingRuntime, trackingMap, "dropped", layerDef("dropped", { "fill-opacity": 1 }), {
      onTeardown: () => torn.push("dropped"),
    });
    trackingRuntime.markMemberReady("kept");
    hooks.setTime(200);
    trackingRuntime.setDesiredIds(["kept", "added"], { durationMs: 600 });
    expect(torn).toEqual(["dropped"]);
    expect(trackingRuntime.isRequestCurrent("dropped", droppedToken)).toBe(false);
    expect(trackingRuntime.isRequestCurrent("kept", keptToken)).toBe(true);
    expect(new Set(trackingRuntime.getPendingBatch().membership)).toEqual(new Set(["kept"]));
    stage(trackingRuntime, trackingMap, "added", layerDef("added", { "fill-opacity": 1 }));
    expect(new Set(trackingRuntime.getPendingBatch().membership)).toEqual(new Set(["kept", "added"]));
    trackingRuntime.markMemberReady("dropped");
    trackingRuntime.commitBatch();
    expect(hooks.frameRequests).toBe(0);
    hooks.setTime(500);
    trackingRuntime.markMemberReady("added");
    hooks.setTime(800);
    hooks.flushFrame();
    expect(paintOf(trackingMap, "kept", "fill-opacity")).toBeCloseTo(0.5);
    expect(paintOf(trackingMap, "added", "fill-opacity")).toBeCloseTo(0.5);
    expect(peakDropped).toBe(0);
    expect(paintOf(trackingMap, "dropped", "fill-opacity")).toBe(0);
  });

  it("does not let a failed or superseded member block or reveal", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    runtime.setDesiredIds(["ok", "bad", "old"], { durationMs: 600 });
    stage(runtime, map, "ok", layerDef("ok", { "fill-opacity": 1 }));
    stage(runtime, map, "bad", layerDef("bad", { "fill-opacity": 1 }));
    stage(runtime, map, "old", layerDef("old", { "fill-opacity": 1 }));
    runtime.markMemberFailed("bad");
    runtime.invalidateMember("old");
    runtime.markMemberReady("ok");
    runtime.markMemberReady("bad");
    runtime.markMemberReady("old");
    runtime.commitBatch();
    hooks.setTime(600);
    hooks.flushFrame();
    expect(paintOf(map, "ok", "fill-opacity")).toBe(1);
    expect(paintOf(map, "bad", "fill-opacity")).toBe(0);
    expect(paintOf(map, "old", "fill-opacity")).toBe(0);
  });

  it("starts ready siblings immediately when invalidate removes the last unready member", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    hooks.setTime(0);
    runtime.setDesiredIds(["ready", "gone"], { durationMs: 600 });
    stage(runtime, map, "ready", layerDef("ready", { "fill-opacity": 1 }));
    stage(runtime, map, "gone", layerDef("gone", { "fill-opacity": 1 }));
    runtime.markMemberReady("ready");
    runtime.commitBatch();
    expect(hooks.frameRequests).toBe(0);
    expect(runtime.getPendingBatch()).toBeTruthy();
    runtime.invalidateMember("gone");
    expect(runtime.getPendingBatch()).toBeNull();
    expect(hooks.pendingFrame).toBeTruthy();
    expect(hooks.timerCount).toBe(0);
    hooks.setTime(300);
    hooks.flushFrame();
    expect(paintOf(map, "ready", "fill-opacity")).toBeCloseTo(0.5);
    expect(paintOf(map, "gone", "fill-opacity")).toBe(0);
  });

  it("revokes teardown when a member is desired again before factor 0", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const torn = [];
    runtime.setDesiredIds(["layer"], { durationMs: 0 });
    stage(runtime, map, "layer", layerDef("layer", { "fill-opacity": 1 }), {
      onTeardown: () => torn.push("layer"),
    });
    runtime.commitBatch();
    hooks.setTime(0);
    runtime.setDesiredIds([], { durationMs: 600 });
    runtime.commitBatch();
    hooks.setTime(300);
    hooks.flushFrame();
    expect(paintOf(map, "layer", "fill-opacity")).toBeCloseTo(0.5);
    runtime.setDesiredIds(["layer"], { durationMs: 600 });
    runtime.commitBatch();
    hooks.setTime(900);
    hooks.flushFrame();
    expect(torn).toEqual([]);
    expect(paintOf(map, "layer", "fill-opacity")).toBeGreaterThan(0);
    runtime.setDesiredIds([], { durationMs: 0 });
    runtime.commitBatch();
    expect(torn).toEqual(["layer"]);
    runtime.commitBatch();
    expect(torn).toEqual(["layer"]);
  });

  it("snaps in-flight fades to an unchanged target when duration becomes 0", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const torn = [];
    let writes = 0;
    const countingMap = {
      ...map,
      setPaintProperty(id, key, value) {
        writes += 1;
        map.setPaintProperty(id, key, value);
      },
    };
    const countingRuntime = getLayerLifecycleRuntime(countingMap, hooks);
    countingRuntime.setDesiredIds(["out"], { durationMs: 0 });
    stage(countingRuntime, countingMap, "out", layerDef("out", { "fill-opacity": 1 }), {
      onTeardown: () => torn.push("out"),
    });
    countingRuntime.commitBatch();
    hooks.setTime(0);
    countingRuntime.setDesiredIds(["in"], { durationMs: 600 });
    stage(countingRuntime, countingMap, "in", layerDef("in", { "fill-opacity": 1 }));
    countingRuntime.markMemberReady("in");
    countingRuntime.commitBatch();
    hooks.setTime(300);
    hooks.flushFrame();
    expect(paintOf(countingMap, "in", "fill-opacity")).toBeCloseTo(0.5);
    expect(paintOf(countingMap, "out", "fill-opacity")).toBeCloseTo(0.5);
    const framesAtSnap = hooks.frameRequests;
    countingRuntime.setDesiredIds(["in"], { durationMs: 0 });
    expect(paintOf(countingMap, "in", "fill-opacity")).toBe(1);
    expect(paintOf(countingMap, "out", "fill-opacity")).toBe(0);
    expect(torn).toEqual(["out"]);
    expect(hooks.pendingFrame).toBeNull();
    const writesAfterSnap = writes;
    hooks.setTime(900);
    hooks.flushFrame();
    expect(paintOf(countingMap, "in", "fill-opacity")).toBe(1);
    expect(paintOf(countingMap, "out", "fill-opacity")).toBe(0);
    expect(torn).toEqual(["out"]);
    expect(writes).toBe(writesAfterSnap);
    expect(hooks.frameRequests).toBe(framesAtSnap);
  });

  it("clears failed on a new request or stage so a later attempt can reveal", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    hooks.setTime(0);
    runtime.setDesiredIds(["retried", "restaged"], { durationMs: 600 });
    stage(runtime, map, "retried", layerDef("retried", { "fill-opacity": 1 }));
    stage(runtime, map, "restaged", layerDef("restaged-old", { "fill-opacity": 1 }));
    runtime.markMemberFailed("retried");
    runtime.markMemberFailed("restaged");
    runtime.commitBatch();
    hooks.setTime(600);
    hooks.flushFrame();
    expect(paintOf(map, "retried", "fill-opacity")).toBe(0);
    expect(paintOf(map, "restaged-old", "fill-opacity")).toBe(0);

    runtime.beginRequest("retried");
    runtime.markMemberReady("retried");
    hooks.setTime(900);
    hooks.flushFrame();
    expect(paintOf(map, "retried", "fill-opacity")).toBeCloseTo(0.5);

    stage(runtime, map, "restaged", layerDef("restaged-new", { "fill-opacity": 1 }));
    runtime.markMemberReady("restaged");
    hooks.setTime(1200);
    hooks.flushFrame();
    expect(paintOf(map, "retried", "fill-opacity")).toBe(1);
    expect(paintOf(map, "restaged-new", "fill-opacity")).toBeCloseTo(0.5);
    hooks.setTime(1500);
    hooks.flushFrame();
    expect(paintOf(map, "restaged-new", "fill-opacity")).toBe(1);
  });

  it("clears failed on registerElement so a remounted element can reveal", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const element = { style: {} };
    hooks.setTime(0);
    runtime.setDesiredIds(["model"], { durationMs: 600 });
    runtime.registerElement("model", element);
    runtime.markMemberFailed("model");
    runtime.commitBatch();
    hooks.setTime(600);
    hooks.flushFrame();
    expect(element.style.opacity).toBe("0");

    const remounted = { style: {} };
    runtime.registerElement("model", remounted);
    runtime.markMemberReady("model");
    hooks.setTime(900);
    hooks.flushFrame();
    expect(remounted.style.opacity).toBe("0.5");
    hooks.setTime(1200);
    hooks.flushFrame();
    expect(remounted.style.opacity).toBe("1");
  });

  it("stops an in-progress fade when the member is invalidated", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const torn = [];
    hooks.setTime(0);
    runtime.setDesiredIds(["live"], { durationMs: 600 });
    stage(runtime, map, "live", layerDef("live", { "fill-opacity": 1 }), {
      onTeardown: () => torn.push("live"),
    });
    runtime.markMemberReady("live");
    runtime.commitBatch();
    hooks.setTime(300);
    hooks.flushFrame();
    expect(paintOf(map, "live", "fill-opacity")).toBeCloseTo(0.5);
    runtime.invalidateMember("live");
    expect(paintOf(map, "live", "fill-opacity")).toBe(0);
    expect(torn).toEqual(["live"]);
    hooks.setTime(600);
    hooks.flushFrame();
    expect(paintOf(map, "live", "fill-opacity")).toBe(0);
    expect(torn).toEqual(["live"]);
    runtime.markMemberReady("live");
    hooks.flushFrame();
    expect(paintOf(map, "live", "fill-opacity")).toBe(0);
  });

  it("cancels the frame, deadline, and readiness listeners on dispose", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    let unsubscribed = 0;
    runtime.setDesiredIds(["layer"], { durationMs: 600 });
    stage(runtime, map, "layer", layerDef("layer", { "fill-opacity": 1 }), {
      subscribeReady: () => () => {
        unsubscribed += 1;
      },
    });
    runtime.markMemberReady("layer");
    runtime.commitBatch();
    expect(hooks.pendingFrame).toBeTruthy();
    runtime.dispose();
    expect(hooks.cancelledFrames.length).toBeGreaterThan(0);
    expect(hooks.timerCount).toBe(0);
    expect(unsubscribed).toBe(1);
    const requests = hooks.frameRequests;
    hooks.flushFrame();
    hooks.setTime(600);
    hooks.flushFrame();
    expect(hooks.frameRequests).toBe(requests);
    expect(paintOf(map, "layer", "fill-opacity")).toBe(0);
  });
});

const GLOW_MS = 400;

function reveal(runtime, map, fullId, def) {
  runtime.setDesiredIds([fullId], { durationMs: 0 });
  const staged = stage(runtime, map, fullId, def);
  runtime.markMemberReady(fullId);
  runtime.commitBatch();
  return staged;
}

function withRemoveEvents(map) {
  const listeners = new Map();
  map.on = (type, handler) => {
    const list = listeners.get(type) || [];
    list.push(handler);
    listeners.set(type, list);
  };
  map.off = (type, handler) => {
    listeners.set(type, (listeners.get(type) || []).filter((entry) => entry !== handler));
  };
  map.remove = () => {
    for (const handler of [...(listeners.get("remove") || [])]) handler();
  };
  return map;
}

function countWrites(map, hooks) {
  const writes = [];
  const original = map.setPaintProperty.bind(map);
  map.setPaintProperty = (id, key, value) => {
    writes.push({ id, key, value, time: hooks.now() });
    original(id, key, value);
  };
  return writes;
}

describe("effective paint tweens", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("updates only the addressed line layer and treats an equal goal array as owned", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const fullId = "projector_base.Locations_Lines";
    runtime.setDesiredIds([fullId], { durationMs: 0 });
    stage(runtime, map, fullId, layerDef("line-a", { "line-opacity": 1 }, "line"));
    stage(runtime, map, fullId, layerDef("line-b", { "line-opacity": 1 }, "line"));
    runtime.markMemberReady(fullId);
    runtime.commitBatch();

    expect(runtime.updateEffectivePaint("missing", "line-a", "line-opacity", 0.2)).toBe(false);
    expect(runtime.updateEffectivePaint(fullId, "line-missing", "line-opacity", 0.2)).toBe(false);
    expect(runtime.updateEffectivePaint(fullId, "line-a", "line-opacity", 0.08, { tweenMs: 0 })).toBe(true);
    expect(paintOf(map, "line-a", "line-opacity")).toBe(0.08);
    expect(paintOf(map, "line-b", "line-opacity")).toBe(1);

    const goal = ["case", ["==", ["get", "kind"], "city"], 0.2, 1];
    expect(runtime.updateEffectivePaint(fullId, "line-b", "line-opacity", goal, { tweenMs: GLOW_MS })).toBe(true);
    const equalGoal = ["case", ["==", ["get", "kind"], "city"], 0.2, 1];
    expect(equalGoal).not.toBe(goal);
    expect(runtime.updateEffectivePaint(fullId, "line-b", "line-opacity", equalGoal, { tweenMs: 0 })).toBe(true);
    expect(paintOf(map, "line-b", "line-opacity")).toBe(1);
    hooks.setTime(GLOW_MS);
    hooks.flushFrame();
    expect(paintOf(map, "line-b", "line-opacity")).toEqual(goal);
    expect(paintOf(map, "line-a", "line-opacity")).toBe(0.08);
  });

  it("does not stage a sibling line with another layer's effective line opacity", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const fullId = "projector_base.Locations_Lines";
    runtime.setDesiredIds([fullId], { durationMs: 0 });
    stage(runtime, map, fullId, layerDef("line-a", { "line-opacity": 1 }, "line"));
    runtime.markMemberReady(fullId);
    runtime.commitBatch();
    expect(runtime.updateEffectivePaint(fullId, "line-a", "line-opacity", 0.08, { tweenMs: 0 })).toBe(true);
    expect(paintOf(map, "line-a", "line-opacity")).toBe(0.08);

    const staged = runtime.stageMapLayer(fullId, layerDef("line-b", { "line-opacity": 1 }, "line"));
    expect(staged.stagedLayerDef.paint["line-opacity"]).toBe(1);
    expect(paintOf(map, "line-a", "line-opacity")).toBe(0.08);
  });

  it("returns false for invalidated and torn-down channels", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    reveal(runtime, map, "live", layerDef("live", { "fill-opacity": 1 }));
    reveal(runtime, map, "gone", layerDef("gone", { "fill-opacity": 1 }));
    runtime.invalidateMember("gone");
    expect(runtime.updateEffectivePaint("gone", "gone", "fill-opacity", 0.08)).toBe(false);

    runtime.setDesiredIds([], { durationMs: 0 });
    runtime.commitBatch();
    expect(runtime.updateEffectivePaint("live", "live", "fill-opacity", 0.08, { tweenMs: 0 })).toBe(false);
    expect(paintOf(map, "live", "fill-opacity")).not.toBe(0.08);
  });

  it("tweens effective opacity with no factor trajectory and stops when it settles", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    reveal(runtime, map, "glow", layerDef("glow", {
      "fill-opacity": 1,
      "fill-opacity-transition": { duration: 350, delay: 20 },
    }));
    expect(hooks.pendingFrame).toBeNull();

    expect(runtime.updateEffectivePaint("glow", "glow", "fill-opacity", 0.08, { tweenMs: GLOW_MS })).toBe(true);
    hooks.setTime(200);
    hooks.flushFrame();
    expect(paintOf(map, "glow", "fill-opacity")).toBeCloseTo(0.54);
    hooks.setTime(GLOW_MS);
    hooks.flushFrame();
    expect(paintOf(map, "glow", "fill-opacity")).toBe(0.08);
    expect(paintOf(map, "glow", "fill-opacity-transition")).toEqual({ duration: 0, delay: 0 });
    const frames = hooks.frameRequests;
    expect(hooks.pendingFrame).toBeNull();
    hooks.setTime(800);
    hooks.flushFrame();
    expect(hooks.frameRequests).toBe(frames);
    expect(paintOf(map, "glow", "fill-opacity")).toBe(0.08);
  });

  it("retargets from the clock sample between frames and settles on the new goal", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    reveal(runtime, map, "glow", layerDef("glow", { "fill-opacity": 1 }));
    runtime.updateEffectivePaint("glow", "glow", "fill-opacity", 0.08, { tweenMs: GLOW_MS });
    hooks.setTime(100);
    hooks.flushFrame();
    expect(paintOf(map, "glow", "fill-opacity")).toBeCloseTo(0.77);

    const readPaint = map.getPaintProperty.bind(map);
    let paintReads = 0;
    map.getPaintProperty = (...args) => {
      paintReads += 1;
      return readPaint(...args);
    };
    hooks.setTime(175);
    runtime.updateEffectivePaint("glow", "glow", "fill-opacity", 0.2, { tweenMs: GLOW_MS });
    expect(paintReads).toBe(0);
    map.getPaintProperty = readPaint;
    hooks.flushFrame();
    const sample = mixOpacityExpression(1, 0.08, 175 / GLOW_MS);
    expect(paintOf(map, "glow", "fill-opacity")).toBeCloseTo(sample);
    expect(paintOf(map, "glow", "fill-opacity")).not.toBeCloseTo(0.77);

    hooks.setTime(175 + GLOW_MS);
    hooks.flushFrame();
    expect(paintOf(map, "glow", "fill-opacity")).toBe(0.2);

    const caseGoal = ["case", ["==", ["get", "name"], "א"], 0.4, 0.08];
    hooks.setTime(600);
    runtime.updateEffectivePaint("glow", "glow", "fill-opacity", caseGoal, { tweenMs: GLOW_MS });
    hooks.setTime(600 + GLOW_MS);
    hooks.flushFrame();
    expect(paintOf(map, "glow", "fill-opacity")).toEqual(caseGoal);
    expect(hooks.pendingFrame).toBeNull();
  });

  it("samples factor and effective clocks together until both settle", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    runtime.setDesiredIds(["glow"], { durationMs: LAYER_FADE_MS });
    stage(runtime, map, "glow", layerDef("glow", { "fill-opacity": 1 }));
    runtime.markMemberReady("glow");
    runtime.commitBatch();
    runtime.updateEffectivePaint("glow", "glow", "fill-opacity", 0.08, { tweenMs: GLOW_MS });

    hooks.setTime(200);
    hooks.flushFrame();
    expect(paintOf(map, "glow", "fill-opacity")).toBeCloseTo(
      scaleOpacityExpression(mixOpacityExpression(1, 0.08, 0.5), 200 / LAYER_FADE_MS),
    );

    hooks.setTime(300);
    runtime.updateEffectivePaint("glow", "glow", "fill-opacity", 0.5, { tweenMs: GLOW_MS });
    hooks.setTime(LAYER_FADE_MS);
    hooks.flushFrame();
    const retargetFrom = mixOpacityExpression(1, 0.08, 300 / GLOW_MS);
    expect(paintOf(map, "glow", "fill-opacity")).toBeCloseTo(mixOpacityExpression(retargetFrom, 0.5, 0.75));
    expect(hooks.pendingFrame).toBeTruthy();
    hooks.setTime(300 + GLOW_MS);
    hooks.flushFrame();
    expect(paintOf(map, "glow", "fill-opacity")).toBe(0.5);
    expect(hooks.pendingFrame).toBeNull();
  });

  it("does not settle effective motion for a positive batch whose factor is unchanged", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    reveal(runtime, map, "glow", layerDef("glow", { "fill-opacity": 1 }));
    runtime.updateEffectivePaint("glow", "glow", "fill-opacity", 0.08, { tweenMs: GLOW_MS });
    hooks.setTime(100);
    hooks.flushFrame();
    expect(paintOf(map, "glow", "fill-opacity")).toBeCloseTo(0.77);

    runtime.setDesiredIds(["glow"], { durationMs: LAYER_FADE_MS });
    runtime.commitBatch();
    expect(paintOf(map, "glow", "fill-opacity")).toBeCloseTo(0.77);
    hooks.setTime(GLOW_MS);
    hooks.flushFrame();
    expect(paintOf(map, "glow", "fill-opacity")).toBe(0.08);
  });

  it("settles factor and effective motion on a same-set duration-0 apply", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    runtime.setDesiredIds(["glow"], { durationMs: LAYER_FADE_MS });
    stage(runtime, map, "glow", layerDef("glow", { "fill-opacity": 1 }));
    runtime.markMemberReady("glow");
    runtime.commitBatch();
    runtime.updateEffectivePaint("glow", "glow", "fill-opacity", 0.08, { tweenMs: GLOW_MS });
    hooks.setTime(100);
    hooks.flushFrame();

    runtime.setDesiredIds(["glow"], { durationMs: 0, sameSet: true });
    expect(paintOf(map, "glow", "fill-opacity")).toBe(0.08);
    expect(hooks.pendingFrame).toBeNull();
  });

  it("settles an in-progress factor to its target on a same-set duration-0 apply", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    runtime.setDesiredIds(["shown"], { durationMs: LAYER_FADE_MS });
    stage(runtime, map, "shown", layerDef("shown", { "fill-opacity": 1 }));
    runtime.markMemberReady("shown");
    runtime.commitBatch();
    hooks.setTime(300);
    hooks.flushFrame();
    expect(paintOf(map, "shown", "fill-opacity")).toBeCloseTo(0.5);

    runtime.setDesiredIds(["shown"], { durationMs: 0, sameSet: true });
    expect(paintOf(map, "shown", "fill-opacity")).toBe(1);
    expect(hooks.pendingFrame).toBeNull();
  });

  it("snaps a reversed incoming trajectory and zeroes the pending batch on a same-set duration-0 apply", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    const torn = [];
    runtime.setDesiredIds(["a"], { durationMs: 600 });
    stage(runtime, map, "a", layerDef("a", { "fill-opacity": 1 }), {
      onTeardown: () => torn.push("a"),
    });
    runtime.markMemberReady("a");
    runtime.commitBatch();
    hooks.setTime(300);
    hooks.flushFrame();
    expect(paintOf(map, "a", "fill-opacity")).toBeCloseTo(0.5);

    runtime.setDesiredIds(["b"], { durationMs: 600 });
    const pending = runtime.getPendingBatch();
    expect(pending.durationMs).toBe(600);

    runtime.setDesiredIds(["b"], { durationMs: 0, sameSet: true });
    expect(paintOf(map, "a", "fill-opacity")).toBe(0);
    expect(torn).toEqual(["a"]);
    expect(runtime.getPendingBatch()).toBe(pending);
    expect(pending.durationMs).toBe(0);
    expect(hooks.pendingFrame).toBeNull();

    stage(runtime, map, "b", layerDef("b", { "fill-opacity": 1 }));
    runtime.markMemberReady("b");
    runtime.commitBatch();
    expect(paintOf(map, "b", "fill-opacity")).toBe(1);
    expect(hooks.pendingFrame).toBeNull();
  });

  it("preserves a running tween when the same goal is published at full motion", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    reveal(runtime, map, "glow", layerDef("glow", { "fill-opacity": 1 }));
    runtime.updateEffectivePaint("glow", "glow", "fill-opacity", 0.08, { tweenMs: GLOW_MS });
    hooks.setTime(100);
    hooks.flushFrame();
    expect(runtime.updateEffectivePaint("glow", "glow", "fill-opacity", 0.08, { tweenMs: 0 })).toBe(true);
    expect(paintOf(map, "glow", "fill-opacity")).toBeCloseTo(0.77);
    hooks.setTime(GLOW_MS);
    hooks.flushFrame();
    expect(paintOf(map, "glow", "fill-opacity")).toBe(0.08);
  });

  it("settles an equal-goal publication when reduced motion is preferred", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    reveal(runtime, map, "glow", layerDef("glow", { "fill-opacity": 1 }));
    const goal = ["case", ["==", ["get", "name"], "א"], 0.4, 0.08];
    runtime.updateEffectivePaint("glow", "glow", "fill-opacity", goal, { tweenMs: GLOW_MS });
    hooks.setTime(100);
    hooks.flushFrame();
    expect(paintOf(map, "glow", "fill-opacity")).not.toEqual(goal);

    vi.stubGlobal("window", {
      matchMedia: (query) => ({ matches: query === "(prefers-reduced-motion: reduce)" }),
    });
    const equalGoal = ["case", ["==", ["get", "name"], "א"], 0.4, 0.08];
    expect(runtime.updateEffectivePaint("glow", "glow", "fill-opacity", equalGoal, { tweenMs: GLOW_MS })).toBe(true);
    expect(paintOf(map, "glow", "fill-opacity")).toEqual(goal);
    expect(hooks.pendingFrame).toBeNull();
  });

  it("does not paint after exit teardown, invalidation, drop, or same-id replacement", () => {
    const map = createMap();
    const hooks = createHooks();
    const writes = countWrites(map, hooks);
    const runtime = getLayerLifecycleRuntime(map, hooks);
    reveal(runtime, map, "glow", layerDef("glow", { "fill-opacity": 1 }));
    writes.length = 0;
    hooks.setTime(0);
    runtime.setDesiredIds([], { durationMs: LAYER_FADE_MS });
    runtime.commitBatch();
    hooks.setTime(500);
    hooks.flushFrame();
    runtime.updateEffectivePaint("glow", "glow", "fill-opacity", 0.08, { tweenMs: GLOW_MS });
    hooks.setTime(LAYER_FADE_MS);
    hooks.flushFrame();
    expect(hooks.pendingFrame).toBeNull();
    expect(paintOf(map, "glow", "fill-opacity")).toBe(0);
    const afterExit = writes.length;
    const framesAfterExit = hooks.frameRequests;
    hooks.setTime(1200);
    hooks.flushFrame();
    expect(writes.length).toBe(afterExit);
    expect(hooks.frameRequests).toBe(framesAfterExit);

    reveal(runtime, map, "invalid", layerDef("invalid", { "fill-opacity": 1 }));
    runtime.updateEffectivePaint("invalid", "invalid", "fill-opacity", 0.08, { tweenMs: GLOW_MS });
    hooks.setTime(1400);
    hooks.flushFrame();
    const invalidPaint = paintOf(map, "invalid", "fill-opacity");
    runtime.invalidateMember("invalid");
    expect(runtime.updateEffectivePaint("invalid", "invalid", "fill-opacity", 0.2)).toBe(false);
    expect(hooks.pendingFrame).toBeNull();
    const invalidFrames = hooks.frameRequests;
    hooks.setTime(2000);
    hooks.flushFrame();
    expect(paintOf(map, "invalid", "fill-opacity")).toBe(invalidPaint);
    expect(hooks.frameRequests).toBe(invalidFrames);

    reveal(runtime, map, "edited", layerDef("edited-old", { "fill-opacity": 1 }));
    runtime.updateEffectivePaint("edited", "edited-old", "fill-opacity", 0.08, { tweenMs: GLOW_MS });
    hooks.setTime(2100);
    hooks.flushFrame();
    const droppedPaint = paintOf(map, "edited-old", "fill-opacity");
    runtime.dropChannels("edited");
    expect(hooks.pendingFrame).toBeNull();
    stage(runtime, map, "edited", layerDef("edited-new", { "fill-opacity": 1 }));
    hooks.setTime(2600);
    hooks.flushFrame();
    expect(paintOf(map, "edited-old", "fill-opacity")).toBe(droppedPaint);
    expect(paintOf(map, "edited-new", "fill-opacity")).toBe(1);

    reveal(runtime, map, "replaced", layerDef("replaced", { "fill-opacity": 1 }));
    runtime.updateEffectivePaint("replaced", "replaced", "fill-opacity", 0.08, { tweenMs: GLOW_MS });
    hooks.setTime(2700);
    hooks.flushFrame();
    stage(runtime, map, "replaced", layerDef("replaced", { "fill-opacity": 1 }));
    expect(paintOf(map, "replaced", "fill-opacity")).toBe(1);
    expect(hooks.pendingFrame).toBeNull();
    const replacedFrames = hooks.frameRequests;
    hooks.setTime(3200);
    hooks.flushFrame();
    expect(paintOf(map, "replaced", "fill-opacity")).toBe(1);
    expect(hooks.frameRequests).toBe(replacedFrames);
  });

  it("settles mounted goals on dispose and discards invalidated channels instead", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    runtime.setDesiredIds(["glow", "stale"], { durationMs: 0 });
    stage(runtime, map, "glow", layerDef("glow", { "fill-opacity": 1 }));
    stage(runtime, map, "stale", layerDef("stale", { "fill-opacity": 1 }));
    runtime.markMemberReady("glow");
    runtime.markMemberReady("stale");
    runtime.commitBatch();
    runtime.updateEffectivePaint("glow", "glow", "fill-opacity", 0.08, { tweenMs: GLOW_MS });
    runtime.updateEffectivePaint("stale", "stale", "fill-opacity", 0.08, { tweenMs: GLOW_MS });
    hooks.setTime(200);
    hooks.flushFrame();
    expect(paintOf(map, "glow", "fill-opacity")).toBeCloseTo(0.54);
    runtime.invalidateMember("stale");
    const stalePaint = paintOf(map, "stale", "fill-opacity");
    runtime.dispose();
    expect(paintOf(map, "glow", "fill-opacity")).toBe(0.08);
    expect(paintOf(map, "stale", "fill-opacity")).toBe(stalePaint);
    expect(hooks.pendingFrame).toBeNull();
  });

  it("discards a mid-tween on map removal without writing the settled goal", () => {
    const map = withRemoveEvents(createMap());
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    reveal(runtime, map, "glow", layerDef("glow", { "fill-opacity": 1 }));
    runtime.updateEffectivePaint("glow", "glow", "fill-opacity", 0.08, { tweenMs: GLOW_MS });
    hooks.setTime(200);
    hooks.flushFrame();
    expect(paintOf(map, "glow", "fill-opacity")).toBeCloseTo(0.54);
    map.remove();
    expect(paintOf(map, "glow", "fill-opacity")).toBeCloseTo(0.54);
    hooks.setTime(GLOW_MS);
    hooks.flushFrame();
    expect(paintOf(map, "glow", "fill-opacity")).toBeCloseTo(0.54);
    expect(hooks.pendingFrame).toBeNull();
  });

  it("discards a mid-tween without writing the settled goal", () => {
    const map = createMap();
    const hooks = createHooks();
    const runtime = getLayerLifecycleRuntime(map, hooks);
    reveal(runtime, map, "glow", layerDef("glow", { "fill-opacity": 1 }));
    runtime.updateEffectivePaint("glow", "glow", "fill-opacity", 0.08, { tweenMs: GLOW_MS });
    hooks.setTime(200);
    hooks.flushFrame();
    expect(paintOf(map, "glow", "fill-opacity")).toBeCloseTo(0.54);
    runtime.discard();
    expect(paintOf(map, "glow", "fill-opacity")).toBeCloseTo(0.54);
    hooks.setTime(GLOW_MS);
    hooks.flushFrame();
    expect(paintOf(map, "glow", "fill-opacity")).toBeCloseTo(0.54);
    expect(hooks.pendingFrame).toBeNull();
  });

  it("replays remembered channels before addLayer and keeps the listener across runtime recreation", () => {
    const map = withRemoveEvents(createMap());
    const hooks = createHooks();
    const calls = [];
    setPaintChannelsRememberedListener(map, (event) => {
      calls.push({
        fullId: event.fullId,
        channels: event.channels.map((channel) => ({ ...channel })),
        mounted: Boolean(map.getLayer(event.channels[0]?.layerId)),
      });
      getLayerLifecycleRuntime(map).updateEffectivePaint(
        event.fullId,
        event.channels[0].layerId,
        event.channels[0].property,
        0.08,
        { tweenMs: 0 },
      );
    });

    const runtime = getLayerLifecycleRuntime(map, hooks);
    runtime.setDesiredIds(["settlement"], { durationMs: LAYER_FADE_MS });
    const staged = runtime.stageMapLayer("settlement", layerDef("names", {
      "fill-opacity": 1,
      "fill-opacity-transition": { duration: 350, delay: 20 },
    }));
    expect(calls).toEqual([{
      fullId: "settlement",
      channels: [{ layerId: "names", property: "fill-opacity", type: "fill" }],
      mounted: false,
    }]);
    expect(map.getLayer("names")).toBeNull();
    map.addLayer(staged.stagedLayerDef);
    runtime.markMemberReady("settlement");
    runtime.commitBatch();
    hooks.setTime(300);
    hooks.flushFrame();
    expect(paintOf(map, "names", "fill-opacity")).toBeCloseTo(0.04);

    runtime.dispose();
    const recreated = getLayerLifecycleRuntime(map);
    recreated.setDesiredIds(["settlement"], { durationMs: 0 });
    const restaged = recreated.stageMapLayer("settlement", layerDef("names", {
      "fill-opacity": 1,
      "fill-opacity-transition": { duration: 350, delay: 20 },
    }));
    expect(calls).toHaveLength(2);
    expect(restaged.stagedLayerDef.paint["fill-opacity"]).toBe(0);
    map.addLayer(restaged.stagedLayerDef);
    recreated.markMemberReady("settlement");
    recreated.commitBatch();
    expect(paintOf(map, "names", "fill-opacity")).toBe(0.08);
    expect(paintOf(map, "names", "fill-opacity-transition")).toEqual({ duration: 0, delay: 0 });

    const base = paintOf(map, "names", "fill-opacity");
    expect(base).toBe(0.08);
    const startedAt = hooks.now();
    const running = getLayerLifecycleRuntime(map, hooks);
    running.updateEffectivePaint("settlement", "names", "fill-opacity", 0.2, { tweenMs: GLOW_MS });
    hooks.setTime(400);
    hooks.flushFrame();
    const during = paintOf(map, "names", "fill-opacity");
    expect(during).toBeCloseTo(mixOpacityExpression(base, 0.2, (400 - startedAt) / GLOW_MS));
    expect(during).not.toBe(0.2);
    map.remove();
    expect(paintOf(map, "names", "fill-opacity")).toBe(during);
    expect(hooks.pendingFrame).toBeNull();
    const afterRemoval = getLayerLifecycleRuntime(map, hooks);
    afterRemoval.setDesiredIds(["settlement"], { durationMs: 0 });
    afterRemoval.stageMapLayer("settlement", layerDef("names-2", { "fill-opacity": 1 }));
    expect(calls).toHaveLength(2);
  });
});
