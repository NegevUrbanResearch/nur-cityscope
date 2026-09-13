import { describe, it, expect } from 'vitest';
import { createFakeMapLibreMap } from '../helpers/fake-maplibre-map.js';
import { createNameGroupOverlay } from '../../frontend/src/shared/nli-name-field-group-overlay.js';

const selected = { type: 'Feature', properties: {
  group_id: 'nova', name: 'נובה', place_ids: ['custom-reim-parking'],
}, geometry: { type: 'Point', coordinates: [34.4713, 31.3972] } };
const beeri = { type: 'Feature', properties: {
  group_id: 'beeri', name: 'בארי', place_ids: ['yeshuv-0399'],
}, geometry: { type: 'Point', coordinates: [34.49, 31.42] } };
const field = { heading: 41, referenceZoom: 11, groupGeojson: { type: 'FeatureCollection', features: [selected, beeri] } };
const outlines = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { locations: ['בארי'], outlineObjectId: 19 }, geometry: {
    type: 'Polygon', coordinates: [[[34.48, 31.41], [34.5, 31.41], [34.5, 31.43], [34.48, 31.41]]],
  } },
] };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('selected NLI place overlay', () => {
  it('starts empty, marks only the selected actual source point, clears and disposes', async () => {
    const map = createFakeMapLibreMap();
    const overlay = createNameGroupOverlay({ map, field, projectionSpan: 'left', loadOutlines: () => Promise.resolve(outlines) });
    expect(overlay.groupForPlace('custom-reim-parking')).toBe('nova');
    expect(overlay.groupForPlace('unknown')).toBeNull();
    expect(map.getSource('nli-name-place-selection').data.features).toEqual([]);
    expect(map.getLayer('nli-name-place-selection-label').filter).toEqual([
      '!', ['in', ['get', 'group_id'], ['literal', ['beeri']]],
    ]);
    expect(map.getLayer('nli-name-place-selection-label').layout['text-rotate']).toBe(41);
    expect(map.getLayer('nli-name-place-selection-label').layout['text-rotation-alignment']).toBe('map');
    expect(map.getLayer('nli-name-place-selection-label').layout['text-size']).toEqual([
      'interpolate', ['exponential', 2], ['zoom'], 0, 15 / 2 ** 11, 24, 15 * 2 ** 13,
    ]);
    overlay.update('nova', true);
    expect(map.getSource('nli-name-place-selection').data.features).toEqual([selected]);
    await flush();
    expect(map.getSource('nli-name-place-outline').data.features).toEqual([]);
    overlay.update('beeri');
    expect(map.getSource('nli-name-place-outline').data.features).toEqual(outlines.features);
    overlay.update(null);
    expect(map.getSource('nli-name-place-selection').data.features).toEqual([]);
    expect(map.getSource('nli-name-place-outline').data.features).toEqual([]);
    overlay.dispose();
    expect(map.getSource('nli-name-place-selection')).toBeNull();
    expect(map.getSource('nli-name-place-outline')).toBeNull();
  });

  it('ignores an outline response that arrives after disposal', async () => {
    let finish;
    const map = createFakeMapLibreMap();
    const overlay = createNameGroupOverlay({ map, field, displayProfile: 'gis',
      loadOutlines: () => new Promise(resolve => { finish = resolve; }) });
    expect(map.getLayer('nli-name-place-selection-label').layout['text-size']).toBe(15);
    overlay.update('beeri');
    await flush();
    overlay.dispose();
    finish(outlines);
    await flush();
    expect(map.getSource('nli-name-place-outline')).toBeNull();
  });

  it('fades a selected place and starts the outline fade only after geometry arrives', async () => {
    let finish;
    const map = createFakeMapLibreMap();
    const overlay = createNameGroupOverlay({ map, field, loadOutlines: () => new Promise(resolve => { finish = resolve; }) });
    overlay.update('beeri');
    expect(map.getPaintProperty('nli-name-place-selection-point', 'circle-opacity')).toBe(0);
    expect(map.getPaintProperty('nli-name-place-selection-label', 'text-opacity')).toBe(0);
    await flush();
    expect(map.getPaintProperty('nli-name-place-selection-point', 'circle-opacity')).toBe(1);
    expect(map.getPaintProperty('nli-name-place-selection-point', 'circle-opacity-transition')).toEqual({ duration: 350, delay: 0 });
    expect(map.getLayer('nli-name-place-outline-line').paint['line-opacity']).toBe(0);
    finish(outlines);
    await flush();
    await flush();
    expect(map.getSource('nli-name-place-outline').data.features).toEqual(outlines.features);
    expect(map.getPaintProperty('nli-name-place-outline-line', 'line-opacity')).toBe(0.9);
    expect(map.getPaintProperty('nli-name-place-outline-line', 'line-opacity-transition')).toEqual({ duration: 350, delay: 0 });
    overlay.dispose();
  });

  it('removes partially mounted resources if map styling fails', () => {
    const map = createFakeMapLibreMap();
    const add = map.addLayer.bind(map);
    map.addLayer = layer => {
      if (layer.id === 'nli-name-place-selection-label') throw new Error('style unavailable');
      add(layer);
    };
    expect(() => createNameGroupOverlay({ map, field })).toThrow('style unavailable');
    expect(map.getSource('nli-name-place-selection')).toBeNull();
    expect(map.getSource('nli-name-place-outline')).toBeNull();
    expect(map.getLayer('nli-name-place-selection-point')).toBeNull();
  });
});
