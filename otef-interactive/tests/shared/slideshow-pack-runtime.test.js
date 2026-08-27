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

import {
  INVESTIGATION_ALARMS_FULL_ID,
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
} from "../../frontend/src/shared/maplibre-investigation-timeline.js";
import MapProjectionConfig from "../../frontend/src/shared/map-projection-config.js";
import {
  buildSlideshowIncomingGroups,
  createSlideshowPackRuntime,
  resolvePresentationOverlayVisibility,
  suppressInvestigationPlayback,
} from "../../frontend/src/shared/slideshow-pack-runtime.js";

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

function makeCuratedAndRegularPacks() {
  return [
    { id: "curated_axis", layers: [{ id: "route", enabled: true }] },
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
      config: {
        ...baseConfig(),
        packOrder: ["curated_axis", "pack_b"],
        excludedPresentationPackIds: [],
      },
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
    expect(fadeOutAndRemoveEnabledFullIds).toHaveBeenCalledWith(
      map,
      ["pack_b.b"],
      80,
      expect.objectContaining({
        applyProjectionHatchPresentation: true,
        lifecycle: { retainDisabled: true, maxRetainedSources: 2 },
      }),
    );
    const fadeOrder = fadeOutAndRemoveEnabledFullIds.mock.invocationCallOrder[0];
    const secondApplyOrder = applyProjectionRefresh.mock.invocationCallOrder[1];
    expect(fadeOrder).toBeLessThan(secondApplyOrder);

    await runtime.stop();
  });

  it("refreshes curated slideshow layers while staged, then reveals", async () => {
    vi.useFakeTimers();
    const applyProjectionRefresh = vi.fn(() => Promise.resolve());
    const sync = vi.fn();
    const groups = makeCuratedAndRegularPacks();
    const runtime = createSlideshowPackRuntime({
      config: {
        ...baseConfig(),
        packOrder: ["curated_axis", "pack_b"],
        excludedPresentationPackIds: [],
      },
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
      expect.objectContaining({
        fromSlideshowTick: true,
        affectedCuratedFullLayerIds: ["curated_axis.route"],
        groupsOverride: expect.any(Array),
        layerStyleOptions: expect.objectContaining({
          applyProjectionHatchPresentation: true,
          lifecycle: { retainDisabled: true, maxRetainedSources: 2 },
        }),
      }),
    );
    expect(enabledPackId(call.groupsOverride)).toBe("curated_axis");
    expect(beginSlideshowStage).toHaveBeenCalled();
    expect(commitSlideshowReveal).toHaveBeenCalled();
    expect(applyProjectionRefresh.mock.invocationCallOrder[0]).toBeLessThan(
      commitSlideshowReveal.mock.invocationCallOrder[0],
    );
    expect(sync).not.toHaveBeenCalled();
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

  function settlementEnabled(groups, layerId) {
    const pack = (groups || []).find((g) => g?.id === "projector_base");
    const layer = (pack?.layers || []).find((l) => l?.id === layerId);
    return !!layer?.enabled;
  }

  function makePacksWithSettlementNames() {
    return [
      { id: "pack_a", layers: [{ id: "a", enabled: true }] },
      { id: "pack_b", layers: [{ id: "b", enabled: true }] },
      {
        id: "projector_base",
        layers: [
          { id: "שמות_יישובים", enabled: false },
          { id: "Locations_Lines", enabled: false },
          { id: "ישובים", enabled: false },
          { id: "model_base", enabled: true },
        ],
      },
    ];
  }

  it("keeps settlement name layers on across packs when keepSettlementNames is true", async () => {
    vi.useFakeTimers();
    const sync = vi.fn();
    const runtime = createSlideshowPackRuntime({
      config: {
        ...baseConfig(),
        excludedPresentationPackIds: ["projector_base"],
        keepSettlementNames: true,
      },
      getEffectiveLayerGroups: () => makePacksWithSettlementNames(),
      syncProjectionLayers: sync,
      map: null,
    });
    runtime.start({ keepSettlementNames: true });
    await flushStart(runtime);
    expect(enabledPackId(sync.mock.calls[0][1])).toBe("pack_b");
    expect(settlementEnabled(sync.mock.calls[0][1], "שמות_יישובים")).toBe(true);
    expect(settlementEnabled(sync.mock.calls[0][1], "Locations_Lines")).toBe(true);
    expect(settlementEnabled(sync.mock.calls[0][1], "ישובים")).toBe(true);
    expect(settlementEnabled(sync.mock.calls[0][1], "model_base")).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();
    expect(enabledPackId(sync.mock.calls[1][1])).toBe("pack_a");
    expect(settlementEnabled(sync.mock.calls[1][1], "שמות_יישובים")).toBe(true);
    expect(settlementEnabled(sync.mock.calls[1][1], "Locations_Lines")).toBe(true);
    expect(settlementEnabled(sync.mock.calls[1][1], "ישובים")).toBe(true);
    expect(settlementEnabled(sync.mock.calls[1][1], "model_base")).toBe(false);
    await runtime.stop();
  });

  it("leaves settlement names off when keepSettlementNames is false", async () => {
    vi.useFakeTimers();
    const sync = vi.fn();
    const runtime = createSlideshowPackRuntime({
      config: {
        ...baseConfig(),
        excludedPresentationPackIds: ["projector_base"],
        keepSettlementNames: false,
      },
      getEffectiveLayerGroups: () => makePacksWithSettlementNames(),
      syncProjectionLayers: sync,
      map: null,
    });
    runtime.start({ keepSettlementNames: false });
    await flushStart(runtime);
    expect(settlementEnabled(sync.mock.calls[0][1], "שמות_יישובים")).toBe(false);
    expect(settlementEnabled(sync.mock.calls[0][1], "Locations_Lines")).toBe(false);
    expect(settlementEnabled(sync.mock.calls[0][1], "ישובים")).toBe(false);
    expect(settlementEnabled(sync.mock.calls[0][1], "model_base")).toBe(false);
    await runtime.stop();
  });

  it("updates settlement names on a live start without restarting the cycle", async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const sync = vi.fn();
    const runtime = createSlideshowPackRuntime({
      config: {
        ...baseConfig(),
        excludedPresentationPackIds: ["projector_base"],
        keepSettlementNames: false,
      },
      getEffectiveLayerGroups: () => makePacksWithSettlementNames(),
      syncProjectionLayers: sync,
      map: null,
    });
    runtime.start({ keepSettlementNames: false });
    await flushStart(runtime);
    expect(settlementEnabled(sync.mock.calls[0][1], "שמות_יישובים")).toBe(false);
    const callsAfterFirstTick = sync.mock.calls.length;
    runtime.start({ keepSettlementNames: true });
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(sync.mock.calls.length).toBeGreaterThan(callsAfterFirstTick);
    const lastGroups = sync.mock.calls[sync.mock.calls.length - 1][1];
    expect(settlementEnabled(lastGroups, "שמות_יישובים")).toBe(true);
    expect(settlementEnabled(lastGroups, "Locations_Lines")).toBe(true);
    expect(settlementEnabled(lastGroups, "ישובים")).toBe(true);
    expect(settlementEnabled(lastGroups, "model_base")).toBe(false);
    await runtime.stop();
    setIntervalSpy.mockRestore();
  });
});

const NLI_LAYERS = [
  { id: "investigation_polygons", enabled: true },
  { id: "lines", enabled: true },
  { id: "alarms", enabled: true },
  { id: "people", enabled: true },
  { id: "people_names", enabled: true },
];

function makeLiveGroupsWithNliOn() {
  return [
    { id: "pack_a", layers: [{ id: "a", enabled: true }] },
    { id: "pack_b", layers: [{ id: "b", enabled: true }] },
    { id: "gaza", layers: [{ id: "g1", enabled: true }] },
    { id: "nli", layers: NLI_LAYERS.map((layer) => ({ ...layer })) },
  ];
}

function packLayerEnabled(groups, packId, layerId) {
  const pack = (groups || []).find((g) => g?.id === packId);
  const layer = (pack?.layers || []).find((l) => l?.id === layerId);
  return !!layer?.enabled;
}

function expectNliFullyOff(groups) {
  const pack = (groups || []).find((g) => g?.id === "nli");
  expect(pack, "nli group should be present so overlays can read disabled flags").toBeTruthy();
  for (const layer of pack.layers || []) {
    expect(layer?.enabled, `nli.${layer?.id}`).toBe(false);
  }
}

describe("slideshow incoming groups vs live NLI", () => {
  it("forces live-enabled nli layers off when the current pack is not nli", () => {
    const incoming = buildSlideshowIncomingGroups("pack_b", makeLiveGroupsWithNliOn(), {
      excludedPresentationPackIds: ["gaza", "projector_base", "curated_moresht_axis"],
      keepSettlementNames: true,
    });
    expect(enabledPackId(incoming)).toBe("pack_b");
    expectNliFullyOff(incoming);
    expect(packLayerEnabled(incoming, "gaza", "g1")).toBe(false);
    expect(packLayerEnabled(incoming, "pack_a", "a")).toBe(false);
  });

  it("enables the full nli pack on the nli tick and keeps other packs off", () => {
    const incoming = buildSlideshowIncomingGroups("nli", makeLiveGroupsWithNliOn(), {
      excludedPresentationPackIds: ["gaza", "projector_base", "curated_moresht_axis"],
      keepSettlementNames: true,
    });
    expect(enabledPackId(incoming)).toBe("nli");
    for (const layer of NLI_LAYERS) {
      expect(packLayerEnabled(incoming, "nli", layer.id)).toBe(true);
    }
    expect(packLayerEnabled(incoming, "pack_b", "b")).toBe(false);
    expect(packLayerEnabled(incoming, "gaza", "g1")).toBe(false);
  });

  it("does not use live nli-on groups for overlays while presentation is active", () => {
    const live = makeLiveGroupsWithNliOn();
    const incoming = buildSlideshowIncomingGroups("pack_a", live, {
      excludedPresentationPackIds: ["gaza"],
      keepSettlementNames: true,
    });
    const overlayGroups = resolvePresentationOverlayVisibility({
      presentationActive: true,
      incomingGroups: incoming,
      liveGroups: live,
    });
    expect(overlayGroups).toBe(incoming);
    expectNliFullyOff(overlayGroups);
    expect(packLayerEnabled(live, "nli", "people_names")).toBe(true);
  });

  it("clears nli overlays before the first incoming tick when presentation is starting", () => {
    const live = makeLiveGroupsWithNliOn();
    const overlayGroups = resolvePresentationOverlayVisibility({
      presentationActive: true,
      incomingGroups: null,
      liveGroups: live,
      keepSettlementNames: true,
      excludedPresentationPackIds: ["gaza"],
    });
    expectNliFullyOff(overlayGroups);
    expect(packLayerEnabled(overlayGroups, "pack_a", "a")).toBe(false);
    expect(packLayerEnabled(overlayGroups, "pack_b", "b")).toBe(false);
  });

  it("suppresses investigation timeline playback during presentation (nli final/idle state)", () => {
    const liveAnim = {
      [INVESTIGATION_POLYGONS_FULL_ID]: true,
      [INVESTIGATION_LINES_FULL_ID]: true,
      [INVESTIGATION_ALARMS_FULL_ID]: true,
      "october_7th.חדירה_לישוב_ציר": true,
    };
    expect(suppressInvestigationPlayback(liveAnim, false)).toEqual(liveAnim);
    const presentationAnim = suppressInvestigationPlayback(liveAnim, true);
    expect(presentationAnim[INVESTIGATION_POLYGONS_FULL_ID]).toBe(false);
    expect(presentationAnim[INVESTIGATION_LINES_FULL_ID]).toBe(false);
    expect(presentationAnim[INVESTIGATION_ALARMS_FULL_ID]).toBe(false);
    expect(presentationAnim["october_7th.חדירה_לישוב_ציר"]).toBe(true);
  });
});

describe("slideshow runtime nli rotation", () => {
  it("turns off live-enabled nli on non-nli ticks and shows nli as a later pack", async () => {
    vi.useFakeTimers();
    const sync = vi.fn();
    const groups = makeLiveGroupsWithNliOn();
    const runtime = createSlideshowPackRuntime({
      config: {
        ...baseConfig(),
        packOrder: ["pack_b", "pack_a", "nli"],
        excludedPresentationPackIds: ["gaza", "projector_base", "curated_moresht_axis"],
      },
      getEffectiveLayerGroups: () => groups,
      syncProjectionLayers: sync,
      map: null,
    });
    runtime.start();
    await flushStart(runtime);
    expect(enabledPackId(sync.mock.calls[0][1])).toBe("pack_b");
    expectNliFullyOff(sync.mock.calls[0][1]);
    expectNliFullyOff(runtime.getLastIncomingGroups());
    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();
    expect(enabledPackId(sync.mock.calls[1][1])).toBe("pack_a");
    expectNliFullyOff(sync.mock.calls[1][1]);
    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();
    expect(enabledPackId(sync.mock.calls[2][1])).toBe("nli");
    for (const layer of NLI_LAYERS) {
      expect(packLayerEnabled(sync.mock.calls[2][1], "nli", layer.id)).toBe(true);
    }
    expect(packLayerEnabled(sync.mock.calls[2][1], "pack_b", "b")).toBe(false);
    await runtime.stop();
    expect(runtime.getLastIncomingGroups()).toBeNull();
  });

  it("syncs overlays with nli off before the first pack tick (warmup window)", async () => {
    vi.useFakeTimers();
    const sync = vi.fn();
    const overlays = vi.fn();
    const groups = makeLiveGroupsWithNliOn();
    const runtime = createSlideshowPackRuntime({
      config: {
        ...baseConfig(),
        packOrder: ["pack_b", "nli"],
        excludedPresentationPackIds: ["gaza"],
        warmupLeadMs: 50,
      },
      getEffectiveLayerGroups: () => groups,
      syncProjectionLayers: sync,
      syncPresentationOverlays: overlays,
      map: null,
    });
    runtime.start();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);
    await flushMicrotasks();
    expect(overlays.mock.calls.length).toBeGreaterThan(0);
    expectNliFullyOff(overlays.mock.calls[0][0]);
    await vi.advanceTimersByTimeAsync(50);
    await flushStart(runtime);
    expect(enabledPackId(sync.mock.calls[0][1])).toBe("pack_b");
    expectNliFullyOff(overlays.mock.calls[overlays.mock.calls.length - 1][0]);
    await runtime.stop();
  });
});
