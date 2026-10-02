/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createFakeMapLibreMap } from "../helpers/fake-maplibre-map.js";
import { setupWebSocket } from "../../frontend/src/shared/otef-data-context/OTEFDataContext-websocket.js";
import OTEFDataContext from "../../frontend/src/shared/OTEFDataContext.js";
import { OTEF_MESSAGE_TYPES } from "../../frontend/src/shared/message-protocol.js";
import {
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
  timelineBeatDurationMs,
} from "../../frontend/src/shared/nli-investigation-beats.js";
import { nliPlayableIdsFromGroups } from "../../frontend/src/shared/nli-investigation-clock.js";
import { deriveInvestigationFrame } from "../../frontend/src/shared/nli-investigation-visual-state.js";
import { novaVirtualMembership } from "../../frontend/src/shared/nli-nova-virtual-membership.js";
import {
  createNovaEscapeCoordinator,
  NOVA_ESCAPE_IMPACT_LAYER_ID,
  NOVA_ESCAPE_INDIVIDUAL_LAYER_ID,
  NOVA_FLEEING_IMPACT_INDEX_URL,
  NOVA_FLEEING_INDIVIDUAL_URL,
} from "../../frontend/src/shared/nli-nova-escape-coordinator.js";
import { DEFAULT_INVESTIGATION_SETTLEMENTS_URL } from "../../frontend/src/shared/nli-investigation-timeline-data.js";
import { HOME_LAYER_IDS, NARRATIVES, TIMELINE_LAYER_IDS } from "../../frontend/src/remote/nli-staff-script.js";
import { setLocale } from "../../frontend/src/remote/remote-locale.js";
import { sha256Hex } from "../../frontend/src/shared/sha256-hex.js";
import { presenterCopyKey } from "../../frontend/src/remote/nli-presenter-content.js";

const STORY_MINUTES = [389, 401, 402, 780];
const ESCAPE_URLS = new Set([
  NOVA_FLEEING_INDIVIDUAL_URL,
  NOVA_FLEEING_IMPACT_INDEX_URL,
  DEFAULT_INVESTIGATION_SETTLEMENTS_URL,
]);
const NO_ESCAPE = { individual: false, overlap: false, mor: false, settled: false };
const PLAYABLE_LAYER_IDS = ["investigation_polygons", "lines", "alarms"];

const FIXTURE = `
  <div class="app">
    <button type="button" id="homeBtn" hidden></button>
    <button type="button" id="homeLayersBtn" hidden></button>
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
      <div id="playerCueFailure" hidden role="alert"><span id="playerCueFailureText"></span><button id="playerCueRetry">Retry</button></div>
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

function storyCollection() {
  return {
    type: "FeatureCollection",
    features: STORY_MINUTES.map((timeline_minutes) => ({
      type: "Feature",
      properties: { timeline_minutes },
      geometry: { type: "LineString", coordinates: [[34.4, 31.4], [34.5, 31.5]] },
    })),
  };
}

function layerGroupsFor(enabledIds) {
  const enabled = new Set(enabledIds);
  const buckets = new Map();
  for (const fullId of enabledIds) {
    const dot = fullId.indexOf(".");
    const groupId = fullId.slice(0, dot);
    const layerId = fullId.slice(dot + 1);
    if (groupId === "nli" && PLAYABLE_LAYER_IDS.includes(layerId)) continue;
    const rows = buckets.get(groupId) || [];
    rows.push({ id: layerId, enabled: true });
    buckets.set(groupId, rows);
  }
  const nli = buckets.get("nli") || [];
  buckets.set("nli", [
    ...PLAYABLE_LAYER_IDS.map((id) => ({ id, enabled: enabled.has(`nli.${id}`) })),
    ...nli,
  ]);
  return [...buckets.entries()].map(([id, layers]) => ({ id, layers }));
}

function enabledFullIds(groups) {
  const ids = [];
  for (const group of groups || []) {
    for (const layer of group.layers || []) {
      if (layer?.enabled) ids.push(`${group.id}.${layer.id}`);
    }
  }
  return ids;
}

function createFollower(name) {
  const follower = new OTEFDataContext.constructor();
  follower._tableName = "otef";
  follower._clientId = `follower-${name}`;
  setupWebSocket(follower);
  follower._wsClient.disconnect();
  return follower;
}

function readFollower(follower) {
  const narrativeId = follower.getNarrativeState().id;
  const clock = follower.getInvestigationClock();
  const groups = follower.getLayerGroups();
  const chips = nliPlayableIdsFromGroups(groups);
  return {
    narrativeId,
    clock,
    chips,
    layers: enabledFullIds(groups),
    escape: follower.getEscapeOverlay(),
    virtual: novaVirtualMembership(chips, narrativeId, clock),
    viewport: follower._viewport ?? null,
  };
}

function sameMembers(actual, expected) {
  expect([...actual].sort()).toEqual([...expected].sort());
}

function expectHome(view) {
  sameMembers(view.layers, HOME_LAYER_IDS);
  expect(view.narrativeId).toBeNull();
  expect(view.clock.phase).toBe("idle");
  expect(view.escape).toEqual(NO_ESCAPE);
  expect(view.chips).toEqual([]);
  expect(view.virtual).toEqual([]);
  expect(view.viewport).toBeNull();
}

function mount() {
  const added = [];
  const realAdd = window.addEventListener.bind(window);
  const realRemove = window.removeEventListener.bind(window);
  window.addEventListener = (type, fn, opts) => {
    added.push([type, fn, opts]);
    realAdd(type, fn, opts);
  };
  document.body.innerHTML = FIXTURE;
  const listeners = new Map();
  const followers = [createFollower("gis"), createFollower("projection")];
  const h = {
    layers: [],
    commands: [],
    failNull: false,
    groups: [],
    narrative: { id: null, revision: 1, transition: "steady" },
    clock: { phase: "idle", membership: [], beats: [], loop: false, positionMs: 0, anchorMs: null, seekKind: "none", revision: 0 },
    escape: { ...NO_ESCAPE },
    person: { personId: null, datasetVersion: null, revision: 1 },
    followers,
    dispose() {
      for (const follower of followers) follower._wsClient?.disconnect();
      for (const [type, fn, opts] of added) realRemove(type, fn, opts);
      window.addEventListener = realAdd;
      document.body.innerHTML = "";
    },
    emit(topic, value) {
      for (const listener of listeners.get(topic) || []) listener(value);
    },
    publish(message) {
      for (const follower of followers) follower._wsClient.handleMessage(message);
    },
  };

  function sceneMessage() {
    return {
      type: OTEF_MESSAGE_TYPES.NARRATIVE_SCENE_CHANGED,
      table: "otef",
      sourceId: "staff-scene",
      scene: {
        sceneRevision: h.narrative.revision,
        narrativeState: h.narrative,
        basemap: h.narrative.id ? "satellite_bw" : "dark",
        investigationClock: h.clock,
        personSelection: h.person,
        escapeOverlay: h.escape,
      },
    };
  }

  const dataContext = {
    isConnected: () => false,
    correctedNow: () => 50_000,
    getNarrativeState: () => h.narrative,
    getPersonSelection: () => h.person,
    getInvestigationClock: () => h.clock,
    getEscapeOverlay: () => h.escape,
    getLayerGroups: () => h.groups,
    getLegendSettings: () => ({ language: "en" }),
    getProjectionSlideshow: () => null,
    setNarrative: async (id) => {
      if (id === null && h.failNull) {
        h.failNull = false;
        return { ok: false, error: new Error("narrative rejected") };
      }
      h.narrative = {
        id,
        revision: h.narrative.revision + 1,
        transition: id === null ? "exit" : "enter",
      };
      h.publish(sceneMessage());
      h.emit("narrativeState", h.narrative);
      return { ok: true };
    },
    setEnabledLayerIds: async (ids) => {
      h.layers.push([...ids]);
      h.groups = layerGroupsFor(ids);
      h.publish({
        type: OTEF_MESSAGE_TYPES.LAYERS_CHANGED,
        layerGroups: h.groups,
      });
      h.emit("layerGroups", h.groups);
      return { ok: true };
    },
    setEscapeOverlay: async (overlay) => {
      h.escape = { ...NO_ESCAPE, ...overlay };
      h.publish({
        type: OTEF_MESSAGE_TYPES.ESCAPE_OVERLAY_CHANGED,
        table: "otef",
        escapeOverlay: h.escape,
      });
      h.emit("escapeOverlay", h.escape);
      return { ok: true };
    },
    patchInvestigationClock: async (next, options = {}) => {
      if (typeof options.isCurrent === "function" && !options.isCurrent()) {
        return { ok: false, stale: true };
      }
      h.clock = { ...next, revision: (Number(h.clock.revision) || 0) + 1, serverNowMs: 50_000 };
      h.publish({
        type: OTEF_MESSAGE_TYPES.INVESTIGATION_CLOCK_CHANGED,
        investigationClock: h.clock,
      });
      h.emit("investigationClock", h.clock);
      return { ok: true, clock: h.clock };
    },
    clearPerson: async () => {
      h.person = { personId: null, datasetVersion: null, revision: h.person.revision + 1 };
      return h.person;
    },
    narrativePresentationCommand: async (command) => {
      h.commands.push(command);
      const outcome = command.presentationAction === "open"
        ? "opened"
        : command.presentationAction === "close"
          ? "closed"
          : "ready";
      h.emit("narrativePresentationResult", {
        ...command,
        outcome,
        slide: 1,
        range: [1, 8],
      });
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

  globalThis.OTEFDataContext = dataContext;
  globalThis.layerRegistry = { getLayerDataUrl: () => "/nli-story.json" };
  return { h, dataContext };
}

async function boot(session, options) {
  const { initNliStaffRemote } = await import("../../frontend/src/remote/nli-staff-remote.js");
  session.remote = initNliStaffRemote(session.dataContext, options);
  session.h.emit("narrativeState", session.h.narrative);
  session.h.emit("connection", true);
  await vi.waitFor(() => {
    expect(session.h.layers.at(-1)).toEqual([...HOME_LAYER_IDS]);
    for (const view of session.h.followers.map(readFollower)) expectHome(view);
  });
}

async function syntheticPresenterManifest() {
  const features = storyCollection().features;
  const hash = await sha256Hex(new TextEncoder().encode(JSON.stringify(features)));
  const membership = PLAYABLE_LAYER_IDS.map((id) => `nli.${id}`);
  const records = Object.fromEntries(STORY_MINUTES.map((minute) => [
    presenterCopyKey(null, membership, minute),
    { en: { timeLabel: String(minute), title: `Event ${minute}` },
      he: { timeLabel: String(minute), title: `אירוע ${minute}` } },
  ]));
  return { schemaVersion: 1, datasetVersion: "synthetic-v1", acceptedSourceSha256: "test-source",
    requiredArtifacts: Object.fromEntries(membership.map((id) => [id, hash])), records };
}

async function openCard(selector) {
  el("narrativeList").querySelector(selector).click();
  await vi.waitFor(() => expect(el("cueStatus").dataset.status).toBe("ready"));
}

async function clickNextReady(title) {
  el("nextBtn").click();
  await vi.waitFor(() => {
    expect(el("stepTitle").textContent).toBe(title);
    expect(el("cueStatus").dataset.status).toBe("ready");
  });
}

function views(session) {
  return session.h.followers.map(readFollower);
}

describe("NLI staff scene integration", () => {
  let session;
  let coordinators = [];
  let escapePending = null;

  beforeEach(() => {
    escapePending = null;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (escapePending && ESCAPE_URLS.has(String(url))) await escapePending;
      if (String(url) === NOVA_FLEEING_IMPACT_INDEX_URL) {
        return {
          ok: true,
          json: async () => ({ schemaVersion: 1, routeIds: ["1"], parallelCrossings: [], settlementCrossings: [] }),
        };
      }
      return { ok: true, json: async () => storyCollection() };
    }));
  });

  afterEach(() => {
    for (const coordinator of coordinators) coordinator.dispose();
    coordinators = [];
    session?.remote?.dispose();
    session?.h.dispose();
    session = null;
    globalThis.OTEFDataContext = OTEFDataContext;
    delete globalThis.layerRegistry;
    vi.unstubAllGlobals();
    setLocale("he", { force: true, persist: false });
  });

  test("Home, first minutes, Segev, and the rest of the day settle on both followers", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await boot(session);
    expect(session.dataContext.setExhibitMode).toHaveBeenCalledWith(true);
    const trueCallsAfterBoot = session.dataContext.setExhibitMode.mock.calls.filter(([value]) => value === true).length;

    await openCard('[data-open="show"]');
    expect(el("stepTitle").textContent).toBe("The opening minutes");
    for (const view of views(session)) {
      expect(view.narrativeId).toBeNull();
      expect(view.clock.phase).toBe("playing");
      expect(view.clock.beats.length).toBeGreaterThan(0);
      expect(view.clock.beats.every((beat) => beat <= 401)).toBe(true);
      sameMembers(view.layers, TIMELINE_LAYER_IDS);
      expect(view.viewport).toBeNull();
    }

    el("nextChoices").querySelector('[data-branch="segev"]').click();
    await vi.waitFor(() => {
      expect(el("stepTitle").textContent).toBe("The house in Be'eri");
      expect(el("cueStatus").dataset.status).toBe("ready");
    });
    const segevLayers = NARRATIVES.find((item) => item.id === "segev").steps[0].cue.layers;
    for (const view of views(session)) {
      expect(view.narrativeId).toBe("segev");
      expect(view.clock.phase).toBe("idle");
      sameMembers(view.layers, segevLayers);
      expect(view.layers).toContain("nli.narrative_polygon");
      expect(view.chips).toEqual([]);
      expect(view.virtual).toEqual([]);
      expect(view.viewport).toBeNull();
    }

    await clickNextReady("The rest of the day");
    expect(session.dataContext.setExhibitMode.mock.calls.filter(([value]) => value === true).length)
      .toBeGreaterThan(trueCallsAfterBoot);
    for (const view of views(session)) {
      expect(view.narrativeId).toBeNull();
      expect(view.clock.phase).toBe("playing");
      expect(view.clock.leadInMinutes).toBe(402);
      expect(view.clock.beats.some((beat) => beat > 401)).toBe(true);
      sameMembers(view.layers, TIMELINE_LAYER_IDS);
      expect(view.escape).toEqual(NO_ESCAPE);
      expect(view.viewport).toBeNull();
    }
  });

  test("the direct timeline ends on the idle complete story", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await boot(session);
    await openCard('[data-open="timeline"]');
    await clickNextReady("The rest of the day");
    await clickNextReady("The full timeline");
    const writes = vi.spyOn(session.dataContext, "patchInvestigationClock");
    session.remote.render();
    expect(writes).not.toHaveBeenCalled();
    for (const view of views(session)) {
      expect(view.narrativeId).toBeNull();
      expect(view.clock.phase).toBe("idle");
      expect(view.escape).toEqual(NO_ESCAPE);
      sameMembers(view.layers, TIMELINE_LAYER_IDS);
      expect(view.chips).toEqual(expect.arrayContaining([
        INVESTIGATION_POLYGONS_FULL_ID,
        INVESTIGATION_LINES_FULL_ID,
      ]));
      const frame = deriveInvestigationFrame(view.clock, 99_000, view.layers, {
        motionMode: "full",
        storyBeats: STORY_MINUTES,
        polygonMotionActive: true,
        narrativeId: null,
      });
      expect(frame.narrative).toMatchObject({ phase: "idle", advances: false });
      expect(view.viewport).toBeNull();
    }
  });

  test("staff timeline mounts the presenter controls without legacy transport controls", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await boot(session);
    await openCard('[data-open="timeline"]');
    const root = el("kitTimeline");
    expect(root.querySelector("[data-presenter-list]")).not.toBeNull();
    expect(root.querySelector("[data-presenter-play]")).not.toBeNull();
    expect(root.querySelector(".nli-transport-scrub, [data-nli-action='stop'], [data-nli-action='loop']")).toBeNull();
    const list = root.querySelector("[data-presenter-list]");
    session.h.emit("investigationClock", session.h.clock);
    expect(root.querySelector("[data-presenter-list]")).toBe(list);
    expect(el("kitSearch")).not.toBeNull();
    expect(el("nextBtn")).not.toBeNull();
  });

  test("verified staff event rows retain identity through clock updates and browsing does not write", async () => {
    setLocale("en", { persist: false });
    session = mount();
    const writes = vi.spyOn(session.dataContext, "patchInvestigationClock");
    await boot(session, { presenterManifest: await syntheticPresenterManifest() });
    await openCard('[data-open="timeline"]');
    await vi.waitFor(() => expect(el("kitTimeline").querySelectorAll("[data-presenter-event]")).toHaveLength(2));
    const root = el("kitTimeline").firstElementChild;
    const list = el("kitTimeline").querySelector("[data-presenter-list]");
    const row = list.querySelector("[data-presenter-event]");
    const writesBeforeBrowse = writes.mock.calls.length;
    row.focus();
    list.scrollTop = 32;
    list.dispatchEvent(new Event("scroll"));
    expect(writes).toHaveBeenCalledTimes(writesBeforeBrowse);
    session.h.emit("investigationClock", session.h.clock);
    expect(el("kitTimeline").firstElementChild).toBe(root);
    expect(el("kitTimeline").querySelector("[data-presenter-list]")).toBe(list);
    expect(list.querySelector("[data-presenter-event]")).toBe(row);
    expect(list.scrollTop).toBe(32);
    expect(writes).toHaveBeenCalledTimes(writesBeforeBrowse);
    await clickNextReady("The rest of the day");
    await vi.waitFor(() => expect(el("kitTimeline").querySelectorAll("[data-presenter-event]")).toHaveLength(2));
    await clickNextReady("The full timeline");
    await vi.waitFor(() => expect(el("kitTimeline").querySelectorAll("[data-presenter-event]")).toHaveLength(4));
  });

  test("rejected presenter event keeps its applied state and Retry only refetches", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await boot(session, { presenterManifest: await syntheticPresenterManifest() });
    await openCard('[data-open="timeline"]');
    await vi.waitFor(() => expect(el("kitTimeline").querySelectorAll("[data-presenter-event]")).toHaveLength(2));
    const before = session.h.clock;
    const originalPatch = session.dataContext.patchInvestigationClock;
    const rejectedPatch = vi.fn(async () => ({ ok: false, error: new Error("rejected") }));
    session.dataContext.patchInvestigationClock = rejectedPatch;
    el("kitTimeline").querySelectorAll("[data-presenter-event]")[1].click();
    await vi.waitFor(() => expect(el("cueStatus").dataset.status).toBe("presenter-failed"));
    expect(rejectedPatch).toHaveBeenCalledTimes(1);
    expect(session.h.clock).toBe(before);
    const writes = rejectedPatch.mock.calls.length;
    el("kitTimeline").querySelector("[data-presenter-retry]").click();
    await vi.waitFor(() => expect(el("cueStatus").dataset.status).toBe("ready"));
    expect(rejectedPatch).toHaveBeenCalledTimes(writes);
    session.dataContext.patchInvestigationClock = originalPatch;
  });

  test("a presenter failure clears at the next scene boundary", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await boot(session, { presenterManifest: await syntheticPresenterManifest() });
    await openCard('[data-open="timeline"]');
    await vi.waitFor(() => expect(el("kitTimeline").querySelectorAll("[data-presenter-event]")).toHaveLength(2));
    const originalPatch = session.dataContext.patchInvestigationClock;
    session.dataContext.patchInvestigationClock = vi.fn(async () => ({ ok: false, error: new Error("rejected") }));
    el("kitTimeline").querySelectorAll("[data-presenter-event]")[1].click();
    await vi.waitFor(() => expect(el("cueStatus").dataset.status).toBe("presenter-failed"));
    session.dataContext.patchInvestigationClock = originalPatch;
    await clickNextReady("The rest of the day");
    expect(el("cueStatus").dataset.status).toBe("ready");
    expect(el("cueStatus").textContent).not.toMatch(/Timeline action failed/);
    session.dataContext.patchInvestigationClock = vi.fn(async () => ({ ok: false, error: new Error("rejected again") }));
    await vi.waitFor(() => expect(el("kitTimeline").querySelectorAll("[data-presenter-event]")).toHaveLength(2));
    el("kitTimeline").querySelectorAll("[data-presenter-event]")[0].click();
    await vi.waitFor(() => expect(el("cueStatus").dataset.status).toBe("presenter-failed"));
    session.dataContext.patchInvestigationClock = originalPatch;
    el("homeBtn").click();
    await vi.waitFor(() => expect(document.querySelector(".screen.is-active")?.dataset.screen).toBe("home"));
    expect(el("cueStatus").dataset.status).toBe("ready");
  });

  test("a published advancing beat changes the applied card and current row without a staff clock write", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await boot(session, { presenterManifest: await syntheticPresenterManifest() });
    await openCard('[data-open="timeline"]');
    await vi.waitFor(() => expect(el("kitTimeline").querySelectorAll("[data-presenter-event]")).toHaveLength(2));
    const rows = [...el("kitTimeline").querySelectorAll("[data-presenter-event]")];
    const clock = session.h.clock;
    const writes = vi.spyOn(session.dataContext, "patchInvestigationClock");
    session.h.clock = { ...clock, positionMs: timelineBeatDurationMs(clock.beats[0]) + 1,
      anchorMs: session.dataContext.correctedNow(), revision: clock.revision + 1 };
    session.h.emit("investigationClock", session.h.clock);
    expect(el("kitTimeline").querySelector("[data-presenter-title]").textContent).toBe("Event 401");
    expect(rows[0].hasAttribute("aria-current")).toBe(false);
    expect(rows[1].getAttribute("aria-current")).toBe("true");
    expect(writes).not.toHaveBeenCalled();
  });

  test("hash mismatch Retry refetches corrected features without writing the clock", async () => {
    setLocale("en", { persist: false });
    session = mount();
    const normalFetch = globalThis.fetch;
    let corrected = false;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const response = await normalFetch(url);
      if (corrected || ESCAPE_URLS.has(String(url))) return response;
      const json = await response.json();
      return { ok: true, json: async () => ({ ...json,
        features: json.features?.map((feature) => ({ ...feature, properties: { ...feature.properties, extra: "wrong" } })) }) };
    }));
    const writes = vi.spyOn(session.dataContext, "patchInvestigationClock");
    await boot(session, { presenterManifest: await syntheticPresenterManifest() });
    await openCard('[data-open="timeline"]');
    await vi.waitFor(() => expect(el("kitTimeline").querySelector("[data-presenter-retry]").hidden).toBe(false));
    expect(el("kitTimeline").querySelectorAll("[data-presenter-event]")).toHaveLength(0);
    corrected = true;
    const before = writes.mock.calls.length;
    el("kitTimeline").querySelector("[data-presenter-retry]").click();
    await vi.waitFor(() => expect(el("kitTimeline").querySelectorAll("[data-presenter-event]")).toHaveLength(2));
    expect(writes).toHaveBeenCalledTimes(before);
  });

  test("Home invalidates a delayed event acknowledgement before it repaints", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await boot(session, { presenterManifest: await syntheticPresenterManifest() });
    await openCard('[data-open="timeline"]');
    await vi.waitFor(() => expect(el("kitTimeline").querySelectorAll("[data-presenter-event]")).toHaveLength(2));
    const originalPatch = session.dataContext.patchInvestigationClock;
    let acknowledge;
    session.dataContext.patchInvestigationClock = vi.fn(() => new Promise((resolve) => { acknowledge = resolve; }));
    el("kitTimeline").querySelectorAll("[data-presenter-event]")[1].click();
    await vi.waitFor(() => expect(acknowledge).toBeTypeOf("function"));
    session.dataContext.patchInvestigationClock = originalPatch;
    el("homeBtn").click();
    await vi.waitFor(() => expect(document.querySelector(".screen.is-active")?.dataset.screen).toBe("home"));
    acknowledge({ ok: true });
    await Promise.resolve();
    expect(document.querySelector(".screen.is-active")?.dataset.screen).toBe("home");
    expect(el("kitTimeline").querySelector("[data-presenter-list]")).not.toBeNull();
    expect(el("cueStatus").dataset.status).not.toBe("presenter-failed");
  });

  test("Nova partial play, routes, Mor, memorial, routes, and Home keep follower virtual membership", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await boot(session);
    await openCard('[data-open="nova"]');
    expect(el("stepTitle").textContent).toBe("The Nova site");

    await clickNextReady("The compounds");
    for (const view of views(session)) {
      expect(view.narrativeId).toBe("nova");
      expect(view.clock.phase).toBe("playing");
      expect(view.virtual).toEqual(expect.arrayContaining([
        INVESTIGATION_POLYGONS_FULL_ID,
        INVESTIGATION_LINES_FULL_ID,
      ]));
    }

    await clickNextReady("Escape routes");
    for (const view of views(session)) {
      expect(view.clock.phase).toBe("ended");
      expect(view.escape.individual).toBe(true);
      expect(view.escape.settled).toBe(false);
    }

    await clickNextReady("Mor Levy");
    for (const view of views(session)) {
      expect(view.clock.phase).toBe("ended");
      expect(view.escape.mor).toBe(true);
      expect(view.escape.individual).toBe(false);
    }

    await clickNextReady("Memorial");
    await vi.waitFor(() => expect(session.h.commands.at(-1)?.presentationAction).toBe("open"));
    const memorialLayers = NARRATIVES.find((item) => item.id === "nova").steps
      .find((step) => step.title.en === "Memorial").cue.layers;
    for (const view of views(session)) {
      expect(view.narrativeId).toBe("nova");
      expect(view.clock.phase).toBe("ended");
      expect(view.escape).toEqual({ individual: false, overlap: false, mor: false, settled: true });
      sameMembers(view.layers, memorialLayers);
      expect(view.chips).toEqual([]);
      expect(view.virtual).toEqual([
        INVESTIGATION_POLYGONS_FULL_ID,
        INVESTIGATION_LINES_FULL_ID,
      ]);
    }

    el("prevBtn").click();
    await vi.waitFor(() => {
      expect(el("stepTitle").textContent).toBe("Mor Levy");
      expect(el("cueStatus").dataset.status).toBe("ready");
    });
    el("prevBtn").click();
    await vi.waitFor(() => {
      expect(el("stepTitle").textContent).toBe("Escape routes");
      expect(el("cueStatus").dataset.status).toBe("ready");
    });
    for (const view of views(session)) {
      expect(view.clock.phase).toBe("ended");
      expect(view.escape.individual).toBe(true);
      expect(view.escape.settled).toBe(false);
      expect(view.virtual).toEqual(expect.arrayContaining([
        INVESTIGATION_POLYGONS_FULL_ID,
        INVESTIGATION_LINES_FULL_ID,
      ]));
    }

    el("homeBtn").click();
    await vi.waitFor(() => {
      expect(el("cueStatus").dataset.status).toBe("ready");
      for (const view of views(session)) expectHome(view);
    });
  });

  test("a failed Home reset stays retryable and followers ignore the rejected narrative", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await boot(session);
    await openCard('[data-open="segev"]');
    session.h.failNull = true;
    el("homeBtn").click();
    await vi.waitFor(() => expect(el("playerCueFailure").hidden).toBe(false));
    expect(document.querySelector(".screen.is-active")?.dataset.screen).toBe("player");
    for (const view of views(session)) expect(view.narrativeId).toBe("segev");

    el("playerCueRetry").click();
    await vi.waitFor(() => {
      expect(el("cueStatus").dataset.status).toBe("ready");
      for (const view of views(session)) expectHome(view);
    });
  });

  test("rapid Next, Back, and Home leave both followers on the Home cue", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await boot(session);
    await openCard('[data-open="timeline"]');
    expect(views(session).every((view) => view.clock.phase === "playing")).toBe(true);
    el("nextBtn").click();
    el("prevBtn").click();
    el("homeBtn").click();
    await vi.waitFor(() => {
      expect(document.querySelector(".screen.is-active")?.dataset.screen).toBe("home");
      expect(el("cueStatus").dataset.status).toBe("ready");
      for (const view of views(session)) expectHome(view);
    });
  });

  test("a style reload does not apply an escape fetch that was already pending", async () => {
    setLocale("en", { persist: false });
    session = mount();
    await boot(session);
    await openCard('[data-open="nova"]');
    await clickNextReady("The compounds");
    await clickNextReady("Escape routes");
    await clickNextReady("Mor Levy");
    await clickNextReady("Memorial");
    await vi.waitFor(() => expect(session.h.commands.at(-1)?.presentationAction).toBe("open"));

    let releaseEscape;
    escapePending = new Promise((resolve) => { releaseEscape = resolve; });

    const maps = [];
    for (const [follower, surface] of [
      [session.h.followers[0], "gis"],
      [session.h.followers[1], "projection"],
    ]) {
      const map = createFakeMapLibreMap();
      maps.push(map);
      coordinators.push(createNovaEscapeCoordinator({
        map,
        dataContext: follower,
        profile: surface,
        surface,
      }));
    }
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    el("homeBtn").click();
    await vi.waitFor(() => {
      for (const view of views(session)) expectHome(view);
    });
    await Promise.all(coordinators.map((coordinator) => coordinator.onStyleLoad({ styleLoss: true })));
    const pendingFetches = globalThis.fetch.mock.results.map((result) => result.value);
    releaseEscape();
    await Promise.all(pendingFetches);
    for (const map of maps) {
      expect(map.getLayer(NOVA_ESCAPE_IMPACT_LAYER_ID)).toBeNull();
      expect(map.getLayer(NOVA_ESCAPE_INDIVIDUAL_LAYER_ID)).toBeNull();
    }
    for (const view of views(session)) expectHome(view);
  });
});
