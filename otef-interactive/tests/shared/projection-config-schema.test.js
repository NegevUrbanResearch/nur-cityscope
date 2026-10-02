import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  DEFAULT_PROJECTION_CONFIG,
  parseProjectionImport,
  serializeProjectionExport,
  validateProjectionConfig,
  migrateProjectionConfigToV7,
} from '../../frontend/src/shared/projection-config-schema.js';
import { migrateProjectionConfigToV2 } from '../../frontend/src/shared/projection-warp-schema.js';
import { migrateNamesWallToV3, migrateNamesWallToV4, migrateNamesWallToV5, migrateNamesWallToV6 } from '../../frontend/src/shared/nli-name-wall-config.js';

const fixtureDocument = JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/projection-config-v1.json', import.meta.url)));
const fixture = fixtureDocument.valid;
const clone = (value) => JSON.parse(JSON.stringify(value));

test('canonical fixture and defaults validate', () => {
  expect(validateProjectionConfig(fixture)).toEqual({});
  expect(DEFAULT_PROJECTION_CONFIG).toEqual(migrateProjectionConfigToV7(fixture, 35));
  expect(DEFAULT_PROJECTION_CONFIG.schemaVersion).toBe(7);
  expect(DEFAULT_PROJECTION_CONFIG.namesWall.rotateDeg).toBe(35);
  expect(DEFAULT_PROJECTION_CONFIG.namesWall.profiles.wall.strokeWidthPx).toBe(3);
  expect(DEFAULT_PROJECTION_CONFIG.namesWall.profiles.model.strokeWidthPx).toBe(2);
  expect(Object.isFrozen(DEFAULT_PROJECTION_CONFIG)).toBe(true);
});

test('V6 names wall outline widths default per profile and validate bounded integers', () => {
  const current = migrateNamesWallToV6(migrateNamesWallToV5(fixture), 35);
  expect(current.namesWall.profiles).toMatchObject({ wall: { strokeWidthPx: 3 }, model: { strokeWidthPx: 2 } });
  delete current.namesWall.profiles.wall.strokeWidthPx;
  delete current.namesWall.profiles.model.strokeWidthPx;
  expect(validateProjectionConfig(current)).toEqual({});
  expect(migrateNamesWallToV6(current, 90).namesWall.profiles).toMatchObject({ wall: { strokeWidthPx: 3 }, model: { strokeWidthPx: 2 } });
  for (const invalid of [0, 7, 2.5, '3']) {
    const candidate = migrateNamesWallToV6(migrateNamesWallToV5(fixture), 35);
    candidate.namesWall.profiles.wall.strokeWidthPx = invalid;
    expect(validateProjectionConfig(candidate)).toHaveProperty('namesWall.profiles.wall.strokeWidthPx');
  }
  const configured = migrateNamesWallToV6(migrateNamesWallToV5(fixture), 35);
  configured.namesWall.profiles.wall.strokeWidthPx = 5;
  configured.namesWall.profiles.model.strokeWidthPx = 1;
  expect(validateProjectionConfig(configured)).toEqual({});
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
  expect(parsed).toEqual({ name: 'Checkpoint', config: migrateProjectionConfigToV7(fixture), warnings: [] });
  expect(() => parseProjectionImport(JSON.stringify({ schemaVersion: 2, name: 'x', config: fixture }))).toThrow(/schemaVersion/);
  expect(() => parseProjectionImport(JSON.stringify({ schemaVersion: 1, name: '', config: fixture }))).toThrow(/name/);
});

test('export emits only the versioned document', () => {
  expect(JSON.parse(serializeProjectionExport('Original calibration', fixture))).toEqual({ schemaVersion: 7, name: 'Original calibration', config: migrateProjectionConfigToV7(fixture) });
});

test('V5 export and legacy import round trip without dropping either profile', () => {
  const config = migrateNamesWallToV5(fixture);
  config.namesWall.activeMode = 'model';
  config.namesWall.profiles.wall.requestedFontPx = 15;
  config.namesWall.innerEdgeInsetPx.right = 60;
  const document = JSON.parse(serializeProjectionExport('  Desk  ', config));
  expect(document.schemaVersion).toBe(7);
  expect(parseProjectionImport(JSON.stringify(document))).toEqual({ name: 'Desk', config: migrateProjectionConfigToV7(config), warnings: [] });
  const v2 = migrateProjectionConfigToV2(fixture);
  expect(parseProjectionImport(JSON.stringify({ schemaVersion: 2, name: 'Old', config: v2 })).config).toEqual(migrateProjectionConfigToV7(v2));
});

test('language-only non-finite numbers are rejected', () => {
  expect(validateProjectionConfig({ ...clone(fixture), pre: { ...fixture.pre, scale: Number.NaN } })).toHaveProperty('pre.scale');
  expect(validateProjectionConfig({ ...clone(fixture), pre: { ...fixture.pre, tx: Number.POSITIVE_INFINITY } })).toHaveProperty('pre.tx');
});

test('current V7 defaults and export preserve the wall-only closeness setting', () => {
  const current = migrateNamesWallToV5(fixture);
  expect(DEFAULT_PROJECTION_CONFIG).toEqual(migrateProjectionConfigToV7(current, 35));
  expect(validateProjectionConfig(current)).toEqual({});
  current.namesWall.profiles.wall.inwardShiftPercent = 50;
  const exported = JSON.parse(serializeProjectionExport('Close pages', current));
  expect(exported.schemaVersion).toBe(7);
  expect(parseProjectionImport(JSON.stringify(exported)).config).toEqual(migrateProjectionConfigToV7(current));
  expect(parseProjectionImport(JSON.stringify({ schemaVersion: 4, name: 'Old', config: migrateNamesWallToV4(fixture) })).config.namesWall.profiles.wall.inwardShiftPercent).toBe(0);
});

test('V6 keeps an independent finite rotation and seeds old imports from the acknowledged angle', async () => {
  const wall = await import('../../frontend/src/shared/nli-name-wall-config.js');
  const schema = await import('../../frontend/src/shared/projection-config-schema.js');
  const client = await import('../../frontend/src/shared/projection-config-client.js');
  const v5 = wall.migrateNamesWallToV5(fixture);
  const seeded = wall.migrateNamesWallToV6(v5, 395);
  expect(seeded.schemaVersion).toBe(6);
  expect(seeded.namesWall.rotateDeg).toBe(35);
  expect(seeded.pre).toEqual(v5.pre);
  expect(seeded.outputs).toEqual(v5.outputs);
  expect(wall.validateNamesWallV6(seeded.namesWall)).toEqual({});
  expect(schema.validateProjectionConfigV6(seeded)).toEqual({});
  expect(wall.migrateNamesWallToV6(seeded, 12).namesWall.rotateDeg).toBe(35);
  expect(wall.migrateNamesWallToV6(fixture, 270).namesWall.rotateDeg).toBe(-90);
  expect(wall.migrateNamesWallToV6(fixture, -180).namesWall.rotateDeg).toBe(-180);
  expect(wall.migrateNamesWallToV6(fixture, 180).namesWall.rotateDeg).toBe(-180);
  const imported = schema.parseProjectionImport(JSON.stringify({ schemaVersion: 5, name: 'Captured', config: v5 }), 70);
  expect(imported.config.namesWall.rotateDeg).toBe(70);
  expect(imported.config.schemaVersion).toBe(7);
  expect(imported.config.outputs.left.warp.grid.columnPositions).toEqual(Array.from({ length: 7 }, (_, i) => i / 6));
  const preserved = schema.parseProjectionImport(JSON.stringify({ schemaVersion: 6, name: 'Kept', config: seeded }));
  expect(preserved.config.namesWall.rotateDeg).toBe(35);
  const oldV6 = clone(seeded);
  delete oldV6.namesWall.profiles.wall.strokeWidthPx;
  delete oldV6.namesWall.profiles.model.strokeWidthPx;
  expect(schema.parseProjectionImport(JSON.stringify({ schemaVersion: 6, name: 'Old V6', config: oldV6 })).config.namesWall.profiles).toMatchObject({ wall: { strokeWidthPx: 3 }, model: { strokeWidthPx: 2 } });
  const interim = clone(seeded);
  delete interim.namesWall.profiles.wall.strokeWidthPx;
  delete interim.namesWall.profiles.model.strokeWidthPx;
  interim.namesWall.strokeWidthPx = 5;
  const migratedInterim = wall.migrateNamesWallToV6(interim, 35);
  expect(migratedInterim.namesWall.profiles).toMatchObject({ wall: { strokeWidthPx: 5 }, model: { strokeWidthPx: 5 } });
  expect(migratedInterim.namesWall).not.toHaveProperty('strokeWidthPx');
  const explicitWidth = clone(interim);
  explicitWidth.namesWall.profiles.wall.strokeWidthPx = 4;
  expect(wall.migrateNamesWallToV6(explicitWidth, 35).namesWall.profiles).toMatchObject({ wall: { strokeWidthPx: 4 }, model: { strokeWidthPx: 5 } });
  expect(client.validateProjectionConfigSnapshot({ revision: 0, config: seeded, presets: [
    { id: 'original', name: 'Original calibration', config: migratedInterim, readOnly: true },
  ], selectedPresetId: 'original' })).toBe(false);
  const globalTwo = clone(seeded);
  delete globalTwo.namesWall.profiles.wall.strokeWidthPx;
  delete globalTwo.namesWall.profiles.model.strokeWidthPx;
  globalTwo.namesWall.strokeWidthPx = 2;
  expect(wall.migrateNamesWallToV6(globalTwo, 35).namesWall.profiles).toMatchObject({ wall: { strokeWidthPx: 2 }, model: { strokeWidthPx: 2 } });
  const extraProfile = clone(seeded);
  extraProfile.namesWall.profiles.extra = {};
  expect(wall.validateNamesWallV6(extraProfile.namesWall)).toHaveProperty('namesWall.profiles.extra');
  expect(schema.validateProjectionConfigV6(extraProfile)).toHaveProperty('namesWall.profiles.extra');
  const exported = JSON.parse(schema.serializeProjectionExport('Kept', seeded));
  expect(exported.schemaVersion).toBe(7);
  expect(exported.config.namesWall.rotateDeg).toBe(35);
});

test('V6 import of a V3 file keeps the seam-gap conversion warning', () => {
  const v3 = migrateNamesWallToV3(fixture);
  v3.namesWall.profiles.wall.seamGapPx = 3;
  const parsed = parseProjectionImport(JSON.stringify({ schemaVersion: 3, name: 'Historical seam', config: v3 }), 35);
  expect(parsed.config.schemaVersion).toBe(7);
  expect(parsed.config.namesWall.rotateDeg).toBe(35);
  expect(parsed.warnings).toContain('The wall seam gap needs readjustment in final-output pixels.');
});
