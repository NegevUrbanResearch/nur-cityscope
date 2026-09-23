/** Data loading, indexing, invalidation, and line-frame caching for NLI timeline. */

import {
  INVESTIGATION_ALARMS_FULL_ID,
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
  timelineBeatDurationMs,
} from "./nli-investigation-beats.js";
import layerRegistry from "./layer-registry.js";
import {
  bufferedGradientResource,
  isBufferedGradientStyle,
} from "./cim-buffered-gradient.js";
import { aliasNovaSiteOutlineToYeshuv } from "./nli-nova-escape-impact.js";
import { NLI_NARRATIVES } from "./nli-narratives.js";
import {
  buildRouteSettlementCollisionIndex,
  deriveAchievedSettlementOutlineIds,
} from "./nli-route-settlement-collisions.js";

const SIDECAR_STATUSES = new Set(["not-required", "loading", "ready", "failed"]);

function normalizeSidecarStatus(value) {
  return SIDECAR_STATUSES.has(value) ? value : "not-required";
}

export const DEFAULT_INVESTIGATION_SETTLEMENTS_URL = "/otef-interactive/public/processed/layers/nli/investigation_settlements.geojson";
const YESHUVIM_FULL_ID = "projector_base.ישובים";
export const DEFAULT_YESHUVIM_URL = `/otef-interactive/public/processed/layers/projector_base/${encodeURIComponent("ישובים.geojson")}`;

function featureList(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.features) ? value.features : [];
}

function settlementOutlineObjectId(feature) {
  const props = feature?.properties || {};
  return props.outlineObjectId ?? props.outlineObjectID ?? null;
}

function packFeatureObjectId(feature) {
  const props = feature?.properties || {};
  return props.OBJECTID ?? props.objectid ?? null;
}

function layerDataUrlFor(deps, fullId) {
  if (typeof deps.getLayerDataUrl === "function") {
    try {
      return deps.getLayerDataUrl(fullId) || null;
    } catch (_) {
      return null;
    }
  }
  try {
    const url = layerRegistry.getLayerDataUrl(fullId);
    if (url) return url;
  } catch (_) {
    // fall through to the pack default
  }
  return fullId === YESHUVIM_FULL_ID ? DEFAULT_YESHUVIM_URL : null;
}

function asNovaYeshuvSettlementFeature(feature) {
  const outlineId = NLI_NARRATIVES.nova.focusSettlementOutlineId;
  return {
    type: "Feature",
    id: `nli-settlement-outline-${outlineId}`,
    properties: {
      outlineObjectId: outlineId,
      OBJECTID: outlineId,
      locations: [NLI_NARRATIVES.nova.focusSettlement],
    },
    geometry: feature.geometry,
  };
}

function mergeNovaYeshuvOutlineFeature(settlementFeatures, yeshuvFeatures) {
  const outlineId = String(NLI_NARRATIVES.nova.focusSettlementOutlineId);
  const list = Array.isArray(settlementFeatures) ? [...settlementFeatures] : [];
  const already = list.some((feature) => {
    const id = settlementOutlineObjectId(feature) ?? packFeatureObjectId(feature);
    return id != null && String(id) === outlineId;
  });
  if (already) return list;
  const yeshuv = (Array.isArray(yeshuvFeatures) ? yeshuvFeatures : []).find((feature) => (
    String(packFeatureObjectId(feature)) === outlineId && feature?.geometry
  ));
  if (!yeshuv) return list;
  list.push(asNovaYeshuvSettlementFeature(yeshuv));
  return list;
}

/** Build the exact sidecar location and outline-feature indexes. */
export function buildInvestigationSettlementIndexes(features) {
  const locationToOutlineObjectId = new Map();
  const settlementFeaturesByOutlineId = new Map();
  for (const feature of Array.isArray(features) ? features : []) {
    const outlineObjectId = settlementOutlineObjectId(feature);
    if (outlineObjectId == null) continue;
    settlementFeaturesByOutlineId.set(String(outlineObjectId), feature);
    const locations = Array.isArray(feature?.properties?.locations) ? feature.properties.locations : [];
    for (const location of locations) {
      if (location != null && !locationToOutlineObjectId.has(String(location))) {
        locationToOutlineObjectId.set(String(location), outlineObjectId);
      }
    }
  }
  return { locationToOutlineObjectId, settlementFeaturesByOutlineId };
}

export function parseLocalTimelineToMinutes(value) {
  if (typeof value !== "string") return null;
  const match = /^local\s+(\d{1,2}):(\d{2})$/i.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function objectIdsActiveAt(features, minutes) {
  const active = [];
  for (const feature of features || []) {
    if (Number(feature?.properties?.timeline_minutes) === minutes && feature?.properties?.OBJECTID != null) {
      active.push(feature.properties.OBJECTID);
    }
  }
  return active;
}

export function lineProgressAt(minutes, clock, beatElapsedMs) {
  if (!Number.isFinite(Number(minutes))) return 0;
  if (clock == null) return 1;
  if (minutes < clock) return 1;
  if (minutes > clock) return 0;
  const u = Number(beatElapsedMs) / timelineBeatDurationMs(clock);
  return !Number.isFinite(u) || u <= 0 ? 0 : Math.min(1, u);
}

function timelineMinute(feature) {
  const value = Number(feature?.properties?.timeline_minutes);
  return Number.isFinite(value) ? value : null;
}

function buildBeatIndex(features) {
  const byBeat = new Map();
  for (const feature of Array.isArray(features) ? features : []) {
    const beat = timelineMinute(feature);
    if (beat == null) continue;
    const list = byBeat.get(beat) || [];
    list.push(feature);
    byBeat.set(beat, list);
  }
  return byBeat;
}

function fetchJsonSafely(deps, url) {
  try {
    if (typeof deps.fetchJson === "function") return Promise.resolve(deps.fetchJson(url)).catch(() => null);
    if (typeof globalThis.fetch !== "function") return Promise.resolve(null);
    return globalThis.fetch(url).then((response) => response?.ok ? response.json() : null).catch(() => null);
  } catch (_) {
    return Promise.resolve(null);
  }
}

function layerConfigFor(deps, fullId) {
  try {
    if (typeof deps.getLayerConfig === "function") return deps.getLayerConfig(fullId);
    return layerRegistry.getLayerConfig(fullId);
  } catch (_) {
    return null;
  }
}

function layerStyleFor(deps, fullId) {
  if (deps.polygonStyle !== undefined && fullId === INVESTIGATION_POLYGONS_FULL_ID) return deps.polygonStyle;
  if (deps.style !== undefined && fullId === INVESTIGATION_POLYGONS_FULL_ID) return deps.style;
  if (deps.styleById && deps.styleById[fullId] !== undefined) return deps.styleById[fullId];
  if (typeof deps.getLayerStyle === "function") return deps.getLayerStyle(fullId);
  try {
    const raw = layerRegistry.getPackStyleJsonForLayer(fullId);
    return raw || layerRegistry.getLayerConfig(fullId)?.style || null;
  } catch (_) {
    return null;
  }
}

function resourceUrlFor(deps, fullId, resource) {
  if (!resource?.file) return null;
  if (typeof deps.getLayerResourceUrl === "function") {
    return deps.getLayerResourceUrl(fullId, resource);
  }
  if (typeof deps.bufferedGradientUrl === "string" && fullId === INVESTIGATION_POLYGONS_FULL_ID) {
    return deps.bufferedGradientUrl;
  }
  const config = layerConfigFor(deps, fullId);
  const groupId = config?.groupId || fullId.split(".")[0];
  return `/otef-interactive/public/processed/layers/${groupId}/${encodeURIComponent(resource.file)}`;
}

async function loadLayerFeatures(deps, fullId) {
  const provided = deps.featuresById && deps.featuresById[fullId];
  if (provided !== undefined) return featureList(provided);
  if (fullId === INVESTIGATION_POLYGONS_FULL_ID && deps.features !== undefined) return featureList(deps.features);
  let url = null;
  try {
    const getLayerDataUrl = typeof deps.getLayerDataUrl === "function"
      ? deps.getLayerDataUrl
      : (id) => layerRegistry.getLayerDataUrl(id);
    url = getLayerDataUrl(fullId);
  } catch (_) {
    return [];
  }
  return url ? featureList(await fetchJsonSafely(deps, url)) : [];
}

async function loadSettlementFeatures(deps) {
  if (Object.prototype.hasOwnProperty.call(deps, "settlementFeatures")) return featureList(deps.settlementFeatures);
  let url = null;
  try {
    url = deps.investigationSettlementsUrl === undefined
      ? DEFAULT_INVESTIGATION_SETTLEMENTS_URL
      : deps.investigationSettlementsUrl;
  } catch (_) {
    return [];
  }
  const settlements = url ? featureList(await fetchJsonSafely(deps, url)) : [];
  const yeshuvUrl = layerDataUrlFor(deps, YESHUVIM_FULL_ID);
  const yeshuvim = yeshuvUrl ? featureList(await fetchJsonSafely(deps, yeshuvUrl)) : [];
  return mergeNovaYeshuvOutlineFeature(settlements, yeshuvim);
}

function invalidateIndexes(data) {
  data.linePartitionCache = null;
}

/** Create the explicit data object shared by one timeline coordinator. */
export function createInvestigationTimelineData(deps = {}) {
  const data = {
    polygonFeatures: null,
    lineFeatures: null,
    alarmFeatures: null,
    polygonStyle: deps.polygonStyle ?? null,
    bufferedGradientFeatures: null,
    bufferedGradientSidecarStatus: "not-required",
    bufferedGradientStatus: "not-required",
    sidecarStatus: "not-required",
    locationToOutlineObjectId: deps.locationToOutlineObjectId || null,
    locationIndexExplicit: Object.prototype.hasOwnProperty.call(deps, "locationToOutlineObjectId"),
    settlementFeatures: Array.isArray(deps.settlementFeatures) ? deps.settlementFeatures : null,
    settlementFeaturesByOutlineId: deps.settlementFeaturesByOutlineId || null,
    outlineIndexExplicit: Object.prototype.hasOwnProperty.call(deps, "settlementFeaturesByOutlineId"),
    dataVersion: deps.dataVersion ?? null,
    dataRevision: 0,
    featureLoadPromises: new Map(),
    styleLoadPromise: null,
    bufferedGradientLoadPromise: null,
    settlementLoadPromise: null,
    linePartitionCache: null,
    collisionIndexCache: null,
    linePartitionBuilds: 0,
    linePartitionFrameBuilds: 0,
    collisionIndexBuilds: 0,
    onLinePartitionBuild: deps.onLinePartitionBuild,
  };
  if (Array.isArray(data.settlementFeatures)) {
    const indexes = buildInvestigationSettlementIndexes(data.settlementFeatures);
    if (!data.locationToOutlineObjectId) data.locationToOutlineObjectId = indexes.locationToOutlineObjectId;
    if (!data.settlementFeaturesByOutlineId) data.settlementFeaturesByOutlineId = indexes.settlementFeaturesByOutlineId;
  }
  refreshInvestigationTimelineData(data, deps);
  return data;
}

/** Return authored route beats from the cached line partition. */
export function investigationRouteBeats(data) {
  return buildLinePartition(data).beats;
}

function routeSettlementCollisionIndex(data) {
  const cached = data.collisionIndexCache;
  if (
    cached?.dataVersion === data.dataVersion &&
    cached?.lineFeatures === data.lineFeatures &&
    cached?.settlementFeatures === data.settlementFeatures
  ) return cached.index;
  const index = buildRouteSettlementCollisionIndex(
    data.lineFeatures || [],
    data.settlementFeatures || [],
  );
  data.collisionIndexCache = {
    dataVersion: data.dataVersion,
    lineFeatures: data.lineFeatures,
    settlementFeatures: data.settlementFeatures,
    index,
  };
  data.collisionIndexBuilds += 1;
  return index;
}

/** Derive outline IDs through cached collision associations, never spatial scans. */
export function buildInvestigationSettlementOutlineIdsForFrame(data, frame, lineFrame = {}) {
  const routeEnabled = frame?.routeTimelineEnabled !== false;
  return aliasNovaSiteOutlineToYeshuv(
    deriveAchievedSettlementOutlineIds({
      achievedPolygonBeats: frame?.achievedPolygonBeats || [],
      polygonFeatures: data?.polygonFeatures || [],
      locationToOutlineObjectId: data?.locationToOutlineObjectId,
      collisionIndex: routeSettlementCollisionIndex(data),
      completedRouteFeatures: routeEnabled ? lineFrame?.completedFeatures || [] : [],
      activeRouteFeatures: routeEnabled ? lineFrame?.activeFeatures || [] : [],
      activeRouteProgress: frame?.activeProgress || 0,
    }),
    data?.settlementFeaturesByOutlineId,
  );
}

/** Apply injected data and invalidate loaded data when its version changes. */
export function refreshInvestigationTimelineData(data, deps = {}) {
  if (typeof deps.onLinePartitionBuild === "function") data.onLinePartitionBuild = deps.onLinePartitionBuild;
  let changed = false;
  const hasVersion = Object.prototype.hasOwnProperty.call(deps, "dataVersion");
  if (hasVersion && data.dataVersion !== deps.dataVersion) {
    data.dataVersion = deps.dataVersion;
    data.polygonFeatures = data.lineFeatures = data.alarmFeatures = data.settlementFeatures = null;
    data.polygonStyle = null;
    data.bufferedGradientFeatures = null;
    data.bufferedGradientSidecarStatus = "not-required";
    data.bufferedGradientStatus = "not-required";
    data.sidecarStatus = "not-required";
    data.locationToOutlineObjectId = data.settlementFeaturesByOutlineId = null;
    data.locationIndexExplicit = data.outlineIndexExplicit = false;
    data.featureLoadPromises.clear();
    data.styleLoadPromise = null;
    data.bufferedGradientLoadPromise = null;
    data.settlementLoadPromise = null;
    invalidateIndexes(data);
    changed = true;
  }

  const injected = (key, value) => {
    if (value === undefined) return;
    const next = featureList(value);
    if (data[key] !== next) changed = true;
    data[key] = next;
  };
  const byId = deps.featuresById;
  if (byId) {
    injected("polygonFeatures", byId[INVESTIGATION_POLYGONS_FULL_ID]);
    injected("lineFeatures", byId[INVESTIGATION_LINES_FULL_ID]);
    injected("alarmFeatures", byId[INVESTIGATION_ALARMS_FULL_ID]);
  }
  if (deps.features !== undefined) injected("polygonFeatures", deps.features);

  if (Object.prototype.hasOwnProperty.call(deps, "polygonStyle")) {
    if (data.polygonStyle !== deps.polygonStyle) changed = true;
    data.polygonStyle = deps.polygonStyle;
  }
  if (Object.prototype.hasOwnProperty.call(deps, "bufferedGradientFeatures")) {
    const next = deps.bufferedGradientFeatures == null ? null : featureList(deps.bufferedGradientFeatures);
    if (data.bufferedGradientFeatures !== next) changed = true;
    data.bufferedGradientFeatures = next;
    if (next) {
      data.bufferedGradientSidecarStatus = deps.bufferedGradientSidecarStatus || "ready";
      data.bufferedGradientStatus = data.bufferedGradientSidecarStatus;
      data.sidecarStatus = data.bufferedGradientSidecarStatus;
    }
  }
  if (Object.prototype.hasOwnProperty.call(deps, "bufferedGradientSidecarStatus")
    || Object.prototype.hasOwnProperty.call(deps, "bufferedGradientStatus")
    || Object.prototype.hasOwnProperty.call(deps, "sidecarStatus")) {
    const injectedStatus = deps.bufferedGradientSidecarStatus
      ?? deps.bufferedGradientStatus
      ?? deps.sidecarStatus;
    const normalized = normalizeSidecarStatus(injectedStatus);
    if (data.bufferedGradientSidecarStatus !== normalized) changed = true;
    data.bufferedGradientSidecarStatus = normalized;
    data.bufferedGradientStatus = normalized;
    data.sidecarStatus = normalized;
  }

  if (Object.prototype.hasOwnProperty.call(deps, "locationToOutlineObjectId")) {
    if (data.locationToOutlineObjectId !== deps.locationToOutlineObjectId) changed = true;
    data.locationToOutlineObjectId = deps.locationToOutlineObjectId;
    data.locationIndexExplicit = true;
  }
  const hasSettlement = Object.prototype.hasOwnProperty.call(deps, "settlementFeatures");
  const hasOutline = Object.prototype.hasOwnProperty.call(deps, "settlementFeaturesByOutlineId");
  if (hasSettlement) {
    const next = featureList(deps.settlementFeatures);
    if (data.settlementFeatures !== next && data.settlementFeatures !== deps.settlementFeatures) changed = true;
    data.settlementFeatures = next;
    data.settlementLoadPromise = null;
  }
  if (hasOutline) {
    if (data.settlementFeaturesByOutlineId !== deps.settlementFeaturesByOutlineId) changed = true;
    data.settlementFeaturesByOutlineId = deps.settlementFeaturesByOutlineId;
    data.outlineIndexExplicit = true;
  }
  if (hasSettlement && !Object.prototype.hasOwnProperty.call(deps, "locationToOutlineObjectId")) {
    const indexes = buildInvestigationSettlementIndexes(data.settlementFeatures);
    data.locationToOutlineObjectId = indexes.locationToOutlineObjectId;
    data.locationIndexExplicit = false;
    if (!hasOutline) {
      data.settlementFeaturesByOutlineId = indexes.settlementFeaturesByOutlineId;
      data.outlineIndexExplicit = false;
    }
  } else if (hasSettlement && !hasOutline) {
    data.settlementFeaturesByOutlineId = buildInvestigationSettlementIndexes(data.settlementFeatures).settlementFeaturesByOutlineId;
    data.outlineIndexExplicit = false;
  }
  if (changed) {
    data.dataRevision += 1;
    invalidateIndexes(data);
  }
}

/** Load the processed polygon style through the same registry/data path as features. */
export async function ensureInvestigationPolygonStyle(data, deps = {}, { request = null, isCurrent = () => true } = {}) {
  if (data.polygonStyle !== null && data.polygonStyle !== undefined) return;
  const version = data.dataVersion;
  let record = data.styleLoadPromise?.version === version
    ? data.styleLoadPromise
    : { version, request, promise: Promise.resolve(layerStyleFor(deps, INVESTIGATION_POLYGONS_FULL_ID)) };
  if (data.styleLoadPromise?.version === version && request) record.request = request;
  data.styleLoadPromise = record;
  const loaded = await record.promise;
  if (data.styleLoadPromise === record) data.styleLoadPromise = null;
  if (data.dataVersion !== version || !isCurrent(record.request)) return;
  data.polygonStyle = loaded && typeof loaded === "object" ? loaded : null;
  data.dataRevision += 1;
  if (!isBufferedGradientStyle(data.polygonStyle)) {
    data.bufferedGradientSidecarStatus = "not-required";
    data.bufferedGradientStatus = "not-required";
    data.sidecarStatus = "not-required";
  }
}

/** Load the optional processed buffered-gradient sidecar with stale-request protection. */
export async function ensureInvestigationBufferedGradient(data, deps = {}, { request = null, isCurrent = () => true } = {}) {
  if (Array.isArray(data.bufferedGradientFeatures)) {
    data.bufferedGradientSidecarStatus = "ready";
    data.bufferedGradientStatus = "ready";
    data.sidecarStatus = "ready";
    return;
  }
  if (data.bufferedGradientSidecarStatus === "failed") return;
  if (!isBufferedGradientStyle(data.polygonStyle)) {
    data.bufferedGradientSidecarStatus = "not-required";
    data.bufferedGradientStatus = "not-required";
    data.sidecarStatus = "not-required";
    return;
  }
  const config = layerConfigFor(deps, INVESTIGATION_POLYGONS_FULL_ID);
  const resource = bufferedGradientResource(config) || bufferedGradientResource(deps);
  const url = resourceUrlFor(deps, INVESTIGATION_POLYGONS_FULL_ID, resource);
  if (!url) {
    data.bufferedGradientSidecarStatus = "not-required";
    data.bufferedGradientStatus = "not-required";
    data.sidecarStatus = "not-required";
    return;
  }
  const version = data.dataVersion;
  let record = data.bufferedGradientLoadPromise?.version === version
    ? data.bufferedGradientLoadPromise
    : { version, request, promise: fetchJsonSafely(deps, url) };
  if (data.bufferedGradientLoadPromise?.version === version && request) record.request = request;
  data.bufferedGradientLoadPromise = record;
  data.bufferedGradientSidecarStatus = "loading";
  data.bufferedGradientStatus = "loading";
  data.sidecarStatus = "loading";
  const loaded = await record.promise;
  if (data.bufferedGradientLoadPromise === record) data.bufferedGradientLoadPromise = null;
  if (data.dataVersion !== version || !isCurrent(record.request)) return;
  if (loaded?.type === "FeatureCollection" && Array.isArray(loaded.features)) {
    data.bufferedGradientFeatures = featureList(loaded);
    data.bufferedGradientSidecarStatus = "ready";
  } else {
    data.bufferedGradientFeatures = null;
    data.bufferedGradientSidecarStatus = "failed";
  }
  data.sidecarStatus = data.bufferedGradientSidecarStatus;
  data.bufferedGradientStatus = data.bufferedGradientSidecarStatus;
  data.dataRevision += 1;
}

/** Ensure a single layer bag, adopting only a current request's result. */
export async function ensureInvestigationLayerFeatures(data, deps, key, fullId, { request = null, isCurrent = () => true } = {}) {
  if (Array.isArray(data[key])) return;
  const version = data.dataVersion;
  let record = data.featureLoadPromises.get(key);
  if (!record || record.version !== version) {
    record = { version, request, promise: loadLayerFeatures(deps, fullId) };
    data.featureLoadPromises.set(key, record);
  } else if (request) {
    record.request = request;
  }
  const loaded = await record.promise;
  if (data.featureLoadPromises.get(key) === record) data.featureLoadPromises.delete(key);
  if (data.dataVersion !== version || !isCurrent(record.request)) return;
  if (!Array.isArray(data[key])) {
    data[key] = featureList(loaded);
    data.dataRevision += 1;
    invalidateIndexes(data);
  }
}

/** Ensure the settlement sidecar and derive indexes unless explicitly supplied. */
export async function ensureInvestigationSettlementFeatures(data, deps, { request = null, isCurrent = () => true } = {}) {
  if (Array.isArray(data.settlementFeatures)) return;
  const version = data.dataVersion;
  const record = data.settlementLoadPromise?.version === version
    ? data.settlementLoadPromise
    : { version, request, promise: loadSettlementFeatures(deps) };
  if (data.settlementLoadPromise?.version === version && request) record.request = request;
  data.settlementLoadPromise = record;
  const loaded = await record.promise;
  if (data.settlementLoadPromise === record) data.settlementLoadPromise = null;
  if (data.dataVersion !== version || !isCurrent(record.request)) return;
  if (!Array.isArray(data.settlementFeatures)) {
    data.settlementFeatures = featureList(loaded);
    const indexes = buildInvestigationSettlementIndexes(data.settlementFeatures);
    if (!data.locationIndexExplicit) data.locationToOutlineObjectId = indexes.locationToOutlineObjectId;
    if (!data.outlineIndexExplicit) data.settlementFeaturesByOutlineId = indexes.settlementFeaturesByOutlineId;
    data.dataRevision += 1;
    invalidateIndexes(data);
  }
}

function buildLinePartition(data) {
  const key = `${data.dataVersion ?? ""}|${INVESTIGATION_LINES_FULL_ID}`;
  const cached = data.linePartitionCache;
  if (cached?.key === key && cached.sourceFeatures === data.lineFeatures) return cached;
  const byBeat = buildBeatIndex(data.lineFeatures);
  const partition = {
    key,
    sourceFeatures: data.lineFeatures,
    beats: [...byBeat.keys()].sort((a, b) => Number(a) - Number(b)),
    byBeat,
    frameCache: new Map(),
  };
  data.linePartitionCache = partition;
  data.linePartitionBuilds += 1;
  data.onLinePartitionBuild?.({ key, beats: partition.beats });
  return partition;
}

/** Build or retrieve the three source bags for one derived line frame. */
export function buildInvestigationLineFeaturesForFrame(data, frame) {
  const partition = buildLinePartition(data);
  const rawActiveBeat = frame?.activeBeat;
  const activeBeat = rawActiveBeat != null && Number.isFinite(Number(rawActiveBeat)) ? Number(rawActiveBeat) : null;
  const activeProgress = Number(frame?.activeProgress);
  const completedKey = [...new Set((frame?.completedBeats || []).map(Number).filter(Number.isFinite))]
    .sort((a, b) => a - b).join(",");
  const frameKey = [completedKey, Number.isFinite(activeBeat) ? activeBeat : "", activeProgress >= 1 ? "complete" : "active"].join("|");
  const cached = partition.frameCache.get(frameKey);
  if (cached) return cached;
  const active = Number.isFinite(activeBeat) ? (partition.byBeat.get(activeBeat) || []) : [];
  const completedBeats = new Set(completedKey ? completedKey.split(",").map(Number) : []);
  const completed = [];
  const future = [];
  for (const beat of partition.beats) {
    const features = partition.byBeat.get(beat) || [];
    if (completedBeats.has(Number(beat))) completed.push(...features);
    else if (!(Number.isFinite(activeBeat) && Number(beat) === activeBeat && activeProgress < 1)) future.push(...features);
  }
  const result = {
    dataVersion: data.dataVersion,
    dataRevision: data.dataRevision,
    futureFeatures: future,
    completedFeatures: completed,
    activeFeatures: activeProgress >= 1 ? [] : active,
  };
  partition.frameCache.set(frameKey, result);
  data.linePartitionFrameBuilds += 1;
  return result;
}

export function getInvestigationTimelineDataDiagnostics(data) {
  return {
    linePartitionBuilds: data?.linePartitionBuilds || 0,
    linePartitionFrameBuilds: data?.linePartitionFrameBuilds || 0,
    collisionIndexBuilds: data?.collisionIndexBuilds || 0,
  };
}
