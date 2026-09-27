import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_NAMES_WALL, DEFAULT_NAMES_WALL_V5, LEGACY_NAMES_WALL, validateNamesWall, validateNamesWallV3, validateNamesWallV5, migrateNamesWallToV3, migrateNamesWallToV4, migrateNamesWallToV5 } from '../../frontend/src/shared/nli-name-wall-config.js';
import { DEFAULT_PROJECTION_CONFIG, LEGACY_DEFAULT_PROJECTION_CONFIG, validateProjectionConfig } from '../../frontend/src/shared/projection-config-schema.js';
import { migrateProjectionConfigToV2 } from '../../frontend/src/shared/projection-warp-schema.js';

const clone = (value) => structuredClone(value);
const fixture = JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/names-wall-v3.json', import.meta.url)));
const v4Fixture = JSON.parse(readFileSync(new URL('../../../nur-io/django_api/backend/tests/fixtures/names-wall-v4.json', import.meta.url)));

test('shared V4 fixture has matching defaults and limits', () => {
  expect(v4Fixture.valid).toEqual(DEFAULT_NAMES_WALL);
  for (const item of v4Fixture.accepted) {
    const value = clone(v4Fixture.valid);
    const parts = item.path.split('.');
    parts.slice(0, -1).reduce((object, key) => object[key], value)[parts.at(-1)] = item.value;
    expect(validateNamesWall(value)).toEqual({});
  }
  for (const item of v4Fixture.rejected) {
    const value = clone(v4Fixture.valid);
    const parts = item.path.split('.');
    parts.slice(0, -1).reduce((object, key) => object[key], value)[parts.at(-1)] = item.value;
    expect(validateNamesWall(value)).toHaveProperty(item.error);
  }
});

test('shared V3 fixture has the canonical defaults and field errors', () => {
  expect(fixture.valid).toEqual(LEGACY_NAMES_WALL);
  for (const item of fixture.cases) {
    const value = clone(fixture.valid);
    const parts = item.path.split('.');
    const target = parts.slice(0, -1).reduce((object, key) => object[key], value);
    target[parts.at(-1)] = item.value;
    expect(validateNamesWallV3(value)).toHaveProperty(item.error);
  }
});

test('V4 preserves calibration and removes the old font floor', () => {
  const old = migrateNamesWallToV3(LEGACY_DEFAULT_PROJECTION_CONFIG);
  const next = migrateNamesWallToV4(old);
  expect(next.schemaVersion).toBe(4);
  expect(next.pre).toEqual(old.pre);
  expect(next.outputs).toEqual(old.outputs);
  expect(next.namesWall.innerEdgeInsetPx).toEqual({ left: 0, right: 0 });
  expect(next.namesWall.profiles.wall).not.toHaveProperty('minimumFontPx');
  expect(next.namesWall.profiles.wall).not.toHaveProperty('seamGapPx');
  next.namesWall.profiles.model.requestedFontPx = 1;
  next.namesWall.innerEdgeInsetPx = { left: 960, right: 0 };
  expect(validateNamesWall(next.namesWall)).toEqual({});
});

test('current defaults contain a wall-only closeness setting and independent profiles', () => {
  expect(DEFAULT_PROJECTION_CONFIG.schemaVersion).toBe(5);
  expect(DEFAULT_PROJECTION_CONFIG.namesWall).toEqual(DEFAULT_NAMES_WALL_V5);
  expect(DEFAULT_NAMES_WALL.profiles.wall).toEqual({ requestedFontPx: 12, spacingPx: 2, edgeInsetPx: 0 });
  expect(DEFAULT_NAMES_WALL.profiles.model).toEqual(DEFAULT_NAMES_WALL.profiles.wall);
  expect(validateProjectionConfig(DEFAULT_PROJECTION_CONFIG)).toEqual({});
});

test('names-wall validator rejects exact-key, integer, bounds and font-relation errors', () => {
  const value = clone(DEFAULT_NAMES_WALL);
  value.profiles.wall.requestedFontPx = true;
  value.profiles.model.requestedFontPx = 49;
  value.profiles.model.spacingPx = 33;
  value.profiles.wall.edgeInsetPx = -1;
  value.innerEdgeInsetPx.left = 961;
  value.profiles.wall.extra = 0;
  value.activeMode = 'other';
  const errors = {};
  validateNamesWall(value, 'namesWall', errors);
  expect(Object.keys(errors).sort()).toEqual([
    'namesWall.activeMode', 'namesWall.innerEdgeInsetPx.left', 'namesWall.profiles.model.requestedFontPx', 'namesWall.profiles.model.spacingPx',
    'namesWall.profiles.wall.edgeInsetPx', 'namesWall.profiles.wall.extra',
    'namesWall.profiles.wall.requestedFontPx',
  ].sort());
  const relation = clone(DEFAULT_NAMES_WALL);
  relation.profiles.model.requestedFontPx = 0;
  expect(validateNamesWall(relation, 'namesWall', {})).toHaveProperty('namesWall.profiles.model.requestedFontPx');
});

test('V1 and V2 conversion preserves every calibration value and is idempotent for V3', () => {
  const legacy = structuredClone(DEFAULT_PROJECTION_CONFIG);
  delete legacy.namesWall;
  legacy.schemaVersion = 2;
  legacy.pre.tx = 0.37;
  legacy.outputs.left.warp.grid.offsets[0] = [0.01, -0.02];
  const upgraded = migrateNamesWallToV3(legacy);
  expect(upgraded).toEqual({ ...legacy, schemaVersion: 3, namesWall: LEGACY_NAMES_WALL });
  expect(migrateNamesWallToV3(upgraded)).toEqual(upgraded);
  const v1 = { schemaVersion: 1, pre: legacy.pre, outputs: Object.fromEntries(['left', 'right'].map((side) => [side, { crop: legacy.outputs[side].crop, post: legacy.outputs[side].post }])) };
  expect(migrateNamesWallToV3(v1)).toEqual(migrateNamesWallToV3(migrateProjectionConfigToV2(v1)));
});

test('V5 adds only regular page closeness and strictly validates it', () => {
  const v4 = migrateNamesWallToV4(LEGACY_DEFAULT_PROJECTION_CONFIG);
  const v5 = migrateNamesWallToV5(v4);
  expect(v5.schemaVersion).toBe(5);
  expect(v5.namesWall.profiles.wall).toEqual({ ...v4.namesWall.profiles.wall, inwardShiftPercent: 0 });
  expect(v5.namesWall.profiles.model).toEqual(v4.namesWall.profiles.model);
  expect(v5.pre).toEqual(v4.pre);
  expect(v5.outputs).toEqual(v4.outputs);
  expect(migrateNamesWallToV5(v5)).toEqual(v5);
  for (const bad of [-1, 101, 1.5, '50', null]) {
    const candidate = clone(v5.namesWall);
    candidate.profiles.wall.inwardShiftPercent = bad;
    expect(validateNamesWallV5(candidate)).toHaveProperty('namesWall.profiles.wall.inwardShiftPercent');
  }
  const wrongMode = clone(v5.namesWall);
  wrongMode.profiles.model.inwardShiftPercent = 50;
  expect(validateNamesWallV5(wrongMode)).toHaveProperty('namesWall.profiles.model.inwardShiftPercent');
  expect(validateNamesWallV5(v5.namesWall)).toEqual({});
  expect(validateNamesWall(v5.namesWall)).toHaveProperty('namesWall.profiles.wall.inwardShiftPercent');
});
