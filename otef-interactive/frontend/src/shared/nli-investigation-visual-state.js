/**
 * Pure visual-state derivation for the shared NLI investigation narrative.
 *
 * The input is a clock snapshot and one corrected wall-clock timestamp. This
 * module does not read feature data, maps, DOM state, or local RAF elapsed
 * time. Renderers use the resulting beat sets to resolve their own indexes.
 */

import {
  clockStoryDurationMs,
  INVESTIGATION_ALARMS_FULL_ID,
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
  TIMELINE_BEAT_MS,
} from "./nli-investigation-beats.js";
import { clockPositionMs, evaluateClock } from "./nli-investigation-clock.js";
import { NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";

const MOTION_MODES = new Set(["full", "reduced"]);

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizedMotionMode(options) {
  return MOTION_MODES.has(options?.motionMode) ? options.motionMode : "full";
}

function normalizedEnabledIds(ids) {
  if (ids instanceof Set) return new Set([...ids].map(String));
  return new Set(Array.isArray(ids) ? ids.map(String) : []);
}

function normalizedRouteBeats(value) {
  if (value == null) return null;
  const values = value instanceof Set ? [...value] : Array.isArray(value) ? value : [];
  return new Set(values.map(Number).filter(Number.isFinite));
}

function positionInfo(clock, nowMs, beats) {
  const absoluteMs = clockPositionMs(clock, nowMs);
  const durationMs = clockStoryDurationMs(beats);
  const cycleOrdinal = clock?.loop && durationMs
    ? Math.floor(absoluteMs / durationMs)
    : 0;
  const withinCycleMs = clock?.loop && durationMs
    ? absoluteMs - cycleOrdinal * durationMs
    : absoluteMs;
  const beatIndex = withinCycleMs < beats.length * TIMELINE_BEAT_MS
    ? Math.floor(withinCycleMs / TIMELINE_BEAT_MS)
    : -1;
  return { absoluteMs, durationMs, cycleOrdinal, withinCycleMs, beatIndex };
}

function sameAnchorBeat(clock, current, beats) {
  const anchored = positionInfo(clock, Number(clock?.anchorMs), beats);
  return anchored.cycleOrdinal === current.cycleOrdinal &&
    anchored.beatIndex === current.beatIndex;
}

/** Derive completed narrative beats from an evaluated clock phase. */
export function completedInvestigationBeats(phase, clock, beats, activeProgress) {
  if (!Array.isArray(beats) || beats.length === 0) return [];
  if (phase.phase === "idle") return [];
  if (phase.phase === "ended" || phase.mode === "hold") return beats.slice();
  const index = Number.isInteger(phase.index) ? phase.index : -1;
  const completed = beats.slice(0, Math.max(0, index));
  const progress = activeProgress == null
    ? finiteNumber(phase.beatElapsedMs) / TIMELINE_BEAT_MS
    : finiteNumber(activeProgress);
  if (index >= 0 && index < beats.length && progress >= 1) completed.push(beats[index]);
  return completed;
}

function activeProgressFor(phase, clock, nowMs) {
  if (clock?.phase === "paused" && clock.seekKind === "jump") {
    const anchor = Number(clock.anchorMs);
    if (Number.isFinite(anchor)) {
      return Math.min(
        1,
        Math.max(0, finiteNumber(nowMs) - anchor) /
          NLI_VISUAL_TOKENS.revealDurationMs,
      );
    }
  }
  if (phase.mode !== "beat") return 0;
  return Math.min(
    1,
    Math.max(0, finiteNumber(phase.beatElapsedMs) / NLI_VISUAL_TOKENS.revealDurationMs),
  );
}

function alarmOnsetFor(clock, phase, nowMs, enabled, beats, position) {
  if (!enabled || !Array.isArray(beats) || beats.length === 0) return null;
  if (clock?.phase === "idle" || clock?.phase === "ended") return null;
  const index = phase.mode === "beat" ? phase.index : beats.length - 1;
  if (!Number.isInteger(index) || index < 0 || index >= beats.length) return null;
  const beat = beats[index];
  const explicitOrigin = Number(clock?.alarmOnsetOriginMs);
  const anchor = Number(clock?.anchorMs);
  const absoluteBeatStart = position.cycleOrdinal * position.durationMs +
    index * TIMELINE_BEAT_MS;
  const derivedOrigin = Number.isFinite(anchor)
    ? anchor + absoluteBeatStart - finiteNumber(clock?.positionMs)
    : NaN;
  const origin = Number.isFinite(explicitOrigin) && sameAnchorBeat(clock, position, beats)
    ? explicitOrigin
    : derivedOrigin;
  if (!Number.isFinite(origin)) return null;
  return {
    id: `${origin}:${position.cycleOrdinal}:${index}:${beat}`,
    originMs: origin,
    elapsedMs: Math.max(0, finiteNumber(nowMs) - origin),
  };
}

/**
 * @param {import('./nli-investigation-clock.js').NliInvestigationClock|null|undefined} clock
 * @param {number} correctedNowMs
 * @param {string[]} effectiveEnabledIds
 * @param {{ motionMode?: 'full'|'reduced', routeBeats?: number[]|Set<number> }} [options]
 */
export function deriveInvestigationFrame(
  clock,
  correctedNowMs,
  effectiveEnabledIds,
  options = {},
) {
  const src = clock && typeof clock === "object" ? clock : { phase: "idle" };
  const nowMs = finiteNumber(correctedNowMs);
  const motionMode = normalizedMotionMode(options);
  const enabled = normalizedEnabledIds(effectiveEnabledIds);
  const routeBeats = normalizedRouteBeats(options?.routeBeats);
  const beats = Array.isArray(src.beats) ? src.beats.slice() : [];
  const phase = evaluateClock(src, nowMs);
  const activeProgress = activeProgressFor(phase, src, nowMs);
  const completedBeats = completedInvestigationBeats(
    phase,
    src,
    beats,
    activeProgress,
  );
  const position = positionInfo(src, nowMs, beats);
  const cycleKey = src.phase === "idle" ? "idle" : String(position.cycleOrdinal);
  const polygonEnabled = enabled.has(INVESTIGATION_POLYGONS_FULL_ID);
  const linesEnabled = enabled.has(INVESTIGATION_LINES_FULL_ID);
  const alarmEnabled = enabled.has(INVESTIGATION_ALARMS_FULL_ID);
  const achievedPolygonBeats = polygonEnabled ? completedBeats.slice() : [];
  if (
    polygonEnabled &&
    phase.mode === "beat" &&
    phase.clock != null &&
    !achievedPolygonBeats.includes(phase.clock) &&
    !routeBeats?.has(Number(phase.clock))
  ) {
    // Polygon impact begins with the beat; line completion still waits for
    // the reveal to reach 100 percent.
    achievedPolygonBeats.push(phase.clock);
  }
  const completedRouteActive = linesEnabled && completedBeats.some(
    (beat) => routeBeats == null || routeBeats.has(Number(beat)),
  );
  const flowPatternSteps = NLI_VISUAL_TOKENS.flowPatternSteps;
  const completedFlowPhase =
    ((Math.floor(nowMs / NLI_VISUAL_TOKENS.completedFlowStepMs) % flowPatternSteps) +
      flowPatternSteps) %
    flowPatternSteps;
  const completedRouteFlow = {
    active: completedRouteActive && motionMode === "full",
    phase: completedFlowPhase,
    patternSteps: flowPatternSteps,
    progress: completedRouteActive && motionMode === "full"
      ? ((nowMs * NLI_VISUAL_TOKENS.routeFlowSpeed) % 1 + 1) % 1
      : 0,
  };
  const alarmOnset = alarmOnsetFor(
    src,
    phase,
    nowMs,
    alarmEnabled,
    beats,
    position,
  );
  const rippleNeedsFrames =
    alarmOnset != null && alarmOnset.elapsedMs < NLI_VISUAL_TOKENS.alarmRippleDurationMs;
  const narrativeAdvances =
    (src.phase === "playing" && phase.phase !== "ended") ||
    (src.phase === "paused" && src.seekKind === "jump" && activeProgress < 1);
  const completedFlowNeedsFrames = completedRouteFlow.active;
  const narrativeNeedsFrames = narrativeAdvances && phase.phase !== "ended";
  return {
    cycleKey,
    narrative: {
      phase: phase.phase,
      mode: phase.mode,
      activeBeat: phase.mode === "beat" ? phase.clock : null,
      activeIndex: phase.mode === "beat" ? phase.index : -1,
      activeProgress,
      beatElapsedMs: phase.beatElapsedMs,
      completedBeats,
      advances: narrativeAdvances,
    },
    activeBeat: phase.mode === "beat" ? phase.clock : null,
    activeProgress,
    completedBeats,
    achievedPolygonBeats,
    completedRouteFlow,
    alarmOnset,
    alarmOnsetId: alarmOnset?.id ?? null,
    alarmOnsetOriginMs: alarmOnset?.originMs ?? null,
    motionMode,
    routeTimelineEnabled: linesEnabled,
    narrativeAdvances,
    completedFlowNeedsFrames,
    rippleNeedsFrames,
    needsNextFrame: narrativeNeedsFrames || completedFlowNeedsFrames || rippleNeedsFrames,
    enabledIds: [...enabled],
  };
}
