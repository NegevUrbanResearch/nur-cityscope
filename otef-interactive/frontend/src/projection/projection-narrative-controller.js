import { getNliNarrative, normalizeNarrativeState } from "../shared/nli-narratives.js";
import { applyNovaMarkerFilter } from "../map/nli-nova-marker-filter.js";

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
      applyNovaMarkerFilter(map, definition?.id ?? null);
      resync();
      return true;
    },
    onStyleLoad() {
      if (disposed) return;
      applyNovaMarkerFilter(map, definition?.id ?? null);
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
