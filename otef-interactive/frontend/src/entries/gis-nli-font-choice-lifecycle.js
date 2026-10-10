/** Ignore stale published font checks after a newer choice or runtime disposal. */
export function createGisNliFontChoiceLifecycle({ ensureReady, applyChoices, onError = () => {} } = {}) {
  let generation = 0;
  let latestKey = null;
  let disposed = false;
  return {
    async publish(choices) {
      if (disposed) return false;
      const selected = { he: choices.he, en: choices.en };
      const key = `${selected.he}\u0000${selected.en}`;
      latestKey = key;
      const token = ++generation;
      try {
        await ensureReady(selected);
      } catch (error) {
        if (!disposed && token === generation && key === latestKey) onError(error);
        return false;
      }
      if (disposed || token !== generation || key !== latestKey) return false;
      applyChoices(selected);
      return true;
    },
    dispose() {
      disposed = true;
      generation += 1;
      latestKey = null;
    },
  };
}
