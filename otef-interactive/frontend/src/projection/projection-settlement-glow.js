import { PEOPLE_HALO_LAYER_ID } from "../map/maplibre-person-selection.js";
import { buildInvestigationSettlementIndexes } from "../shared/nli-investigation-timeline-data.js";
import { resolveNliLocation } from "../shared/nli-name-field-places.js";
import { aliasNovaSiteOutlineToYeshuv } from "../shared/nli-nova-escape-impact.js";
import { getNliNarrative } from "../shared/nli-narratives.js";
import { NLI_VISUAL_TOKENS } from "../shared/nli-investigation-theme.js";

export const PROJECTION_SETTLEMENT_GLOW_SOURCE_ID = "projection-settlement-glow-source";
export const PROJECTION_SETTLEMENT_GLOW_FILL_LAYER_ID = "projection-settlement-glow-fill";
export const PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID = "projection-settlement-glow-outer";
export const PROJECTION_SETTLEMENT_GLOW_INNER_LAYER_ID = "projection-settlement-glow-inner";

const GLOW_COLOR = "#ffffff";
const GLOW_LAYER_IDS = [
  PROJECTION_SETTLEMENT_GLOW_FILL_LAYER_ID,
  PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID,
  PROJECTION_SETTLEMENT_GLOW_INNER_LAYER_ID,
];

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

function paintGlow(map, opacityScale, { immediate = false } = {}) {
  const duration = immediate ? 0 : NLI_VISUAL_TOKENS.highlightOpacityTransitionMs;
  const transition = { duration, delay: 0 };
  const pairs = [
    [PROJECTION_SETTLEMENT_GLOW_FILL_LAYER_ID, "fill-opacity", NLI_VISUAL_TOKENS.settlementGlowFillOpacity],
    [PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID, "line-opacity", NLI_VISUAL_TOKENS.settlementGlowOuterOpacity],
    [PROJECTION_SETTLEMENT_GLOW_INNER_LAYER_ID, "line-opacity", NLI_VISUAL_TOKENS.settlementGlowInnerOpacity],
  ];
  for (const [id, property, peak] of pairs) {
    if (!map.getLayer(id)) continue;
    map.setPaintProperty(id, `${property}-transition`, transition);
    map.setPaintProperty(id, property, peak * opacityScale);
  }
}

function addGlowLayers(map) {
  const opacityTransition = { duration: NLI_VISUAL_TOKENS.highlightOpacityTransitionMs };
  if (!map.getLayer(PROJECTION_SETTLEMENT_GLOW_FILL_LAYER_ID)) {
    map.addLayer({
      id: PROJECTION_SETTLEMENT_GLOW_FILL_LAYER_ID,
      type: "fill",
      source: PROJECTION_SETTLEMENT_GLOW_SOURCE_ID,
      paint: {
        "fill-color": GLOW_COLOR,
        "fill-opacity": 0,
        "fill-opacity-transition": opacityTransition,
      },
    });
  }
  if (!map.getLayer(PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID)) {
    map.addLayer({
      id: PROJECTION_SETTLEMENT_GLOW_OUTER_LAYER_ID,
      type: "line",
      source: PROJECTION_SETTLEMENT_GLOW_SOURCE_ID,
      paint: {
        "line-color": GLOW_COLOR,
        "line-width": NLI_VISUAL_TOKENS.settlementGlowOuterWidth,
        "line-blur": NLI_VISUAL_TOKENS.settlementGlowOuterBlur,
        "line-opacity": 0,
        "line-opacity-transition": opacityTransition,
      },
    });
  }
  if (!map.getLayer(PROJECTION_SETTLEMENT_GLOW_INNER_LAYER_ID)) {
    map.addLayer({
      id: PROJECTION_SETTLEMENT_GLOW_INNER_LAYER_ID,
      type: "line",
      source: PROJECTION_SETTLEMENT_GLOW_SOURCE_ID,
      paint: {
        "line-color": GLOW_COLOR,
        "line-width": NLI_VISUAL_TOKENS.settlementGlowInnerWidth,
        "line-blur": NLI_VISUAL_TOKENS.settlementGlowInnerBlur,
        "line-opacity": 0,
        "line-opacity-transition": opacityTransition,
      },
    });
  }
}

export function createProjectionSettlementGlow({ map, loadSettlements, motionMode } = {}) {
  let currentId = null;
  let lastFeature = null;
  const settlementsPromise = Promise.resolve().then(loadSettlements);
  const reduced = motionMode === "reduced";

  function ensureLayers(targetMap = map) {
    if (!targetMap || typeof targetMap.getSource !== "function") return;
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
      paintGlow(map, 0, { immediate: reduced });
      return;
    }
    const nextId = featureId(feature);
    if (currentId != null && nextId != null && currentId === nextId) {
      return;
    }
    paintGlow(map, 0, { immediate: true });
    lastFeature = feature;
    currentId = nextId;
    map.getSource(PROJECTION_SETTLEMENT_GLOW_SOURCE_ID)?.setData({
      type: "FeatureCollection",
      features: [feature],
    });
    paintGlow(map, 1, { immediate: reduced });
  }

  function dispose() {
    if (!map) return;
    for (const id of GLOW_LAYER_IDS) {
      if (map.getLayer?.(id)) map.removeLayer(id);
    }
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
