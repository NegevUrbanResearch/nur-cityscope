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

const SETTLEMENT_SOURCE_ID = "nli-investigation-settlement-impact";
const SETTLEMENT_LAYER_ID = "nli-investigation-settlement-impact-outline";
const POLYGON_LAYER_PREFIX = INVESTIGATION_POLYGONS_FULL_ID.replace(/\./g, "__");
const ORANGE = NLI_VISUAL_TOKENS.polygonOrange;
const RED = NLI_VISUAL_TOKENS.incidentRed;

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

function polygonPaintExpression(achieved, future, active) {
  return [
    "case",
    ["in", ["get", "timeline_minutes"], ["literal", achieved]],
    active,
    future,
  ];
}

function setPaint(map, id, property, value) {
  if (typeof map?.setPaintProperty !== "function") return;
  try {
    map.setPaintProperty(id, property, value);
  } catch (_) {
    // The base style can be replaced between collection and application.
  }
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
    inputRefs: {
      polygonFeatures: undefined,
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
          "line-width": 1.8 * Number(displayProfile.lineWidthMultiplier || 1),
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
    mountSettlementOverlay();
  }

  function render(frame = {}, data = {}, { renderPolygons = true } = {}) {
    if (state.disposed) return;
    absorbData(data);
    mount({ settlementOnly: !renderPolygons });
    state.currentFrame = frame;
    const achieved = asArray(frame.achievedPolygonBeats)
      .map(Number)
      .filter(Number.isFinite);
    const polygonKey = achievedKey(frame);
    const settlementKey = achievedSettlementKey(frame);
    const key = `${polygonKey}|${settlementKey}`;
    const membershipChanged = state.achievedMembershipKey !== key;
    const dataChanged = state.appliedRegistryGeneration !== state.registryGeneration;
    state.achievedMembershipKey = key;
    const paintSignature = [
      "polygon-paint-v1",
      polygonKey,
      state.mountGeneration,
      Number(displayProfile.lineWidthMultiplier || 1),
      state.registryGeneration,
    ].join("|");
    if (renderPolygons && state.appliedPaintSignature !== paintSignature) {
      const fillColor = polygonPaintExpression(achieved, ORANGE, RED);
      const lineColor = polygonPaintExpression(achieved, ORANGE, RED);
      const fillOpacity = polygonPaintExpression(achieved, 0.16, 0.7);
      const lineOpacity = polygonPaintExpression(achieved, 0.3, 0.95);
      const lineWidth = polygonPaintExpression(
        achieved,
        0.9 * Number(displayProfile.lineWidthMultiplier || 1),
        2 * Number(displayProfile.lineWidthMultiplier || 1),
      );
      for (const layer of state.baseLayers) {
        if (layer.type === "fill") {
          setPaint(map, layer.id, "fill-color", fillColor);
          setPaint(map, layer.id, "fill-opacity", fillOpacity);
        } else if (layer.type === "line") {
          setPaint(map, layer.id, "line-color", lineColor);
          setPaint(map, layer.id, "line-opacity", lineOpacity);
          setPaint(map, layer.id, "line-width", lineWidth);
        }
      }
      state.appliedPaintSignature = paintSignature;
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

  function restoreBasePaints() {
    if (state.savedPaints) {
      for (const [id, paints] of Object.entries(state.savedPaints)) {
        for (const [property, value] of Object.entries(paints)) {
          if (value !== undefined) setPaint(map, id, property, value);
        }
      }
    }
    for (const layer of polygonLayers(map)) {
      if (layer.type === "fill") {
        setPaint(map, layer.id, "fill-color", ORANGE);
        setPaint(map, layer.id, "fill-opacity", 0.16);
      } else if (layer.type === "line") {
        setPaint(map, layer.id, "line-color", ORANGE);
        setPaint(map, layer.id, "line-opacity", 0.3);
        setPaint(map, layer.id, "line-width", 0.9 * Number(displayProfile.lineWidthMultiplier || 1));
      }
    }
  }

  function removeOverlay() {
    if (layerPresent(map, SETTLEMENT_LAYER_ID) && typeof map.removeLayer === "function") {
      try { map.removeLayer(SETTLEMENT_LAYER_ID); } catch (_) { /* stale style */ }
    }
    if (sourcePresent(map, SETTLEMENT_SOURCE_ID) && typeof map.removeSource === "function") {
      try { map.removeSource(SETTLEMENT_SOURCE_ID); } catch (_) { /* stale style */ }
    }
  }

  function reset({ preserveBasePaints = false } = {}) {
    if (state.disposed) return;
    const hasOwnedState =
      state.mounted ||
      state.currentFrame ||
      state.savedPaints ||
      state.baseLayersCaptured ||
      state.waitingForHostStyle ||
      state.overlayMounted;
    if (!hasOwnedState) return;
    if (!preserveBasePaints) restoreBasePaints();
    removeOverlay();
    state.mounted = false;
    state.overlayMounted = false;
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
});
