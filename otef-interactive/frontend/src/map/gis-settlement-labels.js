import placeCatalog from '../shared/place-navigation/place-catalog.generated.js';
import { EXCLUDED_SETTLEMENT_CODES } from '../shared/settlement-label-presentation.js';

export const GIS_SETTLEMENT_LABEL_LAYER_ID = 'gis-settlement-place-labels';

const collection = { type: 'FeatureCollection', features: placeCatalog.entries
  .filter(place => place.type === 'yeshuv' && place.citycode !== 'nvaP' && !EXCLUDED_SETTLEMENT_CODES.has(place.citycode))
  .map(place => ({ type: 'Feature', properties: { citycode: place.citycode, cityname: place.name.he, cityname_en: place.name.en, textAnchor: 'center', textOffset: [0,0] },
    geometry: { type: 'Point', coordinates: [place.cameraHint.center.lng, place.cameraHint.center.lat] } })) };

// Some reviewed mappings share an outline. Keep their labels on opposite sides of its center.
const collocated = new Map();
for (const feature of collection.features) {
  const key = feature.geometry.coordinates.join(',');
  if (!collocated.has(key)) collocated.set(key, []);
  collocated.get(key).push(feature);
}
for (const group of collocated.values()) if (group.length > 1) {
  group.forEach((feature, index) => {
    feature.properties.textAnchor = index % 2 ? 'right' : 'left';
    feature.properties.textOffset = [index % 2 ? -0.4 : 0.4, Math.floor(index / 2) * 1.4];
  });
}

/** Local data guarantees every canonical settlement is available at the Home zoom. */
export function installGisSettlementLabels(map, { font, size, color, language = 'he' } = {}) {
  if (typeof map?.addLayer !== 'function') return;
  if (!map.getSource?.(GIS_SETTLEMENT_LABEL_LAYER_ID)) map.addSource(GIS_SETTLEMENT_LABEL_LAYER_ID, { type: 'geojson', data: collection });
  const textField = ['get', language === 'en' ? 'cityname_en' : 'cityname'];
  const textFont = language === 'en' ? ['Arial'] : font;
  if (map.getLayer?.(GIS_SETTLEMENT_LABEL_LAYER_ID)) {
    map.setLayoutProperty?.(GIS_SETTLEMENT_LABEL_LAYER_ID, 'text-field', textField);
    if (textFont) map.setLayoutProperty?.(GIS_SETTLEMENT_LABEL_LAYER_ID, 'text-font', textFont);
    return;
  }
  map.addLayer({ id: GIS_SETTLEMENT_LABEL_LAYER_ID, type: 'symbol', source: GIS_SETTLEMENT_LABEL_LAYER_ID,
    layout: { 'text-field': textField, 'text-font': textFont, 'text-size': size,
      'text-anchor': ['get', 'textAnchor'], 'text-offset': ['get', 'textOffset'],
      'text-max-width': 100, 'text-allow-overlap': true, 'text-ignore-placement': true },
    paint: { 'text-color': color, 'text-halo-color': 'rgba(0,0,0,0.7)', 'text-halo-width': 1, 'text-opacity': 1 },
  });
}
