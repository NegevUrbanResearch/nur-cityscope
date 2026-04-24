import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyContextFlowAnimationsToMap,
  collectLineLayerIdsForFullLayer,
  hashLayerIdToPhaseOffset,
  resolveSpeedForFullLayer,
  startFlowAnimation,
  stopAllFlowAnimations,
  stopFlowAnimation,
} from "../../frontend/src/shared/maplibre-flow-animation.js";

describe("maplibre-flow-animation", () => {
  beforeEach(() => {
    let id = 0;
    const queue = [];
    vi.stubGlobal("requestAnimationFrame", (cb) => {
      queue.push(cb);
      return ++id;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      queue.length = 0;
    });
    /** Drain rAF queue for a few frames (each tick may re-enqueue). */
    globalThis.__flushFlowAnimationFrame = (frameCount = 4, tStart = 100) => {
      let t = tStart;
      for (let i = 0; i < frameCount && queue.length > 0; i++) {
        const batch = queue.splice(0, queue.length);
        for (const cb of batch) {
          cb(t);
          t += 16;
        }
      }
    };
  });

  afterEach(() => {
    stopAllFlowAnimations();
    delete globalThis.__flushFlowAnimationFrame;
    vi.unstubAllGlobals();
  });

  function createMap(layerIds, initialDash = undefined) {
    const set = new Set(layerIds);
    return {
      getLayer: vi.fn((id) => (set.has(id) ? { id } : undefined)),
      getPaintProperty: vi.fn((id, prop) => {
        if (!set.has(id) || prop !== "line-dasharray") return undefined;
        return initialDash;
      }),
      setPaintProperty: vi.fn(),
    };
  }

  it("startFlowAnimation schedules updates via requestAnimationFrame", () => {
    const map = createMap(["trail"]);
    startFlowAnimation(map, "trail", { speed: 1 });
    globalThis.__flushFlowAnimationFrame();
    expect(map.setPaintProperty).toHaveBeenCalled();
    const [layerId, prop, value] = map.setPaintProperty.mock.calls.at(-1);
    expect(layerId).toBe("trail");
    expect(prop).toBe("line-dasharray");
    expect(Array.isArray(value)).toBe(true);
    expect(value).toHaveLength(4);
  });

  it("stopFlowAnimation stops paint updates for that layer", () => {
    const map = createMap(["a"]);
    startFlowAnimation(map, "a");
    stopFlowAnimation("a");
    const n = map.setPaintProperty.mock.calls.length;
    globalThis.__flushFlowAnimationFrame();
    expect(map.setPaintProperty.mock.calls.length).toBe(n);
  });

  it("stopAllFlowAnimations cancels the loop", () => {
    const map = createMap(["x"]);
    startFlowAnimation(map, "x");
    globalThis.__flushFlowAnimationFrame();
    stopAllFlowAnimations();
    expect(map.setPaintProperty.mock.calls.at(-1)).toEqual([
      "x",
      "line-dasharray",
      null,
    ]);
    const n = map.setPaintProperty.mock.calls.length;
    globalThis.__flushFlowAnimationFrame(10);
    expect(map.setPaintProperty.mock.calls.length).toBe(n);
  });

  it("removes layer entry when getLayer returns undefined", () => {
    const map = createMap(["gone"]);
    startFlowAnimation(map, "gone");
    map.getLayer.mockImplementation(() => undefined);
    globalThis.__flushFlowAnimationFrame();
    stopFlowAnimation("gone");
    expect(() => stopFlowAnimation("gone")).not.toThrow();
  });

  it("removes layer entry when setPaintProperty throws", () => {
    const map = createMap(["bad"]);
    map.setPaintProperty.mockImplementation(() => {
      throw new Error("invalid");
    });
    startFlowAnimation(map, "bad");
    globalThis.__flushFlowAnimationFrame();
    stopAllFlowAnimations();
  });

  it("restores baseline dash style on stopFlowAnimation", () => {
    const baseline = [6, 2];
    const map = createMap(["road"], baseline);
    startFlowAnimation(map, "road");
    globalThis.__flushFlowAnimationFrame();

    stopFlowAnimation("road");

    const roadDash = map.setPaintProperty.mock.calls.filter(
      ([id, prop]) => id === "road" && prop === "line-dasharray",
    );
    expect(roadDash.at(-1)[2]).toEqual([6, 2]);
    expect(roadDash.at(-1)[2]).not.toBe(baseline);
  });

  it("restores deep-cloned baseline dash (nested expression arrays)", () => {
    const baseline = ["interpolate", ["linear"], ["zoom"], 0, [2, 2], 10, [4, 4]];
    const map = createMap(["road"], baseline);
    startFlowAnimation(map, "road");
    globalThis.__flushFlowAnimationFrame();
    stopFlowAnimation("road");
    const roadDash = map.setPaintProperty.mock.calls.filter(
      ([id, prop]) => id === "road" && prop === "line-dasharray",
    );
    const restored = roadDash.at(-1)[2];
    expect(restored).toEqual(baseline);
    restored[4].push(99);
    expect(baseline[4]).toEqual([2, 2]);
  });

  it("clears dash override on stopAll when no baseline exists", () => {
    const map = createMap(["road"]);
    startFlowAnimation(map, "road");
    globalThis.__flushFlowAnimationFrame();

    stopAllFlowAnimations();

    expect(map.setPaintProperty).toHaveBeenCalledWith(
      "road",
      "line-dasharray",
      null,
    );
  });

  it("supports same layer id on multiple maps without collisions", () => {
    const mapA = createMap(["shared"], [3, 1]);
    const mapB = createMap(["shared"], [8, 2]);

    startFlowAnimation(mapA, "shared", { speed: 1 });
    startFlowAnimation(mapB, "shared", { speed: 2 });
    globalThis.__flushFlowAnimationFrame();

    const animatedCallsA = mapA.setPaintProperty.mock.calls.filter(
      ([layerId, prop]) => layerId === "shared" && prop === "line-dasharray",
    );
    const animatedCallsB = mapB.setPaintProperty.mock.calls.filter(
      ([layerId, prop]) => layerId === "shared" && prop === "line-dasharray",
    );
    expect(animatedCallsA.length).toBeGreaterThan(0);
    expect(animatedCallsB.length).toBeGreaterThan(0);

    stopFlowAnimation("shared");
    const lastDashA = mapA.setPaintProperty.mock.calls
      .filter(([id, prop]) => id === "shared" && prop === "line-dasharray")
      .at(-1)[2];
    const lastDashB = mapB.setPaintProperty.mock.calls
      .filter(([id, prop]) => id === "shared" && prop === "line-dasharray")
      .at(-1)[2];
    expect(lastDashA).toEqual([3, 1]);
    expect(lastDashB).toEqual([8, 2]);
  });

  it("handles missing layers safely during stop cleanup", () => {
    const map = createMap(["ghost"]);
    startFlowAnimation(map, "ghost");
    map.getLayer.mockReturnValue(undefined);

    expect(() => stopFlowAnimation("ghost")).not.toThrow();
    expect(() => stopAllFlowAnimations()).not.toThrow();
  });

  it("stopFlowAnimation(map, id) only clears animation on that map", () => {
    const mapA = createMap(["shared"], [1, 1]);
    const mapB = createMap(["shared"], [2, 2]);
    startFlowAnimation(mapA, "shared", { speed: 1 });
    startFlowAnimation(mapB, "shared", { speed: 1 });
    stopFlowAnimation(mapA, "shared");
    globalThis.__flushFlowAnimationFrame();
    const lastDashA = mapA.setPaintProperty.mock.calls
      .filter(([id, prop]) => id === "shared" && prop === "line-dasharray")
      .at(-1)[2];
    expect(lastDashA).toEqual([1, 1]);
    expect(mapB.setPaintProperty.mock.calls.length).toBeGreaterThan(0);
    stopAllFlowAnimations(mapB);
    globalThis.__flushFlowAnimationFrame();
    const lastDashB = mapB.setPaintProperty.mock.calls
      .filter(([id, prop]) => id === "shared" && prop === "line-dasharray")
      .at(-1)[2];
    expect(lastDashB).toEqual([2, 2]);
  });

  it("stopAllFlowAnimations(map) clears only the given map", () => {
    const mapA = createMap(["a"]);
    const mapB = createMap(["b"]);
    startFlowAnimation(mapA, "a");
    startFlowAnimation(mapB, "b");
    stopAllFlowAnimations(mapA);
    globalThis.__flushFlowAnimationFrame();
    const nB = mapB.setPaintProperty.mock.calls.length;
    expect(nB).toBeGreaterThan(0);
    stopAllFlowAnimations(mapB);
  });

  it("collectLineLayerIdsForFullLayer matches registry slug and curated dotted prefixes", () => {
    const layers = [
      { id: "greens__agri__0", type: "line" },
      { id: "greens__agri__line__0", type: "line" },
      { id: "greens__agri__1", type: "fill" },
      { id: "curated.42__solidLine__0", type: "line" },
    ];
    const map = {
      getStyle: () => ({ layers }),
    };
    expect(collectLineLayerIdsForFullLayer(map, "greens.agri").sort()).toEqual(
      ["greens__agri__0", "greens__agri__line__0"].sort(),
    );
    expect(collectLineLayerIdsForFullLayer(map, "curated.42")).toEqual([
      "curated.42__solidLine__0",
    ]);
  });

  it("applyContextFlowAnimationsToMap starts and stops flow for all line layers of a fullLayerId", () => {
    const lineIds = ["greens__agri__0", "greens__agri__line__1"];
    const layers = [
      ...lineIds.map((id) => ({ id, type: "line" })),
      { id: "greens__agri__2", type: "fill" },
    ];
    const set = new Set(lineIds);
    const map = {
      getStyle: () => ({ layers }),
      getLayer: vi.fn((id) => (set.has(id) ? { id } : undefined)),
      getPaintProperty: vi.fn(() => [4, 4]),
      setPaintProperty: vi.fn(),
    };
    applyContextFlowAnimationsToMap(map, { "greens.agri": true });
    globalThis.__flushFlowAnimationFrame();
    const dashCalls = map.setPaintProperty.mock.calls.filter((c) => c[1] === "line-dasharray");
    const animatedIds = [...new Set(dashCalls.map((c) => c[0]))];
    expect(animatedIds.sort()).toEqual(lineIds.sort());

    applyContextFlowAnimationsToMap(map, { "greens.agri": false });
    for (const lid of lineIds) {
      const calls = map.setPaintProperty.mock.calls.filter(
        ([id, prop]) => id === lid && prop === "line-dasharray",
      );
      expect(calls.at(-1)[2]).toEqual([4, 4]);
    }
  });

  it("applyContextFlowAnimationsToMap stops and restores when animation key is removed or state is empty", () => {
    const lineIds = ["greens__agri__0", "greens__agri__line__1"];
    const layers = lineIds.map((id) => ({ id, type: "line" }));
    const set = new Set(lineIds);
    const baseline = [4, 4];
    const map = {
      getStyle: () => ({ layers }),
      getLayer: vi.fn((id) => (set.has(id) ? { id } : undefined)),
      getPaintProperty: vi.fn(() => baseline),
      setPaintProperty: vi.fn(),
    };

    applyContextFlowAnimationsToMap(map, { "greens.agri": true });
    globalThis.__flushFlowAnimationFrame();
    const nDuring = map.setPaintProperty.mock.calls.length;
    expect(nDuring).toBeGreaterThan(0);

    applyContextFlowAnimationsToMap(map, {});
    for (const lid of lineIds) {
      const calls = map.setPaintProperty.mock.calls.filter(
        ([id, prop]) => id === lid && prop === "line-dasharray",
      );
      expect(calls.at(-1)[2]).toEqual(baseline);
      expect(calls.at(-1)[2]).not.toBe(baseline);
    }

    const nAfterStop = map.setPaintProperty.mock.calls.length;
    globalThis.__flushFlowAnimationFrame(10);
    expect(map.setPaintProperty.mock.calls.length).toBe(nAfterStop);
  });

  describe("resolveSpeedForFullLayer", () => {
    afterEach(() => {
      delete globalThis.MapProjectionConfig;
    });

    it("returns 1 when no override is configured", () => {
      delete globalThis.MapProjectionConfig;
      expect(resolveSpeedForFullLayer("greens.agri")).toBe(1);
    });

    it("uses positive finite LAYER_OVERRIDES SPEED scaled by 1/10", () => {
      globalThis.MapProjectionConfig = {
        PROJECTION_LAYER_ANIMATIONS: {
          LAYER_OVERRIDES: {
            "greens.agri": { SPEED: 25 },
          },
        },
      };
      expect(resolveSpeedForFullLayer("greens.agri")).toBe(2.5);
    });

    it("falls back to 1 for non-positive or non-finite SPEED", () => {
      globalThis.MapProjectionConfig = {
        PROJECTION_LAYER_ANIMATIONS: {
          LAYER_OVERRIDES: {
            zero: { SPEED: 0 },
            neg: { SPEED: -3 },
            nan: { SPEED: NaN },
          },
        },
      };
      expect(resolveSpeedForFullLayer("zero")).toBe(1);
      expect(resolveSpeedForFullLayer("neg")).toBe(1);
      expect(resolveSpeedForFullLayer("nan")).toBe(1);
    });
  });

  describe("hashLayerIdToPhaseOffset", () => {
    it("returns the same offset for the same layer id", () => {
      const id = "greens__agri__line__0";
      expect(hashLayerIdToPhaseOffset(id)).toBe(hashLayerIdToPhaseOffset(id));
    });

    it("maps any string id into [0, 8)", () => {
      for (const id of ["a", "greens__agri__0", "curated.42__x__1", ""]) {
        const o = hashLayerIdToPhaseOffset(id);
        expect(o).toBeGreaterThanOrEqual(0);
        expect(o).toBeLessThan(8);
      }
    });

    it("differs for two related line suffixes (observable de-sync)", () => {
      expect(hashLayerIdToPhaseOffset("greens__agri__0")).not.toBe(
        hashLayerIdToPhaseOffset("greens__agri__1"),
      );
    });
  });
});
