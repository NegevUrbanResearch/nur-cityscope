/**
 * Shared-clock highlight for NLI investigation polygons, lines, and alarms.
 * Maps evaluate `NliInvestigationClock` (GIS and projection share T via correctedNow).
 * Active lines use the same line-gradient trail as Oct 7 ציר layers, once per beat,
 * including the trail-head circle. The head hides when that line's beat finishes.
 * Completed lines stay fully drawn. Base pack lines are hidden while playback runs.
 * Alarms hitchhike polygon/line beats when those layers play; alarms-only uses 5-minute bins.
 */

import {
  alarmCaptionHtml,
  applyAlarmMode,
} from "./maplibre-investigation-alarms.js";
import {
  INVESTIGATION_ALARMS_FULL_ID,
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
  TIMELINE_BEAT_MS,
  formatMinutesAsLocalClock,
} from "./nli-investigation-beats.js";
import {
  evaluateClock,
  flashPreviousClock,
  normalizeNliClock,
} from "./nli-investigation-clock.js";
import layerRegistry from "./layer-registry.js";

export {
  INVESTIGATION_ALARMS_FULL_ID,
  INVESTIGATION_LINES_FULL_ID,
  INVESTIGATION_POLYGONS_FULL_ID,
  TIMELINE_BEAT_MS,
  TIMELINE_HOLD_MS,
  clockStoryDurationMs,
  collectPlaybackTimelineBeats,
  collectTimelineBeats,
  collectUnionTimelineBeats,
  formatMinutesAsLocalClock,
  previousTimelineBeat,
  timelinePhaseAt,
} from "./nli-investigation-beats.js";

const FILL_FUTURE = 0.06;
const FILL_PAST = 0.55;
const FILL_ACTIVE = 0.88;
const FILL_COLOR_FUTURE = "#f79009";
const FILL_COLOR_PAST = "#f79009";
const FILL_COLOR_ACTIVE = "#f79009";
const LINE_OPACITY_FUTURE = 0.22;
const LINE_OPACITY_PAST = 0.95;
const LINE_OPACITY_ACTIVE = 0.55;
const LINE_WIDTH_FUTURE = 0.9;
const LINE_WIDTH_PAST = 1.8;
const LINE_WIDTH_ACTIVE = 2.1;
const LINE_COLOR_FUTURE = "#b54708";
const LINE_COLOR_PAST = "#b54708";
const LINE_COLOR_ACTIVE = "#ffffff";

const POLYGON_LAYER_ID_PREFIX = INVESTIGATION_POLYGONS_FULL_ID.replace(/\./g, "__");
const LINE_LAYER_ID_PREFIX = INVESTIGATION_LINES_FULL_ID.replace(/\./g, "__");
const LINE_PAST_SOURCE_ID = "nli-investigation-line-past";
const LINE_PAST_LAYER_ID = "nli-investigation-line-past-line";
const LINE_ACTIVE_SOURCE_ID = "nli-investigation-line-active";
const LINE_ACTIVE_LAYER_ID = "nli-investigation-line-active-line";
const LINE_PROGRESS_COLOR = "#c31f4f";
const LINE_PROGRESS_WIDTH = 2.6;
const LINE_HEAD_SOURCE_ID = "nli-investigation-line-head";
const LINE_HEAD_LAYER_ID = "nli-investigation-line-head-circle";
const LINE_HEAD_RADIUS = 3.2;
const LINE_HEAD_HIDE_AT = 0.999;

/** @type {WeakMap<object, object>} */
const stateByMap = new WeakMap();

/** Jump flash consume keyed by revision; survives dispose/remount of the same map. @type {WeakMap<object, number>} */
const consumedJumpRevisionByMap = new WeakMap();

/** Per-map paused+jump one-shot origin: first non-stale apply of that revision. @type {WeakMap<object, { revision: number, originMs: number }>} */
const jumpOneShotOriginByMap = new WeakMap();

/** In-flight sync generation + requested revision so a later Stop can abort an older Play. @type {WeakMap<object, { generation: number, revision: number }>} */
const syncRequestByMap = new WeakMap();

function beginTimelineSyncRequest(map, clock) {
  const prev = syncRequestByMap.get(map);
  const request = {
    generation: (prev?.generation || 0) + 1,
    revision: Number.isFinite(Number(clock?.revision)) ? Number(clock.revision) : 0,
  };
  syncRequestByMap.set(map, request);
  return request;
}

function isStaleTimelineSyncRequest(map, request) {
  const latest = syncRequestByMap.get(map);
  if (!latest || latest.generation !== request.generation) return true;
  if (request.revision < latest.revision) return true;
  return false;
}

export function parseLocalTimelineToMinutes(value) {
  if (typeof value !== "string") return null;
  const match = /^local\s+(\d{1,2}):(\d{2})$/i.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function objectIdsActiveAt(features, minutes) {
  const active = [];
  for (const feature of features || []) {
    if (Number(feature?.properties?.timeline_minutes) !== minutes) continue;
    const oid = feature?.properties?.OBJECTID;
    if (oid != null) active.push(oid);
  }
  return active;
}

export function namesActiveAt(features, minutes) {
  const names = [];
  for (const feature of features || []) {
    if (Number(feature?.properties?.timeline_minutes) !== minutes) continue;
    const name = feature?.properties?.Name;
    if (typeof name === "string" && name.trim()) names.push(name.trim());
  }
  return names;
}

export function lineProgressAt(minutes, clock, beatElapsedMs) {
  if (!Number.isFinite(Number(minutes))) return 0;
  if (clock == null) return 1;
  if (minutes < clock) return 1;
  if (minutes > clock) return 0;
  const u = Number(beatElapsedMs) / TIMELINE_BEAT_MS;
  if (!Number.isFinite(u) || u <= 0) return 0;
  return Math.min(1, u);
}

export function orientLineCoordinatesTowardIsrael(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return coords;
  const start = coords[0];
  const end = coords[coords.length - 1];
  if (!Array.isArray(start) || !Array.isArray(end)) return coords;
  if (!(end[0] < start[0])) return coords;
  return [...coords].reverse();
}

function reverseLineGeometry(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return geometry;
  if (geometry.type === "LineString") {
    return { ...geometry, coordinates: [...geometry.coordinates].reverse() };
  }
  if (geometry.type === "MultiLineString") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((part) => (Array.isArray(part) ? [...part].reverse() : part)),
    };
  }
  return geometry;
}

function orientFeatureTowardIsrael(feature) {
  const coords = getLineCoordinatesFromFeature(feature);
  const oriented = orientLineCoordinatesTowardIsrael(coords);
  if (oriented === coords || oriented.length < 2) return feature;
  return {
    ...feature,
    geometry: reverseLineGeometry(feature?.geometry),
  };
}

function getLineCoordinatesFromFeature(feature) {
  const geom = feature && feature.geometry;
  if (!geom || !Array.isArray(geom.coordinates)) return [];
  if (geom.type === "LineString") {
    return geom.coordinates.filter(
      (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]),
    );
  }
  if (geom.type === "MultiLineString") {
    let best = [];
    for (const part of geom.coordinates) {
      if (!Array.isArray(part)) continue;
      const coords = part.filter(
        (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]),
      );
      if (coords.length > best.length) best = coords;
    }
    return best;
  }
  return [];
}

function segmentLengthApprox(a, b) {
  const latScale = Math.cos((((a[1] + b[1]) * Math.PI) / 180) / 2);
  const dx = (b[0] - a[0]) * Math.max(0.0001, latScale);
  const dy = b[1] - a[1];
  return Math.hypot(dx, dy);
}

function buildPathMetrics(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return { cum: [0], total: 0 };
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + segmentLengthApprox(coords[i - 1], coords[i]));
  }
  return { cum, total: cum[cum.length - 1] || 0 };
}

function pointAtProgress(coords, cum, total, t) {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  if (!Number.isFinite(total) || total <= 0 || coords.length === 1) return coords[0];
  const clamped = Math.min(1, Math.max(0, t));
  const target = clamped * total;
  let seg = 0;
  while (seg < cum.length - 1 && cum[seg + 1] < target) seg++;
  const a = coords[seg];
  const b = coords[Math.min(seg + 1, coords.length - 1)];
  const segStart = cum[seg];
  const segEnd = cum[Math.min(seg + 1, cum.length - 1)];
  const segLen = Math.max(1e-12, segEnd - segStart);
  const local = Math.min(1, Math.max(0, (target - segStart) / segLen));
  return [a[0] + (b[0] - a[0]) * local, a[1] + (b[1] - a[1]) * local];
}

function emptyPointFeatureCollection() {
  return { type: "FeatureCollection", features: [] };
}

function pointsFeatureCollection(coords) {
  if (!Array.isArray(coords) || coords.length === 0) return emptyPointFeatureCollection();
  return {
    type: "FeatureCollection",
    features: coords
      .filter((coord) => coord && Number.isFinite(coord[0]) && Number.isFinite(coord[1]))
      .map((coord) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: coord },
      })),
  };
}

export function lineHeadCoordinatesAt(features, clock, beatElapsedMs) {
  if (clock == null) return [];
  const progress = lineProgressAt(clock, clock, beatElapsedMs);
  if (progress >= LINE_HEAD_HIDE_AT) return [];
  const coords = [];
  for (const feature of features || []) {
    const minutes = Number(feature?.properties?.timeline_minutes);
    if (minutes !== clock) continue;
    const path = orientLineCoordinatesTowardIsrael(getLineCoordinatesFromFeature(feature));
    if (path.length < 2) continue;
    const { cum, total } = buildPathMetrics(path);
    const point = pointAtProgress(path, cum, total, progress);
    if (point) coords.push(point);
  }
  return coords;
}

function asGroupsArray(layerGroups) {
  if (Array.isArray(layerGroups)) return layerGroups;
  if (layerGroups && typeof layerGroups === "object") return Object.values(layerGroups);
  return [];
}

function isNliLayerEnabled(layerGroups, layerId) {
  const groups = asGroupsArray(layerGroups);
  const group = groups.find((g) => g && g.id === "nli");
  if (!group || !Array.isArray(group.layers)) return false;
  const layer = group.layers.find((l) => l && l.id === layerId);
  return !!(layer && layer.enabled);
}

function membershipFromClock(clock) {
  const set = new Set(Array.isArray(clock?.membership) ? clock.membership : []);
  return {
    polygonOn: set.has(INVESTIGATION_POLYGONS_FULL_ID),
    lineOn: set.has(INVESTIGATION_LINES_FULL_ID),
    alarmPlay: set.has(INVESTIGATION_ALARMS_FULL_ID),
  };
}

function styleLayers(map) {
  try {
    const style = typeof map.getStyle === "function" ? map.getStyle() : null;
    return Array.isArray(style?.layers) ? style.layers : [];
  } catch (_) {
    return [];
  }
}

function collectPolygonPaintLayers(map) {
  const fillIds = [];
  const lineIds = [];
  for (const layer of styleLayers(map)) {
    if (!layer || typeof layer.id !== "string") continue;
    if (!layer.id.startsWith(POLYGON_LAYER_ID_PREFIX)) continue;
    if (layer.type === "fill") fillIds.push(layer.id);
    else if (layer.type === "line") lineIds.push(layer.id);
  }
  return { fillIds, lineIds };
}

function collectBaseLineLayerIds(map) {
  const ids = [];
  for (const layer of styleLayers(map)) {
    if (!layer || typeof layer.id !== "string") continue;
    if (!layer.id.startsWith(LINE_LAYER_ID_PREFIX)) continue;
    if (layer.type === "line") ids.push(layer.id);
  }
  return ids;
}

function timelineCaseExpression(clock, { future, past, active }) {
  if (clock == null) return past;
  return [
    "case",
    ["==", ["get", "timeline_minutes"], clock],
    active,
    ["<", ["get", "timeline_minutes"], clock],
    past,
    future,
  ];
}

function mergeSavedPaints(map, saved, layerIds, keys) {
  const next = saved && typeof saved === "object" ? saved : {};
  const fresh = (layerIds || []).filter((id) => !next[id]);
  if (fresh.length === 0) return next;
  return { ...next, ...savePaints(map, fresh, keys) };
}

function raiseLineOverlays(map) {
  if (!map || typeof map.moveLayer !== "function") return;
  for (const id of [LINE_PAST_LAYER_ID, LINE_ACTIVE_LAYER_ID, LINE_HEAD_LAYER_ID]) {
    try {
      if (typeof map.getLayer === "function" && map.getLayer(id)) {
        map.moveLayer(id);
      }
    } catch (_) {
      /* ignore */
    }
  }
}

function raiseStoryLayers(map) {
  if (!map || typeof map.moveLayer !== "function") return;
  const { fillIds, lineIds } = collectPolygonPaintLayers(map);
  for (const id of [...fillIds, ...lineIds]) {
    try {
      if (typeof map.getLayer === "function" && map.getLayer(id)) {
        map.moveLayer(id);
      }
    } catch (_) {
      /* ignore */
    }
  }
  raiseLineOverlays(map);
}

function savePaints(map, layerIds, keys) {
  const saved = {};
  for (const id of layerIds) {
    saved[id] = {};
    for (const key of keys) {
      try {
        saved[id][key] =
          typeof map.getPaintProperty === "function" ? map.getPaintProperty(id, key) : undefined;
      } catch (_) {
        saved[id][key] = undefined;
      }
    }
  }
  return saved;
}

function restorePaints(map, saved) {
  if (!saved || typeof map.setPaintProperty !== "function") return;
  for (const [id, props] of Object.entries(saved)) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined) continue;
      try {
        map.setPaintProperty(id, key, value);
      } catch (_) {
        /* layer may have been removed */
      }
    }
  }
}

function applyPolygonTimelinePaint(map, clock) {
  const { fillIds, lineIds } = collectPolygonPaintLayers(map);
  if (typeof map.setPaintProperty !== "function") return;
  const fillOpacity = timelineCaseExpression(clock, {
    future: FILL_FUTURE,
    past: FILL_PAST,
    active: FILL_ACTIVE,
  });
  const fillColor = timelineCaseExpression(clock, {
    future: FILL_COLOR_FUTURE,
    past: FILL_COLOR_PAST,
    active: FILL_COLOR_ACTIVE,
  });
  const lineOpacity = timelineCaseExpression(clock, {
    future: LINE_OPACITY_FUTURE,
    past: LINE_OPACITY_PAST,
    active: LINE_OPACITY_ACTIVE,
  });
  const lineWidth = timelineCaseExpression(clock, {
    future: LINE_WIDTH_FUTURE,
    past: LINE_WIDTH_PAST,
    active: LINE_WIDTH_ACTIVE,
  });
  const lineColor = timelineCaseExpression(clock, {
    future: LINE_COLOR_FUTURE,
    past: LINE_COLOR_PAST,
    active: LINE_COLOR_ACTIVE,
  });
  for (const id of fillIds) {
    try {
      map.setPaintProperty(id, "fill-opacity", fillOpacity);
      map.setPaintProperty(id, "fill-color", fillColor);
    } catch (_) {
      /* ignore */
    }
  }
  for (const id of lineIds) {
    try {
      map.setPaintProperty(id, "line-opacity", lineOpacity);
      map.setPaintProperty(id, "line-width", lineWidth);
      map.setPaintProperty(id, "line-color", lineColor);
    } catch (_) {
      /* ignore */
    }
  }
}

function lineFeatureCollection(features) {
  return {
    type: "FeatureCollection",
    features: (features || []).map((feature) => {
      const oriented = orientFeatureTowardIsrael(feature);
      const oid = oriented?.properties?.OBJECTID;
      return {
        type: "Feature",
        id: oid,
        properties: oriented?.properties || {},
        geometry: oriented?.geometry || null,
      };
    }),
  };
}

function partitionLineFeatures(features, clock) {
  const past = [];
  const active = [];
  for (const feature of features || []) {
    const minutes = Number(feature?.properties?.timeline_minutes);
    if (!Number.isFinite(minutes)) continue;
    if (clock == null || minutes < clock) past.push(feature);
    else if (minutes === clock) active.push(feature);
  }
  return { past, active };
}

function toOpaqueAndTransparent(color) {
  const c = typeof color === "string" ? color.trim() : LINE_PROGRESS_COLOR;
  if (c.startsWith("#") && (c.length === 7 || c.length === 4)) {
    const hex = c.length === 4 ? `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}` : c;
    const n = parseInt(hex.slice(1), 16);
    if (Number.isFinite(n)) {
      const r = (n >> 16) & 255;
      const g = (n >> 8) & 255;
      const b = n & 255;
      return { opaque: `rgb(${r},${g},${b})`, transparent: `rgba(${r},${g},${b},0)` };
    }
  }
  return { opaque: c, transparent: "rgba(195,31,79,0)" };
}

function buildLineGradientExpression(t, color) {
  const tt = Math.min(1, Math.max(0, t));
  const { opaque, transparent } = toOpaqueAndTransparent(color);
  const eps = 0.00015;
  if (tt <= eps) {
    return ["interpolate", ["linear"], ["line-progress"], 0, opaque, eps, transparent, 1, transparent];
  }
  if (tt >= 1 - eps) {
    return ["interpolate", ["linear"], ["line-progress"], 0, opaque, 1 - eps, opaque, 1, transparent];
  }
  const lo = tt;
  const hi = tt + eps;
  return ["interpolate", ["linear"], ["line-progress"], 0, opaque, lo, opaque, hi, transparent, 1, transparent];
}

function ensureLineOverlay(map, sourceId, layerId, { lineMetrics, paint }) {
  const existing = typeof map.getSource === "function" ? map.getSource(sourceId) : null;
  if (existing) return existing;
  if (typeof map.addSource !== "function" || typeof map.addLayer !== "function") return null;
  map.addSource(sourceId, {
    type: "geojson",
    data: lineFeatureCollection([]),
    lineMetrics: !!lineMetrics,
  });
  map.addLayer({
    id: layerId,
    type: "line",
    source: sourceId,
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint,
  });
  return typeof map.getSource === "function" ? map.getSource(sourceId) : null;
}

function ensureLineHeadOverlay(map) {
  const existing = typeof map.getSource === "function" ? map.getSource(LINE_HEAD_SOURCE_ID) : null;
  if (existing) return existing;
  if (typeof map.addSource !== "function" || typeof map.addLayer !== "function") return null;
  map.addSource(LINE_HEAD_SOURCE_ID, {
    type: "geojson",
    data: emptyPointFeatureCollection(),
  });
  map.addLayer({
    id: LINE_HEAD_LAYER_ID,
    type: "circle",
    source: LINE_HEAD_SOURCE_ID,
    paint: {
      "circle-color": LINE_PROGRESS_COLOR,
      "circle-radius": Math.max(2.25, LINE_HEAD_RADIUS),
      "circle-blur": 0.25,
      "circle-opacity": 0.95,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1.1,
    },
  });
  return typeof map.getSource === "function" ? map.getSource(LINE_HEAD_SOURCE_ID) : null;
}

function ensureLineProgressOverlay(map) {
  ensureLineOverlay(map, LINE_PAST_SOURCE_ID, LINE_PAST_LAYER_ID, {
    lineMetrics: false,
    paint: {
      "line-color": LINE_PROGRESS_COLOR,
      "line-width": LINE_PROGRESS_WIDTH,
      "line-opacity": 1,
    },
  });
  ensureLineOverlay(map, LINE_ACTIVE_SOURCE_ID, LINE_ACTIVE_LAYER_ID, {
    lineMetrics: true,
    paint: {
      "line-width": LINE_PROGRESS_WIDTH,
      "line-gradient": buildLineGradientExpression(0, LINE_PROGRESS_COLOR),
    },
  });
  ensureLineHeadOverlay(map);
}

function setOverlayData(map, sourceId, features) {
  const source = typeof map.getSource === "function" ? map.getSource(sourceId) : null;
  if (source && typeof source.setData === "function") {
    source.setData(lineFeatureCollection(features));
  }
}

function setHeadData(map, coordinates) {
  const source = typeof map.getSource === "function" ? map.getSource(LINE_HEAD_SOURCE_ID) : null;
  if (source && typeof source.setData === "function") {
    source.setData(pointsFeatureCollection(coordinates));
  }
}

function applyLineTrailVisuals(map, features, clock, beatElapsedMs) {
  const { past, active } = partitionLineFeatures(features, clock);
  setOverlayData(map, LINE_PAST_SOURCE_ID, past);
  setOverlayData(map, LINE_ACTIVE_SOURCE_ID, active);
  setHeadData(map, lineHeadCoordinatesAt(features, clock, beatElapsedMs));
  if (typeof map.setPaintProperty !== "function") return;
  const progress = clock == null ? 1 : lineProgressAt(clock, clock, beatElapsedMs);
  try {
    if (typeof map.getLayer === "function" && map.getLayer(LINE_ACTIVE_LAYER_ID)) {
      map.setPaintProperty(
        LINE_ACTIVE_LAYER_ID,
        "line-gradient",
        buildLineGradientExpression(progress, LINE_PROGRESS_COLOR),
      );
    }
  } catch (_) {
    /* ignore */
  }
}

function removeLineProgressOverlay(map) {
  for (const [layerId, sourceId] of [
    [LINE_HEAD_LAYER_ID, LINE_HEAD_SOURCE_ID],
    [LINE_ACTIVE_LAYER_ID, LINE_ACTIVE_SOURCE_ID],
    [LINE_PAST_LAYER_ID, LINE_PAST_SOURCE_ID],
  ]) {
    try {
      if (typeof map.getLayer === "function" && map.getLayer(layerId) && map.removeLayer) {
        map.removeLayer(layerId);
      }
    } catch (_) {
      /* ignore */
    }
    try {
      if (typeof map.getSource === "function" && map.getSource(sourceId) && map.removeSource) {
        map.removeSource(sourceId);
      }
    } catch (_) {
      /* ignore */
    }
  }
}

function hideBaseLines(map, saved) {
  if (!saved || typeof map.setPaintProperty !== "function") return;
  for (const id of Object.keys(saved)) {
    try {
      map.setPaintProperty(id, "line-opacity", 0);
    } catch (_) {
      /* ignore */
    }
  }
}

function ensureCaptionEl(map) {
  if (typeof document === "undefined") return null;
  const container = typeof map.getContainer === "function" ? map.getContainer() : null;
  if (!container || typeof container.appendChild !== "function") return null;
  let el =
    typeof container.querySelector === "function"
      ? container.querySelector(".nli-investigation-timeline-caption")
      : null;
  if (!el) {
    el = document.createElement("div");
    el.className = "nli-investigation-timeline-caption";
    el.hidden = true;
    el.setAttribute("dir", "auto");
    container.appendChild(el);
  }
  return el;
}

function updateCaption(state, phase, previousClock) {
  const el = state.captionEl;
  if (!el) return;
  const showCaption =
    (state.clockPhase === "playing" || state.clockPhase === "paused") &&
    phase.mode === "beat" &&
    phase.clock != null;
  if (!showCaption) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  const clock = formatMinutesAsLocalClock(phase.clock);
  const names = [];
  if (state.polygonOn) names.push(...namesActiveAt(state.polygonFeatures, phase.clock));
  if (state.lineOn) names.push(...namesActiveAt(state.lineFeatures, phase.clock));
  const alarmHtml =
    state.alarmMode === "play"
      ? alarmCaptionHtml(state.alarmFeatures, phase.clock, previousClock)
      : "";
  if (names.length === 0 && !alarmHtml) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  const nameHtml = names.map(escapeCaption).join(" · ");
  const parts = [nameHtml, alarmHtml].filter(Boolean).join(" · ");
  el.hidden = false;
  el.innerHTML = `<div class="nli-tl-clock">${clock}</div><div class="nli-tl-names">${parts}</div>`;
}

function escapeCaption(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rememberJumpOneShotOrigin(map, clock, nowMs) {
  if (clock?.phase !== "paused" || clock?.seekKind !== "jump") return;
  const revision = Number(clock.revision);
  const rec = jumpOneShotOriginByMap.get(map);
  if (rec && rec.revision === revision) return;
  jumpOneShotOriginByMap.set(map, { revision, originMs: nowMs });
}

function clockWithJumpOrigin(map, clock) {
  if (clock?.phase !== "paused" || clock?.seekKind !== "jump") return clock;
  const rec = jumpOneShotOriginByMap.get(map);
  if (!rec || rec.revision !== Number(clock.revision)) return clock;
  return { ...clock, playEpochMs: rec.originMs };
}

function jumpPreviousClock(map, state, vis) {
  const clock = state.clock;
  const beats = Array.isArray(clock?.beats) ? clock.beats : state.beats;
  const isJump = clock?.seekKind === "jump";
  if (!isJump) return flashPreviousClock(beats, vis.clock, { isJump });
  const alreadyConsumed = consumedJumpRevisionByMap.get(map) === clock.revision;
  if (alreadyConsumed) return vis.clock;
  const oneShotActive = clock.phase === "paused" && vis.beatElapsedMs < TIMELINE_BEAT_MS;
  if (oneShotActive) {
    return flashPreviousClock(beats, vis.clock, { isJump });
  }
  consumedJumpRevisionByMap.set(map, clock.revision);
  return vis.clock;
}

function applyPlayingVisuals(map, state, phase) {
  const previousClock = jumpPreviousClock(map, state, phase);
  applyAlarmMode(map, state, state.alarmMode, {
    clock: phase.clock,
    previousClock,
    beatElapsedMs: phase.beatElapsedMs,
  });
  if (state.polygonOn) applyPolygonTimelinePaint(map, phase.clock);
  if (state.lineOn) {
    applyLineTrailVisuals(map, state.lineFeatures, phase.clock, phase.beatElapsedMs);
  }
  if (state.polygonOn || state.lineOn || state.alarmMode === "play") {
    raiseStoryLayers(map);
  }
  updateCaption(state, phase, previousClock);
}

function enablePolygonPlayback(map, state) {
  const { fillIds, lineIds } = collectPolygonPaintLayers(map);
  state.savedFills = mergeSavedPaints(map, state.savedFills, fillIds, ["fill-opacity", "fill-color"]);
  state.savedLines = mergeSavedPaints(map, state.savedLines, lineIds, [
    "line-opacity",
    "line-width",
    "line-color",
  ]);
}

function disablePolygonPlayback(map, state) {
  restorePaints(map, state.savedFills);
  restorePaints(map, state.savedLines);
  state.savedFills = null;
  state.savedLines = null;
}

function enableLinePlayback(map, state) {
  const baseIds = collectBaseLineLayerIds(map);
  state.savedBaseLines = mergeSavedPaints(map, state.savedBaseLines, baseIds, ["line-opacity"]);
  hideBaseLines(map, state.savedBaseLines);
  ensureLineProgressOverlay(map);
  raiseLineOverlays(map);
}

function disableLinePlayback(map, state) {
  restorePaints(map, state.savedBaseLines);
  state.savedBaseLines = null;
  removeLineProgressOverlay(map);
}

function createTimelineState(map, deps = {}) {
  return {
    playing: false,
    clockPhase: "idle",
    clock: null,
    polygonOn: false,
    lineOn: false,
    alarmMode: "off",
    polygonFeatures: null,
    lineFeatures: null,
    alarmFeatures: null,
    beats: [],
    now: typeof deps.now === "function" ? deps.now : () => Date.now(),
    rafId: null,
    captionEl: ensureCaptionEl(map),
    savedFills: null,
    savedLines: null,
    savedBaseLines: null,
    savedAlarms: null,
  };
}

function getOrCreateState(map, deps = {}) {
  let state = stateByMap.get(map);
  if (!state) {
    state = createTimelineState(map, deps);
    stateByMap.set(map, state);
  }
  return state;
}

function stopPlayback(map) {
  const state = stateByMap.get(map);
  if (!state) return;
  if (state.rafId != null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(state.rafId);
  }
  state.rafId = null;
  state.playing = false;
  state.clockPhase = "idle";
  disablePolygonPlayback(map, state);
  disableLinePlayback(map, state);
  updateCaption(state, { mode: "hold", clock: null, index: -1, beatElapsedMs: 0 });
}

function shouldRafClock(clock, vis) {
  if (!clock || !vis) return false;
  if (clock.phase === "playing" && vis.phase !== "ended") return true;
  return (
    clock.phase === "paused" &&
    clock.seekKind === "jump" &&
    vis.beatElapsedMs < TIMELINE_BEAT_MS
  );
}

function tick(map) {
  const state = stateByMap.get(map);
  if (!state?.clock) return;
  const clock = state.clock;
  const nowFn = state.now || (() => Date.now());
  const nowMs = nowFn();
  const vis = evaluateClock(clockWithJumpOrigin(map, clock), nowMs);
  if (clock.phase === "playing" || (clock.phase === "paused" && clock.seekKind === "jump")) {
    applyPlayingVisuals(map, state, vis);
  }
  if (shouldRafClock(clock, vis) && typeof requestAnimationFrame === "function") {
    state.rafId = requestAnimationFrame(() => tick(map));
  } else {
    state.rafId = null;
  }
}

async function loadLayerFeatures(deps, fullId) {
  const provided = deps.featuresById && deps.featuresById[fullId];
  if (Array.isArray(provided)) return provided;
  if (fullId === INVESTIGATION_POLYGONS_FULL_ID && Array.isArray(deps.features)) {
    return deps.features;
  }
  const getLayerDataUrl =
    typeof deps.getLayerDataUrl === "function"
      ? deps.getLayerDataUrl
      : (id) => layerRegistry.getLayerDataUrl(id);
  const url = getLayerDataUrl(fullId);
  if (!url) return [];
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  return Array.isArray(json?.features) ? json.features : [];
}

async function ensureLayerFeatures(state, deps, key, fullId) {
  if (Array.isArray(state[key])) return;
  state[key] = await loadLayerFeatures(deps, fullId);
}

function applyStoryPlayback(map, state) {
  if (state.polygonOn) enablePolygonPlayback(map, state);
  else disablePolygonPlayback(map, state);
  if (state.lineOn) enableLinePlayback(map, state);
  else disableLinePlayback(map, state);
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {import('./nli-investigation-clock.js').NliInvestigationClock|null|undefined} clockInput
 * @param {unknown} layerGroups
 * @param {{
 *   features?: object[],
 *   featuresById?: Record<string, object[]>,
 *   getLayerDataUrl?: (fullId: string) => string | null,
 *   now?: () => number,
 *   visibilityLayerGroups?: unknown,
 * }} [deps]
 */
export async function syncInvestigationTimelineToMap(map, clockInput, layerGroups, deps = {}) {
  if (!map || typeof map.getStyle !== "function") return;
  const visibilityGroups = deps.visibilityLayerGroups != null ? deps.visibilityLayerGroups : layerGroups;
  const clock = normalizeNliClock(clockInput);
  const syncRequest = beginTimelineSyncRequest(map, clock);
  const nowFn = typeof deps.now === "function" ? deps.now : () => Date.now();
  const existing = stateByMap.get(map);

  if (clock.phase === "idle") {
    if (existing && existing.clockPhase !== "idle") {
      stopPlayback(map);
    } else if (existing?.rafId != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(existing.rafId);
      existing.rafId = null;
    }
    const alarmsVisible = isNliLayerEnabled(visibilityGroups, "alarms");
    if (alarmsVisible) {
      const state = getOrCreateState(map, deps);
      state.clock = clock;
      state.clockPhase = "idle";
      state.playing = false;
      state.polygonOn = false;
      state.lineOn = false;
      state.beats = [];
      state.now = nowFn;
      await ensureLayerFeatures(state, deps, "alarmFeatures", INVESTIGATION_ALARMS_FULL_ID);
      if (isStaleTimelineSyncRequest(map, syncRequest)) return;
      applyAlarmMode(map, state, "idle");
      updateCaption(state, { mode: "hold", clock: null, index: -1, beatElapsedMs: 0 });
    } else if (existing) {
      existing.clock = clock;
      existing.clockPhase = "idle";
      existing.playing = false;
      existing.polygonOn = false;
      existing.lineOn = false;
      existing.beats = [];
      applyAlarmMode(map, existing, "off");
      updateCaption(existing, { mode: "hold", clock: null, index: -1, beatElapsedMs: 0 });
    }
    return;
  }

  const mem = membershipFromClock(clock);
  /** @type {'off' | 'idle' | 'play'} */
  const alarmMode = mem.alarmPlay
    ? "play"
    : isNliLayerEnabled(visibilityGroups, "alarms")
      ? "idle"
      : "off";

  const state = getOrCreateState(map, deps);
  if (mem.polygonOn) {
    await ensureLayerFeatures(state, deps, "polygonFeatures", INVESTIGATION_POLYGONS_FULL_ID);
    if (isStaleTimelineSyncRequest(map, syncRequest)) return;
  }
  if (mem.lineOn) {
    await ensureLayerFeatures(state, deps, "lineFeatures", INVESTIGATION_LINES_FULL_ID);
    if (isStaleTimelineSyncRequest(map, syncRequest)) return;
  }
  if (alarmMode !== "off") {
    await ensureLayerFeatures(state, deps, "alarmFeatures", INVESTIGATION_ALARMS_FULL_ID);
    if (isStaleTimelineSyncRequest(map, syncRequest)) return;
  }

  const nowMs = nowFn();
  rememberJumpOneShotOrigin(map, clock, nowMs);
  const vis = evaluateClock(clockWithJumpOrigin(map, clock), nowMs);
  const shouldRaf = shouldRafClock(clock, vis);

  state.clock = clock;
  state.clockPhase = clock.phase;
  state.playing = clock.phase === "playing" || clock.phase === "paused" || clock.phase === "ended";
  state.polygonOn = mem.polygonOn;
  state.lineOn = mem.lineOn;
  state.alarmMode = alarmMode;
  state.beats = Array.isArray(clock.beats) ? clock.beats : [];
  state.now = nowFn;
  if (!state.captionEl) state.captionEl = ensureCaptionEl(map);
  applyStoryPlayback(map, state);
  applyPlayingVisuals(map, state, vis);

  if (shouldRaf) {
    if (state.rafId == null && typeof requestAnimationFrame === "function") {
      state.rafId = requestAnimationFrame(() => tick(map));
    }
  } else if (state.rafId != null) {
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(state.rafId);
    }
    state.rafId = null;
  }
}

export function disposeInvestigationTimelineForMap(map) {
  if (!map) return;
  stopPlayback(map);
  const state = stateByMap.get(map);
  if (state) applyAlarmMode(map, state, "off");
  if (state?.captionEl && state.captionEl.parentNode) {
    state.captionEl.parentNode.removeChild(state.captionEl);
  }
  stateByMap.delete(map);
}
