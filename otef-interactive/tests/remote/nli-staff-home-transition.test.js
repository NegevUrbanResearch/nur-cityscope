/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { COPY, HOME_CUE, HOME_LAYER_IDS } from "../../frontend/src/remote/nli-staff-script.js";
import { nliTimelineHostMethods } from "../../frontend/src/remote/nli-timeline-transport.js";
import { shouldCloseViewerForNarrative } from "../../frontend/src/map/nli-reveal-presentation.js";
import { setLocale } from "../../frontend/src/remote/remote-locale.js";

const FIXTURE = `
  <div class="app">
    <button type="button" id="homeBtn" hidden></button>
    <button type="button" id="localeHe"></button>
    <button type="button" id="localeEn"></button>
    <span id="staffConnection"></span>
    <section class="screen is-active" data-screen="home">
      <div id="narrativeList"></div>
    </section>
    <section class="screen" data-screen="player" hidden>
      <span id="playerScript"></span>
      <span id="stepCount"></span>
      <div id="ticks"></div>
      <div id="stepClock"></div>
      <h1 id="stepTitle"></h1>
      <p id="stepNote"></p>
      <p id="stepGis"></p>
      <p id="stepModel"></p>
      <div id="playerKit">
        <p id="cueStatus"></p>
        <div id="kitSearch">
          <div id="searchKit">
            <input id="searchInput" />
            <ul id="searchResults"></ul>
            <p id="freeStatus" hidden></p>
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
    <section class="screen" data-screen="free" hidden>
      <p id="freeCueStatus"></p>
      <div id="sceneList"></div>
    </section>
    <div id="staffPackMenus" hidden></div>
  </div>
`;

const el = (id) => document.getElementById(id);

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
    getLayerGroups: () => [],
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

  test("cue status reports sending or failure, and connection copy stays separate", () => {
    expect(COPY.en.cueApplying).toBe("Sending the scene…");
    expect(COPY.en.cueReady).toBe("Scene sent");
    expect(COPY.en.cueFailed).toBe("Could not send the scene");
    expect(COPY.he.cueApplying).toBe("שולח את הסצנה…");
    expect(COPY.he.cueReady).toBe("הסצנה נשלחה");
    expect(COPY.he.cueFailed).toBe("שליחת הסצנה נכשלה");
    expect(COPY.en.cueReady).not.toMatch(/both displays|Map is set/i);
    expect(COPY.he.cueReady).not.toMatch(/מוכנה|שני המסכים/);
    expect(COPY.en.connected).toBe("Connected");
    expect(COPY.en.disconnected).toBe("Map is disconnected");
  });

  test("header Home, narrative finish, Free, and a selected person apply the Home cue", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await bootRemote(session);
    const { h } = session;

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

    await h.openCard('[data-open="segev"]');
    const layersBeforeFinish = h.layers.length;
    el("nextBtn").click();
    await vi.waitFor(() => {
      expect(h.layers.length).toBeGreaterThan(layersBeforeFinish);
      expect(activeScreen()).toBe("home");
    });
    expect(h.layers.at(-1)).toEqual([...HOME_LAYER_IDS]);

    await h.openCard('[data-open-free="1"]');
    expect(activeScreen()).toBe("free");
    el("homeBtn").click();
    await vi.waitFor(() => {
      expect(h.layers.at(-1)).toEqual([...HOME_CUE.layers]);
      expect(activeScreen()).toBe("home");
    });
  });

  test("name-wall Home resets to the Home cue and a null narrative failure stays failed and retryable", async () => {
    setLocale("en", { persist: false });
    session = mount({ narrative: { id: null, revision: 1, transition: "steady" } });
    await bootRemote(session);
    const { h } = session;

    await h.openCard('[data-show-step="names-wall"]');
    expect(el("stepTitle").textContent).toBe("Wall of names");
    const nullCallsBefore = h.narratives.filter((id) => id === null).length;
    el("homeBtn").click();
    await vi.waitFor(() => {
      expect(h.narratives.filter((id) => id === null).length).toBeGreaterThan(nullCallsBefore);
      expect(activeScreen()).toBe("home");
    });
    expect(h.layers.at(-1)).toEqual([...HOME_LAYER_IDS]);
    expect(h.commands).toEqual([]);

    await h.openCard('[data-open="segev"]');
    h.failNull = true;
    el("homeBtn").click();
    await vi.waitFor(() => {
      expect(el("cueStatus").dataset.status).toBe("failed");
      expect(activeScreen()).toBe("player");
    });
    expect(el("cueStatus").textContent).toBe("Could not send the scene");
    expect(el("cueStatus").textContent).not.toBe("Scene sent");
    expect(activeScreen()).not.toBe("home");
    expect(el("homeBtn").hidden).toBe(false);

    h.failNull = false;
    el("homeBtn").click();
    await vi.waitFor(() => expect(el("cueStatus").dataset.status).toBe("ready"));
    expect(h.layers.at(-1)).toEqual([...HOME_LAYER_IDS]);
    expect(activeScreen()).toBe("home");
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
    el("nextBtn").click();
    await vi.waitFor(() => expect(h.commands.at(-1)?.presentationAction).toBe("close"));
    await Promise.resolve();
    expect(h.layers.length).toBe(layersAtClose);
    expect(h.narratives.length).toBe(narrativesAtClose);
    expect(el("stepTitle").textContent).toBe("Mor Levy");

    h.emit("narrativePresentationResult", { ...h.commands.at(-1), outcome: "unavailable" });
    await vi.waitFor(() => expect(el("kitPresentation").textContent).toContain("Presentation unavailable"));
    await new Promise((resolve) => setTimeout(resolve, 0));
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

    el("nextBtn").click();
    await vi.waitFor(() => expect(h.commands.at(-1)?.presentationAction).toBe("close"));
    const layersAtClose = h.layers.length;
    el("homeBtn").click();
    h.emit("narrativePresentationResult", { ...h.commands.at(-1), outcome: "closed" });
    await vi.waitFor(() => {
      expect(h.layers.at(-1)).toEqual([...HOME_LAYER_IDS]);
      expect(activeScreen()).toBe("home");
    });
    expect(h.layers).toHaveLength(layersAtClose + 1);
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

  test("turning the Free opening preset off applies Home, and turning the loop off still clears layers", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await bootRemote(session);
    const { h } = session;

    el("narrativeList").querySelector("[data-open-free]").click();
    await vi.waitFor(() => expect(el("sceneList").querySelector('[data-scene="open"]')).toBeTruthy());
    el("sceneList").querySelector('[data-scene="open"]').click();
    await vi.waitFor(() => expect(h.layers.at(-1)).toEqual([...HOME_LAYER_IDS]));
    el("sceneList").querySelector('[data-scene="open"]').click();
    await vi.waitFor(() => expect(h.layers).toHaveLength(2));
    expect(h.layers.at(-1)).toEqual([...HOME_LAYER_IDS]);
    expect(h.narratives.at(-1)).toBe(null);

    h.clock = { phase: "playing", revision: 9 };
    el("sceneList").querySelector('[data-scene="loop"]').click();
    await vi.waitFor(() => expect(el("cueStatus").dataset.status).toBe("failed"));
    el("sceneList").querySelector('[data-scene="loop"]').click();
    await vi.waitFor(() => expect(h.layers.at(-1)).toEqual([]));
  });

  test("Free opening closes a known presentation and clears search before Home", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await bootRemote(session);
    const { h } = session;

    el("narrativeList").querySelector("[data-open-free]").click();
    await vi.waitFor(() => expect(el("sceneList").querySelector('[data-scene="open"]')).toBeTruthy());
    h.person = { personId: "ada", revision: 3, datasetVersion: "v" };
    const layersBefore = h.layers.length;
    const narrativesBefore = h.narratives.length;
    h.clearPerson = vi.fn(async () => {
      expect(h.layers).toHaveLength(layersBefore);
      expect(h.narratives).toHaveLength(narrativesBefore);
      h.person = { personId: null, revision: 4, datasetVersion: "v" };
      return h.person;
    });
    el("sceneList").querySelector('[data-scene="open"]').click();
    await vi.waitFor(() => expect(h.clearPerson).toHaveBeenCalled());
    await vi.waitFor(() => expect(h.layers.at(-1)).toEqual([...HOME_LAYER_IDS]));
    expect(h.narratives.at(-1)).toBeNull();
    expect(activeScreen()).toBe("free");
    expect(el("sceneList").querySelector('[data-scene="open"]').classList.contains("is-active")).toBe(true);

    h.person = { personId: "bea", revision: 5, datasetVersion: "v" };
    h.clearPerson = vi.fn(async () => ({ personId: "bea", revision: 5, datasetVersion: "v" }));
    const layersAtFailure = h.layers.length;
    const narrativesAtFailure = h.narratives.length;
    el("sceneList").querySelector('[data-scene="open"]').click();
    await vi.waitFor(() => expect(h.clearPerson).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.layers).toHaveLength(layersAtFailure);
    expect(h.narratives).toHaveLength(narrativesAtFailure);
    expect(h.person.personId).toBe("bea");
    expect(activeScreen()).toBe("free");
    expect(el("sceneList").querySelector('[data-scene="open"]').classList.contains("is-active")).toBe(true);

    h.clearPerson = vi.fn(async () => {
      h.person = { personId: null, revision: h.person.revision + 1, datasetVersion: "v" };
      return h.person;
    });
    el("homeBtn").click();
    await vi.waitFor(() => expect(activeScreen()).toBe("home"));
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

    h.person = { personId: "ada", revision: 8, datasetVersion: "v" };
    h.clearPerson = vi.fn(async () => {
      h.person = { personId: null, revision: 9, datasetVersion: "v" };
      return h.person;
    });
    const layersAtClose = h.layers.length;
    const narrativesAtClose = h.narratives.length;
    el("sceneList").querySelector('[data-scene="open"]').click();
    await vi.waitFor(() => expect(h.commands.at(-1)?.presentationAction).toBe("close"));
    expect(h.clearPerson).not.toHaveBeenCalled();
    expect(h.layers).toHaveLength(layersAtClose);
    expect(h.narratives).toHaveLength(narrativesAtClose);
    h.emit("narrativePresentationResult", { ...h.commands.at(-1), outcome: "unavailable" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.clearPerson).not.toHaveBeenCalled();
    expect(h.layers).toHaveLength(layersAtClose);
    expect(h.narratives).toHaveLength(narrativesAtClose);
    expect(activeScreen()).not.toBe("home");

    el("sceneList").querySelector('[data-scene="open"]').click();
    await vi.waitFor(() => expect(h.commands.at(-1)?.presentationAction).toBe("close"));
    h.emit("narrativePresentationResult", { ...h.commands.at(-1), outcome: "closed" });
    await vi.waitFor(() => expect(h.layers.at(-1)).toEqual([...HOME_LAYER_IDS]));
    expect(h.clearPerson).toHaveBeenCalled();
    expect(h.narratives.at(-1)).toBeNull();
    expect(activeScreen()).not.toBe("home");
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
      el("nextBtn").click();
      await vi.waitFor(() => expect(h.commands.at(-1)?.presentationAction).toBe("close"));
      const latestDuringClose = { ...playing, revision: 12 };
      h.clock = latestDuringClose;
      h.emit("narrativePresentationResult", { ...h.commands.at(-1), outcome: "unavailable" });
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
