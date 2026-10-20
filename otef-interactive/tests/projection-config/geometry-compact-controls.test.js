// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { renderField } from '../../frontend/src/projection-config/config-field-control.js';
import { createParameterEditorDialog } from '../../frontend/src/projection-config/parameter-editor-dialog.js';
import { createGridLayoutControls } from '../../frontend/src/projection-config/grid-layout-controls.js';
afterEach(() => document.body.replaceChildren());
test('shared sensitivity changes the actual numeric nudge step without modifying a value', () => {
 const onNudge=vi.fn(); const field=renderField(document,{path:'pre.scale',label:'Scale',min:.1,max:8,fine:.001,step:.01},vi.fn(),onNudge,false,true);
 field.update({value:1}); field.setSensitivity('coarse'); onNudge.mockClear();
 field.wrap.querySelector('[data-direction="1"]').click();
 expect(onNudge).toHaveBeenCalledWith('pre.scale',1,{step:.01,sensitivity:'coarse'}); field.dispose();
});
test('joined editor fields display and commit signed values directly', () => {
 const onField=vi.fn(); const field=renderField(document,{path:'pre.tx',label:'X',min:-2,max:2,fine:.001,step:.01},onField,vi.fn(),false,true);
 field.update({value:-.5});expect(field.number.value).toBe('-0.5');expect(field.signButton).toBeNull();
 field.number.value='0.25';field.number.dispatchEvent(new Event('input'));field.number.dispatchEvent(new Event('change'));
 expect(onField).toHaveBeenCalledWith('pre.tx','0.25','number',{baseValue:-.5,resolvedPath:'pre.tx',override:false});field.dispose();
});
test('parameter pages cannot conceal an invalid pending edit', () => {
 const host=document.createElement('div');document.body.append(host);
 const panel=createParameterEditorDialog({document,host,presentation:'panel'});
 panel.open({nodeId:'names-wall',descriptors:[{path:'namesWall.rotateDeg',label:'Rotation',min:-180,max:180,fine:1,step:1},{path:'namesWall.spacingPx',label:'Spacing',min:0,max:32,fine:1,step:1}]});
 panel.update({config:{namesWall:{rotateDeg:0,spacingPx:4}}});
 const input=host.querySelector('[data-field="namesWall.rotateDeg"][data-input="number"]');input.value='';input.dispatchEvent(new Event('input'));
 expect(panel.selectPage('spacing')).toBe(false);expect(panel.element.dataset.page).toBe('text');
 panel.cancel();expect(panel.selectPage('spacing')).toBe(true);panel.dispose();
});
test('grid spacing uses an explicit row or column independent of point selection',()=>{
 const onAction=vi.fn();const controls=createGridLayoutControls(document,onAction);
 const axis=controls.element.querySelector('[aria-label="Even spacing axis"]');axis.value='column';
 controls.actions.get('even').click();expect(onAction).toHaveBeenCalledWith('even',{axis:'column'});
});
