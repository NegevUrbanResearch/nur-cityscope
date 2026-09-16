import {
  MAX_ZOOM,
  MIN_ZOOM,
  computeNextZoomFromLiveState,
  normalizeZoomLevel,
} from "./remote-zoom-control-contract.js";

const ZOOM_THROTTLE_MS = 100;

/**
 * Visitor-remote zoom: integer levels, slider +/-, queued commands, pending local intent.
 */
export function createRemoteZoomController({
  slider,
  zoomIn,
  zoomOut,
  zoomValue,
  getViewport,
  zoom,
  isConnected,
  getStateViewport,
  setStateViewport,
} = {}) {
  let zoomThrottleTimer = null;
  let zoomCommandInFlight = false;
  let pendingZoomTarget = null;
  let lastRequestedZoom = null;

  function liveViewport() {
    return typeof getViewport === "function" ? getViewport() : null;
  }

  function updateZoomUI(level) {
    const normalized = normalizeZoomLevel(level);
    if (slider) slider.value = String(normalized);
    if (zoomValue) zoomValue.textContent = String(normalized);
  }

  async function sendZoomCommand(level) {
    if (typeof isConnected === "function" && !isConnected()) return;
    updateZoomUI(level);
    if (typeof zoom !== "function") return;
    try {
      await zoom(level);
    } catch (error) {
      console.error("[Remote] Zoom command failed:", error);
    }
  }

  async function flushZoomQueue() {
    if (zoomCommandInFlight) return;
    zoomCommandInFlight = true;
    try {
      while (pendingZoomTarget !== null) {
        const targetZoom = pendingZoomTarget;
        pendingZoomTarget = null;
        await sendZoomCommand(targetZoom);
      }
    } finally {
      zoomCommandInFlight = false;
      const stateViewport = typeof getStateViewport === "function" ? getStateViewport() : null;
      if (pendingZoomTarget === null && stateViewport) {
        lastRequestedZoom = normalizeZoomLevel(stateViewport.zoom);
      }
    }
  }

  function queueZoomCommand(level) {
    const clampedZoom = normalizeZoomLevel(level);
    if (!Number.isFinite(clampedZoom)) return;

    pendingZoomTarget = clampedZoom;
    lastRequestedZoom = clampedZoom;
    updateZoomUI(clampedZoom);
    const stateViewport = typeof getStateViewport === "function" ? getStateViewport() : null;
    if (stateViewport && typeof setStateViewport === "function") {
      setStateViewport({ ...stateViewport, zoom: clampedZoom });
    }

    if (!zoomCommandInFlight) {
      void flushZoomQueue();
    }
  }

  function stepZoom(delta) {
    if (typeof isConnected === "function" && !isConnected()) return;
    const viewport = liveViewport();
    const stateViewport = typeof getStateViewport === "function" ? getStateViewport() : null;
    queueZoomCommand(
      computeNextZoomFromLiveState({
        sliderValue: slider?.value,
        liveViewportZoom: viewport?.zoom,
        stateZoom: stateViewport?.zoom,
        pendingZoom: lastRequestedZoom,
        delta,
      }),
    );
  }

  function init() {
    if (!zoomIn || !zoomOut || !zoomValue) return;

    if (slider) {
      slider.min = String(MIN_ZOOM);
      slider.max = String(MAX_ZOOM);
      slider.step = "1";
      slider.addEventListener("input", (event) => {
        const next = normalizeZoomLevel(event.target.value);
        updateZoomUI(next);
        clearTimeout(zoomThrottleTimer);
        zoomThrottleTimer = setTimeout(() => {
          queueZoomCommand(next);
        }, ZOOM_THROTTLE_MS);
      });
    }

    zoomIn.addEventListener("click", () => stepZoom(1));
    zoomOut.addEventListener("click", () => stepZoom(-1));
    const viewport = liveViewport();
    if (viewport) syncFromViewport(viewport);
  }

  function syncFromViewport(viewport) {
    if (!viewport) return;
    const normalizedZoom = normalizeZoomLevel(viewport.zoom);
    if (typeof setStateViewport === "function") setStateViewport(viewport);
    updateZoomUI(normalizedZoom);
    if (!zoomCommandInFlight && pendingZoomTarget === null) {
      lastRequestedZoom = normalizedZoom;
    }
  }

  return {
    init,
    syncFromViewport,
    updateZoomUI,
    queueZoomCommand,
  };
}
