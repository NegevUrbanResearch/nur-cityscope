/**
 * GIS/projection settlement orientation: dim pack ישובים + Locations_Lines
 * during play/pause, and light שמות_יישובים labels whose cityname joins an
 * achieved sidecar outline. Paint targets IR-mangled MapLibre layer ids.
 */

const YISHUVIM_LAYER_PREFIX = "projector_base__ישובים";
const SHEMOT_LAYER_PREFIX = "projector_base__שמות_יישובים";
const LOCATIONS_LAYER_PREFIX = "projector_base__Locations_Lines";
const SHEMOT_SOURCE_ID = "projector_base.שמות_יישובים";
const KIBBUTZ_PREFIX = /^קיבוץ /;
const PLAY_OPACITY = 0.28;
const DIM_TEXT_OPACITY = 0.35;
const FULL_OPACITY = 1;

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
      continue;
    }
    if (id.startsWith(YISHUVIM_LAYER_PREFIX) || id.startsWith(LOCATIONS_LAYER_PREFIX)) {
      const property = opacityPropertyForType(layer.type);
      if (property) layers.push({ id, property, role: "geom" });
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
 * Dim ישובים + Locations_Lines while playing/paused; light achieved שמות
 * labels. Idle/ended restore opacity 1 and drop the dim expression.
 */
export function applySettlementOrientationPaint(map, { phase, achievedCitynames, layers } = {}) {
  if (!map) return;
  const dim = phase === "playing" || phase === "paused";
  const geomOpacity = dim ? PLAY_OPACITY : FULL_OPACITY;
  const citynames = [
    ...(achievedCitynames instanceof Set
      ? achievedCitynames
      : Array.isArray(achievedCitynames)
        ? achievedCitynames
        : []),
  ].map(String);
  const textOpacity = dim
    ? ["case", ["in", ["get", "cityname"], ["literal", citynames]], FULL_OPACITY, DIM_TEXT_OPACITY]
    : FULL_OPACITY;
  const targets = Array.isArray(layers) ? layers : collectOrientationTargets(map).layers;

  for (const target of targets) {
    if (!target?.id || !target.property) continue;
    const value = target.role === "label" ? textOpacity : geomOpacity;
    setPaint(map, target.id, target.property, value);
  }
}
