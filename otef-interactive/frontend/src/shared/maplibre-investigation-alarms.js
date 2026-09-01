import {
  INVESTIGATION_ALARMS_FULL_ID,
  collectAlarmTimelineBeats,
  quantizeAlarmMinutes,
} from "./nli-investigation-beats.js";
import { NLI_DISPLAY_PROFILES, NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";

export { INVESTIGATION_ALARMS_FULL_ID, collectAlarmTimelineBeats, quantizeAlarmMinutes };

export const ALARM_COUNT_RADIUS_STOPS = NLI_VISUAL_TOKENS.alarmRadiusStops;

const ALARM_LAYER_ID_PREFIX = INVESTIGATION_ALARMS_FULL_ID.replace(/\./g, "__");
const ALARM_CIRCLE_LAYER_ID = "nli-investigation-alarm-circles";
const ALARM_RIPPLE_LAYER_ID = "nli-investigation-alarm-ripple";
const ALARM_POINTS_SOURCE_ID = "nli-investigation-alarm-points";
const ALARM_COUNT_CAP = 77;
const ALARM_PULSE_MS = NLI_VISUAL_TOKENS.alarmRippleDurationMs;
const ALARM_RADIUS_HIDDEN = 1;
const ALARM_FLASH_PULSE_PX = 4;
const ALARM_RIPPLE_EXPANSION_PX = 8;
const ALARM_OPACITY_SETTLED = 0.55;
const ALARM_OPACITY_ACTIVE = 0.9;
const ALARM_PAINT_KEYS = ["circle-radius", "circle-color", "circle-opacity", "circle-stroke-width"];

function isFiniteMinute(value) {
  return typeof value !== "boolean" && Number.isFinite(Number(value));
}

export function countAlarmsAtClock(minutes, clock) {
  const list = Array.isArray(minutes) ? minutes : [];
  if (clock == null) return list.length;
  let n = 0;
  for (const raw of list) if (isFiniteMinute(raw) && Number(raw) <= clock) n += 1;
  return n;
}

export function cityFlashedInWindow(minutes, clock, previousClock) {
  if (clock == null) return false;
  const prev = previousClock == null ? Number.NEGATIVE_INFINITY : previousClock;
  return (Array.isArray(minutes) ? minutes : []).some(
    (raw) => isFiniteMinute(raw) && Number(raw) > prev && Number(raw) <= clock,
  );
}

export function flashingCityNames(features, clock, previousClock) {
  if (clock == null) return { rows: [], totalFlashing: 0 };
  const prev = previousClock == null ? Number.NEGATIVE_INFINITY : previousClock;
  const rows = [];
  for (const feature of features || []) {
    const minutes = Array.isArray(feature?.properties?.alarm_minutes) ? feature.properties.alarm_minutes : [];
    if (!cityFlashedInWindow(minutes, clock, previousClock)) continue;
    const city = feature?.properties?.city;
    if (typeof city !== "string" || !city) continue;
    const n = minutes.filter((raw) => isFiniteMinute(raw) && Number(raw) > prev && Number(raw) <= clock).length;
    rows.push({ city, n });
  }
  rows.sort((a, b) => b.n - a.n || (a.city < b.city ? -1 : a.city > b.city ? 1 : 0));
  return { rows: rows.slice(0, 12), totalFlashing: rows.length };
}

function profileValue(profile, key, fallback) {
  const value = Number(profile?.[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function interpolateStopsExpression(input, stops, multiplier = 1) {
  const expr = ["interpolate", ["linear"], input];
  for (const [at, value] of stops) expr.push(at, value * multiplier);
  return expr;
}

function flashPulsePx(beatElapsedMs) {
  const t = Math.min(1, Math.max(0, Number(beatElapsedMs) / ALARM_PULSE_MS));
  return t <= 0.5 ? ALARM_FLASH_PULSE_PX * (t / 0.5) : ALARM_FLASH_PULSE_PX * (1 - (t - 0.5) / 0.5);
}

function rippleExpansionPx(elapsedMs) {
  return ALARM_RIPPLE_EXPANSION_PX * Math.min(1, Math.max(0, Number(elapsedMs) / ALARM_PULSE_MS));
}

function overlayCount() {
  return ["coalesce", ["get", "count"], 0];
}

function overlayOnset() {
  return ["boolean", ["get", "onset"], false];
}

function alarmCountInputExpr() {
  return ["min", ALARM_COUNT_CAP, overlayCount()];
}

/** MapLibre circle paint from cumulative count. The color is always siren yellow. */
export function alarmCirclePaint(beatElapsedMs, allowFlash, profile = NLI_DISPLAY_PROFILES.gis) {
  const radiusMultiplier = profileValue(profile, "radiusMultiplier", 1);
  const count = overlayCount();
  const settledRadius = interpolateStopsExpression(alarmCountInputExpr(), ALARM_COUNT_RADIUS_STOPS, radiusMultiplier);
  const yellow = NLI_VISUAL_TOKENS.alarmYellow;
  if (!allowFlash) {
    return {
      radius: ["case", ["<=", count, 0], ALARM_RADIUS_HIDDEN, settledRadius],
      color: ["case", ["<=", count, 0], yellow, yellow],
      opacity: ["case", ["<=", count, 0], 0, ALARM_OPACITY_SETTLED],
    };
  }
  const pulse = flashPulsePx(beatElapsedMs);
  return {
    radius: ["case", ["<=", count, 0], ALARM_RADIUS_HIDDEN, overlayOnset(), ["+", settledRadius, pulse], settledRadius],
    color: yellow,
    opacity: ["case", ["<=", count, 0], 0, overlayOnset(), ALARM_OPACITY_ACTIVE, ALARM_OPACITY_SETTLED],
  };
}

function styleLayers(map) {
  try {
    const style = typeof map?.getStyle === "function" ? map.getStyle() : null;
    return Array.isArray(style?.layers) ? style.layers : [];
  } catch (_) { return []; }
}

function collectAlarmCircleLayerIds(map) {
  return styleLayers(map)
    .filter((layer) => typeof layer?.id === "string" && layer.id.startsWith(ALARM_LAYER_ID_PREFIX) && layer.type === "circle")
    .map((layer) => layer.id);
}

function safelyGetSource(map, id) {
  try { return typeof map?.getSource === "function" ? map.getSource(id) : null; } catch (_) { return null; }
}

function safelyGetLayer(map, id) {
  try { return typeof map?.getLayer === "function" ? map.getLayer(id) : null; } catch (_) { return null; }
}

function removeOwned(map) {
  for (const id of [ALARM_RIPPLE_LAYER_ID, ALARM_CIRCLE_LAYER_ID]) {
    try { if (safelyGetLayer(map, id) && typeof map.removeLayer === "function") map.removeLayer(id); } catch (_) { /* style can disappear */ }
  }
  try { if (safelyGetSource(map, ALARM_POINTS_SOURCE_ID) && typeof map.removeSource === "function") map.removeSource(ALARM_POINTS_SOURCE_ID); } catch (_) { /* style can disappear */ }
}

function savePaints(map, layerIds) {
  const saved = {};
  for (const id of layerIds) {
    saved[id] = {};
    for (const key of ALARM_PAINT_KEYS) {
      try { saved[id][key] = typeof map?.getPaintProperty === "function" ? map.getPaintProperty(id, key) : undefined; } catch (_) { saved[id][key] = undefined; }
    }
  }
  return saved;
}

function restorePaints(map, saved) {
  if (!saved || typeof map?.setPaintProperty !== "function") return;
  for (const [id, properties] of Object.entries(saved)) {
    for (const [key, value] of Object.entries(properties)) {
      if (value === undefined) continue;
      try { map.setPaintProperty(id, key, value); } catch (_) { /* layer can disappear */ }
    }
  }
}

function featureId(feature, index) {
  return String(feature?.id ?? feature?.properties?.OBJECTID ?? feature?.properties?.city ?? `alarm-${index}`);
}

function cityAlarmCount(feature, clock) {
  const props = feature?.properties || {};
  if (clock != null) return countAlarmsAtClock(props.alarm_minutes, clock);
  const total = Number(props.alarm_count_total);
  return Number.isFinite(total) ? total : countAlarmsAtClock(props.alarm_minutes, null);
}

function buildAlarmStructuralRows(features) {
  return (Array.isArray(features) ? features : []).map((feature, index) => {
    const props = feature?.properties || {};
    return {
      id: featureId(feature, index),
      city: props.city,
      minutes: Array.isArray(props.alarm_minutes) ? props.alarm_minutes : [],
      total: props.alarm_count_total,
      geometry: feature?.geometry || null,
    };
  });
}

function alarmRowsFromStructuralRows(rows, clock, onsetBeat, onsetStart, onsetActive) {
  return rows.map((row) => {
    const onset = onsetActive && Number.isFinite(Number(onsetBeat)) && row.minutes.some((raw) =>
      isFiniteMinute(raw) && Number(raw) > onsetStart && Number(raw) <= Number(onsetBeat));
    const total = Number(row.total);
    const count = clock == null
      ? Number.isFinite(total) ? total : countAlarmsAtClock(row.minutes, null)
      : countAlarmsAtClock(row.minutes, clock);
    return {
      type: "Feature",
      id: row.id,
      properties: { city: row.city, count, onset },
      geometry: row.geometry,
    };
  });
}

function featureCollection(features) { return { type: "FeatureCollection", features }; }

function sourceData(map, data) {
  const source = safelyGetSource(map, ALARM_POINTS_SOURCE_ID);
  if (source && typeof source.setData === "function") source.setData(data);
}

function pointsSignature(features) {
  return features.map((feature) => `${feature.id}:${feature.properties.count}:${feature.properties.onset}:${JSON.stringify(feature.geometry)}`).join("|");
}

function addSourceAndLayer(map, sourceId, layer, spec, beforeId) {
  if (typeof map?.addSource !== "function" || typeof map?.addLayer !== "function") return;
  if (!safelyGetSource(map, sourceId)) map.addSource(sourceId, spec);
  if (safelyGetLayer(map, layer.id)) return;
  try { beforeId ? map.addLayer(layer, beforeId) : map.addLayer(layer); } catch (_) { /* style can disappear */ }
}

function hidePackAlarmCircles(map, ids) {
  for (const id of ids) {
    try {
      map.setPaintProperty(id, "circle-opacity", 0);
      map.setPaintProperty(id, "circle-stroke-width", 0);
    } catch (_) { /* layer can disappear during style replacement */ }
  }
}

/** Create a fixed-yellow alarm renderer driven by the shared corrected-time frame. */
export function createInvestigationAlarmRenderer(map, profile = NLI_DISPLAY_PROFILES.gis, deps = {}) {
  const resolvedProfile = typeof profile === "string" ? NLI_DISPLAY_PROFILES[profile] || NLI_DISPLAY_PROFILES.gis : profile || NLI_DISPLAY_PROFILES.gis;
  const radiusMultiplier = profileValue(resolvedProfile, "radiusMultiplier", 1);
  const beforeId = resolvedProfile.beforeId || resolvedProfile.beforeLayerId;
  const seenOnsets = new Set();
  let mounted = false;
  let disposed = false;
  let savedAlarms = null;
  let lastSignature = null;
  let lastFrame = null;
  let lastData = null;
  let activeOnsetId = null;
  let structuralFeatures = null;
  let structuralDataVersion = Symbol("unset");
  let structuralRows = [];
  let structuralRowsBuildCount = 0;
  const rowCache = new Map();
  let resetDone = false;
  let paintsRestored = false;

  function mount() {
    if (disposed) return;
    resetDone = false;
    paintsRestored = false;
    const ids = collectAlarmCircleLayerIds(map);
    if (!savedAlarms) savedAlarms = savePaints(map, ids);
    else {
      const fresh = ids.filter((id) => !Object.prototype.hasOwnProperty.call(savedAlarms, id));
      if (fresh.length) savedAlarms = { ...savedAlarms, ...savePaints(map, fresh) };
    }
    hidePackAlarmCircles(map, ids);
    addSourceAndLayer(map, ALARM_POINTS_SOURCE_ID, {
      id: ALARM_CIRCLE_LAYER_ID,
      type: "circle",
      source: ALARM_POINTS_SOURCE_ID,
      paint: {
        "circle-radius": alarmCirclePaint(0, false, resolvedProfile).radius,
        "circle-color": NLI_VISUAL_TOKENS.alarmYellow,
        "circle-opacity": alarmCirclePaint(0, false, resolvedProfile).opacity,
        "circle-stroke-width": 0,
      },
    }, { type: "geojson", data: featureCollection([]) }, beforeId);
    addSourceAndLayer(map, ALARM_POINTS_SOURCE_ID, {
      id: ALARM_RIPPLE_LAYER_ID,
      type: "circle",
      source: ALARM_POINTS_SOURCE_ID,
      filter: ["==", ["get", "onset"], true],
      paint: {
        "circle-radius": 0,
        "circle-color": NLI_VISUAL_TOKENS.alarmYellow,
        "circle-opacity": 0,
        "circle-stroke-color": NLI_VISUAL_TOKENS.alarmYellow,
        "circle-stroke-opacity": 0,
        "circle-stroke-width": 1.4,
      },
    }, { type: "geojson", data: featureCollection([]) }, beforeId);
    mounted = true;
  }

  function render(frame = {}, data = {}) {
    if (disposed) return;
    if (!mounted || !safelyGetSource(map, ALARM_POINTS_SOURCE_ID)) mount();
    const features = Array.isArray(data) ? data : Array.isArray(data.alarmFeatures) ? data.alarmFeatures : [];
    const onset = frame?.alarmOnset || null;
    const onsetId = frame?.alarmOnsetId || onset?.id || null;
    const elapsedMs = Number.isFinite(Number(onset?.elapsedMs)) ? Math.max(0, Number(onset.elapsedMs)) : ALARM_PULSE_MS;
    const onsetActive = !!onsetId && elapsedMs < ALARM_PULSE_MS &&
      (onsetId === activeOnsetId || !seenOnsets.has(onsetId));
    if (onsetActive) {
      activeOnsetId = onsetId;
      seenOnsets.add(onsetId);
    } else if (onsetId !== activeOnsetId || elapsedMs >= ALARM_PULSE_MS) {
      activeOnsetId = null;
    }
    const rawActiveBeat = frame?.activeBeat;
    const activeBeat = rawActiveBeat != null && Number.isFinite(Number(rawActiveBeat)) ? Number(rawActiveBeat) : null;
    const completed = Array.isArray(frame?.completedBeats) ? frame.completedBeats : [];
    const hasExplicitWindowStart = Object.prototype.hasOwnProperty.call(frame || {}, "alarmOnsetWindowStart");
    const explicitWindowStart = frame?.alarmOnsetWindowStart;
    const onsetStart = hasExplicitWindowStart
      ? (explicitWindowStart != null && Number.isFinite(Number(explicitWindowStart)) ? Number(explicitWindowStart) : Number.NEGATIVE_INFINITY)
      : completed.length ? Number(completed[completed.length - 1]) : Number.NEGATIVE_INFINITY;
    const dataVersion = Object.prototype.hasOwnProperty.call(data || {}, "dataVersion") ? data.dataVersion : null;
    if (features !== structuralFeatures || dataVersion !== structuralDataVersion) {
      structuralFeatures = features;
      structuralDataVersion = dataVersion;
      structuralRows = buildAlarmStructuralRows(features);
      structuralRowsBuildCount += 1;
      rowCache.clear();
      deps.onAlarmStructuralRowsBuild?.({ count: structuralRows.length, dataVersion });
    }
    const rowKey = [
      activeBeat == null ? "" : activeBeat,
      onset?.beat ?? activeBeat ?? "",
      onsetStart,
      onsetActive ? "on" : "off",
    ].join("|");
    let rows = rowCache.get(rowKey);
    if (!rows) {
      rows = alarmRowsFromStructuralRows(
        structuralRows,
        activeBeat,
        onset?.beat ?? activeBeat,
        onsetStart,
        onsetActive,
      );
      rowCache.set(rowKey, rows);
    }
    const signature = pointsSignature(rows);
    if (signature !== lastSignature) {
      sourceData(map, featureCollection(rows));
      lastSignature = signature;
    }
    lastFrame = frame;
    lastData = data;
    const allowFlash = onsetActive;
    const basePaint = alarmCirclePaint(elapsedMs, allowFlash, resolvedProfile);
    const settled = interpolateStopsExpression(alarmCountInputExpr(), ALARM_COUNT_RADIUS_STOPS, radiusMultiplier);
    const rippleRadius = ["case", overlayOnset(), ["+", settled, rippleExpansionPx(elapsedMs)], 0];
    if (typeof map?.setPaintProperty === "function") {
      try {
        map.setPaintProperty(ALARM_CIRCLE_LAYER_ID, "circle-radius", basePaint.radius);
        map.setPaintProperty(ALARM_CIRCLE_LAYER_ID, "circle-color", NLI_VISUAL_TOKENS.alarmYellow);
        map.setPaintProperty(ALARM_CIRCLE_LAYER_ID, "circle-opacity", basePaint.opacity);
        map.setPaintProperty(ALARM_RIPPLE_LAYER_ID, "circle-radius", rippleRadius);
        const opacity = allowFlash ? Math.max(0, 1 - elapsedMs / ALARM_PULSE_MS) : 0;
        map.setPaintProperty(ALARM_RIPPLE_LAYER_ID, "circle-opacity", 0);
        map.setPaintProperty(ALARM_RIPPLE_LAYER_ID, "circle-stroke-opacity", opacity);
      } catch (_) { /* style can disappear between reconciliation calls */ }
    }
  }

  function reset({ preserveBasePaints = false } = {}) {
    if (disposed) return;
    if (resetDone) return;
    removeOwned(map);
    if (!preserveBasePaints && !paintsRestored) {
      restorePaints(map, savedAlarms);
      paintsRestored = true;
    }
    lastSignature = null;
    lastFrame = null;
    lastData = null;
    activeOnsetId = null;
    mounted = false;
    resetDone = true;
  }

  function dispose({ preserveBasePaints = false } = {}) {
    if (disposed) return;
    disposed = true;
    removeOwned(map);
    if (!preserveBasePaints && !paintsRestored) {
      restorePaints(map, savedAlarms);
      paintsRestored = true;
    }
    savedAlarms = null;
    seenOnsets.clear();
    activeOnsetId = null;
    lastSignature = null;
    lastFrame = null;
    lastData = null;
    mounted = false;
    structuralFeatures = null;
    structuralDataVersion = Symbol("disposed");
    structuralRows = [];
    rowCache.clear();
  }

  return {
    mount,
    render,
    reset,
    dispose,
    getDiagnostics: () => ({ structuralRowsBuilds: structuralRowsBuildCount }),
  };
}

/** Compatibility adapter for callers that still switch alarm modes directly. */
export function applyAlarmMode(map, state, mode, phase = {}) {
  if (!state) return;
  const renderer = state.alarmRenderer;
  if (!renderer) throw new Error("Investigation timeline alarm renderer is not initialized");
  const previousMode = state.alarmMode || "off";
  if (mode === "off") {
    if (previousMode !== "off") renderer.reset();
    state.alarmMode = "off";
    return;
  }
  if (previousMode === "off") renderer.mount();
  state.alarmMode = mode;
  if (phase.frame) renderer.render(phase.frame, {
    alarmFeatures: state.alarmFeatures,
    dataVersion: phase.dataVersion ?? state.dataVersion,
  });
}
