import { expect, test } from 'vitest';
import { createSettlementNameFraming, mapSettlementPosition } from '../../frontend/src/projection/settlement-name-framing.js';

const mercator = (lng, lat) => [lng / 360 + 0.5, 0.5 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / (2 * Math.PI)];
function fixture() {
  const center = mercator(34, 31);
  const offsets = [[0,0],[1,0],[0,1],[-1,2],[2,-1],[3,2],[-2,-3],[1,-2]];
  const entries = offsets.map((_, i) => ({ citycode: String(i), text: String(i), lng: 34 + (i % 3) * 0.03, lat: 31 + Math.floor(i / 3) * 0.04 }));
  const anchor = (lng, lat) => { const [u,v] = mercator(lng,lat); return { x: 800 + (u-center[0])*1e6 + (v-center[1])*3e5, y: 450 - (u-center[0])*3e5 + (v-center[1])*1e6 }; };
  const positions = Object.fromEntries(entries.map((entry,i) => { const p = anchor(entry.lng,entry.lat), [x,y] = offsets[i]; return [entry.citycode, { x:p.x+10*x-6*y, y:p.y+6*x+10*y }]; }));
  const catalog = { entries, referenceOffsets: new Map(entries.map((e,i) => [e.citycode, offsets[i]])) };
  const settings = { baseline: { outputs: { left: positions } } };
  const state = { scale: 1, tx: 0, ty: 0 };
  const branch = { crop: {x0:0,x1:1,y0:0,y1:1}, post:{scale:1,tx:0,ty:0} };
  const map = { getContainer: () => ({clientWidth:3840,clientHeight:2160}), project: ([lng,lat]) => { const p=anchor(lng,lat); return {x:(p.x*state.scale+state.tx)*2,y:(p.y*state.scale+state.ty)*2}; } };
  const getConfig = () => ({ outputs: {left:branch,right:branch} });
  return { catalog, settings, state, branch, map, getConfig };
}

test('recovers original label framing with source offsets and follows current camera at 4K', () => {
  const f=fixture(); const read=createSettlementNameFraming({map:f.map,output:'left',getConfig:f.getConfig});
  const position = {...f.settings.baseline.outputs.left['3']};
  expect(mapSettlementPosition(position,read(f).matrix).x).toBeCloseTo(position.x,5);
  f.state.scale=1.6; f.state.tx=-240; f.state.ty=75;
  const frame=read(f), moved=mapSettlementPosition({x:position.x+37,y:position.y-19},frame.matrix);
  expect(moved.x).toBeCloseTo((position.x+37)*1.6-240,5);
  expect(moved.y).toBeCloseTo((position.y-19)*1.6+75,5);
  expect(mapSettlementPosition(moved,frame.matrix,true).x).toBeCloseTo(position.x+37,5);
  const reloaded=createSettlementNameFraming({map:f.map,output:'left',getConfig:f.getConfig});
  expect(reloaded({catalog:f.catalog,settings:structuredClone(f.settings)}).matrix).toEqual(frame.matrix);
});

test('uses the map crop clip and restores positions when the map camera rolls back', () => {
  const f=fixture(); const read=createSettlementNameFraming({map:f.map,output:'left',getConfig:f.getConfig});
  f.branch.crop.x1=0.25;
  expect(read(f).clip).toEqual([0.375,0,0.625,1]);
  f.state.tx=192;
  expect(mapSettlementPosition({x:1730.141,y:679.05},read(f).matrix).x).toBeCloseTo(1922.141,5);
  f.state.tx=0;
  expect(mapSettlementPosition({x:1730.141,y:679.05},read(f).matrix).x).toBeCloseTo(1730.141,5);
});

test('rejects inconsistent anchors and insufficient captures instead of guessing a calibration', () => {
  const f=fixture(); const read=createSettlementNameFraming({map:f.map,output:'left',getConfig:f.getConfig});
  f.settings.baseline.outputs.left['3'].x+=50;
  expect(()=>read(f)).toThrow(/reference|capture/i);
  const small=fixture(); small.catalog.entries=small.catalog.entries.slice(0,2);
  expect(()=>createSettlementNameFraming({map:small.map,output:'left',getConfig:small.getConfig})(small)).toThrow(/reference|capture/i);
});

test('singular editor matrices have no inverse', () => {
  expect(mapSettlementPosition({x:1,y:2},[1,1,1,1,0,0],true)).toBeNull();
  expect(mapSettlementPosition({x:1,y:2},null,true)).toEqual({x:1,y:2});
});
