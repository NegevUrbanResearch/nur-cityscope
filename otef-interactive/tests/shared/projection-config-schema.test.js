import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  DEFAULT_PROJECTION_CONFIG,
  parseProjectionImport,
  serializeProjectionExport,
  validateProjectionConfig,
} from '../../frontend/src/shared/projection-config-schema.js';
import { migrateProjectionConfigToV2 } from '../../frontend/src/shared/projection-warp-schema.js';

const fixtureDocument = JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-config-v1.json', import.meta.url)));
const fixture = fixtureDocument.valid;
const clone = (value) => JSON.parse(JSON.stringify(value));

test('canonical fixture and defaults validate', () => {
  expect(validateProjectionConfig(fixture)).toEqual({});
  expect(DEFAULT_PROJECTION_CONFIG).toEqual(migrateProjectionConfigToV2(fixture));
  expect(DEFAULT_PROJECTION_CONFIG.schemaVersion).toBe(2);
  expect(Object.isFrozen(DEFAULT_PROJECTION_CONFIG)).toBe(true);
});

test('shared invalid fixture cases produce exact field paths', () => {
  for (const testCase of fixtureDocument.cases) {
    expect(Object.keys(validateProjectionConfig(testCase.config)).sort()).toEqual([...testCase.errors].sort());
  }
});

test.each([
  ['scale below lower bound', (v) => { v.pre.scale = 0.099; }, 'pre.scale'],
  ['scale above upper bound', (v) => { v.pre.scale = 8.001; }, 'pre.scale'],
  ['rotation out of bounds', (v) => { v.pre.rotateDeg = 180.1; }, 'pre.rotateDeg'],
  ['offset out of bounds', (v) => { v.pre.tx = -2.001; }, 'pre.tx'],
  ['crop extent too small', (v) => { v.outputs.left.crop.x1 = 0.009; }, 'outputs.left.crop'],
  ['reversed crop', (v) => { v.outputs.right.crop.x0 = 1; }, 'outputs.right.crop'],
  ['boolean rejected', (v) => { v.pre.scale = true; }, 'pre.scale'],
  ['string rejected', (v) => { v.pre.tx = '0'; }, 'pre.tx'],
  ['null rejected', (v) => { v.outputs.left.post = null; }, 'outputs.left.post'],
  ['schema version mismatch', (v) => { v.schemaVersion = 2; }, 'schemaVersion'],
  ['missing nested key', (v) => { delete v.outputs.left.crop.y1; }, 'outputs.left.crop.y1'],
  ['extra nested key', (v) => { v.outputs.left.crop.extra = 1; }, 'outputs.left.crop.extra'],
])('%s returns a field error without mutating input', (_label, mutate, path) => {
  const value = clone(fixture);
  mutate(value);
  const before = clone(value);
  const errors = validateProjectionConfig(value);
  expect(errors).toHaveProperty(path);
  expect(value).toEqual(before);
});

test('left and right post transforms are independent', () => {
  const value = clone(fixture);
  value.outputs.left.post.tx = 1;
  expect(validateProjectionConfig(value)).toEqual({});
  expect(value.outputs.right.post.tx).toBe(0);
});

test('accepts a .01 crop extent at nonzero bounds', () => {
  const value = clone(fixture);
  value.outputs.left.crop.x0 = 0.57;
  value.outputs.left.crop.x1 = 0.58;
  expect(validateProjectionConfig(value)).toEqual({});
});

test('import trims names and enforces wrapper shape', () => {
  const parsed = parseProjectionImport(JSON.stringify({ schemaVersion: 1, name: '  Checkpoint  ', config: fixture }));
  expect(parsed).toEqual({ name: 'Checkpoint', config: fixture });
  expect(() => parseProjectionImport(JSON.stringify({ schemaVersion: 2, name: 'x', config: fixture }))).toThrow(/schemaVersion/);
  expect(() => parseProjectionImport(JSON.stringify({ schemaVersion: 1, name: '', config: fixture }))).toThrow(/name/);
});

test('export emits only the versioned document', () => {
  expect(JSON.parse(serializeProjectionExport('Original calibration', fixture))).toEqual({ schemaVersion: 1, name: 'Original calibration', config: fixture });
});

test('language-only non-finite numbers are rejected', () => {
  expect(validateProjectionConfig({ ...clone(fixture), pre: { ...fixture.pre, scale: Number.NaN } })).toHaveProperty('pre.scale');
  expect(validateProjectionConfig({ ...clone(fixture), pre: { ...fixture.pre, tx: Number.POSITIVE_INFINITY } })).toHaveProperty('pre.tx');
});
