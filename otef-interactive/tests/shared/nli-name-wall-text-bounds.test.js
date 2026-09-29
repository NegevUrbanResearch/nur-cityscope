import { expect, test } from 'vitest';
import { MODEL_NAME_ANTIALIAS_GUARD, MODEL_NAME_STROKE_WIDTH, modelNameTextBounds } from '../../frontend/src/shared/nli-name-wall-text-bounds.js';

test('model bounds guard asymmetric ink around its shifted paint anchor', () => {
  expect(MODEL_NAME_STROKE_WIDTH).toBe(1);
  expect(MODEL_NAME_ANTIALIAS_GUARD).toBe(2);
  const bounds = modelNameTextBounds({ width: 25, left: 8, right: 12, ascent: 7, descent: 2 });
  expect(bounds).toEqual({ width: 25, height: 14, textOffsetX: -2, textOffsetY: 2.5 });
  expect(bounds.width / 2 + bounds.textOffsetX - 8).toBeCloseTo(2.5);
  expect(bounds.width / 2 - bounds.textOffsetX - 12).toBeCloseTo(2.5);
  expect(bounds.height / 2 + bounds.textOffsetY - 7).toBeCloseTo(2.5);
  expect(bounds.height / 2 - bounds.textOffsetY - 2).toBeCloseTo(2.5);
  expect(modelNameTextBounds({ width: 12, left: 6, right: 6, ascent: 4, descent: 4 })).toMatchObject({
    textOffsetX: 0, textOffsetY: 0,
  });
});

test('model bounds reject missing, non-finite, and degenerate ink metrics', () => {
  for (const metric of [null, {}, { width: 4, left: 0, right: 0, ascent: 1, descent: 1 },
    { width: 4, left: 1, right: 1, ascent: 0, descent: 0 },
    { width: 4, left: 1, right: 1, ascent: Number.NaN, descent: 1 },
    { width: 4, left: 1, right: Infinity, ascent: 1, descent: 1 }]) {
    expect(() => modelNameTextBounds(metric)).toThrow('invalid model name ink metrics');
  }
});
