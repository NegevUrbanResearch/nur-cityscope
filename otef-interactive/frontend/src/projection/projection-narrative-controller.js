import { createNarrativeFocusRenderer } from "../shared/maplibre-narrative-focus.js";
import { getNliNarrative, normalizeNarrativeState } from "../shared/nli-narratives.js";

/** Render the durable narrative focus on projection without owning its camera. */
export function createProjectionNarrativeController({ map, syncTimeline = () => {} } = {}) {
  const focus = createNarrativeFocusRenderer(map, { profile: "projection" });
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
      if (definition) focus.show(definition);
      else focus.clear();
      resync();
      return true;
    },
    onStyleLoad() {
      if (disposed) return;
      focus.onStyleLoad();
      resync();
    },
    getDefinition: () => definition,
    dispose() {
      if (disposed) return;
      definition = null;
      resync();
      disposed = true;
      focus.dispose();
    },
  };
}
