const NO_ESCAPE = Object.freeze({ individual: false, overlap: false, mor: false });

/**
 * Serialize staff cues onto the map. A newer cue cancels the remaining work of
 * an older one, so fast step changes settle on the last requested state.
 * The narrative is only re-entered when it changes, because entering resets
 * the clock, person selection, and escape overlay on the server.
 */
export function createCueRunner({
  dataContext,
  commitLayers,
  stopClock,
  playClock,
  onStatus = () => {},
}) {
  let queue = Promise.resolve();
  let token = 0;

  async function applySteps(cue, narrativeId, live) {
    const target = "narrative" in cue ? cue.narrative : narrativeId;
    if ((dataContext?.getNarrativeState?.()?.id ?? null) !== target) {
      await dataContext?.setNarrative?.(target);
    } else if (dataContext?.getPersonSelection?.()?.personId) {
      await dataContext.clearPerson?.();
    }
    if (!live()) return;
    if (cue.clock) await stopClock();
    if (!live()) return;
    if (cue.layers) await commitLayers(cue.layers);
    if (!live()) return;
    if (cue.escape) await dataContext?.setEscapeOverlay?.({ ...NO_ESCAPE, ...cue.escape });
    if (!live() || !cue.clock || cue.clock === "idle") return;
    await playClock(cue.clock, live);
  }

  return {
    apply(cue, narrativeId = null) {
      const mine = ++token;
      const live = () => mine === token;
      if (!cue) {
        onStatus(null);
        return queue;
      }
      onStatus("applying");
      const run = async () => {
        if (!live()) return;
        try {
          await applySteps(cue, narrativeId, live);
          if (live()) onStatus("ready");
        } catch {
          if (live()) onStatus("failed");
        }
      };
      queue = queue.then(run, run);
      return queue;
    },
    cancel() {
      token += 1;
    },
  };
}
