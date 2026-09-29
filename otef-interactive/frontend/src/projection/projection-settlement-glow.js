import { PEOPLE_HALO_LAYER_ID } from "../map/maplibre-person-selection.js";
import { buildInvestigationSettlementIndexes } from "../shared/nli-investigation-timeline-data.js";
import { resolveNliLocation } from "../shared/nli-name-field-places.js";
import { aliasNovaSiteOutlineToYeshuv } from "../shared/nli-nova-escape-impact.js";
import { getNliNarrative } from "../shared/nli-narratives.js";
import { NLI_VISUAL_TOKENS } from "../shared/nli-investigation-theme.js";

export const PROJECTION_SETTLEMENT_GLOW_SOURCE_ID = "projection-settlement-glow-source";
export const PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID = "projection-settlement-glow-aura";
export const PROJECTION_SETTLEMENT_GLOW_CORE_LAYER_ID = "projection-settlement-glow-core";

const LEGACY_GLOW_LAYER_IDS = [
  "projection-settlement-glow-fill",
  "projection-settlement-glow-outer",
  "projection-settlement-glow-inner",
];
const GLOW_COLOR = "#ffffff";
const GLOW_LAYER_IDS = [
  PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID,
  PROJECTION_SETTLEMENT_GLOW_CORE_LAYER_ID,
];
const DISPOSE_LAYER_IDS = [...GLOW_LAYER_IDS, ...LEGACY_GLOW_LAYER_IDS];
const METERS_PER_PIXEL_AT_ZOOM_0 = (2 * Math.PI * 6378137) / 512;

function featureId(feature) {
  const props = feature?.properties || {};
  const id = props.OBJECTID ?? props.outlineObjectId ?? props.outlineObjectID;
  return id == null ? null : String(id);
}

function featureForOutlineId(settlementFeaturesByOutlineId, outlineObjectId) {
  const aliased = aliasNovaSiteOutlineToYeshuv(
    [outlineObjectId],
    settlementFeaturesByOutlineId,
  );
  for (const id of aliased) {
    const feature = settlementFeaturesByOutlineId.get(String(id));
    if (feature) return feature;
  }
  return settlementFeaturesByOutlineId.get(String(outlineObjectId)) || null;
}

function outlineIdFromLocation(locationToOutlineObjectId, locationName) {
  if (locationName == null) return null;
  const label = resolveNliLocation(locationName)?.label;
  if (label != null && locationToOutlineObjectId.has(String(label))) {
    return locationToOutlineObjectId.get(String(label));
  }
  if (locationToOutlineObjectId.has(String(locationName))) {
    return locationToOutlineObjectId.get(String(locationName));
  }
  for (const [key, id] of locationToOutlineObjectId) {
    if (String(key).toLowerCase() === String(locationName).toLowerCase()) {
      return id;
    }
  }
  return null;
}

export function resolveSettlementGlowFeature(settlements, { outlineObjectId, locationName } = {}) {
  const features = Array.isArray(settlements) ? settlements : settlements?.features;
  const { locationToOutlineObjectId, settlementFeaturesByOutlineId } =
    buildInvestigationSettlementIndexes(features);
  if (outlineObjectId != null) {
    return featureForOutlineId(settlementFeaturesByOutlineId, outlineObjectId);
  }
  const resolvedId = outlineIdFromLocation(locationToOutlineObjectId, locationName);
  if (resolvedId == null) return null;
  return featureForOutlineId(settlementFeaturesByOutlineId, resolvedId);
}

function collectPositions(value, into = []) {
  if (!value) return into;
  if (typeof value[0] === "number") {
    into.push(value);
    return into;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPositions(item, into);
  }
  return into;
}

export function settlementAuraPoint(feature) {
  const positions = collectPositions(feature?.geometry?.coordinates);
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const position of positions) {
    const lon = Number(position?.[0]);
    const lat = Number(position?.[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  const cx = (minLon + maxLon) / 2;
  const cy = (minLat + maxLat) / 2;
  const widthM = (maxLon - minLon) * 111320 * Math.cos((cy * Math.PI) / 180);
  const heightM = (maxLat - minLat) * 110540;
  const hypotRadius = 0.5 * Math.hypot(widthM, heightM);
  return {
    type: "Feature",
    properties: {
      ...(feature?.properties || {}),
      radiusMeters: hypotRadius * NLI_VISUAL_TOKENS.settlementGlowAuraPad,
      coreRadiusMeters: hypotRadius * NLI_VISUAL_TOKENS.settlementGlowCorePad,
    },
    geometry: { type: "Point", coordinates: [cx, cy] },
  };
}

function glowCircleRadiusExpression(property = "radiusMeters") {
  return [
    "interpolate",
    ["exponential", 2],
    ["zoom"],
    0,
    ["/", ["get", property], METERS_PER_PIXEL_AT_ZOOM_0],
    24,
    ["/", ["get", property], METERS_PER_PIXEL_AT_ZOOM_0 / 2 ** 24],
  ];
}

export function settlementGlowBreathScale(elapsedMs) {
  const period = NLI_VISUAL_TOKENS.settlementGlowBreathMs;
  const min = NLI_VISUAL_TOKENS.settlementGlowBreathMin;
  const max = NLI_VISUAL_TOKENS.settlementGlowBreathMax;
  const mid = (min + max) / 2;
  const amp = (max - min) / 2;
  const t = (Number(elapsedMs) || 0) / period;
  return mid + amp * Math.sin(t * Math.PI * 2);
}

function paintGlow(map, opacityScale, { immediate = false } = {}) {
  const duration = immediate ? 0 : NLI_VISUAL_TOKENS.highlightOpacityTransitionMs;
  const transition = { duration, delay: 0 };
  const pairs = [
    [PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID, NLI_VISUAL_TOKENS.settlementGlowAuraOpacity],
    [PROJECTION_SETTLEMENT_GLOW_CORE_LAYER_ID, NLI_VISUAL_TOKENS.settlementGlowCoreOpacity],
  ];
  for (const [id, peak] of pairs) {
    if (!map.getLayer(id)) continue;
    map.setPaintProperty(id, "circle-opacity-transition", transition);
    map.setPaintProperty(id, "circle-opacity", peak * opacityScale);
  }
}

function removeGlowLayers(map, ids) {
  for (const id of ids) {
    if (map.getLayer?.(id)) map.removeLayer(id);
  }
}

function addGlowLayers(map) {
  const opacityTransition = { duration: NLI_VISUAL_TOKENS.highlightOpacityTransitionMs };
  const auraRadius = glowCircleRadiusExpression("radiusMeters");
  const coreRadius = glowCircleRadiusExpression("coreRadiusMeters");
  if (!map.getLayer(PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID)) {
    map.addLayer({
      id: PROJECTION_SETTLEMENT_GLOW_AURA_LAYER_ID,
      type: "circle",
      source: PROJECTION_SETTLEMENT_GLOW_SOURCE_ID,
      paint: {
        "circle-color": GLOW_COLOR,
        "circle-opacity": 0,
        "circle-opacity-transition": opacityTransition,
        "circle-blur": NLI_VISUAL_TOKENS.settlementGlowAuraBlur,
        "circle-radius": auraRadius,
        "circle-pitch-alignment": "map",
      },
    });
  }
  if (!map.getLayer(PROJECTION_SETTLEMENT_GLOW_CORE_LAYER_ID)) {
    map.addLayer({
      id: PROJECTION_SETTLEMENT_GLOW_CORE_LAYER_ID,
      type: "circle",
      source: PROJECTION_SETTLEMENT_GLOW_SOURCE_ID,
      paint: {
        "circle-color": GLOW_COLOR,
        "circle-opacity": 0,
        "circle-opacity-transition": opacityTransition,
        "circle-blur": NLI_VISUAL_TOKENS.settlementGlowCoreBlur,
        "circle-radius": coreRadius,
        "circle-pitch-alignment": "map",
      },
    });
  }
}

export function createProjectionSettlementGlow({ map, loadSettlements, motionMode } = {}) {
  let currentId = null;
  let lastFeature = null;
  let breathFrame = null;
  let breathOrigin = null;
  let breathDelay = null;
  const settlementsPromise = Promise.resolve().then(loadSettlements);
  const reduced = motionMode === "reduced";

  function scheduleFrame(callback) {
    if (typeof map?.requestAnimationFrame === "function") return map.requestAnimationFrame(callback);
    if (typeof requestAnimationFrame === "function") return requestAnimationFrame(callback);
    return null;
  }

  function cancelFrame(id) {
    if (id == null) return;
    if (typeof map?.cancelAnimationFrame === "function") map.cancelAnimationFrame(id);
    else if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
  }

  function clearBreathDelay() {
    if (breathDelay == null) return;
    if (typeof map?.clearTimeout === "function") map.clearTimeout(breathDelay);
    else clearTimeout(breathDelay);
    breathDelay = null;
  }

  function stopBreath() {
    clearBreathDelay();
    cancelFrame(breathFrame);
    breathFrame = null;
    breathOrigin = null;
  }

  function tickBreath(now) {
    if (currentId == null || reduced) {
      stopBreath();
      return;
    }
    if (breathOrigin == null) breathOrigin = now;
    paintGlow(map, settlementGlowBreathScale(now - breathOrigin), { immediate: true });
    breathFrame = scheduleFrame(tickBreath);
  }

  function startBreath() {
    if (reduced || currentId == null) return;
    stopBreath();
    const wait = typeof map?.setTimeout === "function"
      ? (callback, ms) => map.setTimeout(callback, ms)
      : setTimeout;
    breathDelay = wait(() => {
      breathDelay = null;
      if (reduced || currentId == null) return;
      breathFrame = scheduleFrame(tickBreath);
    }, NLI_VISUAL_TOKENS.highlightOpacityTransitionMs);
  }

  function ensureLayers(targetMap = map) {
    if (!targetMap || typeof targetMap.getSource !== "function") return;
    removeGlowLayers(targetMap, LEGACY_GLOW_LAYER_IDS);
    const missingLayer = GLOW_LAYER_IDS.some((id) => !targetMap.getLayer?.(id));
    if (!targetMap.getSource(PROJECTION_SETTLEMENT_GLOW_SOURCE_ID)) {
      targetMap.addSource(PROJECTION_SETTLEMENT_GLOW_SOURCE_ID, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: lastFeature ? [lastFeature] : [],
        },
      });
    }
    addGlowLayers(targetMap);
    if (missingLayer) {
      currentId = null;
      stopBreath();
      raise(targetMap);
    }
  }

  function raise(targetMap = map) {
    if (!targetMap?.getLayer?.(PEOPLE_HALO_LAYER_ID)) return;
    for (const id of GLOW_LAYER_IDS) {
      if (!targetMap.getLayer(id)) continue;
      targetMap.moveLayer(id, PEOPLE_HALO_LAYER_ID);
    }
  }

  async function setFocus({ outlineObjectId, locationName, suppressed } = {}) {
    ensureLayers(map);
    const settlements = await settlementsPromise;
    const feature = suppressed
      ? null
      : resolveSettlementGlowFeature(settlements, { outlineObjectId, locationName });
    if (suppressed || !feature) {
      currentId = null;
      stopBreath();
      paintGlow(map, 0, { immediate: reduced });
      return;
    }
    const nextId = featureId(feature);
    if (currentId != null && nextId != null && currentId === nextId) {
      return;
    }
    stopBreath();
    paintGlow(map, 0, { immediate: true });
    lastFeature = settlementAuraPoint(feature);
    currentId = nextId;
    map.getSource(PROJECTION_SETTLEMENT_GLOW_SOURCE_ID)?.setData({
      type: "FeatureCollection",
      features: [lastFeature],
    });
    paintGlow(map, 1, { immediate: reduced });
    startBreath();
  }

  function dispose() {
    stopBreath();
    if (!map) return;
    removeGlowLayers(map, DISPOSE_LAYER_IDS);
    if (map.getSource?.(PROJECTION_SETTLEMENT_GLOW_SOURCE_ID)) {
      map.removeSource(PROJECTION_SETTLEMENT_GLOW_SOURCE_ID);
    }
    currentId = null;
    lastFeature = null;
  }

  return { setFocus, ensureLayers, raise, dispose };
}

export async function syncProjectionSettlementGlow(glow, {
  exhibitMode = false,
  narrativeId = null,
  personLocation = null,
  placeName = null,
  wallEnabled = false,
} = {}) {
  if (!glow) return;
  if (exhibitMode !== true) return glow.setFocus({ suppressed: true });
  if (wallEnabled) return glow.setFocus({ suppressed: true });
  const outlineObjectId = getNliNarrative(narrativeId)?.focusSettlementOutlineId;
  if (outlineObjectId != null) return glow.setFocus({ outlineObjectId });
  if (personLocation) return glow.setFocus({ locationName: personLocation });
  if (placeName) return glow.setFocus({ locationName: placeName });
  return glow.setFocus({});
}
