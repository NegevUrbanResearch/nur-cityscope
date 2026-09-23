import { describe, expect, it } from "vitest";
import {
  TIMELINE_HOLD_MS,
  clockStoryDurationMs,
  mapClockStoryPosition,
  timelinePhaseAt,
} from "../../frontend/src/shared/nli-investigation-beats.js";

const at = (hours, minutes) => hours * 60 + minutes;

describe("Segev clock beat durations", () => {
  const beats = [at(6, 29), at(6, 41), at(6, 42), at(10, 59), at(11, 0), at(12, 20)];

  it("holds 06:29 through 06:41 for 4 seconds each", () => {
    expect(mapClockStoryPosition(beats, {}, 0)).toMatchObject({
      mode: "beat", clock: at(6, 29), index: 0, beatElapsedMs: 0,
    });
    expect(mapClockStoryPosition(beats, {}, 4000)).toMatchObject({
      mode: "beat", clock: at(6, 41), index: 1, beatElapsedMs: 0,
    });
    expect(mapClockStoryPosition(beats, {}, 8000 - 1).clock).toBe(at(6, 41));
  });

  it("holds 06:42 until 11:00 for 2.5 seconds each", () => {
    expect(mapClockStoryPosition(beats, {}, 8000)).toMatchObject({
      mode: "beat", clock: at(6, 42), index: 2, beatElapsedMs: 0,
    });
    expect(mapClockStoryPosition(beats, {}, 8000 + 2500)).toMatchObject({
      mode: "beat", clock: at(10, 59), index: 3, beatElapsedMs: 0,
    });
    expect(mapClockStoryPosition(beats, {}, 8000 + 5000 - 1).clock).toBe(at(10, 59));
  });

  it("holds 11:00 through the end of the timeline for 1 second each", () => {
    const lateStart = 8000 + 5000;
    expect(mapClockStoryPosition(beats, {}, lateStart)).toMatchObject({
      mode: "beat", clock: at(11, 0), index: 4, beatElapsedMs: 0,
    });
    expect(mapClockStoryPosition(beats, {}, lateStart + 1000)).toMatchObject({
      mode: "beat", clock: at(12, 20), index: 5, beatElapsedMs: 0,
    });
    expect(mapClockStoryPosition(beats, {}, lateStart + 2000)).toMatchObject({
      mode: "hold", clock: null, index: -1, beatElapsedMs: 0,
    });
  });

  it("sizes one cycle as the sum of those beat lengths plus the hold", () => {
    const playableMs = 4000 + 4000 + 2500 + 2500 + 1000 + 1000;
    expect(clockStoryDurationMs(beats)).toBe(playableMs + TIMELINE_HOLD_MS);
    expect(timelinePhaseAt(8000 + 100, beats)).toMatchObject({
      mode: "beat", clock: at(6, 42), index: 2, beatElapsedMs: 100,
    });
  });
});
