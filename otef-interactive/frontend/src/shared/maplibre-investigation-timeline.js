/**
 * Global-clock highlight for NLI investigation polygons.
 * Uses the same remote play/stop as Oct 7 (`style.animation` + toggleAnimation).
 * Does not drive route-progress overlays or camera motion.
 */

import layerRegistry from "./layer-registry.js";

export const INVESTIGATION_POLYGONS_FULL_ID = "nli.investigation_polygons";
export const TIMELINE_BEAT_MS = 3200;
export const TIMELINE_HOLD_MS = 2500;

const FILL_FUTURE = 0.1;
const FILL_PAST = 0.32;
const FILL_ACTIVE = 0.58;
const LINE_OPACITY_FUTURE = 0.28;
const LINE_OPACITY_PAST = 0.72;
const LINE_OPACITY_ACTIVE = 1;
const LINE_WIDTH_FUTURE = 1.0;
const LINE_WIDTH_PAST = 1.5;
const LINE_WIDTH_ACTIVE = 2.8;

const LAYER_ID_PREFIX = INVESTIGATION_POLYGONS_FULL_ID.replace(/\./g, "__");

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
  if (list.length === 0) return { mode: "hold", clock: null, index: -1 };
  const cycle = list.length * TIMELINE_BEAT_MS + TIMELINE_HOLD_MS;
  const t = ((Number(elapsedMs) % cycle) + cycle) % cycle;
  if (t >= list.length * TIMELINE_BEAT_MS) {
    return { mode: "hold", clock: null, index: -1 };
  }
  const index = Math.floor(t / TIMELINE_BEAT_MS);
  return { mode: "beat", clock: list[index], index };
}

function asGroupsArray(layerGroups) {
  if (Array.isArray(layerGroups)) return layerGroups;
  if (layerGroups && typeof layerGroups === "object") return Object.values(layerGroups);
  return [];
}

function isInvestigationLayerEnabled(layerGroups) {
  const groups = asGroupsArray(layerGroups);
  const group = groups.find((g) => g && g.id === "nli");
  if (!group || !Array.isArray(group.layers)) return false;
  const layer = group.layers.find((l) => l && l.id === "investigation_polygons");
  return !!(layer && layer.enabled);
}

function isPlayOn(animState) {
  const state = animState && typeof animState === "object" ? animState : {};
  return !!state[INVESTIGATION_POLYGONS_FULL_ID];
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
    if (!layer.id.startsWith(LAYER_ID_PREFIX)) continue;
    if (layer.type === "fill") fillIds.push(layer.id);
    else if (layer.type === "line") lineIds.push(layer.id);
  }
  return { fillIds, lineIds };
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

function applyTimelinePaint(map, clock) {
  const { fillIds, lineIds } = collectPolygonPaintLayers(map);
  if (typeof map.setPaintProperty !== "function") return;
  const fillOpacity = timelineCaseExpression(clock, {
    future: FILL_FUTURE,
    past: FILL_PAST,
    active: FILL_ACTIVE,
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
  for (const id of fillIds) {
    try {
      map.setPaintProperty(id, "fill-opacity", fillOpacity);
    } catch (_) {
      /* ignore */
    }
  }
  for (const id of lineIds) {
    try {
      map.setPaintProperty(id, "line-opacity", lineOpacity);
      map.setPaintProperty(id, "line-width", lineWidth);
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
  const names = namesActiveAt(state.features, phase.clock);
  const namesHtml = names.length
    ? `<div class="nli-tl-names">${names.map(escapeCaption).join(" · ")}</div>`
    : "";
  el.hidden = false;
  el.innerHTML = `<div class="nli-tl-clock">${clock}</div>${namesHtml}`;
}

function escapeCaption(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stopPlayback(map) {
  const state = stateByMap.get(map);
  if (!state) return;
  if (state.rafId != null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(state.rafId);
  }
  state.rafId = null;
  state.playing = false;
  restorePaints(map, state.savedFills);
  restorePaints(map, state.savedLines);
  updateCaption(state, { mode: "hold", clock: null, index: -1 });
  state.savedFills = null;
  state.savedLines = null;
}

function tick(map) {
  const state = stateByMap.get(map);
  if (!state || !state.playing) return;
  const nowFn = state.now || (() => Date.now());
  const phase = timelinePhaseAt(nowFn() - state.startedAt, state.beats);
  applyTimelinePaint(map, phase.clock);
  updateCaption(state, phase);
  if (typeof requestAnimationFrame === "function") {
    state.rafId = requestAnimationFrame(() => tick(map));
  }
}

async function loadFeatures(deps) {
  if (Array.isArray(deps.features)) return deps.features;
  const getLayerDataUrl =
    typeof deps.getLayerDataUrl === "function"
      ? deps.getLayerDataUrl
      : (id) => layerRegistry.getLayerDataUrl(id);
  const url = getLayerDataUrl(INVESTIGATION_POLYGONS_FULL_ID);
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
 *   getLayerDataUrl?: (fullId: string) => string | null,
 *   now?: () => number,
 *   visibilityLayerGroups?: unknown,
 * }} [deps]
 */
export async function syncInvestigationTimelineToMap(map, animState, layerGroups, deps = {}) {
  if (!map || typeof map.getStyle !== "function") return;
  const visibilityGroups = deps.visibilityLayerGroups != null ? deps.visibilityLayerGroups : layerGroups;
  const wantPlay = isPlayOn(animState) && isInvestigationLayerEnabled(visibilityGroups);
  const existing = stateByMap.get(map);

  if (!wantPlay) {
    if (existing) stopPlayback(map);
    return;
  }
  if (existing?.playing) return;

  const features = await loadFeatures(deps);
  const beats = collectTimelineBeats(features);
  const { fillIds, lineIds } = collectPolygonPaintLayers(map);
  const nowFn = typeof deps.now === "function" ? deps.now : () => Date.now();
  const state = {
    playing: true,
    features,
    beats,
    now: nowFn,
    startedAt: nowFn(),
    rafId: null,
    captionEl: ensureCaptionEl(map),
    savedFills: savePaints(map, fillIds, ["fill-opacity"]),
    savedLines: savePaints(map, lineIds, ["line-opacity", "line-width"]),
  };
  stateByMap.set(map, state);
  applyTimelinePaint(map, timelinePhaseAt(0, beats).clock);
  updateCaption(state, timelinePhaseAt(0, beats));
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
