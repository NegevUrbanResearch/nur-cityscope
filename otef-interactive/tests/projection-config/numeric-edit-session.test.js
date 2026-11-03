import { expect, it } from 'vitest';
import { parseNumericText, createNumericEditSession } from '../../frontend/src/projection-config/numeric-edit-session.js';

it('retains exact baseline and refuses a stale dirty commit', () => {
  const s = createNumericEditSession({path:'pre.scale', resolvedPath:'pre.scale', value:1.23456});
  expect(s.candidate()).toMatchObject({kind:'unchanged', baseValue:1.23456});
  s.input('1.5', 1);
  s.sync({resolvedPath:'pre.scale', value:2});
  expect(s.candidate().kind).toBe('conflict');
  s.cancel();
  expect(s.candidate()).toMatchObject({kind:'unchanged', baseValue:2});
});
it('enters negative values without a keyboard minus and accepts signed paste', () => {
  expect(parseNumericText('2,5', {sign:-1})).toEqual({ok:true,value:-2.5});
  expect(parseNumericText('-2.5', {sign:1})).toEqual({ok:true,value:-2.5});
  expect(parseNumericText('+2.5', {sign:-1})).toEqual({ok:true,value:2.5});
  for (const raw of ['-', '1,000.2', '', '2.', 'Infinity', '1e2']) expect(parseNumericText(raw).ok).toBe(false);
  expect(parseNumericText('-2', {signed:false}).ok).toBe(false);
});
it('advances untouched baseline and keeps adapters in canonical units', () => {
  const s = createNumericEditSession({path:'crop', resolvedPath:'crop', value:.123456, toDisplay:v=>v*100, fromDisplay:v=>v/100});
  s.sync({resolvedPath:'crop', value:.234567});
  expect(s.candidate()).toMatchObject({kind:'unchanged', baseValue:.234567});
  s.input('12,5',1);
  expect(s.candidate()).toMatchObject({kind:'commit', value:.125, baseValue:.234567});
});
it('keeps old target identity until cancellation and rejects incomplete entry', () => {
  const s = createNumericEditSession({path:'size', resolvedPath:'wall.size', value:14});
  s.input('-',1); expect(s.candidate().kind).toBe('invalid');
  s.input('20',1); s.sync({resolvedPath:'model.size', value:14});
  expect(s.candidate()).toMatchObject({kind:'conflict', resolvedPath:'wall.size'});
  expect(s.isDirty()).toBe(true);
  s.cancel(); expect(s.candidate()).toMatchObject({kind:'unchanged',resolvedPath:'model.size'});
});
it('retains exact canonical magnitude when only the displayed sign changes', () => {
  const value=.0123456;
  const s=createNumericEditSession({path:'pre.tx',value,toDisplay:v=>v*100,fromDisplay:v=>v/100});
  s.input(String(value*100),1); expect(s.candidate()).toMatchObject({kind:'unchanged',baseValue:value});
  s.input(String(value*100),-1); expect(s.candidate()).toMatchObject({kind:'commit',value:-value,baseValue:value});
});
