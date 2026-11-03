import {expect,test} from 'vitest';
import {isProjectionCalibrationCommand,isProjectionCalibrationAck} from '../../frontend/src/shared/projection-match-protocol.js';
const common={table:'otef',output:'left',instanceId:'11111111-1111-4111-8111-111111111111',sourceId:'22222222-2222-4222-8222-222222222222',sessionId:'33333333-3333-4333-8333-333333333333',sequence:1};
const command={...common,type:'otef_projection_calibration_view',mode:'landmarks',blackout:true};
const ack={...common,type:'otef_projection_calibration_view_ack',displaySide:'right',reversed:true,sceneIdentity:null,ready:false,missingIds:[],blackout:true,success:true,error:null};
test('strict calibration protocol allows painted blackout independently of scene readiness',()=>{expect(isProjectionCalibrationCommand(command)).toBe(true);expect(isProjectionCalibrationAck(ack)).toBe(true);expect(isProjectionCalibrationCommand({...command,mode:'off',blackout:false})).toBe(true);});
test('scene identity stays null until ready; a valid off acknowledgement retains its null identity',()=>{
  expect(isProjectionCalibrationAck({...ack,sceneIdentity:'premature'})).toBe(false);
  expect(isProjectionCalibrationAck({...ack,ready:true,sceneIdentity:'drawn'})).toBe(true);
  expect(isProjectionCalibrationAck({...ack,ready:true,blackout:false})).toBe(true);
});
test('rejects malformed identities, flags, bounds and extra fields',()=>{for(const change of [{extra:true},{sequence:true},{sequence:-1},{instanceId:'invalid'},{output:[]},{blackout:1}]){expect(isProjectionCalibrationCommand({...command,...change})).toBe(false);expect(isProjectionCalibrationAck({...ack,...change})).toBe(false);}for(const change of [{mode:'off'},{mode:'cursor'}])expect(isProjectionCalibrationCommand({...command,...change})).toBe(false);for(const change of [{sceneIdentity:'a'.repeat(4097)},{ready:true},{missingIds:Array(8).fill('layer')},{missingIds:[1]},{missingIds:['a'.repeat(129)]},{error:'unexpected'},{success:false,error:null},{reversed:1}])expect(isProjectionCalibrationAck({...ack,...change})).toBe(false);});
