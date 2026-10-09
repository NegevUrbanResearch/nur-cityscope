import { isGisBasemapId } from "../shared/gis-basemap.js";

const coordinators = new WeakMap();
const BASEMAP_RETRY_DELAY_MS = 500;

/**
 * Rebuild overlays after a real MapLibre style load.
 * A newer style can finish after an older setStyle, so every listener is
 * generation-scoped and the old listener is detached before replacing it.
 * Basemap id changes do not use this path.
 */
export function installGisStyleReload({ map, refreshLayers, personVisual, narrativeController, getLayerGroups, onStyleLoad: afterStyleLoad, isCurrent = () => true } = {}) {
  if (!map || typeof refreshLayers !== "function" || typeof map.on !== "function") return () => {};
  const prior = coordinators.get(map);
  if (prior?.listener) map.off?.("style.load", prior.listener);
  const generation = (prior?.generation || 0) + 1;
  const record = { generation, listener: null };
  const onStyleLoad = async () => {
    map.off?.("style.load", onStyleLoad);
    if (coordinators.get(map) !== record || !isCurrent()) return;
    await refreshLayers({
      groupsOverride: typeof getLayerGroups === "function" ? getLayerGroups() : undefined,
      syncFlow: false,
      reopenGate: true,
      isCurrent,
    });
    if (coordinators.get(map) !== record || !isCurrent()) return;
    personVisual?.bringToFront?.();
    narrativeController?.onStyleLoad?.();
    afterStyleLoad?.();
  };
  record.listener = onStyleLoad;
  coordinators.set(map, record);
  map.on("style.load", onStyleLoad);
  return () => {
    if (coordinators.get(map) !== record) return;
    map.off?.("style.load", onStyleLoad);
    coordinators.delete(map);
  };
}

/** Accepted basemap intent and settlement. Basemap changes do not reload the style. */
export function createGisBasemapStyleCoordinator({
  map,
  initialBasemap,
  setBasemap,
} = {}) {
  let intent = { basemapId: initialBasemap, retryUsed: false, retryTimer: null };
  let displayedBasemap = initialBasemap;
  let disposed = false;

  const cancelRetry = (record) => {
    clearTimeout(record.retryTimer);
    record.retryTimer = null;
  };

  const attempt = (record) => {
    const token = {};
    record.attempt = token;
    let accepted;
    let settled = false;
    let synchronousResult;
    const onSettled = (result) => {
      if (accepted === undefined) {
        synchronousResult = result;
        return;
      }
      if (!accepted || settled || disposed || intent !== record || record.attempt !== token) return;
      settled = true;
      displayedBasemap = result?.basemapId;
      if (result?.status !== "failed") return;
      console.warn(`[gis-basemap] failed to show ${record.basemapId}; retaining ${result.basemapId}; reason=${result.reason || "unknown"}`);
      if (result.reason !== "source-timeout" || record.retryUsed) return;
      record.retryUsed = true;
      record.retryTimer = setTimeout(() => {
        record.retryTimer = null;
        if (!disposed && intent === record) attempt(record);
      }, BASEMAP_RETRY_DELAY_MS);
    };
    // A rejected setter must not settle the tentative intent or invalidate its predecessor.
    accepted = Boolean(setBasemap(map, record.basemapId, { onSettled }));
    if (synchronousResult !== undefined) onSettled(synchronousResult);
    return accepted;
  };

  const request = (nextBasemap) => {
    if (disposed || typeof setBasemap !== "function" || !isGisBasemapId(nextBasemap)) return false;
    if (nextBasemap === intent.basemapId) return false;
    const previous = intent;
    const next = { basemapId: nextBasemap, retryUsed: false, retryTimer: null };
    intent = next;
    if (!attempt(next)) {
      intent = previous;
      return false;
    }
    cancelRetry(previous);
    return true;
  };

  return {
    request,
    acceptSceneBasemap(basemapId) {
      if (disposed || !isGisBasemapId(basemapId)) return;
      cancelRetry(intent);
      intent = { basemapId, retryUsed: false, retryTimer: null };
      displayedBasemap = basemapId;
    },
    getRequestedBasemap: () => intent.basemapId,
    getDisplayedBasemap: () => displayedBasemap,
    dispose() {
      disposed = true;
      cancelRetry(intent);
    },
  };
}
