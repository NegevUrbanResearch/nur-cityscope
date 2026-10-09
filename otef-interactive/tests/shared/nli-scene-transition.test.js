import { afterEach, describe, expect, it, vi } from "vitest";
import { createNliSceneTransition, NLI_SCENE_READY_TIMEOUT_MS } from "../../frontend/src/shared/nli-scene-transition.js";
import { getLayerLifecycleRuntime } from "../../frontend/src/shared/layer-lifecycle-fade.js";

afterEach(() => vi.useRealTimers());
async function flush() { for (let i = 0; i < 15; i += 1) await Promise.resolve(); }

function setup({ prepare: prepareOverride, waitForEntry, failReplacement = false, pendingReplacement = false, restoreThrows = false, discardThrows = false, initialParticipants = ["a"] } = {}) {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  let snapshot = { enabledIds: ["a"], narrativeState: { id: null }, investigationClock: { phase: "idle" } };
  const initial = snapshot;
  const draws = {}, activations = [], discarded = [], restored = [], failures = [];
  let frame;
  const runtime = getLayerLifecycleRuntime({}, {
    now: () => Date.now(), requestFrame: callback => { frame = callback; return 1; },
    cancelFrame: () => { frame = null; },
  });
  runtime.setDesiredIds(initialParticipants, { durationMs: 0 });
  for (const id of initialParticipants) {
    runtime.registerOpacityTarget(id, value => { draws[id] = value; }, { adoptVisible: true });
  }
  runtime.commitBatch();
  const coordinator = createNliSceneTransition({
    readSnapshot: () => snapshot, runtime, now: () => Date.now(),
    onFailure: diagnostic => failures.push(diagnostic),
    waitForEntry,
    prepare: prepareOverride || (async value => ({
      snapshot: value, desiredIds: value.enabledIds || ["registry.custom"],
      replaceIds: value.narrativeState.id ? ["a"] : [],
    })),
    applyPrepared: async (prepared, options) => {
      activations.push({ prepared, options });
      if (options.semanticOnly) return;
      for (const id of prepared.desiredIds) {
        runtime.registerOpacityTarget(id, value => { draws[id] = value; });
        if (failReplacement) runtime.markMemberFailed(id);
        else if (!pendingReplacement) runtime.markMemberReady(id);
      }
    },
    restorePrevious: async (value) => {
      restored.push(value);
      if (restoreThrows) throw new Error("restoration mount failed");
      runtime.registerOpacityTarget("a", value => { draws.a = value; });
      runtime.markMemberReady("a");
    },
    discardPrepared: value => {
      discarded.push(value);
      if (discardThrows) throw new Error("staged cleanup failed");
    },
  });
  return {
    coordinator, runtime, initial, draws, activations, discarded, restored, failures,
    set: value => { snapshot = { ...snapshot, ...value }; },
    async advance(ms) { await vi.advanceTimersByTimeAsync(ms); const callback = frame; frame = null; callback?.(); await flush(); },
    close() { coordinator.dispose(); runtime.dispose(); },
  };
}

describe("NLI scene boundary", () => {
  it("waits for a tiled source to load after the camera finishes traveling", async () => {
    const h = setup({ pendingReplacement: true, prepare: async () => ({ desiredIds: ["gaza.Gaza_Roads"], replaceIds: [] }) });
    h.set({ enabledIds: ["gaza.Gaza_Roads"] });
    const completion = h.coordinator.request(); await flush();
    await h.advance(1800);
    expect(h.failures).toEqual([]);
    expect(h.coordinator.getDisplayedSnapshot().enabledIds).toEqual(["a"]);
    h.runtime.markMemberReady("gaza.Gaza_Roads");
    await h.advance(600);
    expect(await completion).toEqual({ status: "ready" });
    expect(h.coordinator.getDisplayedSnapshot().enabledIds).toEqual(["gaza.Gaza_Roads"]);
    h.close();
  });
  it('waits for the paired start after exit and before activating Names', async () => {
    let release;
    const h = setup({ prepare: async () => ({ desiredIds: ['wall'], display: { exitBeforeEntry: true } }),
      waitForEntry: () => new Promise(resolve => { release = resolve; }) });
    h.set({ enabledIds: ['wall'] }); const completion = h.coordinator.request(); await flush();
    await h.advance(600);
    expect(h.activations).toHaveLength(0); expect(release).toBeTypeOf('function');
    release(); await flush(); expect(h.activations).toHaveLength(1);
    await h.advance(600); expect((await completion).status).toBe('ready'); h.close();
  });
  it("finishes the outgoing map before activating a fullscreen names scene", async () => {
    const h = setup({ prepare: async () => ({ desiredIds: ["wall"], display: { exitBeforeEntry: true } }) });
    h.set({ enabledIds: ["wall"] }); const completion = h.coordinator.request(); await flush();
    expect(h.activations).toHaveLength(0);
    await h.advance(300); expect(h.draws.a).toBeCloseTo(.5); expect(h.activations).toHaveLength(0);
    await h.advance(300); expect(h.draws.a).toBe(0); expect(h.activations).toHaveLength(1);
    await h.advance(600); expect(await completion).toEqual({ status: "ready" }); h.close();
  });
  it("buffers held scene topics and releases only the newest snapshot", async () => {
    const h = setup();
    h.set({ investigationClock: { presentationPendingUntilMs: 15000 } });
    const first = h.coordinator.request();
    h.set({ enabledIds: ["b"], narrativeState: { id: "nova" } });
    const second = h.coordinator.request();
    await flush();
    expect(h.coordinator.getDisplayedSnapshot()).toEqual(h.initial);
    expect(h.activations).toHaveLength(0);
    h.set({ narrativeState: { id: null }, investigationClock: { phase: "paused", positionMs: 200 } });
    const released = h.coordinator.request();
    await flush();
    expect(h.activations).toHaveLength(1);
    expect(h.activations[0].options.snapshot.investigationClock.positionMs).toBe(200);
    expect(h.draws.a).toBe(1); expect(h.draws.b).toBe(0);
    await h.advance(600);
    await expect(released).resolves.toEqual({ status: "ready" });
    await expect(first).resolves.toEqual({ status: "cancelled" });
    await expect(second).resolves.toEqual({ status: "cancelled" });
    expect(h.coordinator.getDisplayedSnapshot().enabledIds).toEqual(["b"]);
    h.close();
  });

  it("reconciles hold expiry once without a new external request", async () => {
    const h = setup();
    h.set({ enabledIds: ["b"], investigationClock: { presentationPendingUntilMs: 1000 } });
    h.coordinator.request();
    await h.advance(1000);
    expect(h.activations).toHaveLength(1);
    await h.advance(600);
    expect(h.coordinator.getDisplayedSnapshot().enabledIds).toEqual(["b"]);
    await h.advance(2000);
    expect(h.activations).toHaveLength(1);
    h.close();
  });

  it.each([
    { phase: "paused" }, { phase: "idle" }, { seekKind: "jump", positionMs: 100 },
    { revision: 4, serverNowMs: 999, membership: ["nli.lines"], anchorMs: 12 },
  ])("applies ordinary transport/bookkeeping through semantics without a scene batch: %j", async (clock) => {
    const h = setup();
    h.set({ investigationClock: clock, personSelection: { personId: "p1" } });
    await expect(h.coordinator.request()).resolves.toEqual({ status: "ready" });
    expect(h.runtime.getPendingBatch()).toBeNull();
    expect(h.draws.a).toBe(1);
    expect(h.activations[0].options.semanticOnly).toBe(true);
    expect(h.coordinator.getDisplayedSnapshot().personSelection.personId).toBe("p1");
    h.close();
  });

  it("coalesces ordinary topic delivery in one microtask", async () => {
    const h = setup();
    h.set({ enabledIds: ["b"] }); const first = h.coordinator.request();
    h.set({ enabledIds: ["c"] }); const second = h.coordinator.request();
    await flush();
    expect(h.activations).toHaveLength(1);
    expect(h.activations[0].prepared.desiredIds).toEqual(["c"]);
    await h.advance(600);
    await expect(first).resolves.toEqual({ status: "cancelled" });
    await expect(second).resolves.toEqual({ status: "ready" });
    h.close();
  });

  it("restores retained logical inputs after shared-resource failure at zero", async () => {
    const h = setup({ failReplacement: true });
    h.set({ narrativeState: { id: "nova" } });
    const completion = h.coordinator.request();
    await flush();
    expect(h.activations).toHaveLength(0);
    await h.advance(600);
    expect(h.restored).toEqual([h.initial]);
    expect(h.draws.a).toBe(0);
    await h.advance(600);
    await expect(completion).resolves.toEqual({ status: "failed" });
    expect(h.draws.a).toBe(1);
    expect(h.coordinator.getDisplayedSnapshot()).toEqual(h.initial);
    h.close();
  });

  it("bounds unheld preparation and discards late resources without activating", async () => {
    let resolvePreparation, preparationSignal;
    const h = setup({ prepare: (_, { signal }) => {
      preparationSignal = signal;
      return new Promise(resolve => { resolvePreparation = resolve; });
    } });
    h.set({ enabledIds: ["b"] }); const completion = h.coordinator.request();
    await flush(); await h.advance(15000);
    await expect(completion).resolves.toEqual({ status: "failed" });
    expect(preparationSignal.aborted).toBe(true);
    const late = { desiredIds: ["b"], replaceIds: [] };
    resolvePreparation(late); await flush();
    expect(h.discarded).toEqual([late]);
    expect(h.activations).toHaveLength(0);
    h.close();
  });

  it("disposal cancels a held request and removes its timer", async () => {
    const h = setup();
    h.set({ enabledIds: ["b"], investigationClock: { presentationPendingUntilMs: 1000 } });
    const completion = h.coordinator.request(); await flush();
    h.close();
    await expect(completion).resolves.toEqual({ status: "cancelled" });
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("reports the original preparation error and requested scene without changing retained pixels", async () => {
  const h = setup({ prepare: async () => { throw new Error("Validated projection Canvas candidate is not ready"); } });
  h.set({ enabledIds: ["nli.people_names"], narrativeState: { id: null, revision: 42 } });
  await expect(h.coordinator.request()).resolves.toEqual({ status: "failed" });
  expect(h.failures).toMatchObject([{
    phase: "preparation", reason: "Validated projection Canvas candidate is not ready",
    requested: { enabledIds: ["nli.people_names"], sceneRevision: 42 },
    retained: { enabledIds: ["a"] },
  }]);
  expect(h.draws.a).toBe(1);
  h.close();
});

it("reports the failed incoming member before restoring previous readiness", async () => {
  const h = setup({ failReplacement: true });
  h.set({ narrativeState: { id: "nova" } });
  const completion = h.coordinator.request(); await flush();
  await h.advance(600); await h.advance(600);
  await expect(completion).resolves.toEqual({ status: "failed" });
  expect(h.failures).toMatchObject([{
    phase: "entry", reason: "member-failed", failedIds: ["a"], requiredIds: ["a"],
  }]);
  expect(h.draws.a).toBe(1);
  h.close();
});

it("reports exactly which incoming members missed their readiness deadline", async () => {
  const h = setup({ pendingReplacement: true });
  h.set({ enabledIds: ["nli.people_names"] });
  const completion = h.coordinator.request(); await flush(); await h.advance(NLI_SCENE_READY_TIMEOUT_MS);
  await expect(completion).resolves.toEqual({ status: "failed" });
  expect(h.failures).toMatchObject([{
    phase: "entry", reason: "readiness-timeout", pendingIds: ["nli.people_names"], failedIds: [],
  }]);
  h.close();
});

it("does not report an intentionally superseded scene as a failure", async () => {
  const h = setup({ prepare: () => new Promise(() => {}) });
  h.set({ enabledIds: ["wall"] }); const completion = h.coordinator.request(); await flush();
  h.close();
  await expect(completion).resolves.toEqual({ status: "cancelled" });
  expect(h.failures).toEqual([]);
});
it("cancels obsolete asynchronous semantic updates", async () => {
  vi.useFakeTimers();
  let snapshot = { enabledIds: [], investigationClock: { phase: "paused", positionMs: 0 } };
  const signals = [], finish = [];
  const runtime = getLayerLifecycleRuntime({});
  const coordinator = createNliSceneTransition({
    runtime, readSnapshot: () => snapshot, prepare: async () => {},
    applyPrepared: (_, { signal }) => { signals.push(signal); return new Promise(resolve => finish.push(resolve)); },
  });
  snapshot = { ...snapshot, investigationClock: { phase: "paused", positionMs: 100 } };
  const first = coordinator.request(); await flush();
  snapshot = { ...snapshot, investigationClock: { phase: "paused", positionMs: 200 } };
  const second = coordinator.request(); await flush();
  expect(signals[0].aborted).toBe(true);
  finish[0](); finish[1](); await flush();
  await expect(first).resolves.toEqual({ status: "cancelled" });
  await expect(second).resolves.toEqual({ status: "ready" });
  expect(coordinator.getDisplayedSnapshot().investigationClock.positionMs).toBe(200);
  coordinator.dispose(); runtime.dispose();
});

it("buffers the latest clock position during shared exit without overwriting outgoing content", async () => {
  const h = setup();
  h.set({ narrativeState: { id: "nova" }, investigationClock: { phase: "playing", positionMs: 10 } });
  const first = h.coordinator.request(); await flush();
  h.set({ investigationClock: { phase: "paused", positionMs: 400 } });
  const update = h.coordinator.request(); await flush();
  expect(h.activations).toHaveLength(0);
  expect(h.coordinator.getDisplayedSnapshot()).toEqual(h.initial);
  await h.advance(600);
  expect(h.activations[0].options.snapshot.investigationClock).toEqual({ phase: "paused", positionMs: 400 });
  await h.advance(600);
  await expect(first).resolves.toEqual({ status: "ready" });
  await expect(update).resolves.toEqual({ status: "ready" });
  h.close();
});

it("uses scene basemap, escape, full layer groups, clock visibility and presentation session as structural boundaries", async () => {
  const cases = [
    { basemapId: "satellite_bw" },
    { escapeOverlay: { mor: true } },
    { enabledIds: undefined, layerGroups: [{ id: "registry", layers: [{ id: "custom", enabled: true }] }] },
    { investigationClock: { hiddenDisplays: ["projection"] } },
    { presentationCommand: { segmentId: "names_wall", presentationSessionId: "new-session" } },
  ];
  for (const value of cases) {
    const h = setup();
    h.set(value); const completion = h.coordinator.request(); await flush();
    expect(h.activations[0].options.joinBatch).toBe(true);
    await h.advance(600); await expect(completion).resolves.toEqual({ status: "ready" });
    h.close();
  }
});
it("does not leave an unsealed strict batch behind after a mounting exception", async () => {
  vi.useFakeTimers();
  let snapshot = { enabledIds: ["a"] };
  const runtime = getLayerLifecycleRuntime({});
  const coordinator = createNliSceneTransition({
    runtime, readSnapshot: () => snapshot,
    prepare: async () => ({ desiredIds: ["b"], replaceIds: [] }),
    applyPrepared: async () => { throw new Error("mount failed"); },
  });
  snapshot = { enabledIds: ["b"] };
  await expect(coordinator.request()).resolves.toEqual({ status: "failed" });
  expect(runtime.getPendingBatch()).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  coordinator.dispose(); runtime.dispose();
});

it("returns cancelled without allowing a superseded slow preparation to activate", async () => {
  let finishOld;
  const h = setup({ prepare: snapshot => snapshot.enabledIds[0] === "b"
    ? new Promise(resolve => { finishOld = resolve; })
    : Promise.resolve({ desiredIds: snapshot.enabledIds, replaceIds: [] }) });
  h.set({ enabledIds: ["b"] }); const first = h.coordinator.request(); await flush();
  h.set({ enabledIds: ["c"] }); const second = h.coordinator.request(); await flush();
  await expect(first).resolves.toEqual({ status: "cancelled" });
  finishOld({ desiredIds: ["b"], replaceIds: [] }); await flush();
  expect(h.discarded).toHaveLength(1);
  expect(h.activations).toHaveLength(1);
  expect(h.activations[0].prepared.desiredIds).toEqual(["c"]);
  await h.advance(600); await expect(second).resolves.toEqual({ status: "ready" });
  h.close();
});
it("reverses a 200 ms A-to-B-to-A handoff to the latest scene", async () => {
  const h = setup();
  h.set({ enabledIds: ["b"] }); const first = h.coordinator.request(); await flush();
  await h.advance(200);
  expect(h.draws.a).toBeCloseTo(2 / 3);
  expect(h.draws.b).toBeCloseTo(1 / 3);
  h.set({ enabledIds: ["a"] }); const reverse = h.coordinator.request(); await flush();
  await expect(first).resolves.toEqual({ status: "cancelled" });
  expect(h.draws.a).toBeCloseTo(2 / 3);
  await h.advance(600);
  await expect(reverse).resolves.toEqual({ status: "ready" });
  expect(h.draws.a).toBe(1);
  expect(h.draws.b).toBe(0);
  expect(h.runtime.getDesiredIds()).toEqual(["a"]);
  h.close();
});

it("restores full retained participant membership including renderer companions", async () => {
  const h = setup({ failReplacement: true, initialParticipants: ["a", "caption"] });
  h.set({ narrativeState: { id: "nova" } });
  const completion = h.coordinator.request(); await flush(); await h.advance(600);
  expect(h.runtime.getDesiredIds()).toEqual(["a", "caption"]);
  h.runtime.registerOpacityTarget("caption", () => {});
  h.runtime.markMemberReady("caption");
  await h.advance(600);
  await expect(completion).resolves.toEqual({ status: "failed" });
  h.close();
});

it("does not retry automatically when replacement and restoration both fail", async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  let snapshot = { enabledIds: ["a"], narrativeState: { id: null } }, factor, frame, attempts = 0;
  const runtime = getLayerLifecycleRuntime({}, {
    now: () => Date.now(), requestFrame: value => { frame = value; return 1; }, cancelFrame: () => { frame = null; },
  });
  runtime.setDesiredIds(["a"], { durationMs: 0 });
  runtime.registerOpacityTarget("a", value => { factor = value; }, { adoptVisible: true }); runtime.commitBatch();
  const coordinator = createNliSceneTransition({
    readSnapshot: () => snapshot, runtime,
    prepare: async () => ({ desiredIds: ["a"], replaceIds: ["a"] }),
    applyPrepared: async () => { attempts += 1; runtime.registerOpacityTarget("a", () => {}); runtime.markMemberFailed("a"); },
    restorePrevious: async () => { attempts += 1; runtime.registerOpacityTarget("a", () => {}); runtime.markMemberFailed("a"); },
  });
  snapshot = { enabledIds: ["a"], narrativeState: { id: "nova" } };
  const completion = coordinator.request(); await flush();
  await vi.advanceTimersByTimeAsync(600); frame?.(); await flush();
  await expect(completion).resolves.toEqual({ status: "failed" });
  expect(factor).toBe(0);
  await vi.advanceTimersByTimeAsync(3000); await flush();
  expect(attempts).toBe(2);
  expect(vi.getTimerCount()).toBe(0);
  coordinator.dispose(); runtime.dispose();
});

it("continues readiness gating under reduced motion without a scene frame", async () => {
  const matchMedia = vi.fn(() => ({ matches: true }));
  vi.stubGlobal("window", { matchMedia });
  const h = setup();
  try {
    h.set({ enabledIds: ["b"] });
    await expect(h.coordinator.request()).resolves.toEqual({ status: "ready" });
    expect(h.draws.a).toBe(0);
    expect(h.draws.b).toBe(1);
    expect(h.runtime.getRenderedReadiness().ready).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  } finally { h.close(); vi.unstubAllGlobals(); }
});
it("applies semantic changes received during entry before reporting rendered completion", async () => {
  const h = setup();
  h.set({ enabledIds: ["b"], investigationClock: { phase: "playing", positionMs: 0 } });
  const scene = h.coordinator.request(); await flush();
  h.set({ investigationClock: { phase: "paused", positionMs: 300 } });
  const semantic = h.coordinator.request(); await flush();
  await h.advance(600);
  await expect(scene).resolves.toEqual({ status: "ready" });
  await expect(semantic).resolves.toEqual({ status: "ready" });
  expect(h.activations).toHaveLength(2);
  expect(h.activations[1].options.semanticOnly).toBe(true);
  expect(h.activations[1].prepared.snapshot.investigationClock).toEqual({ phase: "paused", positionMs: 300 });
  expect(h.runtime.getPendingBatch()).toBeNull();
  h.close();
});

it("attempts restoration only once when its mount throws", async () => {
  const h = setup({ failReplacement: true, restoreThrows: true });
  h.set({ narrativeState: { id: "nova" } });
  const completion = h.coordinator.request(); await flush(); await h.advance(600);
  await expect(completion).resolves.toEqual({ status: "failed" });
  expect(h.restored).toHaveLength(1);
  expect(h.draws.a).toBe(0);
  expect(h.runtime.getPendingBatch()).toBeNull();
  h.close();
});

it("settles a failed request even when its staged cleanup throws", async () => {
  const h = setup({ failReplacement: true, discardThrows: true });
  try {
    h.set({ enabledIds: ["b"] });
    const completion = h.coordinator.request(); await flush();
    await expect(Promise.race([completion, Promise.resolve("pending")])).resolves.toEqual({ status: "failed" });
    expect(h.failures).toMatchObject([{ phase: "entry", reason: "member-failed",
      recovery: { phase: "cleanup", reason: "staged cleanup failed", errorName: "Error" } }]);
    expect(h.runtime.getPendingBatch()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  } finally { h.close(); }
});

it("contains throwing cleanup for a cancelled late candidate without blocking the new scene", async () => {
  let finishOld;
  const h = setup({ discardThrows: true, prepare: snapshot => snapshot.enabledIds[0] === "b"
    ? new Promise(resolve => { finishOld = resolve; })
    : Promise.resolve({ desiredIds: snapshot.enabledIds, replaceIds: [] }) });
  try {
    h.set({ enabledIds: ["b"] }); const obsolete = h.coordinator.request(); await flush();
    h.set({ enabledIds: ["c"] }); const latest = h.coordinator.request(); await flush();
    await expect(obsolete).resolves.toEqual({ status: "cancelled" });
    finishOld({ desiredIds: ["b"], replaceIds: [] }); await flush();
    await h.advance(600);
    await expect(latest).resolves.toEqual({ status: "ready" });
    expect(h.coordinator.getDisplayedSnapshot().enabledIds).toEqual(["c"]);
    expect(h.discarded).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally { h.close(); }
});

it("normal rebase cannot claim ownership after a newer acknowledged hold starts", async () => {
  const h = setup();
  const gate = await h.coordinator.waitForHold(); expect(gate.status).toBe("released"); expect(h.activations).toHaveLength(0);
  h.set({ narrativeState: { id: "nova" }, investigationClock: { phase: "idle", presentationPendingUntilMs: 15000 } });
  expect(h.coordinator.rebaseDisplayed(h.initial)).toBe(false);
  expect(h.coordinator.getDisplayedSnapshot()).toBe(h.initial); h.close();
});
it("disposing a held gate cancels all coalesced waiters and rejects rebase", async () => {
  const h = setup(); h.set({ investigationClock: { presentationPendingUntilMs: 15000 } });
  const first = h.coordinator.waitForHold(); const second = h.coordinator.waitForHold(); await flush();
  expect(h.activations).toHaveLength(0); h.coordinator.dispose();
  await expect(first).resolves.toEqual({ status: "cancelled" }); await expect(second).resolves.toEqual({ status: "cancelled" });
  expect(h.coordinator.rebaseDisplayed(h.initial)).toBe(false); expect(vi.getTimerCount()).toBe(0); h.close();
});
