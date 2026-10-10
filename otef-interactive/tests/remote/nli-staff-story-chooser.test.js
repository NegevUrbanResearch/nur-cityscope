/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  hasSceneStrip,
  navigationLabel,
  optionalStoryActions,
  storyChooserHtml,
} from "../../frontend/src/remote/nli-staff-navigation-view.js";
import { NARRATIVES, SHOW } from "../../frontend/src/remote/nli-staff-script.js";
import { showStepIndex } from "../../frontend/src/remote/nli-staff-flow.js";
import { createNliStaffNavigationSession } from "../../frontend/src/remote/nli-staff-navigation-session.js";
import { messageForLocale, setLocale } from "../../frontend/src/remote/remote-locale.js";

const chooserEffectObservers = vi.hoisted(() => ({ cues: [], timelineHosts: [], presenters: [] }));

vi.mock("../../frontend/src/remote/nli-staff-cues.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createCueRunner: (...args) => {
      const cueRunner = actual.createCueRunner(...args);
      for (const method of ["apply", "cancel"]) {
        cueRunner[method] = vi.fn(cueRunner[method].bind(cueRunner));
      }
      chooserEffectObservers.cues.push(cueRunner);
      return cueRunner;
    },
  };
});

vi.mock("../../frontend/src/remote/nli-staff-timeline-host.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createNliStaffTimelineHost: (...args) => {
      const host = actual.createNliStaffTimelineHost(...args);
      host.invalidateTransport = vi.fn(host.invalidateTransport.bind(host));
      chooserEffectObservers.timelineHosts.push(host);
      return host;
    },
  };
});

vi.mock("../../frontend/src/remote/nli-presenter-commands.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createPresenterCommands: (...args) => {
      const commands = actual.createPresenterCommands(...args);
      commands.invalidate = vi.fn(commands.invalidate.bind(commands));
      chooserEffectObservers.presenters.push(commands);
      return commands;
    },
  };
});

const remoteHtml = readFileSync("frontend/nli-staff-remote.html", "utf8");
const element = (id) => document.getElementById(id);
let activeHarness = null;
let activeRemote = null;

function remoteHarness() {
  document.body.innerHTML = remoteHtml;
  const globals = {
    context: globalThis.OTEFDataContext,
    registry: globalThis.layerRegistry,
    fetch: globalThis.fetch,
  };
  const listeners = new Map();
  const calls = {
    scene: [], clock: [], layers: [], clear: 0, presentations: [], archives: [],
    place: [], cancelPlaceFocus: 0, exhibitMode: 0, localeSettings: [],
  };
  const host = {
    narrative: { id: null, transition: "steady", revision: 0 },
    failNarrativeOnce: false,
    holdLayersOnce: null,
    failLayersOnce: false,
    clock: { phase: "idle", membership: [], beats: [], loop: false, positionMs: 0, anchorMs: null, seekKind: "none", revision: 1, serverNowMs: Date.now() },
    layers: [],
    emit(topic, value) { for (const listener of listeners.get(topic) || []) listener(value); },
  };
  const dataContext = {
    isConnected: () => false,
    getNarrativeState: () => host.narrative,
    getPersonSelection: () => ({ personId: null, datasetVersion: null, revision: 0 }),
    getInvestigationClock: () => host.clock,
    getEscapeOverlay: () => ({ individual: false, overlap: false, mor: false, settled: false }),
    getLayerGroups: () => host.layers.map((id) => ({ id: id.split(".")[0], layers: [{ id: id.split(".")[1], enabled: true }] })),
    getLegendSettings: () => ({ language: "en" }),
    getProjectionSlideshow: () => null,
    correctedNow: () => 50_000,
    setExhibitMode: () => { calls.exhibitMode += 1; },
    setLegendSettings: async (settings) => { calls.localeSettings.push(settings); return { ok: true }; },
    async navigateToPlace(place) { calls.place.push(place); return { ok: true }; },
    async cancelNavigationFocus() { calls.cancelPlaceFocus += 1; return { ok: true }; },
    async setNarrative(id) {
      calls.scene.push(id);
      if (host.failNarrativeOnce) { host.failNarrativeOnce = false; return { ok: false }; }
      host.narrative = { id, transition: "enter", revision: host.narrative.revision + 1 };
      return { ok: true };
    },
    async setEnabledLayerIds(ids) {
      calls.layers.push([...ids]);
      if (host.holdLayersOnce) {
        const hold = host.holdLayersOnce;
        host.holdLayersOnce = null;
        await hold;
      }
      if (host.failLayersOnce) { host.failLayersOnce = false; return { ok: false }; }
      host.layers = [...ids];
      return { ok: true };
    },
    async setEscapeOverlay() { return { ok: true }; },
    async patchInvestigationClock(next) { calls.clock.push(next); host.clock = { ...next, revision: host.clock.revision + 1, serverNowMs: Date.now() }; return { ok: true, clock: host.clock }; },
    async clearPerson() { calls.clear += 1; return { personId: null, datasetVersion: null, revision: calls.clear }; },
    async archiveWindowCommand(command) { calls.archives.push(command); return { acknowledged: true }; },
    async narrativePresentationCommand(command) {
      calls.presentations.push(command);
      queueMicrotask(() => host.emit("narrativePresentationResult", {
        ...command, outcome: command.presentationAction === "close" ? "closed" : "opened", slide: 1, range: [1, 1],
      }));
      return { status: "ok" };
    },
    subscribe(topic, listener) {
      const list = listeners.get(topic) || [];
      list.push(listener);
      listeners.set(topic, list);
      return () => listeners.set(topic, (listeners.get(topic) || []).filter((entry) => entry !== listener));
    },
  };
  globalThis.OTEFDataContext = dataContext;
  globalThis.layerRegistry = { getLayerDataUrl: (id) => id };
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    async json() { return { features: [{ type: "Feature", properties: { timeline_minutes: 389 }, geometry: { type: "LineString", coordinates: [[34, 31], [34.1, 31.1]] } }] }; },
  }));
  return {
    host, calls, dataContext,
    restore() {
      if (globals.context === undefined) delete globalThis.OTEFDataContext;
      else globalThis.OTEFDataContext = globals.context;
      if (globals.registry === undefined) delete globalThis.layerRegistry;
      else globalThis.layerRegistry = globals.registry;
      globalThis.fetch = globals.fetch;
    },
  };
}

async function bootAtNovaEnding(harness) {
  const navigation = createNliStaffNavigationSession();
  const { initNliStaffRemote } = await import("../../frontend/src/remote/nli-staff-remote.js");
  const remote = initNliStaffRemote(harness.dataContext, { navigationSession: navigation });
  activeRemote = remote;
  expect(element("narrativeList").querySelector('[data-open="show"]')).not.toBeNull();
  element("narrativeList").querySelector('[data-open="show"]').click();
  await vi.waitFor(() => expect(navigation.getState().current).toMatchObject({ scriptId: "show", step: 0 }));
  element("nextBtn").click();
  await vi.waitFor(() => expect(element("nextChoices").hidden).toBe(false));
  element("nextChoices").querySelector('[data-branch="segev"]').click();
  await vi.waitFor(() => expect(navigation.getState().current?.scriptId).toBe("segev"));
  element("nextBtn").click();
  await vi.waitFor(() => expect(navigation.getState().current).toMatchObject({ scriptId: "show", step: 2 }));
  element("nextBtn").click();
  await vi.waitFor(() => expect(element("nextChoices").hidden).toBe(false));
  element("nextChoices").querySelector('[data-branch="nova"]').click();
  await vi.waitFor(() => expect(navigation.getState().current?.scriptId).toBe("nova"));
  element("ticks").querySelector('[data-step="4"]').click();
  await vi.waitFor(() => expect(navigation.getState().current).toMatchObject({ scriptId: "nova", step: 4 }));
  await vi.waitFor(() => expect(element("nextBtn").hidden).toBe(false));
  expect(element("nextBtn").dataset.navigationAction).toBe("choose-story");
  expect(element("nextBtn").className).toBe("btn nav-button");
  expect(element("prevBtn").className).toBe("btn btn--outline btn--muted nav-button");
  return { remote, navigation };
}

describe("NLI optional-story chooser", () => {
  beforeEach(() => {
    document.body.innerHTML = remoteHtml;
    chooserEffectObservers.cues.length = 0;
    chooserEffectObservers.timelineHosts.length = 0;
    chooserEffectObservers.presenters.length = 0;
  });

  afterEach(() => {
    activeRemote?.dispose();
    activeRemote = null;
    activeHarness?.restore();
    activeHarness = null;
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  test.each(["nova", "sderot", "shura", "hostages"])("keeps Back and chooser controls safe during pending and failed %s ending reapply, then Retry", async (id) => {
    setLocale("en", { persist: false });
    const h = remoteHarness();
    activeHarness = h;
    const { navigation } = await bootAtNovaEnding(h);
    if (id !== "nova") {
      element("nextBtn").click();
      element("storyChooser").querySelector(`[data-story-id="${id}"]`).click();
      await vi.waitFor(() => expect(navigation.getState().current.scriptId).toBe(id));
      if (id === "hostages") {
        element("ticks").querySelector('[data-step="3"]').click();
        await vi.waitFor(() => expect(navigation.getState().current.step).toBe(3));
      }
      await vi.waitFor(() => expect(element("nextBtn").disabled).toBe(false));
    }
    const endingStep = navigation.getState().current.step;
    if (id === "nova" || id === "hostages") {
      element("ticks").querySelector(`[data-step="${endingStep - 1}"]`).click();
      await vi.waitFor(() => expect(navigation.getState().current.step).toBe(endingStep - 1));
    }
    let release;
    h.host.holdLayersOnce = new Promise((resolve) => { release = resolve; });
    h.host.failLayersOnce = true;
    if (id === "nova" || id === "hostages") {
      element("ticks").querySelector(`[data-step="${endingStep}"]`).click();
    } else {
      element("nextBtn").click();
      element("storyChooser").querySelector(`[data-story-id="${id}"]`).click();
    }
    await vi.waitFor(() => expect(h.host.holdLayersOnce).toBeNull());
    const expectUnsettledRow = () => {
      expect(element("prevBtn").hidden).toBe(false);
      expect(element("nextBtn").hidden).toBe(false);
      expect(element("nextChoices").hidden).toBe(true);
      expect(element("nextChoices").querySelectorAll("[data-branch]")).toHaveLength(0);
      expect(element("nextBtn").disabled).toBe(true);
      expect(element("prevBtn").disabled).toBe(false);
      const before = structuredClone(h.calls);
      element("nextBtn").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      element("nextBtn").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      element("nextChoices").innerHTML = '<button data-branch="shura">Shura</button>';
      element("nextChoices").firstChild.click();
      expect(h.calls).toEqual(before);
      expect(element("storyChooser").hidden).toBe(true);
    };
    expectUnsettledRow();
    element("nextChoices").innerHTML = "";
    release();
    await vi.waitFor(() => expect(element("playerCueFailure").hidden).toBe(false));
    expectUnsettledRow();
    element("playerCueRetry").click();
    await vi.waitFor(() => expect(element("nextBtn").disabled).toBe(false));
      expect(element("nextChoices").hidden).toBe(true);
    expect(element("nextChoices").children).toHaveLength(0);
    expect(navigation.getState().current.scriptId).toBe(id);
  });

  test("retains chooser scroll position and semantic focus through locale renders", async () => {
    const h = remoteHarness();
    activeHarness = h;
    await bootAtNovaEnding(h);
    element("nextBtn").click();
    element("storyChooser").scrollTop = 125;
    element("storyChooser").querySelector('[data-focus-key="chooser-cancel"]').focus();
    window.dispatchEvent(new Event("otef:locale"));
    expect(element("storyChooser").scrollTop).toBe(125);
    expect(document.activeElement.dataset.focusKey).toBe("chooser-cancel");
  });

  test("provides a named dialog with the three optional stories and no Identity choice", () => {
    document.getElementById("storyChooserMount").innerHTML = storyChooserHtml({ locale: "en" });
    const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
    expect(dialog, "the existing player should contain a local story chooser dialog").not.toBeNull();
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    const storyActions = [...dialog.querySelectorAll("[data-story-id]")];
    expect(storyActions.map((button) => button.dataset.storyId)).toEqual(["sderot", "shura", "hostages"]);
    expect(dialog.querySelector('[data-story-id="identity"]')).toBeNull();
    expect(dialog.querySelector('[data-chooser-action="continue-identity"]')?.dataset.focusKey).toBe("chooser-identity");
    document.getElementById("storyChooserMount").innerHTML = storyChooserHtml({
      locale: "he", visitedStoryIds: ["sderot", "shura", "hostages"],
    });
    expect([...document.querySelectorAll('[role="dialog"] [data-story-id]')].every((button) => !button.disabled)).toBe(true);
  });

  test("keeps the allowed header controls above the chooser backdrop", () => {
    expect(remoteHtml).toMatch(/\.header\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*21/s);
    expect(remoteHtml).toMatch(/\.story-chooser\s*\{[^}]*z-index:\s*20/s);
  });

  test("keeps visited status icon-only and gives each story action an accessible name", () => {
    document.getElementById("storyChooserMount").innerHTML = storyChooserHtml({ locale: "en", visitedStoryIds: ["sderot"] });
    const storyActions = [...document.querySelectorAll('[role="dialog"] [data-story-id]')];
    expect(storyActions).toHaveLength(3);
    for (const button of storyActions) {
      expect(button.getAttribute("aria-label")).toBeTruthy();
      const status = button.querySelector('[data-visited-status]');
      expect(status).not.toBeNull();
      expect(status.getAttribute("aria-label")).toMatch(/visited|not visited|ביקרת/i);
      expect(status.textContent.trim()).toBe("");
      expect(status.querySelector("svg")).not.toBeNull();
    }
    expect(storyActions[0].getAttribute("aria-label")).toBe("Sderot, Visited");
    expect(storyActions[1].getAttribute("aria-label")).toBe("Shura Camp, Not visited");
  });

  test("keeps the original Back proportion and places Identity inside the chooser", () => {
    const dock = document.querySelector(".dock");
    expect(dock.querySelectorAll("button")).toHaveLength(2);
    expect(dock.querySelector("#prevBtn").className).toBe("btn btn--outline btn--muted nav-button");
    expect(dock.querySelector("#nextBtn").className).toBe("btn nav-button");
    expect(dock.querySelector("#nextBtn").dataset.navigationAction).toBe("next");
    expect(dock.querySelector("#storyBackBtn")).toBeNull();
    expect(dock.querySelector("#chooseStoryBtn")).toBeNull();
    expect(dock.querySelector("#continueIdentityBtn")).toBeNull();
    const chooser = storyChooserHtml({ locale: "en" });
    expect(chooser).toContain('data-chooser-action="continue-identity"');
    expect(remoteHtml).toMatch(/\.story-chooser-action\s*\{[^}]*min-height:\s*64px;[^}]*background:\s*var\(--surface-2\);/s);
    expect(remoteHtml).toMatch(/grid-template-columns:\s*24px minmax\(0, 1fr\) 24px/);
    expect(remoteHtml).toMatch(/\.story-chooser-action > span:first-child\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*1;/s);
    expect(remoteHtml).toMatch(/\.story-chooser-action \.story-visited\s*\{[^}]*grid-column:\s*3;[^}]*grid-row:\s*1;/s);
    expect(remoteHtml).not.toMatch(/\.story-chooser:dir\(rtl\).*story-visited/s);
  });

  test("provides the exact Hebrew and English navigation copy and story-name Back labels", () => {
    const nova = { scriptId: "nova", step: 4, returnTo: { id: "show", step: showStepIndex("nova-mor-levy") } };
    const hostages = { scriptId: "hostages", step: 3, returnTo: { id: "show", step: showStepIndex("narratives") } };
    expect(navigationLabel({ current: hostages, target: nova, direction: "back", locale: "he" })).toBe("חזרה לנובה");
    expect(navigationLabel({ current: hostages, target: nova, direction: "back", locale: "en" })).toBe("Back to Nova");
    expect(navigationLabel({ current: nova, target: hostages, direction: "next", locale: "he" })).toBe("חיים פרי וחטופים");
    expect(navigationLabel({ current: nova, target: hostages, direction: "next", locale: "en" })).toBe("Haim Peri and hostages");
    expect(navigationLabel({ current: nova, target: { scriptId: "nova", step: 3 }, direction: "back", locale: "en" })).toBe("Previous scene");
    expect(navigationLabel({ current: { scriptId: "show", step: showStepIndex("identity-database") }, target: { scriptId: "show", step: showStepIndex("names-wall") }, direction: "next", locale: "en" })).toBe("Continue to Wall of names");
    expect(navigationLabel({ current: { scriptId: "show", step: showStepIndex("names-wall") }, target: { scriptId: "show", step: showStepIndex("identity-database") }, direction: "back", locale: "he" })).toBe("חזרה למאגר הזהויות");
  });

  test("matches the approved action and slide copy in both locales", () => {
    const expected = {
      he: {
        chooseStory: "בחירת סיפור", chooseAnotherStory: "בחירת סיפור נוסף",
        continueIdentity: "המשך למאגר הזהויות", continueWall: "המשך לקיר השמות",
        backToNova: "חזרה לנובה", backToIdentity: "חזרה למאגר הזהויות",
        navigationPreviousScene: "הסצנה הקודמת", navigationNextScene: "הסצנה הבאה",
        presentationPrevious: "השקופית הקודמת", presentationNext: "השקופית הבאה", storyCancel: "ביטול",
      },
      en: {
        chooseStory: "Choose a story", chooseAnotherStory: "Choose another story",
        continueIdentity: "Continue to Identity database", continueWall: "Continue to Wall of names",
        backToNova: "Back to Nova", backToIdentity: "Back to Identity database",
        navigationPreviousScene: "Previous scene", navigationNextScene: "Next scene",
        presentationPrevious: "Previous slide", presentationNext: "Next slide", storyCancel: "Cancel",
      },
    };
    for (const [locale, strings] of Object.entries(expected)) {
      for (const [key, value] of Object.entries(strings)) expect(messageForLocale(locale, key)).toBe(value);
    }
  });

  test("offers scene strips only for Nova, Hostages, and the independent timeline", () => {
    expect(["nova", "hostages", "timeline"].filter(hasSceneStrip)).toEqual(["nova", "hostages", "timeline"]);
    expect(["show", "sderot", "shura", "segev", "identity"].filter(hasSceneStrip)).toEqual([]);
  });

  test("styles successful non-current scene visits as illuminated strips", async () => {
    expect(remoteHtml).toMatch(/\.ticks\[hidden\]\s*\{\s*display:\s*none\s*!important/);
    expect(remoteHtml).toMatch(/\.ticks button\.is-visited::after\s*\{\s*background:\s*var\(--accent-line\)/);
    expect(remoteHtml).toMatch(/\.ticks button\.is-current::after/);
    setLocale("en", { persist: false });
    const h = remoteHarness();
    activeHarness = h;
    const { remote, navigation } = await bootAtNovaEnding(h);
    const visitedTick = (step) => element("ticks").querySelector(`[data-step="${step}"]`);
    element("ticks").querySelector('[data-step="3"]').click();
    await vi.waitFor(() => expect(navigation.getState().current.step).toBe(3));
    expect(visitedTick(4).classList.contains("is-visited")).toBe(true);
    element("ticks").querySelector('[data-step="1"]').click();
    await vi.waitFor(() => expect(navigation.getState().current.step).toBe(1));
    expect(visitedTick(1).classList.contains("is-current")).toBe(true);
    expect(visitedTick(3).classList.contains("is-visited")).toBe(true);
    element("ticks").querySelector('[data-step="3"]').click();
    await vi.waitFor(() => expect(navigation.getState().current.step).toBe(3));
    expect(visitedTick(1).classList.contains("is-visited")).toBe(true);
    element("prevBtn").click();
    await vi.waitFor(() => expect(navigation.getState().current.step).toBe(3));
    expect(visitedTick(4).classList.contains("is-visited")).toBe(true);
    element("ticks").querySelector('[data-step="3"]').click();
    await vi.waitFor(() => expect(navigation.getState().current.step).toBe(3));
    expect(visitedTick(3).classList.contains("is-current")).toBe(true);
    expect(visitedTick(3).classList.contains("is-visited")).toBe(true);
    remote.dispose();
  });

  test("uses each authored timeline destination title in both directions and locales", () => {
    for (const [stepId, he, en] of [
      ["opening-minutes", "הדקות הראשונות", "The opening minutes"],
      ["rest-of-day", "שאר היום", "The rest of the day"],
    ]) {
      const target = { scriptId: "show", step: showStepIndex(stepId) };
      for (const direction of ["next", "back"]) {
        expect(navigationLabel({ current: { scriptId: "segev", step: 1 }, target, direction, locale: "he" })).toBe(he);
        expect(navigationLabel({ current: { scriptId: "segev", step: 1 }, target, direction, locale: "en" })).toBe(en);
      }
    }
    expect(navigationLabel({ current: { scriptId: "show", step: showStepIndex("names-wall") }, target: { scriptId: "show", step: showStepIndex("credits") }, direction: "next", locale: "he" })).toBe("קרדיטים");
  });

  test("enables optional actions only on the acknowledged final SHOW branch scenes", () => {
    const nova = { scriptId: "nova", step: 4, returnTo: { id: "show", step: showStepIndex("nova-mor-levy") } };
    const sderot = { scriptId: "sderot", step: 0, returnTo: { id: "show", step: showStepIndex("narratives") } };
    const shura = { scriptId: "shura", step: 0, returnTo: { id: "show", step: showStepIndex("narratives") } };
    const hostages = { scriptId: "hostages", step: 3, returnTo: { id: "show", step: showStepIndex("narratives") } };
    const eligible = (ref, overrides = {}) => optionalStoryActions({
      current: ref, displayed: ref, navigationPending: false, searchPending: false,
      cueStatus: "ready", presentationPhase: "closed", navigationFailed: false, ...overrides,
    });
    expect(eligible(nova)).toBe(true);
    expect(eligible(sderot)).toBe(true);
    expect(eligible(shura)).toBe(true);
    expect(eligible(hostages)).toBe(true);
    expect(eligible({ ...nova, step: 3 })).toBe(false);
    expect(eligible({ ...nova, returnTo: null })).toBe(false);
    expect(eligible({ ...sderot, returnTo: null })).toBe(false);
    expect(eligible({ ...hostages, step: 2 })).toBe(false);
    expect(eligible({ scriptId: "nova", step: 4, returnTo: { id: "show", step: 0 } })).toBe(false);
    expect(eligible({ scriptId: "show", step: showStepIndex("identity-database") })).toBe(false);
    for (const key of ["navigationPending", "searchPending", "navigationFailed"]) {
      expect(eligible(nova, { [key]: true })).toBe(false);
    }
    expect(eligible(nova, { cueStatus: "failed" })).toBe(false);
    for (const presentationPhase of ["opening", "applying", "closing"]) {
      expect(eligible(nova, { presentationPhase })).toBe(false);
    }
    expect(optionalStoryActions({
      current: nova, displayed: { ...nova, returnTo: null }, navigationPending: false,
      searchPending: false, cueStatus: "ready", presentationPhase: "open", navigationFailed: false,
    })).toBe(false);
    expect(NARRATIVES.map(({ id }) => id)).toContain("hostages");
    expect(SHOW.steps[showStepIndex("narratives")].branch).toEqual(["sderot", "shura", "hostages"]);
  });

  test("opens and cancels locally, preserves semantic focus through locale rerender, and leaves scene work untouched", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(50_000);
    setLocale("en", { persist: false });
    const h = remoteHarness();
    activeHarness = h;
    const holdSpy = vi.spyOn(h.dataContext, "patchInvestigationClock");
    const { remote, navigation } = await bootAtNovaEnding(h);
    const cueRunner = chooserEffectObservers.cues.at(-1);
    const timelineHost = chooserEffectObservers.timelineHosts.at(-1);
    const presenterCommands = chooserEffectObservers.presenters.at(-1);
    cueRunner.apply.mockClear();
    cueRunner.cancel.mockClear();
    timelineHost.invalidateTransport.mockClear();
    presenterCommands.invalidate.mockClear();
    holdSpy.mockClear();
    const expectNoSceneWork = () => {
      expect(cueRunner.apply).not.toHaveBeenCalled();
      expect(cueRunner.cancel).not.toHaveBeenCalled();
      expect(timelineHost.invalidateTransport).not.toHaveBeenCalled();
      expect(presenterCommands.invalidate).not.toHaveBeenCalled();
      expect(holdSpy.mock.calls.filter(([, options]) => options?.claimPresentationHold != null || options?.releasePresentationHold != null)).toEqual([]);
    };
    const before = {
      calls: structuredClone(h.calls),
      session: navigation.getState(),
      clock: structuredClone(h.host.clock),
      scene: structuredClone(h.host.narrative),
    };
    element("nextBtn").click();
    expect(element("storyChooser").hidden).toBe(false);
    expect(document.activeElement.dataset.focusKey).toBe("story-sderot");
    expect(document.querySelector("#player .dock").inert).toBe(true);
    element("prevBtn").click();
    element("nextBtn").click();
    element("ticks").querySelector("button").click();
    expect(navigation.getState()).toEqual(before.session);
    expect(h.calls).toEqual(before.calls);
    expectNoSceneWork();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(element("localeEn"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement.dataset.focusKey).toBe("story-sderot");
    expect(h.calls).toEqual(before.calls);
    expect(navigation.getState()).toEqual(before.session);
    expectNoSceneWork();
    setLocale("he", { persist: false });
    expect(element("storyChooser").hidden).toBe(false);
    expect(document.activeElement.dataset.focusKey).toBe("story-sderot");
    expect(element("storyChooser").dir).toBe("rtl");
    expect(h.calls).toEqual(before.calls);
    expectNoSceneWork();
    await vi.advanceTimersByTimeAsync(2500);
    expect(h.calls).toEqual(before.calls);
    expectNoSceneWork();
    expect(h.host.clock).toEqual(before.clock);
    element("storyChooser").querySelector('[data-chooser-action="cancel"]').click();
    expect(element("storyChooser").hidden).toBe(true);
    expect(document.activeElement.dataset.focusKey).toBe("navigation-choose");
    expect(h.calls).toEqual(before.calls);
    expectNoSceneWork();
    element("nextBtn").click();
    expect(element("storyChooser").hidden).toBe(false);
    element("storyChooser").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(element("storyChooser").hidden).toBe(true);
    expect(document.activeElement.dataset.focusKey).toBe("navigation-choose");
    expect(h.calls).toEqual(before.calls);
    expect(navigation.getState()).toEqual(before.session);
    expect(h.host.clock).toEqual(before.clock);
    expect(h.host.narrative).toEqual(before.scene);
    expectNoSceneWork();
    element("localeEn").click();
    await vi.waitFor(() => expect(h.calls.localeSettings.at(-1)).toEqual({ language: "en" }));
    remote.dispose();
  });

  test("blocks stale archive, search input, reset, and gesture mutations while chooser is open", async () => {
    setLocale("en", { persist: false });
    const h = remoteHarness();
    activeHarness = h;
    const { remote } = await bootAtNovaEnding(h);
    element("nextBtn").click();
    const before = structuredClone(h.calls);
    const archiveMount = element("searchArchiveMount");
    archiveMount.innerHTML = '<button data-archive-action="open"></button><button data-archive-action="page_down"></button>';
    archiveMount.querySelector('[data-archive-action="open"]').click();
    archiveMount.querySelector('[data-archive-action="page_down"]').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    element("searchInput").value = "";
    element("searchInput").dispatchEvent(new Event("input", { bubbles: true }));
    element("searchReset").click();
    expect(h.calls).toEqual(before);
    expect(element("storyChooser").hidden).toBe(false);
    remote.dispose();
  });

  test("keeps focused allowed header controls by semantic key through live and locale renders", async () => {
    setLocale("en", { persist: false });
    const h = remoteHarness();
    activeHarness = h;
    const { remote } = await bootAtNovaEnding(h);
    element("nextBtn").click();
    for (const [id, key] of [["localeEn", "locale-en"], ["fullscreenBtn", "management-fullscreen"], ["staffConnection", "management-connection"], ["homeBtn", "header-home"]]) {
      const control = element(id);
      control.disabled = false;
      control.focus();
      window.dispatchEvent(new Event("otef:locale"));
      expect(document.activeElement).toBe(control);
      expect(document.activeElement.dataset.focusKey).toBe(key);
    }
    remote.dispose();
  });

  test("continues to Identity from the chooser on first arrival with no optional visits", async () => {
    setLocale("en", { persist: false });
    const h = remoteHarness();
    activeHarness = h;
    const { remote, navigation } = await bootAtNovaEnding(h);
    expect(navigation.getState().visitedStoryIds).toEqual([]);
    element("nextBtn").click();
    const continuation = element("storyChooser").querySelector('[data-chooser-action="continue-identity"]');
    expect(continuation).not.toBeNull();
    expect(continuation.dataset.focusKey).toBe("chooser-identity");
    continuation.click();
    await vi.waitFor(() => expect(navigation.getState().current).toMatchObject({ scriptId: "show", step: showStepIndex("identity-database") }));
    expect(navigation.getState().visitedStoryIds).toEqual([]);
    expect(navigation.getState().visitedScenes.at(-1)).toMatchObject({ scriptId: "show", step: showStepIndex("identity-database") });
    expect(document.querySelector('[role="dialog"] [data-story-id="identity"]')).toBeNull();
    expect(element("storyChooser").hidden).toBe(true);
    remote.dispose();
  });

  test("keeps live player kits and focused story control during follower updates", async () => {
    setLocale("en", { persist: false });
    const h = remoteHarness();
    activeHarness = h;
    const { remote } = await bootAtNovaEnding(h);
    element("nextBtn").click();
    const focused = element("storyChooser").querySelector('[data-story-id="shura"]');
    focused.focus();
    const timelineKit = element("kitTimeline");
    const commandCount = h.calls.presentations.length;
    h.host.clock = { ...h.host.clock, positionMs: 1200, revision: h.host.clock.revision + 1 };
    h.host.emit("investigationClock", h.host.clock);
    h.host.emit("layerGroups", h.host.layers);
    h.host.emit("narrativeState", h.host.narrative);
    expect(element("storyChooser").hidden).toBe(false);
    expect(document.activeElement).toBe(focused);
    expect(element("kitTimeline")).toBe(timelineKit);
    expect(h.calls.presentations).toHaveLength(commandCount);
    expect(element("player").querySelector(".player-body").inert).toBe(true);
    remote.dispose();
  });

  test("rejects chooser eligibility while failed candidate is published, then restores it on Back recovery", async () => {
    setLocale("en", { persist: false });
    const h = remoteHarness();
    activeHarness = h;
    const { remote, navigation } = await bootAtNovaEnding(h);
    h.host.failNarrativeOnce = true;
    element("nextBtn").click();
    element("storyChooser").querySelector('[data-story-id="sderot"]').click();
    await vi.waitFor(() => expect(element("playerCueFailure").hidden).toBe(false));
    expect(element("stepTitle").textContent).toBe("Sderot");
    expect(navigation.getState().current).toMatchObject({ scriptId: "nova", step: 4 });
    expect(navigation.getState().visitedStoryIds).not.toContain("sderot");
    expect(element("nextBtn").hidden).toBe(false);
    expect(element("nextBtn").disabled).toBe(true);
    element("prevBtn").click();
    await vi.waitFor(() => expect(navigation.getState().current).toMatchObject({ scriptId: "nova", step: 4 }));
    await vi.waitFor(() => expect(element("nextBtn").hidden).toBe(false));
    await vi.waitFor(() => expect(element("nextBtn").disabled).toBe(false));
    expect(navigation.getState().visitedStoryIds).toEqual([]);
    expect(navigation.getState().visitedStoryIds).not.toContain("sderot");
    remote.dispose();
  });

  test("keeps a failed selection unvisited until Retry succeeds and opens its ending chooser", async () => {
    setLocale("en", { persist: false });
    const h = remoteHarness();
    activeHarness = h;
    const { remote, navigation } = await bootAtNovaEnding(h);
    h.host.failNarrativeOnce = true;
    element("nextBtn").click();
    element("storyChooser").querySelector('[data-story-id="sderot"]').click();
    await vi.waitFor(() => expect(element("playerCueFailure").hidden).toBe(false));
    expect(navigation.getState().visitedStoryIds).not.toContain("sderot");
    element("playerCueRetry").click();
    await vi.waitFor(() => expect(navigation.getState().current).toMatchObject({ scriptId: "sderot", step: 0 }));
    await vi.waitFor(() => expect(element("nextBtn").hidden).toBe(false));
    expect(navigation.getState().visitedStoryIds).toContain("sderot");
    expect(element("prevBtn").getAttribute("aria-label")).toBe("Back to Nova");
    remote.dispose();
  });
});
