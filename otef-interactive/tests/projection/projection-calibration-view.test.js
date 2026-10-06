import { afterEach, expect, test, vi } from 'vitest';
import { createProjectionCalibrationView, createProjectionCalibrationCover } from '../../frontend/src/projection/projection-calibration-view.js';
const instanceId='11111111-1111-4111-8111-111111111111',sourceId='22222222-2222-4222-8222-222222222222',sessionId='33333333-3333-4333-8333-333333333333';
const command = (sequence=1, extra={}) => ({type:'otef_projection_calibration_view',table:'otef',output:'left',instanceId,sourceId,sessionId,sequence,mode:'landmarks',blackout:false,...extra});
test('opaque final cover sits above cursor z3000 and is removed on disposal',()=>{
  const element={style:{},setAttribute(){},remove:vi.fn()};const host={appendChild:vi.fn()};const cover=createProjectionCalibrationCover({document:{createElement:()=>element},host});
  expect(element.hidden).toBe(true);cover.setBlackout(true);expect(element.hidden).toBe(false);expect(Number(element.style.zIndex)).toBeGreaterThan(3000);expect(element.style.background).toBe('#000');expect(element.style.inset).toBe('0');cover.dispose();expect(element.remove).toHaveBeenCalled();
});
afterEach(() => vi.useRealTimers());
function setup(applyScene=async()=>({ready:true,sceneIdentity:'drawn',missingIds:[]}), options={}) {
  vi.useFakeTimers(); const sendAck=vi.fn(),setBlackout=vi.fn(); let normal={groups:[{id:'projector_base',layers:['שמות_יישובים','ישובים','Locations_Lines','Tkuma_Area_LIne'].map(id=>({id}))},{id:'muniplicity_transport',layers:[{id:'דרכי_עפר'}]},{id:'gaza',layers:[{id:'Gaza_Roads'}]},{id:'nli',layers:[{id:'ציר_232'}]}]};
  const view=createProjectionCalibrationView({output:'left',instanceId,readNormalScene:()=>normal,applyScene,sendAck,setBlackout,clock:globalThis,requestFrame:fn=>setTimeout(fn,1),readRoute:()=>({displaySide:'right',reversed:true}),isVisible:()=>true,...options});
  return {view,sendAck,setBlackout,setNormal:value=>normal=value};
}
test('renewals and blackout toggles do not restart pending scene preparation', async()=>{
  let done; const apply=vi.fn(()=>new Promise(resolve=>done=resolve)); const {view,sendAck}=setup(apply);
  view.receive(command()); await vi.advanceTimersByTimeAsync(1001); view.receive(command(2,{blackout:true})); await vi.advanceTimersByTimeAsync(2);
  expect(apply).toHaveBeenCalledTimes(1); expect(sendAck).toHaveBeenLastCalledWith(expect.objectContaining({sequence:2,ready:false,blackout:true,success:true,sceneIdentity:null}));
  done({ready:true,sceneIdentity:'drawn',missingIds:[]}); await vi.advanceTimersByTimeAsync(2);
  expect(sendAck).toHaveBeenLastCalledWith(expect.objectContaining({sequence:2,ready:true,sceneIdentity:'drawn'})); view.dispose();
});
test('off restores latest normal scene and late preparation cannot revive landmarks or blackout', async()=>{
  let done; const apply=vi.fn(options=>options.active?new Promise(resolve=>done=resolve):Promise.resolve({ready:true})); const {view,setNormal,setBlackout}=setup(apply);
  view.receive(command(1,{blackout:true})); setNormal({groups:[{id:'latest'}]}); view.receive(command(2,{mode:'off'}));
  expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({active:false,groups:[{id:'latest'}]}));
  done({ready:true,sceneIdentity:'stale'}); await vi.advanceTimersByTimeAsync(3); expect(view.getState().active).toBe(false); expect(setBlackout).toHaveBeenLastCalledWith(false); view.dispose();
});
test('rejects wrong instance, replay and competing owner; expires despite unfinished assets',async()=>{
  const apply=vi.fn(()=>new Promise(()=>{})); const {view,setBlackout}=setup(apply);
  view.receive(command(1,{instanceId:sourceId})); expect(apply).not.toHaveBeenCalled(); view.receive(command()); view.receive(command(0)); view.receive(command(2,{sessionId:sourceId}));
  expect(apply).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(3001); expect(view.getState().active).toBe(false); expect(setBlackout).toHaveBeenLastCalledWith(false); view.dispose();
});
test('normal visibility changes do not restart effective landmarks; actual scene changes supersede pending draw',async()=>{
  const apply=vi.fn(async()=>({ready:true,sceneIdentity:'scene',missingIds:[]}));const {view,setNormal}=setup(apply);
  view.receive(command());await vi.advanceTimersByTimeAsync(2);
  const normal=structuredClone(apply.mock.calls[0][0].groups);for(const group of normal){group.enabled=false;for(const layer of group.layers)layer.enabled=false;}setNormal({groups:normal});
  view.normalSceneChanged();expect(apply).toHaveBeenCalledTimes(1);
  setNormal({groups:[],settlementSettings:{fontPx:30}});view.normalSceneChanged();expect(apply).toHaveBeenCalledTimes(2);view.dispose();
});
test('painted cover remains confirmable when landmark preparation fails',async()=>{
  const {view,sendAck}=setup(async()=>{throw new Error('label asset failed');});view.receive(command(1,{blackout:true}));await vi.advanceTimersByTimeAsync(3);
  expect(sendAck).toHaveBeenLastCalledWith(expect.objectContaining({blackout:true,success:true,ready:false,sceneIdentity:null}));view.dispose();
});
test('scene state observers report pending, drawn and released scenes for DOM diagnostics',async()=>{
  vi.useFakeTimers();const states=[];const view=createProjectionCalibrationView({output:'left',instanceId,readNormalScene:()=>({groups:[]}),applyScene:async()=>({ready:false}),sendAck(){},clock:globalThis,onState:state=>states.push(state)});
  view.receive(command());await Promise.resolve();view.clear();expect(states.some(state=>state.active&&!state.ready)).toBe(true);expect(states.at(-1).active).toBe(false);view.dispose();
});
test.each(['expiry','disconnect'])('lost %s lease rejects delayed owner renewals and permits a fresh owner',async reason=>{
  const {view,setBlackout}=setup();view.receive(command(1,{blackout:true}));
  if(reason==='expiry')await vi.advanceTimersByTimeAsync(3001);else view.clear();
  view.receive(command(2,{blackout:true}));expect(view.getState().active).toBe(false);expect(setBlackout).toHaveBeenLastCalledWith(false);
  view.receive(command(1,{sessionId:'44444444-4444-4444-8444-444444444444'}));expect(view.getState().active).toBe(true);view.dispose();
});
test('explicit owner off remains rebindable but a competing owner cannot release it',()=>{
  const {view}=setup();view.receive(command(1,{blackout:true}));view.receive(command(2,{mode:'off',sessionId:sourceId}));expect(view.getState().active).toBe(true);
  view.receive(command(2,{mode:'off'}));expect(view.getState().active).toBe(false);view.receive(command(3,{blackout:true}));expect(view.getState()).toMatchObject({active:true,blackout:true});view.dispose();
});
test('a hidden output reports an unready null identity even when its scene was previously drawn',async()=>{
  let visible=true;const {view,sendAck}=setup(undefined,{isVisible:()=>visible});view.receive(command());await vi.advanceTimersByTimeAsync(3);visible=false;view.receive(command(2));await vi.advanceTimersByTimeAsync(3);
  expect(sendAck).toHaveBeenLastCalledWith(expect.objectContaining({ready:false,sceneIdentity:null,success:false}));view.dispose();
});
test('disconnect after an intentional off also retires the released editor session',()=>{
  const {view}=setup();view.receive(command());view.receive(command(2,{mode:'off'}));view.clear();view.receive(command(3,{blackout:true}));expect(view.getState().active).toBe(false);view.dispose();
});
