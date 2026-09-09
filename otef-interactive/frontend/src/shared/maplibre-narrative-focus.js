/**
 * MapLibre-owned, non-interactive marker used by active NLI narratives.
 * Narrative definitions are trusted registry entries; this renderer only
 * renders their coordinate and label, and has no selection or popup behavior.
 */

import { NLI_DISPLAY_PROFILES, NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";

export const NARRATIVE_FOCUS_RENDERER_IDS = Object.freeze({
  source: "nli-narrative-focus",
  halo: "nli-narrative-focus-halo",
  label: "nli-narrative-focus-label",
});

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

function featureFor(definition) {
  const label = typeof definition?.label === "string" ? definition.label : "";
  const coordinates = Array.isArray(definition?.center) ? definition.center : [];
  if (!label || coordinates.length !== 2 || !coordinates.every(Number.isFinite)) return null;
  return {
    type: "Feature",
    properties: { label },
    geometry: { type: "Point", coordinates: [...coordinates] },
  };
}

function collectionFor(definition) {
  const feature = featureFor(definition);
  return { type: "FeatureCollection", features: feature ? [feature] : [] };
}

/** Create a reusable marker renderer for GIS and projection narrative scenes. */
export function createNarrativeFocusRenderer(map, { profile } = {}) {
  const displayProfile = profileFor(profile);
  let definition = null;
  let disposed = false;

  function mount() {
    if (disposed || !definition || !map) return;
    const data = collectionFor(definition);
    if (!sourcePresent(map, NARRATIVE_FOCUS_RENDERER_IDS.source)) {
      map.addSource?.(NARRATIVE_FOCUS_RENDERER_IDS.source, { type: "geojson", data });
    } else {
      const source = map.getSource?.(NARRATIVE_FOCUS_RENDERER_IDS.source);
      source?.setData?.(data);
    }
    if (!layerPresent(map, NARRATIVE_FOCUS_RENDERER_IDS.halo)) {
      map.addLayer?.({
        id: NARRATIVE_FOCUS_RENDERER_IDS.halo,
        type: "circle",
        source: NARRATIVE_FOCUS_RENDERER_IDS.source,
        paint: {
          "circle-radius": displayProfile.narrativeFocus.haloRadius,
          "circle-color": NLI_VISUAL_TOKENS.incidentRed,
          "circle-opacity": 0.9,
          "circle-stroke-color": NLI_VISUAL_TOKENS.annotationInk,
          "circle-stroke-width": displayProfile.narrativeFocus.haloStrokeWidth,
        },
      });
    }
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
          "text-offset": [0, -0.8],
        },
        paint: {
          "text-color": NLI_VISUAL_TOKENS.annotationInk,
          "text-halo-color": NLI_VISUAL_TOKENS.incidentRed,
          "text-halo-width": displayProfile.narrativeFocus.textHaloWidth,
        },
      });
    }
    // Curated layers can arrive after this marker. Keep the halo over map
    // content and the Hebrew label above its halo on every safe remount.
    bringToFront(map, NARRATIVE_FOCUS_RENDERER_IDS.halo);
    bringToFront(map, NARRATIVE_FOCUS_RENDERER_IDS.label);
  }

  function show(nextDefinition) {
    if (disposed || !featureFor(nextDefinition)) return;
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
      clear();
      disposed = true;
    },
  };
}
