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
import { buildDirectionalFlowGradient } from "./maplibre-investigation-lines.js";
import {
  BUFFERED_GRADIENT_BAND_PROPERTY,
  buildBufferedGradientRenderPlan,
} from "./cim-buffered-gradient.js";
import {
  NOVA_PARALLEL_DIM_OPACITY,
  NOVA_PARALLEL_IMPACT_KIND_POLYGON,
  novaParallelImpactObjectIds,
} from "./nli-nova-escape-impact.js";

const SETTLEMENT_SOURCE_ID = "nli-investigation-settlement-impact";
const SETTLEMENT_LAYER_ID = "nli-investigation-settlement-impact-outline";
const CATEGORY_SOURCE_ID = "nli-investigation-polygon-category";
const CATEGORY_OUTLINE_SOURCE_ID = "nli-investigation-polygon-category-outline";
const BUFFERED_GRADIENT_SOURCE_ID = "nli-investigation-polygon-buffered-gradient";
const POLYGON_LAYER_PREFIX = INVESTIGATION_POLYGONS_FULL_ID.replace(/\./g, "__");
const RED = NLI_VISUAL_TOKENS.incidentRed;
const NOTES_BATTLE = "מרחב לחימה - קרב";
const NOTES_KIDNAP = "מוקד חטיפה";
const NOTES_FIRE = "שריפה";
const KNOWN_NOTES = Object.freeze([NOTES_BATTLE, NOTES_KIDNAP, NOTES_FIRE]);
const CATEGORY_SPECS = Object.freeze([
  Object.freeze({ suffix: "battle", notes: NOTES_BATTLE }),
  Object.freeze({ suffix: "kidnap", notes: NOTES_KIDNAP }),
  Object.freeze({ suffix: "fire", notes: NOTES_FIRE }),
]);
const CATEGORY_FILL_LAYER_IDS = Object.freeze({
  battle: `${CATEGORY_SOURCE_ID}-fill-battle`,
  kidnap: `${CATEGORY_SOURCE_ID}-fill-kidnap`,
  fire: `${CATEGORY_SOURCE_ID}-fill-fire`,
  fallback: `${CATEGORY_SOURCE_ID}-fill-fallback`,
});
const CATEGORY_LINE_LAYER_IDS = Object.freeze({
  battle: `${CATEGORY_SOURCE_ID}-line-battle`,
  kidnap: `${CATEGORY_SOURCE_ID}-line-kidnap`,
  fire: `${CATEGORY_SOURCE_ID}-line-fire`,
  fallback: `${CATEGORY_SOURCE_ID}-line-fallback`,
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
  const value = Number(data?.nowMs ?? frame?.nowMs ?? frame?.correctedNow);
  return Number.isFinite(value) ? value : 0;
}

function oscillate(nowMs, periodMs, min, max) {
  const period = Number(periodMs);
  const low = Number(min);
  const high = Number(max);
  if (!Number.isFinite(period) || period <= 0 || !Number.isFinite(low) || !Number.isFinite(high)) {
    return Number.isFinite(low) ? low : high;
  }
  const t = (((nowMs % period) + period) % period) / period;
  const wave = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
  return low + (high - low) * wave;
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

function unmatchedNotesFilter() {
  return ["!", ["in", ["get", "Notes"], ["literal", [...KNOWN_NOTES]]]];
}

function setPaint(map, id, property, value) {
  if (typeof map?.setPaintProperty !== "function") return;
  try {
    map.setPaintProperty(id, property, value);
  } catch (_) {
    // The base style can be replaced between collection and application.
  }
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
    dataVersion: deps.dataVersion ?? null,
    waitingForHostStyle: false,
    overlayMounted: false,
    categoryMounted: false,
    hostHidden: false,
    lastCategoryMotionMode: null,
    lastCategoryNovaSiteExclusion: null,
    lastCategoryParallelDim: null,
    lastCategoryParallelImpactKey: null,
    warnedNotes: new Set(),
    warnedBufferedGradientFailure: false,
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
      state.processedPlan = buildBufferedGradientRenderPlan(polygonStyle);
      state.processedStyleActive = state.processedPlan.processed;
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
      const layer = {
        id: SETTLEMENT_LAYER_ID,
        type: "line",
        source: SETTLEMENT_SOURCE_ID,
        paint: {
          "line-color": RED,
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

  function categoryFillPaint(token) {
    return {
      "fill-color": token.fill,
      "fill-opacity": token.fillOpacity,
    };
  }

  function categoryLinePaint(token, { gradient } = {}) {
    const width = 1.8 * Number(displayProfile.lineWidthMultiplier || 1);
    const paint = {
      "line-color": token.outline,
      "line-opacity": 0.95,
      "line-width": Number.isFinite(Number(token.lineWidthMin)) && Number.isFinite(Number(token.lineWidthMax))
        ? ((Number(token.lineWidthMin) + Number(token.lineWidthMax)) / 2) * Number(displayProfile.lineWidthMultiplier || 1)
        : width,
    };
    if (gradient) paint["line-gradient"] = gradient;
    return paint;
  }

  function mountCategoryOverlay() {
    if (state.disposed || !map) return;
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
    if (state.processedStyleActive && !sourcePresent(map, BUFFERED_GRADIENT_SOURCE_ID) && typeof map.addSource === "function") {
      map.addSource(BUFFERED_GRADIENT_SOURCE_ID, { type: "geojson", data: featureCollection() });
    }
    if (typeof map.addLayer !== "function") {
      state.categoryMounted = sourcePresent(map, CATEGORY_SOURCE_ID) && sourcePresent(map, CATEGORY_OUTLINE_SOURCE_ID);
      return;
    }
    if (state.processedStyleActive) {
      mountProcessedCategoryLayers();
      state.categoryMounted = sourcePresent(map, CATEGORY_SOURCE_ID) && sourcePresent(map, CATEGORY_OUTLINE_SOURCE_ID);
      return;
    }
    const tokens = NLI_VISUAL_TOKENS.polygonCategories;
    const motionMode = state.currentFrame?.motionMode === "full" ? "full" : "reduced";
    for (const spec of CATEGORY_SPECS) {
      const token = tokens[spec.notes];
      const fillId = CATEGORY_FILL_LAYER_IDS[spec.suffix];
      const lineId = CATEGORY_LINE_LAYER_IDS[spec.suffix];
      const gradient = spec.suffix === "battle"
        ? buildDirectionalFlowGradient(
          { progress: 0 },
          motionMode,
          displayProfile,
          token.outline,
        )
        : null;
      addOwnedLayer({
        id: fillId,
        type: "fill",
        source: CATEGORY_SOURCE_ID,
        filter: notesEqualsFilter(spec.notes),
        paint: categoryFillPaint(token),
      });
      addOwnedLayer({
        id: lineId,
        type: "line",
        source: CATEGORY_OUTLINE_SOURCE_ID,
        filter: notesEqualsFilter(spec.notes),
        layout: { "line-cap": "round", "line-join": "round" },
        paint: categoryLinePaint(token, { gradient }),
      });
    }
    addOwnedLayer({
      id: CATEGORY_FILL_LAYER_IDS.fallback,
      type: "fill",
      source: CATEGORY_SOURCE_ID,
      filter: unmatchedNotesFilter(),
      paint: {
        "fill-color": NLI_VISUAL_TOKENS.polygonFallbackFill,
        "fill-opacity": 0.55,
      },
    });
    addOwnedLayer({
      id: CATEGORY_LINE_LAYER_IDS.fallback,
      type: "line",
      source: CATEGORY_OUTLINE_SOURCE_ID,
      filter: unmatchedNotesFilter(),
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": NLI_VISUAL_TOKENS.polygonFallbackFill,
        "line-opacity": 0.95,
        "line-width": 1.8 * Number(displayProfile.lineWidthMultiplier || 1),
      },
    });
    state.categoryMounted = sourcePresent(map, CATEGORY_SOURCE_ID)
      && sourcePresent(map, CATEGORY_OUTLINE_SOURCE_ID)
      && layerPresent(map, CATEGORY_FILL_LAYER_IDS.battle);
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
    for (const spec of CATEGORY_SPECS) {
      const classPlan = state.processedPlan.classes[spec.notes];
      const fillId = CATEGORY_FILL_LAYER_IDS[spec.suffix];
      const lineId = CATEGORY_LINE_LAYER_IDS[spec.suffix];
      const isGradient = (spec.suffix === "battle" || spec.suffix === "fire")
        && Array.isArray(classPlan?.bands) && classPlan.bands.length > 0;
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
      } else if (classPlan?.solid) {
        addOwnedLayer({
          id: fillId,
          type: "fill",
          source: CATEGORY_SOURCE_ID,
          filter: notesEqualsFilter(spec.notes),
          paint: {
            "fill-color": classPlan.solid.color || "#ffff73",
            "fill-opacity": classPlan.solid.opacity,
          },
        });
      } else if (spec.suffix === "kidnap") {
        addOwnedLayer({
          id: fillId,
          type: "fill",
          source: CATEGORY_SOURCE_ID,
          filter: notesEqualsFilter(spec.notes),
          paint: { "fill-color": "#ffff73", "fill-opacity": 0.55 },
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
    if (state.hostHidden || state.baseLayers.length === 0) return;
    for (const layer of state.baseLayers) {
      if (layer.type === "fill" || layer.type === "line") {
        setLayout(map, layer.id, "visibility", "none");
      }
    }
    state.hostHidden = true;
  }

  function showHostPack() {
    for (const layer of state.baseLayers) {
      if (layer.type === "fill" || layer.type === "line") {
        setLayout(map, layer.id, "visibility", "visible");
      }
    }
    state.hostHidden = false;
  }

  function warnUnmatchedNotes(features) {
    const known = state.processedStyleActive
      ? state.processedPlan.classes
      : NLI_VISUAL_TOKENS.polygonCategories;
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

  function parallelImpactOpacityExpression(ids, authoredOpacity = null) {
    if (authoredOpacity == null) {
      return [
        "case",
        ["in", ["to-string", ["get", "OBJECTID"]], ["literal", ids]],
        1,
        NOVA_PARALLEL_DIM_OPACITY,
      ];
    }
    const authored = Number.isFinite(Number(authoredOpacity)) ? Number(authoredOpacity) : 1;
    return [
      "case",
      ["in", ["to-string", ["get", "OBJECTID"]], ["literal", ids]],
      authored,
      ["*", authored, NOVA_PARALLEL_DIM_OPACITY],
    ];
  }

  function applyCategoryMotion(frame, data) {
    if (!state.categoryMounted) return;
    const motionMode = frame?.motionMode === "full" ? "full" : "reduced";
    const nowMs = frameNowMs(frame, data);
    const widthMul = Number(displayProfile.lineWidthMultiplier || 1);
    if (state.processedStyleActive) {
      const projectionNovaDim = frame?.projectionNovaDim === true || data?.projectionNovaDim === true;
      const impactIds = parallelImpactIdList(frame, data);
      for (const spec of CATEGORY_SPECS) {
        const classPlan = state.processedPlan.classes[spec.notes];
        const gradientCategory = spec.suffix === "battle" || spec.suffix === "fire";
        const authored = gradientCategory ? classPlan?.bands?.[0]?.opacity : classPlan?.solid?.opacity;
        if (!Number.isFinite(Number(authored))) continue;
        const ids = spec.suffix === "battle" || spec.suffix === "fire"
          ? state.processedFillLayerIds.filter((id) => id.includes(`fill-${spec.suffix}`))
          : [CATEGORY_FILL_LAYER_IDS[spec.suffix]];
        for (const id of ids) {
          const band = gradientCategory && classPlan?.bands?.find((entry) => id === CATEGORY_FILL_LAYER_IDS[spec.suffix]
            ? entry.ordinal === 0
            : id.endsWith(`-band-${entry.ordinal}`));
          const opacity = band?.opacity ?? classPlan?.solid?.opacity ?? authored;
          const sidecarReady = state.bufferedGradientSidecarStatus === "ready";
          setPaint(map, id, "fill-opacity", projectionNovaDim && (sidecarReady || !gradientCategory)
            ? parallelImpactOpacityExpression(impactIds, opacity)
            : (sidecarReady || !gradientCategory ? opacity : 0));
        }
        const outlineOpacity = Number(classPlan?.outline?.opacity);
        if (Number.isFinite(outlineOpacity)) {
          setPaint(map, CATEGORY_LINE_LAYER_IDS[spec.suffix], "line-opacity", projectionNovaDim
            ? parallelImpactOpacityExpression(impactIds, outlineOpacity)
            : outlineOpacity);
        }
      }
      state.lastCategoryMotionMode = motionMode;
      state.lastCategoryParallelDim = projectionNovaDim;
      state.lastCategoryParallelImpactKey = impactIds.join(",");
      return;
    }
    const tokens = NLI_VISUAL_TOKENS.polygonCategories;
    const battle = tokens[NOTES_BATTLE];
    const kidnap = tokens[NOTES_KIDNAP];
    const fire = tokens[NOTES_FIRE];
    const animate = motionMode === "full";
    const projectionNovaDim = frame?.projectionNovaDim === true || data?.projectionNovaDim === true;
    const impactIds = parallelImpactIdList(frame, data);
    const impactKey = impactIds.join(",");
    if (
      motionMode !== "full"
      && state.lastCategoryMotionMode === motionMode
      && state.lastCategoryParallelDim === projectionNovaDim
      && state.lastCategoryParallelImpactKey === impactKey
    ) return;
    const battleFill = animate
      ? oscillate(nowMs, battle.periodMs, battle.fillOpacityMin, battle.fillOpacityMax)
      : battle.fillOpacity;
    const kidnapFill = animate
      ? oscillate(nowMs, kidnap.periodMs, kidnap.fillOpacityMin, kidnap.fillOpacityMax)
      : kidnap.fillOpacity;
    const fireFill = animate
      ? oscillate(nowMs, fire.periodMs, fire.fillOpacityMin, fire.fillOpacityMax)
      : fire.fillOpacity;
    const fillFor = (tokenFill) => (
      projectionNovaDim ? parallelImpactOpacityExpression(impactIds) : tokenFill
    );
    setPaint(
      map,
      CATEGORY_FILL_LAYER_IDS.battle,
      "fill-opacity",
      fillFor(battleFill),
    );
    setPaint(
      map,
      CATEGORY_LINE_LAYER_IDS.battle,
      "line-gradient",
      buildDirectionalFlowGradient(
        { progress: animate ? (((nowMs / battle.periodMs) % 1) + 1) % 1 : 0 },
        motionMode,
        displayProfile,
        battle.outline,
      ),
    );
    setPaint(
      map,
      CATEGORY_FILL_LAYER_IDS.kidnap,
      "fill-opacity",
      fillFor(kidnapFill),
    );
    setPaint(
      map,
      CATEGORY_LINE_LAYER_IDS.kidnap,
      "line-width",
      (animate
        ? oscillate(nowMs, kidnap.periodMs, kidnap.lineWidthMin, kidnap.lineWidthMax)
        : (kidnap.lineWidthMin + kidnap.lineWidthMax) / 2) * widthMul,
    );
    setPaint(
      map,
      CATEGORY_FILL_LAYER_IDS.fire,
      "fill-opacity",
      fillFor(fireFill),
    );
    setPaint(
      map,
      CATEGORY_FILL_LAYER_IDS.fallback,
      "fill-opacity",
      projectionNovaDim ? parallelImpactOpacityExpression(impactIds) : 0.55,
    );
    if (projectionNovaDim) {
      const dimPaint = parallelImpactOpacityExpression(impactIds);
      setPaint(map, CATEGORY_LINE_LAYER_IDS.battle, "line-opacity", dimPaint);
      setPaint(map, CATEGORY_LINE_LAYER_IDS.kidnap, "line-opacity", dimPaint);
      setPaint(map, CATEGORY_LINE_LAYER_IDS.fire, "line-opacity", dimPaint);
      setPaint(map, CATEGORY_LINE_LAYER_IDS.fallback, "line-opacity", dimPaint);
    } else if (state.lastCategoryParallelDim) {
      setPaint(map, CATEGORY_LINE_LAYER_IDS.battle, "line-opacity", 0.95);
      setPaint(map, CATEGORY_LINE_LAYER_IDS.kidnap, "line-opacity", 0.95);
      setPaint(map, CATEGORY_LINE_LAYER_IDS.fire, "line-opacity", 0.95);
      setPaint(map, CATEGORY_LINE_LAYER_IDS.fallback, "line-opacity", 0.95);
    }
    state.lastCategoryMotionMode = motionMode;
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
      if (state.categoryMounted) hideHostPack();
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
      console.warn("Investigation polygon buffered-gradient sidecar failed; battle and fire fills are hidden.");
    }
    state.currentFrame = frame;
    mount({ settlementOnly: !renderPolygons });
    const achieved = asArray(frame.achievedPolygonBeats)
      .map(Number)
      .filter(Number.isFinite);
    const polygonKey = achievedKey(frame);
    const settlementKey = achievedSettlementKey(frame);
    const key = `${polygonKey}|${settlementKey}`;
    const membershipChanged = state.achievedMembershipKey !== key;
    const dataChanged = state.appliedRegistryGeneration !== state.registryGeneration;
    state.achievedMembershipKey = key;
    if (renderPolygons && state.categoryMounted) {
      hideHostPack();
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
    if (!membershipChanged && !dataChanged) return;
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
  }

  function reset({ preserveBasePaints = false, restoreHostVisibility = true } = {}) {
    if (state.disposed) return;
    const hasOwnedState =
      state.mounted ||
      state.currentFrame ||
      state.savedPaints ||
      state.baseLayersCaptured ||
      state.waitingForHostStyle ||
      state.overlayMounted ||
      state.categoryMounted ||
      state.hostHidden;
    if (!hasOwnedState) return;
    if (restoreHostVisibility) showHostPack();
    else state.hostHidden = false;
    removeOverlay();
    state.mounted = false;
    state.overlayMounted = false;
    state.categoryMounted = false;
    state.processedFillLayerIds = [];
    state.processedStyleActive = false;
    state.processedPlan = { field: "Notes", classes: {}, processed: false };
    state.lastCategoryMotionMode = null;
    state.lastCategoryNovaSiteExclusion = null;
    state.lastCategoryParallelDim = null;
    state.lastCategoryParallelImpactKey = null;
    state.waitingForHostStyle = false;
    state.baseLayers = [];
    state.baseLayersCaptured = false;
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
