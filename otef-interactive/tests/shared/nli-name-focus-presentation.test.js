import { createPropertyExpression, v8 } from '@maplibre/maplibre-gl-style-spec';
import { afterEach, expect, test, vi } from 'vitest';
import { getLayerLifecycleRuntime } from '../../frontend/src/shared/layer-lifecycle-fade.js';
import { createNliNameFocusPresentation, getNameFocusOpacity, getNameFocusAlpha, getRelevantPlaceGroup } from '../../frontend/src/shared/nli-name-focus-presentation.js';
import {
  applySettlementOrientationPaint,
  attachSettlementOrientationRuntime,
  collectOrientationTargets,
} from '../../frontend/src/shared/nli-settlement-orientation.js';

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

test('numeric Canvas focus matches person and group MapLibre focus policy', () => {
  expect(getNameFocusAlpha({ selectedPid: 'person-1', field }, 'person-1')).toBe(1);
  expect(getNameFocusAlpha({ selectedPid: 'person-1', field }, 'other')).toBe(.18);
  expect(getNameFocusAlpha({ selectedGroup: 'group-1', field }, 'person-1')).toBe(1);
  expect(getNameFocusAlpha({ selectedGroup: 'group-2', field }, 'person-1')).toBe(.18);
  expect(getNameFocusAlpha({ field }, 'person-1')).toBe(1);
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
  expect(paints.get('projector_base__ישובים__outline:line-opacity')).toBe(0.08);
  expect(paints.get('projector_base__Locations_Lines:line-opacity')).toBe(0.08);
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
  expect(paints.get('projector_base__Locations_Lines__line:line-opacity')).toBe(0.08);
  focus.dispose();
  expect(paints.get('projector_base__ישובים__outline:line-opacity')).toBe(0.08);
  expect(paints.get('projector_base__ישובים__outline:line-opacity-transition')).toEqual({
    duration: 400,
    delay: 0,
  });
  expect(paints.get('projector_base__Locations_Lines__line:line-opacity')).toBe(0.08);
  expect(paints.get('projector_base__שמות_יישובים__labels:text-opacity')).toEqual(
    ['case', ['in', ['get', 'cityname'], ['literal', []]], 1, 0.18]);
});

const LABEL_ID = 'projector_base__שמות_יישובים__labels';
const FILL_ID = 'projector_base__ישובים__fill';
const SHEMOT_ID = 'projector_base.שמות_יישובים';
const YISHUV_ID = 'projector_base.ישובים';

function evaluateText(expression, cityname) {
  const created = createPropertyExpression(expression, v8.paint_symbol['text-opacity']);
  expect(created.result, JSON.stringify(created.value)).toBe('success');
  return created.value.evaluate({ zoom: 8 }, { type: 1, id: 1, properties: { cityname } });
}

function createHooks() {
  let time = 0;
  let frame = null;
  let nextFrameId = 0;
  return {
    now: () => time,
    setTime(value) { time = value; },
    requestFrame(callback) {
      nextFrameId += 1;
      frame = { id: nextFrameId, callback };
      return nextFrameId;
    },
    cancelFrame(id) { if (frame?.id === id) frame = null; },
    flushFrame() {
      const current = frame;
      frame = null;
      current?.callback(time);
    },
    setTimer() { return 1; },
    clearTimer() {},
    get pendingFrame() { return frame; },
  };
}

function createOwnedMap() {
  const layers = new Map();
  const paints = new Map();
  const listeners = new Map();
  return {
    addLayer(def) {
      layers.set(def.id, def);
      for (const [key, value] of Object.entries(def.paint || {})) paints.set(`${def.id}\0${key}`, value);
    },
    getLayer(id) { return layers.get(id) || null; },
    setPaintProperty(id, key, value) { paints.set(`${id}\0${key}`, value); },
    getPaintProperty(id, key) { return paints.get(`${id}\0${key}`); },
    getStyle() { return { layers: [...layers.values()] }; },
    on(type, handler) {
      const list = listeners.get(type) || [];
      list.push(handler);
      listeners.set(type, list);
    },
    off(type, handler) {
      listeners.set(type, (listeners.get(type) || []).filter((entry) => entry !== handler));
    },
    remove() {
      for (const handler of [...(listeners.get('remove') || [])]) handler();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test('name-focus place change keeps its deadline through refresh and timeline ticks, then eases off', () => {
  const places = {
    byPid: new Map(),
    groupGeojson: {
      features: [
        { properties: { group_id: 'g1', name: 'א' } },
        { properties: { group_id: 'g2', name: 'ב' } },
      ],
    },
  };
  const map = createOwnedMap();
  const hooks = createHooks();
  attachSettlementOrientationRuntime(map);
  const runtime = getLayerLifecycleRuntime(map, hooks);
  runtime.setDesiredIds([SHEMOT_ID, YISHUV_ID], { durationMs: 0 });
  for (const def of [
    { id: LABEL_ID, type: 'symbol', paint: { 'text-opacity': 1, 'icon-opacity': 1 }, fullId: SHEMOT_ID },
    { id: FILL_ID, type: 'fill', paint: { 'fill-opacity': 1 }, fullId: YISHUV_ID },
  ]) {
    const staged = runtime.stageMapLayer(def.fullId, def);
    map.addLayer(staged.stagedLayerDef);
  }
  runtime.markMemberReady(SHEMOT_ID);
  runtime.markMemberReady(YISHUV_ID);
  runtime.commitBatch();

  const focus = createNliNameFocusPresentation({ map, field: places });
  focus.update({ selectedGroup: 'g1', opacity: 1 });
  hooks.setTime(0);
  focus.update({ selectedGroup: 'g2', opacity: 1 });
  hooks.setTime(120);
  hooks.flushFrame();
  expect(evaluateText(map.getPaintProperty(LABEL_ID, 'text-opacity'), 'ב')).not.toBeCloseTo(1);
  focus.update({ selectedGroup: 'g2', opacity: 1 });
  applySettlementOrientationPaint(map, { phase: 'playing', layers: collectOrientationTargets(map).layers });
  focus.update({ selectedGroup: 'g2', opacity: 1 });
  hooks.setTime(400);
  hooks.flushFrame();
  expect(map.getPaintProperty(LABEL_ID, 'text-opacity')).toEqual(
    ['case', ['==', ['get', 'cityname'], 'ב'], 1, 0.18],
  );

  focus.dispose();
  hooks.setTime(600);
  hooks.flushFrame();
  expect(map.getPaintProperty(LABEL_ID, 'text-opacity')).not.toEqual(
    ['case', ['in', ['get', 'cityname'], ['literal', []]], 1, 0.18],
  );
  hooks.setTime(800);
  hooks.flushFrame();
  expect(map.getPaintProperty(LABEL_ID, 'text-opacity')).toEqual(
    ['case', ['in', ['get', 'cityname'], ['literal', []]], 1, 0.18],
  );
  expect(map.getPaintProperty(FILL_ID, 'fill-opacity')).toBe(0.08);
});
