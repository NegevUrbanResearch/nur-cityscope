import {
  evaluateClock,
  pauseNliClock,
  playNliClock,
  replayNliClock,
  resumeNliClock,
  seekNliClock,
} from "../shared/nli-investigation-clock.js";
import { adjacentPresenterKey } from "./nli-presenter-snapshot.js";

const failedStale = () => ({ ok: false, stale: true });

/** Build the explicit staff commands for the currently visible presenter snapshot. */
export function createPresenterCommands({ host, context, getSnapshot, onPending = () => {}, onError = () => {} } = {}) {
  let generation = 0;
  let pending = false;
  let disposed = false;

  const run = async (kind, key) => {
    if (disposed || pending) return failedStale();
    const before = getSnapshot();
    if (!before?.canMutate || !host?._manualMutationsOpen?.()) return failedStale();
    pending = true;
    onPending(true);
    const commandGeneration = generation;
    const epoch = host._nliTransportEpoch;
    const isCurrent = () => !disposed && generation === commandGeneration
      && host._nliTransportEpoch === epoch
      && getSnapshot()?.boundaryKey === before.boundaryKey
      && getSnapshot()?.canMutate === true && host._manualMutationsOpen();
    try {
      if (!isCurrent()) return failedStale();
      const beforeArm = before.arm;
      if (!beforeArm?.visibleMembership || !Array.isArray(beforeArm.beats)) return failedStale();
      const ids = beforeArm.visibleMembership;
      if (!host._nliCacheReady(ids)) {
        await host._ensureNliFeatureCache(ids, { timeoutMs: 4000, isCurrent });
      }
      if (!isCurrent() || !host._nliCacheReady(ids)) return failedStale();
      const fresh = getSnapshot();
      const clock = context.getInvestigationClock();
      const arm = fresh.arm;
      if (!arm?.visibleMembership || !Array.isArray(arm.beats)) return failedStale();
      let next;
      if (kind === "select") {
        const beat = fresh.beats.find((item) => item.key === key);
        if (!beat) return failedStale();
        const canonical = clock.phase === "idle" ? arm.beats : clock.beats;
        const index = canonical.indexOf(beat.minute);
        if (index < 0) return failedStale();
        const options = fresh.narrativeId === "nova" ? { narrativeId: "nova" } : {};
        next = seekNliClock(clock, index, context.correctedNow(), arm, options);
      } else {
        const now = context.correctedNow();
        const options = fresh.narrativeId === "nova" ? { narrativeId: "nova" }
          : { ...(fresh.from == null ? {} : { leadInMinutes: fresh.from }) };
        const visual = evaluateClock(clock, now, options);
        next = clock.phase === "ended" || visual.phase === "ended"
          ? replayNliClock(clock, now, options)
          : clock.phase === "playing" ? pauseNliClock(clock, now, options)
            : clock.phase === "paused" ? resumeNliClock(clock, now)
              : playNliClock(clock, arm.visibleMembership, arm.beats, now, options);
      }
      if (!isCurrent()) return failedStale();
      const result = await host._patchNliClock(next, { isCurrent });
      if (result?.stale || !isCurrent()) return failedStale();
      if (!result?.ok) {
        const rejected = result ?? { ok: false, error: "Presenter command was rejected" };
        onError(rejected);
        return rejected;
      }
      return result;
    } catch (error) {
      if (!isCurrent()) return failedStale();
      const result = { ok: false, error };
      onError(result);
      return result;
    } finally {
      pending = false;
      if (!disposed) onPending(false);
    }
  };

  return {
    select(key) { return run("select", key); },
    step(delta) {
      if (pending || disposed) return Promise.resolve(failedStale());
      const key = adjacentPresenterKey(getSnapshot(), delta);
      return key == null ? Promise.resolve(failedStale()) : run("select", key);
    },
    toggle() { return run("toggle"); },
    isPending: () => pending,
    invalidate() { generation += 1; },
    dispose() { disposed = true; generation += 1; },
  };
}
