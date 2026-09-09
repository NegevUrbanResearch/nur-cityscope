import { createNarrativeFocusRenderer } from "../shared/maplibre-narrative-focus.js";
import { getNliNarrative, normalizeNarrativeState } from "../shared/nli-narratives.js";

const EXIT_CENTER = Object.freeze([34.5, 31.4]);
const SCENE_STORAGE_KEY = "otef.nliNarrativeSceneRevision";

function readHandledRevision(storage) {
  try {
    const revision = Number(storage?.getItem?.(SCENE_STORAGE_KEY));
    return Number.isInteger(revision) && revision > 0 ? revision : 0;
  } catch (_) {
    return 0;
  }
}

function rememberRevision(storage, revision) {
  try { storage?.setItem?.(SCENE_STORAGE_KEY, String(revision)); } catch (_) { /* kiosk storage can be unavailable */ }
}

function centerFromBounds(bounds) {
  if (!bounds || !Number.isFinite(bounds.west) || !Number.isFinite(bounds.east) ||
    !Number.isFinite(bounds.south) || !Number.isFinite(bounds.north)) return null;
  const center = [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2];
  return Math.abs(center[0]) <= 180 && Math.abs(center[1]) <= 90 ? center : null;
}

/** Coordinate the durable NLI GIS scene without coupling it to presentation commands. */
export function createGisNarrativeController({
  map,
  dataContext,
  viewportSync,
  personVisual,
  presentation,
  closeArchive = () => {},
  storage = typeof sessionStorage !== "undefined" ? sessionStorage : null,
  resolveExitCenter,
  syncTimeline = () => {},
} = {}) {
  const focus = createNarrativeFocusRenderer(map, { profile: "gis" });
  let disposed = false;
  let state = normalizeNarrativeState(null);
  let activeDefinition = null;
  let handledRevision = readHandledRevision(storage);
  let styleGeneration = 0;

  const clearPeopleAndArchive = () => {
    personVisual?.hide?.();
    closeArchive?.();
  };
  const exitCenter = () => {
    const resolved = typeof resolveExitCenter === "function" ? resolveExitCenter() : centerFromBounds(dataContext?.getBounds?.());
    return Array.isArray(resolved) && resolved.length === 2 && resolved.every(Number.isFinite) ? resolved : EXIT_CENTER;
  };
  const activate = (definition) => {
    presentation?.close?.();
    activeDefinition = definition;
    clearPeopleAndArchive();
    focus.show(definition);
    syncTimeline();
    map?.stop?.();
    viewportSync?.beginCameraTravel?.("narrative-segev");
    map?.flyTo?.({ center: definition.center, zoom: definition.zoom, essential: true, duration: 1600 });
  };
  const exit = () => {
    presentation?.close?.();
    activeDefinition = null;
    clearPeopleAndArchive();
    focus.clear();
    syncTimeline();
    map?.stop?.();
    viewportSync?.beginCameraTravel?.("narrative-exit");
    map?.flyTo?.({ center: exitCenter(), zoom: 10, essential: true, duration: 1600 });
  };

  return {
    apply(nextState) {
      if (disposed) return false;
      const normalized = normalizeNarrativeState(nextState);
      const definition = getNliNarrative(normalized.id);
      state = normalized;
      activeDefinition = definition;
      if (normalized.revision === 0) return false;
      if (normalized.revision <= handledRevision) {
        if (definition) {
          clearPeopleAndArchive();
          focus.show(definition);
          syncTimeline();
        }
        return false;
      }
      handledRevision = normalized.revision;
      rememberRevision(storage, handledRevision);
      styleGeneration += 1;
      if (definition) activate(definition);
      else if (normalized.transition === "exit") exit();
      return true;
    },
    onStyleLoad() {
      if (disposed) return;
      const generation = styleGeneration;
      if (activeDefinition && generation === styleGeneration) focus.onStyleLoad();
    },
    isActive: () => !disposed && !!activeDefinition,
    getDefinition: () => activeDefinition,
    dispose() {
      if (disposed) return;
      disposed = true;
      activeDefinition = null;
      focus.dispose();
    },
  };
}
