/**
 * After a curated Supabase pull, refresh API layer groups and sync the GIS map:
 * reload packs already loaded, then load any newly enabled curated ids.
 *
 * Calls are debounced (~400ms) so rapid triggers coalesce into one refresh.
 *
 * @param {{
 *   reloadCuratedOnMap: (opts?: { affectedCuratedFullLayerIds?: string[] }) => void,
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
 * Returns selective affected ids from a call, or null when call requires full reload.
 * Supports both `pullPayload.affected_curated_full_layer_ids` and legacy top-level
 * `affectedCuratedFullLayerIds`.
 * @param {object} call
 * @returns {string[] | null}
 */
function getSelectiveAffectedIdsFromCall(call) {
  const payloadIds =
    call &&
    call.pullPayload &&
    Array.isArray(call.pullPayload.affected_curated_full_layer_ids)
      ? call.pullPayload.affected_curated_full_layer_ids
      : null;
  const legacyIds =
    call && Array.isArray(call.affectedCuratedFullLayerIds)
      ? call.affectedCuratedFullLayerIds
      : null;
  const ids = payloadIds || legacyIds;
  if (!ids || ids.length === 0) {
    return null;
  }
  return ids.filter((id) => typeof id === "string");
}

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
  const applyLayerGroupsState = latest.applyLayerGroupsState;
  const mapDeps = latest.mapDeps;

  /** @type {Set<string>} */
  const idSet = new Set();
  let forceFull = false;
  for (const c of calls) {
    const selectiveIds = getSelectiveAffectedIdsFromCall(c);
    if (!selectiveIds) {
      forceFull = true;
      break;
    }
    for (const id of selectiveIds) {
      idSet.add(id);
    }
  }

  if (forceFull) {
    return {
      reloadCuratedOnMap,
      applyLayerGroupsState,
      mapDeps,
      pullPayload: null,
    };
  }
  return {
    reloadCuratedOnMap,
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
