import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  LayerSheetController,
  renderLayerRow,
  renderNliTimelineTransport,
} from "../../frontend/src/remote/layer-sheet-controller.js";
import {
  nliAxisMarksFromBeats,
  nliBeatIndexFromOccupiedHourPct,
  nliBeatIndexFromPointer,
  nliBeatPctOccupiedHour,
  isNliRouteFlowActive,
} from "../../frontend/src/remote/nli-timeline-transport.js";
import {
  clockPositionMs,
  endNliClock,
  idleNliClock,
  pauseNliClock,
  playNliClock,
  replayNliClock,
} from "../../frontend/src/shared/nli-investigation-clock.js";
import { clockStoryDurationMs, TIMELINE_BEAT_MS } from "../../frontend/src/shared/nli-investigation-beats.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINES_ID = "nli.lines";
const PEOPLE_ID = "nli.people";
const PEOPLE_NAMES_ID = "nli.people_names";

function lineFeatures() {
  return [
    { properties: { timeline_minutes: 400 } },
    { properties: { timeline_minutes: 740 } },
  ];
}

/** Dense union-like: busy 06–12, then 13:00 / 13:30 / 19:57. Empty 14–18. */
function unionLikeOccupiedBeats() {
  const beats = [];
  for (let hour = 6; hour <= 12; hour += 1) {
    for (let m = 0; m < 16; m += 1) {
      beats.push(hour * 60 + m);
    }
  }
  beats.push(13 * 60, 13 * 60 + 30, 19 * 60 + 57);
  return beats;
}

function hourMarks(beats) {
  return nliAxisMarksFromBeats(beats).ticks.filter((mark) => mark.label);
}

function nliGroups(extra = {}) {
  return [
    {
      id: "nli",
      name: "NLI",
      layers: [
        { id: "lines", enabled: true, name: "צירי חדירה" },
        { id: "investigation_polygons", enabled: false, name: "polygons" },
        { id: "alarms", enabled: false, name: "alarms" },
        { id: "people", enabled: true, name: "people" },
        { id: "people_names", enabled: true, name: "names" },
        ...((extra.layers || [])),
      ],
    },
  ];
}

function stubContext(overrides = {}) {
  const patchInvestigationClock = vi.fn(async (next) => next);
  globalThis.OTEFDataContext = {
    getInvestigationClock: () => idleNliClock(),
    correctedNow: () => 1000,
    patchInvestigationClock,
    getProjectionSlideshow: () => null,
    getLayerGroups: () => nliGroups(),
    setLayersEnabled: vi.fn(async () => ({ ok: true })),
    toggleGroup: vi.fn(async () => ({ ok: true })),
    subscribe: vi.fn(() => () => {}),
    getAnimations: () => ({}),
    ...overrides,
  };
  if (!overrides.patchInvestigationClock) {
    globalThis.OTEFDataContext.patchInvestigationClock = patchInvestigationClock;
  }
  return globalThis.OTEFDataContext;
}

function makeController(overrides = {}) {
  const c = Object.create(LayerSheetController.prototype);
  c._nliEndTimer = null;
  c._nliPlayheadTimer = null;
  c._nliFeatureCache = { [LINES_ID]: lineFeatures() };
  c._nliScrub = null;
  c._nliScrubEl = null;
  c._nliOptimisticClock = null;
  c._nliCacheFetchInflight = false;
  c.focusedGroupId = "nli";
  c.primaryTileIdsJson = null;
  c.sheet = null;
  c.render = vi.fn();
  c.getEffectiveGroupsForView = () => nliGroups();
  Object.assign(c, overrides);
  return c;
}

function mockScrubTrack(options = {}) {
  const left = options.left ?? 100;
  const width = options.width ?? 200;
  const beatMax = options.beatMax ?? 1;
  const connected = { value: true };
  const thumb = { style: { left: "0%" } };
  const fill = { style: { width: "0%" } };
  const bubble = { style: { left: "0%" }, textContent: "06:40" };
  const attrs = { "aria-valuemax": String(beatMax), "aria-valuenow": "0" };
  const track = {
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    setAttribute: (name, value) => {
      attrs[name] = String(value);
    },
    getBoundingClientRect: () =>
      connected.value
        ? { left, width, right: left + width, top: 0, bottom: 10, height: 10, x: left, y: 0 }
        : { left: 0, width: 0, right: 0, top: 0, bottom: 0, height: 0, x: 0, y: 0 },
    querySelector: (sel) => {
      if (sel === ".nli-tl-thumb") return thumb;
      if (sel === ".nli-tl-track-fill") return fill;
      if (sel === ".nli-tl-bubble") return bubble;
      return null;
    },
    thumb,
    fill,
    bubble,
    attrs,
    disconnect: () => {
      connected.value = false;
    },
  };
  return track;
}

test("nli rows do not render anim-btn", () => {
  const html = renderLayerRow(
    {
      baseName: "lines",
      displayLabel: "צירי חדירה",
      fullLayerIds: ["nli.lines"],
      layers: [{ id: "lines", name: "צירי חדירה", enabled: true, style: { animation: { type: "timeline" } } }],
      enabled: true,
    },
    { groupId: "nli", animations: {} },
  );
  expect(html).not.toContain("data-animation-toggle");
  expect(html).not.toContain("anim-btn");
});

test("transport has loop icon not LOOP text", () => {
  const html = renderNliTimelineTransport(idleNliClock(), {
    playDisabled: false,
    stepScrubDisabled: false,
    presentationActive: false,
    displayBeats: [400, 740],
  });
  expect(html).not.toMatch(/>\s*LOOP\s*</i);
  expect(html).toContain("data-nli-tl-loop");
  expect(html).toContain("data-nli-tl-scrub");
});

test("locked playable row includes layer-tile--locked", () => {
  const clock = playNliClock(idleNliClock(), ["nli.lines"], [400], 0);
  const html = renderLayerRow(
    {
      baseName: "lines",
      displayLabel: "צירי חדירה",
      fullLayerIds: ["nli.lines"],
      layers: [{ id: "lines", name: "צירי חדירה", enabled: true, style: { animation: { type: "timeline" } } }],
      enabled: true,
    },
    { groupId: "nli", animations: {}, investigationClock: clock },
  );
  expect(html).toContain("layer-tile--locked");
});

describe("nli timeline transport", () => {
  beforeEach(() => {
    stubContext();
  });

  afterEach(() => {
    delete globalThis.OTEFDataContext;
    delete globalThis.layerRegistry;
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test("route flow activity covers visibility, completion, hold, override, loop, replay, and reduced motion", () => {
    const selected = [LINES_ID];
    const hidden = [];
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 0);
    const notCompleted = {
      ...playing,
      phase: "paused",
      positionMs: TIMELINE_BEAT_MS - 1,
      anchorMs: TIMELINE_BEAT_MS - 1,
    };
    const completed = {
      ...notCompleted,
      positionMs: TIMELINE_BEAT_MS,
      anchorMs: TIMELINE_BEAT_MS,
    };
    const cases = [
      ["incomplete", selected, notCompleted, false],
      ["completed", selected, completed, true],
      ["hidden", hidden, completed, false],
      ["ended", selected, endNliClock(playing), true],
    ];
    const routeActive = (clock, options = {}) => isNliRouteFlowActive(clock, {
      visibleMembership: selected,
      lineFeatures: lineFeatures(),
      motionMode: "full",
      nowMs: 1000,
      ...options,
    });
    for (const [name, groups, clock, active] of cases) {
      expect(routeActive(clock, { visibleMembership: groups }), name).toBe(active);
    }

    const hold = {
      ...playing,
      phase: "paused",
      positionMs: playing.beats.length * TIMELINE_BEAT_MS,
      anchorMs: playing.beats.length * TIMELINE_BEAT_MS,
    };
    const override = { ...playing, phase: "paused", positionMs: 0, anchorMs: 0 };
    const loop = { ...playing, loop: true };
    const replay = replayNliClock(endNliClock(playing), 9_000);
    for (const [name, clock, options, active] of [
      ["paused hold", hold, {}, true],
      ["explicit completed beats", override, { completedBeats: [740] }, true],
      ["loop after first beat", loop, { nowMs: TIMELINE_BEAT_MS + 1 }, true],
      ["replay before first beat", replay, { nowMs: 9_000 }, false],
      ["replay after first beat", replay, { nowMs: 9_000 + TIMELINE_BEAT_MS }, true],
    ]) {
      expect(routeActive(clock, options), name).toBe(active);
    }
    for (const [name, options] of [["missing line data", { lineFeatures: undefined }], ["empty line data", { lineFeatures: [] }]]) {
      expect(routeActive(completed, options), name).toBe(false);
    }
    expect(routeActive(completed, { motionMode: "reduced" })).toBe(false);
  });

  test("transport omits the redundant status row while paused and route flow is active", () => {
    const clock = {
      ...playNliClock(idleNliClock(), [LINES_ID], [400, 740], 0),
      phase: "paused",
      positionMs: TIMELINE_BEAT_MS,
      anchorMs: TIMELINE_BEAT_MS,
    };
    const html = renderNliTimelineTransport(clock, {
      displayBeats: [400, 740],
      visibleMembership: [LINES_ID],
      lineFeatures: lineFeatures(),
      motionMode: "full",
      nowMs: 1000,
    });

    expect(html).not.toContain("nli-tl-status");
    expect(html).not.toContain("nliTimelinePaused");
    expect(html).not.toContain("nliRouteFlowActive");
    expect(html).toContain("data-nli-tl-play");
    expect(html).toContain("data-nli-tl-stop");
    expect(html).toContain("data-nli-tl-scrub");
  });

  test("people row stays unlocked while clock is playing", () => {
    const clock = playNliClock(idleNliClock(), ["nli.lines"], [400], 0);
    const html = renderLayerRow(
      {
        baseName: "people",
        displayLabel: "אנשים",
        fullLayerIds: [PEOPLE_ID],
        layers: [{ id: "people", name: "אנשים", enabled: true }],
        enabled: true,
      },
      { groupId: "nli", animations: {}, investigationClock: clock },
    );
    expect(html).not.toContain("layer-tile--locked");
  });

  test("hour labels cover min/max displayed beats as whole hours", () => {
    const html = renderNliTimelineTransport(idleNliClock(), {
      playDisabled: false,
      stepScrubDisabled: false,
      presentationActive: false,
      displayBeats: [400, 740],
    });
    expect(html).toMatch(/nli-tl-hours[\s\S]*06:40/);
    expect(html).toMatch(/nli-tl-hours[\s\S]*12:20/);
    expect(html).not.toMatch(/>07</);
    expect(html).not.toMatch(/>08</);
    expect(html).not.toMatch(/>09</);
    expect(html).not.toMatch(/>10</);
    expect(html).not.toMatch(/>11</);
  });

  test("polygon beats do not label empty hours; 07 sits in its occupied-hour column", () => {
    const beats = [400, 410, 420, 435, 560, 570, 700, 740];
    const html = renderNliTimelineTransport(idleNliClock(), {
      playDisabled: false,
      stepScrubDisabled: false,
      presentationActive: false,
      displayBeats: beats,
    });
    expect(html).not.toMatch(/>08</);
    expect(html).not.toMatch(/>10</);
    expect(html).toMatch(/07:00|07/);
    expect(html).toMatch(/left:\s*25%/);
    expect(html).not.toMatch(/left:\s*28\.5/);
  });

  test("clustered beats occupy hour columns 06 vs 12 not global equal-index end", () => {
    const beats = [400, 401, 740];
    const pcts = nliAxisMarksFromBeats(beats).ticks.map((mark) => mark.pct);
    expect(new Set(pcts).size).toBeGreaterThanOrEqual(3);
    expect(Math.max(...pcts)).toBeLessThan(90);
    expect(pcts[0]).toBeLessThan(pcts[1]);
    expect(pcts[1]).toBeLessThan(pcts[2]);
    const html = renderNliTimelineTransport(idleNliClock(), {
      displayBeats: beats,
      playDisabled: false,
      stepScrubDisabled: false,
      presentationActive: false,
    });
    expect(html).not.toMatch(/left:0\.3/);
  });

  test("nliBeatIndexFromPointer on 8 same-hour beats at 50% still index 4", () => {
    const el = { getBoundingClientRect: () => ({ left: 0, width: 100 }) };
    const beats = [360, 361, 362, 363, 364, 365, 366, 367];
    expect(nliBeatIndexFromPointer(el, 50, beats)).toBe(4);
  });

  test("occupied-hour thumb pct round-trips last-of-12, 13:00, 13:30, 19:57", () => {
    const beats = unionLikeOccupiedBeats();
    const last12 = beats.findLastIndex((minutes) => Math.floor(minutes / 60) === 12);
    const i1300 = beats.indexOf(13 * 60);
    const i1330 = beats.indexOf(13 * 60 + 30);
    const i1957 = beats.indexOf(19 * 60 + 57);
    expect(last12).toBeGreaterThanOrEqual(0);
    expect(i1300).toBeGreaterThan(last12);
    expect(i1330).toBeGreaterThan(i1300);
    expect(i1957).toBe(beats.length - 1);
    for (const i of [last12, i1300, i1330, i1957]) {
      expect(nliBeatIndexFromOccupiedHourPct(nliBeatPctOccupiedHour(i, beats) / 100, beats)).toBe(i);
    }
  });

  test("clustered 401 occupied-hour pct round-trips to 401 not 740", () => {
    const beats = [400, 401, 740];
    for (let i = 0; i < beats.length; i += 1) {
      expect(nliBeatIndexFromOccupiedHourPct(nliBeatPctOccupiedHour(i, beats) / 100, beats)).toBe(i);
    }
  });

  test("single occupied-hour beat sits at column center 50%", () => {
    const beats = [400];
    expect(nliBeatPctOccupiedHour(0, beats)).toBe(50);
    expect(nliBeatIndexFromOccupiedHourPct(0.5, beats)).toBe(0);
  });

  test("occupied-hour labels separate 13 and 19 by more than 5% and skip empty 14–18", () => {
    const beats = unionLikeOccupiedBeats();
    expect(beats.length).toBeGreaterThan(16);
    const marks = hourMarks(beats);
    const lab13 = marks.find((mark) => mark.label === "13");
    const lab19 = marks.find((mark) => mark.label === "19");
    expect(lab13).toBeTruthy();
    expect(lab19).toBeTruthy();
    expect(lab19.pct - lab13.pct).toBeGreaterThan(5);
    expect(lab13.pct).toBeLessThan(90);
    const labels = marks.map((mark) => mark.label);
    expect(labels).not.toContain("14");
    expect(labels).not.toContain("15");
    expect(labels).not.toContain("16");
    expect(labels).not.toContain("17");
    expect(labels).not.toContain("18");
    const html = renderNliTimelineTransport(idleNliClock(), {
      playDisabled: false,
      stepScrubDisabled: false,
      presentationActive: false,
      displayBeats: beats,
    });
    expect(html).not.toMatch(/>14</);
    expect(html).not.toMatch(/>15</);
    expect(html).not.toMatch(/>16</);
    expect(html).not.toMatch(/>17</);
    expect(html).not.toMatch(/>18</);
  });

  test("nliBeatIndexFromPointer at 0% is first beat and ~100% is last", () => {
    const el = { getBoundingClientRect: () => ({ left: 0, width: 100 }) };
    const beats = unionLikeOccupiedBeats();
    expect(nliBeatIndexFromPointer(el, 0, beats)).toBe(0);
    expect(nliBeatIndexFromPointer(el, 100, beats)).toBe(beats.length - 1);
    expect(nliBeatIndexFromPointer(el, 99, beats)).toBe(beats.length - 1);
    const mid = nliBeatIndexFromPointer(el, 50, beats);
    expect(Math.floor(beats[mid] / 60)).toBe(10);
  });

  test("dense hour marks sit at occupied-hour column centers not first-beat index", () => {
    const beats = [];
    for (let i = 0; i < 14; i += 1) beats.push(360 + i);
    beats.push(420, 540, 600);
    expect(beats).toHaveLength(17);
    const html = renderNliTimelineTransport(idleNliClock(), {
      playDisabled: false,
      stepScrubDisabled: false,
      presentationActive: false,
      displayBeats: beats,
    });
    expect(html).toMatch(/>06</);
    expect(html).toMatch(/>07</);
    expect(html).toMatch(/left:\s*12\.5/);
    expect(html).toMatch(/left:\s*37\.5/);
    expect(html).not.toMatch(/>08</);
    expect(html).not.toMatch(/left:33\.3/);
  });

  test("nli-tl-ticks and nli-tl-hours use absolute left not space-between", () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, "../../frontend/css/remote-styles.css"),
      "utf8",
    );
    const ticksBlock = css.match(/\.nli-tl-ticks\s*\{[^}]+\}/);
    const hoursBlock = css.match(/\.nli-tl-hours\s*\{[^}]+\}/);
    const hourSpanBlock = css.match(/\.nli-tl-hours span\s*\{[^}]+\}/);
    expect(ticksBlock).not.toBeNull();
    expect(hoursBlock).not.toBeNull();
    expect(hourSpanBlock).not.toBeNull();
    expect(ticksBlock[0]).toMatch(/position:\s*absolute/);
    expect(hoursBlock[0]).toMatch(/position:\s*absolute/);
    expect(ticksBlock[0]).not.toMatch(/space-between/);
    expect(hoursBlock[0]).not.toMatch(/space-between/);
    expect(ticksBlock[0]).not.toMatch(/display:\s*flex/);
    expect(hoursBlock[0]).not.toMatch(/display:\s*flex/);
    expect(hourSpanBlock[0]).toMatch(/bottom:\s*0/);
    expect(hourSpanBlock[0]).not.toMatch(/space-between/);
  });

  test("clock strings and scrub track are LTR isolated", () => {
    const html = renderNliTimelineTransport(idleNliClock(), {
      playDisabled: false,
      stepScrubDisabled: false,
      presentationActive: false,
      displayBeats: [400, 740],
    });
    expect(html).toMatch(/dir="ltr"/);
    expect(html).toMatch(/06:40/);
  });

  test("loop on uses terracotta class not LOOP text", () => {
    const clock = { ...idleNliClock(), loop: true };
    const html = renderNliTimelineTransport(clock, {
      playDisabled: false,
      stepScrubDisabled: false,
      presentationActive: false,
      displayBeats: [400],
    });
    expect(html).not.toMatch(/>\s*LOOP\s*</i);
    expect(html).toContain("nli-tl-loop--on");
    expect(html).toContain("<svg");
  });

  test("presentationActive marks the sheet aria-disabled", () => {
    const html = renderNliTimelineTransport(idleNliClock(), {
      playDisabled: true,
      stepScrubDisabled: true,
      presentationActive: true,
      displayBeats: [400, 740],
    });
    expect(html).toContain('aria-disabled="true"');
  });

  test("empty cache does not PATCH on play, step, or scrub", async () => {
    const ctx = stubContext();
    const c = makeController({ _nliFeatureCache: {} });
    await c.handleNliTimelinePlay();
    await c.handleNliTimelineStep(1);
    await c.handleNliTimelineScrubPointerUp(0);
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
  });

  test("empty beats from cached features do not PATCH", async () => {
    const ctx = stubContext();
    const c = makeController({
      _nliFeatureCache: { [LINES_ID]: [{ properties: {} }] },
    });
    await c.handleNliTimelinePlay();
    await c.handleNliTimelineStep(1);
    await c.handleNliTimelineScrubPointerUp(0);
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
  });

  test("presentationActive disables all data-nli-tl handlers", async () => {
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    const ctx = stubContext({
      getInvestigationClock: () => playing,
      getProjectionSlideshow: () => ({ type: "start" }),
    });
    const c = makeController();
    await c.handleNliTimelinePlay();
    await c.handleNliTimelineStop();
    await c.handleNliTimelineLoop();
    await c.handleNliTimelineStep(1);
    c.handleNliTimelineScrubPointerDown();
    await c.handleNliTimelineScrubPointerUp(1);
    await c.handleNliTimelineScrubPointerCancel();
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
  });

  test("play matrix: idle plays, playing pauses, paused resumes, ended replays", async () => {
    const ctx = stubContext();
    const c = makeController();

    await c.handleNliTimelinePlay();
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(1);
    expect(ctx.patchInvestigationClock.mock.calls[0][0].phase).toBe("playing");
    expect(ctx.patchInvestigationClock.mock.calls[0][0].positionMs).toBe(0);

    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    ctx.getInvestigationClock = () => playing;
    await c.handleNliTimelinePlay();
    expect(ctx.patchInvestigationClock.mock.calls[1][0].phase).toBe("paused");

    const paused = pauseNliClock(playing, 1000);
    ctx.getInvestigationClock = () => paused;
    await c.handleNliTimelinePlay();
    expect(ctx.patchInvestigationClock.mock.calls[2][0].phase).toBe("playing");

    const ended = endNliClock(playing);
    ctx.getInvestigationClock = () => ended;
    await c.handleNliTimelinePlay();
    expect(ctx.patchInvestigationClock.mock.calls[3][0].phase).toBe("playing");
    expect(ctx.patchInvestigationClock.mock.calls[3][0].positionMs).toBe(0);
  });

  test("play uses replay when evaluateClock already ended", async () => {
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400], 0);
    const ctx = stubContext({
      getInvestigationClock: () => playing,
      correctedNow: () => clockStoryDurationMs([400]) + 50,
    });
    const c = makeController();
    await c.handleNliTimelinePlay();
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(1);
    expect(ctx.patchInvestigationClock.mock.calls[0][0].phase).toBe("playing");
    expect(ctx.patchInvestigationClock.mock.calls[0][0].positionMs).toBe(0);
  });

  test("step +1 from idle PATCHes paused at index 0; step -1 is no-op", async () => {
    const ctx = stubContext();
    const c = makeController();
    await c.handleNliTimelineStep(-1);
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
    await c.handleNliTimelineStep(1);
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(1);
    const next = ctx.patchInvestigationClock.mock.calls[0][0];
    expect(next.phase).toBe("paused");
    expect(next.positionMs).toBe(0);
    expect(next.seekKind).toBe("jump");
    expect(next.anchorMs).toBe(1000);
  });

  test("idle scrub PATCH includes seekKind jump", async () => {
    const ctx = stubContext();
    const c = makeController();
    await c.handleNliTimelineScrubPointerUp(1);
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(1);
    expect(ctx.patchInvestigationClock.mock.calls[0][0]).toMatchObject({
      phase: "paused",
      positionMs: TIMELINE_BEAT_MS,
      seekKind: "jump",
      anchorMs: 1000,
    });
  });

  test("step while playing lands paused", async () => {
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    const ctx = stubContext({ getInvestigationClock: () => playing });
    const c = makeController();
    await c.handleNliTimelineStep(1);
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(1);
    expect(ctx.patchInvestigationClock.mock.calls[0][0].phase).toBe("paused");
    expect(ctx.patchInvestigationClock.mock.calls[0][0].positionMs).toBe(TIMELINE_BEAT_MS);
  });

  test("stop PATCHes idle and keeps loop", async () => {
    const playing = { ...playNliClock(idleNliClock(), [LINES_ID], [400], 1000), loop: true };
    const ctx = stubContext({ getInvestigationClock: () => playing });
    const c = makeController();
    await c.handleNliTimelineStop();
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(1);
    expect(ctx.patchInvestigationClock.mock.calls[0][0]).toMatchObject({
      phase: "idle",
      loop: true,
      membership: [],
    });
  });

  test("pointerdown while playing PATCHes pause so maps freeze", () => {
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    const ctx = stubContext({ getInvestigationClock: () => playing });
    const c = makeController();
    c.handleNliTimelineScrubPointerDown();
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(1);
    expect(ctx.patchInvestigationClock.mock.calls[0][0].phase).toBe("paused");
  });

  test("scrub while playing PATCHes pause on down and one seek on up", async () => {
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    const ctx = stubContext({ getInvestigationClock: () => playing });
    const c = makeController();
    c.handleNliTimelineScrubPointerDown();
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(1);
    expect(ctx.patchInvestigationClock.mock.calls[0][0].phase).toBe("paused");
    await c.handleNliTimelineScrubPointerUp(1);
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(2);
    expect(ctx.patchInvestigationClock.mock.calls[1][0]).toMatchObject({
      phase: "paused",
      positionMs: TIMELINE_BEAT_MS,
    });
  });

  test("pointer cancel after pause-on-down stays paused without resume", async () => {
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    const ctx = stubContext({ getInvestigationClock: () => playing });
    const c = makeController();
    c.handleNliTimelineScrubPointerDown();
    await c.handleNliTimelineScrubPointerCancel();
    expect(ctx.patchInvestigationClock.mock.calls.length).toBeGreaterThanOrEqual(1);
    for (const [clock] of ctx.patchInvestigationClock.mock.calls) {
      expect(clock.phase).toBe("paused");
    }
  });

  test("ended seek PATCHes paused at that beat", async () => {
    const ended = endNliClock(playNliClock(idleNliClock(), [LINES_ID], [400, 740], 0));
    const ctx = stubContext({ getInvestigationClock: () => ended });
    const c = makeController();
    await c.handleNliTimelineScrubPointerUp(0);
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(1);
    expect(ctx.patchInvestigationClock.mock.calls[0][0]).toMatchObject({
      phase: "paused",
      positionMs: 0,
    });
  });

  test("bulk visibility while not idle toggles only people and names", async () => {
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400], 0);
    const ctx = stubContext({ getInvestigationClock: () => playing });
    const c = makeController();
    await c.toggleGroupEnabled("nli", false);
    expect(ctx.toggleGroup).not.toHaveBeenCalled();
    expect(ctx.setLayersEnabled).toHaveBeenCalledWith([PEOPLE_ID, PEOPLE_NAMES_ID], false);
  });

  test("bulk visibility while idle still toggles the whole group", async () => {
    const ctx = stubContext();
    const c = makeController();
    await c.toggleGroupEnabled("nli", true);
    expect(ctx.toggleGroup).toHaveBeenCalledWith("nli", true);
  });

  test("locked playable tile click does not toggle", async () => {
    const ctx = stubContext();
    const c = makeController();
    const tile = {
      classList: { contains: (name) => name === "layer-tile--locked" || name === "is-on" },
      getAttribute: () => JSON.stringify([LINES_ID]),
    };
    await c.runLayerTileToggleFromElement(tile);
    expect(ctx.setLayersEnabled).not.toHaveBeenCalled();
  });

  test("nli pack html includes the transport sheet; other packs do not", () => {
    const c = makeController();
    const nliHtml = c.renderLayersTabContent(nliGroups(), {});
    expect(nliHtml).toContain("nli-tl-sheet");
    expect(nliHtml).toContain("data-nli-tl-play");
    c.focusedGroupId = "october_7th";
    const octHtml = c.renderLayersTabContent(
      [
        {
          id: "october_7th",
          name: "Oct",
          layers: [{ id: "route", enabled: true, name: "route" }],
        },
      ],
      {},
    );
    expect(octHtml).not.toContain("nli-tl-sheet");
  });

  test("nli-tl-sheet is absolute inside layers-variant-c not fixed", () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, "../../frontend/css/remote-styles.css"),
      "utf8",
    );
    const sheetBlock = css.match(/\.nli-tl-sheet\s*\{[^}]+\}/);
    expect(sheetBlock).not.toBeNull();
    expect(sheetBlock[0]).toMatch(/position:\s*absolute/);
    expect(sheetBlock[0]).toMatch(/left:\s*0/);
    expect(sheetBlock[0]).toMatch(/right:\s*0/);
    expect(sheetBlock[0]).toMatch(/bottom:\s*0/);
    expect(sheetBlock[0]).not.toMatch(/position:\s*fixed/);
    expect(css).toMatch(/\.layers-variant-c\s*\{[^}]*position:\s*relative/s);
  });

  test("scrub pointerdown while playing does not render the captured track", () => {
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    stubContext({ getInvestigationClock: () => playing });
    const track = mockScrubTrack();
    const c = makeController({ _nliScrubEl: track });
    c.handleNliTimelineScrubPointerDown(100);
    expect(c.render).not.toHaveBeenCalled();
    expect(c._nliOptimisticClock.phase).toBe("paused");
    expect(c._nliScrubEl).toBe(track);
  });

  test("scrub pointerup hit-tests the live track not a detached 0x0 rect", async () => {
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    const ctx = stubContext({ getInvestigationClock: () => playing });
    const track = mockScrubTrack();
    const c = makeController({ _nliScrubEl: track });
    c.render = vi.fn(() => {
      track.disconnect();
    });
    c.handleNliTimelineScrubPointerDown(100);
    expect(c.render).not.toHaveBeenCalled();
    expect(track.getBoundingClientRect().width).toBe(200);
    const beatCount = Number(track.getAttribute("aria-valuemax") || 0) + 1;
    const rect = track.getBoundingClientRect();
    const width = rect.width || 1;
    const t = (100 - rect.left) / width;
    const index = Math.round(Math.max(0, Math.min(1, t)) * (beatCount - 1));
    await c.handleNliTimelineScrubPointerUp(index);
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(2);
    expect(ctx.patchInvestigationClock.mock.calls[1][0].positionMs).toBe(0);
  });

  test("render does not replace sheet-content while scrub pointer is captured", () => {
    stubContext();
    const content = { innerHTML: "KEEP", querySelector: () => null };
    const c = makeController({
      sheet: {
        querySelector: (sel) => (sel === ".sheet-content" ? content : null),
      },
      _nliScrub: { fromPlaying: true },
      _nliScrubEl: mockScrubTrack(),
    });
    try {
      LayerSheetController.prototype.render.call(c);
    } catch {
      // node has no HTMLInputElement once innerHTML was already replaced
    }
    expect(content.innerHTML).toBe("KEEP");
  });

  test("scrub pointermove updates thumb and bubble locally without PATCH", () => {
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    const ctx = stubContext({ getInvestigationClock: () => playing });
    const track = mockScrubTrack();
    const c = makeController({ _nliScrubEl: track });
    c.handleNliTimelineScrubPointerDown(100);
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(1);
    expect(ctx.patchInvestigationClock.mock.calls[0][0].phase).toBe("paused");
    c.handleNliTimelineScrubPointerMove(300);
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(1);
    expect(c.render).not.toHaveBeenCalled();
    expect(track.thumb.style.left).toBe("75%");
    expect(track.fill.style.width).toBe("75%");
    expect(track.bubble.style.left).toBe("75%");
    expect(track.bubble.textContent).toBe("12:20");
    expect(track.attrs["aria-valuenow"]).toBe("1");
  });

  test("failed beat fetch is retried instead of sticking as empty", async () => {
    const ctx = stubContext();
    globalThis.layerRegistry = {
      getLayerDataUrl: () => "/nli-lines.json",
    };
    let failRound = true;
    const fetchMock = vi.fn(async () => {
      if (failRound) return { ok: false, json: async () => ({ features: [] }) };
      return { ok: true, json: async () => ({ features: lineFeatures() }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const c = makeController({ _nliFeatureCache: Object.create(null) });
    await c._ensureNliFeatureCache();
    expect(Array.isArray(c._nliFeatureCache[LINES_ID])).toBe(false);
    await c.handleNliTimelinePlay();
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
    failRound = false;
    await c._ensureNliFeatureCache();
    expect(Array.isArray(c._nliFeatureCache[LINES_ID])).toBe(true);
    expect(c._nliFeatureCache[LINES_ID].length).toBeGreaterThan(0);
    await c.handleNliTimelinePlay();
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(1);
    expect(ctx.patchInvestigationClock.mock.calls[0][0].phase).toBe("playing");
  });

  test("successful empty features stay empty and are not retried as failure", async () => {
    stubContext();
    globalThis.layerRegistry = {
      getLayerDataUrl: () => "/nli-empty.json",
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ features: [] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const c = makeController({ _nliFeatureCache: Object.create(null) });
    await c._ensureNliFeatureCache();
    const calls = fetchMock.mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    expect(c._nliFeatureCache[LINES_ID]).toEqual([]);
    await c._ensureNliFeatureCache();
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  test("_syncNliEndedTimer schedules remaining delay and PATCHes end when revision matches", async () => {
    vi.useFakeTimers();
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    const now = 3000;
    const ctx = stubContext({
      getInvestigationClock: () => playing,
      correctedNow: () => now,
    });
    const c = makeController();
    c._syncNliEndedTimer(playing);
    expect(c._nliEndTimer).not.toBeNull();
    const delay = Math.max(0, clockStoryDurationMs(playing.beats) - clockPositionMs(playing, now));
    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(1);
    expect(ctx.patchInvestigationClock.mock.calls[0][0].phase).toBe("ended");
  });

  test("_syncNliEndedTimer does not schedule when loop is on", () => {
    const playing = {
      ...playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000),
      loop: true,
    };
    stubContext({ getInvestigationClock: () => playing, correctedNow: () => 1000 });
    const c = makeController();
    c._syncNliEndedTimer(playing);
    expect(c._nliEndTimer).toBeNull();
  });

  test("_syncNliEndedTimer callback skips PATCH when revision no longer matches", async () => {
    vi.useFakeTimers();
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    let current = playing;
    const ctx = stubContext({
      getInvestigationClock: () => current,
      correctedNow: () => 1000,
    });
    const c = makeController();
    c._syncNliEndedTimer(playing);
    current = { ...playing, revision: playing.revision + 1 };
    await vi.advanceTimersByTimeAsync(clockStoryDurationMs(playing.beats) + 50);
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
  });

  test("sheet pointerup without a prior scrub pointerdown does not seek", async () => {
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    const ctx = stubContext({ getInvestigationClock: () => playing });
    const track = mockScrubTrack();
    const listeners = {};
    const content = {
      addEventListener: (type, handler) => {
        listeners[type] = handler;
      },
    };
    const c = makeController({
      sheet: {
        querySelector: (sel) => {
          if (sel === ".sheet-content") return content;
          if (sel === "[data-nli-tl-scrub]") return track;
          return null;
        },
      },
    });
    const upSpy = vi.spyOn(c, "handleNliTimelineScrubPointerUp");
    LayerSheetController.prototype.setupEventListeners.call(c);
    expect(c._nliScrub).toBeNull();
    listeners.pointerup({ clientX: 150, target: null });
    await Promise.all(
      upSpy.mock.results.map((result) => result.value).filter(Boolean),
    );
    expect(upSpy).not.toHaveBeenCalled();
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
  });

  test("scrub pointerdown while playing clears the ended timer", async () => {
    vi.useFakeTimers();
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    const ctx = stubContext({
      getInvestigationClock: () => playing,
      correctedNow: () => 1000,
    });
    const c = makeController({ _nliScrubEl: mockScrubTrack() });
    c._syncNliEndedTimer(playing);
    expect(c._nliEndTimer).not.toBeNull();
    c.handleNliTimelineScrubPointerDown(100);
    expect(c._nliEndTimer).toBeNull();
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(1);
    expect(ctx.patchInvestigationClock.mock.calls[0][0].phase).toBe("paused");
    await vi.advanceTimersByTimeAsync(clockStoryDurationMs(playing.beats) + 50);
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(1);
  });

  test("_syncNliPlayheadTicker paints thumb after one beat without render or PATCH", async () => {
    vi.useFakeTimers();
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    const ctx = stubContext({
      getInvestigationClock: () => playing,
      correctedNow: () => 1000,
    });
    const track = mockScrubTrack();
    const clockEl = { textContent: "" };
    const content = {
      innerHTML: "KEEP",
      querySelector: (sel) => {
        if (sel === "[data-nli-tl-scrub]") return track;
        if (sel === ".nli-tl-clock") return clockEl;
        return null;
      },
    };
    const c = makeController({
      sheet: { querySelector: () => content },
      _nliArmPayload: () => ({ beats: [400, 740], visibleMembership: [LINES_ID] }),
    });
    ctx.correctedNow = () => 1000;
    c._syncNliPlayheadTicker(playing);
    ctx.correctedNow = () => 1000 + 3200;
    await vi.advanceTimersByTimeAsync(3200);
    expect(track.thumb.style.left).toBe("75%");
    expect(clockEl.textContent).toMatch(/12:20/);
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
    expect(c.render).not.toHaveBeenCalled();
    expect(content.innerHTML).toBe("KEEP");
  });

  test("_syncNliPlayheadTicker skips paint while _nliScrub", async () => {
    vi.useFakeTimers();
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    const ctx = stubContext({
      getInvestigationClock: () => playing,
      correctedNow: () => 1000,
    });
    const track = mockScrubTrack();
    const c = makeController({
      _nliScrub: { fromPlaying: true },
      sheet: { querySelector: () => ({ querySelector: () => track, innerHTML: "KEEP" }) },
    });
    c._syncNliPlayheadTicker(playing);
    ctx.correctedNow = () => 1000 + 3200;
    await vi.advanceTimersByTimeAsync(3200);
    expect(track.thumb.style.left).not.toBe("75%");
  });

  test("_syncNliPlayheadTicker stops on paused clock", async () => {
    vi.useFakeTimers();
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    const ctx = stubContext({
      getInvestigationClock: () => playing,
      correctedNow: () => 1000,
    });
    const track = mockScrubTrack();
    const clockEl = { textContent: "" };
    const content = {
      innerHTML: "KEEP",
      querySelector: (sel) => {
        if (sel === "[data-nli-tl-scrub]") return track;
        if (sel === ".nli-tl-clock") return clockEl;
        return null;
      },
    };
    const c = makeController({
      sheet: { querySelector: () => content },
      _nliArmPayload: () => ({ beats: [400, 740], visibleMembership: [LINES_ID] }),
    });
    c._syncNliPlayheadTicker(playing);
    c._syncNliPlayheadTicker(pauseNliClock(playing, 1000));
    ctx.correctedNow = () => 1000 + 3200;
    await vi.advanceTimersByTimeAsync(3200);
    expect(track.thumb.style.left).not.toBe("75%");
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
    expect(c.render).not.toHaveBeenCalled();
  });

  test("_syncNliPlayheadTicker loop-on wraps thumb to first occupied-hour position", async () => {
    vi.useFakeTimers();
    const playing = {
      ...playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000),
      loop: true,
    };
    const ctx = stubContext({
      getInvestigationClock: () => playing,
      correctedNow: () => 1000,
    });
    const track = mockScrubTrack();
    const clockEl = { textContent: "" };
    const content = {
      innerHTML: "KEEP",
      querySelector: (sel) => {
        if (sel === "[data-nli-tl-scrub]") return track;
        if (sel === ".nli-tl-clock") return clockEl;
        return null;
      },
    };
    const c = makeController({
      sheet: { querySelector: () => content },
      _nliArmPayload: () => ({ beats: [400, 740], visibleMembership: [LINES_ID] }),
    });
    c._syncNliPlayheadTicker(playing);
    ctx.correctedNow = () => 1000 + 3200;
    await vi.advanceTimersByTimeAsync(3200);
    expect(track.thumb.style.left).toBe("75%");
    ctx.correctedNow = () => 1000 + clockStoryDurationMs(playing.beats);
    await vi.advanceTimersByTimeAsync(3200);
    expect(track.thumb.style.left).toBe("25%");
    expect(clockEl.textContent).toMatch(/06:40/);
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
    expect(content.innerHTML).toBe("KEEP");
  });

  test("_syncNliPlayheadTicker does not reset _nliEndTimer across a playhead tick", async () => {
    vi.useFakeTimers();
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    const ctx = stubContext({
      getInvestigationClock: () => playing,
      correctedNow: () => 1000,
    });
    const track = mockScrubTrack();
    const clockEl = { textContent: "" };
    const content = {
      querySelector: (sel) => {
        if (sel === "[data-nli-tl-scrub]") return track;
        if (sel === ".nli-tl-clock") return clockEl;
        return null;
      },
    };
    const c = makeController({
      sheet: { querySelector: () => content },
      _nliArmPayload: () => ({ beats: [400, 740], visibleMembership: [LINES_ID] }),
    });
    c._syncNliEndedTimer(playing);
    const endedId = c._nliEndTimer;
    expect(endedId).not.toBeNull();
    const endedSpy = vi.spyOn(c, "_syncNliEndedTimer");
    c._syncNliPlayheadTicker(playing);
    expect(c._nliEndTimer).toBe(endedId);
    endedSpy.mockClear();
    ctx.correctedNow = () => 1000 + 3200;
    await vi.advanceTimersByTimeAsync(3200);
    expect(c._nliEndTimer).toBe(endedId);
    expect(endedSpy).not.toHaveBeenCalled();
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
  });

  test("layer sheet calls playhead ticker from clock subscribe and nli render", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../frontend/src/remote/layer-sheet-controller.js"),
      "utf8",
    );
    expect(src).toMatch(/subscribe\("investigationClock"[\s\S]*_syncNliPlayheadTicker/);
    expect(src).toMatch(/focusedGroupId === "nli"[\s\S]*_syncNliPlayheadTicker/);
  });
});
