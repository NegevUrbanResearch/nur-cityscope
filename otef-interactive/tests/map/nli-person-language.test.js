import { expect, test, vi } from 'vitest';
import { normalizePeopleRuntime, createGisPersonSelection } from '../../frontend/src/map/maplibre-person-selection.js';
import { createFakeMapLibreMap } from '../helpers/fake-maplibre-map.js';

test('GIS runtime resolves the canonical requested name rather than search aliases', () => {
  const properties = { pid: '1', hebrew_name: 'יוסף', name: 'Éé', source_lon: 34.5, source_lat: 31.4 };
  const geojson = { type: 'FeatureCollection', datasetVersion: 'v1', features: [{ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [34.6, 31.5] } }] };
  const index = { datasetVersion: 'v1', people: [{ pid: '1', nameForms: ['יוסף', 'Éé', 'English Alias'], location: 'Nova' }] };
  const runtime = normalizePeopleRuntime(geojson, index, { datasetVersion: 'v1' });
  expect(runtime.resolve('1', 'v1', 'en')).toMatchObject({ pid: '1', name: 'Éé', coordinates: [34.5, 31.4] });
  expect(runtime.resolve('1', 'v1', 'he').name).toBe('יוסף');
});

test('a language change preserves pending camera travel and rerenders the same selected person', async () => {
  const properties = { pid: '1', hebrew_name: 'יוסף', name: 'Éé' };
  const data = { type: 'FeatureCollection', datasetVersion: 'v1', features: [{ properties, geometry: { type: 'Point', coordinates: [34.5, 31.4] } }] };
  const index = { datasetVersion: 'v1', people: [{ pid: '1', nameForms: ['יוסף', 'Éé'] }] };
  const metadata = { datasetVersion: 'v1', runtimeArtifactHashes: { 'people.geojson': 'hash' } };
  const map = createFakeMapLibreMap(); map.flyTo = vi.fn();
  const bubble = { setLngLat: vi.fn().mockReturnThis(), setHTML: vi.fn().mockReturnThis(), addTo: vi.fn().mockReturnThis(), remove: vi.fn() };
  const visual = createGisPersonSelection({ map, maplibregl: { Popup: function() { return bubble; } },
    hashBytes: async () => 'hash', fetchJson: async url => ({ data: url.includes('index') ? index : url.includes('metadata') ? metadata : data, bytes: new Uint8Array([1]) }) });
  visual.show(await visual.resolve('1', 'v1'), { focus: true });
  visual.setLanguage('en');
  expect(bubble.setHTML).not.toHaveBeenCalled();
  map.emit('moveend');
  expect(bubble.setHTML.mock.calls.at(-1)[0]).toContain('Éé');
  expect(bubble.setHTML.mock.calls.at(-1)[0]).toContain('lang="en"');
  visual.setLanguage('he');
  expect(bubble.setHTML.mock.calls.at(-1)[0]).toContain('יוסף');
  expect(map.flyTo).toHaveBeenCalledTimes(1);
  visual.dispose();
});
