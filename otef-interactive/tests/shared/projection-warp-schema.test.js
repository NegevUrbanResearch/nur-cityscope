import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  migrateProjectionConfigToV2,
  validateProjectionConfigV2,
  validateProjectionWarp,
  validateProjectionWarpV7,
  validateProjectionConfigV7,
} from '../../frontend/src/shared/projection-warp-schema.js';
import { validateProjectionConfig, migrateProjectionConfigToV7 } from '../../frontend/src/shared/projection-config-schema.js';
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

test('V6 projection validation accepts rotateDeg and rejects a profile angle', async () => {
  const wall = await import('../../frontend/src/shared/nli-name-wall-config.js');
  const warp = await import('../../frontend/src/shared/projection-warp-schema.js');
  const config = wall.migrateNamesWallToV6(wall.migrateNamesWallToV5(migrateProjectionConfigToV2(fixture)), 35);
  expect(warp.validateProjectionConfigV6(config)).toEqual({});
  const angled = structuredClone(config);
  angled.namesWall.profiles.wall.rotateDeg = 35;
  expect(warp.validateProjectionConfigV6(angled)).toHaveProperty('namesWall.profiles.wall.rotateDeg');
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

test('v7 grid schema accepts equal output dimensions and migration is a deep-copy idempotent upgrade', async () => {
  const wall = await import('../../frontend/src/shared/nli-name-wall-config.js');
  const v6 = wall.migrateNamesWallToV6(wall.migrateNamesWallToV5(migrateProjectionConfigToV2(fixture)), 35);
  const migrated = migrateProjectionConfigToV7(v6);
  expect(migrated.schemaVersion).toBe(7);
  expect(migrated.outputs.left.warp.grid).toMatchObject({ columns: 7, rows: 7, columnPositions: Array.from({ length: 7 }, (_, i) => i / 6) });
  expect(migrated.outputs.right.warp.grid.columns).toBe(8);
  expect(validateProjectionConfigV7(migrated)).toEqual({});
  expect(migrateProjectionConfigToV7(migrated)).toEqual(migrated);
  expect(migrateProjectionConfigToV7(migrated)).not.toBe(migrated);
  expect(migrateProjectionConfigToV7(v6)).not.toBe(v6);
  const equalCounts = structuredClone(migrated);
  equalCounts.outputs.right.warp.grid.columns = 7;
  equalCounts.outputs.right.warp.grid.columnPositions = Array.from({ length: 7 }, (_, i) => i / 6);
  equalCounts.outputs.right.warp.grid.offsets = Array.from({ length: 49 }, () => [0, 0]);
  expect(validateProjectionConfigV7(equalCounts)).toEqual({});
});

test.each([
  ['boolean column count', (grid) => { grid.columns = true; }, 'grid.columns'],
  ['fractional row count', (grid) => { grid.rows = 2.5; }, 'grid.rows'],
  ['missing axis', (grid) => { delete grid.rowPositions; }, 'grid.rowPositions'],
  ['wrong axis length', (grid) => { grid.columnPositions.pop(); }, 'grid.columnPositions'],
  ['wrong endpoint', (grid) => { grid.rowPositions[0] = 0.01; }, 'grid.rowPositions'],
  ['nonincreasing axis', (grid) => { grid.columnPositions[2] = grid.columnPositions[1]; }, 'grid.columnPositions'],
  ['unknown key', (grid) => { grid.extra = 1; }, 'grid.extra'],
  ['wrong offset count', (grid) => { grid.offsets.pop(); }, 'grid.offsets'],
  ['boolean axis coordinate', (grid) => { grid.columnPositions[1] = true; }, 'grid.columnPositions[1]'],
  ['nonfinite axis coordinate', (grid) => { grid.rowPositions[1] = Number.NaN; }, 'grid.rowPositions[1]'],
  ['out of range offset', (grid) => { grid.offsets[0][0] = 2.01; }, 'grid.offsets[0][0]'],
])('v7 rejects %s', (_name, mutate, path) => {
  const warp = structuredClone(golden.identity.warp);
  warp.grid = { columns: 7, rows: 7, columnPositions: Array.from({ length: 7 }, (_, i) => i / 6), rowPositions: Array.from({ length: 7 }, (_, i) => i / 6), offsets: Array.from({ length: 49 }, () => [0, 0]) };
  mutate(warp.grid);
  expect(validateProjectionWarpV7(warp, 'left')).toHaveProperty(path);
});

test('v7 accepts count boundaries and arbitrarily close increasing source knots while legacy stays fixed', async () => {
  const wall = await import('../../frontend/src/shared/nli-name-wall-config.js');
  const v6 = wall.migrateNamesWallToV6(wall.migrateNamesWallToV5(migrateProjectionConfigToV2(fixture)), 35);
  const v7 = migrateProjectionConfigToV7(v6);
  const left = v7.outputs.left.warp;
  left.grid.columns = 3;
  left.grid.columnPositions = [0, Number.MIN_VALUE, 1];
  left.grid.offsets = Array.from({ length: 21 }, () => [0, 0]);
  const right = v7.outputs.right.warp;
  right.grid.columns = 16;
  right.grid.columnPositions = Array.from({ length: 16 }, (_, i) => i / 15);
  right.grid.rows = 2;
  right.grid.rowPositions = [0, 1];
  right.grid.offsets = Array.from({ length: 32 }, () => [0, 0]);
  expect(validateProjectionConfigV7(v7)).toEqual({});
  expect(validateProjectionWarp(golden.identity.warp, 'left')).toEqual({});
  const legacyWithAxis = structuredClone(golden.identity.warp);
  legacyWithAxis.grid.columnPositions = Array.from({ length: 7 }, (_, i) => i / 6);
  expect(validateProjectionWarp(legacyWithAxis, 'left')).toHaveProperty('grid.columnPositions');
});

test('manifest metadata rejects malformed objects and missing framing hash', () => {
  expect(validateProjectionBaselineManifest({ schemaVersion: 1, width: 1920, height: 1080, assets: [], framing: [] })).toMatchObject({ assets: 'must be an object', framing: 'must be an object' });
  expect(validateProjectionBaselineManifest({ schemaVersion: 1, width: 1920, height: 1080, assets: {}, framing: { path: 'framing.json' } })).toHaveProperty('framing.sha256');
});
