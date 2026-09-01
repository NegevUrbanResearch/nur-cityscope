/**
 * Pure NLI investigation clock state machine.
 * Imports only the beats leaf — never MapLibre or the timeline paint module.
 */

import {
  INVESTIGATION_ALARMS_FULL_ID,
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
  NLI_PLAYABLE_IDS,
  TIMELINE_BEAT_MS,
  clockStoryDurationMs,
  collectPlaybackTimelineBeats,
  isNliPlayableFullId,
  previousTimelineBeat,
} from "./nli-investigation-beats.js";

const PHASES = ["idle", "playing", "paused", "ended"];
const SEEK_KINDS = ["none", "jump"];

/**
 * @typedef {object} NliInvestigationClock
 * @property {"idle"|"playing"|"paused"|"ended"} phase
 * @property {string[]} membership
 * @property {number[]} beats
 * @property {boolean} loop
 * @property {number} positionMs Absolute narrative position at anchorMs.
 * @property {number|null} anchorMs Corrected wall time for positionMs.
 * @property {number|undefined} alarmOnsetOriginMs Stable corrected-time alarm origin.
 * @property {"none"|"jump"} seekKind
 * @property {number} revision
 * @property {number|null} serverNowMs
 */

function asGroupsArray(layerGroups) {
  if (Array.isArray(layerGroups)) return layerGroups;
  if (layerGroups && typeof layerGroups === "object") return Object.values(layerGroups);
  return [];
}

function finiteTimestamp(value) {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function cloneStringList(list) {
  return Array.isArray(list) ? list.map((id) => String(id)) : [];
}

function cloneBeats(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((n) => typeof n !== "boolean" && Number.isFinite(Number(n))).map(Number);
}

function filterPlayableMembership(list) {
  const seen = new Set();
  const out = [];
  for (const id of cloneStringList(list)) {
    if (!isNliPlayableFullId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function nonnegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : fallback;
}

function responseMetadata(src) {
  return {
    revision: Number.isFinite(Number(src?.revision)) ? Number(src.revision) : 0,
    serverNowMs: finiteTimestamp(src?.serverNowMs),
  };
}

function withAlarmOrigin(clock, originMs) {
  const origin = finiteTimestamp(originMs);
  if (!clock.membership.includes(INVESTIGATION_ALARMS_FULL_ID) || origin == null) return clock;
  return { ...clock, alarmOnsetOriginMs: origin };
}

export function clockPositionMs(clock, nowMs) {
  const base = nonnegativeNumber(clock?.positionMs);
  const anchor = finiteTimestamp(clock?.anchorMs);
  if (clock?.phase !== "playing" || anchor == null) return base;
  return base + Math.max(0, Number(nowMs) - anchor);
}

function absoluteBeatStart(clock, positionMs) {
  const beats = Array.isArray(clock?.beats) ? clock.beats : [];
  const duration = clockStoryDurationMs(beats);
  if (!duration || beats.length === 0) return null;
  const absolute = nonnegativeNumber(positionMs);
  const cycle = clock.loop ? Math.floor(absolute / duration) : 0;
  const within = clock.loop ? absolute - cycle * duration : absolute;
  const index = Math.min(beats.length - 1, Math.floor(within / TIMELINE_BEAT_MS));
  if (index < 0 || within >= beats.length * TIMELINE_BEAT_MS) return null;
  return cycle * duration + index * TIMELINE_BEAT_MS;
}

function currentAlarmOrigin(clock, nowMs, positionMs) {
  const start = absoluteBeatStart(clock, positionMs);
  if (start == null) return finiteTimestamp(clock?.alarmOnsetOriginMs);
  const anchoredStart = absoluteBeatStart(clock, clock?.positionMs);
  const explicit = finiteTimestamp(clock?.alarmOnsetOriginMs);
  if (explicit != null && anchoredStart === start) return explicit;
  const anchor = finiteTimestamp(clock?.anchorMs);
  if (anchor == null) return finiteTimestamp(clock?.alarmOnsetOriginMs);
  return anchor + start - nonnegativeNumber(clock.positionMs);
}

function armedClock(prev, membership, beats, extras) {
  const base = prev && typeof prev === "object" ? prev : idleNliClock();
  return {
    ...responseMetadata(base),
    phase: "paused",
    membership: filterPlayableMembership(membership),
    beats: cloneBeats(beats),
    loop: !!base.loop,
    positionMs: 0,
    anchorMs: null,
    seekKind: "none",
    ...extras,
  };
}

/**
 * @param {NliInvestigationClock|null|undefined} [prev]
 * @returns {NliInvestigationClock}
 */
export function idleNliClock(prev) {
  const src = prev && typeof prev === "object" ? prev : {};
  return {
    phase: "idle",
    membership: [],
    beats: [],
    loop: !!src.loop,
    positionMs: 0,
    anchorMs: null,
    seekKind: "none",
    ...responseMetadata(src),
  };
}

/**
 * @param {unknown} layerGroups
 * @returns {string[]}
 */
export function nliPlayableIdsFromGroups(layerGroups) {
  const groups = asGroupsArray(layerGroups);
  const group = groups.find((g) => g && g.id === "nli");
  if (!group || !Array.isArray(group.layers)) return [];
  const enabled = new Set();
  for (const layer of group.layers) {
    if (!layer || !layer.enabled) continue;
    if (typeof layer.id === "string") enabled.add(`nli.${layer.id}`);
  }
  return NLI_PLAYABLE_IDS.filter((id) => enabled.has(id));
}

/**
 * @param {string[]} membership
 * @param {{ polygonFeatures?: object[], lineFeatures?: object[], alarmFeatures?: object[] }} [featureBags]
 * @returns {number[]}
 */
export function beatsForMembership(membership, featureBags = {}) {
  const set = new Set(Array.isArray(membership) ? membership : []);
  return collectPlaybackTimelineBeats(
    set.has(INVESTIGATION_POLYGONS_FULL_ID),
    set.has(INVESTIGATION_LINES_FULL_ID),
    set.has(INVESTIGATION_ALARMS_FULL_ID),
    featureBags.polygonFeatures,
    featureBags.lineFeatures,
    featureBags.alarmFeatures,
  );
}

/**
 * @param {NliInvestigationClock|null|undefined} prev
 * @param {string[]} membership
 * @param {number[]} beats
 * @param {number} nowMs
 * @returns {NliInvestigationClock}
 */
export function playNliClock(prev, membership, beats, nowMs) {
  const list = cloneBeats(beats);
  if (list.length === 0) return idleNliClock(prev);
  return armedClock(prev, membership, list, {
    phase: "playing",
    positionMs: 0,
    anchorMs: finiteTimestamp(nowMs),
    seekKind: "none",
  });
}

/**
 * @param {NliInvestigationClock} clock
 * @param {number} nowMs
 * @returns {NliInvestigationClock}
 */
export function replayNliClock(clock, nowMs) {
  const src = clock && typeof clock === "object" ? clock : idleNliClock();
  return playNliClock(src, src.membership, src.beats, nowMs);
}

/**
 * @param {NliInvestigationClock} clock
 * @param {number} nowMs
 * @returns {NliInvestigationClock}
 */
export function pauseNliClock(clock, nowMs) {
  const src = clock && typeof clock === "object" ? clock : idleNliClock();
  if (src.phase !== "playing") return src;
  const vis = evaluateClock(src, nowMs);
  const positionMs = clockPositionMs(src, nowMs);
  if (vis.phase === "ended") return endNliClock(src);
  return withAlarmOrigin({
    ...src,
    phase: "paused",
    positionMs,
    anchorMs: finiteTimestamp(nowMs),
    seekKind: "none",
  }, currentAlarmOrigin(src, nowMs, positionMs));
}

/**
 * @param {NliInvestigationClock} clock
 * @param {number} nowMs
 * @returns {NliInvestigationClock}
 */
export function resumeNliClock(clock, nowMs) {
  const src = clock && typeof clock === "object" ? clock : idleNliClock();
  if (src.phase !== "paused") return src;
  return {
    ...src,
    phase: "playing",
    positionMs: nonnegativeNumber(src.positionMs),
    anchorMs: finiteTimestamp(nowMs),
    seekKind: "none",
  };
}

/**
 * @param {NliInvestigationClock|null|undefined} prev
 * @returns {NliInvestigationClock}
 */
export function stopNliClock(prev) {
  return idleNliClock(prev);
}

function armIfIdle(clock, arm) {
  if (!clock || clock.phase !== "idle") return clock;
  const beats = cloneBeats(arm?.beats);
  if (beats.length === 0) return clock;
  const membership = filterPlayableMembership(arm?.visibleMembership);
  return armedClock(clock, membership, beats, {
    phase: "paused",
    positionMs: 0,
    anchorMs: null,
    seekKind: "none",
  });
}

/**
 * @param {NliInvestigationClock} clock
 * @param {number} beatIndex
 * @param {number} nowMs
 * @param {{ visibleMembership: string[], beats: number[] }} [arm]
 * @returns {NliInvestigationClock}
 */
export function seekNliClock(clock, beatIndex, nowMs, arm) {
  const src = clock && typeof clock === "object" ? clock : idleNliClock();
  let next = src;
  if (src.phase === "idle") {
    next = armIfIdle(src, arm);
    if (next.phase === "idle") return next;
  }
  const beats = cloneBeats(next.beats);
  if (beats.length === 0) return idleNliClock(next);
  const raw = Number(beatIndex);
  const index = Number.isFinite(raw) ? Math.max(0, Math.min(beats.length - 1, Math.trunc(raw))) : 0;
  return withAlarmOrigin({
    ...next,
    phase: "paused",
    beats,
    positionMs: index * TIMELINE_BEAT_MS,
    anchorMs: finiteTimestamp(nowMs),
    seekKind: "jump",
  }, nowMs);
}

/**
 * @param {NliInvestigationClock} clock
 * @param {number} delta
 * @param {number} nowMs
 * @param {{ visibleMembership: string[], beats: number[] }} [arm]
 * @returns {NliInvestigationClock}
 */
export function stepNliClock(clock, delta, nowMs, arm) {
  const src = clock && typeof clock === "object" ? clock : idleNliClock();
  const step = Number(delta);
  const deltaN = Number.isFinite(step) ? Math.trunc(step) : 0;

  if (src.phase === "idle") {
    if (deltaN <= 0) return src;
    const armed = armIfIdle(src, arm);
    if (armed.phase === "idle") return armed;
    return seekNliClock(armed, 0, nowMs);
  }

  const beats = cloneBeats(src.beats);
  const n = beats.length;
  if (n === 0) return idleNliClock(src);
  const positionMs = clockPositionMs(src, nowMs);
  const vis = evaluateClock(src, nowMs);
  const current = vis.mode === "beat" && vis.index >= 0 ? vis.index : n - 1;
  const nextIndex = current + deltaN;
  if (nextIndex < 0) return src;
  if (nextIndex >= n) {
    if (!src.loop) return src.phase === "playing" ? pauseNliClock(src, nowMs) : src;
    const duration = clockStoryDurationMs(beats);
    const nextCycle = Math.floor(positionMs / duration) + 1;
    return withAlarmOrigin({
      ...src,
      phase: "paused",
      beats,
      positionMs: nextCycle * duration,
      anchorMs: finiteTimestamp(nowMs),
      seekKind: "jump",
    }, nowMs);
  }
  const duration = clockStoryDurationMs(beats);
  const cycle = src.loop && duration ? Math.floor(positionMs / duration) : 0;
  return withAlarmOrigin({
    ...src,
    phase: "paused",
    beats,
    positionMs: cycle * duration + nextIndex * TIMELINE_BEAT_MS,
    anchorMs: finiteTimestamp(nowMs),
    seekKind: "jump",
  }, nowMs);
}

/**
 * @param {NliInvestigationClock} clock
 * @param {boolean} loop
 * @returns {NliInvestigationClock}
 */
export function setNliLoop(clock, loop) {
  const src = clock && typeof clock === "object" ? clock : idleNliClock();
  return { ...src, loop: !!loop };
}

/**
 * @param {NliInvestigationClock} clock
 * @param {number} nowMs
 */
export function evaluateClock(clock, nowMs) {
  const src = clock && typeof clock === "object" ? clock : idleNliClock();
  if (src.phase === "idle") {
    return { phase: "idle", mode: "hold", clock: null, index: -1, beatElapsedMs: 0 };
  }
  if (src.phase === "ended") {
    return { phase: "ended", mode: "hold", clock: null, index: -1, beatElapsedMs: 0 };
  }

  const beats = Array.isArray(src.beats) ? src.beats : [];
  const n = beats.length;
  if (n === 0) {
    return { phase: src.phase === "playing" ? "ended" : src.phase, mode: "hold", clock: null, index: -1, beatElapsedMs: 0 };
  }

  const beatSpan = n * TIMELINE_BEAT_MS;
  const storyMs = clockStoryDurationMs(beats);
  let t = clockPositionMs(src, nowMs);
  if (src.loop) {
    const wrap = storyMs || 1;
    t = ((t % wrap) + wrap) % wrap;
  } else if (t >= storyMs) {
    return { phase: "ended", mode: "hold", clock: null, index: -1, beatElapsedMs: 0 };
  }
  if (t >= beatSpan) {
    return {
      phase: src.phase,
      mode: "hold",
      clock: null,
      index: -1,
      beatElapsedMs: t - beatSpan,
    };
  }
  const index = Math.floor(t / TIMELINE_BEAT_MS);
  return {
    phase: src.phase,
    mode: "beat",
    clock: beats[index],
    index,
    beatElapsedMs: t - index * TIMELINE_BEAT_MS,
  };
}

/**
 * @param {number[]} beats
 * @param {number|null} clockMinutes
 * @param {{ isJump?: boolean }} [opts]
 * @returns {number|null}
 */
export function flashPreviousClock(beats, clockMinutes, opts = {}) {
  const isJump = !!(opts && opts.isJump);
  if (!Array.isArray(beats) || clockMinutes == null) return null;
  if (isJump && beats[0] === clockMinutes) return clockMinutes;
  return previousTimelineBeat(beats, clockMinutes);
}

/**
 * @param {unknown} raw
 * @returns {NliInvestigationClock}
 */
export function normalizeNliClock(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const phase = PHASES.includes(src.phase) ? src.phase : "idle";
  const metadata = responseMetadata(src);
  const loop = typeof src.loop === "boolean" ? src.loop : false;
  if (phase === "idle") return idleNliClock({ ...metadata, loop });

  const membership = filterPlayableMembership(src.membership);
  const beats = cloneBeats(src.beats);
  if (beats.length === 0) return idleNliClock({ ...metadata, loop });
  const seekKind = phase === "paused" && SEEK_KINDS.includes(src.seekKind)
    ? src.seekKind
    : "none";
  let positionMs;
  let anchorMs;
  if (Object.prototype.hasOwnProperty.call(src, "positionMs")) {
    positionMs = nonnegativeNumber(src.positionMs);
    anchorMs = phase === "ended" ? null : finiteTimestamp(src.anchorMs) ?? 0;
  } else if (phase === "playing") {
    positionMs = 0;
    anchorMs = finiteTimestamp(src.narrativeEpochMs ?? src.playEpochMs) ?? 0;
  } else if (phase === "ended") {
    const duration = clockStoryDurationMs(beats);
    const cycle = nonnegativeNumber(src.cycleIndex);
    const within = Number.isFinite(Number(src.narrativeElapsedMs))
      ? nonnegativeNumber(src.narrativeElapsedMs)
      : duration;
    positionMs = loop ? cycle * duration + within : within;
    anchorMs = null;
  } else {
    const duration = clockStoryDurationMs(beats);
    const cycle = Math.trunc(nonnegativeNumber(src.cycleIndex));
    const narrativeElapsed = Number(src.narrativeElapsedMs);
    if (Number.isFinite(narrativeElapsed)) {
      positionMs = (loop ? cycle * duration : 0) + Math.max(0, narrativeElapsed);
    } else {
      const index = Math.trunc(Number(src.beatIndex));
      const elapsed = nonnegativeNumber(src.beatElapsedMs);
      positionMs = (index >= 0 ? Math.min(index, beats.length - 1) : beats.length) *
        TIMELINE_BEAT_MS + elapsed;
    }
    const legacyJumpOrigin = seekKind === "jump" ? finiteTimestamp(src.playEpochMs) : null;
    const narrativeEpoch = finiteTimestamp(src.narrativeEpochMs);
    anchorMs = legacyJumpOrigin ?? (narrativeEpoch == null ? 0 : narrativeEpoch + positionMs);
  }

  const normalized = {
    phase,
    membership,
    beats,
    loop,
    positionMs,
    anchorMs,
    seekKind,
    ...metadata,
  };
  const explicitOrigin = finiteTimestamp(
    src.alarmOnsetOriginMs ?? src.alarmOnset?.originMs,
  );
  if (explicitOrigin != null) normalized.alarmOnsetOriginMs = explicitOrigin;
  else if (
    membership.includes(INVESTIGATION_ALARMS_FULL_ID) &&
    seekKind === "jump" &&
    anchorMs != null
  ) normalized.alarmOnsetOriginMs = anchorMs;
  return normalized;
}

/**
 * @param {NliInvestigationClock} clock
 * @returns {NliInvestigationClock}
 */
export function endNliClock(clock) {
  const src = clock && typeof clock === "object" ? clock : idleNliClock();
  const ended = {
    ...src,
    phase: "ended",
    positionMs: clockStoryDurationMs(src.beats),
    anchorMs: null,
    seekKind: "none",
  };
  delete ended.alarmOnsetOriginMs;
  return ended;
}
