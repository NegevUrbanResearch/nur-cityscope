import { evaluateClock, idleNliClock } from "../shared/nli-investigation-clock.js";
import { finiteClockMinutes, NLI_PLAYABLE_IDS } from "../shared/nli-investigation-beats.js";
import { NLI_NOVA_STORY } from "../shared/nli-nova-story.js";
import { novaVirtualMembership } from "../shared/nli-nova-virtual-membership.js";
import { getPresenterCopy, presenterCopyKey } from "./nli-presenter-content.js";

function playableMembership(value, narrativeId, clock) {
  const ids = Array.isArray(value) ? value.filter((id) => NLI_PLAYABLE_IDS.includes(id)) : [];
  const virtualClock = narrativeId === "nova" && clock?.phase === "idle" ? { phase: "paused" } : clock;
  return [...new Set(novaVirtualMembership(ids, narrativeId, virtualClock))].sort();
}

function finiteBeats(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((minute) => typeof minute !== "boolean" && Number.isFinite(Number(minute)))
    .map(Number);
}

/** Build a presenter view of the active story window without changing clock indices. */
export function buildPresenterSnapshot({
  host = {}, clock = idleNliClock(), nowMs = 0, narrative = { id: null, revision: 0 },
  sceneKey = null, sceneId = null, cueWindow = { membership: [], from: null, to: null }, locale = "he",
  manifest = null, dataset = {}, connected = false, mutationAllowed = false,
} = {}) {
  const activeClock = clock && typeof clock === "object" ? clock : idleNliClock();
  const arm = host?._nliArmPayload?.() || {};
  const canonical = finiteBeats(activeClock.phase === "idle" ? arm.beats : activeClock.beats);
  const membership = playableMembership(activeClock.phase === "idle"
    ? arm.visibleMembership : activeClock.membership, narrative?.id, activeClock);
  const options = narrative?.id === "nova" ? { narrativeId: "nova" } : {};
  const visual = evaluateClock(activeClock, nowMs, options);
  const phase = activeClock.phase === "ended" || visual.phase === "ended" ? "ended" : activeClock.phase;

  const cueMembership = playableMembership(cueWindow?.membership, narrative?.id, activeClock);
  const matches = activeClock.phase === "idle" || JSON.stringify(cueMembership) === JSON.stringify(membership);
  const playback = host?._playbackWindow?.() || {};
  const from = finiteClockMinutes(playback.from) ?? (matches ? finiteClockMinutes(cueWindow?.from) : null);
  const to = finiteClockMinutes(playback.to) ?? (matches ? finiteClockMinutes(cueWindow?.to) : null);
  const minutes = canonical.filter((minute) => (from == null || minute >= from) && (to == null || minute <= to));

  const descriptors = minutes.map((minute) => {
    const copyKey = presenterCopyKey(narrative?.id, membership, minute);
    return { key: JSON.stringify([dataset?.identity ?? null, copyKey]), copyKey, minute,
      clockIndex: canonical.indexOf(minute), copy: getPresenterCopy(manifest, copyKey, locale) };
  });
  const missingCopy = descriptors.some((beat) => !beat.copy);
  const verified = dataset?.ready === true && !dataset?.error;
  const ready = verified && !missingCopy;
  const beats = ready ? descriptors : [];
  const appliedMinute = phase === "idle" || visual.leadIn ? null
    : phase === "ended" || (visual.mode === "hold" && visual.index < 0)
      ? minutes.at(-1) ?? null : canonical[visual.index] ?? null;
  const appliedKey = beats.find((beat) => beat.minute === appliedMinute)?.key ?? null;
  const sceneBoundaryKey = JSON.stringify([sceneKey, narrative?.id ?? null,
    narrative?.revision ?? null, membership, from, to]);
  const boundaryKey = JSON.stringify([sceneBoundaryKey, dataset?.identity ?? null, dataset?.generation ?? null]);
  const previewMinute = narrative?.id === "nova" && phase === "idle" ? NLI_NOVA_STORY.startMinutes
    : phase === "idle" ? from : visual.leadIn ? visual.clock : null;
  const status = !verified ? "unverified" : missingCopy ? "copy-unavailable" : beats.length ? "ready" : "empty";
  const error = !verified ? dataset?.error || "Presenter dataset is not verified"
    : missingCopy ? "Presenter copy is unavailable for this scene" : null;

  return {
    sceneKey, sceneId, narrativeId: narrative?.id ?? null, narrativeRevision: narrative?.revision ?? null,
    arm, membership, from, to, phase, visual, beats, appliedKey, previewMinute,
    sceneBoundaryKey, boundaryKey, datasetIdentity: dataset?.identity ?? null,
    datasetGeneration: dataset?.generation ?? null,
    ready, status, error,
    canMutate: ready && connected === true && mutationAllowed === true && beats.length > 0,
  };
}

/** Return an adjacent descriptor key, bounded to the current presenter window. */
export function adjacentPresenterKey(snapshot, delta) {
  if (delta !== -1 && delta !== 1) return null;
  const beats = Array.isArray(snapshot?.beats) ? snapshot.beats : [];
  if (beats.length === 0) return null;
  const current = beats.findIndex((beat) => beat.key === snapshot?.appliedKey);
  if (current < 0) return delta > 0 ? beats[0].key : null;
  const next = current + delta;
  return next >= 0 && next < beats.length ? beats[next].key : null;
}
