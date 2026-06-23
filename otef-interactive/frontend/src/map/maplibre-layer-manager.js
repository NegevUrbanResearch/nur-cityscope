/**
 * Manages adding/removing MapLibre sources and style layers
 * based on layer group state from data context.
 *
 * LayerRegistry is a singleton default export initialized elsewhere.
 */
import { createHatchImageDataFromSpec } from "../shared/hatch-pattern-tile.js";
import { createMarkerLineSquareImageData } from "../shared/markerline-square-image.js";
import { irToMapLibreLayers } from "../shared/maplibre-style-bridge.js";
import layerRegistry from "../shared/layer-registry.js";

/**
 * Opacity paint keys that slideshow staging can force to 0. Only when the
 * current paint is a **plain number**; expression-based paints and missing
 * keys are left unchanged (layers may stay visible until reveal) — v1
 * limitation; see implementation plan.
 *
 * Order: area/line vector opacities, then circle (point markers), then symbol
 * (icon/text) and raster.
 */
export const FADE_KEYS = [
  "fill-opacity",
  "line-opacity",
  "circle-opacity",
  "icon-opacity",
  "text-opacity",
  "raster-opacity",
];

/**
 * @param {{ transition?: { stageHidden?: boolean, transitionMs?: number } }} [layerStyleOptions]
 * @returns {{ stageHidden: boolean, transitionMs: number }}
 */
export function resolveTransitionOptions(layerStyleOptions) {
  const t = layerStyleOptions?.transition;
  if (!t || typeof t !== "object") {
    return { stageHidden: false, transitionMs: 0 };
  }
  const stageHidden = Boolean(t.stageHidden);
  const raw = t.transitionMs;
  const transitionMs =
    typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, raw) : 0;
  return { stageHidden, transitionMs };
}

/**
 * Stages a layer def for hidden add: for each of {@link FADE_KEYS}, if the
 * value is a **plain number**, records it in `targetOpacity` and sets paint
 * to 0. Non-numeric (e.g. `match` / `interpolate`) and missing keys are not
 * modified.
 *
 * @param {object} layerDef - MapLibre layer spec (must include `paint` if opacities exist)
 * @returns {{ stagedLayerDef: object, targetOpacity: Record<string, number> }}
 */
export function stageLayerHidden(layerDef) {
  const targetOpacity = {};
  const paint = { ...(layerDef.paint || {}) };
  for (const key of FADE_KEYS) {
    if (typeof paint[key] === "number") {
      targetOpacity[key] = paint[key];
      paint[key] = 0;
    }
  }
  return { stagedLayerDef: { ...layerDef, paint }, targetOpacity };
}

/**
 * Sets opacity paint properties on existing layers to values from
 * `targetByLayerId`, with optional transition per key. Used by
 * `commitSlideshowReveal`; expects numeric targets (from {@link stageLayerHidden}).
 *
 * @param {object} map
 * @param {string[]} layerIds
 * @param {Record<string, Record<string, number>>} targetByLayerId
 * @param {number} transitionMs
 */
export function revealLayerIdsWithTargets(map, layerIds, targetByLayerId, transitionMs) {
  if (!map || !Array.isArray(layerIds) || !targetByLayerId) {
    return;
  }
  const ms =
    typeof transitionMs === "number" && Number.isFinite(transitionMs)
      ? Math.max(0, transitionMs)
      : 0;
  const setPaint =
    typeof map.setPaintProperty === "function" ? map.setPaintProperty.bind(map) : null;
  if (!setPaint) {
    return;
  }
  for (const layerId of layerIds) {
    if (typeof map.getLayer !== "function" || !map.getLayer(layerId)) {
      continue;
    }
    const targets = targetByLayerId[layerId];
    if (!targets || typeof targets !== "object") {
      continue;
    }
    for (const [key, value] of Object.entries(targets)) {
      if (typeof value !== "number") {
        continue;
      }
      setPaint(layerId, `${key}-transition`, { duration: ms, delay: 0 });
      setPaint(layerId, key, value);
    }
  }
}

/**
 * Fades {@link FADE_KEYS} opacities on enabled registry layers to 0, waits
 * approximately `transitionMs` (MapLibre transition end is not awaited), then
 * removes each fullId from the map. Safe no-op when `!map` or `fullIds` is
 * empty. When `transitionMs === 0`, removes immediately without animating.
 *
 * @param {object} map
 * @param {string[]} fullIds
 * @param {number} transitionMs
 * @param {{
 *   lifecycle?: {
 *     retainDisabled?: boolean,
 *     maxRetainedSources?: number,
 *     retainedFullIds?: Set<string> | string[],
 *   },
 * }} [layerStyleOptions]
 * @returns {Promise<void>}
 */
export async function fadeOutAndRemoveEnabledFullIds(
  map,
  fullIds,
  transitionMs,
  layerStyleOptions,
) {
  if (!map || !Array.isArray(fullIds) || fullIds.length === 0) {
    return;
  }
  const state = getOrCreateMapState(map);
  const ms =
    typeof transitionMs === "number" && Number.isFinite(transitionMs)
      ? Math.max(0, transitionMs)
      : 0;
  const lifecycleOptions = resolveLifecycleOptions(layerStyleOptions);

  const cleanupOrRetain = (fullId) => {
    const fid = fullId != null ? String(fullId).trim() : "";
    if (!fid || !state.loadedLayerIds.has(fid)) {
      return;
    }
    if (!hideRetainedFullId(map, fid, state, lifecycleOptions)) {
      removeFullIdFromMap(map, fid, state);
    }
  };

  if (ms === 0) {
    for (const fullId of fullIds) {
      cleanupOrRetain(fullId);
    }
    evictRetainedFullIds(map, state, lifecycleOptions.maxRetainedSources);
    return;
  }

  /** @type {Record<string, Record<string, number>>} */
  const targetByLayerId = {};
  /** @type {Record<string, Record<string, number>>} */
  const restoreByLayerId = {};
  const layerIdSet = new Set();
  const getPaint =
    typeof map.getPaintProperty === "function" ? map.getPaintProperty.bind(map) : null;
  const getLayer = typeof map.getLayer === "function" ? map.getLayer.bind(map) : null;

  for (const fullId of fullIds) {
    const fid = fullId != null ? String(fullId).trim() : "";
    if (!fid || !state.loadedLayerIds.has(fid)) {
      continue;
    }
    const mlLayerIds = state.loadedLayerIds.get(fid) || [];
    for (const layerId of mlLayerIds) {
      if (!getLayer || !getLayer(layerId)) {
        continue;
      }
      if (!targetByLayerId[layerId]) {
        targetByLayerId[layerId] = {};
      }
      const merged = targetByLayerId[layerId];
      if (getPaint) {
        for (const key of FADE_KEYS) {
          let v;
          try {
            v = getPaint(layerId, key);
          } catch {
            continue;
          }
          if (typeof v === "number") {
            merged[key] = 0;
            if (!restoreByLayerId[layerId]) {
              restoreByLayerId[layerId] = {};
            }
            restoreByLayerId[layerId][key] = v;
          }
        }
      }
      layerIdSet.add(layerId);
    }
  }

  const uniqueLayerIds = [...layerIdSet];
  revealLayerIdsWithTargets(map, uniqueLayerIds, targetByLayerId, ms);

  await new Promise((r) => setTimeout(r, ms));

  if (lifecycleOptions.retainDisabled) {
    revealLayerIdsWithTargets(map, uniqueLayerIds, restoreByLayerId, 0);
  }

  for (const fullId of fullIds) {
    cleanupOrRetain(fullId);
  }
  evictRetainedFullIds(map, state, lifecycleOptions.maxRetainedSources);
}

/**
 * Syncs layer groups in slideshow “stage hidden” mode. Staging only zeros
 * {@link FADE_KEYS} when the paint is a plain number; expressions and missing
 * keys are not altered (v1 limitation).
 *
 */
export function beginSlideshowStage(map, layerGroups, layerStyleOptions) {
  const base = layerStyleOptions && typeof layerStyleOptions === "object" ? { ...layerStyleOptions } : {};
  const prevTransition =
    base.transition && typeof base.transition === "object" ? { ...base.transition } : {};
  const opts = {
    ...base,
    transition: { ...prevTransition, stageHidden: true },
  };
  const { transitionMs } = resolveTransitionOptions(opts);
  const stagedMeta = {
    addedLayerIds: [],
    targetOpacityByLayerId: {},
    stagedFullIds: [],
    transitionMs,
  };
  syncLayerGroupsToMap(map, layerGroups, opts, stagedMeta);
  return stagedMeta;
}

/**
 * Reveals layers staged by {@link beginSlideshowStage} using `addedLayerIds`
 * and `targetOpacityByLayerId` only (`stagedFullIds` is not read here).
 * Duration: if `transitionMs` is a **finite** number, it wins; otherwise
 * `stagedMeta.transitionMs` is used.
 */
export function commitSlideshowReveal(map, stagedMeta, transitionMs) {
  if (!map || !stagedMeta) {
    return;
  }
  const ms =
    typeof transitionMs === "number" && Number.isFinite(transitionMs)
      ? Math.max(0, transitionMs)
      : typeof stagedMeta.transitionMs === "number" && Number.isFinite(stagedMeta.transitionMs)
        ? Math.max(0, stagedMeta.transitionMs)
        : 0;
  revealLayerIdsWithTargets(
    map,
    stagedMeta.addedLayerIds,
    stagedMeta.targetOpacityByLayerId,
    ms,
  );
}

function releaseHatchPatternsForFullId(map, fullId, state) {
  const ids = state.hatchPatternIdsByFullId.get(fullId);
  if (!Array.isArray(ids) || ids.length === 0) {
    state.hatchPatternIdsByFullId.delete(fullId);
    return;
  }

  for (const patternId of ids) {
    const prevCount = state.hatchPatternRefCounts.get(patternId) || 0;
    const nextCount = prevCount - 1;
    if (nextCount <= 0) {
      state.hatchPatternRefCounts.delete(patternId);
      if (typeof map.removeImage === "function" && map.hasImage(patternId)) {
        map.removeImage(patternId);
      }
    } else {
      state.hatchPatternRefCounts.set(patternId, nextCount);
    }
  }

  state.hatchPatternIdsByFullId.delete(fullId);
}

function registerHatchPatternImages(map, styleLayer, state, trackedPatternIds) {
  const specs = [];
  if (styleLayer._hatchPattern) {
    specs.push(styleLayer._hatchPattern);
  }
  if (Array.isArray(styleLayer._hatchPatterns)) {
    for (const s of styleLayer._hatchPatterns) {
      if (s) specs.push(s);
    }
  }
  for (const spec of specs) {
    if (!spec?.patternId) continue;
    if (trackedPatternIds.has(spec.patternId)) continue;
    if (!map.hasImage(spec.patternId)) {
      const image = createHatchImageDataFromSpec(spec);
      if (spec.pixelRatio && spec.pixelRatio !== 1) {
        map.addImage(spec.patternId, image, { pixelRatio: spec.pixelRatio });
      } else {
        map.addImage(spec.patternId, image);
      }
    }
    trackedPatternIds.add(spec.patternId);
    const currentRefCount = state.hatchPatternRefCounts.get(spec.patternId) || 0;
    state.hatchPatternRefCounts.set(spec.patternId, currentRefCount + 1);
  }

  const markerSquares = [];
  if (styleLayer._markerLineSquarePattern) {
    markerSquares.push(styleLayer._markerLineSquarePattern);
  }
  if (Array.isArray(styleLayer._markerLineSquarePatterns)) {
    for (const s of styleLayer._markerLineSquarePatterns) {
      if (s) markerSquares.push(s);
    }
  }
  for (const spec of markerSquares) {
    const imageId = spec?.imageId;
    if (!imageId) continue;
    if (trackedPatternIds.has(imageId)) continue;
    if (!map.hasImage(imageId)) {
      const image = createMarkerLineSquareImageData(spec);
      map.addImage(imageId, image);
    }
    trackedPatternIds.add(imageId);
    const currentRefCount = state.hatchPatternRefCounts.get(imageId) || 0;
    state.hatchPatternRefCounts.set(imageId, currentRefCount + 1);
  }
}

/** MapLibre does not host DOM-backed image layers; tracked so sync does not retry addLayerToMap. */
const DOM_IMAGE_LAYER_SOURCE_PLACEHOLDER = "__otef_dom_image_layer__";

const mapStateByMap = new WeakMap();

function getOrCreateMapState(map) {
  let state = mapStateByMap.get(map);
  if (!state) {
    state = {
      loadedSources: new Map(), // fullId -> sourceId
      loadedLayerIds: new Map(), // fullId -> string[]
      retainedHiddenFullIds: new Map(), // fullId -> true, insertion order tracks hide age
      hatchPatternIdsByFullId: new Map(), // fullId -> string[]
      hatchPatternRefCounts: new Map(), // patternId -> number
    };
    mapStateByMap.set(map, state);
  }
  return state;
}

// Intentionally per-layer only: a full id is enabled if layer.enabled is truthy.
// group.enabled is not applied here (unlike resolveLayerState / UI gating) so MapLibre
// sync stays aligned with registry layers that may still be toggled individually.
//
// When a row carries `fullLayerIds` (e.g. projector_base שמות_יישובים merged with
// Locations_Lines, or coalesced curated rows), all listed full ids are enabled together.
export function getEnabledMapFullLayerIds(layerGroups) {
  const enabled = new Set();
  if (!layerGroups) {
    return enabled;
  }

  const groups = Array.isArray(layerGroups)
    ? layerGroups
    : Object.values(layerGroups);

  for (const group of groups) {
    if (!group) {
      continue;
    }
    const groupId = group.id;
    if (!groupId) {
      continue;
    }
    for (const layer of group.layers || []) {
      if (!layer?.enabled) {
        continue;
      }
      const extra =
        Array.isArray(layer.fullLayerIds) && layer.fullLayerIds.length > 0
          ? layer.fullLayerIds
          : null;
      if (extra) {
        for (const fid of extra) {
          if (fid != null && String(fid).trim() !== "") {
            enabled.add(String(fid).trim());
          }
        }
      } else {
        enabled.add(`${groupId}.${layer.id}`);
      }
    }
  }

  return enabled;
}

function removeFullIdFromMap(map, fullId, state) {
  const { loadedLayerIds, loadedSources } = state;
  const mlLayerIds = loadedLayerIds.get(fullId) || [];
  for (const layerId of mlLayerIds) {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  }
  loadedLayerIds.delete(fullId);

  const storedSourceId = loadedSources.get(fullId);
  const sourceIds = normalizeSourceIds(
    storedSourceId !== undefined ? storedSourceId : fullId,
  );
  for (const sourceId of sourceIds) {
    if (
      sourceId &&
      sourceId !== DOM_IMAGE_LAYER_SOURCE_PLACEHOLDER &&
      map.getSource(sourceId)
    ) {
      map.removeSource(sourceId);
    }
  }
  loadedSources.delete(fullId);
  state.retainedHiddenFullIds.delete(fullId);
  releaseHatchPatternsForFullId(map, fullId, state);
}

function normalizeSourceIds(sourceIds) {
  if (Array.isArray(sourceIds)) {
    return sourceIds.filter(Boolean);
  }
  return sourceIds ? [sourceIds] : [];
}

function resolveLifecycleOptions(layerStyleOptions) {
  const lifecycle = layerStyleOptions?.lifecycle;
  if (!lifecycle || typeof lifecycle !== "object") {
    return {
      retainDisabled: false,
      maxRetainedSources: null,
      retainedFullIds: null,
    };
  }

  let retainedFullIds = null;
  if (lifecycle.retainedFullIds instanceof Set) {
    retainedFullIds = new Set(
      [...lifecycle.retainedFullIds]
        .map((id) => (id != null ? String(id).trim() : ""))
        .filter(Boolean),
    );
  } else if (Array.isArray(lifecycle.retainedFullIds)) {
    retainedFullIds = new Set(
      lifecycle.retainedFullIds
        .map((id) => (id != null ? String(id).trim() : ""))
        .filter(Boolean),
    );
  }

  const rawMax = lifecycle.maxRetainedSources;
  const maxRetainedSources =
    typeof rawMax === "number" && Number.isFinite(rawMax)
      ? Math.max(0, Math.floor(rawMax))
      : null;

  return {
    retainDisabled: Boolean(lifecycle.retainDisabled),
    maxRetainedSources,
    retainedFullIds,
  };
}

function shouldRetainDisabledFullId(fullId, state, lifecycleOptions) {
  if (!lifecycleOptions.retainDisabled) {
    return false;
  }
  const sourceIds = normalizeSourceIds(state.loadedSources.get(fullId)).filter(
    (sourceId) => sourceId !== DOM_IMAGE_LAYER_SOURCE_PLACEHOLDER,
  );
  if (sourceIds.length === 0) {
    return false;
  }
  if (
    lifecycleOptions.retainedFullIds &&
    !lifecycleOptions.retainedFullIds.has(fullId)
  ) {
    return false;
  }
  return true;
}

function hideRetainedFullId(map, fullId, state, lifecycleOptions) {
  if (!shouldRetainDisabledFullId(fullId, state, lifecycleOptions)) {
    return false;
  }
  if (typeof map.setLayoutProperty !== "function") {
    return false;
  }
  const mlLayerIds = state.loadedLayerIds.get(fullId) || [];
  let didHide = false;
  for (const layerId of mlLayerIds) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", "none");
      didHide = true;
    }
  }
  if (!didHide) {
    return false;
  }
  if (!state.retainedHiddenFullIds.has(fullId)) {
    state.retainedHiddenFullIds.set(fullId, true);
  }
  return true;
}

function restoreRetainedFullId(map, fullId, state) {
  if (!state.retainedHiddenFullIds.has(fullId)) {
    return false;
  }
  if (typeof map.setLayoutProperty !== "function") {
    removeFullIdFromMap(map, fullId, state);
    return false;
  }
  const mlLayerIds = state.loadedLayerIds.get(fullId) || [];
  if (mlLayerIds.length === 0) {
    removeFullIdFromMap(map, fullId, state);
    return false;
  }
  for (const layerId of mlLayerIds) {
    if (!map.getLayer(layerId)) {
      removeFullIdFromMap(map, fullId, state);
      return false;
    }
  }
  for (const layerId of mlLayerIds) {
    map.setLayoutProperty(layerId, "visibility", "visible");
  }
  state.retainedHiddenFullIds.delete(fullId);
  return true;
}

function stageRetainedFullId(map, fullId, state, stagedMeta) {
  if (!restoreRetainedFullId(map, fullId, state)) return false;
  const getPaint =
    typeof map.getPaintProperty === "function" ? map.getPaintProperty.bind(map) : null;
  for (const layerId of state.loadedLayerIds.get(fullId) || []) {
    const targetOpacity = {};
    if (getPaint) {
      for (const key of FADE_KEYS) {
        try {
          const value = getPaint(layerId, key);
          if (typeof value !== "number") continue;
          targetOpacity[key] = value;
          map.setPaintProperty(layerId, `${key}-transition`, { duration: 0, delay: 0 });
          map.setPaintProperty(layerId, key, 0);
        } catch {}
      }
    }
    stagedMeta.addedLayerIds.push(layerId);
    if (Object.keys(targetOpacity).length > 0) stagedMeta.targetOpacityByLayerId[layerId] = targetOpacity;
  }
  stagedMeta.stagedFullIds.push(fullId);
  return true;
}

function evictRetainedFullIds(map, state, maxRetainedSources, protectedFullIds = null) {
  if (maxRetainedSources === null) {
    return;
  }
  while (state.retainedHiddenFullIds.size > maxRetainedSources) {
    const oldest = [...state.retainedHiddenFullIds.keys()].find(
      (fullId) => !protectedFullIds?.has(fullId),
    );
    if (!oldest) {
      return;
    }
    removeFullIdFromMap(map, oldest, state);
  }
}

/**
 * @param {string} pathFromRegistry - Absolute app path, e.g. from the registry
 * @returns {string|null} PMTiles URL, or null if no origin (SSR, tests, or non-browser)
 */
export function buildPmtilesUrl(pathFromRegistry) {
  if (!pathFromRegistry) return null;
  const g = typeof globalThis !== "undefined" ? globalThis : undefined;
  if (!g) return null;
  const originFromGlobal =
    g.location && typeof g.location.origin === "string" ? g.location.origin : null;
  const originFromWindow =
    g.window && g.window.location && typeof g.window.location.origin === "string"
      ? g.window.location.origin
      : null;
  const origin = originFromGlobal || originFromWindow;
  if (!origin) return null;
  return `pmtiles://${origin}${pathFromRegistry}`;
}

// Tippecanoe writes PMTiles with `--layer=layer` in this project pipeline.
const DEFAULT_PMTILES_SOURCE_LAYER = "layer";

/**
 * Resolves MapLibre `source-layer` for PMTiles vector tiles.
 * Does not guess from fullId or use a "default" placeholder — a wrong name renders nothing with no error.
 *
 * @param {string} fullId - Registry full id (e.g. "greens.agri")
 * @param {object} layerConfig - Layer config from the registry
 * @returns {string|null} The vector source layer name, or null if it cannot be determined safely
 */
export function getVectorSourceLayerName(fullId, layerConfig) {
  if (!layerConfig) {
    console.warn(
      `[maplibre-layer-manager] Missing layer config; cannot resolve PMTiles source-layer for ${fullId}`,
    );
    return null;
  }
  const explicit =
    (typeof layerConfig.sourceLayer === "string" && layerConfig.sourceLayer.trim()) ||
    (typeof layerConfig.source_layer === "string" && layerConfig.source_layer.trim()) ||
    "";
  if (explicit) {
    return explicit;
  }
  // Defaulting to the tiling contract avoids silent empty renders when manifests omit sourceLayer.
  return DEFAULT_PMTILES_SOURCE_LAYER;
}

/**
 * Add a curated GeoJSON source directly to the map (bypasses layer registry).
 * @param {object} map - MapLibre map instance
 * @param {string} sourceId
 * @param {object} geojsonData - GeoJSON FeatureCollection or Feature
 */
export function addCuratedGeoJsonSource(map, sourceId, geojsonData) {
  if (!map || !sourceId || !geojsonData) return;
  const existingSource = map.getSource(sourceId);
  if (existingSource) {
    if (typeof existingSource.setData === "function") {
      try {
        existingSource.setData(geojsonData);
      } catch (err) {
        console.warn(`[maplibre-layer-manager] Failed to update curated source ${sourceId}`, err);
      }
    }
    return;
  }
  try {
    map.addSource(sourceId, { type: "geojson", data: geojsonData });
  } catch (err) {
    console.warn(`[maplibre-layer-manager] Failed to add curated source ${sourceId}`, err);
  }
}

/**
 * Remove a single curated layer (and its source) by fully-qualified id.
 * @param {object} map
 * @param {string} fullId - e.g. "curated.42__solidLine__0"
 */
export function removeCuratedLayer(map, fullId) {
  if (!map || !fullId) return;
  const state = getOrCreateMapState(map);
  removeFullIdFromMap(map, fullId, state);
}

/**
 * Remove all curated layers whose fullId starts with `prefix`.
 * Also removes associated sources tracked in map state.
 * @param {object} map
 * @param {string} prefix - e.g. "curated.42"
 * @param {{
 *   lifecycle?: {
 *     retainDisabled?: boolean,
 *     maxRetainedSources?: number,
 *     retainedFullIds?: Set<string> | string[],
 *   },
 * }} [layerStyleOptions]
 */
export function removeCuratedLayersByPrefix(map, prefix, layerStyleOptions) {
  if (!map || !prefix) return;
  const state = getOrCreateMapState(map);
  const lifecycleOptions = resolveLifecycleOptions(layerStyleOptions);
  const toRemove = [];
  const retainedLayerIds = new Set();
  const retainedSourceIds = new Set();
  for (const id of state.loadedLayerIds.keys()) {
    if (id.startsWith(prefix)) toRemove.push(id);
  }
  for (const id of state.loadedSources.keys()) {
    if (id.startsWith(prefix) && !toRemove.includes(id)) toRemove.push(id);
  }
  for (const id of toRemove) {
    if (!hideRetainedFullId(map, id, state, lifecycleOptions)) {
      removeFullIdFromMap(map, id, state);
    } else {
      for (const layerId of state.loadedLayerIds.get(id) || []) {
        retainedLayerIds.add(layerId);
      }
      for (const sourceId of normalizeSourceIds(state.loadedSources.get(id))) {
        retainedSourceIds.add(sourceId);
      }
    }
  }
  evictRetainedFullIds(map, state, lifecycleOptions.maxRetainedSources);
  // Also remove any MapLibre layers/sources with matching prefix not tracked in state
  try {
    const style = map.getStyle();
    if (style) {
      for (const layer of (style.layers || [])) {
        if (layer.id && layer.id.startsWith(prefix) && !retainedLayerIds.has(layer.id)) {
          if (map.getLayer(layer.id)) map.removeLayer(layer.id);
        }
      }
      for (const srcId of Object.keys(style.sources || {})) {
        if (srcId.startsWith(prefix) && !retainedSourceIds.has(srcId)) {
          if (map.getSource(srcId)) map.removeSource(srcId);
        }
      }
    }
  } catch (err) {
    console.warn(
      `[maplibre-layer-manager] removeCuratedLayersByPrefix: failed to sweep style for prefix ${prefix}`,
      err,
    );
  }
}

/**
 * Register curated layer ids and source into the map state for lifecycle tracking.
 * @param {object} map
 * @param {string} fullId - logical id (e.g. "curated.42")
 * @param {string|string[]} sourceId - MapLibre source id or ids
 * @param {string[]} layerIds - MapLibre layer ids added for this curated pack
 */
export function registerCuratedLayerIds(map, fullId, sourceId, layerIds) {
  if (!map || !fullId) return;
  const state = getOrCreateMapState(map);
  state.loadedSources.set(fullId, Array.isArray(sourceId) ? [...sourceId] : sourceId);
  state.loadedLayerIds.set(fullId, Array.isArray(layerIds) ? layerIds : []);
}

function rollbackFullIdAdd(map, fullId, sourceId, state, addedLayerIds, registeredPatternIds) {
  for (const layerId of addedLayerIds) {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  }
  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  }
  state.loadedLayerIds.delete(fullId);
  state.loadedSources.delete(fullId);
  if (registeredPatternIds.size > 0) {
    state.hatchPatternIdsByFullId.set(fullId, [...registeredPatternIds]);
    releaseHatchPatternsForFullId(map, fullId, state);
  }
}

/**
 * @param {{
 *   applyProjectionHatchPresentation?: boolean,
 *   renderMapLabelsFromStyle?: boolean,
 * }} [layerStyleOptions] - projection passes `{ applyProjectionHatchPresentation: true }` for
 *   denser hatch rasters and to scope `style.labels` → symbol layers to שמות_יישובים only; GIS omits.
 */
function addLayerToMap(map, fullId, state, layerStyleOptions, stagedMeta) {
  const { loadedSources, loadedLayerIds } = state;
  const shouldStage =
    stagedMeta != null && resolveTransitionOptions(layerStyleOptions).stageHidden;
  // Curated layer ids are managed by maplibre-curated-layer-loader, not the registry path.
  if (!layerRegistry.getLayerConfig(fullId) && fullId.startsWith("curated")) return;
  const layerConfig = layerRegistry.getLayerConfig(fullId);
  if (!layerConfig) {
    console.warn(`[maplibre-layer-manager] Missing layer config for ${fullId}`);
    return;
  }

  if (layerConfig.format === "wmts") {
    return;
  }

  if (layerConfig.format === "image" || layerConfig.geometryType === "image") {
    loadedSources.set(fullId, DOM_IMAGE_LAYER_SOURCE_PLACEHOLDER);
    loadedLayerIds.set(fullId, []);
    return;
  }

  const sourceId = fullId;
  let hasSource = false;
  let usesVectorSource = false;

  let pmtilesVectorSourceLayer = null;
  if (layerConfig.pmtilesFile) {
    pmtilesVectorSourceLayer = getVectorSourceLayerName(fullId, layerConfig);
    if (!pmtilesVectorSourceLayer) {
      return;
    }
    const pmPath = layerRegistry.getLayerPMTilesUrl(fullId);
    const pmtilesUrl = buildPmtilesUrl(pmPath);
    if (!pmtilesUrl) {
      return;
    }
    try {
      map.addSource(sourceId, { type: "vector", url: pmtilesUrl });
      hasSource = true;
      usesVectorSource = true;
    } catch (error) {
      console.warn(
        `[maplibre-layer-manager] Failed to add PMTiles source for ${fullId}`,
        error,
      );
      return;
    }
  } else {
    const dataUrl = layerRegistry.getLayerDataUrl(fullId);
    if (!dataUrl) {
      return;
    }
    try {
      map.addSource(sourceId, { type: "geojson", data: dataUrl });
      hasSource = true;
    } catch (error) {
      console.warn(
        `[maplibre-layer-manager] Failed to add GeoJSON source for ${fullId}`,
        error,
      );
      return;
    }
  }

  if (!hasSource) {
    return;
  }

  const addedLayerIds = [];
  /** @type {Record<string, Record<string, number>>} */
  const pendingStageTargets = {};
  const registeredPatternIds = new Set();
  let styleLayers;
  try {
    styleLayers = irToMapLibreLayers(fullId, sourceId, layerConfig, layerStyleOptions || {});
  } catch (error) {
    console.warn(
      `[maplibre-layer-manager] Failed to build style layers for ${fullId}`,
      error,
    );
    if (map.getSource(sourceId)) {
      map.removeSource(sourceId);
    }
    loadedLayerIds.delete(fullId);
    loadedSources.delete(fullId);
    return;
  }

  for (const styleLayer of styleLayers || []) {
    try {
      registerHatchPatternImages(map, styleLayer, state, registeredPatternIds);
    } catch (error) {
      console.warn(
        `[maplibre-layer-manager] Failed to register style pattern images for ${fullId}`,
        error,
      );
      rollbackFullIdAdd(map, fullId, sourceId, state, addedLayerIds, registeredPatternIds);
      return;
    }
    const {
      _hatchPattern,
      _hatchPatterns,
      _markerLineSquarePattern,
      _markerLineSquarePatterns,
      _uniqueValuePointColorFallback,
      ...styleRest
    } = styleLayer;
    if (_uniqueValuePointColorFallback) {
      console.warn(
        `[maplibre-layer-manager] uniqueValue point symbol has no resolvable color for ${fullId} ` +
          `(style layer id=${styleLayer.id}); using #808080. Set marker.fill, marker.fillColor, or marker.color.`,
      );
    }
    const layerDef = { ...styleRest, source: sourceId };

    if (usesVectorSource && pmtilesVectorSourceLayer) {
      layerDef["source-layer"] = pmtilesVectorSourceLayer;
    }

    let defToAdd = layerDef;
    if (shouldStage) {
      const { stagedLayerDef, targetOpacity } = stageLayerHidden(layerDef);
      defToAdd = stagedLayerDef;
      if (Object.keys(targetOpacity).length > 0) {
        pendingStageTargets[stagedLayerDef.id] = targetOpacity;
      }
    }

    try {
      map.addLayer(defToAdd);
      addedLayerIds.push(defToAdd.id);
    } catch (error) {
      console.warn(
        `[maplibre-layer-manager] Failed to add style layer ${layerDef.id}`,
        error,
      );
      rollbackFullIdAdd(map, fullId, sourceId, state, addedLayerIds, registeredPatternIds);
      return;
    }
  }

  if (addedLayerIds.length === 0) {
    rollbackFullIdAdd(map, fullId, sourceId, state, addedLayerIds, registeredPatternIds);
    return;
  }

  loadedSources.set(fullId, sourceId);
  loadedLayerIds.set(fullId, addedLayerIds);
  if (registeredPatternIds.size > 0) {
    state.hatchPatternIdsByFullId.set(fullId, [...registeredPatternIds]);
  } else {
    state.hatchPatternIdsByFullId.delete(fullId);
  }

  if (shouldStage) {
    for (const id of addedLayerIds) {
      stagedMeta.addedLayerIds.push(id);
      if (pendingStageTargets[id]) {
        stagedMeta.targetOpacityByLayerId[id] = pendingStageTargets[id];
      }
    }
    stagedMeta.stagedFullIds.push(fullId);
  }
}

function syncLayerGroupsToMap(map, layerGroups, layerStyleOptions, stagedMeta) {
  const state = getOrCreateMapState(map);
  const { loadedSources, loadedLayerIds } = state;
  const lifecycleOptions = resolveLifecycleOptions(layerStyleOptions);
  const enabledFullIds = getEnabledMapFullLayerIds(layerGroups);
  const trackedFullIds = new Set([
    ...loadedLayerIds.keys(),
    ...loadedSources.keys(),
  ]);

  for (const fullId of trackedFullIds) {
    if (!enabledFullIds.has(fullId)) {
      if (!hideRetainedFullId(map, fullId, state, lifecycleOptions)) {
        removeFullIdFromMap(map, fullId, state);
      }
    }
  }
  evictRetainedFullIds(
    map,
    state,
    lifecycleOptions.maxRetainedSources,
    enabledFullIds,
  );

  for (const fullId of enabledFullIds) {
    if (stagedMeta && state.retainedHiddenFullIds.has(fullId)) {
      if (stageRetainedFullId(map, fullId, state, stagedMeta)) {
        continue;
      }
    }
    if (restoreRetainedFullId(map, fullId, state)) {
      continue;
    }
    if (!loadedSources.has(fullId)) {
      addLayerToMap(map, fullId, state, layerStyleOptions, stagedMeta);
    }
  }
}

export function applyLayerGroupsToMap(map, layerGroups, layerStyleOptions) {
  syncLayerGroupsToMap(map, layerGroups, layerStyleOptions, null);
}

export function clearAllLayers(map) {
  const state = getOrCreateMapState(map);
  const trackedFullIds = new Set([
    ...state.loadedLayerIds.keys(),
    ...state.loadedSources.keys(),
  ]);

  for (const fullId of trackedFullIds) {
    removeFullIdFromMap(map, fullId, state);
  }
  state.loadedSources.clear();
  state.loadedLayerIds.clear();
  state.retainedHiddenFullIds.clear();
  state.hatchPatternIdsByFullId.clear();
  state.hatchPatternRefCounts.clear();
}
