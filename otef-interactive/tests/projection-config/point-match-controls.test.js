// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { createPointMatchControls } from '../../frontend/src/projection-config/point-match-controls.js';
import { createProjectionConfigView } from '../../frontend/src/projection-config/config-view.js';
import { createWarpEditor } from '../../frontend/src/projection-config/warp-editor.js';
import { DEFAULT_PROJECTION_CONFIG } from '../../frontend/src/shared/projection-config-schema.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { warpMarkerRadius } from '../../frontend/src/projection-config/warp-viewport.js';

afterEach(()=>{document.body.replaceChildren();vi.useRealTimers();});
test('installed and checked fits use explicit finish labels and measured checkpoint feedback', () => {
  const controls = createPointMatchControls({ document });
  controls.update({ phase: 'candidate-installed', anchors: [], installedCandidateIdentity: 'installed' });
  expect(controls.element.querySelector('[data-match-action="cancel"]').textContent).toBe('Close matching');
  expect(controls.element.textContent).toMatch(/Undo.*ordinary|ordinary.*Undo/i);
  controls.update({ phase: 'checking', selectedId: 5, anchors: [{ id: 5, recorded: true, targetPx: [810,545] }],
    checkpointErrors: [{ id: 5, errorPx: 2.25 }] });
  expect(controls.element.querySelector('[data-match-action="cancel"]').textContent).toBe('Finish matching');
  expect(controls.element.querySelector('[data-match-slot="5"]').textContent).toMatch(/2.25.*px/);
  expect(controls.element.querySelector('[data-match-slot="1"] button').disabled).toBe(true);
  controls.dispose();
});

test.each(['matching-first', 'recovery-first'])('toolbar Live retains the recovery guard with %s callbacks', order => {
  const root = document.createElement('main'); document.body.append(root);
  const view = createProjectionConfigView(root);
  const matching = () => view.updatePointMatch({ phase: 'candidate-installed', anchors: [], canApply: true });
  const recovery = () => view.update({ state: { draft: DEFAULT_PROJECTION_CONFIG, reconciliation: { status: 'needs-choice' } } });
  if (order === 'matching-first') { matching(); recovery(); } else { recovery(); matching(); }
  view.updatePointMatch({ phase: 'closed', anchors: [] });
  expect(view.controls.live.disabled).toBe(true);
  view.update({ state: { draft: DEFAULT_PROJECTION_CONFIG, reconciliation: null } });
  expect(view.controls.live.disabled).toBe(false);
  view.dispose();
});
test('independent labeled marker selects reflect local preferences and have 44px touch targets', () => {
  const actions = []; const controls = createPointMatchControls({document, onAction: (action, value) => actions.push([action, value])});
  const style = document.createElement('style'); style.textContent = readFileSync(resolve(process.cwd(), 'frontend/src/projection-config/config.css'), 'utf8'); document.head.append(style);
  document.body.append(controls.element);
  try {
    controls.update({phase: 'capture', identified: false, anchors: [], displayPrefs: {previewMarkerSize: 'small', projectedMarkerSize: 'large'}});
    for (const [label, value, action] of [['Preview marker size', 'small', 'preview-marker-size'], ['Projected marker size', 'large', 'projected-marker-size']]) {
      const select = controls.element.querySelector(`[aria-label="${label}"]`);
      expect(select).not.toBe(null); expect(select.value).toBe(value); expect(select.disabled).toBe(false);
      expect([...select.options].map(option => [option.value, option.textContent])).toEqual([['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]);
      expect(getComputedStyle(select).minHeight).toBe('44px');
      select.value = 'medium'; select.dispatchEvent(new Event('change')); expect(actions).toContainEqual([action, 'medium']);
    }
  } finally {controls.dispose(); style.remove();}
});
test('preview markers preserve screen radius, centre gap and label size across navigation and independent output size', () => {
  const root = document.createElement('main'); document.body.append(root);
  const view = createProjectionConfigView(root, {onNode: () => true});
  const editor = createWarpEditor({config: DEFAULT_PROJECTION_CONFIG, output: 'left'});
  view.update({state: {draft: DEFAULT_PROJECTION_CONFIG, live: false}, selectedNode: 'left-keystone', warpStates: {left: {...editor.getState(), config: editor.getConfig(), handles: editor.getControlPoints(), evaluatedMesh: editor.getEvaluatedMesh()}}});
  view.nodeMap.get('left-keystone').querySelector('[data-action="warp-editor-open"]').click();
  const surface = root.querySelector('.warp-edit-surface');
  surface.getBoundingClientRect = () => ({left: 0, top: 0, width: 960, height: 540});
  const state = {phase: 'capture', selectedId: 1, anchors: [{id: 1, s: .2, t: .3, targetPx: [410, 295], recorded: true}], previewReady: true, previewMesh: editor.getEvaluatedMesh()};
  try {
    for (const [size, cssRadius] of [['small', 3], ['medium', 5], ['large', 8]]) {
      view.updatePointMatch({...state, displayPrefs: {previewMarkerSize: size, projectedMarkerSize: 'large'}});
      for (let zoom = 0; zoom < 2; zoom++) {
        const [x, y, width, height] = surface.getAttribute('viewBox').split(' ').map(Number);
        const mapping = value => warpMarkerRadius({x, y, width, height}, 960, 540, value);
        const radius = mapping(cssRadius), gap = mapping(1.5);
        const circle = root.querySelector('.point-match-source'), target = root.querySelector('.point-match-target');
        expect(Number(circle.getAttribute('r'))).toBeCloseTo(radius);
        expect(Number(circle.getAttribute('cx'))).toBeCloseTo(384); expect(Number(circle.getAttribute('cy'))).toBeCloseTo(324);
        expect(target.getAttribute('transform')).toBe('translate(410 295)');
        expect(target.querySelector('path').getAttribute('d')).toBe(`M${-radius * 2} 0H${-gap}M${gap} 0H${radius * 2}M0 ${-radius * 2}V${-gap}M0 ${gap}V${radius * 2}`);
        expect(Number(target.querySelector('text').getAttribute('font-size'))).toBeCloseTo(mapping(12));
        root.querySelector('.warp-view-zoom-in').click();
      }
      root.querySelector('.warp-view-fit').click();
    }
  } finally {view.dispose();}
});
test('four pair slots, record and local Fit follow capture availability; checkpoints appear only in checking',()=>{
  const controls=createPointMatchControls({document,onAction:()=>{}});document.body.append(controls.element);
  controls.update({phase:'capture',selectedId:1,anchors:[],canRecord:false,canFit:false});
  expect(controls.element.querySelectorAll('[data-match-slot]:not([hidden])')).toHaveLength(4);
  expect(controls.element.querySelector('[data-match-action="record"]').disabled).toBe(true);
  controls.update({phase:'checking',selectedId:5,anchors:[],canRecord:true,canFit:false});
  expect(controls.element.querySelectorAll('[data-match-slot]:not([hidden])')).toHaveLength(6);
  expect(controls.element.querySelector('[data-match-action="fit"]').disabled).toBe(true);controls.dispose();
});
test('identification and recovery copy retain the bound logical output, displayed side and actual reversal',()=>{
  const controls=createPointMatchControls({document,onAction:()=>{}});document.body.append(controls.element);
  controls.update({phase:'capture',identified:false,probed:true,anchors:[],context:{output:'left',displaySide:'right',reversed:true},message:'Confirm the asymmetric markers'});
  const text=controls.element.querySelector('[role="status"]').textContent;
  expect(text).toContain('left logical output');expect(text).toContain('displayed right');expect(text).toContain('reversed');expect(text).toContain('Confirm the asymmetric markers');controls.dispose();
});
test('held arrows stop on selection, blur, second touch and disposal',()=>{
  vi.useFakeTimers();const actions=[];const controls=createPointMatchControls({document,onAction:(action,value)=>actions.push([action,value])});document.body.append(controls.element);
  controls.update({phase:'capture',selectedId:1,anchors:[{id:1,targetPx:[300,300]}]});
  const right=controls.element.querySelector('[data-match-direction="right"]');
  const down=id=>{const event=new Event('pointerdown',{bubbles:true});Object.assign(event,{pointerId:id,pointerType:'touch',clientX:0,clientY:0});right.dispatchEvent(event);};
  down(1);vi.advanceTimersByTime(300);expect(actions.filter(([action])=>action==='nudge').length).toBeGreaterThan(1);
  controls.update({phase:'capture',selectedId:2,anchors:[]});const count=actions.length;vi.advanceTimersByTime(400);expect(actions).toHaveLength(count);
  controls.update({phase:'capture',selectedId:1,anchors:[{id:1,targetPx:[300,300]}]});down(2);window.dispatchEvent(new Event('blur'));const afterBlur=actions.length;vi.advanceTimersByTime(400);expect(actions).toHaveLength(afterBlur);
  down(3);down(4);const afterTouch=actions.length;vi.advanceTimersByTime(400);expect(actions).toHaveLength(afterTouch);controls.dispose();
});
test('removing the selected point and a second touch elsewhere stop held movement',()=>{
  vi.useFakeTimers();const actions=[];const controls=createPointMatchControls({document,onAction:(action,value)=>actions.push([action,value])});document.body.append(controls.element);
  const state={phase:'capture',selectedId:1,anchors:[{id:1,s:.2,t:.3,targetPx:[300,300]}]};controls.update(state);
  const right=controls.element.querySelector('[data-match-direction="right"]');
  const down=(target,id)=>{const event=new Event('pointerdown',{bubbles:true});Object.assign(event,{pointerId:id,pointerType:'touch'});target.dispatchEvent(event);};
  down(right,1);controls.update({...state,anchors:[]});let count=actions.length;vi.advanceTimersByTime(400);expect(actions).toHaveLength(count);
  controls.update(state);window.dispatchEvent(new Event('blur'));down(right,2);down(document.body,3);count=actions.length;vi.advanceTimersByTime(400);expect(actions).toHaveLength(count);controls.dispose();
});
test('existing Keystone editor exposes Match points, guards Live and ordinary geometry and draws distinct markers',()=>{
  const root=document.createElement('main');document.body.append(root);const actions=[];
  const view=createProjectionConfigView(root,{onNode:()=>true,onPointMatchAction:(action,value)=>actions.push([action,value])});
  const editor=createWarpEditor({config:DEFAULT_PROJECTION_CONFIG,output:'left'});
  view.update({state:{draft:DEFAULT_PROJECTION_CONFIG,live:false},selectedNode:'left-keystone',warpStates:{left:{...editor.getState(),config:editor.getConfig(),handles:editor.getControlPoints(),evaluatedMesh:editor.getEvaluatedMesh()}}});
  view.nodeMap.get('left-keystone').querySelector('[data-action="warp-editor-open"]').click();
  root.querySelector('[data-action="point-match-start"]').click();expect(actions).toContainEqual(['start','left']);
  view.updatePointMatch({phase:'capture',identified:true,selectedId:1,anchors:[{id:1,s:.2,t:.3,targetPx:[410,295],recorded:false}],previewReady:true,previewMesh:editor.getEvaluatedMesh(),canApply:false});
  expect(root.querySelector('[aria-label="Editor Live"]').disabled).toBe(true);
  expect(root.querySelector('.point-match-source')).not.toBe(null);expect(root.querySelector('.point-match-target')).not.toBe(null);
  expect(root.querySelector('.warp-selection-row').inert).toBe(true);
  expect(root.querySelector('.warp-selection-row').hidden).toBe(true);
  view.updatePointMatch({phase:'candidate-preview',selectedId:1,anchors:[{id:1,s:.2,t:.3,targetPx:[410,295]}],previewReady:false,canApply:false});
  expect(root.querySelector('.point-match-markers').children).toHaveLength(0);view.dispose();
});
test('Match start and capture panel span both columns of the existing precision layout',()=>{
  const style=document.createElement('style');style.textContent=readFileSync(resolve(process.cwd(),'frontend/src/projection-config/config.css'),'utf8');document.head.append(style);
  const root=document.createElement('main');document.body.append(root);const view=createProjectionConfigView(root);
  try {
    expect(getComputedStyle(root.querySelector('[data-action="point-match-start"]')).gridColumn).toBe('1 / -1');
    expect(getComputedStyle(root.querySelector('.point-match-controls')).gridColumn).toBe('1 / -1');
    expect(getComputedStyle(root.querySelector('.point-match-controls')).containerType).toBe('inline-size');
  } finally {view.dispose();style.remove();}
});
