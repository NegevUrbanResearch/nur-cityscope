/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createNliStaffNavigationSession } from "../../frontend/src/remote/nli-staff-navigation-session.js";
import { SHOW, SHOW_STEP_IDS } from "../../frontend/src/remote/nli-staff-script.js";
import { showStepIndex } from "../../frontend/src/remote/nli-staff-flow.js";
import { setLocale } from "../../frontend/src/remote/remote-locale.js";

function harness() {
  document.body.innerHTML = readFileSync("frontend/nli-staff-remote.html", "utf8");
  const listeners = new Map();
  const h = {
    narrative: { id: null, transition: "steady", revision: 0 },
    person: { personId: null, datasetVersion: null, revision: 0 },
    clock: { phase: "idle", membership: [], beats: [], loop: false, positionMs: 0, anchorMs: null, seekKind: "none", revision: 1, serverNowMs: Date.now() },
    layers: [],
    commands: [],
    failNarrativeOnce: false,
    failClear: false,
    presentationHandler: null,
    dataContext: null,
    emit(topic, value) { for (const listener of listeners.get(topic) || []) listener(value); },
  };
  h.dataContext = {
    isConnected: () => false,
    getNarrativeState: () => h.narrative,
    getPersonSelection: () => h.person,
    getInvestigationClock: () => h.clock,
    getEscapeOverlay: () => ({ individual: false, overlap: false, mor: false, settled: false }),
    getLayerGroups: () => h.layers.map((id) => {
      const split = id.indexOf(".");
      return { id: id.slice(0, split), layers: [{ id: id.slice(split + 1), enabled: true }] };
    }),
    getLegendSettings: () => ({ language: "en" }),
    setExhibitMode: () => {},
    async setNarrative(id) {
      if (h.failNarrativeOnce) { h.failNarrativeOnce = false; return { ok: false }; }
      h.narrative = { id, transition: id === null ? "exit" : "enter", revision: h.narrative.revision + 1 };
      return { ok: true };
    },
    async setEnabledLayerIds(ids) { h.layers = [...ids]; return { ok: true }; },
    async setEscapeOverlay() { return { ok: true }; },
    async patchInvestigationClock(next) {
      h.clock = { ...next, revision: h.clock.revision + 1, serverNowMs: Date.now() };
      return { ok: true, clock: h.clock };
    },
    async clearPerson() {
      if (h.failClear) return h.person;
      h.person = { personId: null, datasetVersion: null, revision: h.person.revision + 1 };
      return h.person;
    },
    archiveWindowCommand: async () => ({ acknowledged: true }),
    async narrativePresentationCommand(command) {
      h.commands.push(command);
      if (h.presentationHandler) return h.presentationHandler(command, h);
      queueMicrotask(() => h.emit("narrativePresentationResult", {
        ...command,
        outcome: command.presentationAction === "close" ? "closed" : "opened",
        slide: 1,
        range: [1, 1],
      }));
      return { status: "ok" };
    },
    subscribe(topic, listener) {
      const list = listeners.get(topic) || [];
      list.push(listener);
      listeners.set(topic, list);
      return () => listeners.set(topic, (listeners.get(topic) || []).filter((fn) => fn !== listener));
    },
  };
  return h;
}

function observeNavigationSession() {
  const session = createNliStaffNavigationSession();
  const calls = { begins: [], completes: [], abandons: [] };
  return {
    calls,
    api: {
      getState: () => session.getState(),
      backTarget: (options) => session.backTarget(options),
      begin(...args) {
        const ticket = session.begin(...args);
        calls.begins.push(ticket);
        return ticket;
      },
      complete(ticket) {
        const accepted = session.complete(ticket);
        calls.completes.push({ ticket, accepted });
        return accepted;
      },
      abandon(ticket) {
        const accepted = session.abandon(ticket);
        calls.abandons.push({ ticket, accepted });
        return accepted;
      },
    },
  };
}

const el = (id) => document.getElementById(id);

describe("NLI remote navigation lifecycle", () => {
  let h;
  let remote;
  let navigation;
  let navigationCalls;

  beforeEach(async () => {
    vi.resetModules();
    setLocale("en", { persist: false });
    h = harness();
    ({ api: navigation, calls: navigationCalls } = observeNavigationSession());
    const { initNliStaffRemote } = await import("../../frontend/src/remote/nli-staff-remote.js");
    remote = initNliStaffRemote(h.dataContext, { navigationSession: navigation });
  });

  afterEach(() => {
    remote?.dispose();
    remote = null;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  async function openShortcut(stepId) {
    el("narrativeList").querySelector(`[data-show-step="${stepId}"]`).click();
    const index = showStepIndex(stepId);
    await vi.waitFor(() => expect(navigation.getState().current).toMatchObject({ scriptId: SHOW.id, step: index }));
  }

  function expectShowStep(stepId) {
    const step = SHOW.steps[showStepIndex(stepId)];
    expect([step.title.he, step.title.en]).toContain(el("stepTitle").textContent);
  }

  test("a cue failure after destination publication leaves the prior scene committed", async () => {
    await openShortcut(SHOW_STEP_IDS.IDENTITY);
    // Fail after setDestination has published the attempted Wall destination.
    h.failNarrativeOnce = true;
    el("nextBtn").click();
    await vi.waitFor(() => expectShowStep(SHOW_STEP_IDS.WALL));
    await vi.waitFor(() => expect(el("playerCueFailure").hidden).toBe(false));
    expect(navigation.getState().current).toMatchObject({ scriptId: "show", step: showStepIndex(SHOW_STEP_IDS.IDENTITY) });
    expect(navigation.getState().visitedScenes).toHaveLength(1);
  });

  test("a failed cleanup before publication keeps the source and Retry commits once", async () => {
    await openShortcut(SHOW_STEP_IDS.IDENTITY);
    h.person = { personId: "11", datasetVersion: "v1", revision: 1, name: "Ada" };
    h.emit("personSelection", h.person);
    h.failClear = true;
    el("nextBtn").click();
    await vi.waitFor(() => expect(el("playerCueFailure").hidden).toBe(false));
    expectShowStep(SHOW_STEP_IDS.IDENTITY);
    expect(navigation.getState().current).toMatchObject({ scriptId: "show", step: showStepIndex(SHOW_STEP_IDS.IDENTITY) });

    h.failClear = false;
    el("playerCueRetry").click();
    await vi.waitFor(() => expect(navigation.getState().current?.step).toBe(showStepIndex(SHOW_STEP_IDS.WALL)));
    expect(navigation.getState().backStack).toHaveLength(1);
    expect(navigation.getState().visitedScenes).toHaveLength(2);
  });

  test("Back is enabled to recover the first committed Identity scene during pending Wall", async () => {
    await openShortcut(SHOW_STEP_IDS.IDENTITY);
    expect(navigation.getState().backStack).toHaveLength(0);
    let releaseWall;
    h.presentationHandler = (command, host) => {
      if (command.segmentId === "names_wall") return new Promise((resolve) => {
        releaseWall = () => {
          host.emit("narrativePresentationResult", { ...command, outcome: "opened", slide: 1, range: [1, 1] });
          resolve({ status: "ok" });
        };
      });
      queueMicrotask(() => host.emit("narrativePresentationResult", {
        ...command,
        outcome: command.presentationAction === "close" ? "closed" : "opened",
        slide: 1,
        range: [1, 1],
      }));
      return Promise.resolve({ status: "ok" });
    };
    const beginsBeforePending = navigationCalls.begins.length;
    el("nextBtn").click();
    await vi.waitFor(() => expectShowStep(SHOW_STEP_IDS.WALL));
    await vi.waitFor(() => expect(releaseWall).toBeTypeOf("function"));
    const pendingTicket = navigationCalls.begins.slice(beginsBeforePending).at(-1);
    expect(pendingTicket.target).toMatchObject({ scriptId: "show", step: showStepIndex(SHOW_STEP_IDS.WALL) });
    expect(el("prevBtn").disabled).toBe(false);
    el("prevBtn").click();
    await vi.waitFor(() => expectShowStep(SHOW_STEP_IDS.IDENTITY));
    const recoveryTicket = navigationCalls.begins.at(-1);
    expect(recoveryTicket.intent).toBe("reapply");
    expect(recoveryTicket.target).toMatchObject({ scriptId: "show", step: showStepIndex(SHOW_STEP_IDS.IDENTITY) });
    await vi.waitFor(() => expect(navigationCalls.completes.some((call) => call.ticket === recoveryTicket && call.accepted)).toBe(true));
    expect(navigation.getState().backStack).toHaveLength(0);
    expect(navigationCalls.completes.filter((call) => call.ticket === recoveryTicket && call.accepted)).toHaveLength(1);
    expect(navigationCalls.completes.some((call) => call.ticket === pendingTicket)).toBe(false);
    releaseWall();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigation.getState().current).toMatchObject({ scriptId: "show", step: showStepIndex(SHOW_STEP_IDS.IDENTITY) });
    expect(navigationCalls.completes.some((call) => call.ticket === pendingTicket)).toBe(false);
  });

  test("Back re-applies the committed source while an ordinary destination cue is pending", async () => {
    el("narrativeList").querySelector('[data-open="nova"]').click();
    await vi.waitFor(() => expect(navigation.getState().current).toMatchObject({ scriptId: "nova", step: 0 }));
    el("ticks").querySelector('[data-step="2"]').click();
    await vi.waitFor(() => expect(navigation.getState().current).toMatchObject({ scriptId: "nova", step: 2 }));
    const committed = navigation.getState();
    expect(committed.backStack).toHaveLength(1);
    const beginsBeforePending = navigationCalls.begins.length;
    let releaseDestination;
    h.presentationHandler = (command, host) => {
      if (command.segmentId === "nova_mor") return new Promise((resolve) => {
        releaseDestination = () => {
          host.emit("narrativePresentationResult", { ...command, outcome: "opened", slide: 1, range: [1, 1] });
          resolve({ status: "ok" });
        };
      });
      queueMicrotask(() => host.emit("narrativePresentationResult", {
        ...command,
        outcome: command.presentationAction === "close" ? "closed" : "opened",
        slide: 1,
        range: [1, 1],
      }));
      return Promise.resolve({ status: "ok" });
    };
    el("ticks").querySelector('[data-step="3"]').click();
    await vi.waitFor(() => expect(el("stepTitle").textContent).toBe("מור לוי"));
    await vi.waitFor(() => expect(releaseDestination).toBeTypeOf("function"));
    const pendingTicket = navigationCalls.begins.slice(beginsBeforePending).find((ticket) => ticket.target?.step === 3);
    expect(pendingTicket).toBeTruthy();
    expect(el("prevBtn").disabled).toBe(false);
    el("prevBtn").click();
    await vi.waitFor(() => expect(["Escape routes", "מסלולי הבריחה"]).toContain(el("stepTitle").textContent));
    const recoveryTicket = navigationCalls.begins.at(-1);
    expect(recoveryTicket).not.toBe(pendingTicket);
    expect(recoveryTicket.intent).toBe("reapply");
    expect(recoveryTicket.target).toMatchObject({ scriptId: "nova", step: 2 });
    await vi.waitFor(() => expect(navigationCalls.completes.some((call) => call.ticket === recoveryTicket && call.accepted)).toBe(true));
    expect(navigation.getState().current).toEqual(committed.current);
    expect(navigation.getState().backStack).toEqual(committed.backStack);
    expect(navigationCalls.completes.filter((call) => call.ticket === recoveryTicket && call.accepted)).toHaveLength(1);
    expect(navigationCalls.completes.some((call) => call.ticket === pendingTicket)).toBe(false);
    releaseDestination();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigation.getState().current).toEqual(committed.current);
    expect(navigation.getState().backStack).toEqual(committed.backStack);
    expect(navigationCalls.completes.filter((call) => call.ticket === recoveryTicket && call.accepted)).toHaveLength(1);
    expect(navigationCalls.completes.some((call) => call.ticket === pendingTicket)).toBe(false);
  });

  test("Wall to pending Credits to Back restores Wall immediately", async () => {
    await openShortcut(SHOW_STEP_IDS.IDENTITY);
    el("nextBtn").click();
    await vi.waitFor(() => expect(navigation.getState().current?.step).toBe(showStepIndex(SHOW_STEP_IDS.WALL)));
    let releaseCredits;
    h.presentationHandler = (command, host) => {
      if (command.segmentId === "credits") return new Promise((resolve) => {
        releaseCredits = () => {
        host.emit("narrativePresentationResult", { ...command, outcome: "opened", slide: 1, range: [1, 1] });
        resolve({ status: "ok" });
        };
      });
      queueMicrotask(() => host.emit("narrativePresentationResult", {
        ...command,
        outcome: command.presentationAction === "close" ? "closed" : "opened",
        slide: 1,
        range: [1, 1],
      }));
      return Promise.resolve({ status: "ok" });
    };
    el("nextBtn").click();
    await vi.waitFor(() => expectShowStep("credits"));
    await vi.waitFor(() => expect(releaseCredits).toBeTypeOf("function"));
    const pendingTicket = navigationCalls.begins.at(-1);
    const wallOpenCount = h.commands.filter((command) => command.segmentId === "names_wall" && command.presentationAction === "open").length;
    const beginsBeforeRecovery = navigationCalls.begins.length;
    expect(el("prevBtn").disabled).toBe(false);
    el("prevBtn").click();
    await vi.waitFor(() => expect(navigationCalls.begins.length).toBeGreaterThan(beginsBeforeRecovery));
    const recoveryTicket = navigationCalls.begins.at(-1);
    expect(recoveryTicket).not.toBe(pendingTicket);
    expect(recoveryTicket.intent).toBe("reapply");
    expect(recoveryTicket.target).toMatchObject({ scriptId: "show", step: showStepIndex(SHOW_STEP_IDS.WALL) });
    await vi.waitFor(() => expectShowStep(SHOW_STEP_IDS.WALL));
    await vi.waitFor(() => expect(h.commands.filter((command) => command.segmentId === "names_wall" && command.presentationAction === "open").length).toBeGreaterThan(wallOpenCount));
    await vi.waitFor(() => expect(navigationCalls.completes.some((call) => call.ticket === recoveryTicket && call.accepted)).toBe(true));
    expect(navigation.getState().current?.step).toBe(showStepIndex(SHOW_STEP_IDS.WALL));
    expect(navigation.getState().backStack).toHaveLength(1);
    expect(navigationCalls.completes.filter((call) => call.ticket === recoveryTicket && call.accepted)).toHaveLength(1);
    releaseCredits();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigation.getState().current).toMatchObject({ scriptId: "show", step: showStepIndex(SHOW_STEP_IDS.WALL) });
    expect(navigation.getState().backStack).toHaveLength(1);
    expect(navigationCalls.completes.filter((call) => call.ticket === recoveryTicket && call.accepted)).toHaveLength(1);
    expect(navigationCalls.completes.some((call) => call.ticket === pendingTicket)).toBe(false);
    const beginsBeforeIdentityBack = navigationCalls.begins.length;
    expect(el("prevBtn").disabled).toBe(false);
    el("prevBtn").click();
    await vi.waitFor(() => expect(navigationCalls.begins.length).toBeGreaterThan(beginsBeforeIdentityBack));
    const identityBackTicket = navigationCalls.begins.at(-1);
    expect(identityBackTicket.target).toMatchObject({ scriptId: "show", step: showStepIndex(SHOW_STEP_IDS.IDENTITY) });
    await vi.waitFor(() => expect(navigationCalls.completes.some((call) => call.ticket === identityBackTicket && call.accepted)).toBe(true));
    expect(navigation.getState().current?.step).toBe(showStepIndex(SHOW_STEP_IDS.IDENTITY));
  });

  test("a failed fixed replacement retries through the direct replacement path", async () => {
    await openShortcut(SHOW_STEP_IDS.WALL);
    let fail = true;
    h.presentationHandler = (command, host) => {
      if (command.segmentId === "credits" && fail) return Promise.reject(new Error("replacement failed"));
      queueMicrotask(() => host.emit("narrativePresentationResult", {
        ...command,
        outcome: command.presentationAction === "close" ? "closed" : "opened",
        slide: 1,
        range: [1, 1],
      }));
      return Promise.resolve({ status: "ok" });
    };
    el("nextBtn").click();
    await vi.waitFor(() => expect(el("playerCueFailure").hidden).toBe(false));
    expect(navigation.getState().current?.step).toBe(showStepIndex(SHOW_STEP_IDS.WALL));
    const beforeRetry = h.commands.length;
    fail = false;
    el("playerCueRetry").click();
    await vi.waitFor(() => expect(navigation.getState().current?.step).toBe(SHOW.steps.length - 1));
    expect(h.commands.slice(beforeRetry).map((command) => command.segmentId)).toEqual(["credits"]);
    expect(navigation.getState().backStack).toHaveLength(1);
  });

  test("A to B to A cannot settle the first A after the second A succeeds", async () => {
    el("narrativeList").querySelector('[data-open="nova"]').click();
    await vi.waitFor(() => expect(navigation.getState().current).toMatchObject({ scriptId: "nova", step: 0 }));
    let releaseFirstA;
    let openCount = 0;
    h.presentationHandler = (command, host) => {
      if (command.segmentId === "nova_mor" && command.presentationAction === "open" && ++openCount === 1) {
        releaseFirstA = () => {
          host.emit("narrativePresentationResult", { ...command, outcome: "opened", slide: 1, range: [1, 1] });
        };
        return new Promise(() => {});
      }
      queueMicrotask(() => host.emit("narrativePresentationResult", {
        ...command,
        outcome: command.presentationAction === "close" ? "closed" : "opened",
        slide: 1,
        range: [1, 1],
      }));
      return Promise.resolve({ status: "ok" });
    };
    el("ticks").querySelector('[data-step="3"]').click();
    await vi.waitFor(() => expect(releaseFirstA).toBeTypeOf("function"));
    el("ticks").querySelector('[data-step="2"]').click();
    await vi.waitFor(() => expect(navigation.getState().current).toMatchObject({ scriptId: "nova", step: 2 }));
    el("ticks").querySelector('[data-step="3"]').click();
    await vi.waitFor(() => expect(navigation.getState().current).toMatchObject({ scriptId: "nova", step: 3 }));
    const committed = navigation.getState();
    releaseFirstA();
    await Promise.resolve();
    expect(navigation.getState().current).toEqual(committed.current);
    expect(navigation.getState().backStack).toEqual(committed.backStack);
    expect(navigation.getState().visitedScenes.filter((scene) => scene.scriptId === "nova" && scene.step === 3)).toHaveLength(1);
  });

  test("Home failure preserves navigation, then acknowledged Home clears it", async () => {
    await openShortcut(SHOW_STEP_IDS.IDENTITY);
    await el("nextBtn").click();
    await vi.waitFor(() => expect(navigation.getState().current?.step).toBe(showStepIndex(SHOW_STEP_IDS.WALL)));
    let failClose = true;
    h.presentationHandler = (command, host) => {
      if (command.presentationAction === "close" && failClose) return Promise.reject(new Error("close failed"));
      queueMicrotask(() => host.emit("narrativePresentationResult", { ...command, outcome: "closed" }));
      return Promise.resolve({ status: "ok" });
    };
    el("homeBtn").click();
    await vi.waitFor(() => expect(el("playerCueFailure").hidden).toBe(false));
    expect(navigation.getState().current?.step).toBe(showStepIndex(SHOW_STEP_IDS.WALL));
    expect(navigation.getState().backStack).toHaveLength(1);
    failClose = false;
    el("playerCueRetry").click();
    await vi.waitFor(() => expect(navigation.getState().current).toBeNull());
    expect(navigation.getState().backStack).toEqual([]);
    expect(navigation.getState().visitedScenes).toEqual([]);
  });

  test("disposing abandons the pending session ticket", async () => {
    let releaseLayers;
    h.dataContext.setEnabledLayerIds = (ids) => new Promise((resolve) => {
      releaseLayers = () => { h.layers = [...ids]; resolve({ ok: true }); };
    });
    el("narrativeList").querySelector('[data-open="segev"]').click();
    await vi.waitFor(() => expect(releaseLayers).toBeTypeOf("function"));
    const ticket = navigationCalls.begins.at(-1);
    expect(ticket.target.scriptId).toBe("segev");
    remote.dispose();
    expect(navigationCalls.abandons.filter((call) => call.ticket === ticket && call.accepted)).toHaveLength(1);
    expect(navigation.complete(ticket)).toBe(false);
    expect(navigation.abandon(null)).toBe(false);
    releaseLayers();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(navigation.getState().current).toBeNull();
    expect(navigationCalls.completes.some((call) => call.ticket === ticket && call.accepted)).toBe(false);
  });
});
