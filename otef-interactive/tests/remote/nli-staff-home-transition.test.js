/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { COPY, HOME_CUE, HOME_LAYER_IDS, IDENTITY_LAYER_IDS } from "../../frontend/src/remote/nli-staff-script.js";
import { nliTimelineHostMethods } from "../../frontend/src/remote/nli-timeline-transport.js";
import { shouldCloseViewerForNarrative } from "../../frontend/src/map/nli-reveal-presentation.js";
import { setLocale } from "../../frontend/src/remote/remote-locale.js";

const FIXTURE = `
  <div class="app">
    <button type="button" id="homeBtn" hidden></button>
    <button type="button" id="homeLayersBtn" aria-label="Layers"></button>
    <button type="button" id="fullscreenBtn"></button>
    <p id="fullscreenStatus" hidden></p>
    <button type="button" id="localeHe"></button>
    <button type="button" id="localeEn"></button>
    <span id="staffConnection"></span>
    <section class="screen is-active" data-screen="home">
      <p id="homeCueStatus" hidden role="status"></p>
      <button id="homeRetry" hidden></button>
      <div id="narrativeList"></div>
    </section>
    <section class="screen" data-screen="player" hidden>
      <span id="playerScript"></span>
      <span id="stepCount"></span>
      <div id="ticks"></div>
      <div id="stepClock"></div>
      <h1 id="stepTitle"></h1>
      <p id="stepNote"></p>
      <div id="playerCueFailure" hidden role="alert"><span id="playerCueFailureText"></span><button id="playerCueRetry">Retry</button></div>
      <p id="stepGis"></p>
      <p id="stepModel"></p>
      <div id="playerKit">
        <p id="cueStatus"></p>
        <div id="kitSearch">
          <div id="searchKit">
            <input id="searchInput" />
            <ul id="searchResults"></ul>
            <p id="searchStatus" hidden></p>
            <button type="button" id="freeArchiveBtn"></button>
          </div>
        </div>
        <div id="kitEscape"></div>
        <div id="kitPresentation"></div>
        <div id="kitTimeline"></div>
        <div id="kitArchive"><button type="button" id="archiveBtn"></button></div>
        <p id="kitIdle" hidden></p>
      </div>
      <button type="button" id="prevBtn"></button>
      <button type="button" id="nextBtn"></button>
      <div id="nextChoices" hidden></div>
    </section>
    <div id="staffPackMenus" hidden></div>
  </div>
`;

const el = (id) => document.getElementById(id);

function layerGroupsFor(enabledIds) {
  const groups = new Map();
  for (const fullId of enabledIds || []) {
    const dot = String(fullId).indexOf(".");
    if (dot <= 0) continue;
    const groupId = fullId.slice(0, dot);
    const layerId = fullId.slice(dot + 1);
    if (!groups.has(groupId)) groups.set(groupId, { id: groupId, layers: [] });
    groups.get(groupId).layers.push({ id: layerId, enabled: true });
  }
  return [...groups.values()];
}

function activeScreen() {
  return document.querySelector(".screen.is-active")?.dataset.screen;
}

function mount(options = {}) {
  const added = [];
  const realAdd = window.addEventListener.bind(window);
  const realRemove = window.removeEventListener.bind(window);
  window.addEventListener = (type, fn, opts) => {
    added.push([type, fn, opts]);
    realAdd(type, fn, opts);
  };
  document.body.innerHTML = FIXTURE;
  const listeners = new Map();
  const h = {
    layers: [],
    narratives: [],
    escapes: [],
    patches: [],
    commands: [],
    person: options.person || { personId: null, revision: 1 },
    clock: options.clock || { phase: "idle", revision: 1 },
    narrative: options.narrative || { id: null, revision: 2, transition: "steady" },
    failNull: false,
    clearPerson: vi.fn(async () => {
      h.person = { personId: null, revision: h.person.revision + 1, datasetVersion: "v" };
      return h.person;
    }),
    dispose() {
      for (const [type, fn, opts] of added) realRemove(type, fn, opts);
      window.addEventListener = realAdd;
      document.body.innerHTML = "";
    },
    emit(topic, value) {
      for (const listener of listeners.get(topic) || []) listener(value);
    },
    async openCard(selector) {
      const button = el("narrativeList").querySelector(selector);
      expect(button).toBeTruthy();
      button.click();
      await vi.waitFor(() => expect(el("cueStatus").dataset.status).toBe("ready"));
    },
    async clickHome() {
      el("homeBtn").click();
      await vi.waitFor(() => expect(h.narratives.at(-1)).toBe(null));
    },
  };

  const dataContext = {
    isConnected: () => false,
    getNarrativeState: () => h.narrative,
    getPersonSelection: () => h.person,
    getInvestigationClock: () => h.clock,
    getEscapeOverlay: () => h.escape || { individual: false, overlap: false, mor: false, settled: false },
    getLayerGroups: () => layerGroupsFor(h.layers.at(-1) || []),
    getLegendSettings: () => ({ language: "en" }),
    setNarrative: async (id) => {
      h.narratives.push(id);
      if (id === null && h.failNull) return { ok: false };
      h.narrative = {
        id,
        revision: h.narrative.revision + 1,
        transition: id === null ? "exit" : "enter",
      };
      return { ok: true };
    },
    setEnabledLayerIds: async (ids) => {
      if (h.layerGate) await h.layerGate;
      h.layers.push([...ids]);
      return { ok: true };
    },
    setEscapeOverlay: async (overlay) => {
      h.escapes.push(overlay);
      h.escape = overlay;
      return { ok: true };
    },
    patchInvestigationClock: async (next) => {
      h.patches.push(next);
      h.clock = { ...h.clock, phase: "idle", revision: h.clock.revision + 1 };
      return { ok: true, clock: h.clock };
    },
    clearPerson: (...args) => h.clearPerson(...args),
    narrativePresentationCommand: async (command) => {
      h.commands.push(command);
      return { status: "ok" };
    },
    subscribe(topic, listener) {
      const list = listeners.get(topic) || [];
      list.push(listener);
      listeners.set(topic, list);
      return () => {};
    },
    setExhibitMode: vi.fn(),
  };

  return { h, dataContext, listeners };
}

async function bootRemote(session) {
  const { initNliStaffRemote } = await import("../../frontend/src/remote/nli-staff-remote.js");
  initNliStaffRemote(session.dataContext);
}

describe("NLI staff Home transitions", () => {
  let session;

  afterEach(() => {
    session?.h.dispose();
    session = null;
    setLocale("he", { force: true, persist: false });
  });

  test("cue state keeps localized failure copy separate from connection state", () => {
    expect(COPY.en.cueApplying).toBe("Sending the scene…");
    expect(COPY.en.cueReady).toBe("Scene sent");
    expect(COPY.en.cueFailed).toBe("Could not apply this scene");
    expect(COPY.he.cueApplying).toBe("שולח את הסצנה…");
    expect(COPY.he.cueReady).toBe("הסצנה נשלחה");
    expect(COPY.he.cueFailed).toBe("החלת הסצנה נכשלה");
    expect(COPY.en.cueReady).not.toMatch(/both displays|Map is set/i);
    expect(COPY.he.cueReady).not.toMatch(/מוכנה|שני המסכים/);
    expect(COPY.en.connected).toBe("Connected");
    expect(COPY.en.disconnected).toBe("Map is disconnected");
  });

  test("header Home, narrative finish, and a selected person apply the Home cue", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await bootRemote(session);
    const { h } = session;
    expect(session.dataContext.setExhibitMode).toHaveBeenCalledWith(true);
    const trueCallsAfterInit = session.dataContext.setExhibitMode.mock.calls.filter(([value]) => value === true).length;

    await h.openCard('[data-open="segev"]');
    h.clock = { phase: "playing", revision: 4 };
    h.person = { personId: "ada", revision: 2, datasetVersion: "v" };
    el("homeBtn").click();
    await vi.waitFor(() => {
      expect(h.layers.at(-1)).toEqual([...HOME_LAYER_IDS]);
      expect(activeScreen()).toBe("home");
    });
    expect(h.narratives.at(-1)).toBe(null);
    expect(h.narrative.id).toBeNull();
    expect(h.clock.phase).toBe("idle");
    expect(h.clearPerson).toHaveBeenCalled();
    expect(el("cueStatus").textContent).toBe("Scene sent");
    expect(el("staffConnection").textContent).toBe("Map is disconnected");
    expect(session.dataContext.setExhibitMode.mock.calls.filter(([value]) => value === true).length)
      .toBeGreaterThan(trueCallsAfterInit);

    await h.openCard('[data-open="segev"]');
    const layersBeforeFinish = h.layers.length;
    el("nextBtn").click();
    await vi.waitFor(() => {
      expect(h.layers.length).toBeGreaterThan(layersBeforeFinish);
      expect(activeScreen()).toBe("home");
    });
    expect(h.layers.at(-1)).toEqual([...HOME_LAYER_IDS]);

    expect(activeScreen()).toBe("home");
  });

  test("name-wall Home resets to the Home cue and a null narrative failure stays failed and retryable", async () => {
    setLocale("en", { persist: false });
    session = mount({ narrative: { id: null, revision: 1, transition: "steady" } });
    await bootRemote(session);
    const { h } = session;

    await h.openCard('[data-show-step="names-wall"]');
    expect(el("stepTitle").textContent).toBe("Wall of names");
    await vi.waitFor(() => expect(h.commands.at(-1)?.presentationAction).toBe("open"));
    expect(h.commands.at(-1)?.segmentId).toBe("names_wall");
    h.emit("narrativePresentationResult", {
      ...h.commands.at(-1),
      outcome: "opened",
      slide: 0,
      range: [0, 0],
    });
    expect(el("kitPresentation").hidden).toBe(true);
    expect(el("kitPresentation").innerHTML).not.toContain("data-presentation-action");
    const nullCallsBefore = h.narratives.filter((id) => id === null).length;
    const layersBeforeHome = h.layers.length;
    const commandsBeforeHome = h.commands.length;
    el("homeBtn").click();
    await vi.waitFor(() => expect(h.layers.length).toBeGreaterThan(layersBeforeHome), { timeout: 2000 });
    expect(h.layers[layersBeforeHome]).not.toContain("nli.people_names");
    expect(h.commands.slice(commandsBeforeHome).some((command) => command.presentationAction === "close")).toBe(false);
    await vi.waitFor(() => expect(h.commands.at(-1)?.presentationAction).toBe("close"), { timeout: 2000 });
    h.emit("narrativePresentationResult", { ...h.commands.at(-1), outcome: "closed" });
    await vi.waitFor(() => {
      expect(h.narratives.filter((id) => id === null).length).toBeGreaterThan(nullCallsBefore);
      expect(activeScreen()).toBe("home");
    });
    expect(h.layers.at(-1)).toEqual([...HOME_LAYER_IDS]);

    await h.openCard('[data-open="segev"]');
    h.failNull = true;
    el("homeBtn").click();
    await vi.waitFor(() => {
      expect(el("cueStatus").dataset.status).toBe("failed");
      expect(activeScreen()).toBe("player");
    });
    expect(el("cueStatus").textContent).toBe("Could not apply this scene");
    expect(el("cueStatus").textContent).not.toBe("Scene sent");
    expect(activeScreen()).not.toBe("home");
    expect(el("homeBtn").hidden).toBe(false);

    h.failNull = false;
    expect(el("playerCueFailure").hidden).toBe(false);
    expect(el("playerCueFailureText").textContent).toBe("Could not apply this scene");
    el("playerCueRetry").click();
    await vi.waitFor(() => expect(el("cueStatus").dataset.status).toBe("ready"));
    expect(h.layers.at(-1)).toEqual([...HOME_LAYER_IDS]);
    expect(activeScreen()).toBe("home");
    expect(el("playerCueFailure").hidden).toBe(true);
  });

  test("names-wall Back fades names before closing the GIS slide and restoring identity layers", async () => {
    setLocale("en", { persist: false });
    session = mount({ narrative: { id: null, revision: 1, transition: "steady" } });
    await bootRemote(session);
    const { h } = session;

    await h.openCard('[data-show-step="names-wall"]');
    await vi.waitFor(() => expect(h.commands.at(-1)?.presentationAction).toBe("open"));
    h.emit("narrativePresentationResult", {
      ...h.commands.at(-1),
      outcome: "opened",
      slide: 0,
      range: [0, 0],
    });
    const layersBeforeBack = h.layers.length;
    const commandsBeforeBack = h.commands.length;
    el("prevBtn").click();
    await vi.waitFor(() => expect(h.layers.length).toBeGreaterThan(layersBeforeBack), { timeout: 2000 });
    expect(h.layers[layersBeforeBack]).not.toContain("nli.people_names");
    expect(h.commands.slice(commandsBeforeBack).some((command) => command.presentationAction === "close")).toBe(false);
    await vi.waitFor(() => expect(h.commands.at(-1)?.presentationAction).toBe("close"), { timeout: 2000 });
    h.emit("narrativePresentationResult", { ...h.commands.at(-1), outcome: "closed" });
    await vi.waitFor(() => {
      expect(el("stepTitle").textContent).toBe("Identity database");
      expect(h.layers.at(-1)).toEqual([...IDENTITY_LAYER_IDS]);
    }, { timeout: 2000 });
  });

  test("Shura Close stays on the step and restores Open presentation", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await bootRemote(session);
    const { h } = session;

    await h.openCard('[data-open="shura"]');
    await vi.waitFor(() => expect(h.commands.at(-1)?.presentationAction).toBe("open"));
    expect(h.commands.at(-1)?.segmentId).toBe("shura");
    h.emit("narrativePresentationResult", {
      ...h.commands.at(-1),
      outcome: "opened",
      slide: 22,
      range: [22, 28],
    });
    await vi.waitFor(() => expect(el("kitPresentation").innerHTML).toContain('data-presentation-action="close"'));
    el("kitPresentation").querySelector('[data-presentation-action="close"]').click();
    await vi.waitFor(() => expect(h.commands.at(-1)?.presentationAction).toBe("close"));
    h.emit("narrativePresentationResult", { ...h.commands.at(-1), outcome: "closed" });
    await vi.waitFor(() => {
      expect(el("kitPresentation").innerHTML).toContain('data-presentation-action="open"');
    });
    expect(el("stepTitle").textContent).toBe("Shura Camp");
    expect(el("kitPresentation").querySelector('[data-presentation-action="close"]')).toBeNull();
  });

  test("a delayed close blocks Home cleanup, and a failed close leaves the step and its retry", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await bootRemote(session);
    const { h } = session;

    await h.openCard('[data-open="nova"]');
    el("ticks").querySelector('[data-step="3"]').click();
    await vi.waitFor(() => {
      expect(el("stepTitle").textContent).toBe("Mor Levy");
      expect(el("cueStatus").dataset.status).toBe("ready");
    });
    el("kitPresentation").querySelector('[data-presentation-action="open"]').click();
    await vi.waitFor(() => expect(h.commands.at(-1)?.presentationAction).toBe("open"));
    h.emit("narrativePresentationResult", {
      ...h.commands.at(-1),
      outcome: "opened",
      slide: 9,
      range: [9, 11],
    });
    await vi.waitFor(() => expect(el("kitPresentation").innerHTML).toContain('data-presentation-action="close"'));

    const layersAtClose = h.layers.length;
    const narrativesAtClose = h.narratives.length;
    vi.useFakeTimers();
    el("nextBtn").click();
    await Promise.resolve();
    expect(h.commands.at(-1)?.presentationAction).toBe("close");
    await Promise.resolve();
    expect(h.layers.length).toBe(layersAtClose);
    expect(h.narratives.length).toBe(narrativesAtClose);
    expect(el("stepTitle").textContent).toBe("Mor Levy");

    h.emit("narrativePresentationResult", { ...h.commands.at(-1), outcome: "unavailable" });
    expect(el("kitPresentation").textContent).not.toContain("Presentation unavailable");
    await vi.advanceTimersByTimeAsync(6000);
    await Promise.resolve();
    vi.useRealTimers();
    expect(el("kitPresentation").textContent).toContain("Presentation unavailable");
    expect(h.layers.length).toBe(layersAtClose);
    expect(el("stepTitle").textContent).toBe("Mor Levy");
    expect(activeScreen()).toBe("player");
    expect(el("nextBtn").disabled).toBe(false);
  });

  test("the newest Home intent is the only one applied after a shared close", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await bootRemote(session);
    const { h } = session;

    await h.openCard('[data-open="nova"]');
    el("ticks").querySelector('[data-step="3"]').click();
    await vi.waitFor(() => {
      expect(el("stepTitle").textContent).toBe("Mor Levy");
      expect(el("cueStatus").dataset.status).toBe("ready");
    });
    el("kitPresentation").querySelector('[data-presentation-action="open"]').click();
    await vi.waitFor(() => expect(h.commands.at(-1)?.presentationAction).toBe("open"));
    h.emit("narrativePresentationResult", {
      ...h.commands.at(-1),
      outcome: "opened",
      slide: 9,
      range: [9, 11],
    });
    await vi.waitFor(() => expect(el("kitPresentation").innerHTML).toContain('data-presentation-action="next"'));

    el("homeBtn").click();
    await vi.waitFor(() => expect(h.commands.at(-1)?.presentationAction).toBe("close"));
    const layersAtClose = h.layers.length;
    el("nextBtn").click();
    el("homeBtn").click();
    h.emit("narrativePresentationResult", { ...h.commands.at(-1), outcome: "closed" });
    await vi.waitFor(() => {
      expect(h.layers.at(-1)).toEqual([...HOME_LAYER_IDS]);
      expect(activeScreen()).toBe("home");
    });
    expect(h.layers).toHaveLength(layersAtClose + 1);
  });

  test("Next can replace Home while navigation-owned person cleanup is pending", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await bootRemote(session);
    await session.h.openCard('[data-open="nova"]');
    el("ticks").querySelector('[data-step="3"]').click();
    await vi.waitFor(() => expect(el("stepTitle").textContent).toBe("Mor Levy"));

    let releaseClear;
    const clearGate = new Promise((resolve) => { releaseClear = resolve; });
    session.h.person = { personId: "ada", revision: 2, datasetVersion: "v", name: "Ada" };
    session.h.clearPerson = vi.fn(async () => {
      await clearGate;
      session.h.person = { personId: null, revision: 3, datasetVersion: "v" };
      return session.h.person;
    });
    el("homeBtn").click();
    await vi.waitFor(() => expect(session.h.clearPerson).toHaveBeenCalled());
    expect(el("prevBtn").disabled).toBe(false);
    expect(el("nextBtn").disabled).toBe(false);
    el("nextBtn").click();
    releaseClear();
    await vi.waitFor(() => expect(el("stepTitle").textContent).not.toBe("Mor Levy"));
    expect(activeScreen()).toBe("player");
  });

  test("ordinary search cleanup continues to block Next and Back", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await bootRemote(session);
    await session.h.openCard('[data-show-step="identity-database"]');

    let releaseClear;
    const clearGate = new Promise((resolve) => { releaseClear = resolve; });
    session.h.person = { personId: "ada", revision: 2, datasetVersion: "v", name: "Ada" };
    session.h.clearPerson = vi.fn(async () => {
      await clearGate;
      session.h.person = { personId: null, revision: 3, datasetVersion: "v" };
      return session.h.person;
    });
    el("searchInput").value = "";
    el("searchInput").dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(session.h.clearPerson).toHaveBeenCalled());
    expect(el("prevBtn").disabled).toBe(true);
    expect(el("nextBtn").disabled).toBe(true);
    releaseClear();
    await vi.waitFor(() => expect(el("searchInput").disabled).toBe(false));
  });

  test("ordinary search cleanup blocks Next after navigation cleanup while its cue is pending", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await bootRemote(session);
    let releaseCue;
    const cueGate = new Promise((resolve) => { releaseCue = resolve; });
    session.h.layerGate = cueGate;
    el("narrativeList").querySelector('[data-show-step="identity-database"]').click();
    await vi.waitFor(() => expect(el("cueStatus").dataset.status).toBe("applying"));

    let releaseClear;
    const clearGate = new Promise((resolve) => { releaseClear = resolve; });
    session.h.person = { personId: "ada", revision: 2, datasetVersion: "v", name: "Ada" };
    session.h.clearPerson = vi.fn(async () => {
      await clearGate;
      session.h.person = { personId: null, revision: 3, datasetVersion: "v" };
      return session.h.person;
    });
    el("searchInput").value = "";
    el("searchInput").dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(session.h.clearPerson).toHaveBeenCalled());
    expect(el("nextBtn").disabled).toBe(true);
    releaseClear();
    await vi.waitFor(() => expect(el("searchInput").disabled).toBe(false));
    releaseCue();
    await vi.waitFor(() => expect(el("cueStatus").dataset.status).not.toBe("applying"));
  });

  test("Home releases navigation ownership before its destination cue applies", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await bootRemote(session);
    let releaseCue;
    session.h.layerGate = new Promise((resolve) => { releaseCue = resolve; });
    session.h.emit("narrativeState", session.h.narrative);
    session.h.emit("connection", true);
    await vi.waitFor(() => expect(el("cueStatus").dataset.status).toBe("applying"));

    el("narrativeList").querySelector('[data-open="nova"]').click();
    await vi.waitFor(() => {
      expect(activeScreen()).toBe("player");
      expect(el("stepTitle").textContent).toBe("The Nova site");
    });
    releaseCue();
    await vi.waitFor(() => expect(el("cueStatus").dataset.status).toBe("ready"));
    expect(session.h.narrative.id).toBe("nova");
    expect(session.h.layers.at(-1)).not.toEqual([...HOME_LAYER_IDS]);
  });

  test("failed initial Home person cleanup shows failure and Retry", async () => {
    setLocale("en", { persist: false });
    session = mount({ person: { personId: "ada", revision: 1, datasetVersion: "v", name: "Ada" } });
    await bootRemote(session);
    session.h.clearPerson = vi.fn(async () => session.h.person);
    session.h.emit("narrativeState", session.h.narrative);
    session.h.emit("connection", true);
    await vi.waitFor(() => expect(session.h.clearPerson).toHaveBeenCalled());
    await vi.waitFor(() => expect(el("homeCueStatus").hidden).toBe(false));
    expect(el("homeCueStatus").textContent).toBe(COPY.en.searchClearFailed);
    expect(el("homeRetry").hidden).toBe(false);

    session.h.clearPerson = vi.fn(async () => {
      session.h.person = { personId: null, revision: 2, datasetVersion: "v" };
      return session.h.person;
    });
    el("homeRetry").click();
    await vi.waitFor(() => expect(el("homeCueStatus").hidden).toBe(true));
    await vi.waitFor(() => expect(session.h.layers.at(-1)).toEqual([...HOME_LAYER_IDS]));
  });
  test("initial Home failure is visible and Retry applies the Home cue", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await bootRemote(session);
    session.h.failNull = true;
    session.h.emit("narrativeState", session.h.narrative);
    session.h.emit("connection", true);
    await vi.waitFor(() => expect(session.h.narratives).toContain(null));
    await vi.waitFor(() => expect(el("homeCueStatus")?.hidden).toBe(false));
    expect(el("homeCueStatus").textContent).toBe("Could not apply this scene");
    expect(el("homeRetry").hidden).toBe(false);

    const failedCalls = session.h.narratives.length;
    session.h.failNull = false;
    el("homeRetry").click();
    await vi.waitFor(() => expect(session.h.narratives.length).toBeGreaterThan(failedCalls));
    await vi.waitFor(() => expect(el("homeRetry").hidden).toBe(true));
    expect(session.h.layers.at(-1)).toEqual([...HOME_LAYER_IDS]);
  });

  test("cue busy state disables the rendered escape and presentation controls", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await bootRemote(session);
    await session.h.openCard('[data-open="nova"]');
    let releaseNova;
    session.h.layerGate = new Promise((resolve) => { releaseNova = resolve; });
    el("ticks").querySelector('[data-step="3"]').click();
    await vi.waitFor(() => expect(el("cueStatus").dataset.status).toBe("applying"));
    expect(el("kitEscape").querySelector("button").disabled).toBe(true);
    expect(el("kitPresentation").querySelector('[data-presentation-action="open"]').disabled).toBe(true);
    releaseNova();
    await vi.waitFor(() => expect(el("cueStatus").dataset.status).toBe("ready"));
  });
  test("sessionless hydrated Home exits once, including over a null narrative, and reconnect or locale does not reset", async () => {
    setLocale("en", { persist: false });
    session = mount({ narrative: { id: null, revision: 4, transition: "steady" } });
    await bootRemote(session);
    const { h } = session;

    expect(h.narratives).toEqual([]);
    h.emit("narrativeState", h.narrative);
    expect(h.narratives).toEqual([]);
    h.emit("connection", true);
    await vi.waitFor(() => expect(h.layers.at(-1)).toEqual([...HOME_LAYER_IDS]));
    expect(h.narratives).toEqual([null]);
    expect(h.commands).toEqual([]);
    expect(el("cueStatus").textContent).toBe("Scene sent");
    expect(el("staffConnection").textContent).toBe("Connected");

    const exit = { id: null, transition: "exit", revision: h.narrative.revision };
    const shura = { id: "shura", requiredNarrative: null };
    const nova = { id: "nova_memorial", requiredNarrative: "nova" };
    const first = shouldCloseViewerForNarrative({ handledExitRevision: 0, state: exit, segment: shura });
    expect(first.close).toBe(true);
    expect(shouldCloseViewerForNarrative({ handledExitRevision: 0, state: exit, segment: nova }).close).toBe(true);
    expect(shouldCloseViewerForNarrative({
      handledExitRevision: first.handledExitRevision,
      state: exit,
      segment: shura,
    }).close).toBe(false);

    h.emit("connection", false);
    h.emit("connection", true);
    h.emit("narrativeState", h.narrative);
    h.emit("escapeOverlay", { individual: true, overlap: false, mor: false, settled: false });
    h.emit("layerGroups", []);
    h.emit("investigationClock", h.clock);
    setLocale("he", { persist: false });
    await Promise.resolve();
    expect(h.narratives).toEqual([null]);
    expect(h.layers).toHaveLength(1);
  });

  test("leaving Home before the hydrated connection suppresses the boot reset", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await bootRemote(session);
    const { h } = session;

    await h.openCard('[data-open="segev"]');
    const layersAfterEnter = h.layers.length;
    h.emit("narrativeState", h.narrative);
    h.emit("connection", true);
    await Promise.resolve();
    await Promise.resolve();
    expect(activeScreen()).toBe("player");
    expect(el("stepTitle").textContent).toBe("The house in Be'eri");
    expect(h.layers).toHaveLength(layersAfterEnter);
    expect(h.layers.at(-1)).not.toEqual([...HOME_LAYER_IDS]);
  });

  test("Home layer sheet opens and closes without resetting the scene, then closes on navigation", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await bootRemote(session);
    const { h } = session;
    const narrativesBefore = h.narratives.length;
    const layersBefore = h.layers.length;

    el("homeLayersBtn").click();
    expect(activeScreen()).toBe("home");
    expect(el("staffPackMenus").hidden).toBe(false);
    expect(el("staffPackMenus").querySelector('[role="dialog"]')).toBeTruthy();
    el("staffPackMenus").querySelector(".layer-sheet-close").click();
    expect(el("staffPackMenus").hidden).toBe(true);
    expect(h.narratives).toHaveLength(narrativesBefore);
    expect(h.layers).toHaveLength(layersBefore);

    el("homeLayersBtn").click();
    await h.openCard('[data-open="segev"]');
    expect(activeScreen()).toBe("player");
    expect(el("staffPackMenus").hidden).toBe(true);
    expect(el("homeLayersBtn").hidden).toBe(true);
  });

  test("Home layer access is disabled while the Home reset is applying", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await bootRemote(session);
    let releaseLayers;
    session.h.layerGate = new Promise((resolve) => { releaseLayers = resolve; });
    session.h.emit("narrativeState", session.h.narrative);
    session.h.emit("connection", true);
    await vi.waitFor(() => expect(el("cueStatus").dataset.status).toBe("applying"));
    expect(el("homeLayersBtn").disabled).toBe(true);
    el("homeLayersBtn").click();
    expect(el("staffPackMenus").hidden).toBe(true);
    releaseLayers();
    await vi.waitFor(() => expect(el("cueStatus").dataset.status).toBe("ready"));
  });

  test("a rendered Segev presentation button dispatches the open command", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await bootRemote(session);
    const { h } = session;
    await h.openCard('[data-open="segev"]');
    const open = el("kitPresentation").querySelector('[data-presentation-action="open"]');
    expect(open).toBeTruthy();
    open.click();
    await vi.waitFor(() => expect(h.commands.at(-1)?.presentationAction).toBe("open"));
  });

  test("a failed close or search clear on a junction rearms the end timer from the latest clock", async () => {
    const synced = [];
    const sync = vi.spyOn(nliTimelineHostMethods, "_syncNliEndedTimer").mockImplementation(function record(clock) {
      synced.push(clock);
    });
    setLocale("en", { persist: false });
    try {
      session = mount();
      await bootRemote(session);
      const { h } = session;

      el("narrativeList").querySelector('[data-open="nova"]').click();
      await vi.waitFor(() => expect(el("stepTitle").textContent).toBe("The Nova site"));
      el("ticks").querySelector('[data-step="3"]').click();
      await vi.waitFor(() => {
        expect(el("stepTitle").textContent).toBe("Mor Levy");
        expect(el("cueStatus").dataset.status).toBe("ready");
      });
      el("kitPresentation").querySelector('[data-presentation-action="open"]').click();
      await vi.waitFor(() => expect(h.commands.at(-1)?.presentationAction).toBe("open"));
      h.emit("narrativePresentationResult", {
        ...h.commands.at(-1),
        outcome: "opened",
        slide: 9,
        range: [9, 11],
      });
      await vi.waitFor(() => expect(el("kitPresentation").innerHTML).toContain('data-presentation-action="close"'));

      const playing = {
        phase: "playing",
        revision: 11,
        loop: false,
        beats: [400, 740],
        membership: ["nli.lines"],
        positionMs: 0,
        anchorMs: 1,
      };
      h.clock = playing;
      const patchesBeforeClose = h.patches.length;
      const seenBeforeClose = synced.length;
      vi.useFakeTimers();
      el("nextBtn").click();
      await Promise.resolve();
      expect(h.commands.at(-1)?.presentationAction).toBe("close");
      const latestDuringClose = { ...playing, revision: 12 };
      h.clock = latestDuringClose;
      h.emit("narrativePresentationResult", { ...h.commands.at(-1), outcome: "unavailable" });
      expect(synced).toHaveLength(seenBeforeClose);
      await vi.advanceTimersByTimeAsync(6000);
      await Promise.resolve();
      vi.useRealTimers();
      await vi.waitFor(() => expect(synced.length).toBeGreaterThan(seenBeforeClose));
      expect(synced.at(-1)).toBe(latestDuringClose);
      expect(synced.at(-1)).not.toBe(playing);
      expect(h.patches).toHaveLength(patchesBeforeClose);
      expect(el("stepTitle").textContent).toBe("Mor Levy");

      el("homeBtn").click();
      await vi.waitFor(() => expect(h.commands.at(-1)?.presentationAction).toBe("close"));
      h.emit("narrativePresentationResult", { ...h.commands.at(-1), outcome: "closed" });
      await vi.waitFor(() => expect(activeScreen()).toBe("home"));
      el("narrativeList").querySelector('[data-open="show"]').click();
      await vi.waitFor(() => expect(el("stepTitle").textContent).toBe("The opening minutes"));
      await vi.waitFor(() => expect(el("cueStatus").dataset.status).not.toBe("applying"));
      const junction = document.createElement("button");
      junction.dataset.step = "1";
      el("ticks").append(junction);
      h.clock = { ...playing, revision: 20 };
      junction.click();
      await vi.waitFor(() => expect(el("stepTitle").textContent).toBe("Segev family"));
      await vi.waitFor(() => expect(el("cueStatus").dataset.status).not.toBe("applying"));

      const previousClock = h.clock;
      const patchesBeforeClear = h.patches.length;
      const seenBeforeClear = synced.length;
      h.person = { personId: "ada", revision: 30, datasetVersion: "v" };
      h.clearPerson = vi.fn(async () => {
        h.clock = { ...previousClock, revision: previousClock.revision + 4 };
        return { personId: "ada", revision: 30, datasetVersion: "v" };
      });
      el("nextBtn").click();
      await vi.waitFor(() => expect(synced.length).toBeGreaterThan(seenBeforeClear));
      expect(synced.at(-1)).toBe(h.clock);
      expect(synced.at(-1)).not.toBe(previousClock);
      expect(synced.at(-1).revision).toBe(previousClock.revision + 4);
      expect(h.patches).toHaveLength(patchesBeforeClear);
      expect(el("stepTitle").textContent).toBe("Segev family");
    } finally {
      sync.mockRestore();
    }
  });

  test("staff escape buttons follow the step kinds, not whichever live overlay flags are on", async () => {
    setLocale("en", { persist: false });
    session = mount();
    session.h.escape = { individual: true, overlap: false, mor: true, settled: false };
    await bootRemote(session);
    const { h } = session;

    await h.openCard('[data-open="nova"]');
    el("ticks").querySelector('[data-step="3"]').click();
    await vi.waitFor(() => expect(el("stepTitle").textContent).toBe("Mor Levy"));
    expect(el("kitEscape").innerHTML).toContain('data-nli-nova-escape="mor"');
    expect(el("kitEscape").innerHTML).not.toContain('data-nli-nova-escape="individual"');
  });
});
