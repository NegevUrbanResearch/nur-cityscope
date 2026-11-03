import { afterEach, expect, test, vi } from 'vitest';
import { createPointMatchSession } from '../../frontend/src/projection-config/point-match-session.js';
import { createIdentityProjectionMesh } from '../../frontend/src/shared/projection-warp-geometry.js';

const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
const context = () => ({ output:'left', instanceId:ids[0], sourceId:ids[1], sessionId:ids[2], revision:12,
  configIdentity:'accepted', baselineIdentity:'identity', sourceFrameIdentity:'source', displaySide:'right', reversed:true,
  evaluatedMesh:createIdentityProjectionMesh({ columns:7, rows:7 }) });
function setup() {
  const sent=[]; const session=createPointMatchSession({context:context(), sendCursor:message=>sent.push(message)});
  const ack=(sequence=sent.at(-1).sequence, overrides={})=>session.acknowledge({type:'otef_projection_match_ack',table:'otef',
    ...Object.fromEntries(['output','instanceId','sourceId','sessionId','revision','sourceFrameIdentity'].map(k=>[k,context()[k]])),
    sequence,displaySide:'right',reversed:true,success:true,error:null,...overrides});
  return {session,sent,ack};
}
afterEach(()=>vi.useRealTimers());
test('independent local size preferences preserve recorded anchors and require the latest size ACK', () => {
  vi.useFakeTimers(); const {session, sent, ack} = setup();
  expect(session.getState().displayPrefs).toEqual({ previewMarkerSize: 'medium', projectedMarkerSize: 'medium' });
  session.pick(1, [390, 310]); ack(); session.record();
  const before = session.getState(); const count = sent.length;
  expect(sent.at(-1).markerRadiusPx).toBe(8);
  expect(session.setMarkerSize('preview', 'small')).toBe(true);
  expect(sent).toHaveLength(count);
  expect(session.getState().canRecord).toBe(true);
  expect(session.setMarkerSize('projected', 'small')).toBe(true);
  expect(session.getState().anchors).toEqual(before.anchors);
  expect(session.getState().context).toEqual(before.context);
  expect(session.getState().candidate).toBe(null);
  expect(session.getState().canRecord).toBe(false);
  vi.advanceTimersByTime(50);
  expect(sent.at(-1)).toMatchObject({ sequence: count + 1, markerRadiusPx: 4, targetPx: [390, 310], sourcePx: [390, 310] });
  ack(count); expect(session.getState().canRecord).toBe(false);
  ack(); expect(session.record()).toBe(true);
  expect(session.getState().anchors).toEqual(before.anchors);
  expect(session.getState().displayPrefs).toEqual({ previewMarkerSize: 'small', projectedMarkerSize: 'small' });
  const latestCount = sent.length;
  expect(session.setMarkerSize('projected', 'small')).toBe(true);
  for (const [kind, size] of [['preview', 'huge'], ['projected', 4], ['unknown', 'small']]) expect(session.setMarkerSize(kind, size)).toBe(false);
  expect(sent).toHaveLength(latestCount); session.dispose(); expect(sent.at(-1)).not.toHaveProperty('markerRadiusPx');
});
test('size commands share renewal coalescing and do not postpone the existing missing-ACK deadline', () => {
  vi.useFakeTimers(); const {session, sent} = setup(); session.pick(1, [300, 300]);
  vi.advanceTimersByTime(990); session.setMarkerSize('projected', 'large');
  expect(sent.at(-1).markerRadiusPx).toBe(15);
  vi.advanceTimersByTime(10); expect(sent.filter(message => message.mode === 'cursor')).toHaveLength(2);
  vi.advanceTimersByTime(40); expect(sent.filter(message => message.mode === 'cursor')).toHaveLength(3);
  vi.advanceTimersByTime(1959); expect(session.getState().phase).toBe('capture');
  vi.advanceTimersByTime(1); expect(session.getState().phase).toBe('invalid'); session.dispose();
});
test('display preferences do not reactivate a cursor paused for publication', () => {
  vi.useFakeTimers(); const {session, sent, ack} = setup(); session.pick(1, [300, 300]); ack(); session.pauseCursor();
  const count = sent.length; session.setMarkerSize('projected', 'small'); session.setMarkerSize('preview', 'large');
  vi.advanceTimersByTime(4000); expect(sent).toHaveLength(count); expect(session.getState().phase).toBe('capture'); session.dispose();
});
test('record requires the latest exact acknowledged target and moving it removes its recorded status',()=>{
  vi.useFakeTimers(); const {session,sent,ack}=setup(); session.pick(1,[390,310]); session.moveTarget([410,295]);
  expect(session.record()).toBe(false); ack(sent.at(-1).sequence-1); expect(session.record()).toBe(false);
  ack(); expect(session.record()).toBe(true); const count=sent.length; expect(session.record()).toBe(true); expect(sent).toHaveLength(count);
  session.moveTarget([411,295]); expect(session.getState().anchors[0].recorded).toBe(false); session.dispose();
});
test('four complete fit pairs are required and checkpoints never replace them',()=>{
  vi.useFakeTimers(); const {session,ack}=setup();
  for(const id of [1,2,3,5,6]) { session.pick(id,[id*200,300]); session.record(); ack(); expect(session.record()).toBe(true); }
  expect(session.getState().canFit).toBe(false); session.pick(4,[1500,800]); session.record(); ack(); session.record();
  expect(session.getState().canFit).toBe(true); session.remove(2); expect(session.getState().canFit).toBe(false); session.dispose();
});
test('movement coalesces to 20Hz and Record flushes the pending absolute target',()=>{
  vi.useFakeTimers();const {session,sent,ack}=setup(); session.pick(1,[300,300]); ack();
  for(let x=301;x<=350;x++) session.moveTarget([x,300]); expect(sent).toHaveLength(1);
  expect(session.record()).toBe(false);expect(sent).toHaveLength(2);expect(sent.at(-1).targetPx).toEqual([350,300]);
  ack();expect(session.record()).toBe(true);session.dispose();
});
test('a renewal near a recent movement shares the same 20Hz limit',()=>{
  vi.useFakeTimers();const {session,sent,ack}=setup();session.pick(1,[300,300]);ack();vi.advanceTimersByTime(990);session.moveTarget([301,300]);ack();
  vi.advanceTimersByTime(10);expect(sent).toHaveLength(2);vi.advanceTimersByTime(40);expect(sent).toHaveLength(3);session.dispose();
});
test('renewals without acknowledgements expire at 3000ms from the first outstanding send',()=>{
  vi.useFakeTimers(); const {session,sent}=setup(); session.pick(1,[390,310]);
  vi.advanceTimersByTime(2999);expect(session.getState().phase).toBe('capture');expect(sent.filter(m=>m.mode==='cursor')).toHaveLength(3);
  vi.advanceTimersByTime(1);expect(session.getState()).toMatchObject({phase:'invalid',error:expect.stringMatching(/3000/)});
  expect(sent.at(-1).mode).toBe('off'); const count=sent.length;vi.advanceTimersByTime(5000);expect(sent).toHaveLength(count);session.dispose();
});
test('missing-output deadline starts exactly at a send between renewal ticks',()=>{
  vi.useFakeTimers();const {session,sent,ack}=setup();session.pick(1,[300,300]);ack();
  vi.advanceTimersByTime(175);session.moveTarget([310,300]);vi.advanceTimersByTime(2999);
  expect(session.getState().phase).toBe('capture');vi.advanceTimersByTime(1);expect(session.getState().phase).toBe('invalid');expect(sent.at(-1).mode).toBe('off');session.dispose();
});
test('old out of order acknowledgements cannot extend the missing-output deadline',()=>{
  vi.useFakeTimers();const {session,ack}=setup();session.pick(1,[300,300]);ack();vi.advanceTimersByTime(1000);ack();
  vi.advanceTimersByTime(1000);vi.advanceTimersByTime(2999);ack(1);vi.advanceTimersByTime(1);
  expect(session.getState().phase).toBe('invalid');session.dispose();
});
test('a bound-source failure for an already confirmed sequence invalidates immediately',()=>{
  vi.useFakeTimers();const {session,ack}=setup();session.pick(1,[300,300]);ack();
  ack(1,{success:false,error:'Drawn source reloaded'});expect(session.getState()).toMatchObject({phase:'invalid',error:'Drawn source reloaded'});session.dispose();
});
test('wrong instance or displayed route cannot confirm or invalidate the bound capture',()=>{
  vi.useFakeTimers();const {session,ack}=setup();session.pick(1,[300,300]);ack(1,{instanceId:ids[1]});ack(1,{reversed:false});
  expect(session.record()).toBe(false);ack();expect(session.record()).toBe(true);session.dispose();
});
test('candidate installation and exact own publication retain measurements while other context changes invalidate',()=>{
  vi.useFakeTimers();const {session}=setup();session.setCandidate({ok:true,config:{outputs:{left:{warp:{}}}},maxRenderedErrorPx:.1});
  expect(session.getState().phase).toBe('candidate-preview');session.transition('candidate-installed',{configIdentity:'candidate'});
  session.transition('publishing',{revision:13,configIdentity:'candidate'});
  expect(session.contextChanged({...context(),revision:13,configIdentity:'candidate'})).toBe(true);
  expect(session.getState().phase).toBe('checking');session.contextChanged({...context(),revision:14});expect(session.getState().phase).toBe('invalid');session.dispose();
});
