import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const layerManagerMock = vi.hoisted(() => ({
  beginSlideshowStage: vi.fn(),
  commitSlideshowReveal: vi.fn(),
  fadeOutAndRemoveEnabledFullIds: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../frontend/src/map/maplibre-layer-manager.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    beginSlideshowStage: layerManagerMock.beginSlideshowStage,
    commitSlideshowReveal: layerManagerMock.commitSlideshowReveal,
    fadeOutAndRemoveEnabledFullIds: layerManagerMock.fadeOutAndRemoveEnabledFullIds,
  };
});

import MapProjectionConfig from "../../frontend/src/shared/map-projection-config.js";
import { createSlideshowPackRuntime } from "../../frontend/src/shared/slideshow-pack-runtime.js";

const { beginSlideshowStage, commitSlideshowReveal, fadeOutAndRemoveEnabledFullIds } =
  layerManagerMock;

function makeStaged() {
  return {
    addedLayerIds: ["lyr-a"],
    targetOpacityByLayerId: { "lyr-a": { "raster-opacity": 1 } },
    stagedFullIds: ["pack_a.layer_a"],
    transitionMs: 0,
  };
}

function enabledPackId(groups) {
  for (const g of groups) {
    if (g?.layers?.some((l) => l?.enabled)) {
      return g.id;
    }
  }
  return null;
}

const DEFAULT_EXCLUDED = MapProjectionConfig.PROJECTION_SLIDESHOW.excludedPresentationPackIds;

function expectExcludedGroupsFullyOff(groups) {
  for (const id of DEFAULT_EXCLUDED) {
    const g = groups.find((x) => x?.id === id);
    if (!g) {
      continue;
    }
    for (const layer of g.layers || []) {
      expect(layer?.enabled, `layer ${id}.${layer?.id}`).toBe(false);
    }
  }
}

function makeTwoPacks() {
  return [
    { id: "pack_a", layers: [{ id: "a", enabled: true }] },
    { id: "pack_b", layers: [{ id: "b", enabled: true }] },
  ];
}

function flushMicrotasks() {
  return new Promise((resolve) => {
    queueMicrotask(resolve);
  });
}

function baseConfig() {
  return {
    intervalMs: 100,
    crossfadeMs: 0,
    warmupLeadMs: 0,
    packOrder: ["pack_b", "pack_a"],
  };
}

async function flushStart(runtime) {
  for (let i = 0; i < 30; i += 1) {
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    if (beginSlideshowStage.mock.calls.length > 0 || !runtime.isActive()) {
      break;
    }
  }
}

beforeEach(() => {
  beginSlideshowStage.mockReturnValue(makeStaged());
  commitSlideshowReveal.mockReset();
  beginSlideshowStage.mockReset();
  beginSlideshowStage.mockReturnValue(makeStaged());
  fadeOutAndRemoveEnabledFullIds.mockReset();
  fadeOutAndRemoveEnabledFullIds.mockImplementation(() => Promise.resolve());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("slideshow pack runtime", () => {
  it("cycles packs in order over interval", async () => {
    vi.useFakeTimers();
    const sync = vi.fn();
    const groups = makeTwoPacks();
    const runtime = createSlideshowPackRuntime({
      config: baseConfig(),
      getEffectiveLayerGroups: () => groups,
      syncProjectionLayers: sync,
      map: null,
    });
    runtime.start();
    await flushStart(runtime);
    expect(sync.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(enabledPackId(sync.mock.calls[0][1])).toBe("pack_b");
    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();
    expect(enabledPackId(sync.mock.calls[1][1])).toBe("pack_a");
    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();
    expect(enabledPackId(sync.mock.calls[2][1])).toBe("pack_b");
    await runtime.stop();
  });

  it("does not overlap beginSlideshowStage; nested depth stays 1", async () => {
    vi.useFakeTimers();
    let depth = 0;
    let maxDepth = 0;
    beginSlideshowStage.mockImplementation(() => {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
      try {
        return makeStaged();
      } finally {
        depth -= 1;
      }
    });
    const sync = vi.fn();
    const getEffective = vi.fn(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(makeTwoPacks()), 5);
        }),
    );
    const runtime = createSlideshowPackRuntime({
      config: baseConfig(),
      getEffectiveLayerGroups: getEffective,
      syncProjectionLayers: sync,
      map: null,
    });
    runtime.start();
    await vi.advanceTimersByTimeAsync(200);
    await flushMicrotasks();
    expect(maxDepth).toBe(1);
    expect(beginSlideshowStage.mock.calls.length).toBeGreaterThan(0);
    await runtime.stop();
  });

  it("stop invalidates session epoch, clears interval, and waits for in-flight work", async () => {
    vi.useFakeTimers();
    const epBefore = { v: 0 };
    const sync = vi.fn();
    const getEffective = vi.fn(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(makeTwoPacks()), 20);
        }),
    );
    const runtime = createSlideshowPackRuntime({
      config: { ...baseConfig(), warmupLeadMs: 0 },
      getEffectiveLayerGroups: getEffective,
      syncProjectionLayers: sync,
      map: null,
    });
    runtime.start();
    await flushMicrotasks();
    epBefore.v = runtime.getSessionEpoch();
    const pStop = runtime.stop();
    expect(runtime.getSessionEpoch()).toBe(epBefore.v + 1);
    expect(runtime.isActive()).toBe(false);
    await pStop;
  });

  it("applies warmupLeadMs once before beginSlideshowStage (not doubled)", async () => {
    vi.useFakeTimers();
    const warmupLeadMs = 400;
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const sync = vi.fn();
    // No `map.once`: waitForMapIdleOrTimeout uses a single lead timeout (see runtime).
    const map = {};
    const runtime = createSlideshowPackRuntime({
      config: { ...baseConfig(), warmupLeadMs, intervalMs: 10_000 },
      getEffectiveLayerGroups: () => makeTwoPacks(),
      syncProjectionLayers: sync,
      map,
    });
    runtime.start();
    for (let i = 0; i < 15; i += 1) {
      await vi.advanceTimersByTimeAsync(0);
      await flushMicrotasks();
    }
    expect(beginSlideshowStage).not.toHaveBeenCalled();

    const leadTimeouts = setTimeoutSpy.mock.calls.filter((c) => c[1] === warmupLeadMs);
    expect(leadTimeouts.length).toBe(1);

    await vi.advanceTimersByTimeAsync(warmupLeadMs - 1);
    await flushMicrotasks();
    expect(beginSlideshowStage).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await flushMicrotasks();
    expect(beginSlideshowStage).toHaveBeenCalledTimes(1);

    await runtime.stop();
    setTimeoutSpy.mockRestore();
  });

  it("clamps intervalMs to at least 1 so setInterval always ticks when active", async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const sync = vi.fn();
    const runtime = createSlideshowPackRuntime({
      config: { ...baseConfig(), intervalMs: 0 },
      getEffectiveLayerGroups: () => makeTwoPacks(),
      syncProjectionLayers: sync,
      map: null,
    });
    runtime.start();
    await flushStart(runtime);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy.mock.calls[0][1]).toBe(1);
    await runtime.stop();
    setIntervalSpy.mockRestore();
  });

  it("shouldSuppressProjectionHighlight is true during start() await while isActive is still false", async () => {
    vi.useFakeTimers();
    /** @type {((v: unknown) => void) | undefined} */
    let resolveGroups;
    const groupsPromise = new Promise((resolve) => {
      resolveGroups = resolve;
    });
    const runtime = createSlideshowPackRuntime({
      config: baseConfig(),
      getEffectiveLayerGroups: () => groupsPromise,
      syncProjectionLayers: vi.fn(),
      map: null,
    });
    runtime.start();
    await flushMicrotasks();
    expect(runtime.isActive()).toBe(false);
    expect(runtime.shouldSuppressProjectionHighlight()).toBe(true);
    resolveGroups?.(makeTwoPacks());
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    await runtime.stop();
  });

  it("calls fadeOutAndRemoveEnabledFullIds before second tick applyProjectionRefresh", async () => {
    vi.useFakeTimers();
    const applyProjectionRefresh = vi.fn(() => Promise.resolve());
    const sync = vi.fn();
    const groups = makeTwoPacks();
    const map = {};
    const runtime = createSlideshowPackRuntime({
      config: { ...baseConfig(), crossfadeMs: 80 },
      getEffectiveLayerGroups: () => groups,
      syncProjectionLayers: sync,
      applyProjectionRefresh,
      map,
    });
    runtime.start();
    await flushStart(runtime);
    expect(fadeOutAndRemoveEnabledFullIds).not.toHaveBeenCalled();
    expect(applyProjectionRefresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();

    expect(fadeOutAndRemoveEnabledFullIds).toHaveBeenCalledTimes(1);
    expect(fadeOutAndRemoveEnabledFullIds).toHaveBeenCalledWith(map, ["pack_b.b"], 80);
    const fadeOrder = fadeOutAndRemoveEnabledFullIds.mock.invocationCallOrder[0];
    const secondApplyOrder = applyProjectionRefresh.mock.invocationCallOrder[1];
    expect(fadeOrder).toBeLessThan(secondApplyOrder);

    await runtime.stop();
  });

  it("passes fromSlideshowTick and groupsOverride to applyProjectionRefresh before beginSlideshowStage", async () => {
    vi.useFakeTimers();
    const applyProjectionRefresh = vi.fn(() => Promise.resolve());
    const sync = vi.fn();
    const groups = makeTwoPacks();
    const runtime = createSlideshowPackRuntime({
      config: baseConfig(),
      getEffectiveLayerGroups: () => groups,
      syncProjectionLayers: sync,
      applyProjectionRefresh,
      map: null,
    });
    runtime.start();
    await flushStart(runtime);
    expect(applyProjectionRefresh).toHaveBeenCalled();
    const call = applyProjectionRefresh.mock.calls[0][0];
    expect(call).toEqual(
      expect.objectContaining({ fromSlideshowTick: true, groupsOverride: expect.any(Array) }),
    );
    expect(enabledPackId(call.groupsOverride)).toBe("pack_b");
    expect(beginSlideshowStage).toHaveBeenCalled();
    expect(applyProjectionRefresh.mock.invocationCallOrder[0]).toBeLessThan(
      beginSlideshowStage.mock.invocationCallOrder[0],
    );
    await runtime.stop();
  });

  it("never enables excluded presentation pack ids across ticks; their layers stay off", async () => {
    vi.useFakeTimers();
    const sync = vi.fn();
    const groups = [
      { id: "gaza", layers: [{ id: "g1", enabled: true }, { id: "g2", enabled: true }] },
      { id: "pack_a", layers: [{ id: "a", enabled: true }] },
      { id: "curated_moresht_axis", layers: [{ id: "m1", enabled: true }] },
      { id: "projector_base", layers: [{ id: "p1", enabled: true }] },
    ];
    const runtime = createSlideshowPackRuntime({
      config: { ...baseConfig(), packOrder: ["gaza", "pack_a", "projector_base"], intervalMs: 100 },
      getEffectiveLayerGroups: () => groups,
      syncProjectionLayers: sync,
      map: null,
    });
    runtime.start();
    await flushStart(runtime);
    for (let i = 0; i < 5; i += 1) {
      if (i > 0) {
        await vi.advanceTimersByTimeAsync(100);
        await flushMicrotasks();
      }
      expect(
        DEFAULT_EXCLUDED.includes(/** @type {string} */ (enabledPackId(sync.mock.calls[i][1]))),
      ).toBe(false);
      expectExcludedGroupsFullyOff(sync.mock.calls[i][1]);
    }
    await runtime.stop();
  });

  it("cycles only non-excluded packs; excluded groups are off on every sync", async () => {
    vi.useFakeTimers();
    const sync = vi.fn();
    const groups = [
      { id: "gaza", layers: [{ id: "g1", enabled: true }] },
      { id: "pack_a", layers: [{ id: "a", enabled: true }] },
      { id: "pack_b", layers: [{ id: "b", enabled: true }] },
    ];
    const runtime = createSlideshowPackRuntime({
      config: baseConfig(),
      getEffectiveLayerGroups: () => groups,
      syncProjectionLayers: sync,
      map: null,
    });
    runtime.start();
    await flushStart(runtime);
    expect(enabledPackId(sync.mock.calls[0][1])).toBe("pack_b");
    expectExcludedGroupsFullyOff(sync.mock.calls[0][1]);
    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();
    expect(enabledPackId(sync.mock.calls[1][1])).toBe("pack_a");
    expectExcludedGroupsFullyOff(sync.mock.calls[1][1]);
    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();
    expect(enabledPackId(sync.mock.calls[2][1])).toBe("pack_b");
    expectExcludedGroupsFullyOff(sync.mock.calls[2][1]);
    await runtime.stop();
  });

  it("double start is idempotent: one interval, one slideshow sequence", async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const sync = vi.fn();
    const runtime = createSlideshowPackRuntime({
      config: baseConfig(),
      getEffectiveLayerGroups: () => makeTwoPacks(),
      syncProjectionLayers: sync,
      map: null,
    });
    runtime.start();
    runtime.start();
    await flushStart(runtime);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();
    expect(sync.mock.calls.length).toBeGreaterThanOrEqual(2);
    await runtime.stop();
    setIntervalSpy.mockRestore();
  });
});
