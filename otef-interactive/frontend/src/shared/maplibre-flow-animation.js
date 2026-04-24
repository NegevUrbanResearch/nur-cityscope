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
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) {
      out[key] = cloneValue(value[key]);
    }
    return out;
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

      const offset = (phase + (config.phaseOffset || 0)) * (config.speed || 1);
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
 * @param {{ speed?: number, dashLength?: number, gapLength?: number, phaseOffset?: number }} [options]
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
    phaseOffset: options.phaseOffset ?? existing?.phaseOffset ?? 0,
    baselineDash,
  });
  ensureLoop();
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {string} layerId
 */
export function stopFlowAnimationOnMap(map, layerId) {
  if (!map || typeof layerId !== "string" || !layerId) return;
  removeAnimationForLayer(map, layerId, { restoreDash: true });
  if (!hasAnimatedLayers()) {
    cancelLoop();
  }
}

/**
 * Stop flow animation for a layer id on one map, or on all maps if only one string arg is passed.
 * @param {import('maplibre-gl').Map|string} mapOrLayerId
 * @param {string} [layerId]
 */
export function stopFlowAnimation(mapOrLayerId, layerId) {
  if (
    mapOrLayerId &&
    typeof layerId === "string" &&
    typeof mapOrLayerId.getLayer === "function"
  ) {
    stopFlowAnimationOnMap(mapOrLayerId, layerId);
    return;
  }
  const id = typeof mapOrLayerId === "string" ? mapOrLayerId : layerId;
  if (typeof id !== "string" || !id) return;
  for (const map of [...animatedMaps]) {
    removeAnimationForLayer(map, id, { restoreDash: true });
  }
  if (!hasAnimatedLayers()) {
    cancelLoop();
  }
}

/**
 * @param {import('maplibre-gl').Map} map
 */
function getStyleLayersSafe(map) {
  try {
    const style = typeof map.getStyle === "function" ? map.getStyle() : null;
    return Array.isArray(style?.layers) ? style.layers : [];
  } catch (_) {
    return [];
  }
}

/**
 * MapLibre line layer ids for a registry fullLayerId (dots→__) and curated prefix (dotted).
 * @param {import('maplibre-gl').Map} map
 * @param {string} fullLayerId e.g. "greens.agri" or "curated.42"
 * @returns {string[]}
 */
export function collectLineLayerIdsForFullLayer(map, fullLayerId) {
  if (!map || typeof fullLayerId !== "string" || !fullLayerId) return [];
  const dottedPrefix = `${fullLayerId}__`;
  const slugPrefix = `${fullLayerId.replace(/\./g, "__")}__`;
  const out = [];
  for (const layer of getStyleLayersSafe(map)) {
    if (!layer || layer.type !== "line") continue;
    const id = layer.id;
    if (typeof id !== "string") continue;
    if (id.startsWith(dottedPrefix) || id.startsWith(slugPrefix)) {
      out.push(id);
    }
  }
  return out;
}

export function hashLayerIdToPhaseOffset(layerId) {
  let h = 0;
  for (let i = 0; i < layerId.length; i += 1) {
    h = Math.imul(31, h) + layerId.charCodeAt(i);
  }
  const u = (Math.abs(h) % 10000) / 10000;
  return u * 8;
}

export function resolveSpeedForFullLayer(fullLayerId) {
  const g = typeof globalThis !== "undefined" ? globalThis : undefined;
  const overrides = g?.MapProjectionConfig?.PROJECTION_LAYER_ANIMATIONS?.LAYER_OVERRIDES;
  const cfg = overrides && typeof overrides === "object" ? overrides[fullLayerId] : null;
  if (cfg && Number.isFinite(cfg.SPEED) && cfg.SPEED > 0) {
    return cfg.SPEED / 10;
  }
  return 1;
}

/**
 * Apply OTEFDataContext `animations` record: start/stop flow on all line layers for each fullLayerId.
 * Safe to call after layer sync so newly added layers pick up enabled animations.
 * @param {import('maplibre-gl').Map} map
 * @param {Record<string, boolean>|null|undefined} animState
 */
export function applyContextFlowAnimationsToMap(map, animState) {
  if (!map) return;
  const state = animState && typeof animState === "object" ? animState : {};

  /** @type {Set<string>} */
  const desiredAnimatedLineIds = new Set();
  for (const fullLayerId of Object.keys(state)) {
    if (!state[fullLayerId]) continue;
    for (const lid of collectLineLayerIdsForFullLayer(map, fullLayerId)) {
      desiredAnimatedLineIds.add(lid);
    }
  }

  const registry = getMapRegistry(map, false);
  if (registry) {
    for (const lid of [...registry.keys()]) {
      if (!desiredAnimatedLineIds.has(lid)) {
        stopFlowAnimationOnMap(map, lid);
      }
    }
  }

  for (const fullLayerId of Object.keys(state)) {
    const lineIds = collectLineLayerIdsForFullLayer(map, fullLayerId);
    const enabled = !!state[fullLayerId];
    for (const lid of lineIds) {
      if (enabled) {
        startFlowAnimation(map, lid, {
          speed: resolveSpeedForFullLayer(fullLayerId),
          phaseOffset: hashLayerIdToPhaseOffset(lid),
        });
      } else {
        stopFlowAnimationOnMap(map, lid);
      }
    }
  }
}

/**
 * Clear all flow animations registered for a single map (restores dash baselines).
 * @param {import('maplibre-gl').Map} [map]
 */
export function stopAllFlowAnimations(map) {
  if (map && typeof map.getLayer === "function") {
    const registry = getMapRegistry(map, false);
    if (registry) {
      const layerIds = [...registry.keys()];
      for (const layerId of layerIds) {
        removeAnimationForLayer(map, layerId, { restoreDash: true });
      }
    }
    if (!hasAnimatedLayers()) {
      cancelLoop();
    }
    return;
  }

  for (const m of [...animatedMaps]) {
    const registry = getMapRegistry(m, false);
    if (!registry) continue;
    const layerIds = [...registry.keys()];
    for (const layerId of layerIds) {
      removeAnimationForLayer(m, layerId, { restoreDash: true });
    }
  }
  cancelLoop();
}
