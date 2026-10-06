import { afterEach, expect, test, vi } from 'vitest';
import { createPointMatchController } from '../../frontend/src/projection-config/point-match-controller.js';
import { DEFAULT_PROJECTION_CONFIG } from '../../frontend/src/shared/projection-config-schema.js';
import { createIdentityProjectionMesh } from '../../frontend/src/shared/projection-warp-geometry.js';

const instanceId='11111111-1111-4111-8111-111111111111',sourceId='22222222-2222-4222-8222-222222222222';
function setup({responders=1, fit}={}) {
  const sent=[],handlers=new Map();const config=structuredClone(DEFAULT_PROJECTION_CONFIG);config.outputs.left.warp.enabled=true;
  let live=true,context={output:'left',config,configIdentity:JSON.stringify(config),revision:12,baselineIdentity:JSON.stringify(config.outputs.left.warp.baseline),
    baselineMesh:null,evaluatedMesh:createIdentityProjectionMesh({columns:7,rows:7}),sourceFrameIdentity:'source',stable:true,calibrationReady:true,
    preview:{output:'left',stable:true,pending:false,failed:false,sourceFrameIdentity:'source',configIdentity:JSON.stringify(config)}};
  const row=(id=instanceId)=>({type:'otef_projection_applied',table:'otef',output:'left',instanceId:id,revision:12,success:true,route:'browser',baseline:config.outputs.left.warp.baseline,displaySide:'right',reversed:true});
  const emit=(type,message)=>[...(handlers.get(type)||[])].forEach(fn=>fn(message));
  const socket={on:(type,fn)=>{if(!handlers.has(type))handlers.set(type,new Set());handlers.get(type).add(fn);},off:(type,fn)=>handlers.get(type)?.delete(fn),
    send:message=>{sent.push(message);if(message.type==='otef_projection_status_request'){if(responders)emit('otef_projection_applied',row());if(responders>1)emit('otef_projection_applied',row('33333333-3333-4333-8333-333333333333'));}}};
  let clientOverrides={};
  const client={getState:()=>({draft:config,snapshot:{config,revision:12},pending:false,...clientOverrides,live}),setLive:async value=>{live=value;}};
  let current,previewConfig=null;const view={updatePointMatch:s=>{current=s;},setPointMatchPreview:c=>{previewConfig=c;},cancelWarpPointer:()=>{},confirmDiscard:()=>false};
  const controller=createPointMatchController({client,socket,sourceId,readContext:()=>context,view,fit});
  const start=async()=>{const p=controller.start('left');await vi.advanceTimersByTimeAsync(1000);await p;};
  const ack=(overrides={})=>{const command=sent.filter(m=>m.type==='otef_projection_match_cursor').at(-1);controller.receiveAck({type:'otef_projection_match_ack',table:'otef',
    ...Object.fromEntries(['output','instanceId','sourceId','sessionId','sequence','revision','sourceFrameIdentity'].map(k=>[k,command[k]])),displaySide:'right',reversed:true,success:true,error:null,...overrides});};
  return {controller,start,ack,sent,emit,row,client,getState:()=>current,setContext:c=>{context={...context,...c};},setClientState:c=>{clientOverrides={...clientOverrides,...c};},getPreview:()=>previewConfig,config};
}
async function captureFour(h) {
  await h.start();h.ack();h.controller.handleAction('identify');
  for(const [id,p] of [[1,[200,200]],[2,[1600,200]],[3,[200,800]],[4,[1600,800]]]){h.controller.handleAction('replace',id);h.controller.handleAction('preview-start',p);h.controller.handleAction('record');h.ack();h.controller.handleAction('record');}
}
afterEach(()=>vi.useRealTimers());
test('display preference actions preserve frozen capture, geometry and recorded anchors without Fit or Apply', async () => {
  vi.useFakeTimers(); const fit = vi.fn(); const h = setup({fit});
  await h.start(); h.ack(); h.controller.handleAction('identify');
  h.controller.handleAction('preview-start', [300, 300]); h.controller.handleAction('record'); h.ack(); h.controller.handleAction('record');
  const before = h.getState(); const draft = structuredClone(h.client.getState().draft);
  const install = vi.fn(), publish = vi.fn(); h.controller.setApplyAdapter({install, publish});
  const count = h.sent.length;
  expect(h.controller.handleAction('preview-marker-size', 'small')).toBe(true);
  expect(h.sent).toHaveLength(count);
  expect(h.controller.handleAction('projected-marker-size', 'large')).toBe(true);
  await vi.advanceTimersByTimeAsync(50);
  expect(h.sent.at(-1)).toMatchObject({markerRadiusPx: 15, targetPx: [300, 300], sourcePx: [300, 300]});
  expect(h.getState()).toMatchObject({phase: 'capture', identified: true, canRecord: false, displayPrefs: {previewMarkerSize: 'small', projectedMarkerSize: 'large'}});
  expect(h.getState().anchors).toEqual(before.anchors); expect(h.getState().context).toEqual(before.context);
  expect(h.getPreview()).toBe(null); expect(h.client.getState().draft).toEqual(draft);
  expect(fit).not.toHaveBeenCalled(); expect(install).not.toHaveBeenCalled(); expect(publish).not.toHaveBeenCalled();
  h.ack(); expect(h.getState().canRecord).toBe(true);
  h.controller.close({discard: true}); await h.start();
  expect(h.getState().displayPrefs).toEqual({previewMarkerSize: 'small', projectedMarkerSize: 'large'}); h.controller.dispose();
});
test.each(['accepted revision/config','preview pending','source identity','pending client write'])('a %s notification aborts discovery before any stale probe or pick',async change=>{
  vi.useFakeTimers();
  const h=setup();
  const starting=h.controller.start('left');
  await vi.advanceTimersByTimeAsync(500);
  expect(h.getState().phase).toBe('discovering');
  if(change==='accepted revision/config') {
    const next=structuredClone(h.config);next.outputs.left.warp.keystone.corners[0]=[.01,.01];
    h.setClientState({draft:next,snapshot:{config:next,revision:13}});
    h.setContext({config:next,configIdentity:JSON.stringify(next),revision:13,preview:{stable:true,configIdentity:JSON.stringify(next),sourceFrameIdentity:'source'}});
  } else if(change==='preview pending') {
    h.setContext({preview:{stable:false,pending:true,configIdentity:JSON.stringify(h.config),sourceFrameIdentity:'source'}});
  } else if(change==='source identity') {
    h.setContext({sourceFrameIdentity:'new-source',preview:{stable:true,configIdentity:JSON.stringify(h.config),sourceFrameIdentity:'new-source'}});
  } else h.setClientState({pending:true});
  h.controller.contextChanged();
  expect(h.getState().phase).toBe('invalid');
  await vi.advanceTimersByTimeAsync(1000);
  expect(await starting).toBe(false);
  expect(h.sent.some(message=>message.type==='otef_projection_match_cursor')).toBe(false);
  expect(h.controller.handleAction('preview-start',[300,300])).toBe(false);
  expect(h.client.getState().live).toBe(false);
  h.controller.dispose();
});
test.each(['revision','accepted client revision','preview stability'])('discovery revalidates %s after waiting even without a notification',async change=>{
  vi.useFakeTimers();
  const h=setup();const starting=h.controller.start('left');
  await vi.advanceTimersByTimeAsync(500);
  if(change==='revision') h.setContext({revision:13});
  else if(change==='accepted client revision') h.setClientState({snapshot:{config:h.config,revision:13}});
  else h.setContext({preview:{stable:false,pending:false,configIdentity:JSON.stringify(h.config),sourceFrameIdentity:'source'}});
  await vi.advanceTimersByTimeAsync(500);
  expect(await starting).toBe(false);
  expect(h.getState().phase).toBe('invalid');
  expect(h.sent.some(message=>message.type==='otef_projection_match_cursor')).toBe(false);
  expect(h.controller.handleAction('preview-start',[300,300])).toBe(false);
  h.controller.dispose();
});
test('Live attempts during discovery are guarded, and an external Live change turns it off and aborts',async()=>{
  vi.useFakeTimers();
  const h=setup();const starting=h.controller.start('left');
  await vi.advanceTimersByTimeAsync(500);
  expect(h.controller.handleAction('live',true)).toBe(false);
  expect(h.client.getState().live).toBe(false);
  await h.client.setLive(true);h.controller.contextChanged();
  expect(h.getState().phase).toBe('invalid');
  expect(h.client.getState().live).toBe(false);
  await vi.advanceTimersByTimeAsync(500);
  expect(await starting).toBe(false);
  expect(h.sent.some(message=>message.type==='otef_projection_match_cursor')).toBe(false);
  h.controller.dispose();
});
test('fresh discovery rejects missing and duplicate instances with recovery guidance',async()=>{
  vi.useFakeTimers();for(const responders of [0,2]){const h=setup({responders});await h.start();expect(h.getState()).toMatchObject({phase:'invalid',error:expect.stringMatching(responders ? /Close extra/ : /Open.*retry/)});h.controller.dispose();}
});
test('probe binds actual route and requires asymmetric identification before picking; Live stays off',async()=>{
  vi.useFakeTimers();const h=setup();await h.start();expect(h.client.getState().live).toBe(false);
  expect(h.sent.at(-1).mode).toBe('probe');expect(h.controller.handleAction('preview-start',[300,300])).toBe(false);
  h.ack();expect(h.getState().context).toMatchObject({displaySide:'right',reversed:true});
  expect(h.sent.at(-1)).toMatchObject({mode:'cursor',pointId:1,targetPx:[480,270],sourcePx:[240,180]});h.controller.handleAction('identify');
  h.controller.handleAction('preview-start',[300,300]);h.controller.handleAction('nudge','right');h.controller.handleAction('record');
  expect(h.sent.at(-1).targetPx).toEqual([299,300]);expect(h.controller.handleAction('live',true)).toBe(false);
  h.controller.close({discard:true});expect(h.client.getState().live).toBe(false);h.controller.dispose();
});
test('no probe response times out and a late duplicate selected-output instance invalidates',async()=>{
  vi.useFakeTimers();const h=setup();await h.start();await vi.advanceTimersByTimeAsync(3000);expect(h.getState().phase).toBe('invalid');h.controller.dispose();
  const next=setup();await next.start();next.ack();next.emit('otef_projection_applied',next.row('33333333-3333-4333-8333-333333333333'));
  expect(next.getState().phase).toBe('invalid');expect(next.sent.at(-1).mode).toBe('off');next.controller.dispose();
});
test('source pending/error notifications and explicit document invalidation retire capture immediately',async()=>{
  vi.useFakeTimers();const h=setup();await h.start();h.ack();h.setContext({preview:{stable:false,pending:false,failed:false,sourceFrameIdentity:'source',configIdentity:JSON.stringify(h.config)}});
  h.controller.contextChanged();expect(h.getState().phase).toBe('invalid');h.controller.dispose();
  const next=setup();await next.start();next.ack();next.controller.invalidatePreview('Same URL reloaded');expect(next.getState()).toMatchObject({phase:'invalid',error:'Same URL reloaded'});next.controller.dispose();
});
test('Fit stays local, awaits candidate preview acknowledgement, and stale async Fit is ignored after close',async()=>{
  vi.useFakeTimers();let finish;const h=setup({fit:()=>new Promise(resolve=>{finish=resolve;})});await h.start();h.ack();h.controller.handleAction('identify');
  for(const [id,p] of [[1,[200,200]],[2,[1600,200]],[3,[200,800]],[4,[1600,800]]]){h.controller.handleAction('replace',id);h.controller.handleAction('preview-start',p);h.controller.handleAction('record');h.ack();h.controller.handleAction('record');}
  const fitting=h.controller.handleAction('fit');h.controller.close({discard:true});finish({ok:true,config:h.config,maxRenderedErrorPx:0,renderedErrorsPx:[]});await fitting;
  expect(h.getPreview()).toBe(null);expect(h.getState().phase).toBe('closed');h.controller.dispose();
});
test('successful Fit never installs the draft and suppresses markers until its local preview finishes',async()=>{
  vi.useFakeTimers();const h=setup({fit:async({config})=>{config.outputs.left.warp.keystone.corners[0]=[.01,.01];return {ok:true,config,maxRenderedErrorPx:0,renderedErrorsPx:[]};}});
  await h.start();h.ack();h.controller.handleAction('identify');
  for(const [id,p] of [[1,[200,200]],[2,[1600,200]],[3,[200,800]],[4,[1600,800]]]){h.controller.handleAction('replace',id);h.controller.handleAction('preview-start',p);h.controller.handleAction('record');h.ack();h.controller.handleAction('record');}
  await h.controller.handleAction('fit');expect(h.getState()).toMatchObject({phase:'candidate-preview',previewReady:false,canApply:false});
  expect(h.client.getState().draft.outputs.left.warp.keystone.corners[0]).toEqual([0,0]);
  const candidate=h.getPreview();h.setContext({preview:{stable:false,pending:true,sentIdentity:JSON.stringify(candidate),sourceFrameIdentity:'source',configIdentity:JSON.stringify(h.config)}});h.controller.contextChanged();expect(h.getState().phase).toBe('candidate-preview');
  h.setContext({preview:{stable:true,pending:false,failed:false,sourceFrameIdentity:'source',configIdentity:JSON.stringify(candidate)}});h.controller.contextChanged();expect(h.getState().previewReady).toBe(true);
  vi.advanceTimersByTime(1000);expect(h.sent.at(-1).sourcePx).toEqual([1600,800]);
  await expect(h.controller.handleAction('apply')).resolves.toBe(false);h.controller.close({discard:true});expect(h.getPreview()).toBe(null);h.controller.dispose();
});
test('own candidate applied receipt waits for its source acknowledgement but later source readiness loss invalidates',async()=>{
  vi.useFakeTimers();const h=setup({fit:async({config})=>{config.outputs.left.warp.keystone.corners[0]=[.01,.01];return{ok:true,config,maxRenderedErrorPx:0,renderedErrorsPx:[]};}});await captureFour(h);await h.controller.handleAction('fit');
  const identity=JSON.stringify(h.getPreview());h.setContext({preview:{stable:false,pending:false,failed:false,error:null,sentIdentity:identity,configIdentity:identity,sourceFrameIdentity:'source'}});h.controller.contextChanged();
  expect(h.getState()).toMatchObject({phase:'candidate-preview',previewReady:false});
  h.setContext({preview:{stable:true,pending:false,failed:false,error:null,sentIdentity:identity,configIdentity:identity,sourceFrameIdentity:'source'}});h.controller.contextChanged();expect(h.getState().previewReady).toBe(true);
  h.setContext({preview:{stable:false,pending:false,failed:false,error:'Source reloaded',sentIdentity:identity,configIdentity:identity,sourceFrameIdentity:'source'}});h.controller.contextChanged();
  expect(h.getState().phase).toBe('invalid');expect(h.getPreview()).toBe(null);h.controller.dispose();
});
test('missing physical renewals retire a candidate preview and preserve a recorded-measurement discard prompt',async()=>{
  vi.useFakeTimers();const h=setup({fit:async({config})=>({ok:true,config,maxRenderedErrorPx:0,renderedErrorsPx:[]})});await captureFour(h);await h.controller.handleAction('fit');
  expect(h.getPreview()).not.toBe(null);vi.advanceTimersByTime(4000);expect(h.getState().phase).toBe('invalid');
  expect(h.getPreview()).toBe(null);expect(h.controller.hasUnsavedMeasurements()).toBe(true);expect(h.controller.close()).toBe(false);h.controller.dispose();
});
test('failed Fit keeps its actionable error across acknowledged cursor renewals',async()=>{
  vi.useFakeTimers();const h=setup({fit:async()=>({ok:false,reason:'conditioning',message:'Choose four well-spaced landmarks'})});await captureFour(h);
  await h.controller.handleAction('fit');vi.advanceTimersByTime(1000);h.ack();expect(h.getState().error).toBe('Choose four well-spaced landmarks');h.controller.dispose();
});
test('editing pairs after Fit restores the acknowledged base before accepting image clicks',async()=>{
  vi.useFakeTimers();const h=setup({fit:async({config})=>{config.outputs.left.warp.keystone.corners[0]=[.01,.01];return{ok:true,config,maxRenderedErrorPx:0,renderedErrorsPx:[]};}});await captureFour(h);await h.controller.handleAction('fit');
  h.setContext({preview:{stable:false,pending:true,sentIdentity:JSON.stringify(h.config),sourceFrameIdentity:'source',configIdentity:JSON.stringify(h.getPreview())}});
  h.controller.handleAction('replace',1);expect(h.getPreview()).toBe(null);expect(h.getState()).toMatchObject({phase:'capture',previewReady:false});
  expect(h.controller.handleAction('preview-start',[400,400])).toBe(false);
  h.setContext({preview:{stable:true,pending:false,failed:false,sourceFrameIdentity:'source',configIdentity:JSON.stringify(h.config)}});h.controller.contextChanged();
  expect(h.controller.handleAction('preview-start',[400,400])).toBe(true);expect(h.getState().anchors[0].s).toBeCloseTo(400/1920);h.controller.dispose();
});
test('publication pauses old overlays and checking requires fresh session probe after exact drawn receipt',async()=>{
  vi.useFakeTimers();const h=setup({fit:async({config})=>({ok:true,config,maxRenderedErrorPx:0,renderedErrorsPx:[]})});await captureFour(h);await h.controller.handleAction('fit');h.controller.contextChanged();
  const candidate = h.getState().candidate, anchors = h.getState().anchors;
  h.controller.handleAction('preview-marker-size', 'small'); h.controller.handleAction('projected-marker-size', 'large');
  expect(h.getState().candidate).toEqual(candidate); expect(h.getState().anchors).toEqual(anchors);
  const oldSession=h.sent.at(-1).sessionId;const installs=[];
  h.controller.setApplyAdapter({install:async args=>{installs.push(args);return h.config;},publish:async()=>{},nextRevision:()=>13});
  await h.controller.handleAction('apply');expect(h.getState().phase).toBe('publishing');expect(h.sent.at(-1).mode).toBe('off');
  const count=h.sent.length;vi.advanceTimersByTime(1000);expect(h.sent).toHaveLength(count);
  const publication=h.getState().publication;
  const applied={...h.getState().context,config:h.config,configIdentity:JSON.stringify(h.config),revision:13,stable:true,receipt:{...h.row(),revision:13},receiptToken:publication.token};
  expect(h.controller.confirmAppliedGeometry({...applied,revision:14})).toBe(false);
  expect(h.controller.confirmAppliedGeometry(applied)).toBe(true);expect(h.sent.at(-1)).toMatchObject({mode:'probe',revision:13});expect(h.sent.at(-1).sessionId).not.toBe(oldSession);
  expect(h.getState().phase).toBe('publishing');h.ack();expect(h.getState().phase).toBe('checking');expect(installs).toHaveLength(1);
  expect(h.getState().displayPrefs).toEqual({previewMarkerSize: 'small', projectedMarkerSize: 'large'});
  expect(h.getState().anchors).toEqual(anchors); h.controller.dispose();
});
