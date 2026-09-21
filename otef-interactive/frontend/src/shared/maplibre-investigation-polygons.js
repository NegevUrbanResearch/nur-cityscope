/**
 * Shared MapLibre renderer for investigation polygons and impacted settlements.
 *
 * Polygon geometry and settlement associations are supplied by the timeline
 * coordinator. This module deliberately has no network or label-matching path.
 */

import {
  INVESTIGATION_POLYGONS_FULL_ID,
} from "./nli-investigation-beats.js";
import { NLI_DISPLAY_PROFILES, NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";
import {
  BUFFERED_GRADIENT_BAND_PROPERTY,
  buildBufferedGradientRenderPlan,
} from "./cim-buffered-gradient.js";
import {
  NOVA_PARALLEL_DIM_OPACITY,
  NOVA_PARALLEL_IMPACT_KIND_POLYGON,
  novaParallelImpactObjectIds,
} from "./nli-nova-escape-impact.js";
import {
  polygonEntryBandFactor,
  polygonGradientBandPaint,
  polygonGradientPhase,
} from "./nli-investigation-polygon-gradient-motion.js";

const SETTLEMENT_SOURCE_ID = "nli-investigation-settlement-impact";
const SETTLEMENT_LAYER_ID = "nli-investigation-settlement-impact-outline";
const CATEGORY_SOURCE_ID = "nli-investigation-polygon-category";
const CATEGORY_OUTLINE_SOURCE_ID = "nli-investigation-polygon-category-outline";
const BUFFERED_GRADIENT_SOURCE_ID = "nli-investigation-polygon-buffered-gradient";
const POLYGON_LAYER_PREFIX = INVESTIGATION_POLYGONS_FULL_ID.replace(/\./g, "__");
const SETTLEMENT_OUTLINE = NLI_VISUAL_TOKENS.settlementImpactOutline;
const NARRATIVE_SETTLEMENT_OUTLINE = NLI_VISUAL_TOKENS.narrativeSettlementOutline;
const NOTES_BATTLE = "מרחב לחימה - קרב";
const NOTES_KIDNAP = "מוקד חטיפה";
const NOTES_FIRE = "שריפה";
const CATEGORY_SPECS = Object.freeze([
  Object.freeze({ suffix: "battle", notes: NOTES_BATTLE }),
  Object.freeze({ suffix: "kidnap", notes: NOTES_KIDNAP }),
  Object.freeze({ suffix: "fire", notes: NOTES_FIRE }),
]);
const CATEGORY_FILL_LAYER_IDS = Object.freeze({
  battle: `${CATEGORY_SOURCE_ID}-fill-battle`,
  kidnap: `${CATEGORY_SOURCE_ID}-fill-kidnap`,
  fire: `${CATEGORY_SOURCE_ID}-fill-fire`,
});
const CATEGORY_LINE_LAYER_IDS = Object.freeze({
  battle: `${CATEGORY_SOURCE_ID}-line-battle`,
  kidnap: `${CATEGORY_SOURCE_ID}-line-kidnap`,
  fire: `${CATEGORY_SOURCE_ID}-line-fire`,
});
const CATEGORY_LAYER_IDS = Object.freeze([
  ...Object.values(CATEGORY_FILL_LAYER_IDS),
  ...Object.values(CATEGORY_LINE_LAYER_IDS),
]);
const NOVA_SITE_OBJECT_ID = 100;

function bandFilter(notes, ordinal) {
  return ["all", notesEqualsFilter(notes), ["==", ["get", BUFFERED_GRADIENT_BAND_PROPERTY], ordinal]];
}

function featureObjectId(feature) {
  return feature?.properties?.OBJECTID ?? feature?.id;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  return Array.isArray(value?.features) ? value.features : [];
}

function asLookup(value) {
  const result = new Map();
  const entries = value instanceof Map
    ? value.entries()
    : value && typeof value === "object"
      ? Object.entries(value)
      : [];
  for (const [key, entry] of entries) result.set(String(key), entry);
  return result;
}

function lookupValue(index, key) {
  let value;
  if (index instanceof Map) {
    value = index.get(String(key));
  } else {
    value = index?.[key] ?? index?.[String(key)];
  }
  return value;
}

function outlineIdFromAssociation(value) {
  if (value && typeof value === "object") {
    return value.outlineObjectId ?? value.outlineObjectID ?? value.objectId ?? value.OBJECTID;
  }
  return value;
}

function styleLayers(map) {
  try {
    const layers = map?.getStyle?.()?.layers;
    return Array.isArray(layers) ? layers : [];
  } catch (_) {
    return [];
  }
}

function polygonLayers(map) {
  return styleLayers(map).filter(
    (layer) =>
      (typeof layer?.id === "string" && layer.id.startsWith(POLYGON_LAYER_PREFIX)) ||
      layer?.source === POLYGON_LAYER_PREFIX || layer?.source === INVESTIGATION_POLYGONS_FULL_ID,
  );
}

function featureCollection(features = []) {
  return { type: "FeatureCollection", features: asArray(features) };
}

function frameNowMs(frame, data) {
  if (frame?.correctedNowValid === false) return null;
  const source = data && Object.prototype.hasOwnProperty.call(data, "nowMs")
    ? data.nowMs
    : frame && Object.prototype.hasOwnProperty.call(frame, "nowMs")
      ? frame.nowMs
      : frame?.correctedNow;
  if (source == null) return null;
  const value = Number(source);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function closeRing(ring) {
  if (!Array.isArray(ring) || ring.length < 2) return null;
  const coords = ring
    .filter((point) => Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
    .map((point) => [Number(point[0]), Number(point[1])]);
  if (coords.length < 2) return null;
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coords.push([first[0], first[1]]);
  return coords.length >= 2 ? coords : null;
}

function outlineFeaturesFromPolygons(features) {
  const outlines = [];
  for (const feature of features) {
    const geom = feature?.geometry;
    const rings = [];
    if (geom?.type === "Polygon") {
      for (const ring of geom.coordinates || []) {
        if (Array.isArray(ring)) rings.push(ring);
      }
    } else if (geom?.type === "MultiPolygon") {
      for (const polygon of geom.coordinates || []) {
        for (const ring of polygon || []) {
          if (Array.isArray(ring)) rings.push(ring);
        }
      }
    }
    for (const ring of rings) {
      const coordinates = closeRing(ring);
      if (!coordinates) continue;
      outlines.push({
        type: "Feature",
        properties: feature.properties && typeof feature.properties === "object" ? feature.properties : {},
        geometry: { type: "LineString", coordinates },
      });
    }
  }
  return outlines;
}

function achievedPolygonFeatures(features, frame) {
  const achieved = new Set(
    asArray(frame?.achievedPolygonBeats).map(Number).filter(Number.isFinite),
  );
  return asArray(features).filter((feature) =>
    achieved.has(Number(feature?.properties?.timeline_minutes)),
  );
}

function notesEqualsFilter(notes) {
  return ["==", ["get", "Notes"], notes];
}

function setPaint(map, id, property, value) {
  if (typeof map?.setPaintProperty !== "function") return;
  try {
    map.setPaintProperty(id, property, value);
  } catch (_) {
    // The base style can be replaced between collection and application.
  }
}

function narrativeSettlementOutlinePaint(focusOutlineId) {
  if (focusOutlineId == null || String(focusOutlineId).trim() === "") return SETTLEMENT_OUTLINE;
  const id = String(focusOutlineId);
  return [
    "case",
    [
      "any",
      ["==", ["to-string", ["get", "outlineObjectId"]], id],
      ["==", ["to-string", ["get", "OBJECTID"]], id],
    ],
    NARRATIVE_SETTLEMENT_OUTLINE,
    SETTLEMENT_OUTLINE,
  ];
}

function applyNarrativeSettlementOutlinePaint(map, state, frame) {
  const paint = narrativeSettlementOutlinePaint(frame?.narrativeFocusOutlineId);
  if (JSON.stringify(state.lastSettlementOutlinePaint) === JSON.stringify(paint)) return;
  setPaint(map, SETTLEMENT_LAYER_ID, "line-color", paint);
  state.lastSettlementOutlinePaint = paint;
}

function setLayout(map, id, property, value) {
  if (typeof map?.setLayoutProperty !== "function") return;
  try {
    map.setLayoutProperty(id, property, value);
  } catch (_) {
    // The base style can be replaced between collection and application.
  }
}

function normalizeProfile(profile) {
  if (typeof profile === "string") return NLI_DISPLAY_PROFILES[profile] || NLI_DISPLAY_PROFILES.gis;
  return profile && typeof profile === "object" ? profile : NLI_DISPLAY_PROFILES.gis;
}

function achievedKey(frame) {
  const beats = asArray(frame?.achievedPolygonBeats);
  return [...new Set(beats.map(Number).filter(Number.isFinite))].sort((a, b) => a - b).join(",");
}

function achievedSettlementKey(frame) {
  return [...new Set(asArray(frame?.achievedSettlementOutlineIds).map(String))]
    .sort()
    .join(",");
}

function sourcePresent(map, id) {
  try {
    return typeof map?.getSource === "function" && !!map.getSource(id);
  } catch (_) {
    return false;
  }
}

function layerPresent(map, id) {
  try {
    return typeof map?.getLayer === "function" && !!map.getLayer(id);
  } catch (_) {
    return false;
  }
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {string|object} [profile]
 * @param {object} [deps]
 * @returns {{mount: Function, render: Function, reset: Function, dispose: Function, setData: Function}}
 */
export function createInvestigationPolygonRenderer(
  map,
  profile = NLI_DISPLAY_PROFILES.gis,
  deps = {},
) {
  const displayProfile = normalizeProfile(profile);
  const state = {
    mounted: false,
    disposed: false,
    polygonFeatures: [],
    bufferedGradientFeatures: [],
    bufferedGradientSidecarStatus: "not-required",
    polygonStyle: null,
    processedPlan: { field: "Notes", classes: {}, processed: false },
    processedStyleActive: false,
    processedStyleInvalid: false,
    processedFillLayerIds: [],
    appliedPolygonStyle: null,
    locationToOutlineObjectId: new Map(),
    settlementFeatures: [],
    settlementFeaturesByOutlineId: new Map(),
    currentFrame: null,
    currentData: null,
    achievedMembershipKey: null,
    savedPaints: null,
    registryGeneration: 0,
    appliedRegistryGeneration: -1,
    appliedPaintSignature: null,
    mountGeneration: 0,
    baseLayers: [],
    baseLayersCaptured: false,
    hostPackHidden: false,
    dataVersion: deps.dataVersion ?? null,
    waitingForHostStyle: false,
    overlayMounted: false,
    categoryMounted: false,
    lastCategoryNovaSiteExclusion: null,
    lastCategoryParallelDim: null,
    lastCategoryParallelImpactKey: null,
    lastProcessedOutlineDim: null,
    lastProcessedOutlineImpactKey: null,
    lastSettlementOutlinePaint: null,
    warnedNotes: new Set(),
    warnedBufferedGradientFailure: false,
    warnedProcessedStyleFailure: false,
    inputRefs: {
      polygonFeatures: undefined,
      bufferedGradientFeatures: undefined,
      polygonStyle: undefined,
      bufferedGradientSidecarStatus: undefined,
      bufferedGradientStatus: undefined,
      locationToOutlineObjectId: undefined,
      settlementFeatures: undefined,
      settlementFeaturesByOutlineId: undefined,
      outlineIndexProvided: false,
    },
    beforeId: deps.beforeId ?? displayProfile.beforeId ?? null,
  };

  function absorbData(data = {}, { force = false } = {}) {
    const previousVersion = state.dataVersion;
    const hasVersion = Object.prototype.hasOwnProperty.call(data, "dataVersion");
    const nextVersion = hasVersion ? data.dataVersion : state.dataVersion;
    const versionChanged = previousVersion !== nextVersion;
    state.dataVersion = nextVersion;
    let registryChanged = versionChanged;
    if (versionChanged) state.warnedBufferedGradientFailure = false;
    if (versionChanged) {
      state.polygonStyle = null;
      state.processedPlan = { field: "Notes", classes: {}, processed: false };
      state.processedStyleActive = false;
      state.processedStyleInvalid = false;
      state.bufferedGradientFeatures = [];
      state.bufferedGradientSidecarStatus = "not-required";
      state.inputRefs.polygonStyle = undefined;
      state.inputRefs.bufferedGradientFeatures = undefined;
    }

    const hasPolygonFeatures = Object.prototype.hasOwnProperty.call(data, "polygonFeatures");
    const polygonFeatures = hasPolygonFeatures
      ? data.polygonFeatures
      : (force || versionChanged)
        ? state.inputRefs.polygonFeatures
        : undefined;
    if (polygonFeatures !== undefined && (force || versionChanged || state.inputRefs.polygonFeatures !== polygonFeatures)) {
      state.inputRefs.polygonFeatures = polygonFeatures;
      state.polygonFeatures = asArray(polygonFeatures);
      registryChanged = true;
    }

    const hasGradientFeatures = Object.prototype.hasOwnProperty.call(data, "bufferedGradientFeatures");
    const gradientFeatures = hasGradientFeatures
      ? data.bufferedGradientFeatures
      : (force || versionChanged) ? state.inputRefs.bufferedGradientFeatures : undefined;
    if (gradientFeatures !== undefined && (force || versionChanged || state.inputRefs.bufferedGradientFeatures !== gradientFeatures)) {
      state.inputRefs.bufferedGradientFeatures = gradientFeatures;
      state.bufferedGradientFeatures = asArray(gradientFeatures);
      if (!Object.prototype.hasOwnProperty.call(data, "bufferedGradientSidecarStatus")
        && !Object.prototype.hasOwnProperty.call(data, "bufferedGradientStatus")
        && gradientFeatures != null) {
        state.bufferedGradientSidecarStatus = "ready";
      }
      registryChanged = true;
    }
    const hasPolygonStyle = Object.prototype.hasOwnProperty.call(data, "polygonStyle");
    const polygonStyle = hasPolygonStyle
      ? data.polygonStyle
      : (force || versionChanged) ? state.inputRefs.polygonStyle : undefined;
    if (polygonStyle !== undefined && (force || versionChanged || state.inputRefs.polygonStyle !== polygonStyle)) {
      state.inputRefs.polygonStyle = polygonStyle;
      state.polygonStyle = polygonStyle;
      try {
        state.processedPlan = buildBufferedGradientRenderPlan(polygonStyle);
        state.processedStyleActive = state.processedPlan.processed;
        state.processedStyleInvalid = false;
      } catch (error) {
        state.processedPlan = { field: "Notes", classes: {}, processed: true };
        state.processedStyleActive = true;
        state.processedStyleInvalid = true;
        if (!state.warnedProcessedStyleFailure) {
          state.warnedProcessedStyleFailure = true;
          console.warn("Investigation polygon processed style is malformed; processed fills are hidden.", error);
        }
      }
      registryChanged = true;
    }
    if (Object.prototype.hasOwnProperty.call(data, "bufferedGradientSidecarStatus")) {
      state.bufferedGradientSidecarStatus = data.bufferedGradientSidecarStatus || "not-required";
    } else if (Object.prototype.hasOwnProperty.call(data, "bufferedGradientStatus")) {
      state.bufferedGradientSidecarStatus = data.bufferedGradientStatus || "not-required";
    } else if (Object.prototype.hasOwnProperty.call(data, "sidecarStatus")) {
      state.bufferedGradientSidecarStatus = data.sidecarStatus || "not-required";
    }

    const hasLocationIndex = Object.prototype.hasOwnProperty.call(data, "locationToOutlineObjectId");
    const locationIndex = hasLocationIndex
      ? data.locationToOutlineObjectId
      : (force || versionChanged)
        ? state.inputRefs.locationToOutlineObjectId
        : undefined;
    if (locationIndex !== undefined && (force || versionChanged || state.inputRefs.locationToOutlineObjectId !== locationIndex)) {
      state.inputRefs.locationToOutlineObjectId = locationIndex;
      state.locationToOutlineObjectId = asLookup(locationIndex);
      registryChanged = true;
    }

    const hasSettlements = Object.prototype.hasOwnProperty.call(data, "settlementFeatures");
    const settlements = hasSettlements
      ? data.settlementFeatures
      : (force || versionChanged)
        ? state.inputRefs.settlementFeatures
        : undefined;
    if (settlements !== undefined && (force || versionChanged || state.inputRefs.settlementFeatures !== settlements)) {
      state.inputRefs.settlementFeatures = settlements;
      state.settlementFeatures = asArray(settlements);
      registryChanged = true;
    }

    const hasByIdField = Object.prototype.hasOwnProperty.call(data, "settlementFeaturesByOutlineId");
    const providedById = data.settlementFeaturesByOutlineId;
    const byId = providedById != null
      ? providedById
      : !hasByIdField && (force || versionChanged) && state.inputRefs.outlineIndexProvided
        ? state.inputRefs.settlementFeaturesByOutlineId
        : null;
    const hasById = byId != null;
    const outlineInput = hasById ? byId : settlements !== undefined ? settlements : hasByIdField ? null : undefined;
    const outlineInputChanged =
      outlineInput !== undefined
        ? force || versionChanged || state.inputRefs.settlementFeaturesByOutlineId !== outlineInput
        : false;
    if (outlineInputChanged || (outlineInput !== undefined && state.inputRefs.outlineIndexProvided !== hasById)) {
      state.inputRefs.settlementFeaturesByOutlineId = outlineInput;
      state.inputRefs.outlineIndexProvided = hasById;
      state.settlementFeaturesByOutlineId = hasById ? asLookup(byId) : new Map();
      registryChanged = true;
    }
    if (!hasById && (outlineInputChanged || outlineInput !== undefined) && settlements !== undefined && state.settlementFeatures.length) {
      for (const feature of state.settlementFeatures) {
        const id = feature?.properties?.outlineObjectId ?? featureObjectId(feature);
        if (id != null) state.settlementFeaturesByOutlineId.set(String(id), feature);
      }
    }

    if (registryChanged) state.registryGeneration += 1;
    state.currentData = data;
  }

  function saveBasePaints(layers = state.baseLayers) {
    if (state.savedPaints || typeof map?.getPaintProperty !== "function") return;
    const saved = {};
    for (const layer of layers) {
      saved[layer.id] = {};
      for (const property of ["fill-color", "fill-opacity", "fill-outline-color", "line-color", "line-opacity", "line-width"]) {
        try {
          saved[layer.id][property] = map.getPaintProperty(layer.id, property);
        } catch (_) {
          saved[layer.id][property] = undefined;
        }
      }
    }
    state.savedPaints = saved;
  }

  function mountSettlementOverlay() {
    if (state.disposed || !map) return;
    if (!sourcePresent(map, SETTLEMENT_SOURCE_ID) && typeof map.addSource === "function") {
      map.addSource(SETTLEMENT_SOURCE_ID, { type: "geojson", data: featureCollection() });
    }
    if (!layerPresent(map, SETTLEMENT_LAYER_ID) && typeof map.addLayer === "function") {
      state.lastSettlementOutlinePaint = null;
      const layer = {
        id: SETTLEMENT_LAYER_ID,
        type: "line",
        source: SETTLEMENT_SOURCE_ID,
        paint: {
          "line-color": SETTLEMENT_OUTLINE,
          "line-opacity": 0.95,
          "line-width": 1.8,
        },
      };
      const anchor = state.beforeId && layerPresent(map, state.beforeId);
      const anchorIsBasePolygon = anchor && state.baseLayers.some((candidate) => candidate.id === state.beforeId);
      // The overlay is appended once, preserving the base style's structural order.
      if (anchor && !anchorIsBasePolygon) map.addLayer(layer, state.beforeId);
      else map.addLayer(layer);
    }
    state.overlayMounted = sourcePresent(map, SETTLEMENT_SOURCE_ID) && layerPresent(map, SETTLEMENT_LAYER_ID);
  }

  function overlayBeforeId() {
    const anchor = state.beforeId && layerPresent(map, state.beforeId);
    const anchorIsBasePolygon = anchor && state.baseLayers.some((candidate) => candidate.id === state.beforeId);
    return anchor && !anchorIsBasePolygon ? state.beforeId : null;
  }

  function addOwnedLayer(layer) {
    if (layerPresent(map, layer.id) || typeof map.addLayer !== "function") return;
    const beforeId = overlayBeforeId();
    if (beforeId) map.addLayer(layer, beforeId);
    else map.addLayer(layer);
  }

  function restackOwnedOverlays() {
    if (!map || typeof map.moveLayer !== "function") return;
    const beforeId = overlayBeforeId();
    const owned = [];
    const seen = new Set();
    for (const id of [...state.processedFillLayerIds, ...CATEGORY_LAYER_IDS, SETTLEMENT_LAYER_ID]) {
      if (!id || seen.has(id) || !layerPresent(map, id)) continue;
      seen.add(id);
      owned.push(id);
    }
    for (const id of owned) {
      try {
        if (beforeId) map.moveLayer(id, beforeId);
        else map.moveLayer(id);
      } catch (_) {
        // Style can be replaced between collection and move.
      }
    }
  }

  function mountCategoryOverlay() {
    if (state.disposed || !map) return;
    if (!state.processedStyleActive || state.processedStyleInvalid) {
      state.categoryMounted = false;
      return;
    }
    if (!sourcePresent(map, CATEGORY_SOURCE_ID) && typeof map.addSource === "function") {
      map.addSource(CATEGORY_SOURCE_ID, { type: "geojson", data: featureCollection() });
    }
    if (!sourcePresent(map, CATEGORY_OUTLINE_SOURCE_ID) && typeof map.addSource === "function") {
      map.addSource(CATEGORY_OUTLINE_SOURCE_ID, {
        type: "geojson",
        lineMetrics: true,
        data: featureCollection(),
      });
    }
    if (!sourcePresent(map, BUFFERED_GRADIENT_SOURCE_ID) && typeof map.addSource === "function") {
      map.addSource(BUFFERED_GRADIENT_SOURCE_ID, { type: "geojson", data: featureCollection() });
    }
    if (typeof map.addLayer !== "function") {
      state.categoryMounted = sourcePresent(map, CATEGORY_SOURCE_ID) && sourcePresent(map, CATEGORY_OUTLINE_SOURCE_ID);
      return;
    }
    mountProcessedCategoryLayers();
    state.categoryMounted = sourcePresent(map, CATEGORY_SOURCE_ID)
      && sourcePresent(map, CATEGORY_OUTLINE_SOURCE_ID);
  }

  function processedLinePaint(classPlan) {
    const outline = classPlan?.outline;
    if (!outline) return { "line-color": "#000000", "line-opacity": 0 };
    const paint = {
      "line-color": outline.color || "#000000",
      "line-opacity": outline.opacity,
      "line-width": outline.width,
    };
    return paint;
  }

  function mountProcessedCategoryLayers() {
    state.processedFillLayerIds = [];
    if (state.processedStyleInvalid) return;
    for (const spec of CATEGORY_SPECS) {
      const classPlan = state.processedPlan.classes[spec.notes];
      const fillId = CATEGORY_FILL_LAYER_IDS[spec.suffix];
      const lineId = CATEGORY_LINE_LAYER_IDS[spec.suffix];
      const isGradient = Array.isArray(classPlan?.bands) && classPlan.bands.length > 0;
      if (isGradient) {
        for (const band of classPlan.bands) {
          const id = band.ordinal === 0 ? fillId : `${fillId}-band-${band.ordinal}`;
          state.processedFillLayerIds.push(id);
          addOwnedLayer({
            id,
            type: "fill",
            source: BUFFERED_GRADIENT_SOURCE_ID,
            filter: bandFilter(spec.notes, band.ordinal),
            paint: {
              "fill-color": band.color,
              "fill-opacity": state.bufferedGradientSidecarStatus === "ready" ? band.opacity : 0,
            },
          });
        }
      } else if (classPlan?.solid?.color) {
        addOwnedLayer({
          id: fillId,
          type: "fill",
          source: CATEGORY_SOURCE_ID,
          filter: notesEqualsFilter(spec.notes),
          paint: {
            "fill-color": classPlan.solid.color,
            "fill-opacity": classPlan.solid.opacity,
          },
        });
      }
      if (classPlan?.outline) {
        addOwnedLayer({
          id: lineId,
          type: "line",
          source: CATEGORY_OUTLINE_SOURCE_ID,
          filter: notesEqualsFilter(spec.notes),
          layout: {
            "line-cap": classPlan.outline.lineCap || "round",
            "line-join": classPlan.outline.lineJoin || "round",
            ...(Number.isFinite(Number(classPlan.outline.miterLimit))
              ? { "line-miter-limit": Number(classPlan.outline.miterLimit) }
              : {}),
          },
          paint: processedLinePaint(classPlan),
        });
      }
    }
  }

  function novaNarrativeActive(frame, data) {
    return (frame?.narrativeId ?? frame?.narrative?.id ?? data?.narrativeId) === "nova";
  }

  function hideHostPack() {
    if (state.baseLayers.length === 0) return;
    if (state.hostPackHidden) {
      const hostPackRestored = state.baseLayers.some((layer) => {
        if (layer.type !== "fill" && layer.type !== "line") return false;
        try {
          return map.getLayoutProperty?.(layer.id, "visibility") !== "none";
        } catch (_) {
          return true;
        }
      });
      if (!hostPackRestored) return;
    }
    for (const layer of state.baseLayers) {
      if (layer.type === "fill" || layer.type === "line") {
        setLayout(map, layer.id, "visibility", "none");
      }
    }
    state.hostPackHidden = true;
  }

  function warnUnmatchedNotes(features) {
    if (!state.processedStyleActive || state.processedStyleInvalid) return;
    const known = state.processedPlan.classes;
    for (const feature of features) {
      const notes = feature?.properties?.Notes;
      if (typeof notes === "string" && known[notes]) continue;
      if (typeof notes !== "string" || notes === "") continue;
      if (state.warnedNotes.has(notes)) continue;
      state.warnedNotes.add(notes);
      console.warn(`Unmatched investigation polygon Notes: ${notes}`);
    }
  }

  function updateCategorySources(frame, data) {
    const achieved = achievedPolygonFeatures(state.polygonFeatures, frame);
    warnUnmatchedNotes(achieved);
    const categoryFeatures = novaNarrativeActive(frame, data)
      ? achieved.filter((feature) => Number(feature?.properties?.OBJECTID) !== NOVA_SITE_OBJECT_ID)
      : achieved;
    const fillSource = map?.getSource?.(CATEGORY_SOURCE_ID);
    if (fillSource && typeof fillSource.setData === "function") {
      fillSource.setData(featureCollection(categoryFeatures));
    }
    const outlineSource = map?.getSource?.(CATEGORY_OUTLINE_SOURCE_ID);
    if (outlineSource && typeof outlineSource.setData === "function") {
      outlineSource.setData(featureCollection(outlineFeaturesFromPolygons(categoryFeatures)));
    }
    if (state.processedStyleActive) {
      const gradientSource = map?.getSource?.(BUFFERED_GRADIENT_SOURCE_ID);
      const gradientAchieved = achievedPolygonFeatures(state.bufferedGradientFeatures, frame)
        .filter((feature) => !novaNarrativeActive(frame, data) || Number(feature?.properties?.OBJECTID) !== NOVA_SITE_OBJECT_ID);
      if (gradientSource && typeof gradientSource.setData === "function") {
        gradientSource.setData(featureCollection(gradientAchieved));
      }
    }
  }

  function parallelImpactIdList(frame, data) {
    return novaParallelImpactObjectIds(
      frame?.parallelImpactIds ?? data?.parallelImpactIds,
      NOVA_PARALLEL_IMPACT_KIND_POLYGON,
    );
  }

  function parallelImpactOpacityExpression(ids, baseOpacity = 1) {
    const authored = typeof baseOpacity === "number"
      ? (Number.isFinite(baseOpacity) ? baseOpacity : 1)
      : baseOpacity;
    return [
      "case",
      ["in", ["to-string", ["get", "OBJECTID"]], ["literal", ids]],
      authored,
      ["*", authored, NOVA_PARALLEL_DIM_OPACITY],
    ];
  }

  function entryPaintExpression(entries, band, bandCount, property, fallback) {
    if (!Array.isArray(entries) || entries.length === 0) return fallback;
    const expression = ["case"];
    for (const entry of entries) {
      const beat = Number(entry?.beat);
      const progress = Number(entry?.progress);
      if (!Number.isFinite(beat) || !Number.isFinite(progress)) continue;
      expression.push(
        ["==", ["to-number", ["get", "timeline_minutes"]], beat],
      );
      expression.push(property === "color"
        ? fallback
        : ["*", fallback, polygonEntryBandFactor(band.ordinal, bandCount, progress)]);
    }
    expression.push(fallback);
    return expression.length > 2 ? expression : fallback;
  }

  function applyCategoryMotion(frame, data) {
    if (!state.categoryMounted || !state.processedStyleActive) return;
    const motionMode = frame?.motionMode === "full" ? "full" : "reduced";
    const nowMs = frameNowMs(frame, data);
    const projectionNovaDim = frame?.projectionNovaDim === true || data?.projectionNovaDim === true;
    const impactIds = parallelImpactIdList(frame, data);
    const impactKey = impactIds.join(",");
    const sidecarReady = state.bufferedGradientSidecarStatus === "ready";
    const phase = motionMode === "full" ? polygonGradientPhase(nowMs) : null;
    const entries = phase == null ? [] : asArray(frame?.polygonEntries);
    const animated = sidecarReady && phase != null;
    for (const spec of CATEGORY_SPECS) {
      const classPlan = state.processedPlan.classes[spec.notes];
      const isGradient = Array.isArray(classPlan?.bands) && classPlan.bands.length > 0;
      const authored = isGradient ? classPlan.bands[0]?.opacity : classPlan?.solid?.opacity;
      if (!Number.isFinite(Number(authored))) continue;
      const ids = isGradient
        ? state.processedFillLayerIds.filter((id) => id.includes(`fill-${spec.suffix}`))
        : [CATEGORY_FILL_LAYER_IDS[spec.suffix]];
      for (const id of ids) {
        const band = isGradient && classPlan.bands.find((entry) => id === CATEGORY_FILL_LAYER_IDS[spec.suffix]
          ? entry.ordinal === 0
          : id.endsWith(`-band-${entry.ordinal}`));
        const opacity = band?.opacity ?? classPlan?.solid?.opacity ?? authored;
        const staticColor = band?.color ?? classPlan?.solid?.color;
        const conveyor = band && animated
          ? polygonGradientBandPaint(classPlan.bands, band.ordinal, phase, { motionMode })
          : null;
        const color = conveyor
          ? entryPaintExpression(entries, band, classPlan.bands.length, "color", conveyor.color)
          : staticColor;
        const baseOpacity = conveyor
          ? entryPaintExpression(entries, band, classPlan.bands.length, "opacity", conveyor.opacity)
          : (sidecarReady || !isGradient ? opacity : 0);
        if (color != null) setPaint(map, id, "fill-color", color);
        setPaint(map, id, "fill-opacity", projectionNovaDim && (sidecarReady || !isGradient)
          ? parallelImpactOpacityExpression(impactIds, baseOpacity)
          : baseOpacity);
      }
    }
    const outlineChanged = state.lastProcessedOutlineDim !== projectionNovaDim
      || state.lastProcessedOutlineImpactKey !== impactKey;
    if (outlineChanged) {
      for (const spec of CATEGORY_SPECS) {
        const outlineOpacity = Number(state.processedPlan.classes[spec.notes]?.outline?.opacity);
        if (!Number.isFinite(outlineOpacity)) continue;
        setPaint(map, CATEGORY_LINE_LAYER_IDS[spec.suffix], "line-opacity", projectionNovaDim
          ? parallelImpactOpacityExpression(impactIds, outlineOpacity)
          : outlineOpacity);
      }
      state.lastProcessedOutlineDim = projectionNovaDim;
      state.lastProcessedOutlineImpactKey = impactKey;
    }
    state.lastCategoryParallelDim = projectionNovaDim;
    state.lastCategoryParallelImpactKey = impactKey;
  }

  function hostBaseReady() {
    const layers = polygonLayers(map);
    const hasFill = layers.some((layer) => layer.type === "fill");
    const hasStroke = layers.some((layer) => layer.type === "line");
    const hasAnchor = !state.beforeId || layerPresent(map, state.beforeId);
    return hasFill && hasStroke && hasAnchor;
  }

  function mount({ settlementOnly = false } = {}) {
    if (state.disposed) return;
    if (!state.mounted) {
      if (!settlementOnly && !hostBaseReady()) {
        state.waitingForHostStyle = true;
        return;
      }
      state.waitingForHostStyle = false;
      state.mounted = true;
      state.mountGeneration += 1;
    }
    if (!state.baseLayersCaptured) {
      const layers = polygonLayers(map);
      if (layers.length > 0 || !settlementOnly) {
        state.baseLayers = layers;
        state.baseLayersCaptured = true;
        saveBasePaints(state.baseLayers);
      }
    }
    if (!settlementOnly) {
      mountCategoryOverlay();
      hideHostPack();
    }
    mountSettlementOverlay();
  }

  function render(frame = {}, data = {}, { renderPolygons = true } = {}) {
    if (state.disposed) return;
    const previousPolygonStyle = state.polygonStyle;
    absorbData(data);
    if (previousPolygonStyle !== state.polygonStyle && state.categoryMounted) {
      removeOverlay();
      state.categoryMounted = false;
      state.overlayMounted = false;
      state.processedFillLayerIds = [];
    }
    if (state.processedStyleActive && state.bufferedGradientSidecarStatus === "failed" && !state.warnedBufferedGradientFailure) {
      state.warnedBufferedGradientFailure = true;
      console.warn("Investigation polygon buffered-gradient sidecar failed; processed fills are hidden.");
    }
    state.currentFrame = frame;
    mount({ settlementOnly: !renderPolygons });
    applyNarrativeSettlementOutlinePaint(map, state, frame);
    const achieved = asArray(frame.achievedPolygonBeats)
      .map(Number)
      .filter(Number.isFinite);
    const polygonKey = achievedKey(frame);
    const settlementKey = achievedSettlementKey(frame);
    const key = `${polygonKey}|${settlementKey}`;
    const membershipChanged = state.achievedMembershipKey !== key;
    const dataChanged = state.appliedRegistryGeneration !== state.registryGeneration;
    state.achievedMembershipKey = key;
    if (renderPolygons) {
      hideHostPack();
    }
    if (renderPolygons && state.categoryMounted) {
      const novaSiteExclusion = novaNarrativeActive(frame, data);
      if (
        membershipChanged
        || dataChanged
        || state.lastCategoryNovaSiteExclusion !== novaSiteExclusion
      ) {
        updateCategorySources(frame, data);
        state.lastCategoryNovaSiteExclusion = novaSiteExclusion;
      }
      applyCategoryMotion(frame, data);
    }
    if (!membershipChanged && !dataChanged) {
      restackOwnedOverlays();
      return;
    }
    const outlines = new Map();
    const hasExplicitSettlementIds = Object.prototype.hasOwnProperty.call(
      frame,
      "achievedSettlementOutlineIds",
    );
    const outlineIds = hasExplicitSettlementIds
      ? asArray(frame.achievedSettlementOutlineIds)
      : state.polygonFeatures
        .filter((feature) => achieved.includes(Number(feature?.properties?.timeline_minutes)))
        .map((feature) => outlineIdFromAssociation(
          lookupValue(state.locationToOutlineObjectId, feature?.properties?.מיקום),
        ));
    for (const outlineId of outlineIds) {
      if (outlineId == null || outlines.has(String(outlineId))) continue;
      const indexedOutline = lookupValue(state.settlementFeaturesByOutlineId, outlineId);
      const outline = state.inputRefs.outlineIndexProvided
        ? indexedOutline
        : indexedOutline ??
          state.settlementFeatures.find((feature) => String(feature?.properties?.outlineObjectId ?? featureObjectId(feature)) === String(outlineId));
      if (outline) outlines.set(String(outlineId), outline);
    }
    const source = map?.getSource?.(SETTLEMENT_SOURCE_ID);
    if (source && typeof source.setData === "function") {
      source.setData(featureCollection([...outlines.values()]));
      state.appliedRegistryGeneration = state.registryGeneration;
    }
    restackOwnedOverlays();
  }

  function renderSettlement(frame = {}, data = {}) {
    render(frame, data, { renderPolygons: false });
  }

  function setData(data = {}) {
    absorbData(data, { force: true });
    state.achievedMembershipKey = null;
    if (state.currentFrame) render(state.currentFrame, data);
  }

  function removeOverlay() {
    const ownedLayerIds = [...new Set([...CATEGORY_LAYER_IDS, ...state.processedFillLayerIds])];
    for (const id of ownedLayerIds) {
      if (layerPresent(map, id) && typeof map.removeLayer === "function") {
        try { map.removeLayer(id); } catch (_) { /* stale style */ }
      }
    }
    if (layerPresent(map, SETTLEMENT_LAYER_ID) && typeof map.removeLayer === "function") {
      try { map.removeLayer(SETTLEMENT_LAYER_ID); } catch (_) { /* stale style */ }
    }
    for (const sourceId of [CATEGORY_SOURCE_ID, CATEGORY_OUTLINE_SOURCE_ID, BUFFERED_GRADIENT_SOURCE_ID, SETTLEMENT_SOURCE_ID]) {
      if (sourcePresent(map, sourceId) && typeof map.removeSource === "function") {
        try { map.removeSource(sourceId); } catch (_) { /* stale style */ }
      }
    }
    state.lastSettlementOutlinePaint = null;
    state.lastProcessedOutlineDim = null;
    state.lastProcessedOutlineImpactKey = null;
    state.lastCategoryParallelDim = null;
    state.lastCategoryParallelImpactKey = null;
  }

  function reset({ preserveBasePaints = false } = {}) {
    if (state.disposed) return;
    const hasOwnedState =
      state.mounted ||
      state.currentFrame ||
      state.savedPaints ||
      state.baseLayersCaptured ||
      state.waitingForHostStyle ||
      state.overlayMounted ||
      state.categoryMounted;
    if (!hasOwnedState) return;
    removeOverlay();
    state.mounted = false;
    state.overlayMounted = false;
    state.categoryMounted = false;
    state.processedFillLayerIds = [];
    state.processedStyleActive = false;
    state.processedStyleInvalid = false;
    state.processedPlan = { field: "Notes", classes: {}, processed: false };
    state.polygonStyle = null;
    state.bufferedGradientFeatures = [];
    state.bufferedGradientSidecarStatus = "not-required";
    state.lastCategoryNovaSiteExclusion = null;
    state.lastCategoryParallelDim = null;
    state.lastCategoryParallelImpactKey = null;
    state.lastProcessedOutlineDim = null;
    state.lastProcessedOutlineImpactKey = null;
    state.lastSettlementOutlinePaint = null;
    state.waitingForHostStyle = false;
    state.baseLayers = [];
    state.baseLayersCaptured = false;
    state.hostPackHidden = false;
    if (!preserveBasePaints) state.savedPaints = null;
    state.currentFrame = null;
    state.currentData = null;
    state.achievedMembershipKey = null;
    state.polygonFeatures = [];
    state.locationToOutlineObjectId = new Map();
    state.settlementFeatures = [];
    state.settlementFeaturesByOutlineId = new Map();
    state.inputRefs = {
      polygonFeatures: undefined,
      bufferedGradientFeatures: undefined,
      polygonStyle: undefined,
      bufferedGradientSidecarStatus: undefined,
      bufferedGradientStatus: undefined,
      locationToOutlineObjectId: undefined,
      settlementFeatures: undefined,
      settlementFeaturesByOutlineId: undefined,
      outlineIndexProvided: false,
    };
    state.appliedRegistryGeneration = -1;
    state.appliedPaintSignature = null;
  }

  function dispose(options) {
    if (state.disposed) return;
    reset(options);
    state.mounted = false;
    state.savedPaints = null;
    state.disposed = true;
  }

  absorbData(deps);
  return { mount, render, renderSettlement, reset, dispose, setData };
}

export const INVESTIGATION_POLYGON_RENDERER_IDS = Object.freeze({
  settlementSource: SETTLEMENT_SOURCE_ID,
  settlementLayer: SETTLEMENT_LAYER_ID,
  categorySource: CATEGORY_SOURCE_ID,
  categoryOutlineSource: CATEGORY_OUTLINE_SOURCE_ID,
});
