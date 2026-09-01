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
  const cycle = list.length * TIMELINE_BEAT_MS + TIMELINE_HOLD_MS;
  const t = ((Number(elapsedMs) % cycle) + cycle) % cycle;
  if (t >= list.length * TIMELINE_BEAT_MS) {
    return { mode: "hold", clock: null, index: -1, beatElapsedMs: 0 };
  }
  const index = Math.floor(t / TIMELINE_BEAT_MS);
  return {
    mode: "beat",
    clock: list[index],
    index,
    beatElapsedMs: t - index * TIMELINE_BEAT_MS,
  };
}

export function clockStoryDurationMs(beats) {
  const n = Array.isArray(beats) ? beats.length : 0;
  if (n === 0) return 0;
  return n * TIMELINE_BEAT_MS + TIMELINE_HOLD_MS;
}
