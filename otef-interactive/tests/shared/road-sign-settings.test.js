import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ROAD_SIGN_ASPECT,
  ROAD_SIGN_BASE_WIDTH,
  createRoadSign,
  emptyRoadSignSettings,
  validateRoadSignSettings,
} from '../../frontend/src/shared/road-sign-settings.js';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/road-sign-settings.json', import.meta.url), 'utf8'));

describe('road sign settings', () => {
  it('uses the fixed reference artwork dimensions', () => {
    expect(ROAD_SIGN_BASE_WIDTH).toBe(114);
    expect(ROAD_SIGN_ASPECT).toBe(524 / 381);
  });

  it('creates an independent default sign centered at the requested point', () => {
    expect(createRoadSign({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', x: 700, y: 400 })).toEqual({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      x: 700,
      y: 400,
      scale: 0.7,
      rotateDeg: 0,
      theme: 'dark',
      visible: true,
      leader: { enabled: false, x: 700, y: 400 },
    });
  });

  it('normalizes an absent document to the empty v1 shape', () => {
    expect(emptyRoadSignSettings()).toEqual(fixtures.empty);
    expect(validateRoadSignSettings({}).settings).toEqual(fixtures.empty);
  });

  it('accepts multiple outputs, inclusive scale limits, and signed decimal angles', () => {
    const result = validateRoadSignSettings(fixtures.twoOutputs);
    expect(result.valid).toBe(true);
    expect(result.settings).toEqual(fixtures.twoOutputs);
    expect(result.settings.outputs.left[0].scale).toBe(0.01);
    expect(result.settings.outputs.left[1].scale).toBe(0.025);
    expect(result.settings.outputs.right[0].scale).toBe(3);
    expect(result.settings.outputs.left[0].rotateDeg).toBe(-17.3);
  });

  it('accepts independent GIS signs while preserving legacy projection documents', () => {
    const settings = structuredClone(fixtures.twoOutputs);
    settings.outputs.gis = [createRoadSign({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', x: 800, y: 400 })];
    expect(validateRoadSignSettings(settings)).toMatchObject({ valid: true, settings });
    expect(validateRoadSignSettings(fixtures.twoOutputs).settings).toEqual(fixtures.twoOutputs);
    settings.outputs.gis[0].id = settings.outputs.left[0].id;
    expect(validateRoadSignSettings(settings).valid).toBe(false);
  });

  it('rejects duplicate IDs, unknown fields, coercions, invalid enums, and out-of-range coordinates', () => {
    for (const settings of Object.values(fixtures.invalid)) {
      const result = validateRoadSignSettings(settings);
      expect(result.valid).toBe(false);
      expect(result.error).toBeTruthy();
    }
  });

  it('rejects nonfinite values and more than 64 signs on one output', () => {
    const base = fixtures.twoOutputs.outputs.left[0];
    const nonfinite = structuredClone(fixtures.empty);
    nonfinite.outputs.left = [{ ...base, x: Number.NaN }];
    const full = structuredClone(fixtures.empty);
    full.outputs.left = Array.from({ length: 65 }, (_, index) => ({
      ...base,
      id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }));
    expect(validateRoadSignSettings(nonfinite).valid).toBe(false);
    expect(validateRoadSignSettings(full).valid).toBe(false);
  });

  it('rejects unsupported nested fields and every numeric range boundary violation', () => {
    const sign = fixtures.twoOutputs.outputs.left[0];
    const invalidSigns = [
      { ...sign, extra: true },
      { ...sign, scale: 0.009 },
      { ...sign, scale: 3.001 },
      { ...sign, rotateDeg: -180.1 },
      { ...sign, rotateDeg: 180.1 },
      { ...sign, y: -0.1 },
      { ...sign, visible: 1 },
      { ...sign, leader: { ...sign.leader, extra: 1 } },
    ];
    for (const invalidSign of invalidSigns) {
      const settings = structuredClone(fixtures.empty);
      settings.outputs.left = [invalidSign];
      expect(validateRoadSignSettings(settings).valid).toBe(false);
    }
  });
});
