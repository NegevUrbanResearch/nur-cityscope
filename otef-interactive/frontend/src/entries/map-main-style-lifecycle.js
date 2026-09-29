import { isGisBasemapId } from "../shared/gis-basemap.js";

const coordinators = new WeakMap();

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
  let requestedBasemap = initialBasemap;
  let requestGeneration = 0;
  let disposed = false;

  const request = (nextBasemap) => {
    if (typeof setBasemap !== "function" || !isGisBasemapId(nextBasemap)) return false;
    if (nextBasemap === requestedBasemap) return false;

    const previousBasemap = requestedBasemap;
    const previousGeneration = requestGeneration;
    const generation = ++requestGeneration;
    requestedBasemap = nextBasemap;
    const accepted = setBasemap(map, nextBasemap, {
      onSettled(result) {
        if (disposed || generation !== requestGeneration) return;
        requestedBasemap = result?.basemapId;
        if (result?.status === "failed") {
          console.warn(
            `[gis-basemap] failed to show ${nextBasemap}; retaining ${result.basemapId}`,
          );
        }
      },
    });
    if (!accepted) {
      requestedBasemap = previousBasemap;
      requestGeneration = previousGeneration;
      return false;
    }
    return true;
  };

  return {
    request,
    getRequestedBasemap: () => requestedBasemap,
    dispose() {
      disposed = true;
      requestGeneration += 1;
    },
  };
}
