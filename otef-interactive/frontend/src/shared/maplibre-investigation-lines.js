/**
 * Shared MapLibre renderer for the NLI investigation routes.
 *
 * The coordinator owns the clock and partitions route features by narrative
 * state. This module owns only route sources, route layers, geometry
 * orientation, and the small amount of paint/data reconciliation required by
 * each frame.
 */

import { NLI_DISPLAY_PROFILES, NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";
import { TIMELINE_BEAT_MS } from "./nli-investigation-beats.js";
import {
  buildLinePathMetrics,
  buildLineProgressGradient,
  pointAtLineProgress,
} from "./maplibre-line-progress-primitives.js";

export const INVESTIGATION_LINE_SOURCE_IDS = Object.freeze({
  future: "nli-investigation-line-future",
  completedCarrier: "nli-investigation-line-completed-carrier",
  completedMotion: "nli-investigation-line-completed-motion",
  active: "nli-investigation-line-active",
  head: "nli-investigation-line-head",
});

export const INVESTIGATION_LINE_LAYER_IDS = Object.freeze({
  future: "nli-investigation-line-future-line",
  completedCarrier: "nli-investigation-line-completed-carrier-line",
  completedMotion: "nli-investigation-line-completed-motion-line",
  active: "nli-investigation-line-active-line",
  head: "nli-investigation-line-head-circle",
});

// Keep the old active/head IDs as aliases for existing MapLibre consumers.
export const LINE_ACTIVE_SOURCE_ID = INVESTIGATION_LINE_SOURCE_IDS.active;
export const LINE_ACTIVE_LAYER_ID = INVESTIGATION_LINE_LAYER_IDS.active;
export const LINE_HEAD_SOURCE_ID = INVESTIGATION_LINE_SOURCE_IDS.head;
export const LINE_HEAD_LAYER_ID = INVESTIGATION_LINE_LAYER_IDS.head;

const OWNED = Object.freeze([
  [INVESTIGATION_LINE_LAYER_IDS.head, INVESTIGATION_LINE_SOURCE_IDS.head],
  [INVESTIGATION_LINE_LAYER_IDS.active, INVESTIGATION_LINE_SOURCE_IDS.active],
  [INVESTIGATION_LINE_LAYER_IDS.completedMotion, INVESTIGATION_LINE_SOURCE_IDS.completedMotion],
  [INVESTIGATION_LINE_LAYER_IDS.completedCarrier, INVESTIGATION_LINE_SOURCE_IDS.completedCarrier],
  [INVESTIGATION_LINE_LAYER_IDS.future, INVESTIGATION_LINE_SOURCE_IDS.future],
]);

const OVERLAY = new Set([
  INVESTIGATION_LINE_LAYER_IDS.head,
  INVESTIGATION_LINE_LAYER_IDS.active,
  INVESTIGATION_LINE_LAYER_IDS.completedMotion,
  INVESTIGATION_LINE_LAYER_IDS.completedCarrier,
]);

const FUTURE_OPACITY = 0.24;
const COMPLETED_OPACITY = 1;
const ACTIVE_OPACITY = 1;
const HEAD_RADIUS = 3.2;
const HEAD_HIDE_AT = 0.999;

export function orientLineCoordinatesTowardIsrael(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return coords;
  const start = coords[0];
  const end = coords[coords.length - 1];
  if (!Array.isArray(start) || !Array.isArray(end) || !(end[0] < start[0])) return coords;
  return [...coords].reverse();
}

function finiteCoordinate(coord) {
  return Array.isArray(coord) && Number.isFinite(Number(coord[0])) && Number.isFinite(Number(coord[1]));
}

function validLineCoordinates(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  if (geometry.type === "LineString") return geometry.coordinates.filter(finiteCoordinate);
  if (geometry.type === "MultiLineString") {
    return geometry.coordinates
      .filter((part) => Array.isArray(part))
      .map((part) => part.filter(finiteCoordinate))
      .filter((part) => part.length > 1);
  }
  return [];
}

function reverseGeometry(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return geometry;
  if (geometry.type === "LineString") {
    return { ...geometry, coordinates: [...geometry.coordinates].reverse() };
  }
  if (geometry.type === "MultiLineString") {
    return {
      ...geometry,
      coordinates: [...geometry.coordinates]
        .reverse()
        .map((part) => (Array.isArray(part) ? [...part].reverse() : part)),
    };
  }
  return geometry;
}

/** Orient one route according to its reviewed direction metadata. */
export function orientInvestigationLineFeature(feature) {
  if (!feature || typeof feature !== "object") return feature;
  if (feature?.properties?.flow_direction !== "reverse") return feature;
  return { ...feature, geometry: reverseGeometry(feature.geometry) };
}

function featureId(feature, index) {
  const value = feature?.properties?.OBJECTID ?? feature?.id;
  return value == null ? `route-${index}` : String(value);
}

function normalizeFeature(feature, index) {
  const oriented = orientInvestigationLineFeature(feature);
  if (!oriented || typeof oriented !== "object") return null;
  return {
    type: "Feature",
    id: featureId(oriented, index),
    properties: oriented.properties && typeof oriented.properties === "object" ? oriented.properties : {},
    geometry: oriented.geometry || null,
  };
}

function normalizeFeatures(features) {
  return (Array.isArray(features) ? features : [])
    .map(normalizeFeature)
    .filter((feature) => feature?.geometry && validLineCoordinates(feature.geometry).length > 0);
}

function featureCollection(features) {
  return { type: "FeatureCollection", features: normalizeFeatures(features) };
}

function pointsFeatureCollection(points) {
  return {
    type: "FeatureCollection",
    features: (Array.isArray(points) ? points : [])
      .filter(finiteCoordinate)
      .map((coordinates, index) => ({ type: "Feature", id: `head-${index}`, properties: {}, geometry: { type: "Point", coordinates } })),
  };
}

function lineCoordinates(feature) {
  const coordinates = validLineCoordinates(feature?.geometry);
  if (feature?.geometry?.type === "MultiLineString") {
    return coordinates.reduce((best, part) => {
      if (best.length === 0) return part;
      return buildLinePathMetrics(part).total > buildLinePathMetrics(best).total ? part : best;
    }, []);
  }
  return coordinates;
}

function legacyLineCoordinates(feature) {
  const geometry = feature?.geometry;
  const parts = geometry?.type === "LineString" ? [geometry.coordinates] : geometry?.type === "MultiLineString" && Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  return parts.reduce((best, part) => {
    const coordinates = Array.isArray(part) ? part.filter((coord) => Array.isArray(coord) && Number.isFinite(coord[0]) && Number.isFinite(coord[1])) : [];
    return coordinates.length > best.length ? coordinates : best;
  }, []);
}

export function lineHeadCoordinatesAt(features, clock, beatElapsedMs) {
  if (clock == null) return [];
  const progress = Math.min(1, Math.max(0, Number(beatElapsedMs) / TIMELINE_BEAT_MS || 0));
  if (progress >= HEAD_HIDE_AT) return [];
  const points = [];
  for (const feature of Array.isArray(features) ? features : []) {
    if (Number(feature?.properties?.timeline_minutes) !== clock) continue;
    const path = orientLineCoordinatesTowardIsrael(legacyLineCoordinates(feature));
    if (path.length < 2) continue;
    const point = pointAtLineProgress(path, buildLinePathMetrics(path), progress);
    if (point) points.push(point);
  }
  return points;
}

function profileValue(profile, key, fallback) {
  const value = Number(profile?.[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function safelyGetSource(map, id) {
  try {
    return typeof map?.getSource === "function" ? map.getSource(id) : null;
  } catch (_) {
    return null;
  }
}

function safelyGetLayer(map, id) {
  try {
    return typeof map?.getLayer === "function" ? map.getLayer(id) : null;
  } catch (_) {
    return null;
  }
}

function removeLayerAndSource(map, layerId, sourceId) {
  try {
    if (safelyGetLayer(map, layerId) && typeof map.removeLayer === "function") map.removeLayer(layerId);
  } catch (_) {
    // Style reload can remove a handle between getLayer and removeLayer.
  }
  try {
    if (safelyGetSource(map, sourceId) && typeof map.removeSource === "function") map.removeSource(sourceId);
  } catch (_) {
    // Style reload can remove a handle between getSource and removeSource.
  }
}

function addSourceAndLayer(map, sourceId, layer, sourceSpec, beforeId) {
  if (typeof map?.addSource !== "function" || typeof map?.addLayer !== "function") return;
  if (!safelyGetSource(map, sourceId)) map.addSource(sourceId, sourceSpec);
  if (safelyGetLayer(map, layer.id)) return;
  try {
    if (beforeId) map.addLayer(layer, beforeId);
    else map.addLayer(layer);
  } catch (_) {
    // A style can disappear while a renderer is being mounted.
  }
}

function sourceData(map, sourceId, data) {
  const source = safelyGetSource(map, sourceId);
  if (source && typeof source.setData === "function") source.setData(data);
}

function featureSignature(features) {
  return features.map((feature) => `${feature.id}:${JSON.stringify(feature.geometry)}`).join("|");
}

function sameFeatureList(previous, next) {
  if (!Array.isArray(previous) || !Array.isArray(next) || previous.length !== next.length) return false;
  return previous.every((feature, index) => feature === next[index]);
}

function dataFor(data, key, fallback = []) {
  if (!data || typeof data !== "object") return fallback;
  const aliases = {
    futureFeatures: ["futureFeatures", "future", "futureBaseFeatures", "features"],
    completedFeatures: ["completedFeatures", "completed", "completedRouteFeatures", "pastFeatures"],
    activeFeatures: ["activeFeatures", "active", "revealingFeatures"],
  }[key] || [key];
  for (const alias of aliases) {
    if (Array.isArray(data[alias])) return data[alias];
  }
  return fallback;
}

function buildHeadPoints(features, progress, metricsByObjectId) {
  if (!(Number(progress) >= 0) || Number(progress) >= HEAD_HIDE_AT) return [];
  const points = [];
  for (const feature of Array.isArray(features) ? features : []) {
    const id = featureId(feature, points.length);
    let metrics = metricsByObjectId.get(id);
    const path = metrics?.path || lineCoordinates(feature);
    if (path.length < 2) continue;
    if (!metrics) {
      metrics = { ...buildLinePathMetrics(path), path };
      metricsByObjectId.set(id, metrics);
    }
    const point = pointAtLineProgress(path, metrics, progress);
    if (point) points.push(point);
  }
  return points;
}

function dataInvalidationKey(data) {
  const version = data?.dataVersion;
  const revision = data?.dataRevision ?? data?.revision;
  if (version == null && revision == null) return null;
  return `${typeof version}:${String(version)}|${typeof revision}:${String(revision)}`;
}

function flowProgress(flow, motionMode) {
  if (motionMode === "reduced") return 0;
  const progress = Number(flow?.progress);
  if (Number.isFinite(progress)) return ((progress % 1) + 1) % 1;
  const phase = Number(flow?.phase);
  const steps = Number(flow?.patternSteps) || NLI_VISUAL_TOKENS.flowPatternSteps;
  return Number.isFinite(phase) && steps > 0 ? ((phase / steps) % 1 + 1) % 1 : 0;
}

function buildDirectionalFlowGradient(flow, motionMode, profile) {
  const phase = flowProgress(flow, motionMode);
  const density = profileValue(profile, "routeFlowDensity", NLI_VISUAL_TOKENS.routeFlowDensity);
  const dutyCycle = Math.min(
    0.99,
    Math.max(0.01, profileValue(profile, "routeFlowDutyCycle", NLI_VISUAL_TOKENS.routeFlowDutyCycle)),
  );
  const phaseExpression = [
    "%",
    ["+", ["*", ["line-progress"], density], ["-", 1, phase]],
    1,
  ];
  return [
    "case",
    ["<", phaseExpression, dutyCycle],
    NLI_VISUAL_TOKENS.routeFlowColor,
    "rgba(0, 0, 0, 0)",
  ];
}

/**
 * Create a renderer. `profile` can be a display-profile object or a profile
 * name (`gis`/`projection`); only presentation multipliers are read here.
 */
export function createInvestigationLineRenderer(map, profile = NLI_DISPLAY_PROFILES.gis) {
  const resolvedProfile = typeof profile === "string" ? NLI_DISPLAY_PROFILES[profile] || NLI_DISPLAY_PROFILES.gis : profile || NLI_DISPLAY_PROFILES.gis;
  const metricsByObjectId = new Map();
  const signatures = new Map();
  const collectionCache = new Map();
  let normalizedFeatureCache = new WeakMap();
  let mounted = false;
  let disposed = false;
  let lastData = null;
  let lastFrame = null;
  let lastHeadSignature = null;
  let lastMotionMode = null;
  let paintInitialized = false;
  let overlaysSuppressed = false;
  let lastDataInvalidationKey;

  const width = profileValue(resolvedProfile, "lineWidthMultiplier", 1);
  const routeScale = profileValue(resolvedProfile, "routeScale", 1);
  const carrierWidth = profileValue(resolvedProfile, "routeCarrierWidth", NLI_VISUAL_TOKENS.routeCarrierWidth);
  const beforeId = resolvedProfile.beforeId || resolvedProfile.beforeLayerId;

  function mount() {
    if (disposed) return;
    addSourceAndLayer(map, INVESTIGATION_LINE_SOURCE_IDS.future, {
      id: INVESTIGATION_LINE_LAYER_IDS.future,
      type: "line",
      source: INVESTIGATION_LINE_SOURCE_IDS.future,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": NLI_VISUAL_TOKENS.incidentRed, "line-opacity": FUTURE_OPACITY, "line-width": 1.2 * width },
    }, { type: "geojson", data: featureCollection([]) }, beforeId);
    if (overlaysSuppressed) {
      mounted = true;
      return;
    }
    addSourceAndLayer(map, INVESTIGATION_LINE_SOURCE_IDS.completedCarrier, {
      id: INVESTIGATION_LINE_LAYER_IDS.completedCarrier,
      type: "line",
      source: INVESTIGATION_LINE_SOURCE_IDS.completedCarrier,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": NLI_VISUAL_TOKENS.incidentRed, "line-opacity": COMPLETED_OPACITY, "line-width": carrierWidth * width * routeScale },
    }, { type: "geojson", data: featureCollection([]) }, beforeId);
    addSourceAndLayer(map, INVESTIGATION_LINE_SOURCE_IDS.completedMotion, {
      id: INVESTIGATION_LINE_LAYER_IDS.completedMotion,
      type: "line",
      source: INVESTIGATION_LINE_SOURCE_IDS.completedMotion,
      paint: {
        "line-color": NLI_VISUAL_TOKENS.routeFlowColor,
        "line-opacity": 1,
        "line-width": NLI_VISUAL_TOKENS.routeFlowWidth * width * routeScale,
        "line-gradient": buildDirectionalFlowGradient({}, "full", resolvedProfile),
      },
    }, { type: "geojson", lineMetrics: true, data: featureCollection([]) }, beforeId);
    addSourceAndLayer(map, INVESTIGATION_LINE_SOURCE_IDS.active, {
      id: INVESTIGATION_LINE_LAYER_IDS.active,
      type: "line",
      source: INVESTIGATION_LINE_SOURCE_IDS.active,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": NLI_VISUAL_TOKENS.incidentRed, "line-width": 2.6 * width, "line-opacity": ACTIVE_OPACITY, "line-gradient": buildLineProgressGradient(0, NLI_VISUAL_TOKENS.incidentRed, "rgba(195,31,79,0)") },
    }, { type: "geojson", lineMetrics: true, data: featureCollection([]) }, beforeId);
    addSourceAndLayer(map, INVESTIGATION_LINE_SOURCE_IDS.head, {
      id: INVESTIGATION_LINE_LAYER_IDS.head,
      type: "circle",
      source: INVESTIGATION_LINE_SOURCE_IDS.head,
      paint: { "circle-color": NLI_VISUAL_TOKENS.routeReveal, "circle-radius": Math.max(2.25, HEAD_RADIUS * width), "circle-opacity": 0.95, "circle-stroke-color": NLI_VISUAL_TOKENS.annotationInk, "circle-stroke-width": 1.1 },
    }, { type: "geojson", data: pointsFeatureCollection([]) }, beforeId);
    mounted = true;
  }

  function render(frame = {}, data = {}) {
    if (disposed) return;
    const nextDataInvalidationKey = dataInvalidationKey(data);
    if (lastDataInvalidationKey !== undefined && nextDataInvalidationKey !== lastDataInvalidationKey) {
      metricsByObjectId.clear();
      signatures.clear();
      collectionCache.clear();
      normalizedFeatureCache = new WeakMap();
      lastHeadSignature = null;
    }
    lastDataInvalidationKey = nextDataInvalidationKey;
    const wasSuppressed = overlaysSuppressed;
    overlaysSuppressed = false;
    if (!mounted || wasSuppressed) {
      mounted = false;
      mount();
    }
    const previousFrame = lastFrame;
    lastFrame = frame || {};
    lastData = data || {};
    const future = dataFor(lastData, "futureFeatures");
    const completed = dataFor(lastData, "completedFeatures");
    const active = dataFor(lastData, "activeFeatures");
    function normalizeCollection(key, sourceFeatures) {
      const prior = collectionCache.get(key);
      if (prior?.raw === sourceFeatures || sameFeatureList(prior?.raw, sourceFeatures)) return prior.features;
      const features = (Array.isArray(sourceFeatures) ? sourceFeatures : [])
        .map((feature, index) => {
          const hasStableId = feature && typeof feature === "object" &&
            (feature.properties?.OBJECTID != null || feature.id != null);
          if (hasStableId && normalizedFeatureCache.has(feature)) return normalizedFeatureCache.get(feature);
          const normalized = normalizeFeature(feature, index);
          if (hasStableId && normalized) normalizedFeatureCache.set(feature, normalized);
          return normalized;
        })
        .filter((feature) => feature?.geometry && validLineCoordinates(feature.geometry).length > 0);
      collectionCache.set(key, { raw: sourceFeatures, features, signature: featureSignature(features) });
      return features;
    }
    const normalized = {
      future: normalizeCollection("future", future),
      completed: normalizeCollection("completed", completed),
      active: normalizeCollection("active", active),
    };
    const changed = {};
    for (const [key, features] of Object.entries(normalized)) {
      const signature = collectionCache.get(key)?.signature || "";
      changed[key] = signatures.get(key) !== signature;
      if (signatures.get(key) !== signature) {
        const sourceId = key === "future" ? INVESTIGATION_LINE_SOURCE_IDS.future : key === "completed" ? INVESTIGATION_LINE_SOURCE_IDS.completedCarrier : INVESTIGATION_LINE_SOURCE_IDS.active;
        const collection = { type: "FeatureCollection", features };
        sourceData(map, sourceId, collection);
        if (key === "completed") sourceData(map, INVESTIGATION_LINE_SOURCE_IDS.completedMotion, collection);
        signatures.set(key, signature);
      }
    }
    const motion = frame.completedRouteFlow || {};
    const motionMode = frame.motionMode || "full";
    const motionModeChanged = lastMotionMode !== motionMode;
    const staticPaintChanged = !paintInitialized || changed.future || changed.completed || motionModeChanged;
    const flowPaintChanged = staticPaintChanged || (
      motionMode === "full" &&
      flowProgress(motion, motionMode) !== flowProgress(previousFrame?.completedRouteFlow, previousFrame?.motionMode || motionMode)
    );
    try {
      if (staticPaintChanged && safelyGetLayer(map, INVESTIGATION_LINE_LAYER_IDS.future) && typeof map.setPaintProperty === "function") {
        map.setPaintProperty(INVESTIGATION_LINE_LAYER_IDS.future, "line-color", NLI_VISUAL_TOKENS.incidentRed);
        map.setPaintProperty(INVESTIGATION_LINE_LAYER_IDS.future, "line-opacity", FUTURE_OPACITY);
      }
      if (staticPaintChanged && safelyGetLayer(map, INVESTIGATION_LINE_LAYER_IDS.completedCarrier) && typeof map.setPaintProperty === "function") {
        map.setPaintProperty(INVESTIGATION_LINE_LAYER_IDS.completedCarrier, "line-color", NLI_VISUAL_TOKENS.incidentRed);
        map.setPaintProperty(INVESTIGATION_LINE_LAYER_IDS.completedCarrier, "line-width", carrierWidth * width * routeScale);
      }
      if (safelyGetLayer(map, INVESTIGATION_LINE_LAYER_IDS.completedMotion) && typeof map.setPaintProperty === "function") {
        if (staticPaintChanged) {
          map.setPaintProperty(INVESTIGATION_LINE_LAYER_IDS.completedMotion, "line-color", NLI_VISUAL_TOKENS.routeFlowColor);
          map.setPaintProperty(INVESTIGATION_LINE_LAYER_IDS.completedMotion, "line-width", NLI_VISUAL_TOKENS.routeFlowWidth * width * routeScale);
        }
        if (flowPaintChanged) {
          map.setPaintProperty(
            INVESTIGATION_LINE_LAYER_IDS.completedMotion,
            "line-gradient",
            buildDirectionalFlowGradient(motion, motionMode, resolvedProfile),
          );
        }
      }
      if ((!paintInitialized || changed.active || Number(frame.activeProgress) !== Number(previousFrame?.activeProgress)) && safelyGetLayer(map, INVESTIGATION_LINE_LAYER_IDS.active) && typeof map.setPaintProperty === "function") {
        map.setPaintProperty(INVESTIGATION_LINE_LAYER_IDS.active, "line-color", NLI_VISUAL_TOKENS.incidentRed);
        map.setPaintProperty(INVESTIGATION_LINE_LAYER_IDS.active, "line-gradient", buildLineProgressGradient(frame.activeProgress, NLI_VISUAL_TOKENS.incidentRed, "rgba(195,31,79,0)"));
      }
    } catch (_) {
      // Style reload can invalidate an individual layer handle.
    }
    const headPoints = buildHeadPoints(normalized.active, frame.activeProgress, metricsByObjectId);
    const headData = pointsFeatureCollection(headPoints);
    const headSignature = headPoints.map((point) => `${point[0]},${point[1]}`).join("|");
    if (headSignature !== lastHeadSignature) {
      sourceData(map, INVESTIGATION_LINE_SOURCE_IDS.head, headData);
      lastHeadSignature = headSignature;
    }
    lastMotionMode = motionMode;
    paintInitialized = true;
  }

  function reset({ preserveBasePaints = false } = {}) {
    if (disposed) return;
    for (const [layerId, sourceId] of OWNED) {
      if (OVERLAY.has(layerId)) removeLayerAndSource(map, layerId, sourceId);
    }
    signatures.clear();
    collectionCache.clear();
    metricsByObjectId.clear();
    normalizedFeatureCache = new WeakMap();
    lastHeadSignature = null;
    lastMotionMode = null;
    paintInitialized = false;
    overlaysSuppressed = true;
    lastData = null;
    lastFrame = null;
    lastDataInvalidationKey = undefined;
    try {
      if (preserveBasePaints) return;
      if (safelyGetLayer(map, INVESTIGATION_LINE_LAYER_IDS.future) && typeof map.setPaintProperty === "function") {
        map.setPaintProperty(INVESTIGATION_LINE_LAYER_IDS.future, "line-color", NLI_VISUAL_TOKENS.incidentRed);
        // The application's canonical base line layer becomes visible again
        // after reset. Keep this owned source mounted for a cheap remount but
        // hide it so reset cannot double-paint routes.
        map.setPaintProperty(INVESTIGATION_LINE_LAYER_IDS.future, "line-opacity", 0);
      }
    } catch (_) {
      // Ignore a style that is already gone.
    }
    mounted = !!safelyGetSource(map, INVESTIGATION_LINE_SOURCE_IDS.future);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const [layerId, sourceId] of OWNED) removeLayerAndSource(map, layerId, sourceId);
    metricsByObjectId.clear();
    signatures.clear();
    collectionCache.clear();
    lastHeadSignature = null;
    paintInitialized = false;
    lastData = null;
    lastFrame = null;
    lastDataInvalidationKey = undefined;
    mounted = false;
  }

  return { mount, render, reset, dispose };
}
