import {
  GIS_BASEMAP_FADE_MS,
  GIS_BASEMAP_SOURCE_WAIT_MS,
  isGisBasemapId,
} from "../shared/gis-basemap.js";

const OSM_LAYER_ID = "osm-tiles";
const OSM_SOURCE_ID = "osm";
const ESRI_LAYER_ID = "esri-tiles";
const ESRI_SOURCE_ID = "esri";
const DARK_SOURCE_ID = "openmaptiles";
const ZERO_TRANSITION = Object.freeze({ duration: 0, delay: 0 });

const states = new WeakMap();

export function transitionGisBasemap(map, basemapId, options = {}) {
  const styles = options.styles;
  const onSettled = options.onSettled;
  if (!isUsableMap(map) || !isGisBasemapId(basemapId) || !isStyleSet(styles)) return false;

  const state = ensureState(map, styles);
  if (!state) return false;
  if (state.pendingId === basemapId) return true;
  if (state.pendingId == null && state.completedId === basemapId) {
    onSettled?.({ status: "completed", basemapId: state.completedId });
    return true;
  }

  beginTransition(map, state, basemapId, styles, onSettled);
  return true;
}

function beginTransition(map, state, basemapId, styles, onSettled) {
  const interrupting = state.pendingId != null;
  state.generation += 1;
  const generation = state.generation;
  state.cancelAttempt?.();
  state.cancelAttempt = null;

  if (interrupting) {
    restoreRetainedRaster(map, state);
    removeGroupsExcept(map, state.completedId, styles);
  }

  if (basemapId === state.completedId) {
    state.pendingId = null;
    onSettled?.({ status: "completed", basemapId: state.completedId });
    return;
  }

  state.pendingId = basemapId;
  const attempt = createAttempt();
  state.cancelAttempt = () => attempt.cancel();

  if (isSaturationChange(state.completedId, basemapId)) {
    startSaturation(map, state, generation, styles, basemapId, onSettled, attempt);
    return;
  }

  startCrossfade(map, state, generation, styles, basemapId, onSettled, attempt);
}

function startSaturation(map, state, generation, styles, targetId, onSettled, attempt) {
  const value = targetId === "satellite_bw" ? -1 : 0;
  setRasterPaint(map, ESRI_LAYER_ID, "raster-saturation", value, GIS_BASEMAP_FADE_MS);
  armRenderedCompletion(map, state, generation, attempt, () => {
    finishSuccess(map, state, generation, styles, targetId, onSettled, attempt, null);
  });
}

function startCrossfade(map, state, generation, styles, targetId, onSettled, attempt) {
  const reveal = targetId === "dark";
  const sourceId = reveal ? DARK_SOURCE_ID : sourceIdFor(targetId);
  let opened = false;
  let queued = null;

  const handle = waitForReady(map, sourceId, {
    onReady() {
      if (!isCurrent(state, generation, attempt)) return;
      if (!opened) {
        queued = "ready";
        return;
      }
      beginFade();
    },
    onFail() {
      if (!isCurrent(state, generation, attempt)) return;
      if (!opened) {
        queued = "fail";
        return;
      }
      finishFailure(map, state, generation, styles, onSettled, attempt);
    },
  });
  attempt.add(() => handle.cancel());

  const knownReady = Boolean(map.getSource(sourceId) && map.isSourceLoaded(sourceId));
  if (reveal) {
    ensureDark(map, styles.dark, layerIdFor(state.completedId));
  } else {
    const boundary = firstOverlayId(map, styles);
    compactGroup(map, state.completedId, styles, boundary);
    ensureRaster(map, styles[targetId], boundary);
  }
  opened = true;

  if (queued === "fail") {
    finishFailure(map, state, generation, styles, onSettled, attempt);
    return;
  }
  if (knownReady) handle.noteLoaded();
  if (queued === "ready") beginFade();

  function beginFade() {
    if (!isCurrent(state, generation, attempt) || attempt.fading) return;
    attempt.fading = true;
    handle.retainErrorWatch();
    const layerId = reveal ? layerIdFor(state.completedId) : layerIdFor(targetId);
    setRasterPaint(map, layerId, "raster-opacity", reveal ? 0 : 1, GIS_BASEMAP_FADE_MS);
    armRenderedCompletion(map, state, generation, attempt, () => {
      finishSuccess(map, state, generation, styles, targetId, onSettled, attempt, sourceId);
    });
  }
}

function armRenderedCompletion(map, state, generation, attempt, onComplete) {
  const onAnchor = () => {
    if (!isCurrent(state, generation, attempt)) return;
    map.off("render", onAnchor);
    const timer = setTimeout(() => {
      if (!isCurrent(state, generation, attempt)) return;
      const onFrame = () => {
        if (!isCurrent(state, generation, attempt)) return;
        map.off("render", onFrame);
        onComplete();
      };
      map.on("render", onFrame);
      attempt.add(() => map.off("render", onFrame));
      if (typeof map.triggerRepaint === "function") map.triggerRepaint();
    }, GIS_BASEMAP_FADE_MS);
    attempt.add(() => clearTimeout(timer));
  };
  map.on("render", onAnchor);
  attempt.add(() => map.off("render", onAnchor));
}

function finishSuccess(map, state, generation, styles, nextId, onSettled, attempt, sourceId) {
  if (!isCurrent(state, generation, attempt)) return;
  if (sourceId && !map.getSource(sourceId)) {
    finishFailure(map, state, generation, styles, onSettled, attempt);
    return;
  }

  const previousId = state.completedId;
  state.generation += 1;
  attempt.cancel();
  if (physicalKind(previousId) !== physicalKind(nextId)) {
    removeGroup(map, previousId, styles);
  }
  state.completedId = nextId;
  state.pendingId = null;
  onSettled?.({ status: "completed", basemapId: nextId });
}

function finishFailure(map, state, generation, styles, onSettled, attempt) {
  if (!isCurrent(state, generation, attempt)) return;
  state.generation += 1;
  attempt.cancel();
  state.pendingId = null;
  restoreRetainedRaster(map, state);
  removeGroupsExcept(map, state.completedId, styles);
  onSettled?.({ status: "failed", basemapId: state.completedId });
}

function waitForReady(map, sourceId, { onReady, onFail }) {
  let readinessSettled = false;
  let closed = false;
  let success = false;

  const onSourceData = (event) => {
    if (closed || readinessSettled || event?.sourceId !== sourceId) return;
    const kind = event.sourceDataType;
    if (kind === "metadata" || kind === "visibility") return;
    // MapLibre 5.24 tile events carry `tile` and omit sourceDataType.
    // Content/idle events without a tile are not success evidence.
    if (event.tile && (kind == null || kind === "content")) {
      if (event.tile.state === "errored" || event.error) {
        if (map.isSourceLoaded(sourceId) && !success) fail();
        return;
      }
      success = true;
    } else if (kind !== "idle") {
      return;
    }
    tryReady();
  };

  const onError = (event) => {
    if (closed) return;
    const id = event?.sourceId || event?.error?.sourceId;
    if (id !== sourceId) return;
    fail();
  };

  const timer = setTimeout(() => {
    fail();
  }, GIS_BASEMAP_SOURCE_WAIT_MS);

  function tryReady() {
    if (closed || readinessSettled) return;
    if (success && map.isSourceLoaded(sourceId)) ready();
  }

  function ready() {
    if (closed || readinessSettled) return;
    readinessSettled = true;
    clearTimeout(timer);
    map.off("sourcedata", onSourceData);
    onReady();
  }

  function fail() {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    map.off("sourcedata", onSourceData);
    map.off("error", onError);
    onFail();
  }

  map.on("sourcedata", onSourceData);
  map.on("error", onError);
  tryReady();

  return {
    cancel() {
      if (closed) return;
      closed = true;
      readinessSettled = true;
      clearTimeout(timer);
      map.off("sourcedata", onSourceData);
      map.off("error", onError);
    },
    retainErrorWatch() {
      if (closed) return;
      readinessSettled = true;
      clearTimeout(timer);
      map.off("sourcedata", onSourceData);
    },
    noteLoaded() {
      success = true;
      tryReady();
    },
  };
}

function ensureState(map, styles) {
  const existing = states.get(map);
  if (existing) return existing;

  const completedId = inferCompletedId(map, styles);
  if (!completedId) return null;

  const state = {
    completedId,
    pendingId: null,
    generation: 0,
    cancelAttempt: null,
  };
  const onRemove = () => {
    state.generation += 1;
    state.pendingId = null;
    const cancel = state.cancelAttempt;
    state.cancelAttempt = null;
    cancel?.();
    map.off("remove", onRemove);
    states.delete(map);
  };
  map.on("remove", onRemove);
  states.set(map, state);
  return state;
}

function inferCompletedId(map, styles) {
  if (map.getLayer(ESRI_LAYER_ID)) {
    return map.getPaintProperty(ESRI_LAYER_ID, "raster-saturation") === -1 ? "satellite_bw" : "satellite";
  }
  if (map.getLayer(OSM_LAYER_ID)) return "osm";
  const darkIds = styles.dark.layers.map((layer) => layer.id);
  if (darkIds.some((id) => map.getLayer(id))) return "dark";
  return null;
}

function restoreRetainedRaster(map, state) {
  const layerId = layerIdFor(state.completedId);
  if (!layerId || !map.getLayer(layerId)) return;
  setRasterPaint(map, layerId, "raster-opacity", 1, 0);
  if (layerId === ESRI_LAYER_ID) {
    const saturation = state.completedId === "satellite_bw" ? -1 : 0;
    setRasterPaint(map, layerId, "raster-saturation", saturation, 0);
  }
}

function compactGroup(map, basemapId, styles, boundary) {
  if (!boundary) return;
  for (const id of groupLayerIds(basemapId, styles)) {
    if (!map.getLayer(id) || id === boundary) continue;
    map.moveLayer(id, boundary);
  }
}

function ensureRaster(map, style, beforeId) {
  const layer = style.layers.find((item) => item.id === OSM_LAYER_ID || item.id === ESRI_LAYER_ID);
  if (!layer?.source || !style.sources?.[layer.source]) return;
  if (!map.getSource(layer.source)) map.addSource(layer.source, { ...style.sources[layer.source] });
  if (map.getLayer(layer.id)) return;
  map.addLayer({
    ...layer,
    paint: {
      ...(layer.paint || {}),
      "raster-opacity": 0,
      "raster-opacity-transition": ZERO_TRANSITION,
    },
  }, beforeId ?? undefined);
}

function ensureDark(map, style, beforeId) {
  const source = style.sources?.[DARK_SOURCE_ID];
  if (source && !map.getSource(DARK_SOURCE_ID)) map.addSource(DARK_SOURCE_ID, { ...source });
  for (const layer of style.layers) {
    if (layer.source && layer.source !== DARK_SOURCE_ID) continue;
    if (map.getLayer(layer.id)) continue;
    map.addLayer({ ...layer }, beforeId);
  }
}

function removeGroupsExcept(map, keepId, styles) {
  const keep = physicalKind(keepId);
  if (keep !== "dark") removeGroup(map, "dark", styles);
  if (keep !== "osm") removeGroup(map, "osm", styles);
  if (keep !== "esri") removeGroup(map, "satellite", styles);
}

function removeGroup(map, basemapId, styles) {
  for (const id of [...groupLayerIds(basemapId, styles)].reverse()) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const sourceId of groupSourceIds(basemapId, styles)) {
    if (map.getSource(sourceId) && !sourceInUse(map, sourceId)) map.removeSource(sourceId);
  }
}

function firstOverlayId(map, styles) {
  const basemapIds = new Set([OSM_LAYER_ID, ESRI_LAYER_ID]);
  for (const layer of styles.dark.layers) basemapIds.add(layer.id);
  const overlay = map.getStyle().layers.find((layer) => !basemapIds.has(layer.id));
  return overlay?.id ?? null;
}

function groupLayerIds(basemapId, styles) {
  if (basemapId === "dark") return styles.dark.layers.map((layer) => layer.id);
  if (basemapId === "osm") return [OSM_LAYER_ID];
  return [ESRI_LAYER_ID];
}

function groupSourceIds(basemapId, styles) {
  if (basemapId === "dark") return Object.keys(styles.dark.sources || {});
  if (basemapId === "osm") return [OSM_SOURCE_ID];
  return [ESRI_SOURCE_ID];
}

function sourceInUse(map, sourceId) {
  return map.getStyle().layers.some((layer) => layer.source === sourceId);
}

function setRasterPaint(map, layerId, key, value, duration) {
  map.setPaintProperty(layerId, `${key}-transition`, { duration, delay: 0 });
  map.setPaintProperty(layerId, key, value);
}

function layerIdFor(basemapId) {
  if (basemapId === "osm") return OSM_LAYER_ID;
  if (basemapId === "satellite" || basemapId === "satellite_bw") return ESRI_LAYER_ID;
  return null;
}

function sourceIdFor(basemapId) {
  if (basemapId === "osm") return OSM_SOURCE_ID;
  if (basemapId === "dark") return DARK_SOURCE_ID;
  return ESRI_SOURCE_ID;
}

function physicalKind(basemapId) {
  if (basemapId === "satellite" || basemapId === "satellite_bw") return "esri";
  return basemapId;
}

function isSaturationChange(fromId, toId) {
  return physicalKind(fromId) === "esri" && physicalKind(toId) === "esri" && fromId !== toId;
}

function isCurrent(state, generation, attempt) {
  return state.generation === generation && !attempt.cancelled;
}

function createAttempt() {
  const disposers = [];
  return {
    cancelled: false,
    fading: false,
    add(dispose) {
      if (this.cancelled) {
        dispose();
        return;
      }
      disposers.push(dispose);
    },
    cancel() {
      if (this.cancelled) return;
      this.cancelled = true;
      while (disposers.length) disposers.pop()();
    },
  };
}

function isUsableMap(map) {
  return Boolean(
    map
    && typeof map.getLayer === "function"
    && typeof map.getStyle === "function"
    && typeof map.getSource === "function"
    && typeof map.addLayer === "function"
    && typeof map.removeLayer === "function"
    && typeof map.addSource === "function"
    && typeof map.removeSource === "function"
    && typeof map.moveLayer === "function"
    && typeof map.setPaintProperty === "function"
    && typeof map.getPaintProperty === "function"
    && typeof map.isSourceLoaded === "function"
    && typeof map.on === "function"
    && typeof map.off === "function",
  );
}

function isStyleSet(styles) {
  return Boolean(
    styles?.dark?.layers
    && styles.osm?.layers
    && styles.satellite?.layers
    && styles.satellite_bw?.layers,
  );
}
