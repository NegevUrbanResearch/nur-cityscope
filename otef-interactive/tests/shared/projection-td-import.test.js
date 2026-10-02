import { expect, test } from 'vitest';
import { DEFAULT_PROJECTION_CONFIG } from '../../frontend/src/shared/projection-config-schema.js';
import { prepareProjectionTdImport } from '../../frontend/src/shared/projection-td-import.js';
import { loadCapturedProjectionAsset } from '../../frontend/src/projection/projection-captured-baseline.js';
import { prepareProjectionSideMesh } from '../../frontend/src/projection/projection-candidate-validation.js';
import { createBaselineSampler } from '../../frontend/src/shared/projection-baseline-sampler.js';
import { evaluateWarpPoint } from '../../frontend/src/shared/projection-warp-geometry.js';
import { sha256Hex } from '../../frontend/src/shared/sha256-hex.js';
import { projectionCatalog, bytes } from '../fixtures/projection-catalog.js';

const target = () => {
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  config.pre = { scale: 1.7, rotateDeg: 12, tx: 0.13, ty: -0.08 };
  config.outputs.left.crop = { x0: 0.05, x1: 0.61, y0: 0.09, y1: 0.92 };
  config.outputs.left.post = { scale: 1.3, tx: 0.12, ty: -0.1 };
  config.outputs.right.crop = { x0: 0.38, x1: 0.94, y0: 0.04, y1: 0.87 };
  config.outputs.right.post = { scale: 0.9, tx: -0.07, ty: 0.04 };
  config.outputs.left.presentationEffect.enabled = true;
  config.namesWall.activeMode = 'model'; config.namesWall.rotateDeg = 18;
  config.namesWall.profiles.model.requestedFontPx = 19; config.namesWall.profiles.wall.spacingPx = 7;
  config.outputs.left.warp.grid.columnPositions = [0, 0.17, 0.32, 0.49, 0.76, 0.91, 1];
  config.outputs.left.warp.grid.offsets = config.outputs.left.warp.grid.offsets.map(() => [0.02, -0.01]);
  config.outputs.right.warp.grid.offsets = config.outputs.right.warp.grid.offsets.map(() => [0.03, 0.04]);
  config.outputs.right.warp.grid.columnPositions = [0, 0.07, 0.2, 0.43, 0.62, 0.75, 0.93, 1];
  for (const side of ['left', 'right']) {
    config.outputs[side].warp.grid.rowPositions = [0, 0.11, 0.23, 0.47, 0.64, 0.9, 1];
    config.outputs[side].warp.keystone.corners = [[0.02, 0.03], [0.98, 0.02], [0.01, 0.97], [0.99, 0.99]];
  }
  return config;
};
const asset = (side, columns = 24, sha256 = 'a'.repeat(64)) => ({
  assetId: `capture-${side}`, sha256, width: 1920, height: 1080, origin: 'top-left',
  logicalGrid: { columns, rows: 18 },
});

test('prepares TD import on the target while preserving all non-warp fields and editable axes', () => {
  const original = target();
  const expected = structuredClone(original);
  const imported = prepareProjectionTdImport(original, { left: asset('left') }, { sides: ['left'] });
  expect(imported).not.toBe(original);
  expect(imported.pre).toEqual(expected.pre);
  expect(imported.outputs.left.crop).toEqual(expected.outputs.left.crop);
  expect(imported.outputs.left.post).toEqual(expected.outputs.left.post);
  expect(imported.outputs.right).toEqual(expected.outputs.right);
  expect(imported.outputs.left.warp).toMatchObject({
    enabled: true,
    baseline: { type: 'tdMesh', assetId: 'capture-left', sha256: 'a'.repeat(64) },
    keystone: { corners: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    grid: { columns: expected.outputs.left.warp.grid.columns, rows: expected.outputs.left.warp.grid.rows,
      columnPositions: expected.outputs.left.warp.grid.columnPositions, rowPositions: expected.outputs.left.warp.grid.rowPositions },
  });
  expect(imported.outputs.left.warp.grid.offsets.every(([x, y]) => x === 0 && y === 0)).toBe(true);
  expect(imported.outputs.left.warp.baseline.logicalGrid).toBeUndefined();
  expect(original).toEqual(expected);
});

test('uses an explicit valid editable grid independently of larger TD logical topology', () => {
  const imported = prepareProjectionTdImport(target(), { right: asset('right', 48, `sha256:${'a'.repeat(64)}`) }, {
    sides: ['right'], grids: { right: { columns: 3, rows: 2, columnPositions: [0, 0.4, 1], rowPositions: [0, 1] } },
  });
  expect(imported.outputs.right.warp.grid).toEqual({ columns: 3, rows: 2, columnPositions: [0, 0.4, 1], rowPositions: [0, 1], offsets: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]] });
  expect(() => prepareProjectionTdImport(target(), { right: asset('right') }, {
    sides: ['right'], grids: { right: { columns: 17, rows: 2, columnPositions: Array.from({ length: 17 }, (_, i) => i / 16), rowPositions: [0, 1] } },
  })).toThrow(/invalid editable grid/i);
  expect(() => prepareProjectionTdImport(target(), { right: asset('right') }, {
    sides: ['right'], grids: { right: { columns: 100000000, rows: 2 } },
  })).toThrow(/invalid editable grid/i);
  expect(imported.outputs.right.warp.baseline.sha256).toBe('a'.repeat(64));
});

test('rejects imports without a complete selected TD asset reference', () => {
  expect(() => prepareProjectionTdImport(target(), { left: { assetId: 'bad' } }, { sides: ['left'] })).toThrow(/TD asset reference/i);
});

test.each([{ sides: ['left'] }, { sides: ['right'] }, { sides: ['left', 'right'] }])('preserves complete target outside requested warps: $sides', ({ sides }) => {
  const original = target(), before = structuredClone(original);
  const imported = prepareProjectionTdImport(original, { left: asset('left'), right: asset('right') }, { sides });
  const strip = (config) => { const copy = structuredClone(config); for (const side of sides) delete copy.outputs[side].warp; return copy; };
  expect(strip(imported)).toEqual(strip(before)); expect(original).toEqual(before);
  for (const side of sides) {
    const prior = before.outputs[side].warp.grid, grid = imported.outputs[side].warp.grid;
    expect({ ...grid, offsets: undefined }).toEqual({ ...prior, offsets: undefined });
    expect(grid.offsets).toEqual(Array.from({ length: prior.columns * prior.rows }, () => [0, 0]));
    expect(imported.outputs[side].warp.keystone.corners).toEqual([[0, 0], [1, 0], [0, 1], [1, 1]]);
  }
});

test.each([
  { columns: 3, rows: 2, columnPositions: [0, 0.5, 0.4], rowPositions: [0, 1] },
  { columns: 3, rows: 2, columnPositions: [0, 0.5, 1], rowPositions: [0.1, 1] },
  { columns: 3, rows: 2, columnPositions: [0, 1], rowPositions: [0, 1] },
  { columns: 3, rows: 2, columnPositions: [0, NaN, 1], rowPositions: [0, 1] },
])('rejects invalid editable axis overrides: %j', (grid) => {
  expect(() => prepareProjectionTdImport(target(), { left: asset('left') }, { sides: ['left'], grids: { left: grid } })).toThrow(/invalid editable grid/i);
});

test('byte-verified 24x18 TD capture with identity residuals matches independent samples and removes old corrections', async () => {
  const f = await projectionCatalog();
  const vertices = [], triangles = [], columns = 24, rows = 18;
  const expected = (s, t) => [0.06 + 0.73 * s + 0.04 * t, 0.02 + 0.05 * s + 0.86 * t];
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const s = c / (columns - 1), t = r / (rows - 1), [x, y] = expected(s, t); vertices.push({ s, t, x, y, u: s, v: t });
  }
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < columns - 1; c++) {
    const a = r * columns + c; triangles.push(a, a + 1, a + columns, a + columns, a + 1, a + columns + 1);
  }
  const mesh = { version: 1, type: 'tdMesh', side: 'left', width: 1920, height: 1080, origin: 'top-left', logicalGrid: { columns, rows }, vertices, triangles };
  const encoded = bytes(mesh), entry = { ...f.entries.selected.left, sha256: await sha256Hex(encoded), logicalGrid: mesh.logicalGrid };
  const manifest = structuredClone(f.manifestB); manifest.catalog.left = [entry];
  f.payloads.set(`${f.base}${entry.path}`, encoded);
  const original = target(), imported = prepareProjectionTdImport(original, { left: entry }, { sides: ['left'] });
  const trusted = await loadCapturedProjectionAsset({ fetchImpl: f.fetchImpl, base: f.base, spanId: 'left', captured: { manifest }, baseline: imported.outputs.left.warp.baseline });
  const rendered = createBaselineSampler(prepareProjectionSideMesh(imported, 'left', trusted).mesh);
  for (const [s, t] of [[0, 0], [1, 1], [0.137, 0.279], [0.413, 0.721], [0.831, 0.199]]) {
    const [x, y] = expected(s, t), point = rendered(s, t);
    expect(point.x).toBeCloseTo(x, 8); expect(point.y).toBeCloseTo(y, 8);
    const residual = evaluateWarpPoint(x, y, imported.outputs.left.warp, s, t, { side: 'left', schemaVersion: 7, mesh: trusted.mesh });
    expect(residual[0]).toBeCloseTo(x, 8); expect(residual[1]).toBeCloseTo(y, 8);
    const old = evaluateWarpPoint(x, y, original.outputs.left.warp, s, t, { side: 'left', schemaVersion: 7, mesh: trusted.mesh });
    expect(Math.abs(old[0] - x) + Math.abs(old[1] - y)).toBeGreaterThan(0.001);
  }
});
