import { expect, test } from 'vitest';
import {
  resolveProjectionBaselineAsset,
  validateProjectionBaselineManifest,
} from '../../frontend/src/shared/projection-baseline-manifest.js';

const hash = (character) => character.repeat(64);
function manifest() {
  return {
    schemaVersion: 1, width: 1920, height: 1080,
    assets: {
      left: { assetId: 'legacy-left', path: 'left.json', sha256: hash('a'), logicalGrid: { columns: 7, rows: 7 } },
      right: { assetId: 'legacy-right', path: 'right.json', sha256: hash('b'), logicalGrid: { columns: 8, rows: 7 } },
    }, framing: { path: '../td-source-config.json', sha256: hash('c') },
  };
}

test('omitted references preserve historical defaults and mixed catalogs resolve exact references', () => {
  const value = manifest();
  value.catalog = {
    left: [{ assetId: 'capture-left', path: 'captures/unique/left.json', sha256: `SHA256:${hash('d')}`, logicalGrid: { columns: 5, rows: 3 }, source: 'TD' }],
    right: [{ assetId: 'capture-right', path: 'captures/unique/right.json', sha256: hash('e'), logicalGrid: { columns: 3, rows: 4 } }],
  };
  expect(resolveProjectionBaselineAsset(value, 'left')).toBe(value.assets.left);
  expect(resolveProjectionBaselineAsset(value, 'left', null)).toBe(value.assets.left);
  expect(resolveProjectionBaselineAsset(value, 'left', { assetId: 'capture-left', sha256: hash('d') })).toBe(value.catalog.left[0]);
  expect(resolveProjectionBaselineAsset(value, 'right', { assetId: 'legacy-right', sha256: hash('b') })).toBe(value.assets.right);
  expect(resolveProjectionBaselineAsset(value, 'right', { assetId: 'capture-right', sha256: hash('e') })).toBe(value.catalog.right[0]);
  expect(validateProjectionBaselineManifest(value)).toEqual({});
});

test.each([
  ['unknown ID', { assetId: 'missing', sha256: hash('d') }],
  ['wrong hash', { assetId: 'capture-left', sha256: hash('f') }],
  ['cross-side reference', { assetId: 'capture-right', sha256: hash('e') }],
])('rejects %s without falling back to the default', (label, reference) => {
  const value = manifest();
  value.catalog = { left: [{ assetId: 'capture-left', path: 'capture-left.json', sha256: hash('d'), logicalGrid: { columns: 5, rows: 3 } }], right: [{ assetId: 'capture-right', path: 'capture-right.json', sha256: hash('e'), logicalGrid: { columns: 3, rows: 4 } }] };
  expect(() => resolveProjectionBaselineAsset(value, 'left', reference)).toThrow(/trusted|baseline|asset/i);
});

test.each([
  ['duplicate ID', (m) => { m.catalog = { left: [{ ...m.assets.left, path: 'copy.json' }], right: [] }; }],
  ['duplicate ID with conflicting hash', (m) => { m.catalog = { left: [{ ...m.assets.left, path: 'copy.json', sha256: hash('d') }], right: [] }; }],
  ['incomplete catalog sides', (m) => { m.catalog = { left: [] }; }],
  ['wrong side dimensions', (m) => { m.catalog = { left: [{ assetId: 'x', path: 'x.json', sha256: hash('d'), logicalGrid: { columns: 2, rows: 2 }, width: 1000 }], right: [] }; }],
  ['absolute path', (m) => { m.catalog = { left: [{ assetId: 'x', path: '/outside.json', sha256: hash('d'), logicalGrid: { columns: 2, rows: 2 } }], right: [] }; }],
  ['scheme path', (m) => { m.catalog = { left: [{ assetId: 'x', path: 'https://outside/x.json', sha256: hash('d'), logicalGrid: { columns: 2, rows: 2 } }], right: [] }; }],
  ['encoded path', (m) => { m.catalog = { left: [{ assetId: 'x', path: 'nested/%2e%2e/x.json', sha256: hash('d'), logicalGrid: { columns: 2, rows: 2 } }], right: [] }; }],
  ['backslash path', (m) => { m.catalog = { left: [{ assetId: 'x', path: 'nested\\x.json', sha256: hash('d'), logicalGrid: { columns: 2, rows: 2 } }], right: [] }; }],
  ['parent segment', (m) => { m.catalog = { left: [{ assetId: 'x', path: 'nested/../x.json', sha256: hash('d'), logicalGrid: { columns: 2, rows: 2 } }], right: [] }; }],
])('rejects malformed catalog entry: %s', (_label, mutate) => {
  const value = manifest(); mutate(value);
  expect(Object.keys(validateProjectionBaselineManifest(value)).length).toBeGreaterThan(0);
  expect(() => resolveProjectionBaselineAsset(value, 'left')).toThrow(/invalid|catalog|path|duplicate/i);
});
