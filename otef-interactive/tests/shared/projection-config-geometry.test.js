import { expect, test } from 'vitest';
import { DEFAULT_PROJECTION_CONFIG as DEFAULTS } from '../../frontend/src/shared/projection-config-schema.js';
import { containsUv, outputToT3, t3ToOutput, visibleT3Rect } from '../../frontend/src/shared/projection-config-geometry.js';

test('legacy visible centers and inverse agree', () => {
  const left = DEFAULTS.outputs.left;
  expect(outputToT3({ u: 0.5, v: 0.5 }, left)).toEqual({ u: 0.3, v: 0.5245 });
  expect(outputToT3({ u: 0, v: 0.5 }, left).u).toBeCloseTo(0.05);
  expect(outputToT3({ u: 1, v: 0.5 }, left).u).toBeCloseTo(0.55);
  expect(t3ToOutput(outputToT3({ u: 0.2, v: 0.8 }, left), left)).toEqual(expect.objectContaining({ u: expect.closeTo(0.2), v: expect.closeTo(0.8) }));
});

test('visible rect intersects source, crop and viewport', () => {
  expect(visibleT3Rect(DEFAULTS.outputs.left)).toEqual({ x0: expect.closeTo(0.05), x1: expect.closeTo(0.55), y0: expect.closeTo(0.2745), y1: expect.closeTo(0.7745) });
  expect(containsUv(visibleT3Rect(DEFAULTS.outputs.left), { u: 0.3, v: 0.5 })).toBe(true);
  expect(containsUv(visibleT3Rect(DEFAULTS.outputs.left), { u: 0.01, v: 0.5 })).toBe(false);
});

test('post scale and translation affect both directions', () => {
  const branch = { crop: { x0: 0, x1: 1, y0: 0, y1: 1 }, post: { scale: 1.3, tx: 0.1, ty: -0.2 } };
  const output = t3ToOutput({ u: 0.5, v: 0.5 }, branch);
  expect(output).toEqual({ u: 0.6, v: 0.3 });
  expect(outputToT3(output, branch)).toEqual({ u: 0.5, v: 0.5 });
});

test('fully clipped viewport returns null', () => {
  const branch = { crop: { x0: 0, x1: 0.2, y0: 0, y1: 0.2 }, post: { scale: 0.1, tx: 2, ty: 2 } };
  expect(visibleT3Rect(branch)).toBeNull();
});

test('width-limited Fit Best clips only the viewport intersection', () => {
  const branch = { crop: { x0: 0.1, x1: 0.9, y0: 0.4, y1: 0.5 }, post: { scale: 1, tx: 0, ty: 0 } };
  const rect = visibleT3Rect(branch);
  expect(rect.x0).toBeCloseTo(0.1);
  expect(rect.x1).toBeCloseTo(0.9);
  expect(rect.y0).toBeCloseTo(0.4);
  expect(rect.y1).toBeCloseTo(0.5);
});
