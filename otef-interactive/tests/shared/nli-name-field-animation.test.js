import { describe, it, expect, vi } from 'vitest';
import {
  NAME_FIELD_MOTION,
  NAME_FIELD_REVEAL_DURATION_MS,
  withNameRevealDelays,
  nameRevealSchedule,
  createNameFieldAnimation,
} from '../../frontend/src/shared/nli-name-field-animation.js';

describe('memorial name animation', () => {
  it('finishes the last normal name at twenty seconds', () => {
    vi.useFakeTimers();
    let elapsed = 0;
    const apply = vi.fn();
    const animation = createNameFieldAnimation({ apply, now: () => elapsed });
    try {
      const delays = [...nameRevealSchedule(['a', 'b']).values()].map((value) => value.delayMs);
      expect(Math.min(...delays)).toBe(0);
      expect(Math.max(...delays)).toBe(18400);
      expect(NAME_FIELD_REVEAL_DURATION_MS).toBe(20000);
      animation.show();
      elapsed = 19999;
      vi.advanceTimersByTime(NAME_FIELD_MOTION.frameMs);
      expect(apply.mock.lastCall[0].alphaFor('last', 18400)).toBeLessThan(1);
      expect(apply.mock.lastCall[0].baseOpacity).not.toBe(1);
      elapsed = 20000;
      vi.advanceTimersByTime(NAME_FIELD_MOTION.frameMs);
      expect(apply.mock.lastCall[0].alphaFor('last', 18400)).toBe(1);
      expect(apply.mock.lastCall[0].baseOpacity).toBe(1);
    } finally { animation.dispose(); vi.useRealTimers(); }
  });
  it('shows a selected name immediately even while the general reveal is starting', () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const animation = createNameFieldAnimation({ apply, now: () => Date.now() });
    animation.show();
    expect(apply.mock.lastCall[0].selectedOpacity).toBe(1);
    expect(apply.mock.lastCall[0].baseOpacity).not.toBe(1);
    expect(apply.mock.lastCall[0].baseOpacity.at(-2)).toBe(1600);
    animation.dispose();
    vi.useRealTimers();
  });

  it('assigns stable scattered reveal times without changing alphabetical feature order', () => {
    const source={type:'FeatureCollection',features:Array.from({length:20},(_,i)=>({id:String(i),properties:{pid:String(i)},geometry:{type:'Point',coordinates:[0,0]}}))};
    const first=withNameRevealDelays(source);
    const second=withNameRevealDelays({...source,features:[...source.features].reverse()});
    const times=data=>Object.fromEntries(data.features.map(f=>[f.id,f.properties.reveal_delay]));
    expect(times(first)).toEqual(times(second));
    expect(first.features.map(f=>f.id)).toEqual(source.features.map(f=>f.id));
    expect(new Set(Object.values(times(first))).size).toBe(20);
    expect(Math.max(...Object.values(times(first)))).toBe(18400);
    expect(source.features[0].properties.reveal_delay).toBeUndefined();
  });
  it('keeps the staggered entrance running until the last name finishes', () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const animation = createNameFieldAnimation({ apply, now: () => Date.now() });
    animation.show();
    vi.advanceTimersByTime(4400);
    expect(apply.mock.lastCall[0].baseOpacity).not.toBe(1);
    vi.advanceTimersByTime(NAME_FIELD_MOTION.spreadMs + NAME_FIELD_MOTION.revealMs - 4400 + 100);
    expect(apply.mock.lastCall[0].baseOpacity).toBe(1);
    animation.dispose();
    vi.useRealTimers();
  });
  it('fades out together, cancels a stale removal on re-enable, and stops after disposal', () => {
    vi.useFakeTimers();
    const apply=vi.fn(), removed=vi.fn();
    const animation=createNameFieldAnimation({apply,now:()=>Date.now()});
    animation.show(); vi.advanceTimersByTime(NAME_FIELD_MOTION.spreadMs + NAME_FIELD_MOTION.revealMs + 100);
    expect(apply.mock.lastCall[0].baseOpacity).toBe(1);
    animation.hide(removed); vi.advanceTimersByTime(150);
    expect(removed).not.toHaveBeenCalled();
    animation.show({restart:false}); vi.advanceTimersByTime(NAME_FIELD_MOTION.spreadMs + NAME_FIELD_MOTION.revealMs + 100);
    expect(removed).not.toHaveBeenCalled();
    animation.hide(removed); vi.advanceTimersByTime(700);
    expect(removed).toHaveBeenCalledTimes(1);
    animation.dispose(); const count=apply.mock.calls.length;
    vi.advanceTimersByTime(5000); expect(apply).toHaveBeenCalledTimes(count);
    vi.useRealTimers();
  });
  it('honors reduced motion and composes focus with the reveal', () => {
    const apply=vi.fn(), removed=vi.fn();
    const animation=createNameFieldAnimation({apply,motionMode:'reduced'});
    animation.show(); animation.setFocus(.18);
    expect(apply.mock.lastCall[0]).toMatchObject({baseOpacity:.18,selectedOpacity:1});
    animation.hide(removed); expect(removed).toHaveBeenCalledOnce();
    animation.dispose();
  });
  it('uses the same global PID schedule for each Canvas output and either input order', () => {
    const ids = Array.from({ length: 1228 }, (_, index) => String(index + 1));
    const source = { type: 'FeatureCollection', features: ids.map((pid) => ({ properties: { pid } })) };
    const td = withNameRevealDelays(source);
    const first = nameRevealSchedule(ids);
    const reversed = nameRevealSchedule([...ids].reverse());
    for (const feature of td.features) {
      const pid = feature.properties.pid;
      expect(first.get(pid)).toEqual(reversed.get(pid));
      expect(first.get(pid).delayMs).toBe(feature.properties.reveal_delay);
    }
    expect(new Set([...first.values()].map((entry) => entry.index)).size).toBe(1228);
    expect(Math.max(...[...first.values()].map((entry) => entry.delayMs))).toBe(NAME_FIELD_MOTION.spreadMs);
  });
  it('publishes numeric per-PID reveal and focus without evaluating MapLibre expressions', () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const animation = createNameFieldAnimation({ apply, now: () => Date.now() });
    animation.show();
    expect(apply.mock.lastCall[0].alphaFor('p1', 0)).toBe(0);
    vi.advanceTimersByTime(800);
    expect(apply.mock.lastCall[0].alphaFor('p1', 0)).toBeGreaterThan(0.48);
    expect(apply.mock.lastCall[0].alphaFor('p2', 1000)).toBe(0);
    animation.setFocus(['case', ['==', ['get', 'pid'], 'p1'], 1, .18], (pid) => pid === 'p1' ? 1 : .18);
    vi.advanceTimersByTime(350);
    expect(apply.mock.lastCall[0].alphaFor('p1', 0)).toBeGreaterThan(0.7);
    expect(apply.mock.lastCall[0].alphaFor('p2', 0)).toBeCloseTo(.18 * (1150 / 1600), 1);
    animation.hide(); vi.advanceTimersByTime(650);
    expect(apply.mock.lastCall[0].alphaFor('p1', 0)).toBe(0);
    animation.dispose(); vi.useRealTimers();
  });
  it('keeps opacity expressions bounded during rapid repeated focus changes',()=>{
    vi.useFakeTimers();
    const apply=vi.fn();
    const animation=createNameFieldAnimation({apply,now:()=>Date.now()});
    animation.show();vi.advanceTimersByTime(NAME_FIELD_MOTION.spreadMs + NAME_FIELD_MOTION.revealMs + 100);
    for(let index=0;index<100;index++){
      animation.setFocus(['case',['==',['get','pid'],String(index)],1,.18]);
      vi.advanceTimersByTime(40);
    }
    expect(JSON.stringify(apply.mock.lastCall[0]).length).toBeLessThan(2000);
    animation.dispose();vi.useRealTimers();
  });
});
