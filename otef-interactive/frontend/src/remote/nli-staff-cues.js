import { isNliPlayableFullId, NLI_PLAYABLE_IDS } from "../shared/nli-investigation-beats.js";
import { endNliClock, idleNliClock } from "../shared/nli-investigation-clock.js";
import { NLI_NOVA_STORY } from "../shared/nli-nova-story.js";

const NO_ESCAPE = Object.freeze({ individual: false, overlap: false, mor: false, settled: false });

export function buildNovaEndedClock() {
  return endNliClock({
    ...idleNliClock(),
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

  async function applyNarrative(target, live) {
    const currentId = dataContext?.getNarrativeState?.()?.id ?? null;
    if (target === null || currentId !== target) {
      assertAcknowledged(await dataContext?.setNarrative?.(target), "Narrative update was not acknowledged");
    } else if (dataContext?.getPersonSelection?.()?.personId) {
      assertAcknowledged(await dataContext.clearPerson?.(), "Person clear was not acknowledged");
    }
    if (!live()) throw cancelled();
  }

  async function applySteps(cue, narrativeId, live) {
    const kind = clockKind(cue.clock);
    const layers = partitionLayers(cue.layers);
    const currentId = dataContext?.getNarrativeState?.()?.id ?? null;
    const target = "narrative" in cue ? cue.narrative : narrativeId;
    const enteringNova = target === "nova" && currentId !== "nova";
    const stagePartial = kind === "play" || (kind === "ended" && enteringNova);
    if (!live()) throw cancelled();

    if (stagePartial) await commitLayers(layers.rest);
    else if (kind === "idle" && Array.isArray(cue.layers)) await commitLayers(layers.all);
    if (!live()) throw cancelled();

    await applyNarrative(target, live);

    if (kind === "play" || kind === "idle") {
      assertAcknowledged(
        await dataContext?.setEscapeOverlay?.({ ...NO_ESCAPE, ...(cue.escape || {}) }),
        "Escape update was not acknowledged",
      );
      if (!live()) throw cancelled();
      await stopClock(live);
      if (!live()) throw cancelled();
    }

    if (kind === "play") {
      const started = await startClock(cue.clock, layers.playable, live);
      if (!live() || started === false) throw cancelled();
      await commitLayers(layers.all);
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
      assertAcknowledged(
        await dataContext?.setEscapeOverlay?.({ ...NO_ESCAPE, ...(cue.escape || {}) }),
        "Escape update was not acknowledged",
      );
      if (!live()) throw cancelled();
    }
  }

  return {
    apply(cue, narrativeId = null) {
      const mine = ++token;
      const live = () => mine === token;
      if (!cue) {
        onStatus(null);
        const run = async () => ({ status: "cancelled" });
        queue = queue.then(run, run);
        return queue;
      }
      onStatus("applying");
      const run = async () => {
        if (!live()) return { status: "cancelled" };
        try {
          await applySteps(cue, narrativeId, live);
          if (!live()) return { status: "cancelled" };
          onStatus("ready");
          return { status: "ready" };
        } catch (error) {
          if (!live() || error?.cancelled) return { status: "cancelled" };
          onStatus("failed");
          return { status: "failed" };
        }
      };
      queue = queue.then(run, run);
      return queue;
    },
    cancel() {
      token += 1;
      onStatus(null);
    },
  };
}
