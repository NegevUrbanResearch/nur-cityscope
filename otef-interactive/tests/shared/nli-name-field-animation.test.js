import { describe, it, expect, vi } from 'vitest';
import {
  NAME_FIELD_MOTION,
  withNameRevealDelays,
  createNameFieldAnimation,
} from '../../frontend/src/shared/nli-name-field-animation.js';

describe('memorial name animation', () => {
  it('shows a selected name immediately even while the general reveal is starting', () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const animation = createNameFieldAnimation({ apply, now: () => Date.now() });
    animation.show();
    expect(apply.mock.lastCall[0].selectedOpacity).toBe(1);
    expect(apply.mock.lastCall[0].baseOpacity).not.toBe(1);
    expect(apply.mock.lastCall[0].baseOpacity.at(-2)).toBe(800);
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
    expect(Math.max(...Object.values(times(first)))).toBe(3600);
    expect(source.features[0].properties.reveal_delay).toBeUndefined();
  });
  it('keeps the staggered entrance running past the previous 2.6s window', () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const animation = createNameFieldAnimation({ apply, now: () => Date.now() });
    animation.show();
    vi.advanceTimersByTime(2700);
    expect(apply.mock.lastCall[0].baseOpacity).not.toBe(1);
    vi.advanceTimersByTime(1400);
    expect(apply.mock.lastCall[0].baseOpacity).not.toBe(1);
    vi.advanceTimersByTime(400);
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
