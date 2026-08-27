/**
 * City running-total alarm circles on the investigation timeline clock.
 * Owns paint expressions, overlay GeoJSON count/flash, count labels, idle/play apply, and flash caption HTML.
 * Does not restack polygon/line story layers.
 */

export const INVESTIGATION_ALARMS_FULL_ID = "nli.alarms";
export const ALARM_COUNT_COLOR_STOPS = [
  [1, "#1e3a8a"],
  [7, "#22d3ee"],
  [26, "#a3e635"],
  [77, "#7f1d1d"],
];
export const ALARM_COUNT_RADIUS_STOPS = [
  [1, 4],
  [7, 7],
  [26, 12],
  [77, 16],
];

const ALARM_LAYER_ID_PREFIX = INVESTIGATION_ALARMS_FULL_ID.replace(/\./g, "__");
const ALARM_CIRCLE_LAYER_ID = "nli-investigation-alarm-circles";
const ALARM_COUNT_LAYER_ID = "nli-investigation-alarm-count";
const ALARM_COUNT_SOURCE_ID = "nli-investigation-alarm-count";
const ALARM_COUNT_CAP = 77;
const ALARM_PULSE_MS = 900;
const ALARM_RADIUS_HIDDEN = 1;
const ALARM_FLASH_PULSE_PX = 4;
const ALARM_OPACITY_SETTLED = 0.55;
const ALARM_OPACITY_ACTIVE = 0.9;
const ALARM_FLASH_COLOR = "#fde68a";
const ALARM_PAINT_KEYS = ["circle-radius", "circle-color", "circle-opacity", "circle-stroke-width"];

function isFiniteMinute(value) {
  return typeof value !== "boolean" && Number.isFinite(Number(value));
}

export function quantizeAlarmMinutes(minutes) {
  return 5 * Math.floor(Number(minutes) / 5);
}

function alarmMinutesFromFeature(feature) {
  const raw = feature?.properties?.alarm_minutes;
  if (!Array.isArray(raw)) return [];
  const minutes = [];
  for (const value of raw) {
    if (isFiniteMinute(value)) minutes.push(Number(value));
  }
  return minutes;
}

export function collectAlarmTimelineBeats(alarmFeatures) {
  const beats = new Set();
  for (const feature of alarmFeatures || []) {
    for (const minutes of alarmMinutesFromFeature(feature)) {
      beats.add(quantizeAlarmMinutes(minutes));
    }
  }
  return [...beats].sort((a, b) => a - b);
}

export function countAlarmsAtClock(minutes, clock) {
  const list = Array.isArray(minutes) ? minutes : [];
  if (clock == null) return list.length;
  let n = 0;
  for (const raw of list) {
    if (isFiniteMinute(raw) && Number(raw) <= clock) n += 1;
  }
  return n;
}

export function cityFlashedInWindow(minutes, clock, previousClock) {
  if (clock == null) return false;
  const prev = previousClock == null ? Number.NEGATIVE_INFINITY : previousClock;
  const list = Array.isArray(minutes) ? minutes : [];
  for (const raw of list) {
    if (!isFiniteMinute(raw)) continue;
    const m = Number(raw);
    if (m > prev && m <= clock) return true;
  }
  return false;
}

export function flashingCityNames(features, clock, previousClock) {
  if (clock == null) return { rows: [], totalFlashing: 0 };
  const prev = previousClock == null ? Number.NEGATIVE_INFINITY : previousClock;
  const rows = [];
  for (const feature of features || []) {
    const minutes = feature?.properties?.alarm_minutes;
    if (!cityFlashedInWindow(minutes, clock, previousClock)) continue;
    const city = feature?.properties?.city;
    if (typeof city !== "string" || !city) continue;
    let n = 0;
    for (const raw of minutes) {
      if (!isFiniteMinute(raw)) continue;
      const m = Number(raw);
      if (m > prev && m <= clock) n += 1;
    }
    rows.push({ city, n });
  }
  rows.sort((a, b) => b.n - a.n || (a.city < b.city ? -1 : a.city > b.city ? 1 : 0));
  return { rows: rows.slice(0, 12), totalFlashing: rows.length };
}

function escapeCaption(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function alarmCaptionHtml(features, clock, previousClock) {
  const { rows, totalFlashing } = flashingCityNames(features, clock, previousClock);
  if (rows.length === 0) return "";
  const parts = rows.map((row) => escapeCaption(row.city));
  if (rows.length === 12 && totalFlashing > 12) {
    parts.push(`ועוד ${totalFlashing - 12}`);
  }
  return parts.join(" · ");
}

function interpolateStopsExpression(input, stops) {
  const expr = ["interpolate", ["linear"], input];
  for (const [at, value] of stops) {
    expr.push(at, value);
  }
  return expr;
}

function flashPulsePx(beatElapsedMs) {
  const t = Math.min(1, Math.max(0, Number(beatElapsedMs) / ALARM_PULSE_MS));
  if (t <= 0.5) return ALARM_FLASH_PULSE_PX * (t / 0.5);
  return ALARM_FLASH_PULSE_PX * (1 - (t - 0.5) / 0.5);
}

function overlayCount() {
  return ["coalesce", ["get", "count"], 0];
}

function overlayFlash() {
  return ["boolean", ["get", "flash"], false];
}

function alarmCountInputExpr() {
  return ["min", ALARM_COUNT_CAP, overlayCount()];
}

/** MapLibre circle paint from overlay GeoJSON count/flash. This is what apply sets on the map. */
export function alarmCirclePaint(beatElapsedMs, allowFlash) {
  const count = overlayCount();
  const settledRadius = interpolateStopsExpression(alarmCountInputExpr(), ALARM_COUNT_RADIUS_STOPS);
  const settledColor = interpolateStopsExpression(alarmCountInputExpr(), ALARM_COUNT_COLOR_STOPS);
  if (!allowFlash) {
    return {
      radius: ["case", ["<=", count, 0], ALARM_RADIUS_HIDDEN, settledRadius],
      color: ["case", ["<=", count, 0], ALARM_COUNT_COLOR_STOPS[0][1], settledColor],
      opacity: ["case", ["<=", count, 0], 0, ALARM_OPACITY_SETTLED],
    };
  }
  const pulse = flashPulsePx(beatElapsedMs);
  const flash = overlayFlash();
  return {
    radius: [
      "case",
      ["<=", count, 0],
      ALARM_RADIUS_HIDDEN,
      flash,
      ["+", settledRadius, pulse],
      settledRadius,
    ],
    color: [
      "case",
      ["<=", count, 0],
      ALARM_COUNT_COLOR_STOPS[0][1],
      flash,
      ALARM_FLASH_COLOR,
      settledColor,
    ],
    opacity: [
      "case",
      ["<=", count, 0],
      0,
      flash,
      ALARM_OPACITY_ACTIVE,
      ALARM_OPACITY_SETTLED,
    ],
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

function collectAlarmCircleLayerIds(map) {
  const ids = [];
  for (const layer of styleLayers(map)) {
    if (!layer || typeof layer.id !== "string") continue;
    if (!layer.id.startsWith(ALARM_LAYER_ID_PREFIX)) continue;
    if (layer.type === "circle") ids.push(layer.id);
  }
  return ids;
}

function alarmFeatureId(feature) {
  if (feature?.id != null && feature.id !== "") return feature.id;
  const city = feature?.properties?.city;
  if (typeof city === "string" && city) return city;
  return null;
}

function cityAlarmCount(feature, clock) {
  const props = feature?.properties || {};
  if (clock != null) return countAlarmsAtClock(props.alarm_minutes, clock);
  const total = Number(props.alarm_count_total);
  return Number.isFinite(total) ? total : countAlarmsAtClock(props.alarm_minutes, null);
}

function cityAlarmSnapshots(features, clock, previousClock) {
  const hold = clock == null;
  return (features || []).map((feature) => {
    const minutes = feature?.properties?.alarm_minutes;
    return {
      id: alarmFeatureId(feature),
      city: feature?.properties?.city,
      count: cityAlarmCount(feature, clock),
      flash: hold ? false : cityFlashedInWindow(minutes, clock, previousClock),
      geometry: feature?.geometry || null,
    };
  });
}

function alarmCountFeatureCollection(snapshots) {
  return {
    type: "FeatureCollection",
    features: snapshots.map((row) => ({
      type: "Feature",
      id: row.id,
      properties: {
        city: row.city,
        count: row.count,
        flash: Boolean(row.flash),
      },
      geometry: row.geometry,
    })),
  };
}

function emptyPointFeatureCollection() {
  return { type: "FeatureCollection", features: [] };
}

function ensureAlarmOverlayLayers(map) {
  if (typeof map.addSource !== "function" || typeof map.addLayer !== "function") return;
  const existingSource = typeof map.getSource === "function" ? map.getSource(ALARM_COUNT_SOURCE_ID) : null;
  if (!existingSource) {
    map.addSource(ALARM_COUNT_SOURCE_ID, {
      type: "geojson",
      data: emptyPointFeatureCollection(),
    });
  }
  const hasLayer = (id) => typeof map.getLayer === "function" && map.getLayer(id);
  if (!hasLayer(ALARM_CIRCLE_LAYER_ID)) {
    const settled = alarmCirclePaint(0, false);
    const circleLayer = {
      id: ALARM_CIRCLE_LAYER_ID,
      type: "circle",
      source: ALARM_COUNT_SOURCE_ID,
      paint: {
        "circle-radius": settled.radius,
        "circle-color": settled.color,
        "circle-opacity": settled.opacity,
        "circle-stroke-width": 0,
      },
    };
    if (hasLayer(ALARM_COUNT_LAYER_ID)) {
      map.addLayer(circleLayer, ALARM_COUNT_LAYER_ID);
    } else {
      map.addLayer(circleLayer);
    }
  }
  if (hasLayer(ALARM_COUNT_LAYER_ID)) return;
  map.addLayer({
    id: ALARM_COUNT_LAYER_ID,
    type: "symbol",
    source: ALARM_COUNT_SOURCE_ID,
    filter: [">=", ["get", "count"], 15],
    layout: {
      "text-field": ["to-string", ["get", "count"]],
      "text-size": 11,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "#ffffff",
    },
  });
}

function applyAlarmCountOverlay(map, snapshots) {
  const source = typeof map.getSource === "function" ? map.getSource(ALARM_COUNT_SOURCE_ID) : null;
  if (source && typeof source.setData === "function") {
    source.setData(alarmCountFeatureCollection(snapshots));
  }
}

function removeAlarmOverlayLayers(map) {
  for (const id of [ALARM_COUNT_LAYER_ID, ALARM_CIRCLE_LAYER_ID]) {
    try {
      if (typeof map.getLayer === "function" && map.getLayer(id) && map.removeLayer) {
        map.removeLayer(id);
      }
    } catch (_) {
      /* ignore */
    }
  }
  try {
    if (typeof map.getSource === "function" && map.getSource(ALARM_COUNT_SOURCE_ID) && map.removeSource) {
      map.removeSource(ALARM_COUNT_SOURCE_ID);
    }
  } catch (_) {
    /* ignore */
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

function mergeSavedPaints(map, saved, layerIds, keys) {
  const next = saved && typeof saved === "object" ? saved : {};
  const fresh = (layerIds || []).filter((id) => !next[id]);
  if (fresh.length === 0) return next;
  return { ...next, ...savePaints(map, fresh, keys) };
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

function mountAlarmVisuals(map, state) {
  const ids = collectAlarmCircleLayerIds(map);
  state.savedAlarms = mergeSavedPaints(map, state.savedAlarms, ids, ALARM_PAINT_KEYS);
  ensureAlarmOverlayLayers(map);
}

function unmountAlarmVisuals(map, state) {
  restorePaints(map, state.savedAlarms);
  state.savedAlarms = null;
  removeAlarmOverlayLayers(map);
}

function hidePackAlarmCircles(map, ids) {
  for (const id of ids) {
    try {
      map.setPaintProperty(id, "circle-opacity", 0);
      map.setPaintProperty(id, "circle-stroke-width", 0);
    } catch (_) {
      /* ignore */
    }
  }
}

function applyOverlayCirclePaint(map, paint) {
  try {
    map.setPaintProperty(ALARM_CIRCLE_LAYER_ID, "circle-radius", paint.radius);
    map.setPaintProperty(ALARM_CIRCLE_LAYER_ID, "circle-color", paint.color);
    map.setPaintProperty(ALARM_CIRCLE_LAYER_ID, "circle-opacity", paint.opacity);
    map.setPaintProperty(ALARM_CIRCLE_LAYER_ID, "circle-stroke-width", 0);
  } catch (_) {
    /* ignore */
  }
}

function applyAlarmTimelinePaint(map, features, clock, previousClock, beatElapsedMs) {
  if (typeof map.setPaintProperty !== "function") return;
  const ids = collectAlarmCircleLayerIds(map);
  if (ids.length === 0) return;
  hidePackAlarmCircles(map, ids);
  ensureAlarmOverlayLayers(map);
  const allowFlash = clock != null;
  const paint = alarmCirclePaint(allowFlash ? beatElapsedMs : 0, allowFlash);
  applyOverlayCirclePaint(map, paint);
  const snapshots = cityAlarmSnapshots(features, clock, previousClock);
  applyAlarmCountOverlay(map, snapshots);
}

/**
 * @param {object} map
 * @param {object} state
 * @param {'off' | 'idle' | 'play'} mode
 * @param {{ clock?: number | null, previousClock?: number | null, beatElapsedMs?: number }} [phase]
 */
export function applyAlarmMode(map, state, mode, phase = {}) {
  if (!state) return;
  const prev = state.alarmMode || "off";
  if (mode === "off") {
    if (prev !== "off") unmountAlarmVisuals(map, state);
    state.alarmMode = "off";
    return;
  }
  mountAlarmVisuals(map, state);
  state.alarmMode = mode;
  const clock = mode === "play" ? (phase.clock ?? null) : null;
  const previousClock = mode === "play" ? (phase.previousClock ?? null) : null;
  const beatElapsedMs = mode === "play" ? (phase.beatElapsedMs ?? 0) : 0;
  applyAlarmTimelinePaint(map, state.alarmFeatures, clock, previousClock, beatElapsedMs);
}
