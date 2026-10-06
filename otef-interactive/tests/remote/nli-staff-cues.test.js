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
