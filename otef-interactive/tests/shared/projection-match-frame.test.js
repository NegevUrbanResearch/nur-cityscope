import { expect, test, vi } from 'vitest';
import { projectionMatchFrameIdentity, createProjectionMatchFrameCache } from '../../frontend/src/shared/projection-match-frame.js';

const inputs = () => ({ output: 'left', sceneId: 'home', camera: { bounds: [[34.1, 31.1], [34.9, 31.9]], bearing: 15, pitch: 0 },
  groups: [{ id: 'roads', enabled: true, layers: [{ id: 'b', enabled: true, options: { color: 'red', width: 2 } }, { id: 'a', enabled: true }] }],
  imageIdentity: { assetPathAndQuery: 'http://localhost/otef-interactive/model.png?v=2', declaredVersion: 'release-2', naturalWidth: 100, naturalHeight: 80 },
  datasetVersion: 'accepted-1', settlementNameIdentity: { revision: 3, settingsIdentity: 'settings', catalogIdentity: 'catalog' } });

test('sorts groups, layers and object keys and excludes animation times and local decode generations', () => {
  const a = inputs(), b = inputs();
  b.groups[0].layers.reverse(); b.groups[0].layers[1].options = { width: 2, color: 'red' };
  b.groups[0].animationStartedAt = 900; b.groups[0].layers[1].timestamp = 100;
  b.imageIdentity.decodeGeneration = 88;
  b.camera.bearing += 0.000000001;
  expect(projectionMatchFrameIdentity(b)).toBe(projectionMatchFrameIdentity(a));
  b.groups.push({ id: 'hidden', enabled: false, layers: [{ id: 'anything', options: { color: 'blue' } }] });
  expect(projectionMatchFrameIdentity(b)).toBe(projectionMatchFrameIdentity(a));
});

test('normalizes workstation aliases for local assets and preserves origins for external assets', () => {
  const a = inputs(), b = inputs(); b.imageIdentity.assetPathAndQuery = 'http://192.168.1.50/otef-interactive/model.png?v=2';
  expect(projectionMatchFrameIdentity(a)).toBe(projectionMatchFrameIdentity(b));
  b.imageIdentity.assetPathAndQuery = 'https://cdn.example/model.png?v=2';
  a.imageIdentity.assetPathAndQuery = 'https://other.example/model.png?v=2';
  expect(projectionMatchFrameIdentity(a)).not.toBe(projectionMatchFrameIdentity(b));
  a.imageIdentity.assetPathAndQuery='https://cdn.example/otef-interactive/model.png';
  b.imageIdentity.assetPathAndQuery='https://other.example/otef-interactive/model.png';
  expect(projectionMatchFrameIdentity(a)).not.toBe(projectionMatchFrameIdentity(b));
});

test.each(['camera', 'groups', 'image', 'dataset', 'settlement', 'output', 'scene'])('%s changes invalidate the stable signature', field => {
  const a = inputs(), b = inputs();
  if (field === 'camera') b.camera.bounds[0][0] += 0.1;
  if (field === 'groups') b.groups[0].layers[0].options.width++;
  if (field === 'image') b.imageIdentity.assetPathAndQuery += '&release=3';
  if (field === 'dataset') b.datasetVersion = 'accepted-2';
  if (field === 'settlement') b.settlementNameIdentity.revision++;
  if (field === 'output') b.output = 'right';
  if (field === 'scene') b.sceneId = 'nova';
  expect(projectionMatchFrameIdentity(b)).not.toBe(projectionMatchFrameIdentity(a));
});

test('rejects oversized and invalid signatures rather than truncating or enabling capture', () => {
  const a = inputs(); a.groups[0].layers[0].options.color = 'x'.repeat(5000);
  expect(() => projectionMatchFrameIdentity(a)).toThrow(/4096/);
  a.camera.bearing = NaN; expect(() => projectionMatchFrameIdentity(a)).toThrow();
});

test('compacts authored style options without including registry metadata or losing style changes', () => {
  const a=inputs(), b=inputs();
  a.groups[0].layers[0].style={symbols:Array.from({length:200},(_,index)=>({width:index,color:'red'}))};
  b.groups[0].layers[0].style=structuredClone(a.groups[0].layers[0].style);
  a.groups[0].layers[0].processing={timestamp:123,geometry:{features:['ignored']}};
  expect(projectionMatchFrameIdentity(a)).toBe(projectionMatchFrameIdentity(b));
  expect(projectionMatchFrameIdentity(a).length).toBeLessThan(4096);
  b.groups[0].layers[0].style.symbols[99].color='green';
  expect(projectionMatchFrameIdentity(a)).not.toBe(projectionMatchFrameIdentity(b));
});

function cacheHarness() {
  const state = { ...inputs(), imageParticipates: false, imageReady: false, cameraMoving: false, sourcesReady: true,
    labels: { ready: true, pending: false, failed: false }, narrativeIdle: true, slideshowActive: false,
    namesDrawn: false, geometry: { configIdentity: 'drawn', pending: false, failed: false, stopped: false, suspended: false } };
  const onChange = vi.fn(), onInvalidate = vi.fn(), readInputs = vi.fn(() => state);
  const cache = createProjectionMatchFrameCache({ readInputs, onChange, onInvalidate }); cache.refresh();
  return { state, cache, onChange, onInvalidate, readInputs };
}

test('hidden model failures/reloads and underlying names-wall visibility do not block or invalidate capture', () => {
  const { state, cache, onChange, onInvalidate, readInputs } = cacheHarness();
  const before = cache.getState(); expect(before.stable).toBe(true);
  state.imageIdentity.assetPathAndQuery += '&reload=3'; state.imageReady = false; state.normalNamesWallVisible = true;
  cache.sourceReloaded('image'); cache.refresh();
  expect(cache.getState()).toEqual(before); expect(onInvalidate).not.toHaveBeenCalled();
  const reads = readInputs.mock.calls.length; cache.getState(); cache.getState(); expect(readInputs).toHaveBeenCalledTimes(reads);
  expect(onChange).toHaveBeenCalledTimes(1);
});

test('drawn asset reload invalidates locally even when stable identity stays equal', () => {
  const { state, cache, onInvalidate } = cacheHarness(); state.imageParticipates = true; state.imageReady = true; cache.refresh();
  const before = cache.getState().sourceFrameIdentity; cache.sourceReloaded('image');
  expect(onInvalidate).toHaveBeenCalledWith('Drawn model image reloaded; restart point capture.');
  expect(cache.getState().sourceFrameIdentity).toBe(before);
});

test('an effective map source reload retires capture without changing its portable identity', () => {
  const {cache,onInvalidate}=cacheHarness();const identity=cache.getState().sourceFrameIdentity;
  cache.sourceReloaded('map');expect(onInvalidate).toHaveBeenCalledWith('Effective map source reloaded; restart point capture.');
  expect(cache.getState()).toMatchObject({sourceFrameIdentity:identity,stable:false});
});

test.each(['camera', 'sources', 'labels', 'narrative', 'slideshow', 'names', 'geometry', 'failure'])('capture declines unstable %s', field => {
  const { state, cache } = cacheHarness();
  if (field === 'camera') state.cameraMoving = true;
  if (field === 'sources') state.sourcesReady = false;
  if (field === 'labels') state.labels.pending = true;
  if (field === 'narrative') state.narrativeIdle = false;
  if (field === 'slideshow') state.slideshowActive = true;
  if (field === 'names') state.namesDrawn = true;
  if (field === 'geometry') state.geometry.pending = true;
  if (field === 'failure') state.geometry.failed = true;
  cache.refresh(); expect(cache.getState().stable).toBe(false); expect(cache.getState().error).toBeTruthy();
});

test('settlement placement changes invalidate a frozen source while pending labels remain unready', () => {
  const { state, cache } = cacheHarness(); const before = cache.getState().sourceFrameIdentity;
  state.settlementNameIdentity.revision++; state.labels.pending = true; cache.refresh();
  expect(cache.getState().sourceFrameIdentity).not.toBe(before); expect(cache.getState().stable).toBe(false);
});
