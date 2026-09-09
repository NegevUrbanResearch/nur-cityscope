const coordinators = new WeakMap();

/**
 * Schedule exactly one style reconstruction for the newest basemap request.
 * A MapLibre style can finish after a newer setStyle call, so every listener is
 * generation-scoped and the old listener is detached before replacing it.
 */
export function installGisStyleReload({ map, refreshLayers, personVisual, narrativeController, getLayerGroups, isCurrent = () => true } = {}) {
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
      isCurrent,
    });
    if (coordinators.get(map) !== record || !isCurrent()) return;
    personVisual?.bringToFront?.();
    narrativeController?.onStyleLoad?.();
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

/** The production basemap request path, separate from MapLibre's eventual style.load event. */
export function createGisBasemapStyleCoordinator({
  map,
  initialBasemap,
  setBasemap,
  refreshLayers,
  personVisual,
  narrativeController,
  getLayerGroups,
} = {}) {
  let requestedBasemap = initialBasemap;
  let requestGeneration = 0;
  let disposeStyleReload = null;

  const request = (nextBasemap) => {
    if (nextBasemap === requestedBasemap || typeof setBasemap !== "function") return false;
    const previousBasemap = requestedBasemap;
    const generation = ++requestGeneration;
    requestedBasemap = nextBasemap;
    disposeStyleReload?.();
    const isCurrent = () => generation === requestGeneration && requestedBasemap === nextBasemap;
    disposeStyleReload = installGisStyleReload({
      map,
      personVisual,
      narrativeController,
      getLayerGroups,
      isCurrent,
      refreshLayers: (options) => refreshLayers?.({ ...options, basemap: nextBasemap, isCurrent }),
    });
    if (!setBasemap(map, nextBasemap)) {
      requestedBasemap = previousBasemap;
      disposeStyleReload?.();
      disposeStyleReload = null;
      return false;
    }
    if (typeof map?.on !== "function") {
      void refreshLayers?.({
        groupsOverride: typeof getLayerGroups === "function" ? getLayerGroups() : undefined,
        syncFlow: false,
        basemap: nextBasemap,
        isCurrent,
      });
    }
    return true;
  };

  return {
    request,
    getRequestedBasemap: () => requestedBasemap,
    dispose() { disposeStyleReload?.(); disposeStyleReload = null; },
  };
}
