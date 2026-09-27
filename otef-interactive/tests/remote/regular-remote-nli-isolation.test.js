import { afterEach, describe, expect, test, vi } from "vitest";
import { LayerSheetController } from "../../frontend/src/remote/layer-sheet-controller.js";
import { createNliStaffTimelineHost } from "../../frontend/src/remote/nli-staff-timeline-host.js";
import { LOCALE_EVENT } from "../../frontend/src/remote/remote-locale.js";
import {
  clockStoryDurationMs,
  INVESTIGATION_LINES_FULL_ID,
} from "../../frontend/src/shared/nli-investigation-beats.js";
import {
  idleNliClock,
  playNliClock,
} from "../../frontend/src/shared/nli-investigation-clock.js";

const OCTOBER_ROUTE = "october_7th.route";

function exhibitionGroups() {
  return [
    {
      id: "nli",
      name: "National Library",
      layers: [
        { id: "lines", name: "Lines", enabled: true },
        { id: "people", name: "People", enabled: true },
        {
          id: "people_names",
          name: "Names",
          enabled: false,
          fullLayerIds: ["nli.people_names", INVESTIGATION_LINES_FULL_ID],
        },
      ],
    },
    {
      id: "october_7th",
      name: "October",
      layers: [
        {
          id: "route",
          name: "Route",
          enabled: true,
          fullLayerIds: [OCTOBER_ROUTE, INVESTIGATION_LINES_FULL_ID],
        },
      ],
    },
  ];
}

function installDom() {
  const content = {
    innerHTML: "",
    classList: { remove() {}, toggle() {}, add() {} },
    addEventListener() {},
    querySelector() {
      return null;
    },
  };
  const sheet = {
    querySelector(sel) {
      return sel === ".sheet-content" ? content : null;
    },
  };
  const listeners = {};
  globalThis.document = {
    readyState: "complete",
    title: "",
    getElementById(id) {
      if (id === "layerSheet") return sheet;
      if (id === "layerPanelCount") {
        return { textContent: "", setAttribute() {} };
      }
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
  };
  globalThis.window = {
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      listeners[type] = (listeners[type] || []).filter((item) => item !== fn);
    },
  };
  return { content, listeners };
}

function installContext(groups, clock) {
  const patchInvestigationClock = vi.fn(async (next) => next);
  const setNarrative = vi.fn(async () => ({ ok: true }));
  const setEscapeOverlay = vi.fn(async () => ({ ok: true }));
  const setLayersEnabled = vi.fn(async () => ({ ok: true }));
  const toggleGroup = vi.fn(async () => ({ ok: true }));
  const setLayerAnimations = vi.fn(async () => ({ ok: true }));
  const setLegendSettings = vi.fn(async () => ({ ok: true }));
  const subscribers = {};
  globalThis.OTEFDataContext = {
    getLayerGroups: () => groups,
    getInvestigationClock: () => clock,
    getNarrativeState: () => ({ id: "segev", transition: "enter", revision: 4 }),
    getEscapeOverlay: () => ({ individual: true, overlap: false, mor: true }),
    getProjectionSlideshow: () => ({ type: "start" }),
    getAnimations: () => ({}),
    getLegendSettings: () => ({ summarizedGroupIds: [] }),
    correctedNow: () => 1000,
    patchInvestigationClock,
    setNarrative,
    setEscapeOverlay,
    setLayersEnabled,
    toggleGroup,
    setLayerAnimations,
    setLegendSettings,
    subscribe(topic, handler) {
      (subscribers[topic] ||= []).push(handler);
      return () => {};
    },
  };
  globalThis.LayerStateHelper = {
    getEffectiveLayerGroups: () => groups,
  };
  globalThis.layerRegistry = {
    init: async () => {},
    getGroups: () => [],
    getLayerDataUrl: (id) => `https://layers.example/${id}.geojson`,
  };
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ features: [] }) }));
  return {
    patchInvestigationClock,
    setNarrative,
    setEscapeOverlay,
    setLayersEnabled,
    toggleGroup,
    setLayerAnimations,
    subscribers,
  };
}

async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function nliFeatureFetches(fetchMock) {
  return fetchMock.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes("/nli") || url.includes("layers.example/nli"));
}

function storyWrites(ctx) {
  return (
    ctx.patchInvestigationClock.mock.calls.length
    + ctx.setNarrative.mock.calls.length
    + ctx.setEscapeOverlay.mock.calls.length
  );
}

describe("regular remote NLI isolation", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete globalThis.OTEFDataContext;
    delete globalThis.LayerStateHelper;
    delete globalThis.layerRegistry;
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.fetch;
    vi.restoreAllMocks();
  });

  test("hides the NLI pack, rows, and bulk control", async () => {
    const { content } = installDom();
    installContext(exhibitionGroups(), idleNliClock());
    const controller = new LayerSheetController();
    await flush();

    expect(content.innerHTML).toContain("october_7th");
    expect(content.innerHTML).not.toContain("nli-pack-panes");
    expect(content.innerHTML).not.toContain("nli-tl-sheet");
    expect(content.innerHTML).not.toContain("nli-narrative");
    expect(content.innerHTML).not.toContain("nli-nova-escape");
    expect(content.innerHTML).not.toContain('data-layers-select-pack="nli"');
    expect(content.innerHTML).not.toContain('data-layers-enc-gid="nli"');
    expect(content.innerHTML).not.toContain("nli.people");
    expect(content.innerHTML).toContain(OCTOBER_ROUTE);
    expect(controller.focusedGroupId).toBe("october_7th");
  });

  test("restored NLI focus falls back to a remaining pack", async () => {
    installDom();
    installContext(exhibitionGroups(), idleNliClock());
    const controller = new LayerSheetController();
    await flush();
    controller.focusOnGroup("nli");
    expect(controller.focusedGroupId).toBe("october_7th");
  });

  test("stale NLI tile, group, and animation events do not mutate", async () => {
    installDom();
    const ctx = installContext(
      exhibitionGroups(),
      playNliClock(idleNliClock(), [INVESTIGATION_LINES_FULL_ID], [400], 1000),
    );
    const controller = new LayerSheetController();
    await flush();

    await controller.toggleGroupEnabled("nli", false);
    await controller.toggleLayerRow([INVESTIGATION_LINES_FULL_ID], false);
    await controller.toggleLayerRow(["nli.people"], true);
    await controller.toggleLayerRowAnimations(
      [INVESTIGATION_LINES_FULL_ID],
      ["nli.people_names", INVESTIGATION_LINES_FULL_ID],
      true,
    );

    expect(ctx.toggleGroup).not.toHaveBeenCalled();
    expect(ctx.setLayersEnabled).not.toHaveBeenCalled();
    expect(ctx.setLayerAnimations).not.toHaveBeenCalled();
    expect(storyWrites(ctx)).toBe(0);
  });

  test("mixed ids cannot smuggle NLI aliases through regular actions", async () => {
    installDom();
    const ctx = installContext(exhibitionGroups(), idleNliClock());
    const controller = new LayerSheetController();
    await flush();

    await controller.toggleLayerRow([OCTOBER_ROUTE, INVESTIGATION_LINES_FULL_ID], false);
    expect(ctx.setLayersEnabled).toHaveBeenCalledTimes(1);
    expect(ctx.setLayersEnabled.mock.calls[0][0]).toEqual([OCTOBER_ROUTE]);

    await controller.toggleLayerRowAnimations(
      [OCTOBER_ROUTE, INVESTIGATION_LINES_FULL_ID],
      [OCTOBER_ROUTE, "nli.people_names"],
      true,
    );
    expect(ctx.setLayerAnimations.mock.calls.at(-1)[0]).toEqual([OCTOBER_ROUTE]);
    const visibilityIds = ctx.setLayersEnabled.mock.calls.at(-1)[0].map(String);
    expect(visibilityIds).toEqual([OCTOBER_ROUTE]);
    expect(visibilityIds).not.toContain("nli.people_names");

    await controller.toggleGroupEnabled("october_7th", false);
    const groupIds = ctx.setLayersEnabled.mock.calls.flatMap((call) => call[0]).map(String);
    expect(groupIds).not.toContain(INVESTIGATION_LINES_FULL_ID);
    expect(ctx.toggleGroup).not.toHaveBeenCalledWith("nli", expect.anything());
    expect(storyWrites(ctx)).toBe(0);
  });

  test("receiving clock, narrative, and overlay state writes nothing, including past story end", async () => {
    vi.useFakeTimers();
    const { content, listeners } = installDom();
    const playing = playNliClock(idleNliClock(), [INVESTIGATION_LINES_FULL_ID], [400, 740], 1000);
    const ctx = installContext(exhibitionGroups(), playing);
    const controller = new LayerSheetController();
    await flush();

    for (const topic of ["investigationClock", "narrativeState", "escapeOverlay"]) {
      for (const handler of ctx.subscribers[topic] || []) handler(playing);
    }
    for (const handler of listeners[LOCALE_EVENT] || []) handler();
    controller.onLayersTabHidden();
    controller.open();
    await flush();

    const delay = clockStoryDurationMs(playing.beats, playing) + 50;
    await vi.advanceTimersByTimeAsync(delay);

    expect(content.innerHTML).not.toContain("nli-tl-sheet");
    expect(storyWrites(ctx)).toBe(0);
    expect(nliFeatureFetches(globalThis.fetch)).toEqual([]);
    expect(ctx.setLayersEnabled).not.toHaveBeenCalled();
    expect(ctx.toggleGroup).not.toHaveBeenCalled();

    controller.destroy();
    await vi.advanceTimersByTimeAsync(delay);
    expect(storyWrites(ctx)).toBe(0);
    expect(nliFeatureFetches(globalThis.fetch)).toEqual([]);
  });

  test("staff timeline end still patches when the regular remote is absent", async () => {
    vi.useFakeTimers();
    const playing = playNliClock(idleNliClock(), [INVESTIGATION_LINES_FULL_ID], [400], 1000);
    const patchInvestigationClock = vi.fn(async (next) => next);
    globalThis.OTEFDataContext = {
      getInvestigationClock: () => playing,
      correctedNow: () => 1000,
      patchInvestigationClock,
      getProjectionSlideshow: () => null,
    };
    const host = createNliStaffTimelineHost({
      sheet: null,
      getGroups: () => [],
      render() {},
    });
    host._syncNliEndedTimer(playing);
    await vi.advanceTimersByTimeAsync(clockStoryDurationMs(playing.beats, playing));
    expect(patchInvestigationClock).toHaveBeenCalledTimes(1);
    expect(patchInvestigationClock.mock.calls[0][0].phase).toBe("ended");
  });
});
