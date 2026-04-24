/**
 * Flow animation controller for MapLibre GL JS.
 * Animates line-dasharray via requestAnimationFrame for flow/trail effects.
 */

const FLOW_DASH_LENGTH = 4;
const FLOW_GAP_LENGTH = 4;
const FLOW_SPEED = 0.02; // phase units per ms (scaled by per-layer speed)

/** @type {Map<string, { map: import('maplibre-gl').Map, speed: number, dashLength: number, gapLength: number }>} */
const animatedLayers = new Map();

let animationFrameId = null;
let lastTimestamp = 0;
let phase = 0;

function cancelLoop() {
  if (animationFrameId != null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  lastTimestamp = 0;
}

/**
 * @param {number} timestamp
 */
function tick(timestamp) {
  animationFrameId = null;

  if (animatedLayers.size === 0) {
    lastTimestamp = 0;
    return;
  }

  if (!lastTimestamp) lastTimestamp = timestamp;
  const dt = timestamp - lastTimestamp;
  lastTimestamp = timestamp;
  phase += FLOW_SPEED * dt;

  const entries = [...animatedLayers.entries()];
  for (const [layerId, config] of entries) {
    if (!animatedLayers.has(layerId)) continue;

    const map = config.map;
    let layerOk = false;
    try {
      layerOk = typeof map.getLayer === "function" && !!map.getLayer(layerId);
    } catch (_) {
      layerOk = false;
    }
    if (!layerOk) {
      animatedLayers.delete(layerId);
      continue;
    }

    const offset = phase * (config.speed || 1);
    const dashLength = config.dashLength || FLOW_DASH_LENGTH;
    const gapLength = config.gapLength || FLOW_GAP_LENGTH;
    const period = dashLength + gapLength;
    const shift = ((offset % period) + period) % period;
    try {
      map.setPaintProperty(layerId, "line-dasharray", [
        Math.max(0.1, dashLength - shift),
        gapLength,
        shift,
        0,
      ]);
    } catch (_) {
      animatedLayers.delete(layerId);
    }
  }

  if (animatedLayers.size > 0) {
    animationFrameId = requestAnimationFrame(tick);
  } else {
    lastTimestamp = 0;
  }
}

function ensureLoop() {
  if (animationFrameId == null && animatedLayers.size > 0) {
    lastTimestamp = 0;
    animationFrameId = requestAnimationFrame(tick);
  }
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {string} layerId
 * @param {{ speed?: number, dashLength?: number, gapLength?: number }} [options]
 */
export function startFlowAnimation(map, layerId, options = {}) {
  if (!map || typeof layerId !== "string" || !layerId) return;

  animatedLayers.set(layerId, {
    map,
    speed: options.speed ?? 1,
    dashLength: options.dashLength ?? FLOW_DASH_LENGTH,
    gapLength: options.gapLength ?? FLOW_GAP_LENGTH,
  });
  ensureLoop();
}

/**
 * @param {string} layerId
 */
export function stopFlowAnimation(layerId) {
  animatedLayers.delete(layerId);
  if (animatedLayers.size === 0) {
    cancelLoop();
  }
}

export function stopAllFlowAnimations() {
  animatedLayers.clear();
  cancelLoop();
}
