import { test, expect } from 'vitest';
import { createNliNameFocusPresentation, getNameFocusOpacity, getRelevantPlaceGroup } from '../../frontend/src/shared/nli-name-focus-presentation.js';
import { applySettlementOrientationPaint, collectOrientationTargets } from '../../frontend/src/shared/nli-settlement-orientation.js';

const field = {
  byPid: new Map([['person-1', { feature: { properties: { group_id: 'group-1' } } }]]),
  groupGeojson: { features: [{ properties: { group_id: 'group-1', name: 'מקום' } }] },
};

test('person and place focus retain relevant memorial names', () => {
  expect(getRelevantPlaceGroup(field, 'person-1', null)).toBe('group-1');
  expect(getNameFocusOpacity({ selectedPid: 'person-1', field })).toEqual(
    ['case', ['==', ['get', 'pid'], 'person-1'], 1, 0.18]);
  expect(getNameFocusOpacity({ selectedGroup: 'group-1', field })).toEqual(
    ['case', ['==', ['get', 'group_id'], 'group-1'], 1, 0.18]);
  expect(getNameFocusOpacity({ field })).toBe(1);
});

test('focus only changes settlement names and outlines and restores their original paint', () => {
  const paints = new Map([['projector_base__שמות_יישובים__labels:text-opacity', 0.8],
    ['projector_base__ישובים__outline:line-opacity', 0.5], ['projector_base__Locations_Lines:line-opacity', 0.7],
    ['projector_base__שמות_יישובים__labels:text-opacity-transition', { duration: 20, delay: 0 }]]);
  const layers = ['projector_base__שמות_יישובים__labels', 'projector_base__ישובים__outline',
    'projector_base__Locations_Lines'].map((id) => ({ id, type: id.includes('labels') ? 'symbol' : 'line' }));
  const writes = [];
  const map = {
    getStyle: () => ({ layers }), getLayer: id => layers.find(layer => layer.id === id),
    getPaintProperty: (id, property) => paints.get(`${id}:${property}`),
    setPaintProperty: (id, property, value) => { paints.set(`${id}:${property}`, value); writes.push([id, property, value]); },
  };
  const presentation = createNliNameFocusPresentation({ map, field });
  presentation.update({ selectedPid: 'person-1' });
  expect(paints.get('projector_base__שמות_יישובים__labels:text-opacity')).toEqual(
    ['case', ['==', ['get', 'cityname'], 'מקום'], 1, 0.18]);
  expect(paints.get('projector_base__ישובים__outline:line-opacity')).toBe(0.18);
  expect(paints.get('projector_base__Locations_Lines:line-opacity')).toBe(0.18);
  const firstWrites = writes.length;
  presentation.update({ selectedPid: 'person-1' });
  expect(writes).toHaveLength(firstWrites);
  presentation.dispose();
  expect(paints.get('projector_base__שמות_יישובים__labels:text-opacity')).toBe(0.8);
  expect(paints.get('projector_base__ישובים__outline:line-opacity')).toBe(0.5);
  expect(paints.get('projector_base__Locations_Lines:line-opacity')).toBe(0.7);
  expect(paints.get('projector_base__שמות_יישובים__labels:text-opacity-transition')).toEqual({ duration: 20, delay: 0 });
});

test('focus refreshes an overwritten paint and recaptures a recreated layer baseline', () => {
  let layer = { id: 'projector_base__שמות_יישובים__labels', type: 'symbol' };
  const paint = new Map([['text-opacity', 0.7]]);
  const map = {
    getStyle: () => ({ layers: [layer] }), getLayer: () => layer,
    getPaintProperty: (_id, property) => paint.get(property),
    setPaintProperty: (_id, property, value) => paint.set(property, value),
  };
  const focus = createNliNameFocusPresentation({ map, field });
  focus.update({ selectedGroup: 'group-1' });
  paint.set('text-opacity', 0.4);
  focus.update({ selectedGroup: 'group-1' });
  expect(paint.get('text-opacity')).toEqual(['case', ['==', ['get', 'cityname'], 'מקום'], 1, 0.18]);
  layer = { ...layer };
  paint.set('text-opacity', 0.9);
  focus.update({ selectedGroup: 'group-1' });
  focus.dispose();
  expect(paint.get('text-opacity')).toBe(0.9);
});

test('timeline requests cannot blink memorial settlement paint and release restores latest timeline policy', () => {
  const layers = [
    { id: 'projector_base__שמות_יישובים__labels', type: 'symbol' },
    { id: 'projector_base__ישובים__outline', type: 'line' },
    { id: 'projector_base__Locations_Lines__line', type: 'line' },
  ];
  const paints = new Map();
  const writes = [];
  const map = {
    getStyle: () => ({ layers }), getLayer: id => layers.find(layer => layer.id === id),
    getPaintProperty: (id, property) => paints.get(`${id}:${property}`),
    setPaintProperty: (id, property, value) => { paints.set(`${id}:${property}`, value); writes.push([id, property, value]); },
  };
  const focus = createNliNameFocusPresentation({ map, field });
  focus.update({ selectedGroup: 'group-1' });
  const afterFocus = writes.length;
  applySettlementOrientationPaint(map, { phase: 'playing', layers: collectOrientationTargets(map).layers });
  applySettlementOrientationPaint(map, { phase: 'paused', layers: collectOrientationTargets(map).layers });
  focus.update({ selectedGroup: 'group-1' });
  expect(writes).toHaveLength(afterFocus);
  expect(paints.get('projector_base__Locations_Lines__line:line-opacity')).toBe(0.18);
  focus.dispose();
  expect(paints.get('projector_base__ישובים__outline:line-opacity')).toBe(0.28);
  expect(paints.get('projector_base__ישובים__outline:line-opacity-transition')).toBeNull();
  expect(paints.get('projector_base__Locations_Lines__line:line-opacity')).toBe(0.28);
  expect(paints.get('projector_base__שמות_יישובים__labels:text-opacity')).toEqual(
    ['case', ['in', ['get', 'cityname'], ['literal', []]], 1, 0.35]);
});
