import { expect, test } from 'vitest';
import { createFakeMapLibreMap } from '../helpers/fake-maplibre-map.js';
import { installGisSettlementLabels, GIS_SETTLEMENT_LABEL_LAYER_ID } from '../../frontend/src/map/gis-settlement-labels.js';
import { raiseDarkBasemapPlaceLabels } from '../../frontend/src/map/dark-basemap-labels.js';

test('GIS settlement and separate Nova label switch language without replacing geometry or revealing hidden Nova', () => {
  const map = createFakeMapLibreMap();
  installGisSettlementLabels(map, { language: 'he', font: ['Guttman Hatzvi'] });
  const source = map.getSource(GIS_SETTLEMENT_LABEL_LAYER_ID);
  const geometry = structuredClone(source._data || source.data);
  raiseDarkBasemapPlaceLabels(map, { language: 'en', narrativeId: 'nova' });
  expect(map.getLayoutProperty(GIS_SETTLEMENT_LABEL_LAYER_ID, 'text-field')).toEqual(['get', 'cityname_en']);
  expect(map.getLayoutProperty(GIS_SETTLEMENT_LABEL_LAYER_ID, 'text-font')).toEqual(['Arial']);
  expect(map.getLayoutProperty('gis-nova-place-label', 'text-field')).toBe('Nova');
  expect(map.getLayoutProperty('gis-nova-place-label', 'visibility')).toBe('none');
  expect(source._data || source.data).toEqual(geometry);
  raiseDarkBasemapPlaceLabels(map);
  expect(map.getLayoutProperty(GIS_SETTLEMENT_LABEL_LAYER_ID, 'text-field')).toEqual(['get', 'cityname_en']);
  expect(map.getLayoutProperty('gis-nova-place-label', 'text-field')).toBe('Nova');
  raiseDarkBasemapPlaceLabels(map, { language: 'he' });
  expect(map.getLayoutProperty(GIS_SETTLEMENT_LABEL_LAYER_ID, 'text-field')).toEqual(['get', 'cityname']);
});
