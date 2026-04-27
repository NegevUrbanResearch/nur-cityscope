const MIN_ZOOM = 10;
const MAX_ZOOM = 19;
const DEFAULT_ZOOM = 15;

function clampZoom(zoom) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

function normalizeZoomLevel(value, fallback = DEFAULT_ZOOM) {
  const z = Number(value);
  if (!Number.isFinite(z)) return fallback;
  return clampZoom(Math.round(z));
}

/**
 * Remote zoom +/- contract:
 * - always works in integer zoom levels for predictable UX
 * - can prefer in-flight local intent (`pendingZoom`) to avoid tap collapse under latency
 * - falls back in order: pending -> live viewport -> slider -> state -> default
 */
export function computeNextZoomFromLiveState({
  sliderValue,
  liveViewportZoom,
  stateZoom,
  pendingZoom,
  delta = 0,
}) {
  const step = Number.isFinite(Number(delta)) ? Math.trunc(Number(delta)) : 0;
  if (step === 0) {
    const pendingZ = Number(pendingZoom);
    if (Number.isFinite(pendingZ)) return normalizeZoomLevel(pendingZ);

    const liveZ = Number(liveViewportZoom);
    if (Number.isFinite(liveZ)) return normalizeZoomLevel(liveZ);

    const sliderZ = Number(sliderValue);
    if (Number.isFinite(sliderZ)) return normalizeZoomLevel(sliderZ);

    return normalizeZoomLevel(stateZoom);
  }

  const pendingZ = Number(pendingZoom);
  if (Number.isFinite(pendingZ)) {
    return clampZoom(normalizeZoomLevel(pendingZ) + step);
  }

  const liveZ = Number(liveViewportZoom);
  if (Number.isFinite(liveZ)) {
    return clampZoom(normalizeZoomLevel(liveZ) + step);
  }

  const sliderZ = Number(sliderValue);
  if (Number.isFinite(sliderZ)) {
    return clampZoom(normalizeZoomLevel(sliderZ) + step);
  }

  const stateZ = Number(stateZoom);
  const base = Number.isFinite(stateZ) ? normalizeZoomLevel(stateZ) : DEFAULT_ZOOM;
  return clampZoom(base + step);
}
