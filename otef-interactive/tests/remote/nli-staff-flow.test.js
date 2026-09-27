import { afterEach, describe, expect, test, vi } from "vitest";
import { createCueRunner } from "../../frontend/src/remote/nli-staff-cues.js";
import { nextAction, prevAction, showStepIndex, slideIndexes } from "../../frontend/src/remote/nli-staff-flow.js";
import { createNliStaffTimelineHost } from "../../frontend/src/remote/nli-staff-timeline-host.js";
import { waitForInvestigationClockIdle } from "../../frontend/src/remote/remote-people-archive-controller.js";
import * as catalog from "../../frontend/src/remote/nli-staff-script.js";
import { COPY, HOME_SHOW_SHORTCUTS, NARRATIVES, SHOW } from "../../frontend/src/remote/nli-staff-script.js";
import { createNliStaffSearchEventHandlers } from "../../frontend/src/remote/nli-staff-remote.js";
import {
  INVESTIGATION_ALARMS_FULL_ID,
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
  NLI_PLAYABLE_IDS,
} from "../../frontend/src/shared/nli-investigation-beats.js";
import {
  idleNliClock,
  normalizeNliClock,
  pauseNliClock,
  playNliClock,
  setNliLoop,
} from "../../frontend/src/shared/nli-investigation-clock.js";
import { deriveInvestigationFrame } from "../../frontend/src/shared/nli-investigation-visual-state.js";

const showIndex = (title) => SHOW.steps.findIndex((step) => step.title.en === title);
const lastOf = (id) => NARRATIVES.find((item) => item.id === id).steps.length - 1;
const junction = (ids) => SHOW.steps.findIndex((step) => step.branch?.join() === ids.join());

describe("NLI staff show flow", () => {
  test("step transitions force-close before clearing and wait for the destination cue", async () => {
    let generation = 0;
    const events = [];
    let releaseCue;
    const transition = {
      begin: () => ++generation,
      isCurrent: (token) => token === generation,
      clearAll: async () => { events.push("clear"); return true; },
    };
    const handlers = createNliStaffSearchEventHandlers({
      transition,
      beforeTransition: async () => { events.push("close"); },
      setDestination: () => events.push("destination"),
      renderDestination: () => events.push("render"),
      applyDestinationCue: () => {
        events.push("cue-start");
        return new Promise((resolve) => { releaseCue = () => { events.push("cue-ready"); resolve(); }; });
      },
      afterDestinationCue: () => events.push("after-cue"),
    });
    const pending = handlers.transitionToStep({ steps: [{}] }, 0, null);
    await vi.waitFor(() => expect(events).toContain("cue-start"));
    expect(events).toEqual(["close", "clear", "destination", "render", "cue-start"]);
    releaseCue();
    await pending;
    expect(events.at(-1)).toBe("after-cue");
  });

  test("a newer transition suppresses the Shura post-cue callback", async () => {
    let generation = 0;
    const events = [];
    let releaseCue;
    const transition = {
      begin: () => ++generation,
      isCurrent: (token) => token === generation,
      clearAll: async () => true,
    };
    const handlers = createNliStaffSearchEventHandlers({
      transition,
      applyDestinationCue: () => new Promise((resolve) => { releaseCue = resolve; }),
      afterDestinationCue: () => events.push("auto-open"),
    });
    const pending = handlers.transitionToStep({ steps: [{}] }, 0, null);
    await vi.waitFor(() => expect(releaseCue).toBeTypeOf("function"));
    transition.begin();
    releaseCue();
    await pending;
    expect(events).toEqual([]);
  });

  test("a false close acknowledgement stops before clear and the cue", async () => {
    let generation = 0;
    const events = [];
    const handlers = createNliStaffSearchEventHandlers({
      transition: {
        begin: () => ++generation,
        isCurrent: (token) => token === generation,
        clearAll: async () => { events.push("clear"); return true; },
      },
      beforeTransition: async () => { events.push("close"); return false; },
      setDestination: () => events.push("destination"),
      applyDestinationCue: async () => { events.push("cue"); },
      afterDestinationCue: () => events.push("after-cue"),
    });
    await expect(handlers.transitionToStep({ steps: [{}] }, 0, null)).resolves.toBe(false);
    expect(events).toEqual(["close"]);
  });

  test("the post-cue hook receives the cue result and does not infer success from status alone", async () => {
    let generation = 0;
    const seen = [];
    const handlers = createNliStaffSearchEventHandlers({
      transition: {
        begin: () => ++generation,
        isCurrent: (token) => token === generation,
        clearAll: async () => true,
      },
      applyDestinationCue: async () => ({ status: "failed" }),
      afterDestinationCue: (_item, _index, result) => { seen.push(result); },
    });
    await handlers.transitionToStep({ id: "shura", steps: [{}] }, 0, null);
    expect(seen).toEqual([{ status: "failed" }]);
  });

  test("home search shortcuts point to canonical SHOW step IDs", () => {
    expect(HOME_SHOW_SHORTCUTS.every((item) => SHOW.steps[showStepIndex(item.id)]?.id === item.id)).toBe(true);
  });

  test("search status copy reports reset failures without a currently-shown label", () => {
    expect(COPY.he.searchClearFailed).toBeTruthy();
    expect(COPY.en.searchClearFailed).toBeTruthy();
    expect(COPY.he).not.toHaveProperty("nowShowing");
    expect(COPY.en).not.toHaveProperty("nowShowing");
  });

  test("branch steps are junctions, not slides", () => {
    const slides = slideIndexes(SHOW).map((index) => SHOW.steps[index]);
    expect(slides.some((step) => step.branch)).toBe(false);
    expect(slides).toHaveLength(SHOW.steps.length - 3);
  });

  test("the opening minutes offer the Segev story instead of skipping it", () => {
    expect(nextAction({ scriptId: "show", step: showIndex("The opening minutes"), returnTo: null })).toEqual({
      kind: "choose",
      scriptId: "show",
      junction: junction(["segev"]),
      ids: ["segev"],
    });
  });

  test("finishing Segev resumes the show after its junction", () => {
    const returnTo = { id: "show", step: junction(["segev"]) };
    expect(nextAction({ scriptId: "segev", step: lastOf("segev"), returnTo })).toEqual({
      kind: "resume",
      scriptId: "show",
      step: showIndex("The rest of the day"),
    });
  });

  test("the last Nova slide offers the three free-choice narratives", () => {
    const returnTo = { id: "show", step: junction(["nova"]) };
    expect(nextAction({ scriptId: "nova", step: lastOf("nova"), returnTo })).toMatchObject({
      kind: "choose",
      ids: ["sderot", "shura", "hostages"],
    });
  });

  test("a free-choice narrative resumes at the identity database", () => {
    const returnTo = { id: "show", step: junction(["sderot", "shura", "hostages"]) };
    expect(nextAction({ scriptId: "sderot", step: lastOf("sderot"), returnTo })).toMatchObject({
      kind: "resume",
      step: showIndex("Identity database"),
    });
  });

  test("a narrative opened from home finishes at its last step", () => {
    expect(nextAction({ scriptId: "segev", step: lastOf("segev"), returnTo: null })).toEqual({ kind: "finish" });
    expect(nextAction({ scriptId: "hostages", step: 0, returnTo: null })).toEqual({
      kind: "step",
      scriptId: "hostages",
      step: 1,
    });
  });

  test("the direct timeline advances to the full story and Home, and Back restarts the rest of the day", () => {
    expect(catalog.TIMELINE?.id).toBe("timeline");
    const timeline = catalog.TIMELINE;
    const rest = timeline?.steps?.findIndex((step) => step.id === "rest-of-day");
    const complete = timeline?.steps?.findIndex((step) => step.id === "timeline-complete");
    expect(nextAction({ scriptId: "timeline", step: rest, returnTo: null })).toEqual({
      kind: "step",
      scriptId: "timeline",
      step: complete,
    });
    expect(prevAction({ scriptId: "timeline", step: complete, returnTo: null })).toEqual({
      scriptId: "timeline",
      step: rest,
      returnTo: null,
    });
    expect(nextAction({ scriptId: "timeline", step: complete, returnTo: null })).toEqual({ kind: "finish" });
    expect(nextAction({
      scriptId: "show",
      step: showIndex("The rest of the day"),
      returnTo: null,
    }).kind).toBe("choose");
  });

  test("closing the Hostages presentation advances through Nir Oz people to all hostages", () => {
    const hostages = NARRATIVES.find((item) => item.id === "hostages");
    const presentationIndex = hostages.steps.findIndex((step) => step.presentation);
    const presentation = hostages.steps[presentationIndex];
    expect(presentation.presentation).toEqual({ segmentId: "hostages", open: "manual", onClose: "next" });
    expect(hostages.steps[presentationIndex + 1].title.en).toBe("Nir Oz victims and hostages");
    expect(hostages.steps[presentationIndex + 1].cue.layers).toContain("nli.people");
    expect(hostages.steps[presentationIndex + 2].title.en).toBe("All hostages");
    expect(hostages.steps[presentationIndex + 2].cue.narrative).toBe("hostages_all");
  });

  test("previous skips junctions and leaves a narrative for the slide before it", () => {
    expect(prevAction({ scriptId: "show", step: showIndex("The rest of the day"), returnTo: null })).toEqual({
      scriptId: "show",
      step: showIndex("The opening minutes"),
      returnTo: null,
    });
    const returnTo = { id: "show", step: junction(["segev"]) };
    expect(prevAction({ scriptId: "segev", step: 0, returnTo })).toEqual({
      scriptId: "show",
      step: showIndex("The opening minutes"),
      returnTo: null,
    });
    expect(prevAction({ scriptId: "show", step: 0, returnTo: null })).toBeNull();
  });
});

const STORY_BEATS = [389, 400, 410, 740];
const ROUTE_BEATS = [400, 740];
const NO_ESCAPE = { individual: false, overlap: false, mor: false, settled: false };

function beatFeatures(minutes) {
  return minutes.map((timeline_minutes) => ({ properties: { timeline_minutes } }));
}

function fullStoryFrame(clock, layers) {
  return deriveInvestigationFrame(clock, 99_000, layers, {
    motionMode: "full",
    storyBeats: STORY_BEATS,
    polygonMotionActive: true,
    routeBeats: new Set(ROUTE_BEATS),
    narrativeId: null,
  });
}

function idleLineFrame() {
  return deriveInvestigationFrame(
    normalizeNliClock({
      phase: "ended",
      membership: [INVESTIGATION_LINES_FULL_ID],
      beats: ROUTE_BEATS,
    }),
    99_000,
    [INVESTIGATION_LINES_FULL_ID],
    { motionMode: "full", routeBeats: new Set(ROUTE_BEATS) },
  );
}

function installSceneHarness(initialClock) {
  let clock = initialClock;
  const patches = [];
  const layers = [];
  const endCalls = [];
  let holdPlaying = false;
  let releasePlaying = null;
  let playingHeld = false;
  const dataContext = {
    getNarrativeState: () => ({ id: null, revision: 1 }),
    getPersonSelection: () => ({ personId: null }),
    getProjectionSlideshow: () => null,
    getInvestigationClock: () => clock,
    correctedNow: () => 50_000,
    subscribe: () => () => {},
    setNarrative: vi.fn(async (id) => {
      dataContext.narrativeId = id;
      return { ok: true };
    }),
    clearPerson: vi.fn(async () => ({ ok: true })),
    setEscapeOverlay: vi.fn(async (overlay) => {
      dataContext.escape = overlay;
      return { ok: true };
    }),
    narrativeId: null,
    escape: null,
    patchInvestigationClock: vi.fn(async (next, { isCurrent } = {}) => {
      if (holdPlaying && next?.phase === "playing") {
        holdPlaying = false;
        playingHeld = true;
        await new Promise((resolve) => { releasePlaying = resolve; });
      }
      if (typeof isCurrent === "function" && !isCurrent()) {
        return { ok: false, stale: true };
      }
      clock = next;
      patches.push(next);
      return { ok: true, clock: next };
    }),
  };
  globalThis.OTEFDataContext = dataContext;
  const host = createNliStaffTimelineHost({
    sheet: null,
    getGroups: () => [],
    render: () => {},
  });
  host._nliFeatureCache = {
    [INVESTIGATION_LINES_FULL_ID]: beatFeatures(STORY_BEATS),
    [INVESTIGATION_POLYGONS_FULL_ID]: beatFeatures(STORY_BEATS),
    [INVESTIGATION_ALARMS_FULL_ID]: [],
  };
  const runner = createCueRunner({
    dataContext,
    commitLayers: async (ids) => { layers.push([...ids]); },
    stopClock: (isCurrent) => waitForInvestigationClockIdle(dataContext, {
      forceStop: true,
      isCancelled: () => !isCurrent(),
    }),
    startClock: (window, membership, isCurrent) => host.startNliTimelineWindow({
      membership,
      from: window?.from,
      to: window?.to,
      loop: window?.loop === true,
      isCurrent,
    }),
    endClock: async () => {
      endCalls.push("nova-ended");
      throw new Error("timeline-complete must not build a Nova ended clock");
    },
  });
  return {
    dataContext,
    runner,
    layers,
    patches,
    endCalls,
    holdPlayingPatch() { holdPlaying = true; },
    playingWasHeld: () => playingHeld,
    releasePlayingPatch() { releasePlaying?.(); },
  };
}

function expectFullStoryIdle(harness) {
  const clock = harness.dataContext.getInvestigationClock();
  const enabled = harness.layers.at(-1);
  expect(enabled).toEqual([...catalog.TIMELINE_LAYER_IDS]);
  expect(clock.phase).toBe("idle");
  expect(harness.endCalls).toEqual([]);
  expect(harness.patches.filter((patch) => patch.phase === "playing")).toEqual([]);
  expect(harness.dataContext.narrativeId).toBeNull();
  expect(harness.dataContext.escape).toEqual(NO_ESCAPE);
  const frame = fullStoryFrame(clock, enabled);
  expect(frame.narrative).toMatchObject({ phase: "idle", advances: false, activeBeat: null });
  expect(frame.achievedPolygonBeats).toEqual(STORY_BEATS);
  expect(frame.alarmOnset).toBeNull();
  expect(enabled).toEqual(expect.arrayContaining([INVESTIGATION_LINES_FULL_ID, INVESTIGATION_ALARMS_FULL_ID]));
  expect(idleLineFrame().completedRouteFlow.active).toBe(true);
}

describe("direct timeline complete story", () => {
  afterEach(() => {
    delete globalThis.OTEFDataContext;
  });

  test("entering timeline-complete from an unfinished rest-of-day shows the full idle story", async () => {
    const complete = catalog.TIMELINE?.steps?.find((step) => step.id === "timeline-complete");
    expect(complete?.cue).toEqual({
      narrative: null,
      layers: catalog.TIMELINE_LAYER_IDS,
      clock: "idle",
      escape: {},
    });
    expect(complete?.kit).toEqual([]);
    const unfinished = playNliClock(idleNliClock(), [...NLI_PLAYABLE_IDS], [410, 740], 40_000, {
      leadInMinutes: 402,
    });
    const harness = installSceneHarness(unfinished);
    await expect(harness.runner.apply(complete.cue, null)).resolves.toEqual({ status: "ready" });
    expectFullStoryIdle(harness);
  });

  test("entering timeline-complete stops a paused or looping clock without playing or ending Nova", async () => {
    const complete = catalog.TIMELINE.steps.find((step) => step.id === "timeline-complete");
    const started = playNliClock(idleNliClock(), [...NLI_PLAYABLE_IDS], STORY_BEATS, 40_000);
    const paused = pauseNliClock(started, 48_000);
    const looping = setNliLoop(playNliClock(idleNliClock(), [...NLI_PLAYABLE_IDS], STORY_BEATS, 40_000), true);
    for (const prior of [paused, looping]) {
      const harness = installSceneHarness(prior);
      await expect(harness.runner.apply(complete.cue, null)).resolves.toEqual({ status: "ready" });
      expectFullStoryIdle(harness);
    }
  });

  test("a stale opening-minutes start does not restart after timeline-complete", async () => {
    const minutes = catalog.SHOW.steps.find((step) => step.id === "opening-minutes");
    const complete = catalog.TIMELINE.steps.find((step) => step.id === "timeline-complete");
    const harness = installSceneHarness(idleNliClock());
    harness.holdPlayingPatch();
    const pendingStart = harness.runner.apply(minutes.cue, null);
    await vi.waitFor(() => expect(harness.playingWasHeld()).toBe(true));
    const pendingComplete = harness.runner.apply(complete.cue, null);
    harness.releasePlayingPatch();
    await expect(pendingStart).resolves.toEqual({ status: "cancelled" });
    await expect(pendingComplete).resolves.toEqual({ status: "ready" });
    expectFullStoryIdle(harness);
    expect(harness.patches.filter((patch) => patch.phase === "playing")).toEqual([]);
  });

  test("Back from the full story starts the rest of the day fresh, and Home clears to the Home cue", async () => {
    const timeline = catalog.TIMELINE;
    const complete = timeline.steps.find((step) => step.id === "timeline-complete");
    const rest = timeline.steps.find((step) => step.id === "rest-of-day");
    const harness = installSceneHarness(playNliClock(idleNliClock(), [...NLI_PLAYABLE_IDS], [410], 10_000));
    await harness.runner.apply(complete.cue, null);
    const restarted = await harness.runner.apply(rest.cue, null);
    expect(restarted).toEqual({ status: "ready" });
    const playing = harness.dataContext.getInvestigationClock();
    expect(playing).toMatchObject({ phase: "playing", leadInMinutes: 402, loop: false, positionMs: 0 });
    expect(playing.membership).toEqual([...NLI_PLAYABLE_IDS]);
    expect(playing.beats).toEqual(expect.arrayContaining([740]));
    expect(playing.beats.every((beat) => beat <= 401)).toBe(false);
    expect(nextAction({
      scriptId: "timeline",
      step: timeline.steps.indexOf(complete),
      returnTo: null,
    })).toEqual({ kind: "finish" });
    await expect(harness.runner.apply(catalog.HOME_CUE, null)).resolves.toEqual({ status: "ready" });
    expect(harness.layers.at(-1)).toEqual([...catalog.HOME_LAYER_IDS]);
    expect(harness.dataContext.getInvestigationClock().phase).toBe("idle");
    expect(harness.dataContext.escape).toEqual(NO_ESCAPE);
    expect(harness.dataContext.narrativeId).toBeNull();
    expect(harness.endCalls).toEqual([]);
    expect(harness.layers.at(-1).some((id) => NLI_PLAYABLE_IDS.includes(id))).toBe(false);
  });
});
