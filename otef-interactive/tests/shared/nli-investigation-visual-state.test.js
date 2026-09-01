import { describe, expect, it } from "vitest";
import {
  NLI_DISPLAY_PROFILES,
  NLI_VISUAL_TOKENS,
} from "../../frontend/src/shared/nli-investigation-theme.js";
import {
  deriveInvestigationFrame,
} from "../../frontend/src/shared/nli-investigation-visual-state.js";
import {
  INVESTIGATION_ALARMS_FULL_ID,
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
  TIMELINE_BEAT_MS,
  clockStoryDurationMs,
} from "../../frontend/src/shared/nli-investigation-beats.js";
import {
  endNliClock,
  idleNliClock,
  pauseNliClock,
  playNliClock,
  replayNliClock,
  resumeNliClock,
  seekNliClock,
  setNliLoop,
  stopNliClock,
} from "../../frontend/src/shared/nli-investigation-clock.js";

const enabled = [
  INVESTIGATION_POLYGONS_FULL_ID,
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_ALARMS_FULL_ID,
];
const membership = enabled;
const beats = [400, 420, 440];

describe("nli-investigation-theme", () => {
  it("owns the fixed semantic tokens and distinct display multipliers", () => {
    expect(NLI_VISUAL_TOKENS).toMatchObject({
      polygonOrange: "#f79009",
      routeFuture: "#c31f4f",
      routeRestingOpacity: 0.42,
      routeReveal: "#c31f4f",
      incidentRed: "#c31f4f",
      routeFlowColor: "#000000",
      alarmYellow: "#f5c542",
      annotationInk: "#fff7ed",
      revealDurationMs: 3200,
      alarmRippleDurationMs: 900,
      completedFlowStepMs: 66,
      routeCarrierWidth: 2.4,
      routeFlowWidth: 1.35,
      routeFlowDensity: 8,
      routeFlowDutyCycle: 0.45,
      routeFlowSpeed: 0.00072,
      alarmRadiusStops: [[1, 4], [7, 8], [26, 14], [77, 19]],
    });
    expect(NLI_DISPLAY_PROFILES.gis).toHaveProperty("lineWidthMultiplier");
    expect(NLI_DISPLAY_PROFILES.gis).toHaveProperty("routeScale", 1);
    expect(NLI_DISPLAY_PROFILES.projection.routeScale).toBeGreaterThan(1);
    expect(NLI_DISPLAY_PROFILES.projection).toHaveProperty("lineWidthMultiplier");
    expect(NLI_DISPLAY_PROFILES.gis.lineWidthMultiplier).not.toBe(
      NLI_DISPLAY_PROFILES.projection.lineWidthMultiplier,
    );
  });
});

describe("deriveInvestigationFrame", () => {
  it("activates a polygon-only beat immediately", () => {
    const clock = playNliClock(idleNliClock(), membership, beats, 0);
    const frame = deriveInvestigationFrame(clock, 0, enabled, {
      motionMode: "full",
      routeBeats: [420],
    });

    expect(frame.achievedPolygonBeats).toEqual([400]);
  });

  it("delays a same-beat polygon until its route reveal completes", () => {
    const sameBeat = [400];
    const clock = playNliClock(idleNliClock(), membership, sameBeat, 0);
    const revealing = deriveInvestigationFrame(clock, 3199, enabled, {
      motionMode: "full",
      routeBeats: [400],
    });
    const completed = deriveInvestigationFrame(clock, 3200, enabled, {
      motionMode: "full",
      routeBeats: [400],
    });

    expect(revealing.achievedPolygonBeats).toEqual([]);
    expect(completed.achievedPolygonBeats).toEqual([400]);
  });

  it("delays a same-beat polygon when the route layer is hidden", () => {
    const sameBeat = [400];
    const clock = playNliClock(
      idleNliClock(),
      [INVESTIGATION_POLYGONS_FULL_ID],
      sameBeat,
      0,
    );
    const revealing = deriveInvestigationFrame(clock, 3199, [INVESTIGATION_POLYGONS_FULL_ID], {
      routeBeats: [400],
    });
    const completed = deriveInvestigationFrame(clock, 3200, [INVESTIGATION_POLYGONS_FULL_ID], {
      routeBeats: [400],
    });

    expect(revealing.achievedPolygonBeats).toEqual([]);
    expect(completed.achievedPolygonBeats).toEqual([400]);
    expect(revealing.completedRouteFlow.active).toBe(false);
  });

  it("derives a playing beat and advances the shared corrected-time flow", () => {
    const clock = playNliClock(
      idleNliClock(),
      membership,
      beats,
      1000,
    );
    const frame = deriveInvestigationFrame(clock, 1000, enabled, {
      motionMode: "full",
    });
    expect(frame.narrative).toMatchObject({
      phase: "playing",
      mode: "beat",
      activeBeat: 400,
      activeProgress: 0,
      completedBeats: [],
    });
    expect(frame.achievedPolygonBeats).toEqual([400]);
    expect(frame.completedRouteFlow).toMatchObject({
      active: false,
      phase: Math.floor(1000 / 66) % frame.completedRouteFlow.patternSteps,
    });
    expect(frame.motionMode).toBe("full");
    expect(frame.narrativeAdvances).toBe(true);
  });

  it("keeps completed route flow active while an ordinary pause freezes narrative time", () => {
    let clock = playNliClock(idleNliClock(), membership, beats, 0);
    clock = pauseNliClock(clock, TIMELINE_BEAT_MS + 400);
    const frame = deriveInvestigationFrame(clock, 99_000, enabled, {
      motionMode: "full",
    });
    expect(frame.narrative.phase).toBe("paused");
    expect(frame.narrative.completedBeats).toEqual([400]);
    expect(frame.completedRouteFlow.active).toBe(true);
    expect(frame.completedRouteFlow.progress).toBeGreaterThanOrEqual(0);
    expect(frame.completedRouteFlow.progress).toBeLessThan(1);
    expect(frame.narrativeAdvances).toBe(false);
    expect(frame.completedFlowNeedsFrames).toBe(true);
    expect(frame.needsNextFrame).toBe(true);
  });

  it("keeps a paused reveal without routes static when there is no ambient consumer", () => {
    const clock = pauseNliClock(
      playNliClock(idleNliClock(), membership, beats, 0),
      800,
    );
    const frame = deriveInvestigationFrame(
      clock,
      99_000,
      [INVESTIGATION_POLYGONS_FULL_ID],
      { motionMode: "full" },
    );
    expect(frame.narrative.activeProgress).toBe(800 / NLI_VISUAL_TOKENS.revealDurationMs);
    expect(frame.completedRouteFlow.active).toBe(false);
    expect(frame.completedFlowNeedsFrames).toBe(false);
    expect(frame.narrativeAdvances).toBe(false);
    expect(frame.needsNextFrame).toBe(false);
  });

  it("includes every beat and polygon achievement at the final reveal boundary", () => {
    const clock = playNliClock(idleNliClock(), membership, beats, 0);
    const frame = deriveInvestigationFrame(
      clock,
      beats.length * TIMELINE_BEAT_MS,
      enabled,
      { motionMode: "full" },
    );
    expect(frame.narrative.mode).toBe("hold");
    expect(frame.narrative.completedBeats).toEqual(beats);
    expect(frame.achievedPolygonBeats).toEqual(beats);
    expect(frame.completedRouteFlow.active).toBe(true);
  });

  it("preserves every achievement through a paused final hold and ended state", () => {
    const playing = playNliClock(idleNliClock(), membership, beats, 0);
    const paused = pauseNliClock(
      playing,
      beats.length * TIMELINE_BEAT_MS + 500,
    );
    const pausedFrame = deriveInvestigationFrame(paused, 90_000, enabled, {});
    expect(pausedFrame.narrative.mode).toBe("hold");
    expect(pausedFrame.narrative.completedBeats).toEqual(beats);
    expect(pausedFrame.achievedPolygonBeats).toEqual(beats);
    expect(pausedFrame.completedRouteFlow.active).toBe(true);

    const endedFrame = deriveInvestigationFrame(endNliClock(playing), 90_000, enabled, {});
    expect(endedFrame.narrative.completedBeats).toEqual(beats);
    expect(endedFrame.achievedPolygonBeats).toEqual(beats);
    expect(endedFrame.completedRouteFlow.active).toBe(true);
  });

  it("completes a paused jump one-shot without resuming the narrative clock", () => {
    const jumped = seekNliClock(idleNliClock(), 1, 10_000, {
      visibleMembership: membership,
      beats,
    });
    const frame = deriveInvestigationFrame(
      jumped,
      10_000 + NLI_VISUAL_TOKENS.revealDurationMs,
      [INVESTIGATION_LINES_FULL_ID],
      { motionMode: "full" },
    );
    expect(frame.narrative.phase).toBe("paused");
    expect(frame.narrative.activeBeat).toBe(420);
    expect(frame.narrative.activeProgress).toBe(1);
    expect(frame.narrative.completedBeats).toEqual([400, 420]);
    expect(frame.completedRouteFlow.active).toBe(true);
    expect(frame.rippleNeedsFrames).toBe(false);
  });

  it("preserves all completion at end, but reduced motion does not schedule flow frames", () => {
    const ended = endNliClock(
      playNliClock(idleNliClock(), membership, beats, 0),
    );
    const full = deriveInvestigationFrame(ended, 99_000, enabled, {
      motionMode: "full",
    });
    const reduced = deriveInvestigationFrame(ended, 99_000, enabled, {
      motionMode: "reduced",
    });
    expect(full.narrative.completedBeats).toEqual(beats);
    expect(full.narrativeAdvances).toBe(false);
    expect(full.completedRouteFlow.active).toBe(true);
    expect(full.completedFlowNeedsFrames).toBe(true);
    expect(reduced.narrative.completedBeats).toEqual(beats);
    expect(reduced.completedRouteFlow.active).toBe(false);
    expect(reduced.completedFlowNeedsFrames).toBe(false);
    expect(reduced.needsNextFrame).toBe(false);
  });

  it("resets cycle on stop/replay and recalculates completion after backward seek and loop wrap", () => {
    const playing = playNliClock(idleNliClock(), membership, beats, 0);
    const replayed = {
      ...replayNliClock(endNliClock(playing), 20_000),
      revision: 1,
    };
    const fresh = deriveInvestigationFrame(replayed, 20_000, enabled, {});
    expect(fresh.narrative.completedBeats).toEqual([]);

    const backward = { ...seekNliClock(playing, 0, 30_000), revision: 2 };
    const rewound = deriveInvestigationFrame(backward, 30_000, enabled, {});
    expect(rewound.narrative.completedBeats).toEqual([]);

    const looping = setNliLoop(playing, true);
    const wrapped = deriveInvestigationFrame(
      looping,
      3 * TIMELINE_BEAT_MS + 2500,
      enabled,
      {},
    );
    expect(wrapped.narrative.activeBeat).toBe(400);
    expect(wrapped.narrative.completedBeats).toEqual([]);
  });

  it("is idle and does not request frames without narrative or ambient consumers", () => {
    const frame = deriveInvestigationFrame(idleNliClock(), 99_000, enabled, {});
    expect(frame.narrative).toMatchObject({
      phase: "idle",
      mode: "hold",
      activeBeat: null,
      activeProgress: 0,
      completedBeats: [],
    });
    expect(frame.completedRouteFlow.active).toBe(false);
    expect(frame.narrativeAdvances).toBe(false);
    expect(frame.needsNextFrame).toBe(false);
  });

  it("returns to the idle visual state after an explicit stop", () => {
    const playing = playNliClock(idleNliClock(), membership, beats, 0);
    const frame = deriveInvestigationFrame(
      stopNliClock(playing),
      99_000,
      enabled,
      { motionMode: "full" },
    );
    expect(frame.cycleKey).toBe("idle");
    expect(frame.narrative.completedBeats).toEqual([]);
    expect(frame.achievedPolygonBeats).toEqual([]);
    expect(frame.completedRouteFlow.active).toBe(false);
    expect(frame.completedRouteFlow.progress).toBe(0);
    expect(frame.needsNextFrame).toBe(false);
  });

  it("finishes an alarm ripple from corrected wall time at its shared onset", () => {
    const clock = playNliClock(
      idleNliClock(),
      [INVESTIGATION_ALARMS_FULL_ID],
      beats,
      1000,
    );
    const active = deriveInvestigationFrame(clock, 1800, [INVESTIGATION_ALARMS_FULL_ID], {});
    expect(active.alarmOnsetId).toBe("1000:0:0:400");
    expect(active.rippleNeedsFrames).toBe(true);
    const finished = deriveInvestigationFrame(clock, 1000 + 900, [INVESTIGATION_ALARMS_FULL_ID], {});
    expect(finished.rippleNeedsFrames).toBe(false);
  });

  it("keeps a paused alarm ripple origin stable across ordinary clock patches", () => {
    const playing = playNliClock(
      idleNliClock(),
      [INVESTIGATION_ALARMS_FULL_ID],
      beats,
      1000,
    );
    const paused = pauseNliClock(playing, 1400);
    const first = deriveInvestigationFrame(
      paused,
      1500,
      [INVESTIGATION_ALARMS_FULL_ID],
      {},
    );
    const patched = { ...paused, revision: paused.revision + 1 };
    const second = deriveInvestigationFrame(
      patched,
      1900,
      [INVESTIGATION_ALARMS_FULL_ID],
      {},
    );
    expect(first.alarmOnsetOriginMs).toBe(1000);
    expect(second.alarmOnsetOriginMs).toBe(1000);
    expect(second.alarmOnsetId).toBe(first.alarmOnsetId);
    expect(second.rippleNeedsFrames).toBe(false);
  });

  it("does not reactivate a completed alarm ripple after ordinary pause and resume", () => {
    const playing = playNliClock(
      idleNliClock(),
      [INVESTIGATION_ALARMS_FULL_ID],
      beats,
      1000,
    );
    const paused = pauseNliClock(playing, 1400);
    const resumed = resumeNliClock(paused, 5000);
    const pausedAgain = pauseNliClock(resumed, 6000);
    const before = deriveInvestigationFrame(
      paused,
      2000,
      [INVESTIGATION_ALARMS_FULL_ID],
      {},
    );
    const after = deriveInvestigationFrame(
      resumed,
      5000,
      [INVESTIGATION_ALARMS_FULL_ID],
      {},
    );
    expect(after.alarmOnsetOriginMs).toBe(before.alarmOnsetOriginMs);
    expect(after.alarmOnsetId).toBe(before.alarmOnsetId);
    expect(before.rippleNeedsFrames).toBe(false);
    expect(after.rippleNeedsFrames).toBe(false);
    expect(pausedAgain.alarmOnsetOriginMs).toBe(paused.alarmOnsetOriginMs);
    expect(pausedAgain).not.toHaveProperty("alarmOnsetBeat");
  });

  it("gives a later-beat paused jump its selected-beat onset", () => {
    const jumped = seekNliClock(idleNliClock(), 1, 10_000, {
      visibleMembership: [INVESTIGATION_ALARMS_FULL_ID],
      beats,
    });
    const frame = deriveInvestigationFrame(
      jumped,
      10_000 + 100,
      [INVESTIGATION_ALARMS_FULL_ID],
      {},
    );
    expect(frame.alarmOnsetOriginMs).toBe(10_000);
    expect(frame.alarmOnsetId).toBe("10000:0:1:420");
  });

  it("keeps a loop jump's half-reveal onset through pause and resume", () => {
    const jumpAt = 10_000;
    const halfReveal = NLI_VISUAL_TOKENS.revealDurationMs / 2;
    const jumped = seekNliClock(
      setNliLoop(idleNliClock(), true),
      1,
      jumpAt,
      { visibleMembership: [INVESTIGATION_ALARMS_FULL_ID], beats },
    );
    const resumed = resumeNliClock(jumped, jumpAt + halfReveal);
    const before = deriveInvestigationFrame(
      jumped,
      jumpAt + halfReveal,
      [INVESTIGATION_ALARMS_FULL_ID],
      {},
    );
    const after = deriveInvestigationFrame(
      resumed,
      jumpAt + halfReveal,
      [INVESTIGATION_ALARMS_FULL_ID],
      {},
    );
    expect(before.activeProgress).toBe(0.5);
    expect(after.activeProgress).toBe(0);
    expect(resumed.positionMs).toBe(jumped.positionMs);
    expect(after.alarmOnsetId).toBe(before.alarmOnsetId);
    expect(after.alarmOnsetOriginMs).toBe(jumpAt);
    expect(after.rippleNeedsFrames).toBe(false);
  });

  it("changes alarm identity and origin once per loop cycle", () => {
    const looping = setNliLoop(
      playNliClock(idleNliClock(), [INVESTIGATION_ALARMS_FULL_ID], beats, 0),
      true,
    );
    const first = deriveInvestigationFrame(looping, 100, [INVESTIGATION_ALARMS_FULL_ID], {});
    const wrapped = deriveInvestigationFrame(
      looping,
      clockStoryDurationMs(beats) + 100,
      [INVESTIGATION_ALARMS_FULL_ID],
      {},
    );
    expect(wrapped.alarmOnsetId).not.toBe(first.alarmOnsetId);
    expect(wrapped.alarmOnsetOriginMs).toBe(clockStoryDurationMs(beats));
    expect(wrapped.rippleNeedsFrames).toBe(true);
  });

  it("preserves a loop-cycle alarm onset through pause and resume", () => {
    const looping = setNliLoop(
      playNliClock(idleNliClock(), [INVESTIGATION_ALARMS_FULL_ID], beats, 0),
      true,
    );
    const cycleStart = clockStoryDurationMs(beats);
    const paused = pauseNliClock(looping, cycleStart + 100);
    const resumed = resumeNliClock(paused, 50_000);
    const before = deriveInvestigationFrame(
      paused,
      cycleStart + 1000,
      [INVESTIGATION_ALARMS_FULL_ID],
      {},
    );
    const after = deriveInvestigationFrame(
      resumed,
      50_000,
      [INVESTIGATION_ALARMS_FULL_ID],
      {},
    );
    expect(after.alarmOnsetOriginMs).toBe(before.alarmOnsetOriginMs);
    expect(after.alarmOnsetId).toBe(before.alarmOnsetId);
    expect(after.rippleNeedsFrames).toBe(false);
  });

  it("starts a fresh ripple identity after a resumed loop crosses its next wrap", () => {
    const looping = setNliLoop(
      playNliClock(idleNliClock(), [INVESTIGATION_ALARMS_FULL_ID], beats, 0),
      true,
    );
    const duration = clockStoryDurationMs(beats);
    const paused = pauseNliClock(looping, duration + 100);
    const resumed = resumeNliClock(paused, 50_000);
    const afterWrap = pauseNliClock(resumed, 50_000 + duration + 100);
    const frame = deriveInvestigationFrame(
      afterWrap,
      50_000 + duration + 100,
      [INVESTIGATION_ALARMS_FULL_ID],
      {},
    );
    expect(frame.alarmOnsetOriginMs).toBe(50_000 + duration - 100);
    expect(frame.alarmOnsetId).not.toBe(
      deriveInvestigationFrame(paused, duration + 1000, [INVESTIGATION_ALARMS_FULL_ID], {}).alarmOnsetId,
    );
    expect(frame.rippleNeedsFrames).toBe(true);
  });

  it("derives the same completed-flow phase for two clients at one corrected time", () => {
    const clock = pauseNliClock(
      playNliClock(idleNliClock(), membership, beats, 0),
      TIMELINE_BEAT_MS + 10,
    );
    const a = deriveInvestigationFrame(clock, 123_456, enabled, {});
    const b = deriveInvestigationFrame({ ...clock }, 123_456, enabled, {});
    expect(a.completedRouteFlow.phase).toBe(b.completedRouteFlow.phase);
    expect(a.narrative.completedBeats).toEqual(b.narrative.completedBeats);
  });
});
