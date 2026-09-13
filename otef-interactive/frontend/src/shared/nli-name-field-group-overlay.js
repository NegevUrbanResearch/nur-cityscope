import { NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";

const SOURCE = 'nli-name-place-selection';
const HALO = 'nli-name-place-selection-halo';
const POINT = 'nli-name-place-selection-point';
const LABEL = 'nli-name-place-selection-label';
const OUTLINE_SOURCE = 'nli-name-place-outline';
const OUTLINE = 'nli-name-place-outline-line';
const empty = () => ({ type: 'FeatureCollection', features: [] });
const outlineUrl = '/otef-interactive/public/processed/layers/nli/investigation_settlements.geojson';
let sharedOutlines;
const defaultLoadOutlines = () => {
  if (!sharedOutlines) sharedOutlines = fetch(outlineUrl).then(response => {
    if (!response.ok) throw new Error(`NLI settlement outlines HTTP ${response.status}`);
    return response.json();
  }).catch(error => { sharedOutlines = null; throw error; });
  return sharedOutlines;
};

/** Show only the selected place at its recorded anchor. */
export function createNameGroupOverlay({ map, field, displayProfile = 'projection', motionMode = 'full', loadOutlines = defaultLoadOutlines }) {
  const groups = field.groupGeojson?.features || [];
  // Catalog settlements already have the normal map label, which memorial
  // focus highlights in place. Only sites such as Nova need an added label.
  const settlementGroups = groups.filter(feature =>
    feature.properties?.place_ids?.some(id => id.startsWith('yeshuv-')),
  ).map(feature => feature.properties.group_id);
  let disposed = false;
  let selected = null;
  let outlines = null;
  let outlineLoadPromise = null;
  let outlinedGroup = null;
  const fadeTimers = new Set();
  const fade = (id, property, target) => {
    if (!map.getLayer(id)) return;
    const transition = `${property}-transition`;
    map.setPaintProperty(id, transition, { duration: 0, delay: 0 });
    map.setPaintProperty(id, property, 0);
    if (motionMode === 'reduced') {
      map.setPaintProperty(id, property, target);
      return;
    }
    const timer = setTimeout(() => {
      fadeTimers.delete(timer);
      if (disposed || !map.getLayer(id)) return;
      map.setPaintProperty(id, transition, { duration: 350, delay: 0 });
      map.setPaintProperty(id, property, target);
    }, 0);
    fadeTimers.add(timer);
  };
  const cancelFades = () => {
    for (const timer of fadeTimers) clearTimeout(timer);
    fadeTimers.clear();
  };
  const syncOutline = () => {
    if (disposed) return;
    const name = selected?.properties?.name;
    const matching = name && Array.isArray(outlines?.features)
      ? outlines.features.filter(feature => feature.properties?.locations?.includes(name)) : [];
    map.getSource(OUTLINE_SOURCE)?.setData({ type: 'FeatureCollection', features: matching });
    const groupId = matching.length ? selected?.properties?.group_id : null;
    if (groupId !== outlinedGroup) {
      outlinedGroup = groupId;
      if (groupId) fade(OUTLINE, 'line-opacity', 0.9);
      else if (map.getLayer(OUTLINE)) map.setPaintProperty(OUTLINE, 'line-opacity', 0);
    }
  };
  const dispose = () => {
    disposed = true;
    cancelFades();
    for (const id of [LABEL, POINT, HALO]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getLayer(OUTLINE)) map.removeLayer(OUTLINE);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    if (map.getSource(OUTLINE_SOURCE)) map.removeSource(OUTLINE_SOURCE);
  };
  try {
    map.addSource(SOURCE, { type: 'geojson', data: empty() });
    map.addSource(OUTLINE_SOURCE, { type: 'geojson', data: empty() });
    map.addLayer({ id: OUTLINE, type: 'line', source: OUTLINE_SOURCE, paint: {
      'line-color': NLI_VISUAL_TOKENS.incidentRed, 'line-width': 2.5, 'line-opacity': 0,
    } });
    map.addLayer({ id: HALO, type: 'circle', source: SOURCE, paint: {
      'circle-radius': 14, 'circle-color': NLI_VISUAL_TOKENS.incidentRed, 'circle-opacity': .16,
      'circle-stroke-color': NLI_VISUAL_TOKENS.incidentRed, 'circle-stroke-width': 1,
    } });
    map.addLayer({ id: POINT, type: 'circle', source: SOURCE, paint: {
      'circle-radius': 4, 'circle-color': NLI_VISUAL_TOKENS.incidentRed, 'circle-stroke-color': '#000000', 'circle-stroke-width': 1,
    } });
    map.addLayer({ id: LABEL, type: 'symbol', source: SOURCE,
      filter: ['!', ['in', ['get', 'group_id'], ['literal', settlementGroups]]],
      layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Guttman Hatzvi', 'Arial Unicode MS Regular', 'sans-serif'],
      'text-size': displayProfile === 'gis' ? 15 : [
        'interpolate', ['exponential', 2], ['zoom'], 0,
        15 / 2 ** field.referenceZoom, 24, 15 * 2 ** (24 - field.referenceZoom),
      ],
      'text-anchor': 'bottom', 'text-offset': [0, -1],
      'text-rotate': field.heading, 'text-rotation-alignment': 'map',
      'text-allow-overlap': true, 'text-ignore-placement': true,
    }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 2 } });
  } catch (error) { dispose(); throw error; }
  return {
    groupForPlace(placeId) {
      return groups.find(feature => feature.properties?.place_ids?.includes(placeId))?.properties?.group_id || null;
    },
    update(groupId) {
      const previousGroup = selected?.properties?.group_id || null;
      selected = groups.find(feature => feature.properties?.group_id === groupId &&
        feature.geometry?.type === 'Point' && feature.geometry.coordinates?.length >= 2);
      const nextGroup = selected?.properties?.group_id || null;
      if (nextGroup !== previousGroup) {
        cancelFades();
        outlinedGroup = null;
      }
      map.getSource(SOURCE)?.setData(selected ? { type: 'FeatureCollection', features: [selected] } : empty());
      if (nextGroup !== previousGroup && nextGroup) {
        fade(HALO, 'circle-opacity', 0.16);
        fade(POINT, 'circle-opacity', 1);
        fade(LABEL, 'text-opacity', 1);
      }
      syncOutline();
      if (selected && !outlines && !outlineLoadPromise) outlineLoadPromise = Promise.resolve().then(loadOutlines).then(data => {
        if (disposed) return;
        outlines = data;
        syncOutline();
      }).catch(() => { outlineLoadPromise = null; });
    },
    dispose,
  };
}
