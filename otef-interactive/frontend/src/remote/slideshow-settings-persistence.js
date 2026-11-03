/** Save only the newest queued draft, preserving the activation that created it. */
export function createSlideshowSettingsPersistence({ save, captureScope = () => null, isCurrent = () => true, onError = () => {}, onSaved = () => {} }) {
  let pending = null, active = null, running = null, error = null;
  const current = entry => !entry?.scope || isCurrent(entry.scope);
  function start() {
    if (running || error || !pending) return;
    running = Promise.resolve().then(async () => {
      while (pending) {
        const entry = pending;
        active = entry;
        pending = null;
        try {
          if (!current(entry)) throw new Error("The active experience changed");
          await save(entry.settings, entry.scope);
          if (!current(entry)) throw new Error("The active experience changed");
          if (!pending) onSaved(entry.settings);
        } catch (failure) {
          if (current(entry)) pending ||= entry;
          else if (pending && current(pending)) continue;
          else pending = null;
          error = failure;
          if (current(entry)) onError(failure);
          break;
        }
      }
    }).finally(() => { active = null; running = null; });
  }
  async function flush() {
    start();
    while (running) await running;
    if (error) throw error;
  }
  return {
    schedule(settings) {
      pending = { settings: JSON.parse(JSON.stringify(settings)), scope: captureScope() };
      error = null;
      start();
    },
    hasPending: () => (!!active && current(active)) || (!!pending && current(pending)),
    flush,
    retry() { error = null; return flush(); },
  };
}
