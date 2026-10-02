import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createNliStaffTimelineHost, staffPlaybackConfig } from "../../frontend/src/remote/nli-staff-timeline-host.js";
import { createPresenterDatasetGate } from "../../frontend/src/remote/nli-presenter-content.js";
import { createPresenterCommands } from "../../frontend/src/remote/nli-presenter-commands.js";
import {
  nliAxisMarksFromBeats,
  nliBeatIndexFromOccupiedHourPct,
  nliBeatIndexFromPointer,
  nliBeatPctOccupiedHour,
  isNliRouteFlowActive,
  bindNliTimelinePointerListeners,
  consumeNliTimelineButtonClick,
  renderNliTimelineTransport,
} from "../../frontend/src/remote/nli-timeline-transport.js";
import {
  clockPositionMs,
  endNliClock,
  evaluateClock,
  idleNliClock,
  pauseNliClock,
  playNliClock,
  replayNliClock,
  rewindNliClock,
  seekNliClock,
  stepNliClock,
} from "../../frontend/src/shared/nli-investigation-clock.js";
import {
  clockStoryDurationMs,
  TIMELINE_HOLD_MS,
  finiteClockMinutes,
  timelineBeatDurationMs,
  timelineSpanMs,
  INVESTIGATION_ALARMS_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
  NLI_PLAYABLE_IDS,
} from "../../frontend/src/shared/nli-investigation-beats.js";
import { NLI_NARRATIVES } from "../../frontend/src/shared/nli-narratives.js";
import { NLI_NOVA_STORY } from "../../frontend/src/shared/nli-nova-story.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LINES_ID = "nli.lines";

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
  const patchInvestigationClock = vi.fn(async (next) => ({ ok: true, clock: next }));
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
  const render = overrides.render || vi.fn();
  const host = createNliStaffTimelineHost({
    sheet: overrides.sheet ?? null,
    getGroups: overrides.getEffectiveGroupsForView || (() => nliGroups()),
    render,
  });
  Object.assign(host, {
    _nliFeatureCache: { [LINES_ID]: lineFeatures() },
    _nliScrub: null,
    _nliScrubEl: null,
    _nliOptimisticClock: null,
    _nliCacheFetchInflight: false,
    focusedGroupId: "nli",
    sheet: overrides.sheet ?? null,
    render,
  }, overrides);
  return host;
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
      positionMs: timelineBeatDurationMs(400) - 1,
      anchorMs: timelineBeatDurationMs(400) - 1,
    };
    const completed = {
      ...notCompleted,
      positionMs: timelineBeatDurationMs(400),
      anchorMs: timelineBeatDurationMs(400),
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
      positionMs: timelineSpanMs(playing.beats),
      anchorMs: timelineSpanMs(playing.beats),
    };
    const override = { ...playing, phase: "paused", positionMs: 0, anchorMs: 0 };
    const loop = { ...playing, loop: true };
    const replay = replayNliClock(endNliClock(playing), 9_000);
    for (const [name, clock, options, active] of [
      ["paused hold", hold, {}, true],
      ["explicit completed beats", override, { completedBeats: [740] }, true],
      ["loop after first beat", loop, { nowMs: timelineBeatDurationMs(400) + 1 }, true],
      ["replay before first beat", replay, { nowMs: 9_000 }, false],
      ["replay after first beat", replay, { nowMs: 9_000 + timelineBeatDurationMs(400) }, true],
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
      positionMs: timelineBeatDurationMs(400),
      anchorMs: timelineBeatDurationMs(400),
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

  test("active narrative leaves timeline controls and handlers enabled", async () => {
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    const ctx = stubContext({
      getInvestigationClock: () => playing,
      getNarrativeState: () => ({ id: "segev", transition: "enter", revision: 2 }),
    });
    const html = renderNliTimelineTransport(playing, {
      displayBeats: [400, 740],
      narrativeActive: true,
    });
    expect(html.match(/ disabled/g) || []).toEqual([]);
    expect(html).toContain('aria-disabled="false"');
    const c = makeController();
    await c.handleNliTimelinePlay();
    await c.handleNliTimelineStop();
    await c.handleNliTimelineLoop();
    await c.handleNliTimelineStep(1);
    c.handleNliTimelineScrubPointerDown();
    await c.handleNliTimelineScrubPointerUp(1);
    expect(ctx.patchInvestigationClock).toHaveBeenCalled();
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

  test("Nova idle transport previews beat one at 08:03 with five uniform accessible marks", () => {
    const html = renderNliTimelineTransport(idleNliClock(), {
      narrativeId: "nova",
      displayBeats: NLI_NOVA_STORY.representativeMinutes,
    });
    expect(html).toContain(NLI_NOVA_STORY.beats[0].presenterText.he);
    expect(html).toMatch(/class="nli-tl-clock"[^>]*>08:03</);
    expect([...html.matchAll(/<i[^>]*nli-tl-nova-mark[^>]*style="left:([0-9.]+)%"/g)].map((m) => Number(m[1])))
      .toEqual([0, 25, 50, 75, 100]);
    for (const beat of NLI_NOVA_STORY.beats) {
      expect(html).toContain(beat.eventTime.he);
      expect(html).toContain(beat.title.he);
      expect(html).toContain(`aria-label="${beat.eventTime.he}: ${beat.title.he}"`);
    }
    expect(html).toContain('tabindex="0"');
    expect(html).toMatch(/data-nli-tl-step-back[^>]* disabled/);
  });

  test("Nova playhead and copy settle on beat five at natural completion", () => {
    const playing = playNliClock(idleNliClock(), [INVESTIGATION_POLYGONS_FULL_ID], NLI_NOVA_STORY.representativeMinutes, 1000);
    const ended = endNliClock(playing, { narrativeId: "nova" });
    const html = renderNliTimelineTransport(ended, {
      narrativeId: "nova",
      displayBeats: NLI_NOVA_STORY.representativeMinutes,
    });
    expect(html).toContain(NLI_NOVA_STORY.beats[4].presenterText.he);
    expect(html).toMatch(/class="nli-tl-clock"[^>]*>12:00</);
    expect(html).toMatch(/aria-valuenow="4"/);
    expect(html).toContain('style="left:100%"');
    expect(html).not.toContain("00:00");
    expect(html).toMatch(/data-nli-tl-step-forward[^>]* disabled/);
  });

  test("finiteClockMinutes treats a missing minute as absent, not midnight", () => {
    expect(finiteClockMinutes(null)).toBeNull();
    expect(finiteClockMinutes(undefined)).toBeNull();
    expect(finiteClockMinutes(false)).toBeNull();
    expect(finiteClockMinutes(0)).toBe(0);
    expect(finiteClockMinutes(401)).toBe(401);
  });

  test("opening-minutes hold and end keep 06:41 on the remote clock, not 00:00", () => {
    const windowBeats = [389, 395, 401];
    const playing = playNliClock(idleNliClock(), [LINES_ID], windowBeats, 0);
    const held = pauseNliClock(playing, timelineSpanMs(windowBeats) + 100);
    expect(evaluateClock(held, 0)).toMatchObject({ mode: "hold", clock: null });
    const holdHtml = renderNliTimelineTransport(held, { displayBeats: windowBeats });
    expect(holdHtml).toMatch(/class="nli-tl-clock"[^>]*>06:41</);
    expect(holdHtml).not.toContain("00:00");

    const endedHtml = renderNliTimelineTransport(endNliClock(playing), { displayBeats: windowBeats });
    expect(endedHtml).toMatch(/class="nli-tl-clock"[^>]*>06:41</);
    expect(endedHtml).not.toContain("00:00");
  });

  test("rest-of-day natural completion keeps the last story minute on the remote clock, not 00:00", () => {
    const beats = [389, 395, 400, 410, 740];
    const playing = playNliClock(idleNliClock(), [LINES_ID], beats, 0, { leadInMinutes: 402 });
    const html = renderNliTimelineTransport(endNliClock(playing), { displayBeats: beats });
    expect(html).toMatch(/class="nli-tl-clock"[^>]*>12:20</);
    expect(html).not.toContain("00:00");
  });

  test("disabled Nova slider is omitted from the tab order", () => {
    const html = renderNliTimelineTransport(idleNliClock(), {
      narrativeId: "nova",
      displayBeats: NLI_NOVA_STORY.representativeMinutes,
      stepScrubDisabled: true,
    });
    const slider = html.match(/<div class="nli-tl-track[^>]*data-nli-tl-scrub[^>]*>/)?.[0] || "";
    expect(slider).toContain('aria-disabled="true"');
    expect(slider).not.toContain("tabindex");
  });

  test("Nova pointer positions use nearest uniformly spaced beat", () => {
    const track = mockScrubTrack({ left: 0, width: 100 });
    const pct = [0, 12.5, 25, 62.5, 100];
    expect(pct.map((value) => nliBeatIndexFromPointer(track, value, NLI_NOVA_STORY.representativeMinutes, { narrativeId: "nova" })))
      .toEqual([0, 1, 1, 3, 4]);
  });

  test("Nova pointer, keyboard, and step controls converge on the shared beat selector", async () => {
    const ctx = stubContext({ getNarrativeState: () => ({ id: "nova" }) });
    const c = makeController({
      _nliFeatureCache: Object.fromEntries([LINES_ID, INVESTIGATION_POLYGONS_FULL_ID].map((id) => [id, [{}]])),
    });
    const select = vi.spyOn(c, "handleNliTimelineSelectBeat").mockResolvedValue(undefined);
    const fakeElement = class FakeElement {};
    vi.stubGlobal("Element", fakeElement);
    const track = new fakeElement();
    track.getAttribute = (name) => name === "aria-valuenow" ? "2" : null;
    track.closest = () => track;
    const contentListeners = {};
    bindNliTimelinePointerListeners({ addEventListener: (name, listener) => { contentListeners[name] = listener; } }, c);
    const key = (value, index = 2) => {
      track.getAttribute = (name) => name === "aria-valuenow" ? String(index) : null;
      const event = { target: track, key: value, preventDefault: vi.fn() };
      contentListeners.keydown(event);
      return event;
    };
    for (const [pressed, index] of [["ArrowRight", 3], ["ArrowLeft", 1], ["Home", 0], ["End", 4]]) {
      const event = key(pressed);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(select).toHaveBeenLastCalledWith(index);
    }
    const leftAtStart = key("ArrowLeft", 0);
    expect(leftAtStart.preventDefault).toHaveBeenCalledOnce();
    expect(select).toHaveBeenLastCalledWith(4);
    const rightAtEnd = key("ArrowRight", 4);
    expect(rightAtEnd.preventDefault).toHaveBeenCalledOnce();
    expect(select).toHaveBeenLastCalledWith(4);
    const unhandled = key("PageDown", 2);
    expect(unhandled.preventDefault).not.toHaveBeenCalled();

    await c.handleNliTimelineScrubPointerUp(4);
    expect(select).toHaveBeenLastCalledWith(4);

    const forward = {};
    const click = {
      target: { closest: (selector) => selector === "[data-nli-tl-step-forward]" ? forward : null },
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    consumeNliTimelineButtonClick(click, c);
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(select).toHaveBeenLastCalledWith(0);
  });

  test("Nova selection and scrub arm every staff playable id when raw chips are off", async () => {
    const ctx = stubContext({ getNarrativeState: () => ({ id: "nova", revision: 4 }) });
    const offGroups = [{ id: "nli", layers: [
      { id: "lines", enabled: false },
      { id: "investigation_polygons", enabled: false },
      { id: "alarms", enabled: false },
    ] }];
    const cachedIds = [];
    const makeNovaController = () => makeController({
      getEffectiveGroupsForView: () => offGroups,
      getPlaybackConfig: () => ({ membership: [...NLI_PLAYABLE_IDS] }),
      _nliCacheReady: (ids) => { cachedIds.push([...ids]); return true; },
    });

    const forward = makeNovaController();
    await forward.handleNliTimelineStep(1);
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(1);
    expect(ctx.patchInvestigationClock.mock.calls[0][0]).toMatchObject({ phase: "paused", positionMs: 0 });

    const select = makeNovaController();
    await select.handleNliTimelineSelectBeat(2);
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(2);
    expect(ctx.patchInvestigationClock.mock.calls[1][0]).toMatchObject({
      phase: "paused",
      positionMs: 2 * NLI_NOVA_STORY.beatDurationMs,
    });

    const scrub = makeNovaController();
    scrub.handleNliTimelineScrubPointerDown();
    expect(scrub._nliScrub).toBeTruthy();
    await scrub.handleNliTimelineScrubPointerUp(3);
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(3);
    expect(ctx.patchInvestigationClock.mock.calls[2][0]).toMatchObject({
      phase: "paused",
      positionMs: 3 * NLI_NOVA_STORY.beatDurationMs,
    });
    expect(cachedIds).toEqual([
      [...NLI_PLAYABLE_IDS],
      [...NLI_PLAYABLE_IDS],
      [...NLI_PLAYABLE_IDS],
      [...NLI_PLAYABLE_IDS],
    ]);
    expect(NLI_PLAYABLE_IDS).toEqual([
      INVESTIGATION_POLYGONS_FULL_ID,
      LINES_ID,
      INVESTIGATION_ALARMS_FULL_ID,
    ]);
  });

  test("Nova scrub cancel after a narrative reset discards the saved clock", async () => {
    let narrative = { id: "nova", transition: "enter", revision: 8 };
    const ctx = stubContext({ getNarrativeState: () => narrative });
    const c = makeController({
      _nliCacheReady: () => true,
    });

    c.handleNliTimelineScrubPointerDown();
    expect(c._nliScrub?.restoreClock?.phase).toBe("paused");
    narrative = { id: "segev", transition: "replace", revision: 9 };
    await c.handleNliTimelineScrubPointerCancel();

    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
    expect(c._nliScrub).toBeNull();
    expect(c._nliOptimisticClock).toBeNull();
  });

  test("a playing Step cannot adopt a newer epoch after its cache wait", async () => {
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    const ctx = stubContext({ getInvestigationClock: () => playing });
    let resolveCache;
    const cacheLoad = new Promise((resolve) => { resolveCache = resolve; });
    let cacheReady = false;
    const c = makeController({
      _nliCacheReady: () => cacheReady,
      _ensureNliFeatureCache: async () => { await cacheLoad; cacheReady = true; },
    });

    const pendingStep = c.handleNliTimelineStep(1);
    await Promise.resolve();
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
    c.invalidateTransport();
    resolveCache();
    await pendingStep;

    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
  });

  test("Nova idle Play keeps its entry epoch through the cache wait", async () => {
    const ctx = stubContext({ getNarrativeState: () => ({ id: "nova", revision: 4 }) });
    let resolveCache;
    const cacheLoad = new Promise((resolve) => { resolveCache = resolve; });
    let cacheReady = false;
    const c = makeController({
      _nliCacheReady: () => cacheReady,
      _ensureNliFeatureCache: async () => { await cacheLoad; cacheReady = true; },
    });

    const pendingPlay = c.handleNliTimelinePlay();
    await Promise.resolve();
    c.invalidateTransport();
    resolveCache();
    await pendingPlay;

    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
  });

  test("a busy cue renders every timeline mutation control disabled", () => {
    const html = renderNliTimelineTransport(idleNliClock(), {
      displayBeats: [400, 740],
      controlsBusy: true,
    });
    for (const control of ["stop", "play", "loop", "step-back", "step-forward"]) {
      expect(html).toMatch(new RegExp(`data-nli-tl-${control}[^>]* disabled`));
    }
    expect(html).toContain('data-nli-tl-scrub dir="ltr"');
    expect(html).toContain('aria-disabled="true"');
  });
  test("Nova Play drops its pending command when narrative exits during cache load", async () => {
    let narrative = { id: "nova", transition: "enter", revision: 12 };
    const ctx = stubContext({ getNarrativeState: () => narrative });
    let resolveCache;
    let cacheReady = false;
    const cacheLoad = new Promise((resolve) => { resolveCache = resolve; });
    const c = makeController({
      _nliCacheReady: () => cacheReady,
      _ensureNliFeatureCache: async () => {
        await cacheLoad;
        cacheReady = true;
      },
    });

    const pendingPlay = c.handleNliTimelinePlay();
    await Promise.resolve();
    expect(cacheReady).toBe(false);
    narrative = { id: null, transition: "exit", revision: 13 };
    resolveCache();
    await pendingPlay;

    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
  });

  test("Nova beat selection drops its pending command when narrative switches during cache load", async () => {
    let narrative = { id: "nova", transition: "enter", revision: 20 };
    const ctx = stubContext({ getNarrativeState: () => narrative });
    let resolveCache;
    let cacheReady = false;
    const cacheLoad = new Promise((resolve) => { resolveCache = resolve; });
    const c = makeController({
      _nliCacheReady: () => cacheReady,
      _ensureNliFeatureCache: async () => {
        await cacheLoad;
        cacheReady = true;
      },
    });

    const pendingSelection = c.handleNliTimelineSelectBeat(3);
    await Promise.resolve();
    expect(cacheReady).toBe(false);
    narrative = { id: "segev", transition: "replace", revision: 21 };
    resolveCache();
    await pendingSelection;

    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
  });

  test("Nova idle play arms manifest beats at position zero without a lead-in", async () => {
    const ctx = stubContext({
      getNarrativeState: () => ({ id: "nova" }),
      getLayerGroups: () => nliGroups(),
    });
    const c = makeController({
      _nliFeatureCache: {
        [LINES_ID]: lineFeatures(),
        [INVESTIGATION_POLYGONS_FULL_ID]: [{ properties: { timeline_minutes: 400 } }],
      },
      getEffectiveGroupsForView: () => nliGroups(),
    });
    await c.handleNliTimelinePlay();
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(1);
    const patched = ctx.patchInvestigationClock.mock.calls[0][0];
    expect(patched.membership).toEqual(
      expect.arrayContaining([INVESTIGATION_POLYGONS_FULL_ID, LINES_ID]),
    );
    expect(patched.beats).toEqual([492, 506, 540, 630, 720]);
    expect(patched.positionMs).toBe(0);
    expect(patched).not.toHaveProperty("leadInMinutes");
  });

  test("Nova Play from ended replays beat one and Stop restores the 08:03 preview", async () => {
    const playing = playNliClock(idleNliClock(), [INVESTIGATION_POLYGONS_FULL_ID], NLI_NOVA_STORY.representativeMinutes, 0);
    const ended = endNliClock(playing, { narrativeId: "nova" });
    const ctx = stubContext({
      getNarrativeState: () => ({ id: "nova" }),
      getInvestigationClock: () => ended,
      correctedNow: () => 21000,
    });
    const c = makeController();
    await c.handleNliTimelinePlay();
    expect(ctx.patchInvestigationClock.mock.calls[0][0]).toMatchObject({ phase: "playing", positionMs: 0 });
    expect(ctx.patchInvestigationClock.mock.calls[0][0]).not.toHaveProperty("leadInMinutes");
    await c.handleNliTimelineStop();
    const stopped = ctx.patchInvestigationClock.mock.calls[1][0];
    const html = renderNliTimelineTransport(stopped, {
      narrativeId: "nova",
      displayBeats: NLI_NOVA_STORY.representativeMinutes,
    });
    expect(stopped.phase).toBe("idle");
    expect(html).toContain(NLI_NOVA_STORY.beats[0].presenterText.he);
    expect(html).toMatch(/class="nli-tl-clock"[^>]*>08:03</);
  });

  test("lead-in remote clock matches the map minute instead of the last beat", () => {
    const beats = [389, 400, 410, 740];
    const playing = playNliClock(idleNliClock(), [LINES_ID], beats, 1000, { leadInMinutes: 401 });
    stubContext({ correctedNow: () => 1000 });
    const html = renderNliTimelineTransport(playing, { displayBeats: beats });
    expect(evaluateClock(playing, 1000).clock).toBe(401);
    expect(html).toMatch(/class="nli-tl-clock"[^>]*>06:41</);
    expect(html).toMatch(/aria-valuenow="2"/);
  });

  test("rest-of-day play from 06:42 shows that minute on the remote and the map", async () => {
    const beats = [389, 401, 402, 659, 660, 740];
    const ctx = stubContext({ correctedNow: () => 5000 });
    const c = makeController({
      _nliFeatureCache: {
        [LINES_ID]: beats.map((minutes) => ({ properties: { timeline_minutes: minutes } })),
      },
    });
    await c.handleNliTimelinePlay({ from: 402 });
    const clock = ctx.patchInvestigationClock.mock.calls[0][0];
    const html = renderNliTimelineTransport(clock, { displayBeats: clock.beats });
    expect(evaluateClock(clock, 5000)).toMatchObject({ clock: 402, leadIn: false });
    expect(html).toMatch(/class="nli-tl-clock"[^>]*>06:42</);
    expect(html).toMatch(/aria-valuenow="2"/);
  });

  test("a fresh rest-of-day window holds 06:41 end state before 06:42 plays", async () => {
    const beats = [389, 401, 402, 659, 660, 740];
    const ctx = stubContext({ correctedNow: () => 5000 });
    const c = makeController({
      _nliFeatureCache: {
        [LINES_ID]: beats.map((minutes) => ({ properties: { timeline_minutes: minutes } })),
      },
    });
    await c.startNliTimelineWindow({ membership: [LINES_ID], from: 402, playLeadIn: true, loop: false });
    const clock = ctx.patchInvestigationClock.mock.calls[0][0];
    expect(clock.positionMs).toBe(0);
    expect(evaluateClock(clock, 5000)).toMatchObject({
      clock: 402, leadIn: true, index: -1, beatElapsedMs: 0,
    });
  });

  test("idle play with a window trims later beats and starts at the window", async () => {
    const ctx = stubContext();
    const c = makeController({
      _nliFeatureCache: {
        [LINES_ID]: [389, 395, 400, 410, 740].map((m) => ({ properties: { timeline_minutes: m } })),
      },
    });
    await c.handleNliTimelinePlay({ to: 401 });
    expect(ctx.patchInvestigationClock.mock.calls[0][0].beats).toEqual([389, 395, 400]);
    expect(ctx.patchInvestigationClock.mock.calls[0][0].leadInMinutes).toBeUndefined();

    await c.handleNliTimelinePlay({ from: 401 });
    const rest = ctx.patchInvestigationClock.mock.calls[1][0];
    expect(rest.beats).toEqual([389, 395, 400, 410, 740]);
    expect(rest.leadInMinutes).toBe(401);
  });

  test("idle play with a loop flag arms the clock with that loop setting", async () => {
    const ctx = stubContext({ getInvestigationClock: () => ({ ...idleNliClock(), loop: true }) });
    const c = makeController({
      _nliFeatureCache: {
        [LINES_ID]: [389, 400].map((m) => ({ properties: { timeline_minutes: m } })),
      },
    });
    await c.handleNliTimelinePlay({ loop: false });
    expect(ctx.patchInvestigationClock.mock.calls[0][0].loop).toBe(false);
    await c.handleNliTimelinePlay();
    expect(ctx.patchInvestigationClock.mock.calls[1][0].loop).toBe(true);
  });

  test("replay keeps the lead-in of the ended window", async () => {
    const played = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 0, { leadInMinutes: 401 });
    const ctx = stubContext({ getInvestigationClock: () => endNliClock(played) });
    const c = makeController();
    await c.handleNliTimelinePlay();
    expect(ctx.patchInvestigationClock.mock.calls[0][0].leadInMinutes).toBe(401);
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
      positionMs: timelineBeatDurationMs(400),
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
    expect(ctx.patchInvestigationClock.mock.calls[0][0].positionMs).toBe(timelineBeatDurationMs(400));
  });

  test("Stop and Play preserve both scene windows after playing, scrubbing, stepping, or ending", async () => {
    for (const from of [undefined, 402]) {
      const beats = from === undefined ? [389, 401] : [389, 401, 402, 740];
      const playing = playNliClock(idleNliClock({ loop: true }), [LINES_ID], beats, 1000, { leadInMinutes: from });
      const cue = { layers: [LINES_ID], clock: from === undefined ? { to: 401 } : { from } };
      for (const source of [playing, seekNliClock(playing, beats.length - 1, 1000), stepNliClock(playing, 1, 1000), endNliClock(playing)]) {
        let live = source;
        const ctx = stubContext({ getInvestigationClock: () => live });
        const c = makeController({ getPlaybackConfig: () => staffPlaybackConfig({ clock: live, cue }) });
        const start = vi.spyOn(c, "startNliTimelineWindow");
        await c.handleNliTimelineStop();
        live = ctx.patchInvestigationClock.mock.calls[0][0];
        const positionMs = from === undefined ? 0 : timelineBeatDurationMs(402);
        expect(live).toMatchObject({
          phase: "paused", membership: [LINES_ID], beats, loop: true,
          positionMs, anchorMs: 0, seekKind: "none",
        });
        expect(evaluateClock(live, 99000)).toMatchObject({ clock: from === undefined ? 389 : 402, leadIn: false, beatElapsedMs: 0 });
        const html = renderNliTimelineTransport(live, { displayBeats: [389, 401, 402, 740] });
        expect(html).toMatch(from === undefined ? /class="nli-tl-clock"[^>]*>06:29</ : /class="nli-tl-clock"[^>]*>06:42</);
        expect(html).toContain(`aria-valuemax="${beats.length - 1}"`);
        expect(html).toContain(`aria-valuenow="${from === undefined ? 0 : 2}"`);
        expect(html).not.toContain("nli-tl-track--idle");
        if (from === undefined) expect(html).not.toContain("12:20");
        await c.handleNliTimelinePlay();
        expect(start).not.toHaveBeenCalled();
        const resumed = ctx.patchInvestigationClock.mock.calls[1][0];
        expect(resumed).toMatchObject({ phase: "playing", membership: [LINES_ID], beats, loop: true, positionMs });
        if (from !== undefined) expect(resumed.leadInMinutes).toBe(402);
      }
    }
  });

  test("scene fallback is restricted and clock start has precedence", () => {
    const armed = playNliClock(idleNliClock(), [LINES_ID], [389, 402, 740], 1000);
    const cue = { layers: [LINES_ID], clock: { from: 402 } };
    expect(staffPlaybackConfig({ clock: armed, cue })).toEqual({ membership: [LINES_ID], from: 402 });
    expect(staffPlaybackConfig({ clock: { ...armed, leadInMinutes: 410 }, cue }).from).toBe(410);
    for (const options of [
      { cue: null }, { cue, manualFree: true },
      { cue: { layers: [INVESTIGATION_POLYGONS_FULL_ID], clock: { from: 402 } } },
      { cue: { layers: [LINES_ID], clock: "idle" } },
    ]) expect(staffPlaybackConfig({ clock: armed, ...options })).toEqual({ membership: [LINES_ID] });
  });

  test("no-cue full-day Stop pauses at 389 without introducing a cue start", async () => {
    const beats = [389, 402, 740];
    const playing = playNliClock(idleNliClock({ loop: true }), [LINES_ID], beats, 1000);
    const ctx = stubContext({ getInvestigationClock: () => playing });
    const c = makeController({
      getPlaybackConfig: () => staffPlaybackConfig({ clock: playing, cue: null }),
    });
    await c.handleNliTimelineStop();
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(1);
    const stopped = ctx.patchInvestigationClock.mock.calls[0][0];
    expect(stopped).toMatchObject({
      phase: "paused",
      membership: [LINES_ID],
      beats,
      loop: true,
      positionMs: 0,
      anchorMs: 0,
      seekKind: "none",
    });
    expect(stopped).not.toHaveProperty("leadInMinutes");
    expect(evaluateClock(stopped, 99000)).toMatchObject({ clock: 389, leadIn: false, beatElapsedMs: 0 });
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
      positionMs: timelineBeatDurationMs(400),
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

  test("Nova end timer uses an exact twenty-second duration", async () => {
    vi.useFakeTimers();
    const playing = playNliClock(idleNliClock(), [INVESTIGATION_POLYGONS_FULL_ID], NLI_NOVA_STORY.representativeMinutes, 1000);
    const now = 1000;
    const ctx = stubContext({
      getInvestigationClock: () => playing,
      getNarrativeState: () => ({ id: "nova" }),
      correctedNow: () => now,
    });
    const c = makeController();
    c._syncNliEndedTimer(playing);
    await vi.advanceTimersByTimeAsync(19999);
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.patchInvestigationClock.mock.calls[0][0].phase).toBe("ended");
    expect(ctx.patchInvestigationClock.mock.calls[0][0].positionMs).toBe(20000);
  });

  test("Nova scrub cancel restores the exact pointer-down position and stays paused", async () => {
    const playing = playNliClock(idleNliClock(), [INVESTIGATION_POLYGONS_FULL_ID], NLI_NOVA_STORY.representativeMinutes, 1000);
    const ctx = stubContext({
      getNarrativeState: () => ({ id: "nova" }),
      getInvestigationClock: () => playing,
      correctedNow: () => 4750,
    });
    const c = makeController({ _nliFeatureCache: { [INVESTIGATION_POLYGONS_FULL_ID]: [{}] } });
    c._liveNliClock = () => playing;
    c.handleNliTimelineScrubPointerDown();
    const pausedAtDown = c._nliScrub.restoreClock;
    await c.handleNliTimelineScrubPointerCancel();
    expect(ctx.patchInvestigationClock.mock.calls.at(-1)[0]).toEqual(pausedAtDown);
    expect(ctx.patchInvestigationClock.mock.calls.at(-1)[0]).toMatchObject({ phase: "paused", positionMs: 3750 });
  });

  test("Nova idle scrub cancel restores the armed paused beat-one snapshot", async () => {
    const ctx = stubContext({
      getNarrativeState: () => ({ id: "nova" }),
      correctedNow: () => 9000,
    });
    const track = mockScrubTrack({ left: 0, width: 100, beatMax: 4 });
    const c = makeController({
      _nliFeatureCache: {
        [LINES_ID]: [{}],
        [INVESTIGATION_POLYGONS_FULL_ID]: [{}],
      },
      _nliScrubEl: track,
    });
    c.handleNliTimelineScrubPointerDown(75);
    const pausedStart = c._nliScrub.restoreClock;
    expect(pausedStart).toMatchObject({
      phase: "paused",
      beats: NLI_NOVA_STORY.representativeMinutes,
      positionMs: 0,
    });
    expect(track.attrs["aria-valuenow"]).toBe("3");

    await c.handleNliTimelineScrubPointerCancel();
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(1);
    expect(ctx.patchInvestigationClock.mock.calls[0][0]).toEqual(pausedStart);
    expect(ctx.patchInvestigationClock.mock.calls[0][0]).toMatchObject({
      phase: "paused",
      beats: NLI_NOVA_STORY.representativeMinutes,
      positionMs: 0,
    });
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
    bindNliTimelinePointerListeners(content, c);
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
    ctx.correctedNow = () => 1000 + timelineBeatDurationMs(400);
    await vi.advanceTimersByTimeAsync(timelineBeatDurationMs(400));
    expect(track.thumb.style.left).toBe("75%");
    expect(clockEl.textContent).toMatch(/12:20/);
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
    expect(c.render).not.toHaveBeenCalled();
    expect(content.innerHTML).toBe("KEEP");
  });

  test("staff playhead hook receives the real beat tick while legacy sheet remains available", async () => {
    vi.useFakeTimers();
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    let now = 1000;
    const ctx = stubContext({ getInvestigationClock: () => playing, correctedNow: () => now });
    const paintPlayhead = vi.fn();
    const host = createNliStaffTimelineHost({ paintPlayhead, getGroups: () => nliGroups() });
    host._syncNliPlayheadTicker(playing);
    now += timelineBeatDurationMs(400);
    await vi.advanceTimersByTimeAsync(timelineBeatDurationMs(400));
    expect(paintPlayhead).toHaveBeenCalledWith(playing);
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
    host._clearNliPlayheadTicker();

    const legacy = makeController({ sheet: { querySelector: vi.fn(() => null) } });
    expect(legacy._nliStaffPaintPlayhead).toBeUndefined();
    expect(() => legacy._paintNliPlayhead(playing)).not.toThrow();
  });

  test("feature cache writes notify staff synchronously before the next fetch resolves", async () => {
    const cacheChanged = vi.fn();
    const first = [{ properties: { timeline_minutes: 400 } }];
    let resolveSecond;
    vi.stubGlobal("fetch", vi.fn((url) => String(url).includes("lines")
      ? Promise.resolve({ ok: true, json: async () => ({ features: first }) })
      : new Promise((resolve) => { resolveSecond = resolve; })));
    globalThis.layerRegistry = { getLayerDataUrl: (id) => `/${id}.json` };
    stubContext();
    const host = createNliStaffTimelineHost({ getGroups: () => nliGroups(), cacheChanged });
    const pending = host._ensureNliFeatureCache([LINES_ID, INVESTIGATION_POLYGONS_FULL_ID]);
    await vi.waitFor(() => expect(cacheChanged).toHaveBeenCalledWith(LINES_ID, first));
    expect(host._nliFeatureCache[INVESTIGATION_POLYGONS_FULL_ID]).toBeUndefined();
    resolveSecond({ ok: true, json: async () => ({ features: [] }) });
    await pending;
    expect(cacheChanged).toHaveBeenCalledWith(INVESTIGATION_POLYGONS_FULL_ID, []);
  });

  test("a verified array replacement blocks saved event keys before another layer fetch settles", async () => {
    const polygon = INVESTIGATION_POLYGONS_FULL_ID;
    const line = LINES_ID;
    const oldPolygon = [{ id: "polygon-old" }];
    const newPolygon = [{ id: "polygon-new" }];
    const oldLine = [{ id: "line-old" }];
    const newLine = [{ id: "line-new" }];
    let releaseLine;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { releaseLine = resolve; })));
    globalThis.layerRegistry = { getLayerDataUrl: () => "/line.json" };
    const ctx = stubContext();
    let generation = 0;
    let gate;
    const host = createNliStaffTimelineHost({ getGroups: () => nliGroups(),
      cacheChanged() { generation += 1; void gate.refresh(); } });
    host._nliFeatureCache = { [polygon]: oldPolygon, [line]: oldLine };
    host._nliArmPayload = () => ({ visibleMembership: [polygon, line], beats: [400] });
    host._patchNliClock = vi.fn(async () => ({ ok: true }));
    gate = createPresenterDatasetGate({ host,
      manifest: { datasetVersion: "synthetic", acceptedSourceSha256: "source",
        requiredArtifacts: { [polygon]: "hash-p", [line]: "hash-r" } },
      hash: async (bytes) => new TextDecoder().decode(bytes).includes("polygon") ? "hash-p" : "hash-r" });
    expect((await gate.refresh()).ready).toBe(true);
    const getSnapshot = () => ({ boundaryKey: String(generation), canMutate: gate.getState().ready,
      arm: host._nliArmPayload(), beats: [{ key: "saved", minute: 400 }], narrativeId: null });
    const commands = createPresenterCommands({ host, context: ctx, getSnapshot });
    expect(getSnapshot().canMutate).toBe(true);
    expect(host._manualMutationsOpen()).toBe(true);
    host._nliFeatureCache[line] = null;
    const pending = host._ensureNliFeatureCache([line]);
    await vi.waitFor(() => expect(releaseLine).toBeTypeOf("function"));
    host._storeNliCachedFeatures(polygon, newPolygon);
    expect(gate.getState().ready).toBe(false);
    expect(await commands.select("saved")).toMatchObject({ ok: false, stale: true });
    expect(host._patchNliClock).not.toHaveBeenCalled();
    releaseLine({ ok: true, json: async () => ({ features: newLine }) });
    await pending;
    expect((await gate.refresh()).ready).toBe(true);
    expect(host._nliFeatureCache[polygon]).toBe(newPolygon);
    expect(host._nliFeatureCache[line]).toBe(newLine);
    commands.dispose(); gate.dispose();
  });

  test("Nova local ticker updates copy, marks, and playhead at each four-second beat", async () => {
    vi.useFakeTimers();
    const playing = playNliClock(idleNliClock(), [INVESTIGATION_POLYGONS_FULL_ID], NLI_NOVA_STORY.representativeMinutes, 1000);
    let now = 1000;
    const ctx = stubContext({
      getNarrativeState: () => ({ id: "nova" }),
      getInvestigationClock: () => playing,
      correctedNow: () => now,
    });
    const track = mockScrubTrack({ beatMax: 4 });
    const clockEl = { textContent: "" };
    const time = { textContent: "" };
    const title = { textContent: "" };
    const presenter = { textContent: "" };
    const stepBack = { disabled: true };
    const stepForward = { disabled: false };
    const marks = NLI_NOVA_STORY.beats.map((_, beatIndex) => ({
      dataset: { beatIndex: String(beatIndex) },
      classList: { toggle: vi.fn() },
    }));
    const content = {
      querySelector: (sel) => ({
        "[data-nli-tl-scrub]": track,
        ".nli-tl-clock": clockEl,
        ".nli-tl-nova-time": time,
        ".nli-tl-nova-title": title,
        ".nli-tl-nova-presenter": presenter,
        "[data-nli-tl-step-back]": stepBack,
        "[data-nli-tl-step-forward]": stepForward,
      }[sel] || null),
      querySelectorAll: () => marks,
    };
    const c = makeController({
      sheet: { querySelector: () => content },
      _nliArmPayload: () => ({ beats: NLI_NOVA_STORY.representativeMinutes, visibleMembership: [INVESTIGATION_POLYGONS_FULL_ID] }),
    });
    c._syncNliPlayheadTicker(playing);
    expect(stepBack.disabled).toBe(true);
    expect(stepForward.disabled).toBe(false);
    for (let index = 1; index < NLI_NOVA_STORY.beats.length; index += 1) {
      now = 1000 + index * NLI_NOVA_STORY.beatDurationMs;
      await vi.advanceTimersByTimeAsync(NLI_NOVA_STORY.beatDurationMs);
      const beat = NLI_NOVA_STORY.beats[index];
      expect(presenter.textContent).toBe(beat.presenterText.he);
      expect(time.textContent).toBe(beat.eventTime.he);
      expect(title.textContent).toBe(beat.title.he);
      expect(track.thumb.style.left).toBe(`${index * 25}%`);
      expect(marks[index].classList.toggle).toHaveBeenLastCalledWith("is-active", true);
      expect(stepBack.disabled).toBe(false);
      expect(stepForward.disabled).toBe(index === NLI_NOVA_STORY.beats.length - 1);
    }
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
    expect(c.render).not.toHaveBeenCalled();
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
    ctx.correctedNow = () => 1000 + timelineBeatDurationMs(400);
    await vi.advanceTimersByTimeAsync(timelineBeatDurationMs(400));
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
    ctx.correctedNow = () => 1000 + timelineBeatDurationMs(400);
    await vi.advanceTimersByTimeAsync(timelineBeatDurationMs(400));
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
    ctx.correctedNow = () => 1000 + timelineBeatDurationMs(400);
    await vi.advanceTimersByTimeAsync(timelineBeatDurationMs(400));
    expect(track.thumb.style.left).toBe("75%");
    ctx.correctedNow = () => 1000 + clockStoryDurationMs(playing.beats);
    await vi.advanceTimersByTimeAsync(timelineBeatDurationMs(400));
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
    ctx.correctedNow = () => 1000 + timelineBeatDurationMs(400);
    await vi.advanceTimersByTimeAsync(timelineBeatDurationMs(400));
    expect(c._nliEndTimer).toBe(endedId);
    expect(endedSpy).not.toHaveBeenCalled();
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
  });

  test("explicit start plays a hidden scene window and clears an old loop", async () => {
    const ctx = stubContext({
      getInvestigationClock: () => ({ ...idleNliClock(), loop: true }),
      patchInvestigationClock: vi.fn(async (next) => ({ ok: true, clock: next })),
    });
    const c = makeController({
      getEffectiveGroupsForView: () => [{ id: "nli", layers: [
        { id: "lines", enabled: false },
        { id: "investigation_polygons", enabled: false },
        { id: "alarms", enabled: false },
      ] }],
      _nliFeatureCache: {
        [LINES_ID]: [389, 395, 400, 410, 740].map((minutes) => ({ properties: { timeline_minutes: minutes } })),
        [INVESTIGATION_POLYGONS_FULL_ID]: [],
        [INVESTIGATION_ALARMS_FULL_ID]: [],
      },
    });
    const membership = [LINES_ID];

    await expect(c.startNliTimelineWindow({ membership, to: 401, loop: false })).resolves.toBe(true);
    expect(ctx.patchInvestigationClock.mock.calls[0][0]).toMatchObject({
      phase: "playing",
      membership,
      beats: [389, 395, 400],
      loop: false,
    });
    expect(ctx.patchInvestigationClock.mock.calls[0][0].leadInMinutes).toBeUndefined();

    ctx.getInvestigationClock = () => idleNliClock();
    await c.startNliTimelineWindow({ membership, from: 402, loop: false });
    expect(ctx.patchInvestigationClock.mock.calls[1][0]).toMatchObject({
      phase: "playing",
      membership,
      beats: [389, 395, 400, 410, 740],
      leadInMinutes: 402,
      loop: false,
    });
  });

  test("explicit Nova start uses Nova beats while playable rows are hidden", async () => {
    const ctx = stubContext({
      getNarrativeState: () => ({ id: "nova", revision: 3 }),
      patchInvestigationClock: vi.fn(async (next) => ({ ok: true, clock: next })),
    });
    const c = makeController({
      getEffectiveGroupsForView: () => [{ id: "nli", layers: [
        { id: "lines", enabled: false },
        { id: "investigation_polygons", enabled: false },
        { id: "alarms", enabled: false },
      ] }],
      _nliFeatureCache: Object.fromEntries(NLI_PLAYABLE_IDS.map((id) => [id, []])),
    });

    await expect(c.startNliTimelineWindow({
      membership: [...NLI_PLAYABLE_IDS],
      loop: false,
    })).resolves.toBe(true);
    expect(ctx.patchInvestigationClock.mock.calls[0][0]).toMatchObject({
      phase: "playing",
      beats: NLI_NOVA_STORY.representativeMinutes,
      loop: false,
    });
  });

  test("explicit start rejects empty, invalid, beatless, and unacknowledged windows", async () => {
    const ctx = stubContext({
      patchInvestigationClock: vi.fn(async () => ({ ok: false, error: new Error("clock rejected") })),
    });
    const c = makeController({
      _nliFeatureCache: {
        [LINES_ID]: [],
        [INVESTIGATION_POLYGONS_FULL_ID]: [],
        [INVESTIGATION_ALARMS_FULL_ID]: [],
      },
    });

    await expect(c.startNliTimelineWindow({ membership: [] })).rejects.toThrow();
    await expect(c.startNliTimelineWindow({ membership: ["projector_base.SEA"] })).rejects.toThrow();
    await expect(c.startNliTimelineWindow({ membership: [LINES_ID] })).rejects.toThrow();
    c._nliFeatureCache[LINES_ID] = [{ properties: { timeline_minutes: 400 } }];
    await expect(c.startNliTimelineWindow({ membership: [LINES_ID] })).rejects.toThrow(/clock rejected/);
    expect(ctx.patchInvestigationClock).toHaveBeenCalledTimes(1);
  });

  test("explicit start does not pause a timeline that is already playing", async () => {
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400], 1000);
    const ctx = stubContext({ getInvestigationClock: () => playing });
    const c = makeController();

    await expect(c.startNliTimelineWindow({ membership: [LINES_ID] })).rejects.toThrow();
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
  });

  test("a scene replace re-arms a playing window without publishing idle", async () => {
    const beats = [389, 401, 402, 740];
    const playing = playNliClock(idleNliClock(), [LINES_ID], beats, 1000, { leadInMinutes: 402 });
    const ctx = stubContext({
      getInvestigationClock: () => playing,
      patchInvestigationClock: vi.fn(async (next) => ({ ok: true, clock: next })),
    });
    const c = makeController({
      _nliFeatureCache: {
        [LINES_ID]: beats.map((minutes) => ({ properties: { timeline_minutes: minutes } })),
      },
    });
    await expect(c.startNliTimelineWindow({
      membership: [LINES_ID],
      to: 401,
      replace: true,
    })).resolves.toBe(true);
    const patched = ctx.patchInvestigationClock.mock.calls.map(([clock]) => clock);
    expect(patched.some((clock) => clock.phase === "idle")).toBe(false);
    expect(patched.at(-1)).toMatchObject({
      phase: "playing",
      membership: [LINES_ID],
    });
    expect(patched.at(-1).leadInMinutes).toBeUndefined();
    expect(patched.at(-1).beats.every((beat) => beat <= 401)).toBe(true);
  });

  test("cancellation during cache load does not publish a playing clock", async () => {
    let release;
    vi.stubGlobal("fetch", () => new Promise((resolve) => { release = resolve; }));
    globalThis.layerRegistry = { getLayerDataUrl: () => "/nli-lines.json" };
    const ctx = stubContext();
    const c = makeController({ _nliFeatureCache: Object.create(null) });
    let current = true;
    const pending = c.startNliTimelineWindow({
      membership: [LINES_ID],
      isCurrent: () => current,
    });
    await Promise.resolve();
    current = false;
    release({ ok: true, json: async () => ({ features: lineFeatures() }) });

    await expect(pending).resolves.toBe(false);
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
  });

  test("a stalled feature load times out and a late response cannot replace the retry", async () => {
    vi.useFakeTimers();
    const lines = [{ properties: { timeline_minutes: 400 } }];
    const stale = [{ properties: { timeline_minutes: 1 } }];
    let releaseStale;
    const stalled = new Promise((resolve) => { releaseStale = resolve; });
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(() => {
      calls += 1;
      if (calls === 1) {
        return stalled.then(() => ({ ok: true, json: async () => ({ features: stale }) }));
      }
      return Promise.resolve({ ok: true, json: async () => ({ features: lines }) });
    }));
    globalThis.layerRegistry = { getLayerDataUrl: () => "/nli-lines.json" };
    const ctx = stubContext({
      patchInvestigationClock: vi.fn(async (next) => ({ ok: true, clock: next })),
    });
    const c = makeController({ _nliFeatureCache: Object.create(null) });
    const pending = c.startNliTimelineWindow({ membership: [LINES_ID], loop: false });
    const rejected = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(4000);
    await rejected;
    expect(c._nliCacheFetchInflight).toBeFalsy();

    await expect(c.startNliTimelineWindow({ membership: [LINES_ID], loop: false })).resolves.toBe(true);
    expect(ctx.patchInvestigationClock.mock.calls[0][0].beats).toEqual([400]);
    releaseStale();
    await Promise.resolve();
    await Promise.resolve();
    expect(c._nliFeatureCache[LINES_ID]).toEqual(lines);
  });

  test("playback config follows the scene while idle and the armed clock while playing", async () => {
    const host = await import("../../frontend/src/remote/nli-staff-timeline-host.js");
    const groups = [{ id: "nli", layers: [
      { id: "lines", enabled: true },
      { id: "investigation_polygons", enabled: false },
      { id: "alarms", enabled: false },
    ] }];
    const firstMinutes = host.staffPlaybackConfig({
      clock: idleNliClock(),
      cue: { layers: ["projector_base.SEA", LINES_ID, INVESTIGATION_POLYGONS_FULL_ID], clock: { to: 401 } },
      groups,
    });
    expect(firstMinutes).toEqual({
      membership: [LINES_ID, INVESTIGATION_POLYGONS_FULL_ID],
      to: 401,
    });
    expect(host.staffPlaybackConfig({
      clock: idleNliClock(),
      cue: null,
      groups,
      manualFree: true,
    })).toEqual({ membership: [LINES_ID] });
    expect(host.staffPlaybackConfig({
      clock: idleNliClock(),
      cue: { layers: ["projector_base.SEA"], clock: "idle" },
      groups,
    })).toEqual({ membership: [] });
    expect(host.staffPlaybackConfig({
      clock: { ...playNliClock(idleNliClock(), [LINES_ID], [410, 740], 0, { leadInMinutes: 402 }), phase: "playing" },
      cue: { layers: [LINES_ID, INVESTIGATION_POLYGONS_FULL_ID], clock: { to: 401 } },
      groups,
    })).toMatchObject({ membership: [LINES_ID], from: 402 });
  });

  test("manual Play after Stop keeps the scene window and the selected loop", async () => {
    const ctx = stubContext({
      getInvestigationClock: () => ({ ...idleNliClock(), loop: true }),
      patchInvestigationClock: vi.fn(async (next) => ({ ok: true, clock: next })),
    });
    const beats = [389, 395, 400, 410, 740].map((minutes) => ({ properties: { timeline_minutes: minutes } }));
    const c = makeController({
      getEffectiveGroupsForView: () => [{ id: "nli", layers: [{ id: "lines", enabled: false }] }],
      getPlaybackConfig: () => ({ membership: [LINES_ID], to: 401 }),
      _nliFeatureCache: { [LINES_ID]: beats },
    });

    await c.handleNliTimelinePlay();
    expect(ctx.patchInvestigationClock.mock.calls[0][0]).toMatchObject({
      beats: [389, 395, 400],
      loop: true,
    });
    ctx.getInvestigationClock = () => idleNliClock({ loop: true });
    c.getPlaybackConfig = () => ({ membership: [LINES_ID], from: 402 });
    await c.handleNliTimelinePlay();
    expect(ctx.patchInvestigationClock.mock.calls[1][0]).toMatchObject({
      beats: [389, 395, 400, 410, 740],
      leadInMinutes: 402,
      loop: true,
    });
  });

  test("rendered playable rows follow playback membership instead of enabling every id", async () => {
    const host = await import("../../frontend/src/remote/nli-staff-timeline-host.js");
    const group = {
      id: "nli",
      layers: [
        { id: "lines", enabled: false },
        { id: "investigation_polygons", enabled: false },
        { id: "people", enabled: true },
      ],
    };
    expect(host.nliGroupWithPlaybackMembership(group, [LINES_ID]).layers).toEqual([
      { id: "lines", enabled: true },
      { id: "investigation_polygons", enabled: false },
      { id: "people", enabled: true },
    ]);
    expect(host.nliGroupWithPlaybackMembership(group, []).layers[0].enabled).toBe(false);
  });

  test("manual timeline mutations wait while a cue is busy, and navigation drops a scrub restore", async () => {
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    const ctx = stubContext({ getInvestigationClock: () => playing });
    const c = makeController({ isManualMutationAllowed: () => false });
    await c.handleNliTimelinePlay();
    c.handleNliTimelineScrubPointerDown();
    expect(ctx.patchInvestigationClock).not.toHaveBeenCalled();
    expect(c._nliScrub).toBeNull();

    c.isManualMutationAllowed = () => true;
    const releasePointerCapture = vi.fn();
    c._nliScrubEl = { releasePointerCapture };
    c._nliScrubPointerId = 4;
    c.handleNliTimelineScrubPointerDown();
    const callsAfterDown = ctx.patchInvestigationClock.mock.calls.length;
    c.invalidateTransport();
    expect(releasePointerCapture).toHaveBeenCalledWith(4);
    await c.handleNliTimelineScrubPointerCancel();
    expect(c._nliScrub).toBeNull();
    expect(c._nliOptimisticClock).toBeNull();
    expect(ctx.patchInvestigationClock.mock.calls.length).toBe(callsAfterDown);
  });

  test("an end timer already queued behind a clock write is dropped when navigation invalidates the epoch", async () => {
    vi.useFakeTimers();
    const api = await import("../../frontend/src/shared/api-client.js");
    const resolvers = [];
    vi.spyOn(api.OTEF_API, "updateInvestigationClock").mockImplementation(
      () => new Promise((resolve) => { resolvers.push(resolve); }),
    );
    const { default: OTEFDataContext } = await import("../../frontend/src/shared/OTEFDataContext.js");
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400], 1000);
    OTEFDataContext._tableName = "otef";
    OTEFDataContext._clientId = "clock-client";
    OTEFDataContext._setInvestigationClock(playing);
    globalThis.OTEFDataContext = OTEFDataContext;
    const c = makeController();
    const held = OTEFDataContext.patchInvestigationClock({ ...playing, phase: "paused" });
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));
    c._syncNliEndedTimer(playing);
    await vi.advanceTimersByTimeAsync(clockStoryDurationMs(playing.beats));
    expect(resolvers).toHaveLength(1);
    c.invalidateTransport();
    resolvers[0]({});
    await held;
    await Promise.resolve();
    expect(api.OTEF_API.updateInvestigationClock).toHaveBeenCalledTimes(1);
    expect(OTEFDataContext.getInvestigationClock().phase).toBe("playing");
    OTEFDataContext._tableName = null;
  });

  test("a cue starts the hidden destination timeline instead of toggling from an idle snapshot", async () => {
    const { createCueRunner } = await import("../../frontend/src/remote/nli-staff-cues.js");
    const ctx = stubContext();
    const host = makeController({
      _nliFeatureCache: { [LINES_ID]: lineFeatures() },
    });
    const layers = [];
    const runner = createCueRunner({
      dataContext: {
        getNarrativeState: () => ({ id: null }),
        getPersonSelection: () => ({ personId: null }),
        setNarrative: vi.fn(async () => ({ ok: true })),
        setEscapeOverlay: vi.fn(async () => ({ ok: true })),
        getInvestigationClock: () => ctx.getInvestigationClock(),
      },
      commitLayers: async (ids) => { layers.push(ids); },
      stopClock: async () => {},
      startClock: (window, membership, isCurrent) => host.startNliTimelineWindow({
        membership,
        from: window?.from,
        to: window?.to,
        loop: window?.loop === true,
        playLeadIn: true,
        replace: true,
        isCurrent,
      }),
      endClock: async () => { throw new Error("end was not part of play entry"); },
    });
    const result = await runner.apply({
      layers: ["projector_base.SEA", LINES_ID],
      clock: { to: 401 },
      escape: {},
    }, null);
    expect(result).toEqual({ status: "ready" });
    expect(layers).toEqual([["projector_base.SEA", LINES_ID]]);
    const started = ctx.patchInvestigationClock.mock.calls.at(-1)[0];
    expect(started).toMatchObject({
      phase: "playing",
      membership: [LINES_ID],
      loop: false,
    });
    expect(started.beats.every((beat) => beat <= 401)).toBe(true);
    expect(ctx.getInvestigationClock().phase).toBe("idle");
  });

  test("a rest-of-day cue starts in the 06:41 lead-in, not at the 06:42 beat", async () => {
    const { createCueRunner } = await import("../../frontend/src/remote/nli-staff-cues.js");
    const ctx = stubContext();
    const host = makeController({
      _nliFeatureCache: {
        [LINES_ID]: [389, 401, 402, 740].map((minutes) => ({ properties: { timeline_minutes: minutes } })),
      },
    });
    const runner = createCueRunner({
      dataContext: {
        getNarrativeState: () => ({ id: null }),
        getPersonSelection: () => ({ personId: null }),
        setNarrative: vi.fn(async () => ({ ok: true })),
        setEscapeOverlay: vi.fn(async () => ({ ok: true })),
        getInvestigationClock: () => ctx.getInvestigationClock(),
      },
      commitLayers: async () => {},
      stopClock: async () => {},
      startClock: (window, membership, isCurrent) => host.startNliTimelineWindow({
        membership,
        from: window?.from,
        to: window?.to,
        loop: window?.loop === true,
        playLeadIn: true,
        replace: true,
        isCurrent,
      }),
      endClock: async () => { throw new Error("end was not part of play entry"); },
    });
    await expect(runner.apply({
      layers: ["projector_base.SEA", LINES_ID],
      clock: { from: 402 },
      escape: {},
    }, null)).resolves.toEqual({ status: "ready" });
    const started = ctx.patchInvestigationClock.mock.calls.at(-1)[0];
    expect(started).toMatchObject({
      phase: "playing",
      leadInMinutes: 402,
      positionMs: 0,
    });
    expect(evaluateClock(started, 0)).toMatchObject({ leadIn: true, clock: 402, index: -1 });
  });

  test("a queued Stop or scrub release does not publish after navigation", async () => {
    vi.useFakeTimers();
    const api = await import("../../frontend/src/shared/api-client.js");
    const resolvers = [];
    vi.spyOn(api.OTEF_API, "updateInvestigationClock").mockImplementation(
      () => new Promise((resolve) => { resolvers.push(resolve); }),
    );
    const { default: OTEFDataContext } = await import("../../frontend/src/shared/OTEFDataContext.js");
    const playing = playNliClock(idleNliClock(), [LINES_ID], [400, 740], 1000);
    OTEFDataContext._tableName = "otef";
    OTEFDataContext._clientId = "clock-client";
    OTEFDataContext.correctedNow = () => 1000;
    OTEFDataContext._setInvestigationClock(playing);
    globalThis.OTEFDataContext = OTEFDataContext;
    const c = makeController({
      getPlaybackConfig: () => ({ membership: [LINES_ID] }),
      _nliFeatureCache: { [LINES_ID]: lineFeatures() },
    });

    const held = OTEFDataContext.patchInvestigationClock({ ...playing, phase: "paused" });
    await vi.waitFor(() => expect(resolvers).toHaveLength(1));
    void c.handleNliTimelineStop();
    await Promise.resolve();
    c.invalidateTransport();
    resolvers[0]({});
    await held;
    await Promise.resolve();
    await Promise.resolve();
    expect(api.OTEF_API.updateInvestigationClock).toHaveBeenCalledTimes(1);

    const heldAgain = OTEFDataContext.patchInvestigationClock({ ...playing, phase: "paused" });
    await vi.waitFor(() => expect(resolvers).toHaveLength(2));
    void c.handleNliTimelineScrubPointerUp(1);
    await Promise.resolve();
    c.invalidateTransport();
    resolvers[1]({});
    await heldAgain;
    await Promise.resolve();
    await Promise.resolve();
    expect(api.OTEF_API.updateInvestigationClock).toHaveBeenCalledTimes(2);
    expect(OTEFDataContext.getInvestigationClock().phase).toBe("playing");
    OTEFDataContext._tableName = null;
  });

  test("a late failed feature response does not clear the retry cache", async () => {
    vi.useFakeTimers();
    const lines = [{ properties: { timeline_minutes: 400 } }];
    let releaseStale;
    const stalled = new Promise((resolve) => { releaseStale = resolve; });
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(() => {
      calls += 1;
      if (calls === 1) return stalled.then(() => ({ ok: false, status: 500, json: async () => ({}) }));
      return Promise.resolve({ ok: true, json: async () => ({ features: lines }) });
    }));
    globalThis.layerRegistry = { getLayerDataUrl: () => "/nli-lines.json" };
    const ctx = stubContext({
      patchInvestigationClock: vi.fn(async (next) => ({ ok: true, clock: next })),
    });
    const c = makeController({ _nliFeatureCache: Object.create(null) });
    const pending = c.startNliTimelineWindow({ membership: [LINES_ID], loop: false });
    const rejected = expect(pending).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(4000);
    await rejected;
    await expect(c.startNliTimelineWindow({ membership: [LINES_ID], loop: false })).resolves.toBe(true);
    expect(ctx.patchInvestigationClock.mock.calls[0][0].beats).toEqual([400]);
    releaseStale();
    await Promise.resolve();
    await Promise.resolve();
    expect(c._nliFeatureCache[LINES_ID]).toEqual(lines);
  });


});
