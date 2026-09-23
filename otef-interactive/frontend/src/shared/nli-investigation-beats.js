/**
 * Pure NLI investigation beat helpers (no MapLibre).
 * Alarms hitchhike polygon/line beats; alarms-only uses 5-minute bins.
 */

import { NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";

export const INVESTIGATION_POLYGONS_FULL_ID = "nli.investigation_polygons";
export const INVESTIGATION_LINES_FULL_ID = "nli.lines";
export const INVESTIGATION_ALARMS_FULL_ID = "nli.alarms";
export const NLI_PLAYABLE_IDS = Object.freeze([
  INVESTIGATION_POLYGONS_FULL_ID,
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_ALARMS_FULL_ID,
]);
export const TIMELINE_BEAT_MS = NLI_VISUAL_TOKENS.revealDurationMs;
export const TIMELINE_HOLD_MS = 2500;

/** Provisional Segev-clock beat lengths. Through 06:41, then until 11:00, then the rest of the day. */
const OPENING_END_MINUTES = 6 * 60 + 41;
const MIDDAY_START_MINUTES = 11 * 60;
const OPENING_BEAT_MS = 4000;
const MIDDAY_BEAT_MS = 2500;
const LATE_BEAT_MS = 1000;

export function timelineBeatDurationMs(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value)) return LATE_BEAT_MS;
  if (value <= OPENING_END_MINUTES) return OPENING_BEAT_MS;
  if (value < MIDDAY_START_MINUTES) return MIDDAY_BEAT_MS;
  return LATE_BEAT_MS;
}

/** Milliseconds occupied by beats[start, end). */
export function timelineSpanMs(beats, start = 0, end) {
  const list = Array.isArray(beats) ? beats : [];
  const from = Math.max(0, Math.trunc(start));
  const to = end == null ? list.length : Math.max(from, Math.min(list.length, Math.trunc(end)));
  let total = 0;
  for (let index = from; index < to; index += 1) {
    total += timelineBeatDurationMs(list[index]);
  }
  return total;
}

function locateBeat(list, start, count, elapsedMs) {
  let cursor = 0;
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const last = Math.min(list.length, start + count);
  for (let index = start; index < last; index += 1) {
    const duration = timelineBeatDurationMs(list[index]);
    if (elapsed < cursor + duration) {
      return { index, beatElapsedMs: elapsed - cursor };
    }
    cursor += duration;
  }
  return null;
}

function isFiniteAlarmMinute(value) {
  return typeof value !== "boolean" && Number.isFinite(Number(value));
}

export function quantizeAlarmMinutes(minutes) {
  return 5 * Math.floor(Number(minutes) / 5);
}

/** Collect the five-minute alarm bins without importing a renderer. */
export function collectAlarmTimelineBeats(alarmFeatures) {
  const beats = new Set();
  for (const feature of alarmFeatures || []) {
    const values = feature?.properties?.alarm_minutes;
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      if (isFiniteAlarmMinute(value)) beats.add(quantizeAlarmMinutes(value));
    }
  }
  return [...beats].sort((a, b) => a - b);
}

export function formatMinutesAsLocalClock(minutes) {
  if (!Number.isFinite(minutes)) return "";
  const h = Math.floor(minutes / 60);
  const m = Math.abs(minutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function collectTimelineBeats(features) {
  const beats = new Set();
  for (const feature of features || []) {
    const raw = feature?.properties?.timeline_minutes;
    if (typeof raw === "boolean" || !Number.isFinite(Number(raw))) continue;
    beats.add(Number(raw));
  }
  return [...beats].sort((a, b) => a - b);
}

export function collectUnionTimelineBeats(...featureLists) {
  const merged = [];
  for (const list of featureLists) {
    if (Array.isArray(list)) merged.push(...list);
  }
  return collectTimelineBeats(merged);
}

export function collectPlaybackTimelineBeats(
  polygonOn,
  lineOn,
  alarmOn,
  polygonFeatures,
  lineFeatures,
  alarmFeatures,
) {
  if (polygonOn || lineOn) {
    return collectUnionTimelineBeats(
      polygonOn ? polygonFeatures : null,
      lineOn ? lineFeatures : null,
    );
  }
  if (!alarmOn) return [];
  return collectAlarmTimelineBeats(alarmFeatures);
}

export function isNliPlayableFullId(id) {
  return NLI_PLAYABLE_IDS.includes(String(id || ""));
}

export function previousTimelineBeat(beats, clock) {
  if (clock == null || !Array.isArray(beats)) return null;
  const index = beats.indexOf(clock);
  if (index <= 0) return null;
  return beats[index - 1];
}

export function timelinePhaseAt(elapsedMs, beats) {
  const list = Array.isArray(beats) ? beats : [];
  if (list.length === 0) return { mode: "hold", clock: null, index: -1, beatElapsedMs: 0 };
  const playableMs = timelineSpanMs(list);
  const cycle = playableMs + TIMELINE_HOLD_MS;
  const t = ((Number(elapsedMs) % cycle) + cycle) % cycle;
  if (t >= playableMs) {
    return { mode: "hold", clock: null, index: -1, beatElapsedMs: 0 };
  }
  const found = locateBeat(list, 0, list.length, t);
  return {
    mode: "beat",
    clock: list[found.index],
    index: found.index,
    beatElapsedMs: found.beatElapsedMs,
  };
}

export function mapClockStoryPosition(beats, clock, positionMs) {
  const list = Array.isArray(beats) ? beats : [];
  const leadInMinutes = Number(clock?.leadInMinutes);
  const hasLeadIn = Number.isFinite(leadInMinutes);
  const leadInDurationMs = hasLeadIn ? timelineBeatDurationMs(leadInMinutes) : 0;
  const found = hasLeadIn ? list.findIndex((m) => m >= leadInMinutes) : 0;
  const playableStartIndex = found < 0 ? 0 : found;
  const playableCount = hasLeadIn ? Math.max(0, list.length - playableStartIndex) : list.length;
  const playableMs = timelineSpanMs(list, playableStartIndex, playableStartIndex + playableCount);
  const durationMs = list.length === 0
    ? 0
    : leadInDurationMs + playableMs + TIMELINE_HOLD_MS;
  let absolute = Math.max(0, Number(positionMs) || 0);
  const cycleOrdinal = clock?.loop && durationMs
    ? Math.floor(absolute / durationMs)
    : 0;
  const wrappedMs = clock?.loop && durationMs
    ? absolute - cycleOrdinal * durationMs
    : absolute;
  if (list.length === 0) {
    return {
      durationMs: 0, leadInDurationMs, playableStartIndex, playableCount,
      wrappedMs, leadIn: false, mode: "ended", index: -1, clock: null,
      beatElapsedMs: 0, cycleOrdinal,
    };
  }
  if (!clock?.loop && wrappedMs >= durationMs) {
    return {
      durationMs, leadInDurationMs, playableStartIndex, playableCount,
      wrappedMs, leadIn: false, mode: "ended", index: -1, clock: null,
      beatElapsedMs: 0, cycleOrdinal,
    };
  }
  if (hasLeadIn && wrappedMs < leadInDurationMs) {
    return {
      durationMs, leadInDurationMs, playableStartIndex, playableCount,
      wrappedMs, leadIn: true, mode: "leadIn", index: -1, clock: leadInMinutes,
      beatElapsedMs: wrappedMs, cycleOrdinal,
    };
  }
  const tPlay = wrappedMs - leadInDurationMs;
  if (tPlay >= playableMs) {
    return {
      durationMs, leadInDurationMs, playableStartIndex, playableCount,
      wrappedMs, leadIn: false, mode: "hold", index: -1, clock: null,
      beatElapsedMs: tPlay - playableMs, cycleOrdinal,
    };
  }
  const located = locateBeat(list, playableStartIndex, playableCount, tPlay);
  return {
    durationMs, leadInDurationMs, playableStartIndex, playableCount,
    wrappedMs, leadIn: false, mode: "beat", index: located.index, clock: list[located.index],
    beatElapsedMs: located.beatElapsedMs, cycleOrdinal,
  };
}

export function clockStoryDurationMs(beats, clock) {
  return mapClockStoryPosition(beats, clock, 0).durationMs;
}
