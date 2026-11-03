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

describe('selected NLI place overlay', () => {
  it('does not mount place chrome and still maps a place to its group', () => {
    const map = createFakeMapLibreMap();
    const overlay = createNameGroupOverlay({ map, field });
    overlay.update('nova');
    expect(map.getLayer("nli-name-place-selection-point")).toBeFalsy();
    expect(map.getLayer("nli-name-place-selection-halo")).toBeFalsy();
    expect(map.getLayer("nli-name-place-selection-label")).toBeFalsy();
    expect(map.getLayer("nli-name-place-outline-line")).toBeFalsy();
    expect(overlay.groupForPlace("custom-reim-parking")).toBe("nova");
    expect(overlay.groupForPlace('unknown')).toBeNull();
    overlay.dispose();
  });

  it('rejects invalid overlay opacity without mounting layers', () => {
    const map = createFakeMapLibreMap();
    const overlay = createNameGroupOverlay({ map, field });
    expect(() => overlay.setOpacity(-0.1)).toThrow('invalid place overlay opacity');
    expect(() => overlay.setOpacity(1.1)).toThrow('invalid place overlay opacity');
    overlay.setOpacity(0.5);
    expect(map.getLayer("nli-name-place-selection-point")).toBeFalsy();
    overlay.dispose();
  });

  it('dispose is safe when nothing was added', () => {
    const map = createFakeMapLibreMap();
    const overlay = createNameGroupOverlay({ map, field });
    overlay.dispose();
    expect(map.getLayer("nli-name-place-selection-point")).toBeFalsy();
    expect(map.getSource('nli-name-place-selection')).toBeFalsy();
    expect(() => overlay.dispose()).not.toThrow();
  });
});
