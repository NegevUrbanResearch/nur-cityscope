import { isNliPlayableFullId, NLI_PLAYABLE_IDS } from "../shared/nli-investigation-beats.js";
import { endNliClock, idleNliClock } from "../shared/nli-investigation-clock.js";
import { NLI_NOVA_STORY } from "../shared/nli-nova-story.js";

const NO_ESCAPE = Object.freeze({ individual: false, overlap: false, mor: false, settled: false });
// Release a presentation hold even if the staff tab closes or its cleanup write fails.
const PRESENTATION_HOLD_LIMIT_MS = 15000;

export function buildNovaEndedClock(previous) {
  return endNliClock({
    ...idleNliClock(previous),
    membership: [...NLI_PLAYABLE_IDS],
    beats: [...NLI_NOVA_STORY.representativeMinutes],
    loop: false,
  }, { narrativeId: "nova" });
}

export async function commitSceneLayers(dataContext, ids) {
  if (typeof dataContext?.setEnabledLayerIds !== "function") {
    throw new Error("Layer context unavailable");
  }
  const result = await dataContext.setEnabledLayerIds([...new Set(ids)]);
  if (!result?.ok || result.stale) {
    throw result?.error || new Error("Layer update was not acknowledged");
  }
}

function partitionLayers(ids) {
  const all = [...new Set(Array.isArray(ids) ? ids : [])];
  return {
    all,
    playable: all.filter((id) => isNliPlayableFullId(id)),
    rest: all.filter((id) => !isNliPlayableFullId(id)),
  };
}

function clockKind(clock) {
  if (clock && typeof clock === "object") return "play";
  if (clock === "ended") return "ended";
  if (clock === "idle") return "idle";
  return null;
}

function cancelled() {
  const error = new Error("cancelled");
  error.cancelled = true;
  return error;
}

function assertAcknowledged(result, message) {
  if (result && (result.ok === false || result.stale === true)) {
    throw result.error || new Error(message);
  }
}

/**
 * Serialize staff cues onto the map. A newer cue cancels the remaining work of
 * an older one, so fast step changes settle on the last requested state.
 */
export function createCueRunner({
  dataContext,
  commitLayers,
  stopClock,
  startClock,
  endClock,
  onStatus = () => {},
}) {
  let queue = Promise.resolve();
  let token = 0;
  let presentationDeadline = null;

  async function beginPresentation(cue, live) {
    const clock = dataContext?.getInvestigationClock?.();
    if (!clock || typeof dataContext?.patchInvestigationClock !== "function") return;
    const now = dataContext?.correctedNow?.() ?? Date.now();
    presentationDeadline = now + PRESENTATION_HOLD_LIMIT_MS;
    const previous = clock.hiddenDisplays ?? [];
    const hiddenDisplays = ["gis", "projection"].filter((display) =>
      previous.includes(display) || cue.hiddenDisplays?.includes(display));
    // The state action checks before sending and after acknowledgement. Skip a
    // cancelled queued write, but adopt an already-sent hold so cleanup can
    // release it if cancellation happens while its acknowledgement is in flight.
    let sent = false;
    const canSendOrAdopt = () => sent || (sent = live());
    assertAcknowledged(await dataContext.patchInvestigationClock({
      ...clock, hiddenDisplays, presentationPendingUntilMs: presentationDeadline,
    }, { isCurrent: canSendOrAdopt }), "Clock presentation update was not acknowledged");
    if (!live()) throw cancelled();
  }

  async function releasePresentation() {
    const clock = dataContext?.getInvestigationClock?.();
    if (presentationDeadline == null || clock?.presentationPendingUntilMs !== presentationDeadline) return;
    const next = { ...clock };
    delete next.presentationPendingUntilMs;
    assertAcknowledged(await dataContext.patchInvestigationClock(next), "Clock presentation release was not acknowledged");
    presentationDeadline = null;
  }

  function queueRelease() {
    const mine = token;
    const release = async () => {
      if (mine === token) {
        try { await releasePresentation(); } catch { /* The deadline still bounds failed cleanup. */ }
      }
      return { status: "cancelled" };
    };
    queue = queue.then(release, release);
    return queue;
  }

  async function applyClockVisibility(hiddenDisplays, live) {
    const clock = dataContext?.getInvestigationClock?.();
    if (!clock || JSON.stringify(clock.hiddenDisplays ?? []) === JSON.stringify(hiddenDisplays)) return;
    assertAcknowledged(
      await dataContext.patchInvestigationClock({ ...clock, hiddenDisplays }, { isCurrent: live }),
      "Clock visibility update was not acknowledged",
    );
    if (!live()) throw cancelled();
  }

  async function applyNarrative(target, live, { force = false } = {}) {
    const currentId = dataContext?.getNarrativeState?.()?.id ?? null;
    if (force || currentId !== target) {
      const hiddenDisplays = dataContext?.getInvestigationClock?.()?.hiddenDisplays;
      assertAcknowledged(
        await dataContext?.setNarrative?.(target, Array.isArray(hiddenDisplays) ? { hiddenDisplays } : undefined),
        "Narrative update was not acknowledged",
      );
    } else if (dataContext?.getPersonSelection?.()?.personId) {
      assertAcknowledged(await dataContext.clearPerson?.(), "Person clear was not acknowledged");
    }
    if (!live()) throw cancelled();
  }

  async function applyEscape(cue, live) {
    assertAcknowledged(
      await dataContext?.setEscapeOverlay?.({ ...NO_ESCAPE, ...(cue.escape || {}) }),
      "Escape update was not acknowledged",
    );
    if (!live()) throw cancelled();
  }

  async function applySteps(cue, narrativeId, live) {
    const kind = clockKind(cue.clock);
    const layers = partitionLayers(cue.layers);
    const currentId = dataContext?.getNarrativeState?.()?.id ?? null;
    const target = "narrative" in cue ? cue.narrative : narrativeId;
    const enteringNova = target === "nova" && currentId !== "nova";
    const stagePartial = kind === "ended" && enteringNova;
    const playWhileHoldingNarrative = kind === "play" && target == null && currentId != null;
    if (!live()) throw cancelled();

    if (stagePartial) await commitLayers(layers.rest);
    else if (kind === "idle" && Array.isArray(cue.layers)) await commitLayers(layers.all);
    if (!live()) throw cancelled();

    if (kind === "play") {
      if (playWhileHoldingNarrative) {
        await applyEscape(cue, live);
        const started = await startClock(cue.clock, layers.playable, live);
        if (!live() || started === false) throw cancelled();
        await applyNarrative(target, live);
      } else {
        await applyNarrative(target, live);
        await applyEscape(cue, live);
        const started = await startClock(cue.clock, layers.playable, live);
        if (!live() || started === false) throw cancelled();
      }
      await commitLayers(layers.all);
      if (!live()) throw cancelled();
      return;
    }

    await applyNarrative(target, live, { force: kind === "idle" && target == null });

    if (kind === "idle") {
      await applyEscape(cue, live);
      await stopClock(live);
      if (!live()) throw cancelled();
      return;
    }

    if (kind === "ended") {
      await endClock(live);
      if (!live()) throw cancelled();
      if (Array.isArray(cue.layers)) {
        await commitLayers(layers.all);
        if (!live()) throw cancelled();
      }
      await applyEscape(cue, live);
    }
  }

  return {
    apply(cue, narrativeId = null) {
      const mine = ++token;
      const live = () => mine === token;
      if (!cue) {
        onStatus(null);
        return queueRelease();
      }
      onStatus("applying");
      const run = async () => {
        if (!live()) return { status: "cancelled" };
        let status = "ready";
        try {
          // Publish intentional hiding and a caption hold before any scene mutation.
          // Restore visibility and release the old caption only once the cue is ready.
          await beginPresentation(cue, live);
          await applySteps(cue, narrativeId, live);
          if (!live()) return { status: "cancelled" };
          await applyClockVisibility(cue.hiddenDisplays ?? [], live);
        } catch (error) {
          if (!live() || error?.cancelled) return { status: "cancelled" };
          status = "failed";
        } finally {
          // A superseding cue inherits the hold through the serialized queue.
          // Explicit cancellation queues its own release after in-flight work.
          if (live()) {
            try { await releasePresentation(); } catch { status = "failed"; }
          }
        }
        if (!live()) return { status: "cancelled" };
        onStatus(status);
        return { status };
      };
      queue = queue.then(run, run);
      return queue;
    },
    cancel() {
      token += 1;
      onStatus(null);
      queueRelease();
    },
  };
}
