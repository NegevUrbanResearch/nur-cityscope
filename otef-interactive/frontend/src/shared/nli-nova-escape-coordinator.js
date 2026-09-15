/**
 * Nova fleeing overlay coordinator for GIS and projection.
 * Remounts AcrossLine ribbons from exhibit GeoJSON; stagger is one-shot
 * and independent of the investigation clock.
 */

import {
  createAcrossLineRibbonLayer,
  revealDurationMs,
  staggerDelayMs,
  NOVA_RIBBON_DISPLAY_PROFILES,
} from "./maplibre-acrossline-ribbon.js";
import { DEFAULT_INVESTIGATION_SETTLEMENTS_URL } from "./nli-investigation-timeline-data.js";
import { NLI_DISPLAY_PROFILES } from "./nli-investigation-theme.js";
import {
  NOVA_ESCAPE_IMPACT_COLOR,
  NOVA_ESCAPE_IMPACT_LAYER_ID,
  buildFleeingCrossingIndex,
  escapeImpactOutlineIds,
  novaParallelImpactFeatureIds,
} from "./nli-nova-escape-impact.js";
import { setEscapeImpactOrientationIds } from "./maplibre-investigation-timeline.js";
import { resolveMotionMode } from "./reduced-motion.js";

export const NOVA_FLEEING_INDIVIDUAL_URL =
  "/otef-interactive/public/processed/layers/nli/fleeing_route.geojson";
export const NOVA_FLEEING_OVERLAP_URL =
  "/otef-interactive/public/processed/layers/nli/fleeing_route_overlapp.geojson";

export const NOVA_ESCAPE_INDIVIDUAL_LAYER_ID = "nli-nova-escape-individual";
export const NOVA_ESCAPE_OVERLAP_LAYER_ID = "nli-nova-escape-overlap";
export const NOVA_SITE_POLYGONS_URL =
  "/otef-interactive/public/processed/layers/nli/investigation_polygons.geojson";
export const NOVA_INVESTIGATION_LINES_URL =
  "/otef-interactive/public/processed/layers/nli/lines.geojson";

const EMPTY_OVERLAY = Object.freeze({ individual: false, overlap: false });

function globalRequestAnimationFrame() {
  const raf = globalThis.requestAnimationFrame;
  return typeof raf === "function" ? raf.bind(globalThis) : null;
}

function globalCancelAnimationFrame() {
  const cancel = globalThis.cancelAnimationFrame;
  return typeof cancel === "function" ? cancel.bind(globalThis) : null;
}

export function createNovaEscapeCoordinator({
  map,
  dataContext,
  profile,
  surface,
  onParallelImpactIdsChanged,
} = {}) {
  const resolvedProfile = NLI_DISPLAY_PROFILES[profile] ? profile : "gis";
  const ribbonsAllowed = surface === "projection";
  const notifyParallelImpact = surface === "projection" && typeof onParallelImpactIdsChanged === "function"
    ? onParallelImpactIdsChanged
    : null;
  let disposed = false;
  let generation = 0;
  let narrative = dataContext?.getNarrativeState?.() || null;
  let overlay = dataContext?.getEscapeOverlay?.() || EMPTY_OVERLAY;
  let individualData = null;
  let overlapData = null;
  let investigationPolygonFeatures = null;
  let investigationLineFeatures = null;
  let settlementsData = null;
  let settlementFeatures = [];
  let lastIndividualOn = false;
  let staggerOriginMs = null;
  let pendingRevealOriginReset = false;
  let revealOverride = null;
  let impactRaf = null;
  let coalescedSync = null;
  let parallelImpactIds = new Set();
  let crossingIndex = new Map();
  let crossingIndexRoutes = null;
  let crossingIndexPolygons = null;
  let crossingIndexLines = null;
  const inflight = new Map();

  const lineWidth = () => 1.8 * Number(
    NLI_DISPLAY_PROFILES[resolvedProfile]?.lineWidthMultiplier || 1,
  );

  const ribbonProfile = () => (
    NOVA_RIBBON_DISPLAY_PROFILES[resolvedProfile] || NOVA_RIBBON_DISPLAY_PROFILES.gis
  );

  const removeRibbonLayers = () => {
    removeLayerIfPresent(map, NOVA_ESCAPE_INDIVIDUAL_LAYER_ID);
    removeLayerIfPresent(map, NOVA_ESCAPE_OVERLAP_LAYER_ID);
  };

  const removeImpactLayer = () => {
    removeLayerIfPresent(map, NOVA_ESCAPE_IMPACT_LAYER_ID);
  };

  const scheduleRaf = (callback) => {
    if (typeof map?.requestAnimationFrame === "function") return map.requestAnimationFrame(callback);
    return globalRequestAnimationFrame()?.(callback);
  };

  const cancelRaf = (id) => {
    if (id == null) return;
    if (typeof map?.cancelAnimationFrame === "function") {
      try { map.cancelAnimationFrame(id); } catch { /* map may be gone */ }
      return;
    }
    try { globalCancelAnimationFrame()?.(id); } catch { /* map may be gone */ }
  };

  const cancelImpactRaf = () => {
    if (impactRaf == null) return;
    cancelRaf(impactRaf);
    impactRaf = null;
  };

  const collectionFeatures = (collection) => (
    Array.isArray(collection?.features) ? collection.features : []
  );

  const sameImpactSet = (previous, next) => (
    previous.size === next.size && [...next].every((id) => previous.has(id))
  );

  const emitParallelImpact = (ids, { asArray = false } = {}) => {
    if (!notifyParallelImpact) return;
    notifyParallelImpact(asArray ? [] : new Set(ids));
  };

  const clearParallelImpact = ({ disposeEmit = false } = {}) => {
    const hadIds = parallelImpactIds.size > 0;
    parallelImpactIds = new Set();
    crossingIndex = new Map();
    crossingIndexRoutes = null;
    crossingIndexPolygons = null;
    crossingIndexLines = null;
    if (disposeEmit) {
      emitParallelImpact([], { asArray: true });
      return;
    }
    if (hadIds) emitParallelImpact(parallelImpactIds);
  };

  const rebuildCrossingIndexIfNeeded = () => {
    const routes = individualData?.features || [];
    const polygons = collectionFeatures(investigationPolygonFeatures);
    const lines = collectionFeatures(investigationLineFeatures);
    if (
      crossingIndexRoutes === routes &&
      crossingIndexPolygons === polygons &&
      crossingIndexLines === lines
    ) return;
    crossingIndex = buildFleeingCrossingIndex(routes, [...polygons, ...lines]);
    crossingIndexRoutes = routes;
    crossingIndexPolygons = polygons;
    crossingIndexLines = lines;
  };

  const absorbParallelImpactIds = (next) => {
    if (!notifyParallelImpact) return;
    const grown = new Set(parallelImpactIds);
    for (const id of next) grown.add(id);
    if (sameImpactSet(parallelImpactIds, grown)) return;
    parallelImpactIds = grown;
    emitParallelImpact(parallelImpactIds);
  };

  const featureProgress = (feature, stagger) => {
    if (revealOverride != null) return clamp01(revealOverride);
    if (!stagger || resolveMotionMode() === "reduced") return 1;
    if (staggerOriginMs == null) return 0;
    const delay = staggerDelayMs(feature?.properties?.OBJECTID ?? 0);
    const duration = revealDurationMs(lineLengthMeters(feature));
    const elapsed = Date.now() - staggerOriginMs - delay;
    if (!Number.isFinite(duration) || duration <= 0) return 1;
    if (elapsed <= 0) return 0;
    return clamp01(elapsed / duration);
  };

  const noteRibbonDrawable = () => {
    if (!pendingRevealOriginReset) return false;
    pendingRevealOriginReset = false;
    staggerOriginMs = Date.now();
    return true;
  };

  const addRibbon = (id, collection, options) => {
    if (!map || typeof map.addLayer !== "function" || map.getLayer?.(id)) return;
    const layer = createAcrossLineRibbonLayer({
      id,
      profile: ribbonProfile(),
      onDrawable: options.stagger === true ? noteRibbonDrawable : undefined,
      getFrame: () => ({
        features: collection?.features || [],
        opacity: options.opacity,
        featureProgress: (feature) => featureProgress(feature, options.stagger === true),
      }),
    });
    map.addLayer(layer);
    map.triggerRepaint?.();
  };

  const addOwnedLineLayer = (id, paint, filter) => {
    if (!map || typeof map.addLayer !== "function" || map.getLayer?.(id)) return;
    if (!map.getSource?.(id) && typeof map.addSource === "function") {
      map.addSource(id, { type: "geojson", data: emptyCollection() });
    }
    map.addLayer({
      id,
      type: "line",
      source: id,
      ...(filter ? { filter } : {}),
      layout: { "line-cap": "round", "line-join": "round" },
      paint,
    });
  };

  const mountImpactOutline = () => {
    addOwnedLineLayer(NOVA_ESCAPE_IMPACT_LAYER_ID, {
      "line-color": NOVA_ESCAPE_IMPACT_COLOR,
      "line-opacity": 0.95,
      "line-width": lineWidth(),
    });
  };

  const setEscapeImpactIds = (ids) => {
    const outlineIds = [...(ids instanceof Set ? ids : Array.isArray(ids) ? ids : [])]
      .map((id) => String(id))
      .filter((id) => id && id !== "100");
    const source = map?.getSource?.(NOVA_ESCAPE_IMPACT_LAYER_ID);
    if (source && typeof source.setData === "function") {
      const features = outlineIds.map((id) => {
        const found = settlementFeatures.find((feature) => (
          String(feature?.properties?.outlineObjectId ?? feature?.properties?.OBJECTID ?? feature?.id) === id
        ));
        return found || {
          type: "Feature",
          properties: { outlineObjectId: id, OBJECTID: Number(id) },
          geometry: { type: "Polygon", coordinates: [] },
        };
      });
      source.setData({ type: "FeatureCollection", features });
    }
    setEscapeImpactOrientationIds(map, outlineIds, settlementFeatures);
  };

  const refreshImpactFromProgress = () => {
    if (!individualData || overlay?.individual !== true) return;
    const progressByObjectId = {};
    for (const feature of individualData.features || []) {
      const id = feature?.properties?.OBJECTID ?? feature?.id;
      if (id == null) continue;
      progressByObjectId[String(id)] = featureProgress(feature, true);
    }
    rebuildCrossingIndexIfNeeded();
    absorbParallelImpactIds(novaParallelImpactFeatureIds({
      progressByObjectId,
      crossingIndex,
    }));
    setEscapeImpactIds(escapeImpactOutlineIds({
      routes: individualData.features,
      settlements: settlementFeatures,
      progressByObjectId,
    }));
  };

  const runImpactTick = () => {
    impactRaf = null;
    if (disposed || narrative?.id !== "nova" || overlay?.individual !== true) return;
    refreshImpactFromProgress();
    const pending = (individualData?.features || []).some((feature) => featureProgress(feature, true) < 1);
    if (!pending) return;
    const raf = scheduleRaf(runImpactTick);
    if (raf == null) return;
    map?.triggerRepaint?.();
    impactRaf = raf;
  };

  const scheduleImpactTick = () => {
    cancelImpactRaf();
    if (disposed || narrative?.id !== "nova" || overlay?.individual !== true) return;
    const raf = scheduleRaf(runImpactTick);
    if (raf == null) {
      refreshImpactFromProgress();
      return;
    }
    map?.triggerRepaint?.();
    impactRaf = raf;
  };

  const updateStagger = (individualOn) => {
    if (!individualOn) {
      lastIndividualOn = false;
      staggerOriginMs = null;
      pendingRevealOriginReset = false;
      return;
    }
    if (resolveMotionMode() === "reduced") {
      staggerOriginMs = null;
      pendingRevealOriginReset = false;
      lastIndividualOn = true;
      return;
    }
    if (!lastIndividualOn) {
      staggerOriginMs = null;
      pendingRevealOriginReset = true;
    }
    lastIndividualOn = true;
  };

  async function remount({ styleLoss = false } = {}) {
    const token = ++generation;
    cancelImpactRaf();
    removeRibbonLayers();
    if (disposed) return;
    const active = narrative?.id === "nova";
    const flags = overlay || EMPTY_OVERLAY;
    if (!active) {
      updateStagger(false);
      removeImpactLayer();
      setEscapeImpactOrientationIds(map, []);
      clearParallelImpact();
      return;
    }
    if (!ribbonsAllowed) {
      const loadedSite = await loadCollection(
        NOVA_SITE_POLYGONS_URL,
        investigationPolygonFeatures,
        inflight,
      );
      if (loadedSite) investigationPolygonFeatures = loadedSite;
      if (disposed || token !== generation) return;
      removeRibbonLayers();
      removeImpactLayer();
      if (!styleLoss) updateStagger(false);
      setEscapeImpactOrientationIds(map, []);
      return;
    }
    if (!flags.individual) {
      updateStagger(false);
      setEscapeImpactOrientationIds(map, []);
      clearParallelImpact();
    }
    const [loadedSite, loadedIndividual, loadedSettlements, loadedOverlap, loadedLines] = await Promise.all([
      loadCollection(NOVA_SITE_POLYGONS_URL, investigationPolygonFeatures, inflight),
      loadCollection(NOVA_FLEEING_INDIVIDUAL_URL, individualData, inflight),
      flags.individual
        ? loadCollection(DEFAULT_INVESTIGATION_SETTLEMENTS_URL, settlementsData, inflight)
        : null,
      loadCollection(NOVA_FLEEING_OVERLAP_URL, overlapData, inflight),
      loadCollection(NOVA_INVESTIGATION_LINES_URL, investigationLineFeatures, inflight),
    ]);
    if (loadedSite) investigationPolygonFeatures = loadedSite;
    if (loadedIndividual) individualData = loadedIndividual;
    if (loadedSettlements) {
      settlementsData = loadedSettlements;
      settlementFeatures = loadedSettlements.features || [];
    }
    if (loadedOverlap) overlapData = loadedOverlap;
    if (loadedLines) investigationLineFeatures = loadedLines;
    if (disposed || token !== generation) return;
    removeRibbonLayers();
    removeImpactLayer();
    const preserveStagger = styleLoss && flags.individual === true && staggerOriginMs != null;
    if (!flags.individual) {
      updateStagger(false);
    } else if (!preserveStagger && individualData) {
      updateStagger(true);
    }
    if (flags.individual && individualData) {
      addRibbon(NOVA_ESCAPE_INDIVIDUAL_LAYER_ID, individualData, { opacity: 0.6, stagger: true });
      mountImpactOutline();
      scheduleImpactTick();
    } else {
      setEscapeImpactOrientationIds(map, []);
      clearParallelImpact();
    }
    if (flags.overlap && overlapData) {
      addRibbon(NOVA_ESCAPE_OVERLAP_LAYER_ID, overlapData, { opacity: 1, stagger: false });
    }
  }

  function sync(nextNarrative, nextOverlay) {
    if (disposed) return Promise.resolve();
    if (arguments.length >= 1 && nextNarrative !== undefined) narrative = nextNarrative;
    if (arguments.length >= 2 && nextOverlay !== undefined) overlay = nextOverlay || EMPTY_OVERLAY;
    return remount();
  }

  function notifySync(nextNarrative, nextOverlay) {
    if (disposed) return Promise.resolve();
    if (arguments.length >= 1 && nextNarrative !== undefined) narrative = nextNarrative;
    if (arguments.length >= 2 && nextOverlay !== undefined) overlay = nextOverlay || EMPTY_OVERLAY;
    if (coalescedSync) return coalescedSync;
    coalescedSync = Promise.resolve().then(() => {
      coalescedSync = null;
      if (disposed) return undefined;
      return remount();
    });
    return coalescedSync;
  }

  const unsubN = dataContext?.subscribe?.("narrativeState", (state) => {
    void notifySync(state ?? dataContext.getNarrativeState?.(), dataContext.getEscapeOverlay?.());
  });
  const unsubO = dataContext?.subscribe?.("escapeOverlay", (next) => {
    void notifySync(dataContext.getNarrativeState?.(), next ?? dataContext.getEscapeOverlay?.());
  });
  void remount();

  return {
    sync,
    onStyleLoad({ styleLoss = false } = {}) {
      return remount({ styleLoss });
    },
    setEscapeImpactIds,
    setRevealProgress(value) {
      revealOverride = value;
      refreshImpactFromProgress();
      map?.triggerRepaint?.();
    },
    debugFeatureProgress(feature) {
      return featureProgress(feature, true);
    },
    debugNoteRibbonDrawable() {
      noteRibbonDrawable();
    },
    debugOverlapFeatures() {
      return overlapData?.features || [];
    },
    debugParallelImpactIds() {
      return new Set(parallelImpactIds);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      cancelImpactRaf();
      unsubN?.();
      unsubO?.();
      removeRibbonLayers();
      removeImpactLayer();
      setEscapeImpactOrientationIds(map, []);
      clearParallelImpact({ disposeEmit: true });
    },
  };
}

function emptyCollection() {
  return { type: "FeatureCollection", features: [] };
}

function removeLayerIfPresent(map, id) {
  if (map?.getLayer?.(id)) map.removeLayer(id);
  if (map?.getSource?.(id)) map.removeSource(id);
}

async function loadCollection(url, cached, inflight) {
  if (cached) return cached;
  const pending = inflight.get(url);
  if (pending) return pending;
  const request = fetchSuccessfulCollection(url).finally(() => {
    inflight.delete(url);
  });
  inflight.set(url, request);
  return request;
}

async function fetchSuccessfulCollection(url) {
  try {
    const response = await fetch(url);
    if (!response?.ok) return null;
    const data = await response.json();
    if (data?.type === "FeatureCollection" && Array.isArray(data.features)) return data;
  } catch {
    /* exhibit fetch can fail; retry on the next remount instead of caching empty */
  }
  return null;
}

function lineLengthMeters(feature) {
  const geometry = feature?.geometry;
  const parts = geometry?.type === "MultiLineString"
    ? geometry.coordinates
    : [geometry?.coordinates];
  let total = 0;
  for (const line of parts) {
    if (!Array.isArray(line) || line.length < 2) continue;
    for (let i = 1; i < line.length; i += 1) {
      if (!isCoord(line[i - 1]) || !isCoord(line[i])) continue;
      total += haversineMeters(line[i - 1], line[i]);
    }
  }
  return total;
}

function isCoord(value) {
  return Array.isArray(value) && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]));
}

function haversineMeters(a, b) {
  const radius = 6371000;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const lat1 = toRad(Number(a[1]));
  const lat2 = toRad(Number(b[1]));
  const dLat = lat2 - lat1;
  const dLng = toRad(Number(b[0]) - Number(a[0]));
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}
