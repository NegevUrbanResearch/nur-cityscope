import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startFlowAnimation,
  stopFlowAnimation,
  stopAllFlowAnimations,
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

  function createMap(layerIds) {
    const set = new Set(layerIds);
    return {
      getLayer: vi.fn((id) => (set.has(id) ? { id } : undefined)),
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
    stopAllFlowAnimations();
    globalThis.__flushFlowAnimationFrame();
    expect(map.setPaintProperty).not.toHaveBeenCalled();
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
});
