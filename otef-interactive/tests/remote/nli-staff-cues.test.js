import { describe, expect, test, vi } from "vitest";
import { buildNovaEndedClock, commitSceneLayers, createCueRunner } from "../../frontend/src/remote/nli-staff-cues.js";
import { NLI_PLAYABLE_IDS } from "../../frontend/src/shared/nli-investigation-beats.js";
import { NLI_NOVA_STORY } from "../../frontend/src/shared/nli-nova-story.js";
import { idleNliClock, playNliClock } from "../../frontend/src/shared/nli-investigation-clock.js";

const LINES = "nli.lines";
const BASE = "projector_base.SEA";

function setup({ narrativeId = null, personId = null, layers, stop, start, end } = {}) {
  const calls = [];
  const record = (name) => vi.fn(async (...args) => {
    calls.push([name, ...args]);
    if (name === "layers" && layers) await layers(args[0]);
    if (name === "stop" && stop) await stop();
    if (name === "start" && start) return start(...args);
    if (name === "end" && end) return end(...args);
  });
  const dataContext = {
    getNarrativeState: () => ({ id: narrativeId }),
    getPersonSelection: () => ({ personId }),
    setNarrative: record("narrative"),
    clearPerson: record("clearPerson"),
    setEscapeOverlay: record("escape"),
  };
  const statuses = [];
  const runner = createCueRunner({
    dataContext,
    commitLayers: record("layers"),
    stopClock: record("stop"),
    startClock: record("start"),
    endClock: record("end"),
    onStatus: (status) => statuses.push(status),
  });
  return { runner, calls, statuses, dataContext };
}

describe("NLI staff cue runner", () => {
  function presentationSetup({ mutate } = {}) {
    let clock = idleNliClock();
    let narrativeId = null;
    const observed = [];
    const note = (kind) => observed.push({ kind, ...clock, narrativeId });
    const dataContext = {
      correctedNow: () => 1000,
      getInvestigationClock: () => clock,
      getNarrativeState: () => ({ id: narrativeId }),
      patchInvestigationClock: async (next) => { clock = next; note("clock"); return { ok: true }; },
      setNarrative: async (id) => {
        narrativeId = id;
        clock = idleNliClock(clock);
        note("narrative");
        return { ok: true };
      },
      setEscapeOverlay: async () => { note("escape"); return { ok: true }; },
    };
    const runner = createCueRunner({
      dataContext,
      commitLayers: async () => { note("layers"); await mutate?.(); },
      stopClock: async () => { clock = idleNliClock(clock); note("stop"); },
    });
    return { runner, dataContext, observed, getClock: () => clock };
  }

  test("Home to Segev retains presentation through every intermediate scene mutation", async () => {
    const { runner, observed, getClock } = presentationSetup();
    expect(await runner.apply({ layers: [BASE], clock: "idle" }, "segev")).toEqual({ status: "ready" });
    const mutations = observed.filter(({ kind }) => kind !== "clock");
    expect(mutations.map(({ kind }) => kind)).toEqual(["layers", "narrative", "escape", "stop"]);
    for (const mutation of mutations) expect(mutation.presentationPendingUntilMs).toBeGreaterThan(1000);
    expect(getClock()).not.toHaveProperty("presentationPendingUntilMs");
  });

  test("intentional hiding precedes scene mutations even during a presentation hold", async () => {
    const { runner, observed, getClock } = presentationSetup();
    await runner.apply({ layers: [BASE], clock: "idle", hiddenDisplays: ["gis", "projection"] }, "segev");
    for (const mutation of observed.filter(({ kind }) => kind !== "clock")) {
      expect(mutation.presentationPendingUntilMs).toBeGreaterThan(1000);
      expect(mutation.hiddenDisplays).toEqual(["gis", "projection"]);
    }
    expect(getClock().hiddenDisplays).toEqual(["gis", "projection"]);
  });

  test("a failed scene mutation releases its presentation hold", async () => {
    let duringMutation;
    const setup = presentationSetup({ mutate: () => {
      duringMutation = setup.getClock();
      throw new Error("layer failure");
    } });
    expect(await setup.runner.apply({ layers: [BASE], clock: "idle" }, "segev")).toEqual({ status: "failed" });
    expect(duringMutation.presentationPendingUntilMs).toBeGreaterThan(1000);
    expect(setup.getClock()).not.toHaveProperty("presentationPendingUntilMs");
  });

  test.each(["cancel", "null cue"])("%s releases the hold after an in-flight scene mutation settles", async (method) => {
    let release;
    const setup = presentationSetup({ mutate: () => new Promise((resolve) => { release = resolve; }) });
    const first = setup.runner.apply({ layers: [BASE], clock: "idle" }, "segev");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect(setup.getClock().presentationPendingUntilMs).toBeGreaterThan(1000);
    if (method === "cancel") setup.runner.cancel();
    else setup.runner.apply(null);
    release();
    expect(await first).toEqual({ status: "cancelled" });
    await vi.waitFor(() => expect(setup.getClock()).not.toHaveProperty("presentationPendingUntilMs"));
  });

  test("cancellation during the hold acknowledgement clears the server hold without mutating the scene", async () => {
    let localClock = idleNliClock();
    let serverClock = localClock;
    let acknowledge;
    let sceneMutations = 0;
    const dataContext = {
      correctedNow: () => 1000,
      getInvestigationClock: () => localClock,
      patchInvestigationClock: async (next, { isCurrent } = {}) => {
        if (isCurrent && !isCurrent()) return { ok: false, stale: true };
        serverClock = next;
        if (Object.hasOwn(next, "presentationPendingUntilMs")) {
          await new Promise((resolve) => { acknowledge = resolve; });
        }
        // Match the state action: superseded acknowledgements do not adopt
        // the server clock even though the server already accepted the write.
        if (isCurrent && !isCurrent()) return { ok: false, stale: true };
        localClock = next;
        return { ok: true };
      },
    };
    const runner = createCueRunner({ dataContext, commitLayers: async () => { sceneMutations += 1; } });
    const applying = runner.apply({ layers: [BASE], clock: "idle" }, "segev");
    await vi.waitFor(() => expect(acknowledge).toBeTypeOf("function"));
    expect(serverClock.presentationPendingUntilMs).toBeGreaterThan(1000);
    runner.cancel();
    acknowledge();
    expect(await applying).toEqual({ status: "cancelled" });
    await vi.waitFor(() => expect(serverClock).not.toHaveProperty("presentationPendingUntilMs"));
    expect(localClock).not.toHaveProperty("presentationPendingUntilMs");
    expect(sceneMutations).toBe(0);
  });

  test("superseding a pending cue keeps its hold until the last cue settles", async () => {
    let release;
    let calls = 0;
    const setup = presentationSetup({ mutate: () => {
      if (++calls === 1) return new Promise((resolve) => { release = resolve; });
    } });
    const first = setup.runner.apply({ layers: [BASE], clock: "idle" }, "segev");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const second = setup.runner.apply({ layers: [BASE], clock: "idle" }, "hostages");
    release();
    expect(await first).toEqual({ status: "cancelled" });
    expect(await second).toEqual({ status: "ready" });
    for (const mutation of setup.observed.slice(0, -1)) {
      expect(mutation.presentationPendingUntilMs).toBeGreaterThan(1000);
    }
    expect(setup.getClock()).not.toHaveProperty("presentationPendingUntilMs");
  });

  test("cancelling then immediately applying a new cue retains presentation between them", async () => {
    let release;
    let calls = 0;
    const setup = presentationSetup({ mutate: () => {
      if (++calls === 1) return new Promise((resolve) => { release = resolve; });
    } });
    const first = setup.runner.apply({ layers: [BASE], clock: "idle" }, "segev");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    setup.runner.cancel();
    const second = setup.runner.apply({ layers: [BASE], clock: "idle" }, "hostages");
    release();
    await Promise.all([first, second]);
    for (const mutation of setup.observed.slice(0, -1)) {
      expect(mutation.presentationPendingUntilMs).toBeGreaterThan(1000);
    }
  });

  test("cleanup leaves a different staff writer's presentation hold in place", async () => {
    const setup = presentationSetup({ mutate: async () => {
      await setup.dataContext.patchInvestigationClock({ ...setup.getClock(), presentationPendingUntilMs: 21000 });
    } });
    expect(await setup.runner.apply({ layers: [BASE], clock: "idle" }, "segev")).toEqual({ status: "ready" });
    expect(setup.getClock().presentationPendingUntilMs).toBe(21000);
  });

  test("a failed cleanup leaves a finite deadline rather than an unbounded hold", async () => {
    const setup = presentationSetup();
    const original = setup.dataContext.patchInvestigationClock;
    setup.dataContext.patchInvestigationClock = async (clock, options) => {
      if (!Object.hasOwn(clock, "presentationPendingUntilMs")) return { ok: false, error: new Error("offline") };
      return original(clock, options);
    };
    expect(await setup.runner.apply({ layers: [BASE], clock: "idle" }, "segev")).toEqual({ status: "failed" });
    expect(setup.getClock().presentationPendingUntilMs).toBeGreaterThan(1000);
    expect(setup.getClock().presentationPendingUntilMs).toBeLessThanOrEqual(31000);
  });

  test.each([false, true])("Nova scene mutations never publish a visible clock (already hidden: %s)", async (alreadyHidden) => {
    let clock = alreadyHidden
      ? { ...buildNovaEndedClock(), hiddenDisplays: ["gis", "projection"] }
      : playNliClock(idleNliClock(), [...NLI_PLAYABLE_IDS], [...NLI_NOVA_STORY.representativeMinutes], 0);
    const observed = [];
    const note = () => observed.push([...(clock.hiddenDisplays ?? [])]);
    const dataContext = {
      getNarrativeState: () => ({ id: "nova" }),
      getInvestigationClock: () => clock,
      setEscapeOverlay: async () => { note(); return { ok: true }; },
      patchInvestigationClock: async (next) => { clock = next; note(); return { ok: true }; },
    };
    const runner = createCueRunner({
      dataContext, commitLayers: async () => note(),
      endClock: async () => { clock = buildNovaEndedClock(clock); note(); },
    });
    expect(await runner.apply({ layers: [BASE, LINES], clock: "ended", hiddenDisplays: ["gis", "projection"] }, "nova"))
      .toEqual({ status: "ready" });
    expect(observed.length).toBeGreaterThan(0);
    for (const snapshot of observed) expect(snapshot).toEqual(["gis", "projection"]);
  });

  test("hidden hostages-to-all-hostages transition carries visibility in the narrative reset", async () => {
    let narrativeId = "hostages";
    let clock = { ...idleNliClock(), hiddenDisplays: ["gis", "projection"] };
    const observed = [];
    const note = () => observed.push([...(clock.hiddenDisplays ?? [])]);
    const dataContext = {
      getNarrativeState: () => ({ id: narrativeId }), getInvestigationClock: () => clock,
      setNarrative: async (id, options) => {
        narrativeId = id;
        clock = { ...idleNliClock(), ...(options?.hiddenDisplays ? { hiddenDisplays: options.hiddenDisplays } : {}) };
        note(); return { ok: true };
      },
      setEscapeOverlay: async () => { note(); return { ok: true }; },
      patchInvestigationClock: async (next) => { clock = next; note(); return { ok: true }; },
    };
    const runner = createCueRunner({ dataContext, commitLayers: async () => note(), stopClock: async () => note() });
    expect(await runner.apply({ narrative: "hostages_all", layers: [BASE], clock: "idle", hiddenDisplays: ["gis", "projection"] }, "hostages"))
      .toEqual({ status: "ready" });
    for (const snapshot of observed) expect(snapshot).toEqual(["gis", "projection"]);
  });
  test("publishes scene visibility and clears it when returning to an earlier cue", async () => {
    const { runner, dataContext } = setup({ narrativeId: "hostages" });
    let clock = { phase: "idle" };
    dataContext.getInvestigationClock = () => clock;
    dataContext.patchInvestigationClock = async (next) => {
      clock = next;
      return { ok: true };
    };
    await runner.apply({ layers: [BASE], clock: "idle", hiddenDisplays: ["gis", "projection"] }, "hostages");
    expect(clock.hiddenDisplays).toEqual(["gis", "projection"]);
    await runner.apply({ layers: [BASE], clock: "idle" }, "hostages");
    expect(clock.hiddenDisplays).toEqual([]);
  });
  test("a play window starts without idling Home, then enables playables", async () => {
    const { runner, calls, statuses } = setup();
    const result = await runner.apply({
      layers: [BASE, LINES],
      clock: { to: 401 },
      escape: { mor: true },
    }, "nova");
    expect(result).toEqual({ status: "ready" });
    expect(calls.map(([name]) => name)).toEqual([
      "narrative", "escape", "start", "layers",
    ]);
    expect(calls[0][1]).toBe("nova");
    expect(calls[1][1]).toEqual({ individual: false, overlap: false, mor: true, settled: false });
    expect(calls[2][1]).toEqual({ to: 401 });
    expect(calls[2][2]).toEqual([LINES]);
    expect(typeof calls[2][3]).toBe("function");
    expect(calls[3][1]).toEqual([BASE, LINES]);
    expect(statuses).toEqual(["applying", "ready"]);
  });

  test("switching play windows does not idle between scenes", async () => {
    const { runner, calls } = setup();
    await runner.apply({ layers: [BASE, LINES], clock: { to: 401 }, escape: {} }, null);
    const before = calls.length;
    await runner.apply({ layers: [BASE, LINES], clock: { from: 402 }, escape: {} }, null);
    expect(calls.slice(before).map(([name]) => name)).toEqual(["escape", "start", "layers"]);
    expect(calls.slice(before).some(([name]) => name === "stop")).toBe(false);
    expect(calls.slice(before).some(([name]) => name === "narrative")).toBe(false);
    expect(calls.slice(before).find(([name]) => name === "start")[1]).toEqual({ from: 402 });
  });

  test("Segev idle to rest-of-day starts the clock before clearing narrative", async () => {
    const { runner, calls } = setup({ narrativeId: "segev" });
    await runner.apply({ layers: [BASE, LINES], clock: { from: 402 }, escape: {} }, null);
    expect(calls.map(([name]) => name)).toEqual(["escape", "start", "narrative", "layers"]);
    expect(calls.find(([name]) => name === "start")[1]).toEqual({ from: 402 });
    expect(calls.find(([name]) => name === "narrative")[1]).toBeNull();
    expect(calls.some(([name]) => name === "stop")).toBe(false);
    expect(calls.findIndex(([name]) => name === "start"))
      .toBeLessThan(calls.findIndex(([name]) => name === "narrative"));
  });

  test("rest-of-day play to Nova idle publishes Nova before dropping timeline layers", async () => {
    let narrativeId = null;
    let phase = "playing";
    const seen = [];
    const note = () => { seen.push({ phase, narrativeId }); };
    const { runner, calls, dataContext } = setup({
      layers: () => { note(); },
      stop: () => { phase = "idle"; note(); },
    });
    dataContext.getNarrativeState = () => ({ id: narrativeId });
    dataContext.setNarrative = vi.fn(async (id) => {
      narrativeId = id;
      if (id != null) phase = "idle";
      calls.push(["narrative", id]);
      note();
    });
    await runner.apply({ layers: [BASE, LINES], clock: "idle", escape: {} }, "nova");
    expect(calls.map(([name]) => name)).toEqual(["layers", "narrative", "escape", "stop"]);
    expect(calls[0][1]).toEqual([BASE, LINES]);
    expect(calls[1][1]).toBe("nova");
    expect(calls.findIndex(([name]) => name === "layers"))
      .toBeLessThan(calls.findIndex(([name]) => name === "narrative"));
    expect(calls.findIndex(([name]) => name === "narrative"))
      .toBeLessThan(calls.findIndex(([name]) => name === "stop"));
    expect(seen.some((snapshot) => snapshot.phase === "idle" && snapshot.narrativeId == null)).toBe(false);
    expect(seen.at(-1)).toEqual({ phase: "idle", narrativeId: "nova" });
  });

  test("Segev idle from play commits focus layers before narrative and stop", async () => {
    const { runner, calls } = setup();
    await runner.apply({ layers: [BASE, LINES], clock: { to: 401 }, escape: {} }, null);
    const before = calls.length;
    await runner.apply({ layers: [BASE], clock: "idle", escape: {} }, "segev");
    const rest = calls.slice(before);
    expect(rest.map(([name]) => name)).toEqual(["layers", "narrative", "escape", "stop"]);
    expect(rest[0][1]).toEqual([BASE]);
    expect(rest[1][1]).toBe("segev");
    expect(rest.findIndex(([name]) => name === "layers"))
      .toBeLessThan(rest.findIndex(([name]) => name === "narrative"));
    expect(rest.findIndex(([name]) => name === "narrative"))
      .toBeLessThan(rest.findIndex(([name]) => name === "stop"));
  });

  test("Home commits destination layers, including disabled playables, before idle", async () => {
    const { runner, calls } = setup({ narrativeId: "segev" });
    await runner.apply({ narrative: null, layers: [BASE], clock: "idle", escape: {} }, "segev");
    expect(calls.map(([name]) => name)).toEqual(["layers", "narrative", "escape", "stop"]);
    expect(calls[0][1]).toEqual([BASE]);
    expect(calls[1][1]).toBeNull();
    const stopIndex = calls.findIndex(([name]) => name === "stop");
    expect(calls.findIndex(([name]) => name === "layers")).toBeLessThan(stopIndex);
  });

  test("Shura idle keeps playables enabled and then stops", async () => {
    const { runner, calls } = setup();
    await runner.apply({ layers: [BASE, LINES], clock: "idle", escape: {} }, null);
    expect(calls.map(([name]) => name)).toEqual(["layers", "narrative", "escape", "stop"]);
    expect(calls[0][1]).toEqual([BASE, LINES]);
    expect(calls.some(([name]) => name === "start")).toBe(false);
  });

  test("an ended memorial cue inside Nova replaces the play-window layers", async () => {
    const { runner, calls } = setup({ narrativeId: "nova" });
    const PEOPLE = "nli.people";
    await runner.apply({ layers: [BASE, LINES], clock: {}, escape: {} }, "nova");
    const before = calls.length;
    await expect(runner.apply({
      layers: [BASE, PEOPLE],
      clock: "ended",
      escape: { settled: true },
    }, "nova")).resolves.toEqual({ status: "ready" });
    const rest = calls.slice(before);
    expect(rest.map(([name]) => name)).toEqual(["end", "layers", "escape"]);
    expect(rest[1][1]).toEqual([BASE, PEOPLE]);
    expect(rest[1][1]).not.toContain(LINES);
    expect(rest[2][1]).toEqual({ individual: false, overlap: false, mor: false, settled: true });
    expect(rest.some(([name]) => name === "start" || name === "stop")).toBe(false);
  });

  test("an ended Nova cue completes the clock before escape and does not play or stop", async () => {
    const { runner, calls } = setup({ narrativeId: "nova" });
    await runner.apply({
      layers: [BASE, LINES],
      clock: "ended",
      escape: { individual: true },
    }, "nova");
    expect(calls.map(([name]) => name)).toEqual(["end", "layers", "escape"]);
    expect(calls[1][1]).toEqual([BASE, LINES]);
    expect(calls[2][1]).toEqual({ individual: true, overlap: false, mor: false, settled: false });
    expect(calls.some(([name]) => name === "stop" || name === "start")).toBe(false);
  });

  test("entering Nova stages non-playables before the narrative, then restores full layers after ended", async () => {
    const { runner, calls } = setup({ narrativeId: "segev" });
    await runner.apply({
      narrative: "nova",
      layers: [BASE, LINES],
      clock: "ended",
      escape: { mor: true },
    }, "segev");
    expect(calls.map(([name]) => name)).toEqual(["layers", "narrative", "end", "layers", "escape"]);
    expect(calls[0][1]).toEqual([BASE]);
    expect(calls[1][1]).toBe("nova");
    expect(calls[3][1]).toEqual([BASE, LINES]);
  });

  test("a superseded play cue does not publish final layers or ready", async () => {
    let releaseNarrative;
    const { runner, calls, statuses, dataContext } = setup();
    dataContext.setNarrative = vi.fn(() => {
      if (!releaseNarrative) return new Promise((resolve) => { releaseNarrative = resolve; });
      return Promise.resolve();
    });
    const first = runner.apply({ layers: [BASE, LINES], clock: { to: 401 }, escape: {} }, "segev");
    await vi.waitFor(() => expect(dataContext.setNarrative).toHaveBeenCalled());
    const second = runner.apply({ layers: [BASE], clock: "idle", escape: {} }, null);
    releaseNarrative();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toEqual({ status: "cancelled" });
    expect(secondResult).toEqual({ status: "ready" });
    expect(calls.some(([name]) => name === "start")).toBe(false);
    expect(calls.some(([name, ids]) => name === "layers" && ids.includes(LINES))).toBe(false);
    expect(statuses.at(-1)).toBe("ready");
  });

  test("a rejected narrative does not stop or start", async () => {
    const { runner, calls, statuses, dataContext } = setup();
    dataContext.setNarrative = vi.fn(async () => ({ ok: false, error: new Error("narrative rejected") }));
    await expect(runner.apply({ layers: [BASE, LINES], clock: { to: 401 } }, "segev"))
      .resolves.toEqual({ status: "failed" });
    expect(calls.some(([name]) => name === "stop" || name === "start")).toBe(false);
    expect(statuses).toEqual(["applying", "failed"]);
  });

  test("a failed idle stop still prevents Home from reporting ready", async () => {
    const { runner, calls, statuses } = setup({
      stop: async () => { throw new Error("stop failed"); },
    });
    await expect(runner.apply({ layers: [BASE], clock: "idle", escape: {} }, null))
      .resolves.toEqual({ status: "failed" });
    expect(calls.some(([name]) => name === "start")).toBe(false);
    expect(statuses).toEqual(["applying", "failed"]);
  });

  test("a superseded start does not enable final playables", async () => {
    const { runner, calls, statuses } = setup({
      start: async () => false,
    });
    await expect(runner.apply({ layers: [BASE, LINES], clock: {}, escape: {} }, null))
      .resolves.toEqual({ status: "cancelled" });
    expect(calls.filter(([name]) => name === "layers")).toEqual([]);
    expect(statuses).toEqual(["applying"]);
  });

  test("a step without a cue cancels remaining work and clears the active cue", async () => {
    let release;
    const calls = [];
    const statuses = [];
    const dataContext = {
      getNarrativeState: () => ({ id: null }),
      getPersonSelection: () => ({ personId: null }),
      setNarrative: vi.fn(() => new Promise((resolve) => { release = resolve; })),
      clearPerson: vi.fn(),
      setEscapeOverlay: vi.fn(async () => { calls.push(["escape"]); }),
    };
    const runner = createCueRunner({
      dataContext,
      commitLayers: vi.fn(async (ids) => { calls.push(["layers", ids]); }),
      stopClock: vi.fn(async () => { calls.push(["stop"]); }),
      startClock: vi.fn(async () => { calls.push(["start"]); return true; }),
      endClock: vi.fn(async () => { calls.push(["end"]); }),
      onStatus: (status) => statuses.push(status),
    });
    const first = runner.apply({ layers: [BASE, LINES], clock: { to: 401 } }, "segev");
    await vi.waitFor(() => expect(dataContext.setNarrative).toHaveBeenCalled());
    const cleared = runner.apply(undefined, "segev");
    release();
    await first;
    await expect(cleared).resolves.toEqual({ status: "cancelled" });
    expect(calls.some(([name]) => name === "start")).toBe(false);
    expect(statuses).toContain(null);
  });

  test("cancel releases applying when the next cue is never applied", async () => {
    let release;
    const { runner, statuses, dataContext } = setup();
    dataContext.setNarrative = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const pending = runner.apply({ layers: [BASE, LINES], clock: { to: 401 } }, "segev");
    await vi.waitFor(() => expect(dataContext.setNarrative).toHaveBeenCalled());
    expect(statuses.at(-1)).toBe("applying");
    runner.cancel();
    expect(statuses.at(-1)).toBe(null);
    release();
    await pending;
    expect(statuses.at(-1)).toBe(null);
    expect(statuses).not.toContain("ready");
  });

  test("buildNovaEndedClock is a fresh terminal Nova clock", () => {
    const clock = buildNovaEndedClock();
    expect(clock).toMatchObject({
      phase: "ended",
      positionMs: 40000,
      anchorMs: null,
      loop: false,
      beats: [...NLI_NOVA_STORY.representativeMinutes],
      membership: [...NLI_PLAYABLE_IDS],
    });
    expect(clock.leadInMinutes).toBeUndefined();
    expect(clock.alarmOnsetOriginMs).toBeUndefined();
  });

  test("layer commit fails when the context is missing or the result is not acknowledged", async () => {
    await expect(commitSceneLayers(null, [BASE])).rejects.toThrow(/unavailable/i);
    await expect(commitSceneLayers({
      setEnabledLayerIds: async () => ({ ok: false, error: new Error("layer rejected") }),
    }, [BASE, BASE])).rejects.toThrow(/layer rejected/);
    const setEnabledLayerIds = vi.fn(async () => ({ ok: true }));
    await commitSceneLayers({ setEnabledLayerIds }, [BASE, BASE]);
    expect(setEnabledLayerIds).toHaveBeenCalledWith([BASE]);
  });
});
