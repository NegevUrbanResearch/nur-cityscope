/**
 * Pure visual-state derivation for the shared NLI investigation narrative.
 *
 * The input is a clock snapshot and one corrected wall-clock timestamp. This
 * module does not read feature data, maps, DOM state, or local RAF elapsed
 * time. Renderers use the resulting beat sets to resolve their own indexes.
 */

import {
  INVESTIGATION_ALARMS_FULL_ID,
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
  TIMELINE_HOLD_MS,
  mapClockStoryPosition,
  timelineBeatDurationMs,
  timelineSpanMs,
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

function uniqueFiniteStoryBeats(value) {
  if (!Array.isArray(value) || value.length === 0) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const number = Number(item);
    if (!Number.isFinite(number) || seen.has(number)) continue;
    seen.add(number);
    out.push(number);
  }
  return out;
}

function isIdleOrEndedVisualPhase(src, phase) {
  return src.phase === "idle" || phase.phase === "ended" || phase.phase === "idle";
}

function positionInfo(clock, nowMs, beats) {
  const absoluteMs = clockPositionMs(clock, nowMs);
  const mapping = mapClockStoryPosition(beats, clock, absoluteMs);
  return {
    absoluteMs,
    durationMs: mapping.durationMs,
    cycleOrdinal: mapping.cycleOrdinal,
    withinCycleMs: mapping.wrappedMs,
    beatIndex: mapping.leadIn ? -1 : mapping.index,
  };
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
  if (phase.leadIn) {
    return beats.filter((m) => m < Number(clock.leadInMinutes));
  }
  if (phase.phase === "ended" || phase.mode === "hold") return beats.slice();
  const index = Number.isInteger(phase.index) ? phase.index : -1;
  const completed = beats.slice(0, Math.max(0, index));
  const progress = activeProgress == null
    ? finiteNumber(phase.beatElapsedMs) / timelineBeatDurationMs(phase.clock)
    : finiteNumber(activeProgress);
  if (index >= 0 && index < beats.length && progress >= 1) completed.push(beats[index]);
  return completed;
}

function activeProgressFor(phase, clock, nowMs) {
  const duration = timelineBeatDurationMs(phase.clock);
  if (clock?.phase === "paused" && clock.seekKind === "jump") {
    const anchor = Number(clock.anchorMs);
    if (Number.isFinite(anchor) && duration > 0) {
      return Math.min(1, Math.max(0, (finiteNumber(nowMs) - anchor) / duration));
    }
  }
  if (phase.mode !== "beat" || duration <= 0) return 0;
  return Math.min(1, Math.max(0, finiteNumber(phase.beatElapsedMs) / duration));
}

function polygonEntriesFor(phase, beats, routeBeats, seekKind = null) {
  if (phase.phase === "idle" || phase.phase === "ended" || phase.leadIn) return [];
  const entries = [];
  const index = phase.mode === "hold"
    ? beats.length
    : Number.isInteger(phase.index) ? phase.index : -1;
  const elapsed = Math.max(0, finiteNumber(phase.beatElapsedMs));
  const entryDuration = phase.mode === "hold"
    ? Math.min(NLI_VISUAL_TOKENS.revealDurationMs, TIMELINE_HOLD_MS)
    : timelineBeatDurationMs(beats[index]);
  const progress = Math.min(1, elapsed / entryDuration);
  const currentBeat = beats[index];
  if (
    phase.mode === "beat" &&
    currentBeat != null &&
    !routeBeats?.has(Number(currentBeat)) &&
    progress < 1
  ) {
    entries.push({ beat: Number(currentBeat), progress });
  }
  const previousBeat = beats[index - 1];
  if (
    seekKind !== "jump" &&
    previousBeat != null &&
    routeBeats?.has(Number(previousBeat)) &&
    progress < 1
  ) {
    entries.push({ beat: Number(previousBeat), progress });
  }
  return entries;
}

function alarmOnsetFor(clock, phase, nowMs, enabled, beats, position) {
  if (!enabled || !Array.isArray(beats) || beats.length === 0) return null;
  if (clock?.phase === "idle" || clock?.phase === "ended") return null;
  const mapping = mapClockStoryPosition(beats, clock, position.absoluteMs);
  if (mapping.leadIn || (mapping.index < 0 && mapping.mode !== "hold")) return null;
  const index = mapping.mode === "beat" ? mapping.index : beats.length - 1;
  if (!Number.isInteger(index) || index < 0 || index >= beats.length) return null;
  const beat = beats[index];
  const explicitOrigin = Number(clock?.alarmOnsetOriginMs);
  const anchor = Number(clock?.anchorMs);
  const playableIndex = index - mapping.playableStartIndex;
  const absoluteBeatStart = mapping.cycleOrdinal * mapping.durationMs
    + mapping.leadInDurationMs
    + timelineSpanMs(beats, mapping.playableStartIndex, mapping.playableStartIndex + playableIndex);
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
 * @param {{ motionMode?: 'full'|'reduced', routeBeats?: number[]|Set<number>, storyBeats?: number[], polygonMotionActive?: boolean, personGlowActive?: boolean }} [options]
 */
export function deriveInvestigationFrame(
  clock,
  correctedNowMs,
  effectiveEnabledIds,
  options = {},
) {
  const src = clock && typeof clock === "object" ? clock : { phase: "idle" };
  const correctedNowValid =
    correctedNowMs != null &&
    Number.isFinite(Number(correctedNowMs)) &&
    Number(correctedNowMs) >= 0;
  const nowMs = finiteNumber(correctedNowMs);
  const motionMode = normalizedMotionMode(options);
  const enabled = normalizedEnabledIds(effectiveEnabledIds);
  const routeBeats = normalizedRouteBeats(options?.routeBeats);
  const beats = Array.isArray(src.beats) ? src.beats.slice() : [];
  const phase = evaluateClock(src, nowMs);
  const polygonEntries = polygonEntriesFor(phase, beats, routeBeats, src.seekKind);
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
  const storyBeats = uniqueFiniteStoryBeats(options?.storyBeats);
  const suppressNovaIdleStory = options?.narrativeId === "nova" && src.phase === "idle";
  let achievedPolygonBeats = [];
  if (polygonEnabled && suppressNovaIdleStory) {
    achievedPolygonBeats = [];
  } else if (polygonEnabled && isIdleOrEndedVisualPhase(src, phase)) {
    if (storyBeats.length > 0) achievedPolygonBeats = storyBeats;
    else if (phase.phase === "ended") achievedPolygonBeats = completedBeats.slice();
  } else if (polygonEnabled) {
    achievedPolygonBeats = completedBeats.slice();
    if (
      !phase.leadIn &&
      phase.mode === "beat" &&
      phase.clock != null &&
      !achievedPolygonBeats.includes(phase.clock) &&
      !routeBeats?.has(Number(phase.clock))
    ) {
      // Polygon impact begins with the beat; line completion still waits for
      // the reveal to reach 100 percent.
      achievedPolygonBeats.push(phase.clock);
    }
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
  const rippleNeedsFrames = alarmEnabled && motionMode === "full";
  const narrativeAdvances =
    (src.phase === "playing" && phase.phase !== "ended") ||
    (src.phase === "paused" && src.seekKind === "jump" && activeProgress < 1);
  const completedFlowNeedsFrames = completedRouteFlow.active;
  const narrativeNeedsFrames = narrativeAdvances && phase.phase !== "ended";
  const completedPolygonAmbientActive =
    options.polygonMotionActive === true &&
    motionMode === "full" &&
    !phase.leadIn &&
    achievedPolygonBeats.some(
      (beat) => !polygonEntries.some((entry) => entry.beat === Number(beat)),
    );
  const polygonMotionNeedsFrames = completedPolygonAmbientActive;
  const personGlowNeedsFrames =
    options.personGlowActive === true && motionMode === "full";
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
    polygonEntries,
    completedPolygonAmbientActive,
    completedRouteFlow,
    alarmOnset,
    alarmOnsetId: alarmOnset?.id ?? null,
    alarmOnsetOriginMs: alarmOnset?.originMs ?? null,
    nowMs,
    correctedNowValid,
    motionMode,
    routeTimelineEnabled: linesEnabled,
    narrativeAdvances,
    completedFlowNeedsFrames,
    rippleNeedsFrames,
    polygonMotionNeedsFrames,
    needsNextFrame:
      narrativeNeedsFrames ||
      completedFlowNeedsFrames ||
      rippleNeedsFrames ||
      polygonMotionNeedsFrames ||
      personGlowNeedsFrames,
    enabledIds: [...enabled],
    narrativeId: options?.narrativeId ?? null,
  };
}
