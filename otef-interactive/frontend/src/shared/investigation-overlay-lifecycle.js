import {
  LAYER_FADE_MS,
  peekLayerLifecycleRuntime,
} from "./layer-lifecycle-fade.js";

const OPACITY_PROPERTIES = new Set([
  "fill-opacity",
  "line-opacity",
  "circle-opacity",
  "circle-stroke-opacity",
  "icon-opacity",
  "text-opacity",
  "raster-opacity",
]);

export function isOverlayOpacityProperty(property) {
  return OPACITY_PROPERTIES.has(property);
}

export function addInvestigationOverlayLayer(map, fullId, layer, beforeId) {
  if (!map || typeof map.addLayer !== "function" || !layer?.id) return;
  const runtime = peekLayerLifecycleRuntime(map);
  const existing = typeof map.getLayer === "function" ? map.getLayer(layer.id) : null;
  if (existing && runtime?.needsOverlayRestage(fullId, layer.id) !== true) return;
  if (existing && typeof map.removeLayer === "function") {
    try {
      map.removeLayer(layer.id);
    } catch (_) {
      // Style can disappear while a renderer is being mounted.
    }
  }
  const def = runtime
    ? runtime.stageMapLayer(fullId, layer, { introFade: true }).stagedLayerDef
    : layer;
  try {
    if (beforeId) map.addLayer(def, beforeId);
    else map.addLayer(def);
  } catch (_) {
    // Style can disappear while a renderer is being mounted.
  }
}

export function completeInvestigationOverlayMount(map, fullId) {
  peekLayerLifecycleRuntime(map)?.markMemberReady(fullId);
}

export function publishInvestigationOverlayOpacity(map, fullId, layerId, property, value) {
  const runtime = peekLayerLifecycleRuntime(map);
  if (runtime?.updateEffectivePaint(fullId, layerId, property, value, { tweenMs: 0 })) return true;
  if (typeof map?.setPaintProperty !== "function") return false;
  try {
    map.setPaintProperty(layerId, property, value);
    return true;
  } catch (_) {
    return false;
  }
}

export function fadeInvestigationOverlayLayer(map, fullId, layerId, onHidden) {
  const runtime = peekLayerLifecycleRuntime(map);
  if (!runtime) {
    if (typeof onHidden === "function") onHidden();
    return false;
  }
  return runtime.fadePaintLayer(fullId, layerId, { durationMs: LAYER_FADE_MS, onHidden });
}

/** Hold renderer content through scene departure; semantic resets remain immediate. */
export function deferInvestigationOverlaySceneExit(map, fullId, onHidden) {
  const runtime = peekLayerLifecycleRuntime(map);
  if (!runtime) return false;
  runtime.onMemberHidden(fullId, onHidden);
  return true;
}
