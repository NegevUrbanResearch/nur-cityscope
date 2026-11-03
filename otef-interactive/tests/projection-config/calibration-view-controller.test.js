import { afterEach, expect, test, vi } from 'vitest';
import { createCalibrationViewController } from '../../frontend/src/projection-config/calibration-view-controller.js';
const left='11111111-1111-4111-8111-111111111111',right='22222222-2222-4222-8222-222222222222';
const row=(output,instanceId,displaySide=output)=>({type:'otef_projection_applied',table:'otef',output,instanceId,revision:1,success:true,route:'browser',displaySide,reversed:displaySide!==output});
const rows=()=>new Map([['left/'+left,row('left',left,'right')],['right/'+right,row('right',right,'left')]]);
function setup(responders=rows()) {vi.useFakeTimers(); const handlers=new Map(); const socket={send:vi.fn(),on:(type,fn)=>handlers.set(type,fn),off:vi.fn()}; const preview={setCalibrationView:vi.fn()}; const onState=vi.fn();const controller=createCalibrationViewController({socket,preview,onState,discoverOutputs:async()=>responders}); return{controller,socket,preview,onState,receive:message=>handlers.get(message.type)?.(message)};}
const ack=message=>({...message,type:'otef_projection_calibration_view_ack',mode:undefined,displaySide:message.output==='left'?'right':'left',reversed:true,sceneIdentity:'drawn',ready:true,missingIds:[],success:true,error:null});
function receipt(message){const result=ack(message);delete result.mode;return result;}
afterEach(()=>vi.useRealTimers());
test('targets other actual displayed side and releases both outputs on close',async()=>{const {controller,socket,receive,onState,preview}=setup();await controller.enter({output:'left'});expect(socket.send.mock.calls.at(-1)[0]).toMatchObject({mode:'landmarks',blackout:false});controller.setBlackout(true);const commands=socket.send.mock.calls.map(c=>c[0]);expect(commands.at(-1)).toMatchObject({output:'right',blackout:true});receive(receipt(commands.at(-1)));expect(onState.mock.calls.at(-1)[0].blackout).toBe('active');expect(preview.setCalibrationView).toHaveBeenCalledWith(true);controller.close();expect(socket.send.mock.calls.slice(-2).every(c=>c[0].mode==='off')).toBe(true);controller.dispose();});
test('missing route metadata reports reopen guidance while keeping preview available',async()=>{const responses=rows();for(const row of responses.values())row.displaySide=null;const {controller,onState,preview}=setup(responses);await controller.enter({output:'left'});expect(onState.mock.calls.at(-1)[0].error).toMatch(/reopen|reload/i);expect(preview.setCalibrationView).toHaveBeenCalledWith(true);controller.dispose();});
test('outgoing renewals cannot defer acknowledgement-progress timeout',async()=>{const {controller,onState}=setup();await controller.enter({output:'left'});await vi.advanceTimersByTimeAsync(3001);expect(onState.mock.calls.at(-1)[0].phase).toBe('failed');controller.dispose();});
test('transport echo and malformed ack never confirm blackout; painted cover can confirm while assets remain pending',async()=>{
  const {controller,socket,receive,onState}=setup();await controller.enter({output:'left'});controller.setBlackout(true);const command=socket.send.mock.calls.at(-1)[0];
  receive(command);receive({...receipt(command),extra:true});expect(onState.mock.calls.at(-1)[0].blackout).toBe('pending');
  receive({...receipt(command),ready:false,sceneIdentity:null});expect(onState.mock.calls.at(-1)[0].blackout).toBe('active');controller.dispose();
});
test('late duplicate physical route clears its existing cover and stops renewal',async()=>{
  const {controller,socket,receive,onState}=setup();await controller.enter({output:'left'});controller.setBlackout(true);
  receive(row('right','44444444-4444-4444-8444-444444444444','left'));
  expect(onState.mock.calls.at(-1)[0].blackout).toBe('failed');expect(socket.send.mock.calls.at(-1)[0].mode).toBe('off');controller.dispose();
});
test('side switch releases old blackouts before discovery and disconnect does not reconnect ownership',async()=>{
  const {controller,socket,receive,onState}=setup();await controller.enter({output:'left'});controller.setBlackout(true);const previousCount=socket.send.mock.calls.length;
  await controller.switchOutput('right');const changed=socket.send.mock.calls.slice(previousCount).map(([m])=>m);expect(changed.slice(0,2).every(m=>m.mode==='off'&&!m.blackout)).toBe(true);expect(changed.find(m=>m.output==='left'&&m.mode==='landmarks').blackout).toBe(true);
  receive({type:'disconnect'});expect(onState.mock.calls.at(-1)[0].phase).toBe('failed');const count=socket.send.mock.calls.length;await vi.advanceTimersByTimeAsync(5000);expect(socket.send.mock.calls.length).toBe(count);controller.dispose();
});
