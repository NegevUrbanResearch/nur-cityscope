/**
 * Flow animation controller for MapLibre GL JS.
 * Animates line-dasharray via requestAnimationFrame for flow/trail effects.
 */

const FLOW_DASH_LENGTH = 4;
const FLOW_GAP_LENGTH = 4;
const FLOW_SPEED = 0.02; // phase units per ms (scaled by per-layer speed)

/** @type {WeakMap<import('maplibre-gl').Map, Map<string, { speed: number, dashLength: number, gapLength: number, baselineDash: any }>>} */
const animatedLayersByMap = new WeakMap();
/** @type {Set<import('maplibre-gl').Map>} */
const animatedMaps = new Set();

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

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }
  if (value && typeof value === "object") {
    return { ...value };
  }
  return value;
}

function getMapRegistry(map, create = false) {
  let registry = animatedLayersByMap.get(map);
  if (!registry && create) {
    registry = new Map();
    animatedLayersByMap.set(map, registry);
    animatedMaps.add(map);
  }
  return registry || null;
}

function hasAnimatedLayers() {
  for (const map of animatedMaps) {
    const registry = animatedLayersByMap.get(map);
    if (!registry || registry.size === 0) {
      animatedMaps.delete(map);
      continue;
    }
    return true;
  }
  return false;
}

function restoreBaselineDash(map, layerId, baselineDash) {
  try {
    if (typeof map.getLayer !== "function" || !map.getLayer(layerId)) return;
    if (baselineDash === undefined) {
      map.setPaintProperty(layerId, "line-dasharray", null);
      return;
    }
    map.setPaintProperty(layerId, "line-dasharray", cloneValue(baselineDash));
  } catch (_) {
    // Ignore best-effort cleanup errors.
  }
}

function removeAnimationForLayer(map, layerId, { restoreDash } = { restoreDash: true }) {
  const registry = getMapRegistry(map, false);
  if (!registry) return false;
  const config = registry.get(layerId);
  if (!config) return false;

  registry.delete(layerId);
  if (restoreDash) {
    restoreBaselineDash(map, layerId, config.baselineDash);
  }
  if (registry.size === 0) {
    animatedMaps.delete(map);
  }
  return true;
}

/**
 * @param {number} timestamp
 */
function tick(timestamp) {
  animationFrameId = null;

  if (!hasAnimatedLayers()) {
    lastTimestamp = 0;
    return;
  }

  if (!lastTimestamp) lastTimestamp = timestamp;
  const dt = timestamp - lastTimestamp;
  lastTimestamp = timestamp;
  phase += FLOW_SPEED * dt;

  const maps = [...animatedMaps];
  for (const map of maps) {
    const registry = getMapRegistry(map, false);
    if (!registry || registry.size === 0) {
      animatedMaps.delete(map);
      continue;
    }

    const entries = [...registry.entries()];
    for (const [layerId, config] of entries) {
      if (!registry.has(layerId)) continue;

      let layerOk = false;
      try {
        layerOk = typeof map.getLayer === "function" && !!map.getLayer(layerId);
      } catch (_) {
        layerOk = false;
      }
      if (!layerOk) {
        removeAnimationForLayer(map, layerId, { restoreDash: false });
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
        removeAnimationForLayer(map, layerId, { restoreDash: false });
      }
    }
  }

  if (hasAnimatedLayers()) {
    animationFrameId = requestAnimationFrame(tick);
  } else {
    lastTimestamp = 0;
  }
}

function ensureLoop() {
  if (animationFrameId == null && hasAnimatedLayers()) {
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

  const registry = getMapRegistry(map, true);
  const existing = registry.get(layerId);

  let baselineDash = existing?.baselineDash;
  if (baselineDash === undefined) {
    try {
      if (typeof map.getPaintProperty === "function") {
        baselineDash = cloneValue(map.getPaintProperty(layerId, "line-dasharray"));
      }
    } catch (_) {
      baselineDash = undefined;
    }
  }

  registry.set(layerId, {
    speed: options.speed ?? existing?.speed ?? 1,
    dashLength: options.dashLength ?? existing?.dashLength ?? FLOW_DASH_LENGTH,
    gapLength: options.gapLength ?? existing?.gapLength ?? FLOW_GAP_LENGTH,
    baselineDash,
  });
  ensureLoop();
}

/**
 * @param {string} layerId
 */
export function stopFlowAnimation(layerId) {
  for (const map of [...animatedMaps]) {
    removeAnimationForLayer(map, layerId, { restoreDash: true });
  }
  if (!hasAnimatedLayers()) {
    cancelLoop();
  }
}

export function stopAllFlowAnimations() {
  for (const map of [...animatedMaps]) {
    const registry = getMapRegistry(map, false);
    if (!registry) continue;
    const layerIds = [...registry.keys()];
    for (const layerId of layerIds) {
      removeAnimationForLayer(map, layerId, { restoreDash: true });
    }
  }
  cancelLoop();
}
