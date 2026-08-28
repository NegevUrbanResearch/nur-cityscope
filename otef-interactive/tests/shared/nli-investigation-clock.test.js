import { describe, expect, it } from "vitest";
import {
  INVESTIGATION_ALARMS_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
  TIMELINE_BEAT_MS,
  TIMELINE_HOLD_MS,
  clockStoryDurationMs,
  collectPlaybackTimelineBeats,
} from "../../frontend/src/shared/nli-investigation-beats.js";
import {
  beatsForMembership,
  endNliClock,
  evaluateClock,
  flashPreviousClock,
  idleNliClock,
  normalizeNliClock,
  pauseNliClock,
  playNliClock,
  replayNliClock,
  resumeNliClock,
  seekNliClock,
  setNliLoop,
  stepNliClock,
  stopNliClock,
} from "../../frontend/src/shared/nli-investigation-clock.js";

const poly = [
  { properties: { timeline_minutes: 400 } },
  { properties: { timeline_minutes: 420 } },
];
const alarms = [
  { properties: { alarm_minutes: [391, 401, 402, 430] } },
];
const bags = { polygonFeatures: poly, lineFeatures: [], alarmFeatures: alarms };

describe("nli-investigation-clock", () => {
  it("idle keeps loop from previous stop", () => {
    const stopped = stopNliClock(setNliLoop(idleNliClock(), true));
    expect(stopped).toMatchObject({ phase: "idle", membership: [], beats: [], loop: true, seekKind: "none" });
  });

  it("play freezes membership; hitchhike does not add alarm bins", () => {
    const membership = [INVESTIGATION_POLYGONS_FULL_ID, INVESTIGATION_ALARMS_FULL_ID];
    const beats = beatsForMembership(membership, bags);
    expect(beats).toEqual([400, 420]);
    expect(
      collectPlaybackTimelineBeats(false, false, true, null, null, alarms).length,
    ).toBeGreaterThan(2);
    const clock = playNliClock(idleNliClock(), membership, beats, 1000);
    expect(clock.phase).toBe("playing");
    expect(clock.membership).toEqual(membership);
    expect(evaluateClock(clock, 1000)).toMatchObject({ mode: "beat", clock: 400, index: 0, beatElapsedMs: 0 });
  });

  it("play from idle starts at beat 0; play from paused resumes the armed beat", () => {
    const beats = [400, 420];
    const fromIdle = playNliClock(idleNliClock(), [INVESTIGATION_POLYGONS_FULL_ID], beats, 0);
    expect(evaluateClock(fromIdle, 0).clock).toBe(400);
    const armed = seekNliClock(idleNliClock(), 1, 0, {
      visibleMembership: [INVESTIGATION_POLYGONS_FULL_ID],
      beats,
    });
    expect(armed.phase).toBe("paused");
    expect(armed.beatIndex).toBe(1);
    const resumed = resumeNliClock(armed, 50);
    expect(resumed.phase).toBe("playing");
    expect(evaluateClock(resumed, 50).clock).toBe(420);
  });

  it("pause freezes in-beat progress; resume continues", () => {
    let clock = playNliClock(idleNliClock(), [INVESTIGATION_POLYGONS_FULL_ID], [400, 420], 0);
    clock = pauseNliClock(clock, 800);
    expect(clock.phase).toBe("paused");
    expect(clock.beatElapsedMs).toBe(800);
    expect(evaluateClock(clock, 99999)).toMatchObject({ clock: 400, beatElapsedMs: 800 });
    clock = resumeNliClock(clock, 5000);
    expect(evaluateClock(clock, 5000)).toMatchObject({ clock: 400, beatElapsedMs: 800 });
  });

  it("seek jump flash uses previous story beat, not drag origin; beat 0 empty window", () => {
    expect(flashPreviousClock([400, 410, 420], 420, { isJump: true })).toBe(410);
    expect(flashPreviousClock([400, 420], 400, { isJump: true })).toBe(400);
    expect(flashPreviousClock([400, 420], 400, { isJump: false })).toBe(null);
  });

  it("loop off evaluate ended after hold; loop on wraps without PATCH", () => {
    const beats = [400];
    const dur = clockStoryDurationMs(beats);
    expect(dur).toBe(TIMELINE_BEAT_MS + TIMELINE_HOLD_MS);
    const clock = playNliClock(idleNliClock(), [INVESTIGATION_POLYGONS_FULL_ID], beats, 0);
    expect(evaluateClock(clock, TIMELINE_BEAT_MS).mode).toBe("hold");
    expect(evaluateClock(clock, dur).phase).toBe("ended");
    const looping = setNliLoop(playNliClock(idleNliClock(), [INVESTIGATION_POLYGONS_FULL_ID], beats, 0), true);
    expect(evaluateClock(looping, dur).mode).toBe("beat");
    expect(evaluateClock(looping, dur).clock).toBe(400);
  });

  it("replay from ended reuses membership and restarts beat 0", () => {
    const membership = [INVESTIGATION_POLYGONS_FULL_ID];
    const beats = [400, 420];
    const ended = endNliClock(playNliClock(idleNliClock(), membership, beats, 0));
    expect(ended.phase).toBe("ended");
    const again = replayNliClock(ended, 9000);
    expect(again.phase).toBe("playing");
    expect(again.membership).toEqual(membership);
    expect(again.beats).toEqual(beats);
    expect(evaluateClock(again, 9000).clock).toBe(400);
  });

  it("step from idle arms paused; step while playing ends paused", () => {
    const beats = [400, 420];
    const arm = { visibleMembership: [INVESTIGATION_POLYGONS_FULL_ID], beats };
    const stepped = stepNliClock(idleNliClock(), 1, 0, arm);
    expect(stepped.phase).toBe("paused");
    expect(stepped.beatIndex).toBe(0);
    const playing = playNliClock(idleNliClock(), [INVESTIGATION_POLYGONS_FULL_ID], beats, 0);
    const afterStep = stepNliClock(playing, 1, 0);
    expect(afterStep.phase).toBe("paused");
    expect(afterStep.beatIndex).toBe(1);
    const atEnd = seekNliClock(playing, 1, 0);
    const noWrap = stepNliClock({ ...atEnd, phase: "paused", beatIndex: 1, loop: false }, 1, 0);
    expect(noWrap.phase).toBe("paused");
    expect(noWrap.beatIndex).toBe(1);
    const emptyArm = stepNliClock(idleNliClock(), 1, 0, {
      visibleMembership: [INVESTIGATION_POLYGONS_FULL_ID],
      beats: [],
    });
    expect(emptyArm.phase).toBe("idle");
  });

  it("pause during hold stays in hold, not last beat at elapsed 0", () => {
    const beats = [400, 420];
    const playing = playNliClock(idleNliClock(), [INVESTIGATION_POLYGONS_FULL_ID], beats, 0);
    const holdNow = beats.length * TIMELINE_BEAT_MS;
    expect(evaluateClock(playing, holdNow)).toMatchObject({ mode: "hold", clock: null });
    const paused = pauseNliClock(playing, holdNow);
    expect(paused.phase).toBe("paused");
    expect(evaluateClock(paused, holdNow)).toMatchObject({ mode: "hold", clock: null, index: -1 });
  });

  it("step +1 at last beat while playing, loop off, stays paused on that beat without jump reset", () => {
    const beats = [400, 420];
    const playing = playNliClock(idleNliClock(), [INVESTIGATION_POLYGONS_FULL_ID], beats, 0);
    const nowMs = TIMELINE_BEAT_MS + 800;
    expect(evaluateClock(playing, nowMs)).toMatchObject({ mode: "beat", index: 1, beatElapsedMs: 800 });
    const stepped = stepNliClock(playing, 1, nowMs);
    expect(stepped.phase).toBe("paused");
    expect(stepped.beatIndex).toBe(1);
    expect(stepped.beatElapsedMs).toBe(800);
    expect(stepped.seekKind).not.toBe("jump");
    expect(evaluateClock(stepped, nowMs)).toMatchObject({ clock: 420, index: 1, beatElapsedMs: 800 });
  });

  it("step -1 at beat 0 with loop on is a no-op", () => {
    const beats = [400, 420];
    const paused = seekNliClock(idleNliClock(), 0, 0, {
      visibleMembership: [INVESTIGATION_POLYGONS_FULL_ID],
      beats,
    });
    const looping = setNliLoop(paused, true);
    expect(looping.beatIndex).toBe(0);
    const stepped = stepNliClock(looping, -1, 0);
    expect(stepped.beatIndex).toBe(0);
    expect(stepped.phase).toBe("paused");
  });

  it("stop/normalize keeps null timestamps instead of coercing to 0", () => {
    const stopped = stopNliClock({ ...idleNliClock(), serverNowMs: null });
    expect(stopped.serverNowMs).toBeNull();
    const normalized = normalizeNliClock({ ...idleNliClock(), serverNowMs: null });
    expect(normalized.serverNowMs).toBeNull();
    const playing = normalizeNliClock({
      phase: "playing",
      membership: [INVESTIGATION_POLYGONS_FULL_ID],
      beats: [400, 420],
      beatIndex: 0,
      beatElapsedMs: 0,
      playEpochMs: null,
      loop: false,
      seekKind: "none",
    });
    expect(playing.phase).toBe("playing");
    expect(playing.playEpochMs).toBeNull();
  });

  it("playing hold reports hold elapsed greater than 0", () => {
    const beats = [400, 420];
    const playing = playNliClock(idleNliClock(), [INVESTIGATION_POLYGONS_FULL_ID], beats, 0);
    const holdElapsed = 400;
    const holdNow = beats.length * TIMELINE_BEAT_MS + holdElapsed;
    expect(evaluateClock(playing, holdNow)).toMatchObject({
      mode: "hold",
      clock: null,
      index: -1,
      beatElapsedMs: holdElapsed,
    });
  });

  it("pause during hold then resume continues hold, not beat 0", () => {
    const beats = [400, 420];
    const playing = playNliClock(idleNliClock(), [INVESTIGATION_POLYGONS_FULL_ID], beats, 0);
    const holdElapsed = 400;
    const holdNow = beats.length * TIMELINE_BEAT_MS + holdElapsed;
    const paused = pauseNliClock(playing, holdNow);
    expect(paused.phase).toBe("paused");
    expect(paused.beatIndex).toBe(-1);
    expect(paused.beatElapsedMs).toBe(holdElapsed);
    expect(evaluateClock(paused, 99999)).toMatchObject({
      mode: "hold",
      clock: null,
      index: -1,
      beatElapsedMs: holdElapsed,
    });
    const resumed = resumeNliClock(paused, 20000);
    expect(resumed.phase).toBe("playing");
    expect(evaluateClock(resumed, 20000)).toMatchObject({
      mode: "hold",
      clock: null,
      index: -1,
      beatElapsedMs: holdElapsed,
    });
  });

  it("after remaining hold time from resume, evaluate is ended", () => {
    const beats = [400, 420];
    const playing = playNliClock(idleNliClock(), [INVESTIGATION_POLYGONS_FULL_ID], beats, 0);
    const holdElapsed = 400;
    const holdNow = beats.length * TIMELINE_BEAT_MS + holdElapsed;
    const resumeAt = 20000;
    const resumed = resumeNliClock(pauseNliClock(playing, holdNow), resumeAt);
    expect(evaluateClock(resumed, resumeAt + (TIMELINE_HOLD_MS - holdElapsed)).phase).toBe("ended");
  });

  it("step +1 while playing in hold, loop off, stays paused in hold with same elapsed", () => {
    const beats = [400, 420];
    const playing = playNliClock(idleNliClock(), [INVESTIGATION_POLYGONS_FULL_ID], beats, 0);
    const holdElapsed = 400;
    const holdNow = beats.length * TIMELINE_BEAT_MS + holdElapsed;
    expect(evaluateClock(playing, holdNow)).toMatchObject({
      mode: "hold",
      clock: null,
      index: -1,
      beatElapsedMs: holdElapsed,
    });
    const stepped = stepNliClock(playing, 1, holdNow);
    expect(stepped.phase).toBe("paused");
    expect(stepped.beatIndex).toBe(-1);
    expect(stepped.beatElapsedMs).toBe(holdElapsed);
    expect(stepped.seekKind).not.toBe("jump");
    expect(evaluateClock(stepped, holdNow)).toMatchObject({
      mode: "hold",
      clock: null,
      index: -1,
      beatElapsedMs: holdElapsed,
    });
    const resumeAt = 20000;
    const resumed = resumeNliClock(stepped, resumeAt);
    expect(resumed.phase).toBe("playing");
    expect(evaluateClock(resumed, resumeAt)).toMatchObject({
      mode: "hold",
      clock: null,
      index: -1,
      beatElapsedMs: holdElapsed,
    });
    expect(evaluateClock(resumed, resumeAt + (TIMELINE_HOLD_MS - holdElapsed)).phase).toBe("ended");
  });

  it("normalize idle payload keeps incoming revision and serverNowMs", () => {
    const normalized = normalizeNliClock({
      phase: "idle",
      loop: true,
      revision: 7,
      serverNowMs: 12345,
    });
    expect(normalized.phase).toBe("idle");
    expect(normalized.loop).toBe(true);
    expect(normalized.revision).toBe(7);
    expect(normalized.serverNowMs).toBe(12345);
  });

  it("seek stamps playEpochMs and evaluateClock clamps to that beat", () => {
    const now = 10_000;
    const paused = playNliClock(idleNliClock(), ["nli.lines"], [400, 740], 0);
    const jumped = seekNliClock(paused, 1, now);
    expect(jumped.phase).toBe("paused");
    expect(jumped.seekKind).toBe("jump");
    expect(jumped.playEpochMs).toBe(now);
    const mid = evaluateClock(jumped, now + 1600);
    expect(mid.index).toBe(1);
    expect(mid.beatElapsedMs).toBe(1600);
    const late = evaluateClock(jumped, now + 10_000);
    expect(late.index).toBe(1);
    expect(late.beatElapsedMs).toBe(3200);
    expect(late.phase).toBe("paused");
  });

  it("successful step stamps playEpochMs nowMs not full-story epoch", () => {
    const now = 1_000;
    const playing = playNliClock(idleNliClock(), ["nli.lines"], [400, 740], 0);
    const stepped = stepNliClock(playing, 1, now);
    expect(stepped.phase).toBe("paused");
    expect(stepped.seekKind).toBe("jump");
    expect(stepped.beatElapsedMs).toBe(0);
    expect(stepped.playEpochMs).toBe(now);
    expect(stepped.playEpochMs).not.toBe(now - TIMELINE_BEAT_MS);
  });

  it("resume after jump freeze starts next beat not this beat at 0", () => {
    const now = 10_000;
    const jumped = seekNliClock(idleNliClock(), 1, now, {
      visibleMembership: ["nli.lines"],
      beats: [400, 420, 740],
    });
    const freezeAt = now + TIMELINE_BEAT_MS;
    expect(evaluateClock(jumped, freezeAt)).toMatchObject({
      index: 1,
      beatElapsedMs: TIMELINE_BEAT_MS,
      phase: "paused",
    });
    const resumed = resumeNliClock(jumped, freezeAt);
    expect(resumed.phase).toBe("playing");
    expect(evaluateClock(resumed, freezeAt)).not.toMatchObject({
      index: 1,
      beatElapsedMs: 0,
    });
    expect(evaluateClock(resumed, freezeAt)).toMatchObject({
      index: 2,
      beatElapsedMs: 0,
      clock: 740,
    });
  });

  it("resume mid jump one-shot continues this trail", () => {
    const now = 10_000;
    const jumped = seekNliClock(idleNliClock(), 1, now, {
      visibleMembership: ["nli.lines"],
      beats: [400, 420, 740],
    });
    const mid = now + 1600;
    const resumed = resumeNliClock(jumped, mid);
    expect(evaluateClock(resumed, mid)).toMatchObject({
      index: 1,
      beatElapsedMs: 1600,
      clock: 420,
    });
  });

  it("pauseNliClock still nulls playEpochMs and freeze stored elapsed", () => {
    const playing = playNliClock(idleNliClock(), ["nli.lines"], [400, 740], 0);
    const paused = pauseNliClock(playing, 800);
    expect(paused.playEpochMs).toBeNull();
    expect(paused.beatElapsedMs).toBe(800);
    expect(evaluateClock(paused, 99999)).toMatchObject({ index: 0, beatElapsedMs: 800, phase: "paused" });
  });

  it("normalizeNliClock keeps finite playEpochMs when paused", () => {
    const normalized = normalizeNliClock({
      phase: "paused",
      membership: ["nli.lines"],
      beats: [400, 740],
      beatIndex: 1,
      beatElapsedMs: 0,
      playEpochMs: 12_345,
      loop: false,
      seekKind: "jump",
    });
    expect(normalized.phase).toBe("paused");
    expect(normalized.playEpochMs).toBe(12_345);
    expect(normalized.seekKind).toBe("jump");
    const idle = normalizeNliClock({
      phase: "idle",
      playEpochMs: 12_345,
    });
    expect(idle.playEpochMs).toBeNull();
    const ended = normalizeNliClock({
      phase: "ended",
      membership: ["nli.lines"],
      beats: [400, 740],
      playEpochMs: 12_345,
    });
    expect(ended.playEpochMs).toBeNull();
  });
});
