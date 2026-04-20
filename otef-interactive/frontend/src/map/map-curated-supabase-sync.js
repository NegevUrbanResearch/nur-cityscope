import { shouldShowLayerOnGisMap } from "../shared/gis-layer-filter.js";

/**
 * After a curated Supabase pull, refresh API layer groups and sync the GIS map:
 * reload packs already loaded, then load any newly enabled curated ids.
 *
 * Calls are debounced (~400ms) so rapid triggers coalesce into one refresh.
 *
 * @param {{
 *   reloadCuratedOnMap: (opts?: { affectedCuratedFullLayerIds?: string[] }) => void,
 *   loadLayerFromRegistry: (fullLayerId: string) => Promise<void>,
 *   pullPayload?: { affected_curated_full_layer_ids?: string[] } | null,
 *   applyLayerGroupsState?: (layerGroups: unknown, mapDeps: object) => void,
 *   mapDeps?: object,
 * }} options
 */

const SYNC_DEBOUNCE_MS = 400;

let syncDebounceTimer = null;
/** @type {object[]} */
let pendingSyncCalls = [];
/** @type {Array<{ resolve: () => void, reject: (e: unknown) => void }>} */
let syncWaiters = [];

/**
 * Coalesce debounced calls: latest callbacks, union selective ids, or full reload if any call requires it.
 * @param {object[]} calls
 */
function mergePendingSyncCuratedCalls(calls) {
  if (!calls.length) {
    return {};
  }
  const latest = calls[calls.length - 1];
  const reloadCuratedOnMap = latest.reloadCuratedOnMap;
  const loadLayerFromRegistry = latest.loadLayerFromRegistry;
  const applyLayerGroupsState = latest.applyLayerGroupsState;
  const mapDeps = latest.mapDeps;

  /** @type {Set<string>} */
  const idSet = new Set();
  let forceFull = false;
  for (const c of calls) {
    const pp = c && c.pullPayload;
    if (
      !pp ||
      !Array.isArray(pp.affected_curated_full_layer_ids) ||
      pp.affected_curated_full_layer_ids.length === 0
    ) {
      forceFull = true;
      break;
    }
    for (const id of pp.affected_curated_full_layer_ids) {
      if (typeof id === "string") {
        idSet.add(id);
      }
    }
  }

  if (forceFull) {
    return {
      reloadCuratedOnMap,
      loadLayerFromRegistry,
      applyLayerGroupsState,
      mapDeps,
      pullPayload: null,
    };
  }
  return {
    reloadCuratedOnMap,
    loadLayerFromRegistry,
    applyLayerGroupsState,
    mapDeps,
    pullPayload: {
      affected_curated_full_layer_ids: [...idSet],
    },
  };
}

/**
 * @param {object | null | undefined} options
 */
async function runSyncCuratedMapLayersAfterSupabasePull(options) {
  const {
    reloadCuratedOnMap,
    loadLayerFromRegistry,
    pullPayload,
    applyLayerGroupsState,
    mapDeps,
  } = options || {};
  if (
    typeof OTEFDataContext !== "undefined" &&
    typeof OTEFDataContext.refreshLayerGroupsFromApi === "function"
  ) {
    await OTEFDataContext.refreshLayerGroupsFromApi();
  }
  const affected =
    pullPayload &&
    Array.isArray(pullPayload.affected_curated_full_layer_ids) &&
    pullPayload.affected_curated_full_layer_ids.length > 0
      ? pullPayload.affected_curated_full_layer_ids
      : null;
  if (affected) {
    reloadCuratedOnMap({ affectedCuratedFullLayerIds: affected });
  } else {
    reloadCuratedOnMap();
  }
  if (
    typeof LayerStateHelper !== "undefined" &&
    typeof LayerStateHelper.getEffectiveLayerGroups === "function"
  ) {
    const groups = LayerStateHelper.getEffectiveLayerGroups();
    for (const group of groups || []) {
      if (!group || typeof group.id !== "string" || !group.id.startsWith("curated")) {
        continue;
      }
      for (const layer of group.layers || []) {
        if (!layer.enabled) continue;
        if (!shouldShowLayerOnGisMap(group.id, layer.id)) continue;
        void loadLayerFromRegistry(`${group.id}.${layer.id}`);
      }
    }
  }
  if (
    typeof applyLayerGroupsState === "function" &&
    mapDeps &&
    typeof LayerStateHelper !== "undefined" &&
    typeof LayerStateHelper.getEffectiveLayerGroups === "function"
  ) {
    applyLayerGroupsState(LayerStateHelper.getEffectiveLayerGroups(), mapDeps);
  }
}

/**
 * @param {{
 *   reloadCuratedOnMap: (opts?: { affectedCuratedFullLayerIds?: string[] }) => void,
 *   loadLayerFromRegistry: (fullLayerId: string) => Promise<void>,
 *   pullPayload?: { affected_curated_full_layer_ids?: string[] } | null,
 *   applyLayerGroupsState?: (layerGroups: unknown, mapDeps: object) => void,
 *   mapDeps?: object,
 * }} options
 * @returns {Promise<void>}
 */
export function syncCuratedMapLayersAfterSupabasePull(options) {
  pendingSyncCalls.push(options ?? {});
  return new Promise((resolve, reject) => {
    syncWaiters.push({ resolve, reject });
    if (syncDebounceTimer) {
      clearTimeout(syncDebounceTimer);
    }
    syncDebounceTimer = setTimeout(async () => {
      syncDebounceTimer = null;
      const calls = pendingSyncCalls.splice(0);
      const opts = mergePendingSyncCuratedCalls(calls);
      const batch = syncWaiters.splice(0);
      try {
        await runSyncCuratedMapLayersAfterSupabasePull(opts);
        for (const w of batch) w.resolve();
      } catch (e) {
        for (const w of batch) w.reject(e);
      }
    }, SYNC_DEBOUNCE_MS);
  });
}
