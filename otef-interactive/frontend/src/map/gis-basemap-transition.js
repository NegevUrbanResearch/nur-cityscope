import { opacityChannelsForLayerType } from "../shared/layer-opacity-expression.js";
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

export function getDisplayedGisBasemap(map, styles) { return states.get(map)?.completedId || inferCompletedId(map, styles); }

/** Transfer a completed manual group to an idle scene owner without remounting. */
export function adoptDisplayedGisBasemap(map, basemapId, { styles, runtime } = {}) {
  const state = states.get(map);
  if (!state || state.pendingId != null || state.preparedBasemap || state.completedId !== basemapId ||
      !runtime || runtime.isDisposed() || runtime.getPendingBatch() || runtime.getRenderedReadiness().moving ||
      !physicalGroupMatches(map, state.completedPhysical) || !map.isSourceLoaded(sourceIdFor(basemapId))) return false;
  const fullId = `nli.basemap.${physicalKind(basemapId)}`;
  const desired = runtime.getDesiredIds().filter(id => !id.startsWith("nli.basemap."));
  for (const id of runtime.getDesiredIds().filter(id => id.startsWith("nli.basemap."))) runtime.dropChannels(id);
  registerManagedGroup(map, state, basemapId, styles, runtime, true);
  runtime.setDesiredIds([...desired, fullId], { durationMs: 0, requiredIds: [fullId] });
  runtime.markMemberReady(fullId); runtime.commitBatch();
  return true;
}

/** Keep one completed handoff while an existing lifecycle frame is still moving.
 * No new frame is scheduled. The next idle rendered boundary consumes it once;
 * the callback still owns the current-intent/binding eligibility checks.
 */
export function deferDisplayedGisBasemapAdoption(map, basemapId, { runtime, onReady } = {}) {
  const state = states.get(map);
  if (!state || state.pendingId != null || state.preparedBasemap || state.completedId !== basemapId ||
      !runtime || runtime.isDisposed() || typeof onReady !== "function" ||
      !physicalGroupMatches(map, state.completedPhysical) ||
      !(runtime.getPendingBatch() || runtime.getRenderedReadiness().moving)) return false;
  state.cancelAdoption?.();
  const generation = state.generation, physical = state.completedPhysical, style = map.style;
  const cancel = () => {
    map.off("render", onRender);
    if (state.cancelAdoption === cancel) state.cancelAdoption = null;
  };
  const onRender = () => {
    if (states.get(map) !== state || state.generation !== generation || state.completedPhysical !== physical ||
        map.style !== style || runtime.isDisposed() || !physicalGroupMatches(map, physical)) { cancel(); return; }
    if (runtime.getPendingBatch() || runtime.getRenderedReadiness().moving) return;
    cancel(); onReady();
  };
  state.cancelAdoption = cancel;
  map.on("render", onRender);
  return true;
}

function capturePhysicalGroup(map, basemapId, styles) {
  return { basemapId,
    layers: new Map(groupLayerIds(basemapId, styles).filter(id => map.getLayer(id)).map(id => [id, map.getLayer(id)])),
    sources: new Map(groupSourceIds(basemapId, styles).filter(id => map.getSource(id)).map(id => [id, map.getSource(id)])),
  };
}

function physicalGroupMatches(map, group) {
  return !!group && group.layers.size > 0 && group.sources.has(sourceIdFor(group.basemapId)) &&
    [...group.layers].every(([id, layer]) => map.getLayer(id) === layer) &&
    [...group.sources].every(([id, source]) => map.getSource(id) === source);
}

function cleanupManagedGroup(map, fullId, runtime) {
  const state = states.get(map), owner = state?.managedOwners.get(fullId);
  if (!owner || owner.runtime !== runtime || runtime.getDesiredIds().includes(fullId) ||
      (state.preparedBasemap?.fullId === fullId || state.preparedBasemap?.retainedFullId === fullId) || !physicalGroupMatches(map, owner.physical)) return;
  state.managedOwners.delete(fullId);
  removeGroup(map, owner.physical.basemapId, owner.styles);
}

function managedLayerDefinition(definition) {
  const layer = { ...definition, paint: { ...(definition.paint || {}) } };
  for (const property of opacityChannelsForLayerType(layer.type)) layer.paint[property] ??= 1;
  if (layer.type === "raster") layer.paint["raster-opacity-transition"] = ZERO_TRANSITION;
  return layer;
}

function registerManagedGroup(map, state, basemapId, styles, runtime, adoptVisible) {
  const fullId = `nli.basemap.${physicalKind(basemapId)}`;
  const physical = capturePhysicalGroup(map, basemapId, styles);
  if (!physicalGroupMatches(map, physical)) return false;
  state.managedOwners.set(fullId, { physical, styles, runtime });
  // Raster dissolves reveal the opaque dark map beneath them. Scaling that
  // underlay as well exposes the browser's white clear color between scenes.
  if (basemapId === "dark") {
    runtime.dropChannels(fullId);
    state.darkOpacityTarget ||= () => {};
    runtime.registerOpacityTarget(fullId, state.darkOpacityTarget, {
      adoptVisible, onTeardown: () => cleanupManagedGroup(map, fullId, runtime),
    });
    return true;
  }
  const fullyVisible = styles[basemapId].layers.every(layer => opacityChannelsForLayerType(layer.type).every(property =>
    JSON.stringify(map.getPaintProperty(layer.id, property) ?? 1) === JSON.stringify(layer.paint?.[property] ?? 1)));
  for (const definition of styles[basemapId].layers.filter(layer => map.getLayer(layer.id))) runtime.stageMapLayer(fullId, managedLayerDefinition(definition), {
    adoptVisible: adoptVisible && fullyVisible, onTeardown: () => cleanupManagedGroup(map, fullId, runtime),
  });
  return true;
}

export function transitionGisBasemap(map, basemapId, options = {}) {
  const styles = options.styles;
  const onSettled = options.onSettled;
  if (options.managedScene) return prepareManagedBasemap(map, basemapId, options);
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

/** Managed callers stage a candidate, then mount it inside the owner's batch.
 * The existing tile deadline bounds preparation. Only the lifecycle writes scene
 * opacity; cancellation discards candidate-owned sources, never the retained base.
 */
function prepareManagedBasemap(map, basemapId, { styles, managedScene: { runtime, signal } }) {
  if (!isUsableMap(map) || !isGisBasemapId(basemapId) || !isStyleSet(styles)) return Promise.reject(new Error("Invalid managed basemap"));
  const state = ensureState(map, styles);
  if (!state) return Promise.reject(new Error("Missing displayed basemap"));
  state.cancelAdoption?.();
  state.cancelAttempt?.(); state.generation += 1;
  registerManagedGroup(map, state, state.completedId, styles, runtime, true);
  const generation = state.generation;
  const attempt = createAttempt();
  state.cancelAttempt = () => attempt.cancel();
  const fullId = `nli.basemap.${physicalKind(basemapId)}`;
  const oldKind = physicalKind(state.completedId);
  const samePhysical = oldKind === physicalKind(basemapId);
  const ownedSources = new Map();
  const ownedLayers = new Map();
  const existingLayers = styles[basemapId].layers.filter(layer => map.getLayer(layer.id));
  const adoptedVisible = samePhysical && existingLayers.length > 0 && existingLayers.every(layer =>
    opacityChannelsForLayerType(layer.type).every(property =>
      JSON.stringify(map.getPaintProperty(layer.id, property) ?? 1) === JSON.stringify(layer.paint?.[property] ?? 1)));
  let cancelPrepared = () => attempt.cancel();
  state.cancelAttempt = () => cancelPrepared();
  let mounted = false;
  let readiness = false;
  const current = () => !signal?.aborted && state.generation === generation && !attempt.cancelled;
  const definitions = styles[basemapId].layers;
  const sourceHandles = new Map();
  const protection = { fullId, generation, sourceHandles,
    retainedFullId: oldKind === "dark" && !samePhysical ? "nli.basemap.dark" : null };
  state.preparedBasemap = protection;
  const releaseProtection = () => { if (state.preparedBasemap === protection) state.preparedBasemap = null; };
  const physicalLayersPresent = () => definitions.every(layer => map.getLayer(layer.id) &&
    (!layer.source || map.getLayer(layer.id).source === layer.source && map.getSource(layer.source) && map.getSource(layer.source) === sourceHandles.get(layer.source)));
  function removeOwned() {
    for (const [layerId, handle] of [...ownedLayers].reverse()) {
      if (map.getLayer(layerId) === handle) map.removeLayer(layerId);
    }
    ownedLayers.clear();
    for (const [sourceId, source] of ownedSources) {
      if (map.getSource(sourceId) !== source) continue;
      for (const layer of [...definitions].reverse()) if (layer.source === sourceId && map.getLayer(layer.id)) map.removeLayer(layer.id);
      if (!sourceInUse(map, sourceId)) map.removeSource(sourceId);
    }
    ownedSources.clear();
  }
  function stage(adopt = false) {
    const ground = styles.dark.layers.find(layer => layer.type === "background");
    if (ground && !map.getLayer(ground.id)) map.addLayer(ground, map.getStyle().layers[0]?.id);
    const boundary = basemapId === "dark" ? layerIdFor(state.completedId) || firstOverlayId(map, styles) : firstOverlayId(map, styles);
    for (const [sourceId, source] of Object.entries(styles[basemapId].sources || {})) {
      if (sourceHandles.has(sourceId) && map.getSource(sourceId) !== sourceHandles.get(sourceId)) throw new Error("Managed basemap source changed");
      if (!map.getSource(sourceId)) { map.addSource(sourceId, { ...source }); ownedSources.set(sourceId, map.getSource(sourceId)); }
      sourceHandles.set(sourceId, map.getSource(sourceId));
    }
    for (const definition of definitions) {
      if (definition.source && !map.getSource(definition.source)) continue;
      const layer = managedLayerDefinition(definition);
      const staged = basemapId === "dark" ? { stagedLayerDef: layer } : runtime.stageMapLayer(fullId, layer, { adoptVisible: adopt && adoptedVisible,
        onTeardown: () => cleanupManagedGroup(map, fullId, runtime),
      });
      if (!map.getLayer(layer.id)) { map.addLayer(staged.stagedLayerDef, boundary ?? undefined); if (map.getLayer(layer.id)) ownedLayers.set(layer.id, map.getLayer(layer.id)); }
    }
    if (!physicalLayersPresent()) throw new Error("Managed basemap layer missing");
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = reason => {
      releaseProtection();
      if (settled) {
        if (!current()) return;
        readiness = false;
        if (mounted) runtime.markMemberFailed(fullId);
        else { attempt.cancel(); removeOwned(); }
        return;
      }
      settled = true; attempt.cancel(); removeOwned(); reject(new Error(`Managed basemap ${reason}`));
    };
    cancelPrepared = () => { if (!settled) fail("cancelled"); else { releaseProtection(); candidate.discard(); attempt.cancel(); } };
    const candidate = {
      basemapId, fullId,
      replaceIds: samePhysical && basemapId !== state.completedId ? [fullId] : [],
      complete() {
        if (current() && mounted && physicalLayersPresent()) {
          if (oldKind === "dark" && !samePhysical) {
            state.managedOwners.delete("nli.basemap.dark");
            for (const layer of [...styles.dark.layers].reverse()) if (layer.type !== "background" && map.getLayer(layer.id)) map.removeLayer(layer.id);
            for (const id of groupSourceIds("dark", styles)) if (map.getSource(id) && !sourceInUse(map, id)) map.removeSource(id);
          }
          releaseProtection(); state.completedId = basemapId; state.pendingId = null;
          state.completedPhysical = capturePhysicalGroup(map, basemapId, styles);
        }
      },
      mount() {
        if (!current()) throw new Error("Managed basemap cancelled");
        // Shared ESRI saturation changes occur only after the owner's common exit.
        try { stage(); } catch (error) { fail("layer-missing"); throw error; }
        if (!readiness || !map.isSourceLoaded(sourceIdFor(basemapId))) {
          fail("source-unready"); throw new Error("Managed basemap source unready");
        }
        mounted = true;
        registerManagedGroup(map, state, basemapId, styles, runtime, false);
        if (physicalKind(basemapId) === "esri") setRasterPaint(map, ESRI_LAYER_ID, "raster-saturation", basemapId === "satellite_bw" ? -1 : 0, 0);
        runtime.subscribeMemberReady(fullId, ({ ready, failed }) => {
          const error = event => { if (current() && (event?.sourceId || event?.error?.sourceId) === sourceIdFor(basemapId) && !event.tile) failed(); };
          map.on("error", error);
          if (readiness && current() && physicalLayersPresent() && map.isSourceLoaded(sourceIdFor(basemapId))) ready();
          else failed();
          return () => map.off("error", error);
        });
        // Completion is accepted only while this physical resource still belongs
        // to the current request. The runtime owns reveal and zero cleanup.

      },
      discard() { releaseProtection(); if (!mounted) { attempt.cancel(); removeOwned(); } },
    };
    const abort = () => { if (!settled) fail("cancelled"); else candidate.discard(); };
    signal?.addEventListener("abort", abort, { once: true });
    attempt.add(() => signal?.removeEventListener("abort", abort));
    if (signal?.aborted) { fail("cancelled"); return; }
    try { stage(true); } catch { fail("layer-missing"); return; }
    const sourceId = sourceIdFor(basemapId);
    const waiter = waitForReady(map, sourceId, {
      onReady() { if (!current()) return; if (!physicalLayersPresent()) { fail("layer-missing"); return; } readiness = true; settled = true; resolve(candidate); },
      onFail: fail,
    });
    attempt.add(() => waiter.cancel());
    if (samePhysical || hasDrawableCachedTiles(map, sourceId)) waiter.noteLoaded();
  });
}

function beginTransition(map, state, basemapId, styles, onSettled) {
  state.cancelAdoption?.();
  for (const [fullId, owner] of state.managedOwners) owner.runtime.dropChannels(fullId);
  state.managedOwners.clear();
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
  attempt.physical = capturePhysicalGroup(map, targetId, styles);
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
  let failureReason = null;

  const handle = waitForReady(map, sourceId, {
    onReady() {
      if (!isCurrent(state, generation, attempt)) return;
      if (!opened) {
        queued = "ready";
        return;
      }
      beginFade();
    },
    onFail(reason) {
      if (!isCurrent(state, generation, attempt)) return;
      failureReason = reason;
      if (!opened) {
        queued = "fail";
        return;
      }
      finishFailure(map, state, generation, styles, onSettled, attempt, reason);
    },
  });
  attempt.add(() => handle.cancel());

  const knownReady = Boolean(map.getSource(sourceId) && map.isSourceLoaded(sourceId)
    && hasDrawableCachedTiles(map, sourceId));
  if (reveal) {
    ensureDark(map, styles.dark, layerIdFor(state.completedId));
  } else {
    const boundary = firstOverlayId(map, styles);
    compactGroup(map, state.completedId, styles, boundary);
    ensureRaster(map, styles[targetId], boundary);
  }
  opened = true;
  attempt.physical = capturePhysicalGroup(map, targetId, styles);

  if (queued === "fail") {
    finishFailure(map, state, generation, styles, onSettled, attempt, failureReason);
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
  if (!physicalGroupMatches(map, attempt.physical)) {
    finishFailure(map, state, generation, styles, onSettled, attempt, "physical-group-changed");
    return;
  }
  if (sourceId && !map.getSource(sourceId)) {
    finishFailure(map, state, generation, styles, onSettled, attempt, "source-removed");
    return;
  }

  const previousId = state.completedId;
  state.generation += 1;
  attempt.cancel();
  if (physicalKind(previousId) !== physicalKind(nextId)) {
    removeGroup(map, previousId, styles);
  }
  state.completedId = nextId;
  state.completedPhysical = capturePhysicalGroup(map, nextId, styles);
  state.pendingId = null;
  onSettled?.({ status: "completed", basemapId: nextId });
}

function finishFailure(map, state, generation, styles, onSettled, attempt, reason) {
  if (!isCurrent(state, generation, attempt)) return;
  state.generation += 1;
  attempt.cancel();
  state.pendingId = null;
  if (physicalGroupMatches(map, state.completedPhysical)) restoreRetainedRaster(map, state);
  // A same-ID replacement belongs to another physical owner, even if an old
  // tile/render callback arrives for its ID. Never remove it as our candidate.
  if (!attempt.physical || physicalGroupMatches(map, attempt.physical)) removeGroupsExcept(map, state.completedId, styles);
  onSettled?.({ status: "failed", basemapId: state.completedId, reason });
}

function waitForReady(map, sourceId, { onReady, onFail }) {
  let readinessSettled = false;
  let closed = false;
  let success = false;
  let tileFailureSeen = false;

  const onSourceData = (event) => {
    if (closed || readinessSettled || event?.sourceId !== sourceId) return;
    const kind = event.sourceDataType;
    if (kind === "metadata" || kind === "visibility") return;
    // MapLibre 5.24 tile events carry `tile` and omit sourceDataType.
    // Content/idle events without a tile are not success evidence.
    if (event.tile && (kind == null || kind === "content")) {
      if (event.tile.state === "errored" || event.error) {
        tileFailureSeen = true;
        tryReady();
        return;
      }
      if (event.tile.state !== "loaded" || event.tile.aborted) return;
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
    if (event?.error?.name === "AbortError" || event?.tile?.aborted) {
      tryReady();
      return;
    }
    // A tile failure is not a source-wide failure. Other viewport tiles can
    // supply imagery, and errored tiles count as settled in MapLibre.
    if (!event.tile) {
      fail("source-error");
    } else if (!readinessSettled) {
      tileFailureSeen = true;
      tryReady();
    }
  };

  const timer = setTimeout(() => {
    tryReady();
    if (!readinessSettled) fail(tileFailureSeen && !success ? "tiles-unavailable" : "source-timeout");
  }, GIS_BASEMAP_SOURCE_WAIT_MS);

  function tryReady() {
    if (closed || readinessSettled) return;
    if (success && map.getSource(sourceId) && map.isSourceLoaded(sourceId)) ready();
  }

  function stopReadinessWatch() {
    clearTimeout(timer);
    map.off("sourcedata", onSourceData);
    map.off("render", tryReady);
  }

  function ready() {
    if (closed || readinessSettled) return;
    readinessSettled = true;
    stopReadinessWatch();
    onReady();
  }

  function fail(reason) {
    if (closed) return;
    closed = true;
    stopReadinessWatch();
    map.off("error", onError);
    onFail(reason);
  }

  map.on("sourcedata", onSourceData);
  map.on("error", onError);
  // Camera movement can remove the last pending tile without another data
  // event. Render runs after MapLibre updates the source tile set.
  map.on("render", tryReady);
  tryReady();

  return {
    cancel() {
      if (closed) return;
      closed = true;
      readinessSettled = true;
      stopReadinessWatch();
      map.off("error", onError);
    },
    retainErrorWatch() {
      if (closed) return;
      readinessSettled = true;
      stopReadinessWatch();
    },
    noteLoaded() {
      success = true;
      tryReady();
    },
  };
}

function hasDrawableCachedTiles(map, sourceId) {
  // MapLibre 5.24 reports errored/unused sources as loaded too. For a reused
  // source, its renderable tile cache must also contain drawable imagery.
  return (map.style?.tileManagers?.[sourceId]?.getRenderableIds?.()?.length || 0) > 0;
}

function ensureState(map, styles) {
  const existing = states.get(map);
  if (existing) return existing;

  const completedId = inferCompletedId(map, styles);
  if (!completedId) return null;

  const state = {
    completedId,
    completedPhysical: capturePhysicalGroup(map, completedId, styles),
    managedOwners: new Map(),
    pendingId: null,
    generation: 0,
    cancelAttempt: null,
  };
  const onRemove = () => {
    state.cancelAdoption?.();
    state.generation += 1;
    state.pendingId = null;
    const cancel = state.cancelAttempt;
    state.cancelAttempt = null;
    cancel?.();
    map.off("style.load", onStyle);
    map.off("remove", onRemove);
    states.delete(map);
  };
  const onStyle = () => {
    state.cancelAdoption?.();
    state.generation += 1; state.cancelAttempt?.(); state.cancelAttempt = null;
    states.delete(map); map.off("style.load", onStyle); map.off("remove", onRemove);
  };
  map.on("style.load", onStyle);
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
