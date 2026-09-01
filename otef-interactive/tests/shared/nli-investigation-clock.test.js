import { describe, expect, it } from "vitest";
import {
  INVESTIGATION_ALARMS_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
  TIMELINE_BEAT_MS,
  TIMELINE_HOLD_MS,
  clockStoryDurationMs,
} from "../../frontend/src/shared/nli-investigation-beats.js";
import {
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

const polygons = INVESTIGATION_POLYGONS_FULL_ID;
const alarms = INVESTIGATION_ALARMS_FULL_ID;
const beats = [400, 420, 440];
const canonicalSemanticKeys = [
  "anchorMs", "beats", "loop", "membership", "phase", "positionMs", "seekKind",
];
const removedSemanticKeys = [
  "beatIndex", "beatElapsedMs", "playEpochMs", "narrativeEpochMs",
  "narrativeElapsedMs", "cycleIndex", "cycleKey", "alarmOnsetBeat",
  "alarmOnsetCycleIndex",
];

function expectCanonical(clock, { onset = false } = {}) {
  const semantic = Object.keys(clock)
    .filter((key) => key !== "revision" && key !== "serverNowMs")
    .sort();
  expect(semantic).toEqual(
    [...canonicalSemanticKeys, ...(onset ? ["alarmOnsetOriginMs"] : [])].sort(),
  );
  for (const key of removedSemanticKeys) expect(clock).not.toHaveProperty(key);
}

describe("canonical clock actions", () => {
  it("play and replay start at absolute position zero at now", () => {
    const playing = playNliClock(idleNliClock(), [polygons], beats, 1_000);
    expect(playing).toMatchObject({
      phase: "playing", membership: [polygons], beats,
      positionMs: 0, anchorMs: 1_000, seekKind: "none",
    });
    expectCanonical(playing);
    expect(evaluateClock(playing, 1_800)).toMatchObject({
      phase: "playing", mode: "beat", clock: 400, index: 0, beatElapsedMs: 800,
    });

    const replayed = replayNliClock(endNliClock(playing), 9_000);
    expect(replayed).toMatchObject({
      positionMs: 0, anchorMs: 9_000, membership: [polygons], beats,
    });
    expect(evaluateClock(replayed, 9_000).clock).toBe(400);
    expectCanonical(replayed);
  });

  it("stop returns canonical idle and preserves loop", () => {
    const stopped = stopNliClock(setNliLoop(idleNliClock(), true));
    expect(stopped).toEqual({
      phase: "idle", membership: [], beats: [], loop: true,
      positionMs: 0, anchorMs: null, seekKind: "none",
      revision: 0, serverNowMs: null,
    });
    expectCanonical(stopped);
  });

  it("pause freezes exact multi-cycle position and resume reanchors", () => {
    const duration = clockStoryDurationMs(beats);
    const looping = setNliLoop(
      playNliClock(idleNliClock(), [polygons], beats, 0),
      true,
    );
    const absolute = duration * 2 + TIMELINE_BEAT_MS + 275;
    const paused = pauseNliClock(looping, absolute);
    expect(paused).toMatchObject({
      phase: "paused", positionMs: absolute, anchorMs: absolute, seekKind: "none",
    });
    expect(evaluateClock(paused, 999_999)).toMatchObject({
      clock: 420, index: 1, beatElapsedMs: 275,
    });

    const resumed = resumeNliClock(paused, 50_000);
    expect(resumed).toMatchObject({
      phase: "playing", positionMs: absolute, anchorMs: 50_000, seekKind: "none",
    });
    expect(evaluateClock(resumed, 50_000)).toMatchObject({
      clock: 420, index: 1, beatElapsedMs: 275,
    });
    expect(evaluateClock(resumed, 50_200).beatElapsedMs).toBe(475);
    expectCanonical(paused);
    expectCanonical(resumed);
  });

  it("pause and resume preserve the serialized alarm onset", () => {
    const playing = playNliClock(idleNliClock(), [alarms], beats, 1_000);
    const paused = pauseNliClock(playing, 1_400);
    const resumed = resumeNliClock(paused, 5_000);
    expect(paused.alarmOnsetOriginMs).toBe(1_000);
    expect(resumed.alarmOnsetOriginMs).toBe(1_000);
  });

  it("preserves beat, hold, end, and loop boundaries", () => {
    const oneBeat = playNliClock(idleNliClock(), [polygons], [400], 0);
    const duration = clockStoryDurationMs([400]);
    expect(duration).toBe(TIMELINE_BEAT_MS + TIMELINE_HOLD_MS);
    expect(evaluateClock(oneBeat, TIMELINE_BEAT_MS)).toMatchObject({
      mode: "hold", beatElapsedMs: 0,
    });
    expect(evaluateClock(oneBeat, duration - 1).phase).toBe("playing");
    expect(evaluateClock(oneBeat, duration).phase).toBe("ended");
    expect(evaluateClock(setNliLoop(oneBeat, true), duration)).toMatchObject({
      phase: "playing", mode: "beat", clock: 400, beatElapsedMs: 0,
    });
  });

  it("pause in hold preserves all completed narrative state", () => {
    const playing = playNliClock(idleNliClock(), [polygons], beats, 0);
    const holdPosition = beats.length * TIMELINE_BEAT_MS + 400;
    const paused = pauseNliClock(playing, holdPosition);
    expect(paused.positionMs).toBe(holdPosition);
    expect(evaluateClock(paused, 99_000)).toMatchObject({
      phase: "paused", mode: "hold", index: -1, beatElapsedMs: 400,
    });
    const resumed = resumeNliClock(paused, 20_000);
    expect(evaluateClock(resumed, 20_000)).toMatchObject({
      mode: "hold", beatElapsedMs: 400,
    });
    expect(
      evaluateClock(resumed, 20_000 + TIMELINE_HOLD_MS - 400).phase,
    ).toBe("ended");
  });

  it("end freezes the canonical terminal position", () => {
    const ended = endNliClock(
      playNliClock(idleNliClock(), [polygons], beats, 0),
    );
    expect(ended).toMatchObject({
      phase: "ended", positionMs: clockStoryDurationMs(beats),
      anchorMs: null, seekKind: "none",
    });
    expectCanonical(ended);
  });
});

describe("seek and step boundary policy", () => {
  it("seek arms idle at a boundary and stamps the serialized origin", () => {
    const jumped = seekNliClock(idleNliClock(), 1, 10_000, {
      visibleMembership: [polygons], beats,
    });
    expect(jumped).toMatchObject({
      phase: "paused", positionMs: TIMELINE_BEAT_MS,
      anchorMs: 10_000, seekKind: "jump",
    });
    expect(evaluateClock(jumped, 99_000)).toMatchObject({
      phase: "paused", clock: 420, index: 1, beatElapsedMs: 0,
    });
    expectCanonical(jumped);
  });

  it("step from idle arms beat zero and backward step is a no-op", () => {
    const arm = { visibleMembership: [polygons], beats };
    expect(stepNliClock(idleNliClock(), -1, 1_000, arm).phase).toBe("idle");
    expect(stepNliClock(idleNliClock(), 1, 1_000, arm)).toMatchObject({
      phase: "paused", positionMs: 0, anchorMs: 1_000, seekKind: "jump",
    });
  });

  it("step while playing jumps to a boundary and never wraps backward", () => {
    const playing = setNliLoop(
      playNliClock(idleNliClock(), [polygons], beats, 0),
      true,
    );
    expect(stepNliClock(playing, 1, 800)).toMatchObject({
      phase: "paused", positionMs: TIMELINE_BEAT_MS,
      anchorMs: 800, seekKind: "jump",
    });
    const atFirst = seekNliClock(playing, 0, 1_000);
    expect(stepNliClock(atFirst, -1, 1_500)).toBe(atFirst);
  });

  it("step past the last beat freezes progress when loop is off", () => {
    const playing = playNliClock(idleNliClock(), [polygons], [400, 420], 0);
    const now = TIMELINE_BEAT_MS + 800;
    const stepped = stepNliClock(playing, 1, now);
    expect(stepped).toMatchObject({
      phase: "paused", positionMs: now, anchorMs: now, seekKind: "none",
    });
    expect(evaluateClock(stepped, 99_000)).toMatchObject({
      index: 1, beatElapsedMs: 800,
    });
  });

  it("step past the last beat advances to the next absolute loop cycle", () => {
    const duration = clockStoryDurationMs(beats);
    const looping = setNliLoop(
      playNliClock(idleNliClock(), [polygons], beats, 0),
      true,
    );
    const now = duration * 2 + (beats.length - 1) * TIMELINE_BEAT_MS + 100;
    const wrapped = stepNliClock(looping, 1, now);
    expect(wrapped).toMatchObject({
      phase: "paused", positionMs: duration * 3,
      anchorMs: now, seekKind: "jump",
    });
    expect(evaluateClock(wrapped, now)).toMatchObject({ index: 0, clock: 400 });
  });

  it("jump flash retains the previous-story-beat boundary", () => {
    expect(flashPreviousClock(beats, 420, { isJump: true })).toBe(400);
    expect(flashPreviousClock(beats, 400, { isJump: true })).toBe(400);
    expect(flashPreviousClock(beats, 400, { isJump: false })).toBeNull();
  });
});

describe("context-free clock parsing", () => {
  it("does not inherit any field from the previous client snapshot", () => {
    const raw = {
      phase: "paused", membership: [polygons], beats, loop: false,
      positionMs: 725, anchorMs: 5_000, seekKind: "none",
      revision: 8, serverNowMs: 6_000,
    };
    const hostilePrevious = {
      ...raw, loop: true, positionMs: 99_999, alarmOnsetOriginMs: 123,
    };
    expect(normalizeNliClock(raw, hostilePrevious)).toEqual(normalizeNliClock(raw));
    expect(normalizeNliClock(raw)).toEqual(raw);
    expectCanonical(normalizeNliClock(raw));
  });

  it("reads legacy playing from narrativeEpochMs before playEpochMs", () => {
    const legacy = normalizeNliClock({
      phase: "playing", membership: [polygons], beats, loop: true,
      beatIndex: 2, beatElapsedMs: 200, playEpochMs: 1_000,
      narrativeEpochMs: 500, seekKind: "none", revision: 4,
    });
    expect(legacy).toMatchObject({
      phase: "playing", positionMs: 0, anchorMs: 500, revision: 4,
    });
    expect(
      evaluateClock(legacy, 500 + clockStoryDurationMs(beats) + 100),
    ).toMatchObject({ index: 0, beatElapsedMs: 100 });
    expectCanonical(legacy);
  });

  it("reads legacy paused cycle/narrative position before beat fallback", () => {
    const duration = clockStoryDurationMs(beats);
    const legacy = normalizeNliClock({
      phase: "paused", membership: [polygons], beats, loop: true,
      beatIndex: 0, beatElapsedMs: 12,
      narrativeElapsedMs: TIMELINE_BEAT_MS + 350, cycleIndex: 2,
      narrativeEpochMs: 1_000, seekKind: "none",
    });
    expect(legacy.positionMs).toBe(duration * 2 + TIMELINE_BEAT_MS + 350);
    expect(legacy.anchorMs).toBe(1_000 + legacy.positionMs);
    expect(evaluateClock(legacy, 999_000)).toMatchObject({
      index: 1, beatElapsedMs: 350,
    });
  });

  it("reads legacy paused hold and jump without using receipt time", () => {
    const hold = normalizeNliClock({
      phase: "paused", membership: [polygons], beats, loop: false,
      beatIndex: -1, beatElapsedMs: 450, playEpochMs: null, seekKind: "none",
    });
    expect(hold.positionMs).toBe(beats.length * TIMELINE_BEAT_MS + 450);
    expect(evaluateClock(hold, 999_000)).toMatchObject({
      mode: "hold", beatElapsedMs: 450,
    });

    const jump = normalizeNliClock({
      phase: "paused", membership: [polygons], beats, loop: false,
      beatIndex: 1, beatElapsedMs: 0, playEpochMs: 12_345, seekKind: "jump",
    });
    expect(jump).toMatchObject({
      positionMs: TIMELINE_BEAT_MS, anchorMs: 12_345, seekKind: "jump",
    });
  });

  it("maps legacy idle and ended deterministically", () => {
    expect(normalizeNliClock({ phase: "idle", loop: true, revision: 7 })).toEqual({
      phase: "idle", membership: [], beats: [], loop: true,
      positionMs: 0, anchorMs: null, seekKind: "none",
      revision: 7, serverNowMs: null,
    });
    const ended = normalizeNliClock({
      phase: "ended", membership: [polygons], beats, loop: false, revision: 9,
    });
    expect(ended).toMatchObject({
      phase: "ended", positionMs: clockStoryDurationMs(beats),
      anchorMs: null, revision: 9,
    });
    expectCanonical(ended);
  });
});
