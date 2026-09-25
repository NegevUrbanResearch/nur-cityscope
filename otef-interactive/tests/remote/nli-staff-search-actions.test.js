import { describe, expect, test, vi } from "vitest";
import { createNliStaffSearchTransition } from "../../frontend/src/remote/nli-staff-search-transition.js";

async function staffActions() {
  const remote = await import("../../frontend/src/remote/nli-staff-remote.js");
  expect(remote.createNliStaffSearchEventHandlers).toBeTypeOf("function");
  return remote.createNliStaffSearchEventHandlers;
}

async function placeFocusOwnership() {
  const remote = await import("../../frontend/src/remote/nli-staff-remote.js");
  expect(remote.createNliStaffPlaceFocusOwnership).toBeTypeOf("function");
  return remote.createNliStaffPlaceFocusOwnership;
}

function stateFixture(overrides = {}) {
  const state = {
    step: 4,
    searchPending: false,
    searchValue: "Ada",
    acknowledgedPerson: { name: "Ada" },
    placeName: null,
    error: null,
    controlsDisabled: false,
    ...overrides,
  };
  return {
    state,
    options: {
      setPending(value) { state.searchPending = value; },
      renderPending() { state.controlsDisabled = state.searchPending; },
      restoreLiveSearchLabel() { state.searchValue = state.acknowledgedPerson?.name || state.placeName || ""; },
      showClearFailed() { state.error = "clear failed"; },
      clearSearchUi() { state.searchValue = ""; },
      setDestination(_item, index) { state.step = index; },
      renderDestination() {},
      applyCue: vi.fn(),
    },
  };
}

describe("NLI staff search event handlers", () => {
  test("disables conflicting controls while a step reset is pending", async () => {
    let releaseClear;
    const transition = createNliStaffSearchTransition({
      clearPersonSelection: () => new Promise((resolve) => { releaseClear = resolve; }),
      hasPlaceFocus: () => false,
    });
    const fixture = stateFixture();
    const createHandlers = await staffActions();
    const handlers = createHandlers({ transition, ...fixture.options });
    const task = handlers.transitionToStep({ id: "show", steps: [{ cue: {} }] }, 0);
    expect(fixture.state.controlsDisabled).toBe(true);
    releaseClear(true);
    await expect(task).resolves.toBe(true);
    expect(fixture.state.controlsDisabled).toBe(false);
  });

  test("keeps the current step and restores the live label after a failed reset", async () => {
    const transition = createNliStaffSearchTransition({
      clearPersonSelection: async () => false,
      hasPlaceFocus: () => false,
    });
    const fixture = stateFixture();
    const createHandlers = await staffActions();
    const handlers = createHandlers({ transition, ...fixture.options });
    await expect(handlers.transitionToStep({ id: "show", steps: [{ cue: {} }] }, 0)).resolves.toBe(false);
    expect(fixture.state.step).toBe(4);
    expect(fixture.state.searchValue).toBe("Ada");
    expect(fixture.state.error).toBe("clear failed");
    expect(fixture.state.controlsDisabled).toBe(false);
  });

  test("ignores a stale step reset after a newer transition supersedes it", async () => {
    const releases = [];
    const transition = createNliStaffSearchTransition({
      clearPersonSelection: () => new Promise((resolve) => { releases.push(resolve); }),
      hasPlaceFocus: () => false,
    });
    const fixture = stateFixture();
    const clearSearchUi = vi.fn(fixture.options.clearSearchUi);
    const setDestination = vi.fn(fixture.options.setDestination);
    const renderDestination = vi.fn();
    const applyDestinationCue = vi.fn();
    const createHandlers = await staffActions();
    const handlers = createHandlers({
      transition,
      ...fixture.options,
      clearSearchUi,
      setDestination,
      renderDestination,
      applyDestinationCue,
    });

    const staleItem = { id: "show", steps: [{ cue: "stale" }] };
    const currentItem = { id: "show", steps: [{ cue: "current" }] };
    const staleTask = handlers.transitionToStep(staleItem, 1);
    const currentTask = handlers.transitionToStep(currentItem, 2);
    expect(releases).toHaveLength(2);
    releases[0](true);
    await expect(staleTask).resolves.toBe(false);
    expect(fixture.state.step).toBe(4);
    expect(clearSearchUi).not.toHaveBeenCalled();
    expect(setDestination).not.toHaveBeenCalled();
    expect(renderDestination).not.toHaveBeenCalled();
    expect(applyDestinationCue).not.toHaveBeenCalled();

    releases[1](true);
    await expect(currentTask).resolves.toBe(true);
    expect(fixture.state.step).toBe(2);
    expect(clearSearchUi).toHaveBeenCalledOnce();
    expect(setDestination).toHaveBeenCalledOnce();
    expect(setDestination).toHaveBeenCalledWith(currentItem, 2, undefined);
    expect(renderDestination).toHaveBeenCalledOnce();
    expect(applyDestinationCue).toHaveBeenCalledOnce();
    expect(applyDestinationCue).toHaveBeenCalledWith(currentItem, 2);
  });

  test("restores a live place label if person clear succeeds but place clear fails", async () => {
    const fixture = stateFixture({ placeName: "Be'eri" });
    const cancelPlaceFocus = vi.fn(async () => ({ ok: false }));
    const transition = createNliStaffSearchTransition({
      clearPersonSelection: async () => {
        fixture.state.acknowledgedPerson = null;
        return true;
      },
      cancelPlaceFocus,
      hasPlaceFocus: () => Boolean(fixture.state.placeName),
    });
    const createHandlers = await staffActions();
    const handlers = createHandlers({ transition, ...fixture.options });

    await expect(handlers.transitionToStep({ id: "show", steps: [{ cue: {} }] }, 0)).resolves.toBe(false);
    expect(fixture.state.acknowledgedPerson).toBeNull();
    expect(fixture.state.placeName).toBe("Be'eri");
    expect(fixture.state.searchValue).toBe("Be'eri");
    expect(fixture.state.step).toBe(4);
    expect(fixture.state.error).toBe("clear failed");
    expect(cancelPlaceFocus).toHaveBeenCalledOnce();
  });

  test("does not select a person until place-focus cancellation is acknowledged", async () => {
    let releaseClear;
    const transition = createNliStaffSearchTransition({
      clearPersonSelection: async () => true,
      cancelPlaceFocus: () => new Promise((resolve) => { releaseClear = resolve; }),
      hasPlaceFocus: () => true,
    });
    const fixture = stateFixture();
    const createHandlers = await staffActions();
    const handlers = createHandlers({ transition, ...fixture.options });
    const performSelection = vi.fn(async () => true);
    const task = handlers.selectPerson({ pid: "11" }, performSelection);
    expect(performSelection).not.toHaveBeenCalled();
    releaseClear({ status: "ok" });
    await expect(task).resolves.toBe(true);
    expect(performSelection).toHaveBeenCalledOnce();
  });

  test("does not navigate to a place until person clearing is acknowledged", async () => {
    let releaseClear;
    const transition = createNliStaffSearchTransition({
      clearPersonSelection: () => new Promise((resolve) => { releaseClear = resolve; }),
      hasPlaceFocus: () => false,
    });
    const fixture = stateFixture();
    const createHandlers = await staffActions();
    const handlers = createHandlers({ transition, ...fixture.options });
    const performNavigation = vi.fn(async () => true);
    const task = handlers.selectPlace({ id: "beeri" }, performNavigation);
    expect(performNavigation).not.toHaveBeenCalled();
    releaseClear(true);
    await expect(task).resolves.toBe(true);
    expect(performNavigation).toHaveBeenCalledOnce();
  });

  test("Home waits for pending place navigation, cancels its focus, and ignores its stale completion", async () => {
    let releaseNavigation;
    let pendingPlaceNavigation = null;
    const calls = [];
    const transition = createNliStaffSearchTransition({
      clearPersonSelection: async () => true,
      waitForPlaceNavigation: async () => { await pendingPlaceNavigation; },
      cancelPlaceFocus: async () => { calls.push("cancel"); return { ok: true }; },
      hasPlaceFocus: () => Boolean(pendingPlaceNavigation),
    });
    const fixture = stateFixture({ placeName: null });
    const clearSearchUi = vi.fn(fixture.options.clearSearchUi);
    const setDestination = vi.fn(fixture.options.setDestination);
    const createHandlers = await staffActions();
    const handlers = createHandlers({ transition, ...fixture.options, clearSearchUi, setDestination });
    const navigation = new Promise((resolve) => { releaseNavigation = resolve; });
    let signalNavigationStarted;
    const navigationStarted = new Promise((resolve) => { signalNavigationStarted = resolve; });
    const placeTask = handlers.selectPlace({ id: "beeri" }, async () => {
      pendingPlaceNavigation = navigation.then(() => { calls.push("navigation-complete"); });
      signalNavigationStarted();
      await pendingPlaceNavigation;
      return true;
    });

    await navigationStarted;
    const homeTask = handlers.transitionToStep({ id: "home", steps: [{ cue: {} }] }, 0);
    let homeSettled = false;
    void homeTask.then(() => { homeSettled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(homeSettled).toBe(false);
    expect(calls).toEqual([]);
    expect(clearSearchUi).not.toHaveBeenCalled();

    releaseNavigation();
    await expect(placeTask).resolves.toBe(false);
    await expect(homeTask).resolves.toBe(true);
    expect(calls).toEqual(["navigation-complete", "cancel"]);
    expect(clearSearchUi).toHaveBeenCalledOnce();
    expect(setDestination).toHaveBeenCalledOnce();
    expect(fixture.state.searchValue).toBe("");
  });

  test("restores a stale successful place focus label when Home cancellation fails", async () => {
    let releaseNavigation;
    let signalNavigationStarted;
    const createOwnership = await placeFocusOwnership();
    const ownership = createOwnership();
    const transition = createNliStaffSearchTransition({
      clearPersonSelection: async () => true,
      waitForPlaceNavigation: () => ownership.waitForNavigation(),
      cancelPlaceFocus: () => ownership.cancel(async () => ({ ok: false })),
      hasPlaceFocus: () => ownership.hasFocus(),
    });
    const fixture = stateFixture({ acknowledgedPerson: null, placeName: null });
    fixture.options.restoreLiveSearchLabel = () => { fixture.state.searchValue = ownership.getName() || ""; };
    const createHandlers = await staffActions();
    const handlers = createHandlers({ transition, ...fixture.options });
    const navigationStarted = new Promise((resolve) => { signalNavigationStarted = resolve; });
    const placeTask = handlers.selectPlace({ id: "beeri" }, async (_place, token) => {
      const request = ownership.start("Be'eri", () => new Promise((resolve) => {
        releaseNavigation = resolve;
        signalNavigationStarted();
      }));
      const result = await request.settled;
      if (!transition.isCurrent(token)) return false;
      fixture.state.placeName = request.name;
      return result.ok;
    });

    await navigationStarted;
    const homeTask = handlers.transitionToStep({ id: "home", steps: [{ cue: {} }] }, 0);
    releaseNavigation({ ok: true });
    await expect(placeTask).resolves.toBe(false);
    await expect(homeTask).resolves.toBe(false);
    expect(ownership.hasFocus()).toBe(true);
    expect(ownership.getName()).toBe("Be'eri");
    expect(fixture.state.searchValue).toBe("Be'eri");
    expect(fixture.state.searchValue).not.toBe("");
  });

  test("a rejected Home cancellation restores the label and does not poison the next place selection", async () => {
    const createOwnership = await placeFocusOwnership();
    const ownership = createOwnership();
    const existingRequest = ownership.start("Be'eri", async () => ({ ok: true }));
    await existingRequest.settled;
    let cancelCount = 0;
    const transition = createNliStaffSearchTransition({
      clearPersonSelection: async () => true,
      waitForPlaceNavigation: () => ownership.waitForNavigation(),
      cancelPlaceFocus: () => ownership.cancel(async () => {
        cancelCount += 1;
        if (cancelCount === 1) throw new Error("cancel failed");
        return { ok: true };
      }),
      hasPlaceFocus: () => ownership.hasFocus(),
    });
    const fixture = stateFixture({ acknowledgedPerson: null, placeName: "Be'eri" });
    fixture.options.restoreLiveSearchLabel = () => { fixture.state.searchValue = ownership.getName() || ""; };
    const createHandlers = await staffActions();
    const handlers = createHandlers({ transition, ...fixture.options });

    await expect(handlers.transitionToStep({ id: "home", steps: [{ cue: {} }] }, 0)).resolves.toBe(false);
    expect(fixture.state.searchValue).toBe("Be'eri");
    expect(fixture.state.error).toBe("clear failed");
    expect(fixture.state.controlsDisabled).toBe(false);

    const navigate = vi.fn(async () => ({ ok: true }));
    const placeTask = handlers.selectPlace({ id: "nir-oz" }, async (place) => {
      const request = ownership.start(place.id, () => navigate(place));
      const result = await request.settled;
      fixture.state.placeName = request.name;
      return result.ok;
    });
    await expect(placeTask).resolves.toBe(true);
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith({ id: "nir-oz" });
  });

  test("serializes stale cancellations so an older acknowledgment cannot erase a newer request", async () => {
    const createOwnership = await placeFocusOwnership();
    const ownership = createOwnership();
    const firstNavigation = ownership.start("Be'eri", async () => ({ ok: true }));
    await firstNavigation.settled;
    const cancelReleases = [];
    const cancelStarts = [];
    const cancelFocus = () => new Promise((resolve) => {
      cancelReleases.push(resolve);
      cancelStarts[cancelReleases.length - 1]?.();
    });
    const firstCancelStarted = new Promise((resolve) => { cancelStarts[0] = resolve; });
    const secondCancelStarted = new Promise((resolve) => { cancelStarts[1] = resolve; });
    const firstCancel = ownership.cancel(cancelFocus);
    const secondCancel = ownership.cancel(cancelFocus);
    await firstCancelStarted;
    expect(cancelReleases).toHaveLength(1);

    let releaseNewNavigation;
    let signalNewNavigationStarted;
    const newNavigationStarted = new Promise((resolve) => { signalNewNavigationStarted = resolve; });
    const newRequest = ownership.start("Nir Oz", () => new Promise((resolve) => {
      releaseNewNavigation = resolve;
      signalNewNavigationStarted();
    }));
    expect(ownership.getName()).toBe("Nir Oz");
    expect(cancelReleases).toHaveLength(1);

    cancelReleases[0]({ ok: true });
    await firstCancel;
    await secondCancelStarted;
    expect(cancelReleases).toHaveLength(2);
    expect(ownership.getName()).toBe("Nir Oz");
    cancelReleases[1]({ ok: true });
    await secondCancel;
    await newNavigationStarted;
    expect(ownership.getName()).toBe("Nir Oz");

    let thirdCancelStarted;
    const thirdCancelStartedPromise = new Promise((resolve) => { thirdCancelStarted = resolve; });
    let releaseThirdCancel;
    const laterHome = (async () => {
      await ownership.waitForNavigation();
      return ownership.cancel(() => new Promise((resolve) => {
        thirdCancelStarted();
        releaseThirdCancel = resolve;
      }));
    })();
    await Promise.resolve();
    expect(releaseThirdCancel).toBeUndefined();
    releaseNewNavigation({ ok: true });
    await thirdCancelStartedPromise;
    expect(ownership.getName()).toBe("Nir Oz");
    releaseThirdCancel({ ok: true });
    await laterHome;
    expect(ownership.hasFocus()).toBe(false);
  });

  test("cancels the running cue before beginning focus cleanup", async () => {
    const calls = [];
    const transition = createNliStaffSearchTransition({
      clearPersonSelection: async () => { calls.push("cleanup"); return true; },
      hasPlaceFocus: () => false,
    });
    const fixture = stateFixture();
    const createHandlers = await staffActions();
    const handlers = createHandlers({
      transition,
      cancelCues: () => calls.push("cancel-cue"),
      ...fixture.options,
    });
    await handlers.transitionToStep({ id: "show", steps: [{ cue: {} }] }, 0);
    expect(calls).toEqual(["cancel-cue", "cleanup"]);
  });
});
