import { TIMELINE_HOLD_MS, timelineBeatDurationMs } from "../shared/nli-investigation-beats.js";
import { NLI_NOVA_STORY } from "../shared/nli-nova-story.js";

/** Playback time for the visible scene, including its preview and final hold. */
export function presenterTiming({ canonical, minutes, from, narrativeId, phase, visual }) {
  if (!minutes.length) return null;
  const isNova = narrativeId === "nova";
  const duration = isNova ? () => NLI_NOVA_STORY.beatDurationMs : timelineBeatDurationMs;
  const previewMs = !isNova && from != null && from <= minutes[0] ? duration(from) : 0;
  const beatsMs = minutes.reduce((total, minute) => total + duration(minute), 0);
  const durationMs = previewMs + beatsMs + (isNova ? 0 : TIMELINE_HOLD_MS);
  let elapsedMs = 0;
  if (phase === "ended") elapsedMs = durationMs;
  else if (phase !== "idle") {
    if (visual.leadIn) elapsedMs = Math.min(previewMs, visual.beatElapsedMs);
    else if (visual.mode === "hold") elapsedMs = previewMs + beatsMs + visual.beatElapsedMs;
    else {
      const minute = canonical[visual.index];
      if (minute >= minutes[0]) {
        elapsedMs = previewMs + minutes.filter((value) => value < minute)
          .reduce((total, value) => total + duration(value), 0) + visual.beatElapsedMs;
      }
    }
  }
  return { durationMs, remainingMs: Math.max(0, Math.min(durationMs, durationMs - elapsedMs)) };
}
