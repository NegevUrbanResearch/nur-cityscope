import placeCatalog from './place-navigation/place-catalog.generated.js';
const englishNames = new Map(placeCatalog.entries.map(place => [place.citycode, place.name?.en]));
const SETTLEMENT_LAYER_ID = "projector_base.שמות_יישובים";

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function buildSettlementNameCatalog(featureCollection, { outlines: outlineCollection, outlineMap } = {}) {
  if (!featureCollection || featureCollection.type !== "FeatureCollection" || !Array.isArray(featureCollection.features)) {
    throw new TypeError("settlement catalog requires a FeatureCollection");
  }
  const seen = new Set();
  const entries = [];
  const referenceOffsets = new Map();
  const supplementalCodes = new Set();
  for (const feature of featureCollection.features) {
    const citycode = feature?.properties?.citycode;
    if (typeof citycode !== "string" || !citycode) throw new TypeError("settlement catalog feature is missing a citycode");
    if (seen.has(citycode)) throw new TypeError(`duplicate settlement citycode ${citycode}`);
    seen.add(citycode);
    if (feature.properties.otef_supplemental_label === true) supplementalCodes.add(citycode);
    const coordinates = feature?.geometry?.type === "Point" ? feature.geometry.coordinates : null;
    if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.slice(0, 2).every(finite)) {
      throw new TypeError(`settlement catalog geometry is invalid for ${citycode}`);
    }
    const text = feature.properties.cityname ?? feature.properties.citylabel ?? "";
    entries.push({ citycode, text: String(text), names: { he: String(text), en: englishNames.get(citycode) }, lng: coordinates[0], lat: coordinates[1] });
    const stored=feature.properties.otef_map_text_offset_em;
    const offset=Array.isArray(stored) && stored.length===2 && stored.every(finite) ? stored : [Number(feature.properties.otef_label_offset_em_x)||0,Number(feature.properties.otef_label_offset_em_y)||0].map(value=>value/14);
    referenceOffsets.set(citycode,[...offset]);
  }
  const outlines = new Map();
  const geometryById = new Map((outlineCollection?.features || []).map(f => [String(f.properties?.OBJECTID), f.geometry]));
  const matches = [...(outlineMap?.matches || [])];
  for (const feature of outlineCollection?.features || []) {
    const p = feature.properties;
    if (p?.otef_supplemental_outline && !matches.some(match => match.citycode === p.citycode)) matches.push({ citycode: p.citycode, outlineObjectId: p.OBJECTID });
  }
  for (const match of matches) {
    const geometry = geometryById.get(String(match.outlineObjectId));
    if (geometry?.type === 'Polygon') outlines.set(match.citycode, [geometry.coordinates[0]]);
    else if (geometry?.type === 'MultiPolygon') outlines.set(match.citycode, geometry.coordinates.map(polygon => polygon[0]));
  }
  return { entries, byCode: new Map(entries.map((entry) => [entry.citycode, entry])), referenceOffsets, outlines, supplementalCodes };
}

export async function loadSettlementNameCatalog({ registry, fetchImpl, signal }) {
  if (signal?.aborted) throw new DOMException("aborted", "AbortError");
  const url = registry?.getLayerDataUrl?.(SETTLEMENT_LAYER_ID);
  if (!url) throw new TypeError("settlement catalog source is unavailable");
  const directory = url.slice(0, url.lastIndexOf('/') + 1);
  const read = async path => {
    const response = await fetchImpl(path, { signal, cache: 'no-cache' });
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    if (!response?.ok) throw new Error(`settlement catalog request failed: ${path}`);
    return response.json();
  };
  const [names, outlines, outlineMap, additions] = await Promise.all([read(url), read(`${directory}ישובים.geojson`), read(`${directory}yeshuv-outline-map.json`), read(`${directory}../../../settlement-label-additions.json`)]);
  if (Array.isArray(additions) && Array.isArray(outlineMap.matches)) for (const addition of additions) {
    if (!outlineMap.matches.some(match => match.citycode === addition.citycode)) outlineMap.matches.push(addition);
  }
  return buildSettlementNameCatalog(names, { outlines, outlineMap });
}
