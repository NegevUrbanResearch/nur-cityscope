import { getNliNarrative, normalizeNarrativeState } from "../shared/nli-narratives.js";
import { applyNarrativePeopleFilter } from "../map/nli-people-marker-filter.js";

/** Apply durable narrative state on projection without a GIS family marker. */
export function createProjectionNarrativeController({
  map,
  syncTimeline = () => {},
  onStyleLoadOverlay,
} = {}) {
  let definition = null;
  let disposed = false;

  const resync = () => {
    syncTimeline();
  };

  return {
    apply(nextState) {
      if (disposed) return false;
      const normalized = normalizeNarrativeState(nextState);
      definition = getNliNarrative(normalized.id);
      applyNarrativePeopleFilter(map, definition?.id ?? null);
      resync();
      return true;
    },
    onStyleLoad() {
      if (disposed) return;
      applyNarrativePeopleFilter(map, definition?.id ?? null);
      resync();
      onStyleLoadOverlay?.();
    },
    getDefinition: () => definition,
    dispose() {
      if (disposed) return;
      definition = null;
      resync();
      disposed = true;
    },
  };
}
