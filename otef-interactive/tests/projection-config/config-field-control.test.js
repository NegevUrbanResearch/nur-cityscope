// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { renderField } from '../../frontend/src/projection-config/config-field-control.js';
afterEach(()=>document.body.replaceChildren());
it('Fine preserves an off-grid percentage base and freezes its integer delta window', () => {
  const base = .123456789123456;
  const { c, onField } = setup(base, { display: 'percentage', fine: .0001, step: .001 });
  c.wrap.querySelector('[data-action="numeric-sensitivity"]').click();
  expect(c.range.value).toBe('0'); expect(c.range.step).toBe('1');
  c.range.value = '1'; c.range.dispatchEvent(new Event('input'));
  expect(onField.mock.calls.at(-1)[3].canonicalValue).toBe(base + .0001);
});
it.each([
  [{unit:'°',step:.1,fine:.01}, 1.234567, '-100', '100'],
  [{unit:'°',step:1,fine:1,integer:true}, 12, '-10', '10'],
  [{display:'percentage',min:0,max:1,displayMin:0,displayMax:100,step:.001,fine:.0001}, .0000001, '0', '100'],
])('Fine captures a bounded continuous or integer window %#', (extra, base, min, max) => {
  const {c,onField} = setup(base,extra); c.wrap.querySelector('[data-action="numeric-sensitivity"]').click();
  expect(c.range.min).toBe(min); expect(c.range.max).toBe(max);
  const pointer = type => {const e=new Event(type); Object.defineProperty(e,'pointerId',{value:1}); c.range.dispatchEvent(e);};
  pointer('pointerdown'); c.update({value:base,resolvedPath:descriptor.path}); expect(c.range.min).toBe(min); expect(c.range.max).toBe(max);
  c.range.value='0'; c.range.dispatchEvent(new Event('input')); expect(onField.mock.calls.at(-1)[3].canonicalValue).toBe(base);
  pointer('pointerup'); c.dispose();
});
it('held nudges start after 350ms, repeat every 100ms and cancel cleanly', () => {
  vi.useFakeTimers();
  const onNudge = vi.fn(); const c = renderField(document, descriptor, () => {}, onNudge);
  c.update({ value: 1 });
  const plus = c.wrap.querySelector('[data-direction="1"]');
  const pointer = type => { const e = new Event(type); Object.defineProperty(e, 'pointerId', {value: 8}); plus.dispatchEvent(e); };
  pointer('pointerdown'); vi.advanceTimersByTime(349); expect(onNudge).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); expect(onNudge.mock.calls.at(-1)[2]).toMatchObject({ phase: 'start', count: 1 });
  vi.advanceTimersByTime(100); expect(onNudge.mock.calls.at(-1)[2]).toMatchObject({ phase: 'update', count: 2 });
  pointer('pointercancel'); expect(onNudge.mock.calls.at(-1)[2].phase).toBe('cancel');
  const count = onNudge.mock.calls.length; vi.advanceTimersByTime(1000); expect(onNudge).toHaveBeenCalledTimes(count);
  c.dispose(); vi.useRealTimers();
});
const descriptor = {path:'pre.rotateDeg',label:'Rotation',min:-180,max:180,displayMin:-180,displayMax:180,displayStep:.1,decimals:2,unit:'deg',fine:.1};
it.each(['Escape', 'pointercancel', 'lostpointercapture'])('a keyboard click after held cancellation by %s still nudges', terminal => {
  vi.useFakeTimers();
  const onNudge=vi.fn(); const c=renderField(document,descriptor,()=>{},onNudge); c.update({value:1});
  const plus=c.wrap.querySelector('[data-direction="1"]');
  const pointer=type=>{const event=new Event(type); Object.defineProperty(event,'pointerId',{value:8}); plus.dispatchEvent(event);};
  try {
    pointer('pointerdown'); vi.advanceTimersByTime(350);
    if(terminal==='Escape') plus.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})); else pointer(terminal);
    expect(onNudge.mock.calls.at(-1)[2].phase).toBe('cancel'); const before=onNudge.mock.calls.length;
    plus.dispatchEvent(new MouseEvent('click',{detail:0}));
    expect(onNudge).toHaveBeenCalledTimes(before+1); expect(onNudge).toHaveBeenLastCalledWith(descriptor.path,1);
  } finally {c.dispose();vi.useRealTimers();}
});
it('a held nudge suppresses its native synthesized pointer click', () => {
  vi.useFakeTimers(); const onNudge=vi.fn(); const c=renderField(document,descriptor,()=>{},onNudge); c.update({value:1});
  const plus=c.wrap.querySelector('[data-direction="1"]');
  const pointer=type=>{const event=new Event(type); Object.defineProperty(event,'pointerId',{value:8}); plus.dispatchEvent(event);};
  try {
    pointer('pointerdown'); vi.advanceTimersByTime(350); pointer('pointerup');
    const before=onNudge.mock.calls.length; plus.dispatchEvent(new MouseEvent('click',{detail:1})); expect(onNudge).toHaveBeenCalledTimes(before);
    plus.dispatchEvent(new MouseEvent('click',{detail:0})); expect(onNudge).toHaveBeenCalledTimes(before+1);
  } finally {c.dispose();vi.useRealTimers();}
});
function setup(value=0, extra={}) { const onField=vi.fn(); const c=renderField(document,{...descriptor,...extra},onField,()=>{}); document.body.append(c.wrap); c.update({value,resolvedPath:descriptor.path}); const mode=c.wrap.querySelector('[data-action="numeric-sensitivity"]'); if(mode?.getAttribute('aria-pressed')==='true') mode.click(); return {c,onField}; }
it('optical continuous fields start in Fine with visible Coarse option and exact local zero', () => {
  const onField=vi.fn(); const base=.123456789123456;
  const c=renderField(document,{...descriptor,display:'percentage',step:.001,fine:.0001},onField,()=>{}); c.update({value:base});
  expect(c.wrap.querySelector('[data-action="numeric-sensitivity"]').textContent).toBe('Coarse / Fine: Fine');
  expect(c.wrap.querySelector('.numeric-step').textContent).toBe('Step: 0.01 deg');
  expect(c.range.value).toBe('0'); c.range.dispatchEvent(new Event('input'));
  expect(onField.mock.calls.at(-1)[3].canonicalValue).toBe(base); c.dispose();
});
function input(c,raw) { c.number.value=raw; c.number.dispatchEvent(new Event('input')); }
it('untouched blur preserves exact baseline without a callback',()=>{ const {c,onField}=setup(1.23456); c.number.dispatchEvent(new Event('blur')); expect(onField).not.toHaveBeenCalled(); expect(c.finish()).toMatchObject({kind:'unchanged',baseValue:1.23456}); });
it('sign from zero and comma entry commit signed display units with canonical metadata',()=>{ const {c,onField}=setup(); c.wrap.querySelector('[data-action="numeric-sign"]').click(); input(c,'2,5'); c.number.dispatchEvent(new Event('blur')); expect(onField).toHaveBeenCalledWith(descriptor.path,'-2.5','number',{baseValue:0,resolvedPath:descriptor.path,override:false}); expect(c.number.type).toBe('text'); expect(c.number.getAttribute('aria-describedby')).toContain(c.error.id); });
it('signed paste works and invalid entry has a visible associated error',()=>{ const {c,onField}=setup(); input(c,'-3.5'); c.finish(); expect(onField).toHaveBeenCalledTimes(1); input(c,'-'); expect(c.finish().kind).toBe('invalid'); expect(c.error.textContent).toMatch(/complete number/i); expect(c.number.getAttribute('aria-invalid')).toBe('true'); });
it('dirty foreign updates block blur and allow explicit same-target override',()=>{ const {c,onField}=setup(1); input(c,'2'); c.update({value:3,resolvedPath:descriptor.path}); expect(c.number.value).toBe('2'); expect(c.finish().kind).toBe('conflict'); expect(onField).not.toHaveBeenCalled(); c.wrap.querySelector('[data-action="numeric-use-mine"]').click(); expect(onField).toHaveBeenCalledWith(descriptor.path,'2','number',{baseValue:3,resolvedPath:descriptor.path,override:true}); });
it('target changes disable override and use latest starts a new session',()=>{ const {c,onField}=setup(1); input(c,'2'); c.update({value:4,resolvedPath:'other.rotation'}); expect(c.wrap.querySelector('[data-action="numeric-use-mine"]').disabled).toBe(true); c.wrap.querySelector('[data-action="numeric-use-latest"]').click(); expect(c.number.value).toBe('4.00'); expect(c.finish().kind).toBe('unchanged'); expect(onField).not.toHaveBeenCalled(); });
it('unedited focused updates advance values without committing',()=>{ const {c,onField}=setup(1); c.number.focus(); c.update({value:2.34567,resolvedPath:descriptor.path}); expect(c.number.value).toBe('2.35'); c.number.blur(); expect(onField).not.toHaveBeenCalled(); });
it('percentage commits convert once while retaining canonical baseline',()=>{ const {c,onField}=setup(.123456,{display:'percentage'}); input(c,'12.5'); c.finish(); expect(onField).toHaveBeenCalledWith(descriptor.path,'12.5','number',{baseValue:.123456,resolvedPath:descriptor.path,override:false}); });
it('cancel and dispose prevent queued text from committing',()=>{ const {c,onField}=setup(1); input(c,'2'); c.cancel(); c.number.dispatchEvent(new Event('blur')); input(c,'3'); c.dispose(); c.number.dispatchEvent(new Event('blur')); expect(onField).not.toHaveBeenCalled(); });
it('release slider conflict override uses the slider candidate rather than its old paired text',()=>{ const {c,onField}=setup(1,{commitOnChange:true}); c.range.value='2'; c.range.dispatchEvent(new Event('input')); c.update({value:3,resolvedPath:descriptor.path}); c.wrap.querySelector('[data-action="numeric-use-mine"]').click(); expect(onField).toHaveBeenCalledWith(descriptor.path,'2','number',{baseValue:3,resolvedPath:descriptor.path,override:true}); });
it('a target switch remains blocked even if the original target returns',()=>{ const {c,onField}=setup(1); input(c,'2'); c.update({value:3,resolvedPath:'other.rotation'}); c.update({value:1,resolvedPath:descriptor.path}); expect(c.wrap.querySelector('[data-action="numeric-use-mine"]').disabled).toBe(true); c.wrap.querySelector('[data-action="numeric-use-mine"]').click(); expect(onField).not.toHaveBeenCalled(); });
it('sign-only selection starts magnitude editing so leaving the field commits it',()=>{ const {c,onField}=setup(3); c.wrap.querySelector('[data-action="numeric-sign"]').click(); expect(document.activeElement).toBe(c.number); c.number.blur(); expect(onField).toHaveBeenCalledWith(descriptor.path,'-3','number',{baseValue:3,resolvedPath:descriptor.path,override:false}); });
it('changing only the sign preserves the exact baseline magnitude',()=>{ const {c,onField}=setup(1.23456); c.wrap.querySelector('[data-action="numeric-sign"]').click(); c.finish(); expect(onField).toHaveBeenCalledWith(descriptor.path,'-1.23456','number',{baseValue:1.23456,resolvedPath:descriptor.path,override:false}); });

it('a controller conflict discovered during finish retains both conflict actions and the candidate', () => {
  const { c, onField } = setup(1);
  onField.mockImplementation(() => { c.update({ value: 3, resolvedPath: descriptor.path, error: 'Value changed while editing. Use latest or use my value.' }); return false; });
  input(c, '2'); expect(c.finish().kind).toBe('conflict'); expect(c.number.value).toBe('2'); expect(c.isPending()).toBe(true);
  expect(c.wrap.querySelector('[data-action="numeric-use-latest"]').hidden).toBe(false);
  expect(c.wrap.querySelector('[data-action="numeric-use-mine"]').hidden).toBe(false);
  onField.mockReturnValue(true); c.wrap.querySelector('[data-action="numeric-use-mine"]').click();
  expect(onField).toHaveBeenLastCalledWith(descriptor.path, '2', 'number', { baseValue: 3, resolvedPath: descriptor.path, override: true });
});

it('only a previously controller-rejected edit acknowledges correction to an unchanged baseline', () => {
  const { c, onField } = setup(0); onField.mockReturnValue(false);
  input(c, '2'); expect(c.finish().kind).toBe('invalid');
  onField.mockReturnValue(true); input(c, '0'); expect(c.finish().kind).toBe('unchanged');
  expect(onField).toHaveBeenCalledTimes(2);
  expect(onField).toHaveBeenLastCalledWith(descriptor.path, '0', 'number', { baseValue: 0, resolvedPath: descriptor.path, override: false });
  expect(c.error.textContent).toBe(''); expect(c.number.getAttribute('aria-invalid')).toBe('false');
  c.finish(); expect(onField).toHaveBeenCalledTimes(2);
});

it.each(['pointerup', 'pointercancel', 'lostpointercapture'])('range discard stops held events and %s releases suppression for keyboard editing', terminal => {
  const { c, onField } = setup(1);
  const pointer = type => { const event = new Event(type); Object.defineProperty(event, 'pointerId', { value: 7 }); c.range.dispatchEvent(event); };
  pointer('pointerdown'); expect(c.isHeld()).toBe(true); c.cancel(); expect(c.isHeld()).toBe(false); onField.mockClear();
  c.range.value = '2'; c.range.dispatchEvent(new Event('input')); c.range.dispatchEvent(new Event('change')); expect(onField).not.toHaveBeenCalled();
  pointer(terminal); c.range.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  c.range.value = '3'; c.range.dispatchEvent(new Event('input')); expect(onField).toHaveBeenCalledTimes(1);
  expect(onField).toHaveBeenLastCalledWith(descriptor.path, '3', 'range', { baseValue: 1, resolvedPath: descriptor.path, override: false });
  c.dispose(); pointer('pointerdown'); expect(c.isHeld()).toBe(false);
});

it('retains a negative sign at zero after blur and uses it when editing resumes', () => {
  const { c, onField } = setup(0);
  const sign = c.wrap.querySelector('[data-action="numeric-sign"]');
  sign.click();
  c.number.blur();
  expect(onField).not.toHaveBeenCalled();
  expect(sign.textContent).toBe('−');
  c.number.focus(); input(c, '2,5'); c.finish();
  expect(onField).toHaveBeenCalledWith(descriptor.path, '-2.5', 'number', { baseValue: 0, resolvedPath: descriptor.path, override: false });
});

it('retains the selected zero sign across ordinary same-target render updates', () => {
  const { c, onField } = setup(0);
  const sign = c.wrap.querySelector('[data-action="numeric-sign"]');
  sign.click(); c.number.blur();
  c.update({ value: 0, resolvedPath: descriptor.path });
  expect(sign.textContent).toBe('−');
  expect(onField).not.toHaveBeenCalled();
  input(c, '2,5'); c.finish();
  expect(onField).toHaveBeenCalledWith(descriptor.path, '-2.5', 'number', { baseValue: 0, resolvedPath: descriptor.path, override: false });
});

it('cancel and a new zero target reset the selected sign while nonzero updates derive their own sign', () => {
  const { c, onField } = setup(0);
  const sign = c.wrap.querySelector('[data-action="numeric-sign"]');
  sign.click(); c.number.blur(); c.cancel();
  expect(sign.textContent).toBe('+');
  sign.click(); c.number.blur(); c.update({ value: 0, resolvedPath: 'other.rotation' });
  expect(sign.textContent).toBe('+');
  c.update({ value: -3, resolvedPath: 'other.rotation' });
  expect(sign.textContent).toBe('−'); expect(c.number.value).toBe('3.00');
  c.update({ value: 4, resolvedPath: 'other.rotation' });
  expect(sign.textContent).toBe('+'); expect(c.number.value).toBe('4.00');
  expect(onField).not.toHaveBeenCalled();
});
