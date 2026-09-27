/**
 * MapLibre-owned, non-interactive label used by active NLI narratives.
 * House outlines own the name when present; this renderer only places the
 * Hebrew label above the matching polygon (or the coded point as fallback).
 */

import { NLI_DISPLAY_PROFILES, NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";

export const NARRATIVE_FOCUS_RENDERER_IDS = Object.freeze({
  source: "nli-narrative-focus",
  halo: "nli-narrative-focus-halo",
  label: "nli-narrative-focus-label",
});

const HOUSE_OUTLINE_SOURCE_ID = "nli.narrative_polygon";

function layerPresent(map, id) {
  try {
    return !!map?.getLayer?.(id);
  } catch (_) {
    return false;
  }
}

function sourcePresent(map, id) {
  try {
    return !!map?.getSource?.(id);
  } catch (_) {
    return false;
  }
}

function removeLayer(map, id) {
  if (!layerPresent(map, id) || typeof map?.removeLayer !== "function") return;
  try { map.removeLayer(id); } catch (_) { /* style may have changed */ }
}

function removeSource(map, id) {
  if (!sourcePresent(map, id) || typeof map?.removeSource !== "function") return;
  try { map.removeSource(id); } catch (_) { /* a host layer may still own it */ }
}

function bringToFront(map, id) {
  if (!layerPresent(map, id) || typeof map?.moveLayer !== "function") return;
  try { map.moveLayer(id); } catch (_) { /* style may have changed */ }
}

function profileFor(profile) {
  const selected = typeof profile === "string"
    ? NLI_DISPLAY_PROFILES[profile]
    : profile;
  return {
    ...NLI_DISPLAY_PROFILES.gis,
    ...(selected && typeof selected === "object" ? selected : {}),
    narrativeFocus: {
      ...NLI_DISPLAY_PROFILES.gis.narrativeFocus,
      ...(selected?.narrativeFocus || {}),
    },
  };
}

function flattenRingCoordinates(geometry) {
  if (!geometry || typeof geometry !== "object") return [];
  if (geometry.type === "Polygon") return (geometry.coordinates || []).flat();
  if (geometry.type === "MultiPolygon") return (geometry.coordinates || []).flat(2);
  return [];
}

function topCenterOfPolygon(geometry) {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const pair of flattenRingCoordinates(geometry)) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const lon = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  if (!Number.isFinite(minLon) || !Number.isFinite(maxLon) || !Number.isFinite(maxLat)) return null;
  return [(minLon + maxLon) / 2, maxLat];
}

function compactNote(value) {
  return String(value || "").replace(/ה/g, "").replace(/\s+/g, " ").trim();
}

function notesMatch(label, note) {
  if (!label || !note) return false;
  if (note === label) return true;
  const compactLabel = compactNote(label);
  const compactNoteValue = compactNote(note);
  return Boolean(compactLabel)
    && Boolean(compactNoteValue)
    && (compactNoteValue.includes(compactLabel) || compactLabel.includes(compactNoteValue));
}

function matchingHouseFeature(definition, features) {
  const label = definition?.label;
  return (features || []).find((feature) => notesMatch(label, feature?.properties?.note)) || null;
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

function houseFeaturesFromMap(map) {
  const fromSource = featuresFromSource(
    typeof map?.getSource === "function" ? map.getSource(HOUSE_OUTLINE_SOURCE_ID) : null,
  );
  if (fromSource.length) return fromSource;
  if (typeof map?.querySourceFeatures === "function") {
    try {
      const queried = map.querySourceFeatures(HOUSE_OUTLINE_SOURCE_ID);
      if (Array.isArray(queried) && queried.length) return queried;
    } catch (_) {
      /* source may be missing */
    }
  }
  return [];
}

function fallbackCoordinates(definition) {
  const coordinates = Object.prototype.hasOwnProperty.call(definition || {}, "marker")
    ? definition.marker
    : definition?.center;
  if (!Array.isArray(coordinates) || coordinates.length !== 2
    || !coordinates.every(Number.isFinite)) return null;
  return [...coordinates];
}

function featureFor(definition, map) {
  const label = typeof definition?.label === "string" ? definition.label : "";
  if (!label) return null;
  const house = matchingHouseFeature(definition, houseFeaturesFromMap(map));
  const coordinates = topCenterOfPolygon(house?.geometry) || fallbackCoordinates(definition);
  if (!coordinates) return null;
  return {
    type: "Feature",
    properties: { label },
    geometry: { type: "Point", coordinates },
  };
}

function collectionFor(definition, map) {
  const feature = featureFor(definition, map);
  return { type: "FeatureCollection", features: feature ? [feature] : [] };
}

/** Create a reusable label renderer for GIS and projection narrative scenes. */
export function createNarrativeFocusRenderer(map, { profile } = {}) {
  const displayProfile = profileFor(profile);
  let definition = null;
  let disposed = false;

  function onSourceData(event) {
    if (disposed || !definition) return;
    if (event?.sourceId !== HOUSE_OUTLINE_SOURCE_ID) return;
    if (event?.isSourceLoaded === false) return;
    mount();
  }

  if (typeof map?.on === "function") {
    map.on("sourcedata", onSourceData);
  }

  function mount() {
    if (disposed || !definition || !map) return;
    const data = collectionFor(definition, map);
    if (!sourcePresent(map, NARRATIVE_FOCUS_RENDERER_IDS.source)) {
      map.addSource?.(NARRATIVE_FOCUS_RENDERER_IDS.source, { type: "geojson", data });
    } else {
      const source = map.getSource?.(NARRATIVE_FOCUS_RENDERER_IDS.source);
      source?.setData?.(data);
    }
    removeLayer(map, NARRATIVE_FOCUS_RENDERER_IDS.halo);
    if (!layerPresent(map, NARRATIVE_FOCUS_RENDERER_IDS.label)) {
      map.addLayer?.({
        id: NARRATIVE_FOCUS_RENDERER_IDS.label,
        type: "symbol",
        source: NARRATIVE_FOCUS_RENDERER_IDS.source,
        layout: {
          "text-field": ["get", "label"],
          "text-size": displayProfile.narrativeFocus.textSize,
          "text-allow-overlap": true,
          "text-anchor": "bottom",
          "text-offset": [0, -0.4],
        },
        paint: {
          "text-color": NLI_VISUAL_TOKENS.annotationInk,
          "text-halo-color": NLI_VISUAL_TOKENS.incidentRed,
          "text-halo-width": displayProfile.narrativeFocus.textHaloWidth,
        },
      });
    }
    bringToFront(map, NARRATIVE_FOCUS_RENDERER_IDS.label);
  }

  function show(nextDefinition) {
    if (disposed) return;
    if (!featureFor(nextDefinition, map)) {
      clear();
      return;
    }
    definition = nextDefinition;
    mount();
  }

  function clear() {
    definition = null;
    removeLayer(map, NARRATIVE_FOCUS_RENDERER_IDS.label);
    removeLayer(map, NARRATIVE_FOCUS_RENDERER_IDS.halo);
    removeSource(map, NARRATIVE_FOCUS_RENDERER_IDS.source);
  }

  return {
    show,
    clear,
    onStyleLoad: mount,
    dispose() {
      if (disposed) return;
      if (typeof map?.off === "function") {
        map.off("sourcedata", onSourceData);
      }
      clear();
      disposed = true;
    },
  };
}
