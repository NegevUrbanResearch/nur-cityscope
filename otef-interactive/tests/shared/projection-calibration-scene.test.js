import { expect, test } from 'vitest';
import { resolveProjectionCalibrationScene, filterProjectionCalibrationScene } from '../../frontend/src/shared/projection-calibration-scene.js';
export const ids = ['projector_base.שמות_יישובים','projector_base.ישובים','projector_base.Locations_Lines','muniplicity_transport.דרכי_עפר','projector_base.Tkuma_Area_LIne','gaza.Gaza_Roads','nli.ציר_232'];
const fixture = () => [...new Set(ids.map(id => id.split('.')[0]))].map(id => ({ id, enabled: false, layers: [...ids.filter(full => full.startsWith(`${id}.`)), `${id}.unrelated`].map(fullId => ({ id: fullId.split('.')[1], fullId, enabled: false, style: {color:'red'}, url:'/data' })) }));
test('enables seven exact landmarks and their groups while preserving input, styles and URLs', () => {
  const groups = fixture(); groups[0].layers.push({id:'model_base',enabled:true}); const before = structuredClone(groups);
  const result = resolveProjectionCalibrationScene(groups);
  expect(result.requiredIds).toEqual(ids); expect(result.missingIds).toEqual([]); expect(groups).toEqual(before);
  expect(result.groups.every(g => g.enabled)).toBe(true);
  expect(result.groups.flatMap(g => g.layers).filter(l => l.enabled).map(l => l.fullId)).toEqual(before.flatMap(g => g.layers).filter(l => ids.includes(l.fullId)).map(l => l.fullId));
  expect(result.groups[0].layers[0]).toMatchObject({style:{color:'red'},url:'/data'});
});
test('selects the Tkuma alias only when canonical is absent and reports missing canonical requirements', () => {
  const groups = fixture(); const boundary = groups[0].layers.find(l => l.id === 'Tkuma_Area_LIne');
  groups[0].layers.push({...boundary,id:'tkuma_area_line',fullId:'projector_base.tkuma_area_line'});
  expect(resolveProjectionCalibrationScene(groups).groups[0].layers.at(-1).enabled).toBe(false);
  groups[0].layers = groups[0].layers.filter(l => l !== boundary);
  expect(resolveProjectionCalibrationScene(groups).groups[0].layers.at(-1).enabled).toBe(true);
  groups.at(-1).layers[0].fullId='nli.ציר_232_אחר'; groups.at(-1).layers[0].id='ציר_232_אחר';
  expect(resolveProjectionCalibrationScene(groups).missingIds).toEqual(['nli.ציר_232']);
});
test('retains merged settlement names and leader-line rows', () => {
  const groups = fixture(); groups[0].layers = groups[0].layers.filter(l => l.id !== 'Locations_Lines');
  groups[0].layers[0].fullLayerIds = ['projector_base.שמות_יישובים','projector_base.Locations_Lines'];
  const result = resolveProjectionCalibrationScene(groups); expect(result.missingIds).toEqual([]);
  expect(result.groups[0].layers[0].fullLayerIds).toEqual(groups[0].layers[0].fullLayerIds);
});
test('post-adapter compositor mask retains only map and settlements', () => {
  const map={},settlements={}; expect(filterProjectionCalibrationScene({map,settlements,image:{},names:{},caption:{},legend:{},pattern:{}})).toEqual({map,settlements});
});
