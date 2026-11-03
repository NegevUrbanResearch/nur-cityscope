import { describe, expect, it } from 'vitest';
import { createNliClockMotion, nliClockHalfOpacity } from '../../frontend/src/shared/nli-clock-motion.js';

describe('NLI clock presentation motion', () => {
  it('starts from the displayed time and settles directly on the authored target', () => {
    const motion = createNliClockMotion();
    motion.setTarget('06:29', 0);
    expect(motion.sample(0).active).toBe(false);
    motion.setTarget('06:41', 100);
    expect(motion.sample(100)).toMatchObject({ fromLabel: '06:29', toLabel: '06:41', progress: 0, active: true });
    expect(motion.sample(310).progress).toBeCloseTo(.5);
    expect(motion.sample(520)).toMatchObject({ toLabel: '06:41', progress: 1, active: false });
  });

  it('repeated synchronization never restarts a flip', () => {
    const motion = createNliClockMotion();
    motion.setTarget('06:29', 0);
    motion.setTarget('06:41', 100);
    motion.setTarget('06:41', 300);
    expect(motion.sample(520).active).toBe(false);
  });

  it('coalesces rapid changes to the latest pending time', () => {
    const motion = createNliClockMotion();
    motion.setTarget('06:29', 0);
    motion.setTarget('06:41', 100);
    motion.setTarget('08:03', 200);
    motion.setTarget('12:00', 250);
    expect(motion.sample(520)).toMatchObject({ fromLabel: '06:41', toLabel: '12:00', progress: 0, active: true });
    expect(motion.sample(940)).toMatchObject({ toLabel: '12:00', active: false });
  });

  it('hiding cancels motion and revealing starts with the correct whole time', () => {
    const motion = createNliClockMotion();
    motion.setTarget('06:29', 0);
    motion.setTarget('06:41', 100);
    motion.setTarget('', 200, { visible: false });
    expect(motion.sample(200)).toMatchObject({ toLabel: '', active: false });
    motion.setTarget('08:03', 300);
    expect(motion.sample(300)).toMatchObject({ fromLabel: '08:03', toLabel: '08:03', active: false });
  });

  it('reduced motion settles immediately even during an existing flip', () => {
    const motion = createNliClockMotion();
    motion.setTarget('06:29', 0);
    motion.setTarget('06:41', 100);
    motion.setTarget('08:03', 200, { motionMode: 'reduced' });
    expect(motion.sample(200)).toMatchObject({ toLabel: '08:03', active: false });
  });

  it('suppresses the rotating half before it becomes an edge-on streak', () => {
    expect(nliClockHalfOpacity(0)).toBe(0);
    expect(nliClockHalfOpacity(.1)).toBe(0);
    expect(nliClockHalfOpacity(.28)).toBeCloseTo(.5);
    expect(nliClockHalfOpacity(.5)).toBe(1);
  });
});
