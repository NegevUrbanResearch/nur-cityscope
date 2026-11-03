/**
 * Helpers for MapLibre pack line layers tied to OTEF layer animation state.
 *
 * Oct 7 ציר “trail” animation uses `maplibre-route-progress-overlay.js` (GeoJSON + lineMetrics +
 * line-gradient). The legacy RAF `line-dasharray` / `line-dashoffset` driver was removed because
 * only those routes are animated in production.
 */

/** Oct 7 axis layers sometimes differ only by `-ציר` vs `_ציר` in the full id; map layers use manifest id. */
const OCT7_AXIS_HYPHEN_SUFFIX_RE = /^(october_7th\..+)-ציר$/;
const OCT7_AXIS_UNDERSCORE_SUFFIX_RE = /^(october_7th\..+)_ציר$/;

/**
 * @param {string} fullLayerId
 * @returns {string[]}
 */
export function fullLayerIdAnimationAliases(fullLayerId) {
  if (typeof fullLayerId !== "string" || fullLayerId.trim() === "") {
    return [];
  }
  const id = fullLayerId.trim();
  const out = new Set([id]);
  const mHyphen = id.match(OCT7_AXIS_HYPHEN_SUFFIX_RE);
  if (mHyphen) {
    out.add(`${mHyphen[1]}_ציר`);
  }
  const mUnder = id.match(OCT7_AXIS_UNDERSCORE_SUFFIX_RE);
  if (mUnder) {
    out.add(`${mUnder[1]}-ציר`);
  }
  return [...out];
}

function getProjectionLayerAnimationOverrides() {
  const g = typeof globalThis !== "undefined" ? globalThis : undefined;
  const root = g?.MapProjectionConfig?.PROJECTION_LAYER_ANIMATIONS;
  const overrides = root && typeof root === "object" ? root.LAYER_OVERRIDES : null;
  return overrides && typeof overrides === "object" ? overrides : null;
}

function firstOverrideEntryForFullLayer(fullLayerId) {
  const overrides = getProjectionLayerAnimationOverrides();
  if (!overrides) return null;
  for (const cand of fullLayerIdAnimationAliases(fullLayerId)) {
    const cfg = overrides[cand];
    if (cfg && typeof cfg === "object") return cfg;
  }
  return null;
}

/**
 * Layers that use GeoJSON `lineMetrics` + `line-gradient` overlays (not PMTiles paint).
 *
 * @param {string} fullLayerId
 * @returns {boolean}
 */
export function usesRouteProgressOverlay(fullLayerId) {
  const cfg = firstOverrideEntryForFullLayer(fullLayerId);
  if (!cfg || cfg.ENABLE_FLOW === false) return false;
  return String(cfg.MODE || "").toLowerCase() === "trail";
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
 * Line layers considered for pack line id collection (structural filter).
 *
 * @param {{ type?: string, id?: string }} layer
 * @returns {boolean}
 */
export function isFlowAnimationTargetLineLayer(layer) {
  if (!layer || layer.type !== "line" || typeof layer.id !== "string") return false;
  const id = layer.id;
  if (id.includes("__leader")) return false;
  if (id.includes("markerLineFallback")) return false;
  return true;
}

/**
 * MapLibre line layer ids for a registry fullLayerId (dots→__) and curated prefix (dotted).
 * @param {import('maplibre-gl').Map} map
 * @param {string} fullLayerId e.g. "greens.agri" or "curated.42"
 * @returns {string[]}
 */
export function collectLineLayerIdsForFullLayer(map, fullLayerId) {
  if (!map || typeof fullLayerId !== "string" || !fullLayerId) return [];
  const seen = new Set();
  const out = [];
  for (const cand of fullLayerIdAnimationAliases(fullLayerId)) {
    const dottedPrefix = `${cand}__`;
    const slugPrefix = `${cand.replace(/\./g, "__")}__`;
    for (const layer of getStyleLayersSafe(map)) {
      if (!layer || layer.type !== "line") continue;
      const id = layer.id;
      if (typeof id !== "string") continue;
      if (!isFlowAnimationTargetLineLayer(layer)) continue;
      if (id.startsWith(dottedPrefix) || id.startsWith(slugPrefix)) {
        if (!seen.has(id)) {
          seen.add(id);
          out.push(id);
        }
      }
    }
  }
  return out;
}
