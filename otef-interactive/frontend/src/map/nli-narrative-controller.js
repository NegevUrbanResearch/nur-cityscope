import { createNarrativeFocusRenderer } from "../shared/maplibre-narrative-focus.js";
import { getNliNarrative, normalizeNarrativeState } from "../shared/nli-narratives.js";
import { applyNarrativePeopleFilter } from "./nli-people-marker-filter.js";

const EXIT_CENTER = Object.freeze([34.5, 31.4]);
// Reviewed Mor route extent, in WGS84. Padding keeps the route head and tail
// visible while leaving the Nova label readable.
const MOR_ROUTE_BOUNDS = Object.freeze([[34.466, 31.350], [34.499, 31.400]]);
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
  onStyleLoadOverlay,
} = {}) {
  const focus = createNarrativeFocusRenderer(map, { profile: "gis" });
  let disposed = false;
  let state = normalizeNarrativeState(null);
  let activeDefinition = null;
  let escapeOverlay = dataContext?.getEscapeOverlay?.() || { mor: false };
  let morCameraActive = false;
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
  const fitMorRoute = () => {
    if (morCameraActive || activeDefinition?.id !== "nova") return;
    morCameraActive = true;
    map?.stop?.();
    viewportSync?.beginCameraTravel?.("narrative-nova-mor-route");
    map?.fitBounds?.(MOR_ROUTE_BOUNDS, { padding: 48, essential: true, duration: 1000 });
  };
  const restoreNovaCamera = () => {
    if (!morCameraActive || activeDefinition?.id !== "nova") return;
    morCameraActive = false;
    map?.stop?.();
    viewportSync?.beginCameraTravel?.("narrative-nova");
    map?.flyTo?.({ center: activeDefinition.center, zoom: activeDefinition.zoom, essential: true, duration: 1000 });
  };
  const syncMorCamera = () => {
    if (activeDefinition?.id !== "nova") {
      morCameraActive = false;
      return;
    }
    if (escapeOverlay?.mor === true) fitMorRoute();
    else restoreNovaCamera();
  };
  const activate = (definition) => {
    presentation?.close?.();
    activeDefinition = definition;
    clearPeopleAndArchive();
    focus.show(definition);
    syncTimeline();
    map?.stop?.();
    viewportSync?.beginCameraTravel?.(`narrative-${definition.id}`);
    map?.flyTo?.({ center: definition.center, zoom: definition.zoom, essential: true, duration: 1600 });
    syncMorCamera();
  };
  const exit = () => {
    presentation?.close?.();
    activeDefinition = null;
    morCameraActive = false;
    clearPeopleAndArchive();
    focus.clear();
    syncTimeline();
    map?.stop?.();
    viewportSync?.beginCameraTravel?.("narrative-exit");
    map?.flyTo?.({ center: exitCenter(), zoom: 10, essential: true, duration: 1600 });
  };

  const unsubscribeOverlay = dataContext?.subscribe?.("escapeOverlay", (nextOverlay) => {
    escapeOverlay = nextOverlay || { mor: false };
    syncMorCamera();
  });

  return {
    apply(nextState) {
      if (disposed) return false;
      const normalized = normalizeNarrativeState(nextState);
      const definition = getNliNarrative(normalized.id);
      state = normalized;
      activeDefinition = definition;
      applyNarrativePeopleFilter(map, activeDefinition?.id ?? null);
      if (normalized.revision === 0) return false;
      if (normalized.revision <= handledRevision) {
        if (definition) {
          clearPeopleAndArchive();
          focus.show(definition);
        } else focus.clear();
        syncMorCamera();
        syncTimeline();
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
      applyNarrativePeopleFilter(map, activeDefinition?.id ?? null);
      onStyleLoadOverlay?.();
    },
    isActive: () => !disposed && !!activeDefinition,
    getDefinition: () => activeDefinition,
    dispose() {
      if (disposed) return;
      disposed = true;
      activeDefinition = null;
      focus.dispose();
      unsubscribeOverlay?.();
    },
  };
}
