import {expect,test,vi} from 'vitest';
import {createProjectionCalibrationRenderer,createProjectionCalibrationMapMask} from '../../frontend/src/projection/projection-calibration-renderer.js';
test('map mask suppresses late presentation, flow and glow layers while keeping full landmark geometry',()=>{
  const layers=[{id:'nli__ציר_232__line'},{id:'glow'},{id:'presentation-image'},{id:'investigation-route'}];
  const visibility=new Map();const map={getStyle:()=>({layers}),getLayer:id=>layers.find(l=>l.id===id),getLayoutProperty:id=>visibility.get(id),setLayoutProperty:(id,key,value)=>visibility.set(id,value)};
  const mask=createProjectionCalibrationMapMask({map});mask.apply([{id:'nli',enabled:true,layers:[{id:'ציר_232',enabled:true}]}]);
  expect(visibility.has('nli__ציר_232__line')).toBe(false);expect(visibility.get('glow')).toBe('none');layers.push({id:'late-flow'});mask.refresh();expect(visibility.get('late-flow')).toBe('none');mask.clear();expect(visibility.get('glow')).toBeNull();
});
test('local renderer overrides only effective groups, waits for labels, and restores latest normal path',async()=>{
  let ready;const labels={whenReady:()=>new Promise(resolve=>ready=resolve),refreshVisibility:vi.fn()};const override=vi.fn(),refresh=vi.fn(async()=>{}),draw=vi.fn(()=>true),normal=vi.fn(()=>[{id:'normal'}]);
  const render=createProjectionCalibrationRenderer({setOverride:override,refreshScene:refresh,readNormalGroups:normal,getLabels:()=>labels,draw,waitForMap:async()=>{},suppressOverlays:vi.fn()});
  const operation=render({active:true,groups:[{id:'landmarks'}],isCurrent:()=>true,sceneData:{labels:'settings'}});
  await Promise.resolve();expect(draw).not.toHaveBeenCalled();expect(refresh).toHaveBeenCalledWith(expect.objectContaining({keepLiveRuntime:true}));ready();expect(await operation).toMatchObject({ready:true,sceneIdentity:expect.any(String)});
  await render({active:false,isCurrent:()=>true});expect(override).toHaveBeenLastCalledWith(null);expect(refresh).toHaveBeenLastCalledWith(expect.objectContaining({groupsOverride:[{id:'normal'}]}));
});
test('late scene preparation cannot draw after owner exit',async()=>{
  let current=true,resolve;const draw=vi.fn(()=>true);const render=createProjectionCalibrationRenderer({setOverride(){},refreshScene:()=>new Promise(done=>resolve=done),readNormalGroups:()=>[],getLabels:()=>({whenReady:async()=>{},refreshVisibility(){}}),draw,waitForMap:async()=>{},suppressOverlays(){}});
  const operation=render({active:true,groups:[],isCurrent:()=>current});current=false;resolve();expect(await operation).toBeNull();expect(draw).not.toHaveBeenCalled();
});
test('release restores current normal glow and highlight before the final draw without a DataContext event',async()=>{
  let active=false;const visible={glow:true,highlight:true};const frames=[];
  const render=createProjectionCalibrationRenderer({setOverride:groups=>active=groups!==null,refreshScene:async()=>{},readNormalGroups:()=>[],getLabels:()=>({whenReady:async()=>{},refreshVisibility(){}}),waitForMap:async()=>{},draw:()=>{frames.push({...visible});return true;},
    suppressOverlays:()=>{visible.glow=false;visible.highlight=false;},restoreOverlays:async({isCurrent})=>{if(isCurrent()&&!active){visible.glow=true;visible.highlight=true;}}});
  await render({active:true,groups:[]});expect(frames.at(-1)).toEqual({glow:false,highlight:false});await render({active:false});expect(frames.at(-1)).toEqual({glow:true,highlight:true});
});
test('superseded normal overlay restoration cannot draw over a new calibration owner',async()=>{
  let current=true,finish;const draw=vi.fn(()=>true);const restoreOverlays=vi.fn(()=>new Promise(resolve=>finish=resolve));
  const render=createProjectionCalibrationRenderer({setOverride(){},refreshScene:async()=>{},readNormalGroups:()=>[],getLabels:()=>null,waitForMap:async()=>{},draw,suppressOverlays(){},restoreOverlays});
  const operation=render({active:false,isCurrent:()=>current});for(let i=0;i<5;i++)await Promise.resolve();expect(restoreOverlays).toHaveBeenCalledTimes(1);current=false;finish();expect(await operation).toBeNull();expect(draw).not.toHaveBeenCalled();
});
