/**
 * GIS/projection settlement orientation: dim pack ישובים + Locations_Lines
 * during play/pause, and light שמות_יישובים labels whose cityname joins an
 * achieved sidecar outline. שמות callout `__leader` lines follow the same
 * opacity as the names. Paint targets IR-mangled MapLibre layer ids.
 */

import { peekLayerLifecycleRuntime, setPaintChannelsRememberedListener } from "./layer-lifecycle-fade.js";
import { NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";
import { resolveMotionMode } from "./reduced-motion.js";

const YISHUVIM_LAYER_PREFIX = "projector_base__ישובים";
const SHEMOT_LAYER_PREFIX = "projector_base__שמות_יישובים";
const LOCATIONS_LAYER_PREFIX = "projector_base__Locations_Lines";
const SHEMOT_SOURCE_ID = "projector_base.שמות_יישובים";
const YISHUVIM_SOURCE_ID = "projector_base.ישובים";
const LOCATIONS_SOURCE_ID = "projector_base.Locations_Lines";
const ORIENTATION_ROLES = ["label", "leader", "geom", "location-line"];
const KIBBUTZ_PREFIX = /^קיבוץ /;
const PLAY_OPACITY = NLI_VISUAL_TOKENS.dimOpacity;
const DIM_TEXT_OPACITY = NLI_VISUAL_TOKENS.dimOpacity;
const FULL_OPACITY = 1;
const MEMORIAL_OPACITY = NLI_VISUAL_TOKENS.dimOpacity;
const MEMORIAL_TEXT_OPACITY = NLI_VISUAL_TOKENS.dimOpacity;
const MEMORIAL_TRANSITION = { duration: 350, delay: 0 };
const IMMEDIATE_TRANSITION = { duration: 0, delay: 0 };
const ORIENTATION_TRANSITION = {
  duration: NLI_VISUAL_TOKENS.highlightOpacityTransitionMs,
  delay: 0,
};
const paintStates = new WeakMap();
const attachments = new WeakMap();
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function paintState(map) {
  let state = paintStates.get(map);
  if (!state) {
    state = { memorial: null, values: new Map(), roleGoals: new Map(), publishedMemorial: null };
    paintStates.set(map, state);
  }
  return state;
}

function orientationTweenMs() {
  return resolveMotionMode() === "reduced" ? 0 : ORIENTATION_TRANSITION.duration;
}

function memorialTweenMs(previous, next) {
  if (resolveMotionMode() === "reduced") return 0;
  if (next == null) return ORIENTATION_TRANSITION.duration;
  if (previous == null || previous.strength !== next.strength) return 0;
  return ORIENTATION_TRANSITION.duration;
}

function fullIdForTarget(map, target) {
  const source = map.getLayer?.(target?.id)?.source;
  if (source) return source;
  const id = target?.id;
  if (typeof id !== "string") return null;
  if (id.startsWith(SHEMOT_LAYER_PREFIX)) return SHEMOT_SOURCE_ID;
  if (id.startsWith(YISHUVIM_LAYER_PREFIX)) return YISHUVIM_SOURCE_ID;
  if (id.startsWith(LOCATIONS_LAYER_PREFIX)) return LOCATIONS_SOURCE_ID;
  return null;
}

function roleForChannel(layerId, type, property) {
  if (typeof layerId !== "string") return null;
  if (layerId.startsWith(SHEMOT_LAYER_PREFIX)) {
    if (type === "symbol" && property === "text-opacity") return "label";
    if (type === "line" && property === "line-opacity") return "leader";
    return null;
  }
  if (layerId.startsWith(YISHUVIM_LAYER_PREFIX)) {
    if (type === "fill" && property === "fill-opacity") return "geom";
    if (type === "line" && property === "line-opacity") return "geom";
    return null;
  }
  if (layerId.startsWith(LOCATIONS_LAYER_PREFIX)) {
    if (type === "fill" && property === "fill-opacity") return "location-line";
    if (type === "line" && property === "line-opacity") return "location-line";
    return null;
  }
  return null;
}

function focusedForRole(role, memorial) {
  const isName = role === "label" || role === "leader";
  const memorialDim = isName ? MEMORIAL_TEXT_OPACITY : MEMORIAL_OPACITY;
  if (isName && memorial?.placeName) {
    return ["case", ["==", ["get", "cityname"], memorial.placeName], FULL_OPACITY, memorialDim];
  }
  return memorialDim;
}

function mixPolicy(base, focused, strength) {
  if (strength === 1) return focused;
  if (typeof base === "number" && typeof focused === "number") {
    return base * (1 - strength) + focused * strength;
  }
  return ["+", ["*", base, 1 - strength], ["*", focused, strength]];
}

function baseForRole(state, role) {
  if (state.roleGoals.has(role)) return state.roleGoals.get(role);
  return FULL_OPACITY;
}

function lookupAuthoredLocationLine(map, targets) {
  const runtime = peekLayerLifecycleRuntime(map);
  for (const target of targets) {
    if (target?.role !== "location-line" || !target.property) continue;
    const fullId = fullIdForTarget(map, target);
    if (fullId && runtime?.hasPaintChannel?.(fullId, target.property)) {
      const authored = runtime.readAuthoredOpacity(fullId, target.property);
      if (authored !== undefined) return authored;
      continue;
    }
    if (typeof map.getLayer === "function" && !map.getLayer(target.id)) continue;
    const painted = map.getPaintProperty?.(target.id, target.property);
    if (painted !== undefined) return painted;
  }
  return undefined;
}

function retainedLocationLine(map, targets, state) {
  if (state.roleGoals.has("location-line")) return state.roleGoals.get("location-line");
  return lookupAuthoredLocationLine(map, targets);
}

function storePublishedMemorial(state) {
  if (!state.memorial) {
    state.publishedMemorial = null;
    return;
  }
  const goals = new Map();
  for (const role of ORIENTATION_ROLES) {
    const base = baseForRole(state, role);
    goals.set(role, mixPolicy(base, focusedForRole(role, state.memorial), state.memorial.strength ?? 0));
  }
  state.publishedMemorial = goals;
}

function publishOwned(map, target, value, tweenMs) {
  if (value === undefined) return false;
  const fullId = fullIdForTarget(map, target);
  if (!fullId) return false;
  const runtime = peekLayerLifecycleRuntime(map);
  if (typeof runtime?.updateEffectivePaint !== "function") return false;
  return runtime.updateEffectivePaint(fullId, target.id, target.property, value, { tweenMs }) === true;
}

function replayRememberedChannels(map, event) {
  if (!event || !Array.isArray(event.channels)) return;
  const state = paintState(map);
  const runtime = peekLayerLifecycleRuntime(map);
  if (typeof runtime?.updateEffectivePaint !== "function") return;
  for (const channel of event.channels) {
    const role = roleForChannel(channel.layerId, channel.type, channel.property);
    if (!role) continue;
    const value = state.memorial
      ? state.publishedMemorial?.get(role)
      : state.roleGoals.get(role);
    if (value === undefined) continue;
    runtime.updateEffectivePaint(event.fullId, channel.layerId, channel.property, value, { tweenMs: 0 });
  }
}

/** Register mount replay once. Map removal clears the attachment. */
export function attachSettlementOrientationRuntime(map) {
  if (!map || attachments.has(map)) return;
  const onRemove = () => {
    attachments.delete(map);
  };
  attachments.set(map, onRemove);
  setPaintChannelsRememberedListener(map, (event) => replayRememberedChannels(map, event));
  if (typeof map.on === "function") map.on("remove", onRemove);
}

function pruneMissingTargets(map) {
  if (!map.getLayer) return;
  const state = paintState(map);
  for (const id of state.values.keys()) {
    if (!map.getLayer(id)) state.values.delete(id);
  }
}

function rememberTarget(map, target) {
  const state = paintState(map);
  const layer = map.getLayer?.(target.id);
  const previous = state.values.get(target.id);
  if (previous && previous.layer === layer && previous.property === target.property) return previous;
  const value = map.getPaintProperty?.(target.id, target.property) ?? FULL_OPACITY;
  const entry = { layer, property: target.property, value,
    transition: map.getPaintProperty?.(target.id, `${target.property}-transition`) };
  state.values.set(target.id, entry);
  return entry;
}

function paintTarget(map, target) {
  const state = paintState(map);
  if (map.getLayer && !map.getLayer(target.id)) {
    state.values.delete(target.id);
    return;
  }
  const entry = rememberTarget(map, target);
  const memorial = state.memorial;
  const isName = target.role === "label" || target.role === "leader";
  const memorialDim = isName ? MEMORIAL_TEXT_OPACITY : MEMORIAL_OPACITY;
  const focused = isName && memorial?.placeName
    ? ["case", ["==", ["get", "cityname"], memorial.placeName], FULL_OPACITY, memorialDim]
    : memorialDim;
  const strength = memorial?.strength ?? 0;
  const value = memorial === null ? entry.value : strength === 1 ? focused
    : typeof entry.value === 'number' && typeof focused === 'number'
      ? entry.value * (1 - strength) + focused * strength
      : ['+', ['*', entry.value, 1 - strength], ['*', focused, strength]];
  const transitionKey = `${target.property}-transition`;
  const transition = memorial === null ? entry.transition ?? ORIENTATION_TRANSITION
    : strength === 1 ? MEMORIAL_TRANSITION : IMMEDIATE_TRANSITION;
  if (!equal(map.getPaintProperty?.(target.id, transitionKey) ?? null, transition)) {
    setPaint(map, target.id, transitionKey, transition);
  }
  if (!equal(map.getPaintProperty?.(target.id, target.property), value)) {
    setPaint(map, target.id, target.property, value);
  }
}

function republishMemorial(map, state) {
  if (!state.memorial || !state.publishedMemorial) return;
  pruneMissingTargets(map);
  for (const target of collectOrientationTargets(map).layers) {
    const value = state.publishedMemorial.get(target.role);
    if (publishOwned(map, target, value, orientationTweenMs())) continue;
    paintTarget(map, target);
  }
}

/** Memorial presentation owns effective settlement opacity while mounted. */
export function setMemorialSettlementFocus(map, { active = false, placeName = null, strength = 1 } = {}) {
  if (!map) return;
  if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw new Error('invalid memorial focus strength');
  const state = paintState(map);
  pruneMissingTargets(map);
  const next = active ? { placeName, strength } : null;
  const previous = state.memorial;
  if (equal(previous, next)) {
    republishMemorial(map, state);
    return;
  }
  state.memorial = next;
  const tweenMs = memorialTweenMs(previous, next);
  if (next) storePublishedMemorial(state);
  else state.publishedMemorial = null;
  const targets = collectOrientationTargets(map).layers;
  if (!next && !state.roleGoals.has("location-line")) {
    const authored = lookupAuthoredLocationLine(map, targets);
    if (authored !== undefined) state.roleGoals.set("location-line", authored);
  }
  for (const target of targets) {
    const value = next ? state.publishedMemorial.get(target.role) : baseForRole(state, target.role);
    if (publishOwned(map, target, value, tweenMs)) continue;
    paintTarget(map, target);
  }
}

/** Reapply the stored memorial goal. Does not rebuild it from rendered paint. */
export function refreshMemorialSettlementFocus(map) {
  if (!map || paintState(map).memorial === null) return;
  republishMemorial(map, paintState(map));
}

/** @type {Set<string>} */
const warnedUnmatchedLocations = new Set();

function styleLayers(map) {
  try {
    const layers = map?.getStyle?.()?.layers;
    return Array.isArray(layers) ? layers : [];
  } catch (_) {
    return [];
  }
}

function featuresFromData(data) {
  if (!data || typeof data === "string") return [];
  if (Array.isArray(data.features)) return data.features;
  if (Array.isArray(data)) return data;
  return [];
}

function featuresFromSource(source) {
  if (!source) return [];
  const fromLoaded = featuresFromData(source._data);
  if (fromLoaded.length) return fromLoaded;
  const fromData = featuresFromData(source.data);
  if (fromData.length) return fromData;
  if (typeof source.serialize === "function") {
    try {
      const fromSerialized = featuresFromData(source.serialize()?.data);
      if (fromSerialized.length) return fromSerialized;
    } catch (_) {
      /* serialize can throw on a torn-down source */
    }
  }
  return [];
}

function shemotSourceFeatures(map, sourceId = SHEMOT_SOURCE_ID) {
  const fromSource = featuresFromSource(
    typeof map?.getSource === "function" ? map.getSource(sourceId) : null,
  );
  if (fromSource.length) return fromSource;
  if (typeof map?.querySourceFeatures === "function") {
    try {
      const queried = map.querySourceFeatures(sourceId);
      if (Array.isArray(queried)) return queried;
    } catch (_) {
      /* source may be missing */
    }
  }
  return [];
}

function matchKnownCityname(location, known) {
  if (location == null) return null;
  const raw = String(location);
  if (known.has(raw)) return raw;
  const stripped = raw.replace(KIBBUTZ_PREFIX, "");
  if (stripped !== raw && known.has(stripped)) return stripped;
  return null;
}

function warnUnknownLocation(location) {
  const key = String(location ?? "");
  if (warnedUnmatchedLocations.has(key)) return;
  warnedUnmatchedLocations.add(key);
  console.warn(`[nli] settlement location has no שמות cityname: ${key}`);
}

function opacityPropertyForType(type) {
  if (type === "fill") return "fill-opacity";
  if (type === "line") return "line-opacity";
  if (type === "symbol") return "text-opacity";
  return null;
}

function setPaint(map, id, key, value) {
  if (typeof map?.setPaintProperty !== "function") return;
  try {
    map.setPaintProperty(id, key, value);
  } catch (_) {
    /* layer may have been removed during a style reload */
  }
}

/** Collect `cityname` values from the mounted projector_base שמות source. */
export function collectKnownCitynamesFromMap(map, sourceId = SHEMOT_SOURCE_ID) {
  const names = new Set();
  for (const feature of shemotSourceFeatures(map, sourceId || SHEMOT_SOURCE_ID)) {
    const cityname = feature?.properties?.cityname;
    if (cityname == null) continue;
    const text = String(cityname);
    if (text) names.add(text);
  }
  return names;
}

/** Leaders share שמות `OBJECTID`, not yeshuv `outlineObjectId`. */
export function collectShemotObjectIdsForCitynames(map, citynames, sourceId = SHEMOT_SOURCE_ID) {
  const wanted = new Set(
    (citynames instanceof Set ? [...citynames] : Array.isArray(citynames) ? citynames : [])
      .map(String)
      .filter(Boolean),
  );
  const ids = [];
  const seen = new Set();
  if (wanted.size === 0) return ids;
  for (const feature of shemotSourceFeatures(map, sourceId || SHEMOT_SOURCE_ID)) {
    const cityname = feature?.properties?.cityname;
    if (cityname == null || !wanted.has(String(cityname))) continue;
    const objectId = feature?.properties?.OBJECTID;
    if (objectId == null) continue;
    const numeric = Number(objectId);
    const id = Number.isFinite(numeric) ? numeric : objectId;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    ids.push(id);
  }
  return ids;
}

/** Scan live IR-mangled orientation layer ids once per style (not per RAF). */
export function collectOrientationTargets(map) {
  const layers = [];
  let shemotSourceId = SHEMOT_SOURCE_ID;
  for (const layer of styleLayers(map)) {
    const id = layer?.id;
    if (typeof id !== "string") continue;
    if (id.startsWith(SHEMOT_LAYER_PREFIX)) {
      if (layer.source) shemotSourceId = layer.source;
      if (layer.type === "symbol") layers.push({ id, property: "text-opacity", role: "label" });
      else if (layer.type === "line") layers.push({ id, property: "line-opacity", role: "leader" });
      continue;
    }
    if (id.startsWith(YISHUVIM_LAYER_PREFIX)) {
      const property = opacityPropertyForType(layer.type);
      if (property) layers.push({ id, property, role: "geom" });
      continue;
    }
    if (id.startsWith(LOCATIONS_LAYER_PREFIX)) {
      const property = opacityPropertyForType(layer.type);
      if (property) layers.push({ id, property, role: "location-line" });
    }
  }
  return { layers, shemotSourceId };
}

/**
 * Join achieved sidecar outline ids to שמות `cityname` values.
 * A location lights only when the exact string, or the same string with a
 * leading `קיבוץ ` stripped, is in `knownCitynames`.
 */
export function achievedSettlementCitynames(outlineIds, settlementFeatures, knownCitynames) {
  const achieved = new Set((Array.isArray(outlineIds) ? outlineIds : []).map((id) => String(id)));
  const known = knownCitynames instanceof Set ? knownCitynames : new Set();
  const names = new Set();
  if (achieved.size === 0) return names;
  for (const feature of Array.isArray(settlementFeatures) ? settlementFeatures : []) {
    const outlineId = feature?.properties?.outlineObjectId;
    if (outlineId == null || !achieved.has(String(outlineId))) continue;
    const locations = feature?.properties?.locations;
    if (!Array.isArray(locations)) continue;
    for (const location of locations) {
      const matched = matchKnownCityname(location, known);
      if (matched != null) names.add(matched);
      else if (known.size > 0) warnUnknownLocation(location);
    }
  }
  return names;
}

/**
 * Dim ישובים + Locations_Lines while playing/paused/ended; light achieved
 * שמות labels. Idle restores opacity 1 and drops the dim expression.
 */
export function applySettlementOrientationPaint(map, {
  phase,
  achievedCitynames,
  layers,
  focusCityname,
  focusOutlineObjectId,
  mode,
  leaderObjectIds,
  shemotSourceId,
  keepFocusLabelWithAchieved,
} = {}) {
  if (!map) return;
  const hasFocusName = mode === "narrative"
    && typeof focusCityname === "string"
    && focusCityname.length > 0;
  const narrativeFocus = hasFocusName && focusOutlineObjectId != null;
  const dimAllYeshuvs = mode === "narrative" && !hasFocusName;
  const dim = phase === "playing" || phase === "paused" || phase === "ended" || dimAllYeshuvs;
  const geomOpacity = dim ? PLAY_OPACITY : FULL_OPACITY;
  const citynames = [
    ...(achievedCitynames instanceof Set
      ? achievedCitynames
      : Array.isArray(achievedCitynames)
        ? achievedCitynames
        : []),
  ].map(String);
  const citynameCase = citynames.length > 0
    ? ["case", ["in", ["get", "cityname"], ["literal", citynames]], FULL_OPACITY, DIM_TEXT_OPACITY]
    : DIM_TEXT_OPACITY;
  const unionFocusLabels = hasFocusName && (keepFocusLabelWithAchieved === true || !narrativeFocus);
  const focusLabelNames = unionFocusLabels
    ? [...new Set([focusCityname, ...citynames])]
    : [];
  const textOpacity = narrativeFocus && !unionFocusLabels
    ? ["case", ["==", ["get", "cityname"], focusCityname], FULL_OPACITY, DIM_TEXT_OPACITY]
    : focusLabelNames.length > 0
    ? ["case", ["in", ["get", "cityname"], ["literal", focusLabelNames]], FULL_OPACITY, DIM_TEXT_OPACITY]
    : dimAllYeshuvs
    ? citynameCase
    : dim
    ? ["case", ["in", ["get", "cityname"], ["literal", citynames]], FULL_OPACITY, DIM_TEXT_OPACITY]
    : FULL_OPACITY;
  const geomPaint = narrativeFocus
    ? ["case", ["==", ["get", "OBJECTID"], focusOutlineObjectId], FULL_OPACITY, PLAY_OPACITY]
    : hasFocusName
    ? PLAY_OPACITY
    : geomOpacity;
  const collected = Array.isArray(layers) ? { layers, shemotSourceId } : collectOrientationTargets(map);
  const targets = collected.layers;
  const sourceId = shemotSourceId || collected.shemotSourceId || SHEMOT_SOURCE_ID;
  const leaderIds = uniqueLeaderObjectIds(
    Array.isArray(leaderObjectIds)
      ? leaderObjectIds
      : dimAllYeshuvs && citynames.length > 0
        ? collectShemotObjectIdsForCitynames(map, citynames, sourceId)
        : [],
  );
  const leaderOpacity = leaderIds.length
    ? ["case", ["in", ["get", "OBJECTID"], ["literal", leaderIds]], FULL_OPACITY, PLAY_OPACITY]
    : null;
  const state = paintState(map);
  const locationLineGoal = mode === "narrative" && narrativeFocus && state.memorial
    ? retainedLocationLine(map, targets, state)
    : mode === "narrative"
      ? (leaderOpacity ?? PLAY_OPACITY)
      : geomOpacity;
  state.roleGoals.set("label", textOpacity);
  state.roleGoals.set("leader", textOpacity);
  state.roleGoals.set("geom", geomPaint);
  if (locationLineGoal !== undefined) state.roleGoals.set("location-line", locationLineGoal);

  for (const target of targets) {
    if (!target?.id || !target.property) continue;
    if (map.getLayer && !map.getLayer(target.id)) {
      state.values.delete(target.id);
      continue;
    }
    if (state.memorial && state.publishedMemorial) {
      if (publishOwned(map, target, state.publishedMemorial.get(target.role), orientationTweenMs())) continue;
    } else if (!state.memorial && publishOwned(map, target, state.roleGoals.get(target.role), orientationTweenMs())) {
      continue;
    }
    if (mode === "narrative" && target.role === "location-line") {
      const entry = rememberTarget(map, target);
      if (!(narrativeFocus && state.memorial)) entry.value = leaderOpacity ?? PLAY_OPACITY;
      paintTarget(map, target);
      continue;
    }
    const value = target.role === "label" || target.role === "leader"
      ? textOpacity
      : target.role === "geom"
        ? geomPaint
        : geomOpacity;
    const entry = rememberTarget(map, target);
    if (!(narrativeFocus && target.role === "location-line")) entry.value = value;
    paintTarget(map, target);
  }
}

function uniqueLeaderObjectIds(ids) {
  const seen = new Set();
  const out = [];
  for (const value of Array.isArray(ids) ? ids : []) {
    if (value == null || value === "") continue;
    const numeric = Number(value);
    const id = Number.isFinite(numeric) ? numeric : value;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}
