import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  migrateProjectionConfigToV2,
  validateProjectionConfigV2,
  validateProjectionWarp,
} from '../../frontend/src/shared/projection-warp-schema.js';
import { validateProjectionConfig } from '../../frontend/src/shared/projection-config-schema.js';
import { validateProjectionBaselineManifest } from '../../frontend/src/shared/projection-warp-assets.js';

const fixture = JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-config-v1.json', import.meta.url))).valid;
const golden = JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-warp-golden.json', import.meta.url)));
const clone = (value) => JSON.parse(JSON.stringify(value));

test('migrates v1 framing without changing legacy fields', () => {
  const migrated = migrateProjectionConfigToV2(fixture);
  expect(migrated.schemaVersion).toBe(2);
  expect(migrated.pre).toEqual(fixture.pre);
  expect(migrated.outputs.left.crop).toEqual(fixture.outputs.left.crop);
  expect(migrated.outputs.right.post).toEqual(fixture.outputs.right.post);
  expect(migrated.outputs.left.presentationEffect).toEqual({ enabled: false, mode: 'passthrough' });
  expect(migrated.outputs.left.warp.enabled).toBe(true);
  expect(migrated.outputs.left.warp.baseline).toEqual({ type: 'identity', width: 1920, height: 1080, origin: 'top-left' });
  expect(validateProjectionConfigV2(migrated)).toEqual({});
});

test('accepts a complete v2 config while v1 defaults remain valid', () => {
  const value = migrateProjectionConfigToV2(fixture);
  expect(validateProjectionConfig(value)).toEqual({});
  expect(validateProjectionWarp(value.outputs.left.warp, 'left')).toEqual({});
});

test.each([
  ['wrong grid dimensions', (v) => { v.grid.columns = 8; }, 'grid.columns'],
  ['wrong offset count', (v) => { v.grid.offsets.pop(); }, 'grid.offsets'],
  ['boolean coordinate', (v) => { v.grid.offsets[0][0] = true; }, 'grid.offsets[0][0]'],
  ['unknown field', (v) => { v.keystone.extra = 1; }, 'keystone.extra'],
  ['unsafe corner', (v) => { v.keystone.corners[0][0] = 2.001; }, 'keystone.corners[0][0]'],
])('%s is rejected', (_name, mutate, path) => {
  const value = clone(golden.identity.warp);
  mutate(value);
  expect(validateProjectionWarp(value, 'left')).toHaveProperty(path);
});

test('missing assets do not invalidate v1 or a structurally valid identity warp', () => {
  expect(validateProjectionConfig(fixture)).toEqual({});
  expect(validateProjectionWarp(golden.identity.warp, 'left')).toEqual({});
});

test('trusted manifests must contain the requested side reference', () => {
  const trustedManifest = { assets: { left: { assetId: 'fixture-left', sha256: 'a'.repeat(64) } } };
  const value = clone(golden.identity.warp);
  value.baseline = { type: 'tdMesh', assetId: 'fixture-right', sha256: 'b'.repeat(64), width: 1920, height: 1080, origin: 'top-left' };
  const errors = validateProjectionWarp(value, 'right', { trustedManifest });
  expect(errors).toHaveProperty('baseline.assetId');
  expect(errors).toHaveProperty('baseline.sha256');
});

test('manifest metadata rejects malformed objects and missing framing hash', () => {
  expect(validateProjectionBaselineManifest({ schemaVersion: 1, width: 1920, height: 1080, assets: [], framing: [] })).toMatchObject({ assets: 'must be an object', framing: 'must be an object' });
  expect(validateProjectionBaselineManifest({ schemaVersion: 1, width: 1920, height: 1080, assets: {}, framing: { path: 'framing.json' } })).toHaveProperty('framing.sha256');
});
