/**
 * MapLibre-owned, non-interactive label used by active NLI narratives.
 * House outlines own the name when present; this renderer only places the
 * Hebrew label above the matching polygon (or the coded point as fallback).
 */

import { getLayerLifecycleRuntime } from "./layer-lifecycle-fade.js";
import { getNliNarrative } from "./nli-narratives.js";
import { peopleFilterForNarrative, houseOutlineFilterForNarrative } from "../map/nli-people-marker-filter.js";

export const NARRATIVE_FOCUS_SCENE_ID = "nli.scene-focus";

export function getNarrativeSceneContentKey(snapshot, fullId) {
  const definition = getNliNarrative(snapshot.narrativeState?.id);
  if (fullId === NARRATIVE_FOCUS_SCENE_ID) return JSON.stringify(definition);
  if (fullId === "nli.people") return JSON.stringify(peopleFilterForNarrative(definition?.id ?? null));
  if (fullId === "nli.narrative_polygon") return JSON.stringify(houseOutlineFilterForNarrative(definition?.id ?? null));
  return undefined;
}

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
export function createNarrativeFocusRenderer(map, { profile, managedScene = false, getLanguage } = {}) {
  const displayProfile = profileFor(profile);
  let definition = null;
  let disposed = false;
  let runtime = managedScene ? getLayerLifecycleRuntime(map) : null;
  let cancelDeparture = null, sceneHeld = false;
  let mountedLanguage = null;
  const readLanguage = () => getLanguage?.() === 'en' ? 'en' : 'he';
  const font = () => readLanguage() === 'en' ? ['Arial'] : ['Guttman Hatzvi', 'Arial'];

  function refresh() {
    if (disposed || !definition || readLanguage() === mountedLanguage) return;
    map.getSource?.(NARRATIVE_FOCUS_RENDERER_IDS.source)?.setData?.(collectionFor(definition, map, readLanguage()));
    if (layerPresent(map, NARRATIVE_FOCUS_RENDERER_IDS.label)) map.setLayoutProperty?.(NARRATIVE_FOCUS_RENDERER_IDS.label, 'text-font', font());
    mountedLanguage = readLanguage();
  }

  function onSourceData(event) {
    if (disposed || !definition || sceneHeld) return;
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
    const haloColor = definition.id === "nova"
      ? NLI_VISUAL_TOKENS.annotationHalo
      : NLI_VISUAL_TOKENS.incidentRed;
    if (!layerPresent(map, NARRATIVE_FOCUS_RENDERER_IDS.label)) {
      const layer = {
        id: NARRATIVE_FOCUS_RENDERER_IDS.label,
        type: "symbol",
        source: NARRATIVE_FOCUS_RENDERER_IDS.source,
        layout: {
          "text-field": ["get", "label"],
          "text-font": ["Guttman Hatzvi", "Arial"],
          "text-size": displayProfile.narrativeFocus.textSize,
          "text-allow-overlap": true,
          "text-anchor": "bottom",
          "text-offset": [0, -0.4],
        },
        paint: {
          "text-opacity": 1,
          "text-color": NLI_VISUAL_TOKENS.annotationInk,
          "text-halo-color": haloColor,
          "text-halo-width": displayProfile.narrativeFocus.textHaloWidth,
        },
      };
      const staged = runtime?.stageMapLayer(NARRATIVE_FOCUS_SCENE_ID, layer);
      map.addLayer?.(staged?.stagedLayerDef || layer);
    } else {
      map.setLayoutProperty?.(NARRATIVE_FOCUS_RENDERER_IDS.label, 'text-font', font());
      map.setPaintProperty?.(NARRATIVE_FOCUS_RENDERER_IDS.label, "text-halo-color", haloColor);
    }
    if (runtime) {
      runtime.subscribeMemberReady(NARRATIVE_FOCUS_SCENE_ID, ({ ready, failed }) => {
        const onData = event => { if (event?.sourceId === NARRATIVE_FOCUS_RENDERER_IDS.source && map.isSourceLoaded?.(event.sourceId)) ready(); };
        const onError = event => { if (event?.sourceId === NARRATIVE_FOCUS_RENDERER_IDS.source) failed(); };
        map.on?.("sourcedata", onData); map.on?.("error", onError);
        if (map.isSourceLoaded?.(NARRATIVE_FOCUS_RENDERER_IDS.source)) ready();
        return () => { map.off?.("sourcedata", onData); map.off?.("error", onError); };
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
    cancelDeparture?.(); cancelDeparture = null; sceneHeld = false;
    if (definition === nextDefinition && sourcePresent(map, NARRATIVE_FOCUS_RENDERER_IDS.source) && layerPresent(map, NARRATIVE_FOCUS_RENDERER_IDS.label)) { refresh(); return; }
    definition = nextDefinition;
    mount();
  }

  function clear({ sceneDeparture = managedScene } = {}) {
    if (runtime && sceneDeparture && definition) {
      cancelDeparture?.();
      cancelDeparture = runtime.onMemberHidden(NARRATIVE_FOCUS_SCENE_ID, () => clear({ sceneDeparture: false }));
      return;
    }
    definition = null;
    removeLayer(map, NARRATIVE_FOCUS_RENDERER_IDS.label);
    removeLayer(map, NARRATIVE_FOCUS_RENDERER_IDS.halo);
    removeSource(map, NARRATIVE_FOCUS_RENDERER_IDS.source);
  }

  return {
    show,
    clear,
    holdForScene() {
      sceneHeld = true;
      if (runtime && definition) { cancelDeparture?.(); cancelDeparture = runtime.onMemberHidden(NARRATIVE_FOCUS_SCENE_ID, () => clear({ sceneDeparture: false })); }
    },
    resumeForScene() { cancelDeparture?.(); cancelDeparture = null; sceneHeld = false; },
    onStyleLoad: mount,
    resetStyle() { cancelDeparture?.(); cancelDeparture = null; if (managedScene) runtime = getLayerLifecycleRuntime(map); },
    dispose() {
      if (disposed) return;
      if (typeof map?.off === "function") {
        map.off("sourcedata", onSourceData);
      }
      cancelDeparture?.();
      clear({ sceneDeparture: false });
      disposed = true;
    },
  };
}
