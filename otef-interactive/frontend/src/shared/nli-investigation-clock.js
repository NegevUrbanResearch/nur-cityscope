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
 * @property {number} beatIndex
 * @property {number} beatElapsedMs
 * @property {number|null} playEpochMs
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

function playEpochMs(nowMs, beatIndex, beatElapsedMs) {
  const index = Number.isFinite(beatIndex) && beatIndex >= 0 ? beatIndex : 0;
  const elapsed = Number(beatElapsedMs);
  const inBeat = Number.isFinite(elapsed) ? elapsed : 0;
  return Number(nowMs) - (index * TIMELINE_BEAT_MS + inBeat);
}

function elapsedMsForClock(clock, nowMs) {
  if (!clock || clock.phase === "idle" || clock.phase === "ended") return 0;
  const epoch = finiteTimestamp(clock.playEpochMs);
  if (clock.phase === "playing" && epoch != null) {
    return Number(nowMs) - epoch;
  }
  const index = Number.isFinite(clock.beatIndex) && clock.beatIndex >= 0 ? clock.beatIndex : 0;
  const elapsed = Number(clock.beatElapsedMs);
  return index * TIMELINE_BEAT_MS + (Number.isFinite(elapsed) ? elapsed : 0);
}

function armedClock(prev, membership, beats, extras) {
  const base = prev && typeof prev === "object" ? prev : idleNliClock();
  return {
    ...base,
    membership: filterPlayableMembership(membership),
    beats: cloneBeats(beats),
    loop: !!base.loop,
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
    beatIndex: -1,
    beatElapsedMs: 0,
    playEpochMs: null,
    seekKind: "none",
    revision: Number.isFinite(Number(src.revision)) ? Number(src.revision) : 0,
    serverNowMs: finiteTimestamp(src.serverNowMs),
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
    beatIndex: 0,
    beatElapsedMs: 0,
    playEpochMs: playEpochMs(nowMs, 0, 0),
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
  const atHoldOrEnd = vis.mode === "hold" || vis.phase === "ended";
  return {
    ...src,
    phase: vis.phase === "ended" ? "ended" : "paused",
    beatIndex: atHoldOrEnd ? -1 : vis.index,
    beatElapsedMs: vis.phase === "ended" ? 0 : vis.beatElapsedMs,
    playEpochMs: null,
    seekKind: "none",
  };
}

/**
 * @param {NliInvestigationClock} clock
 * @param {number} nowMs
 * @returns {NliInvestigationClock}
 */
export function resumeNliClock(clock, nowMs) {
  const src = clock && typeof clock === "object" ? clock : idleNliClock();
  if (src.phase !== "paused") return src;
  const vis = evaluateClock(src, nowMs);
  const elapsed = Number(vis.beatElapsedMs);
  const inBeat = Number.isFinite(elapsed) ? elapsed : 0;
  const n = Array.isArray(src.beats) ? src.beats.length : 0;
  const inHold = vis.mode === "hold" || !(Number.isFinite(vis.index) && vis.index >= 0);
  const index = inHold ? -1 : vis.index;
  return {
    ...src,
    phase: "playing",
    beatIndex: index,
    beatElapsedMs: inBeat,
    playEpochMs: inHold
      ? Number(nowMs) - (n * TIMELINE_BEAT_MS + inBeat)
      : playEpochMs(nowMs, index, inBeat),
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
    beatIndex: 0,
    beatElapsedMs: 0,
    playEpochMs: null,
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
  return {
    ...next,
    phase: "paused",
    beats,
    beatIndex: index,
    beatElapsedMs: 0,
    playEpochMs: finiteTimestamp(nowMs),
    seekKind: "jump",
  };
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
    return {
      ...armed,
      phase: "paused",
      beatIndex: 0,
      beatElapsedMs: 0,
      playEpochMs: finiteTimestamp(nowMs),
      seekKind: "jump",
    };
  }

  const beats = cloneBeats(src.beats);
  const n = beats.length;
  if (n === 0) return idleNliClock(src);

  const vis = src.phase === "playing" ? evaluateClock(src, nowMs) : null;
  const pausedHold =
    src.phase === "paused" && !(Number.isFinite(src.beatIndex) && src.beatIndex >= 0 && src.beatIndex < n);
  const playingHold = !!(vis && vis.mode === "hold" && vis.phase !== "ended");
  const inHold = pausedHold || playingHold;
  const last = n - 1;

  let current;
  if (src.phase === "playing") {
    current = vis.mode === "beat" && vis.index >= 0 ? vis.index : last;
  } else if (src.phase === "ended" || pausedHold) {
    current = last;
  } else {
    current = Number.isFinite(src.beatIndex) ? src.beatIndex : -1;
  }

  const nextIndex = (Number.isFinite(current) && current >= 0 ? current : 0) + deltaN;

  if (nextIndex < 0) return src;

  if (nextIndex >= n) {
    if (src.loop) {
      return {
        ...src,
        phase: "paused",
        beats,
        beatIndex: 0,
        beatElapsedMs: 0,
        playEpochMs: finiteTimestamp(nowMs),
        seekKind: "jump",
      };
    }
    if (inHold) {
      if (src.phase === "paused") return src;
      const holdElapsed = vis && Number.isFinite(vis.beatElapsedMs) ? vis.beatElapsedMs : 0;
      return {
        ...src,
        phase: "paused",
        beats,
        beatIndex: -1,
        beatElapsedMs: holdElapsed,
        playEpochMs: null,
        seekKind: "none",
      };
    }
    if (src.phase === "paused") return src;
    const elapsed = vis && vis.mode === "beat" ? vis.beatElapsedMs : src.beatElapsedMs;
    return {
      ...src,
      phase: "paused",
      beats,
      beatIndex: current,
      beatElapsedMs: Number.isFinite(elapsed) ? elapsed : 0,
      playEpochMs: null,
      seekKind: "none",
    };
  }

  return {
    ...src,
    phase: "paused",
    beats,
    beatIndex: nextIndex,
    beatElapsedMs: 0,
    playEpochMs: finiteTimestamp(nowMs),
    seekKind: "jump",
  };
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

  if (src.phase === "paused") {
    const index = Number.isFinite(src.beatIndex) ? src.beatIndex : -1;
    const stored = Number(src.beatElapsedMs);
    const storedElapsed = Number.isFinite(stored) ? stored : 0;
    const epoch = finiteTimestamp(src.playEpochMs);
    const onBeat = index >= 0 && index < n;
    const beatElapsedMs =
      onBeat && epoch != null
        ? Math.min(TIMELINE_BEAT_MS, Math.max(0, Number(nowMs) - epoch))
        : storedElapsed;
    if (!onBeat) {
      return { phase: "paused", mode: "hold", clock: null, index: -1, beatElapsedMs };
    }
    return {
      phase: "paused",
      mode: "beat",
      clock: beats[index],
      index,
      beatElapsedMs,
    };
  }

  const beatSpan = n * TIMELINE_BEAT_MS;
  const storyMs = clockStoryDurationMs(beats);
  let t = elapsedMsForClock(src, nowMs);
  if (src.loop) {
    const wrap = storyMs || 1;
    t = ((t % wrap) + wrap) % wrap;
  } else if (t >= storyMs) {
    return { phase: "ended", mode: "hold", clock: null, index: -1, beatElapsedMs: 0 };
  }
  if (t >= beatSpan) {
    return { phase: src.phase, mode: "hold", clock: null, index: -1, beatElapsedMs: t - beatSpan };
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
 * @param {NliInvestigationClock|null|undefined} [prev]
 * @returns {NliInvestigationClock}
 */
export function normalizeNliClock(raw, prev) {
  const src = raw && typeof raw === "object" ? raw : {};
  const fallback = idleNliClock(prev);
  const phase = PHASES.includes(src.phase) ? src.phase : fallback.phase;
  const seekKind = SEEK_KINDS.includes(src.seekKind) ? src.seekKind : "none";
  const loop = typeof src.loop === "boolean" ? src.loop : fallback.loop;
  const membership = filterPlayableMembership(src.membership);
  const beats = cloneBeats(src.beats);
  const beatIndexRaw = Number(src.beatIndex);
  let beatIndex = Number.isFinite(beatIndexRaw) ? Math.trunc(beatIndexRaw) : fallback.beatIndex;
  if (phase === "idle") {
    return idleNliClock({
      ...fallback,
      loop,
      revision: Number.isFinite(Number(src.revision)) ? Number(src.revision) : fallback.revision,
      serverNowMs: src.serverNowMs === undefined ? finiteTimestamp(fallback.serverNowMs) : finiteTimestamp(src.serverNowMs),
    });
  }
  if (phase === "ended") {
    return {
      ...fallback,
      phase: "ended",
      membership,
      beats,
      loop,
      beatIndex: -1,
      beatElapsedMs: 0,
      playEpochMs: null,
      seekKind: "none",
      revision: Number.isFinite(Number(src.revision)) ? Number(src.revision) : fallback.revision,
      serverNowMs: src.serverNowMs === undefined ? finiteTimestamp(fallback.serverNowMs) : finiteTimestamp(src.serverNowMs),
    };
  }
  if (beats.length === 0) return idleNliClock({ ...fallback, loop });
  if (phase === "paused" && beatIndex < 0) {
    beatIndex = -1;
  } else {
    if (beatIndex < 0) beatIndex = 0;
    if (beatIndex >= beats.length) beatIndex = beats.length - 1;
  }
  const elapsedRaw = Number(src.beatElapsedMs);
  const beatElapsedMs = Number.isFinite(elapsedRaw) ? Math.max(0, elapsedRaw) : 0;
  const playEpoch =
    phase === "playing" || phase === "paused" ? finiteTimestamp(src.playEpochMs) : null;
  return {
    ...fallback,
    phase,
    membership,
    beats,
    loop,
    beatIndex,
    beatElapsedMs,
    playEpochMs: playEpoch,
    seekKind: phase === "paused" ? seekKind : "none",
    revision: Number.isFinite(Number(src.revision)) ? Number(src.revision) : fallback.revision,
    serverNowMs: src.serverNowMs === undefined ? finiteTimestamp(fallback.serverNowMs) : finiteTimestamp(src.serverNowMs),
  };
}

/**
 * @param {NliInvestigationClock} clock
 * @returns {NliInvestigationClock}
 */
export function endNliClock(clock) {
  const src = clock && typeof clock === "object" ? clock : idleNliClock();
  return {
    ...src,
    phase: "ended",
    beatIndex: -1,
    beatElapsedMs: 0,
    playEpochMs: null,
    seekKind: "none",
  };
}
