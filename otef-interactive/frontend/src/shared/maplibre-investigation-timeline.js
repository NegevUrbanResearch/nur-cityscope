/**
 * Shared-clock highlight for NLI investigation polygons and lines.
 * Uses the same remote play/stop as Oct 7 (`style.animation` + toggleAnimation).
 * Active lines use the same line-gradient trail as Oct 7 ציר layers, once per beat,
 * including the trail-head circle. The head hides when that line's beat finishes.
 * Completed lines stay fully drawn. Base pack lines are hidden while playback runs.
 */

import layerRegistry from "./layer-registry.js";

export const INVESTIGATION_POLYGONS_FULL_ID = "nli.investigation_polygons";
export const INVESTIGATION_LINES_FULL_ID = "nli.lines";
export const TIMELINE_BEAT_MS = 3200;
export const TIMELINE_HOLD_MS = 2500;

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

export function parseLocalTimelineToMinutes(value) {
  if (typeof value !== "string") return null;
  const match = /^local\s+(\d{1,2}):(\d{2})$/i.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function formatMinutesAsLocalClock(minutes) {
  if (!Number.isFinite(minutes)) return "";
  const h = Math.floor(minutes / 60);
  const m = Math.abs(minutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function collectTimelineBeats(features) {
  const beats = new Set();
  for (const feature of features || []) {
    const raw = feature?.properties?.timeline_minutes;
    if (typeof raw === "boolean" || !Number.isFinite(Number(raw))) continue;
    beats.add(Number(raw));
  }
  return [...beats].sort((a, b) => a - b);
}

export function collectUnionTimelineBeats(...featureLists) {
  const merged = [];
  for (const list of featureLists) {
    if (Array.isArray(list)) merged.push(...list);
  }
  return collectTimelineBeats(merged);
}

export function collectPlaybackTimelineBeats(polygonOn, lineOn, polygonFeatures, lineFeatures) {
  return collectUnionTimelineBeats(
    polygonOn ? polygonFeatures : null,
    lineOn ? lineFeatures : null,
  );
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

export function timelinePhaseAt(elapsedMs, beats) {
  const list = Array.isArray(beats) ? beats : [];
  if (list.length === 0) return { mode: "hold", clock: null, index: -1, beatElapsedMs: 0 };
  const cycle = list.length * TIMELINE_BEAT_MS + TIMELINE_HOLD_MS;
  const t = ((Number(elapsedMs) % cycle) + cycle) % cycle;
  if (t >= list.length * TIMELINE_BEAT_MS) {
    return { mode: "hold", clock: null, index: -1, beatElapsedMs: 0 };
  }
  const index = Math.floor(t / TIMELINE_BEAT_MS);
  return {
    mode: "beat",
    clock: list[index],
    index,
    beatElapsedMs: t - index * TIMELINE_BEAT_MS,
  };
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

function isAnimOn(animState, fullId) {
  const state = animState && typeof animState === "object" ? animState : {};
  return !!state[fullId];
}

function participating(animState, layerGroups) {
  return {
    polygonOn:
      isAnimOn(animState, INVESTIGATION_POLYGONS_FULL_ID) &&
      isNliLayerEnabled(layerGroups, "investigation_polygons"),
    lineOn: isAnimOn(animState, INVESTIGATION_LINES_FULL_ID) && isNliLayerEnabled(layerGroups, "lines"),
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

function updateCaption(state, phase) {
  const el = state.captionEl;
  if (!el) return;
  if (!state.playing || phase.mode !== "beat" || phase.clock == null) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  const clock = formatMinutesAsLocalClock(phase.clock);
  const names = [];
  if (state.polygonOn) names.push(...namesActiveAt(state.polygonFeatures, phase.clock));
  if (state.lineOn) names.push(...namesActiveAt(state.lineFeatures, phase.clock));
  if (names.length === 0) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.innerHTML = `<div class="nli-tl-clock">${clock}</div><div class="nli-tl-names">${names.map(escapeCaption).join(" · ")}</div>`;
}

function escapeCaption(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function currentPhase(state) {
  const nowFn = state.now || (() => Date.now());
  return timelinePhaseAt(nowFn() - state.startedAt, state.beats);
}

function applyPlayingVisuals(map, state, phase) {
  if (state.polygonOn) applyPolygonTimelinePaint(map, phase.clock);
  if (state.lineOn) {
    applyLineTrailVisuals(map, state.lineFeatures, phase.clock, phase.beatElapsedMs);
    raiseLineOverlays(map);
  }
  updateCaption(state, phase);
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

function stopPlayback(map) {
  const state = stateByMap.get(map);
  if (!state) return;
  if (state.rafId != null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(state.rafId);
  }
  state.rafId = null;
  state.playing = false;
  disablePolygonPlayback(map, state);
  disableLinePlayback(map, state);
  updateCaption(state, { mode: "hold", clock: null, index: -1, beatElapsedMs: 0 });
}

function tick(map) {
  const state = stateByMap.get(map);
  if (!state || !state.playing) return;
  applyPlayingVisuals(map, state, currentPhase(state));
  if (typeof requestAnimationFrame === "function") {
    state.rafId = requestAnimationFrame(() => tick(map));
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

/**
 * @param {import('maplibre-gl').Map} map
 * @param {Record<string, boolean>|null|undefined} animState
 * @param {unknown} layerGroups
 * @param {{
 *   features?: object[],
 *   featuresById?: Record<string, object[]>,
 *   getLayerDataUrl?: (fullId: string) => string | null,
 *   now?: () => number,
 *   visibilityLayerGroups?: unknown,
 * }} [deps]
 */
export async function syncInvestigationTimelineToMap(map, animState, layerGroups, deps = {}) {
  if (!map || typeof map.getStyle !== "function") return;
  const visibilityGroups = deps.visibilityLayerGroups != null ? deps.visibilityLayerGroups : layerGroups;
  const want = participating(animState, visibilityGroups);
  const wantPlay = !!(want.polygonOn || want.lineOn);
  const existing = stateByMap.get(map);

  if (!wantPlay) {
    if (existing) stopPlayback(map);
    return;
  }

  if (existing?.playing) {
    existing.polygonOn = want.polygonOn;
    existing.lineOn = want.lineOn;
    existing.beats = collectPlaybackTimelineBeats(
      want.polygonOn,
      want.lineOn,
      existing.polygonFeatures,
      existing.lineFeatures,
    );
    if (want.polygonOn) enablePolygonPlayback(map, existing);
    else disablePolygonPlayback(map, existing);
    if (want.lineOn) enableLinePlayback(map, existing);
    else disableLinePlayback(map, existing);
    applyPlayingVisuals(map, existing, currentPhase(existing));
    return;
  }

  const [polygonFeatures, lineFeatures] = await Promise.all([
    loadLayerFeatures(deps, INVESTIGATION_POLYGONS_FULL_ID),
    loadLayerFeatures(deps, INVESTIGATION_LINES_FULL_ID),
  ]);
  const beats = collectPlaybackTimelineBeats(
    want.polygonOn,
    want.lineOn,
    polygonFeatures,
    lineFeatures,
  );
  const nowFn = typeof deps.now === "function" ? deps.now : () => Date.now();
  const state = {
    playing: true,
    polygonOn: want.polygonOn,
    lineOn: want.lineOn,
    polygonFeatures,
    lineFeatures,
    beats,
    now: nowFn,
    startedAt: nowFn(),
    rafId: null,
    captionEl: ensureCaptionEl(map),
    savedFills: null,
    savedLines: null,
    savedBaseLines: null,
  };
  stateByMap.set(map, state);
  if (want.polygonOn) enablePolygonPlayback(map, state);
  if (want.lineOn) enableLinePlayback(map, state);
  applyPlayingVisuals(map, state, timelinePhaseAt(0, beats));
  if (typeof requestAnimationFrame === "function") {
    state.rafId = requestAnimationFrame(() => tick(map));
  }
}

export function disposeInvestigationTimelineForMap(map) {
  if (!map) return;
  stopPlayback(map);
  const state = stateByMap.get(map);
  if (state?.captionEl && state.captionEl.parentNode) {
    state.captionEl.parentNode.removeChild(state.captionEl);
  }
  stateByMap.delete(map);
}
