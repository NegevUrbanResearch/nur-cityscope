import { describe, expect, test } from "vitest";
import { SHOW, SHOW_STEP_IDS, NARRATIVES } from "../../frontend/src/remote/nli-staff-script.js";
import { createNliStaffNavigationSession } from "../../frontend/src/remote/nli-staff-navigation-session.js";

const identityStep = SHOW.steps.findIndex((step) => step.id === SHOW_STEP_IDS.IDENTITY);
const wallStep = SHOW.steps.findIndex((step) => step.id === SHOW_STEP_IDS.WALL);
const junction = (ids) => SHOW.steps.findIndex((step) => step.branch?.join() === ids.join());
const endOf = (id) => NARRATIVES.find((story) => story.id === id).steps.length - 1;
const ref = (scriptId, step, returnTo = null) => ({ scriptId, step, returnTo });
const identity = ref("show", identityStep);
const wall = ref("show", wallStep);
const sderotStart = ref("sderot", 0, { id: "show", step: junction(["sderot", "shura", "hostages"]) });
const shuraStart = ref("shura", 0, { id: "show", step: junction(["sderot", "shura", "hostages"]) });
const hostagesStart = ref("hostages", 0, { id: "show", step: junction(["sderot", "shura", "hostages"]) });

function succeed(session, target, intent) {
  const ticket = session.begin(target, intent);
  expect(session.complete(ticket)).toBe(true);
  return ticket;
}

describe("NLI staff navigation session", () => {
  test("does not abandon when there is no active ticket", () => {
    const session = createNliStaffNavigationSession();
    expect(session.abandon(null)).toBe(false);
    expect(session.getState().current).toBeNull();
  });

  test("identityShortcutDoesNotInventHistory", () => {
    const session = createNliStaffNavigationSession();
    succeed(session, identity, "entry");
    succeed(session, wall, "forward");

    expect(session.backTarget()).toEqual(identity);
    succeed(session, session.backTarget(), "back");
    expect(session.getState()).toMatchObject({ current: identity, backStack: [] });
    expect(session.backTarget()).toBeNull();
  });

  test("wallShortcutReturnsIdentityWithoutLoop", () => {
    const session = createNliStaffNavigationSession();
    succeed(session, wall, "entry");

    expect(session.backTarget()).toEqual(identity);
    succeed(session, session.backTarget(), "back");
    expect(session.getState()).toMatchObject({ current: identity, backStack: [] });
    expect(session.backTarget()).toBeNull();
  });

  test("backPopsActualStory", () => {
    const session = createNliStaffNavigationSession();
    const novaEnd = ref("nova", endOf("nova"), { id: "show", step: junction(["nova"]) });
    succeed(session, novaEnd, "entry");
    succeed(session, identity, "forward");

    expect(session.backTarget()).toEqual(novaEnd);
    succeed(session, session.backTarget(), "back");
    expect(session.getState().current).toEqual(novaEnd);
    expect(session.getState().backStack).toEqual([]);
  });

  test("wallBackPreservesUnrelatedHistory", () => {
    const session = createNliStaffNavigationSession();
    const prior = ref("show", 0);
    succeed(session, prior, "entry");
    succeed(session, wall, "forward");

    expect(session.backTarget()).toEqual(identity);
    succeed(session, session.backTarget(), "back");
    expect(session.getState().current).toEqual(identity);
    expect(session.getState().backStack).toEqual([prior]);
  });

  test("retryCommitsOnce", () => {
    const session = createNliStaffNavigationSession();
    const source = ref("show", 0);
    succeed(session, source, "entry");
    const target = ref("show", 2);
    const failedAttempt = session.begin(target, "forward");
    expect(session.getState().current).toEqual(source);
    expect(session.getState().backStack).toEqual([]);
    session.abandon(failedAttempt);
    const retry = session.begin(target, "forward");
    expect(session.complete(retry)).toBe(true);
    expect(session.complete(retry)).toBe(false);
    expect(session.getState().backStack).toEqual([source]);
    expect(session.getState().current).toEqual(target);
  });

  test("staleAndDuplicateCompletionDoNotCommit", () => {
    const session = createNliStaffNavigationSession();
    const source = ref("show", 0);
    const first = session.begin(source, "entry");
    const secondTarget = ref("show", 2);
    const second = session.begin(secondTarget, "entry");

    expect(session.complete(first)).toBe(false);
    expect(session.getState()).toMatchObject({ current: null, backStack: [], visitedScenes: [] });
    expect(session.complete(second)).toBe(true);
    expect(session.complete(second)).toBe(false);
    expect(session.getState().current).toEqual(secondTarget);
    expect(session.getState().visitedScenes).toEqual([secondTarget]);
  });

  test("pendingAndFailedRecoveryReappliesWithoutPop", () => {
    const session = createNliStaffNavigationSession();
    const first = ref("show", 0);
    const second = ref("show", 2);
    succeed(session, first, "entry");
    succeed(session, second, "forward");
    const pending = session.begin(identity, "forward");
    expect(session.backTarget({ recoverCurrent: true })).toEqual(second);
    const recovery = session.begin(session.backTarget({ recoverCurrent: true }), "reapply");
    expect(session.complete(pending)).toBe(false);
    expect(session.complete(recovery)).toBe(true);
    expect(session.getState()).toMatchObject({ current: second, backStack: [first] });

    const failed = session.begin(identity, "forward");
    session.abandon(failed);
    const failedRecovery = session.begin(session.backTarget({ recoverCurrent: true }), "reapply");
    expect(session.complete(failedRecovery)).toBe(true);
    expect(session.getState()).toMatchObject({ current: second, backStack: [first] });
  });

  test("immediateOneSceneRepeatDoesNotDuplicateBack", () => {
    const session = createNliStaffNavigationSession();
    succeed(session, sderotStart, "entry");
    succeed(session, sderotStart, "forward");

    expect(session.getState().backStack).toEqual([]);
    expect(session.getState().visitedScenes).toEqual([sderotStart]);
    expect(session.getState().visitedStoryIds).toEqual(["sderot"]);
  });

  test("nextAfterBackStillUsesAuthoredOrder", () => {
    const session = createNliStaffNavigationSession();
    const first = ref("show", 0);
    const next = ref("show", 2);
    succeed(session, first, "entry");
    succeed(session, next, "forward");
    succeed(session, session.backTarget(), "back");
    succeed(session, next, "forward");

    expect(session.getState()).toMatchObject({ current: next, backStack: [first] });
  });

  test("visitedScenesSurviveBack", () => {
    const session = createNliStaffNavigationSession();
    const first = ref("show", 0);
    const second = ref("show", 2);
    succeed(session, first, "entry");
    succeed(session, second, "forward");
    succeed(session, session.backTarget(), "back");

    expect(session.getState().visitedScenes).toEqual([first, second]);
  });

  test("homeClearsOnlyOnSuccess", () => {
    const session = createNliStaffNavigationSession();
    succeed(session, sderotStart, "entry");
    const failedHome = session.begin(null, "home");
    expect(session.getState().visitedStoryIds).toEqual(["sderot"]);
    session.abandon(failedHome);
    expect(session.getState().current).toEqual(sderotStart);

    const home = session.begin(null, "home");
    expect(session.complete(home)).toBe(true);
    expect(session.getState()).toEqual({ current: null, backStack: [], visitedStoryIds: [], visitedScenes: [] });
  });

  test("arbitraryStoryOrderAndSkippedSceneJumpKeepActualHistory", () => {
    const session = createNliStaffNavigationSession();
    const source = ref("nova", endOf("nova"), { id: "show", step: junction(["nova"]) });
    const sderotEnd = ref("sderot", endOf("sderot"), sderotStart.returnTo);
    const shuraEnd = ref("shura", endOf("shura"), shuraStart.returnTo);
    const hostagesEnd = ref("hostages", endOf("hostages"), hostagesStart.returnTo);
    const hostagesScene = ref("hostages", 2, hostagesStart.returnTo);
    succeed(session, source, "entry");
    succeed(session, sderotStart, "jump");
    succeed(session, sderotEnd, "forward");
    succeed(session, shuraStart, "jump");
    succeed(session, shuraEnd, "forward");
    succeed(session, hostagesStart, "jump");
    succeed(session, hostagesScene, "jump");
    succeed(session, hostagesEnd, "jump");
    succeed(session, hostagesStart, "jump");

    expect(session.getState().backStack).toEqual([source, sderotStart, shuraStart, hostagesStart, hostagesScene, hostagesEnd]);
    expect(session.getState().visitedStoryIds).toEqual(["sderot", "shura", "hostages"]);
    expect(session.getState().visitedScenes).toEqual([source, sderotStart, shuraStart, hostagesStart, hostagesScene, hostagesEnd]);
    expect(session.getState().visitedScenes).not.toContain(ref("hostages", 1, hostagesStart.returnTo));
    expect(new Set(session.getState().visitedStoryIds).size).toBe(3);
  });

  test("stateSnapshotsAreImmutableAndDoNotExposeInternalRefs", () => {
    const session = createNliStaffNavigationSession();
    const target = ref("show", 0);
    succeed(session, target, "entry");
    const state = session.getState();
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.current)).toBe(true);
    expect(Object.isFrozen(state.visitedScenes)).toBe(true);
    expect(() => { state.current.step = 1; }).toThrow();
    expect(session.getState().current).toEqual(target);
  });

  test("rejectsJunctionAndUnknownSceneTargets", () => {
    const session = createNliStaffNavigationSession();
    const showJunction = ref("show", junction(["sderot", "shura", "hostages"]));
    expect(() => session.begin(showJunction, "entry")).toThrow();
    expect(() => session.begin(ref("missing", 0), "entry")).toThrow();
    expect(session.getState()).toEqual({ current: null, backStack: [], visitedStoryIds: [], visitedScenes: [] });
  });
});
