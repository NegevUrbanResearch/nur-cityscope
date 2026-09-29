import { expect, test } from 'vitest';
import { buildNamesWallLayout } from '../../frontend/src/shared/nli-name-wall-layout.js';
import { rectCoveredByPieces, ringContainsGuardedRect } from '../../frontend/src/shared/nli-name-wall-coverage.js';
import { DEFAULT_PROJECTION_CONFIG } from '../../frontend/src/shared/projection-config-schema.js';
import { createFullFrameProjectionMesh } from '../../frontend/src/shared/projection-warp-geometry.js';

const rectPiece = (x0, x1, y0 = 0, y1 = 80) => ({ polygon: [[x0,y0],[x1,y0],[x1,y1],[x0,y1]] });
const coverage = { pieces: { left: [rectPiece(0, 50)], right: [rectPiece(50, 100)] }, outputIdentities: { left: 'l', right: 'r' } };
const records = (ids = ['a', 'b', 'c']) => ids.map((pid) => ({ pid, name: `שם ${pid}`, orderKey: `שם ${pid}`,
  sourceCoordinates: [34.5, 31.4], location: 'בארי' }));
const metrics = (ids = ['a', 'b', 'c'], width = 8, sizes = [8]) => sizes.map((size) => [size,
  ids.map((pid) => [`שם ${pid}`, { width: width * size / 8, left: 0, right: width * size / 8,
    ascent: size * 7 / 8, descent: size * 2 / 8 }])]);
const namesWall = { activeMode: 'wall', innerEdgeInsetPx: { left: 0, right: 0 }, profiles: {
  wall: { requestedFontPx: 8, spacingPx: 2, edgeInsetPx: 0 },
  model: { requestedFontPx: 8, spacingPx: 2, edgeInsetPx: 0 },
} };
const payload = (overrides = {}) => ({ records: records(), metrics: metrics(), coverage, datasetVersion: 'v1',
  logicalPlane: { heading: 0, planeScale: 1 }, referenceZoom: 10, overviewBounds: [[34,31],[35,32]],
  configRevision: 4, namesWall: structuredClone(namesWall), ...overrides });

test('assigns whole names equally and ignores transport revision', async () => {
  const first = await buildNamesWallLayout(payload());
  const second = await buildNamesWallLayout(payload({ records: records(['c', 'a', 'b']), configRevision: 999 }));
  expect(first.diagnostics).toMatchObject({ state: 'valid', expected: 3, placed: 3, missing: 0, duplicate: 0,
    overlap: 0, left: 2, right: 1 });
  expect(first.placements.filter((p) => p.output === 'left').map((p) => p.id)).toEqual(['a', 'b']);
  expect(first.placements.filter((p) => p.output === 'right').map((p) => p.id)).toEqual(['c']);
  expect(first).not.toHaveProperty('drawPieces');
  expect(second.placements).toEqual(first.placements);
  expect(second.digest).toBe(first.digest);
  expect(first.geojson.features.map((feature) => feature.properties.visible_spans)).toEqual([['left'], ['left'], ['right']]);
  expect(first.byPid.size).toBe(3);
});

test('cold and prewarmed wall layouts have one digest despite originating mode and other profile', async () => {
  const cold = structuredClone(DEFAULT_PROJECTION_CONFIG);
  cold.namesWall.activeMode = 'wall';
  const prewarmed = structuredClone(cold);
  prewarmed.namesWall.activeMode = 'model';
  prewarmed.namesWall.profiles.model.requestedFontPx = 7;
  const wall = structuredClone(cold.namesWall);
  wall.profiles.wall.requestedFontPx = 8;
  const bounds = [[34, 31], [35, 32]];
  const first = await buildNamesWallLayout(payload({ namesWall: wall, geometry: { bounds, projectionConfig: cold } }));
  const second = await buildNamesWallLayout(payload({ namesWall: wall, geometry: { bounds, projectionConfig: prewarmed } }));
  expect(first.diagnostics.state).toBe('valid');
  expect(second.placements).toEqual(first.placements);
  expect(second.digest).toBe(first.digest);
});

test('regular pages split evenly while model fills safe spans in one ordered stream', async () => {
  const ids = ['a','b','c','d'];
  const asymmetric = { pieces: { left: [rectPiece(0, 50, 0, 160)], right: [rectPiece(50, 100)] },
    outputIdentities: coverage.outputIdentities };
  const input = payload({ records: records(ids), metrics: metrics(ids), coverage: asymmetric });
  const wall = await buildNamesWallLayout(input);
  const model = await buildNamesWallLayout({ ...input, namesWall: { ...input.namesWall, activeMode: 'model' },
    ring: [[0,0],[100,0],[100,160],[0,160],[0,0]], ringHash: 'square' });
  expect(wall.diagnostics.state).toBe('valid');
  expect(model.diagnostics.state).toBe('valid');
  expect(model).not.toHaveProperty('pages');
  expect(model.fontSize).toBe(wall.fontSize);
  expect(wall.diagnostics).toMatchObject({ left: 2, right: 2 });
  expect(model.diagnostics).toMatchObject({ left: 4, right: 0, placed: 4, missing: 0, duplicate: 0 });
  expect(model.placements.map((p) => p.id)).toEqual(ids);
  expect(model.placements.map((p) => p.output)).toEqual(['left', 'left', 'left', 'left']);
  expect(model.geojson.features.map((feature) => feature.properties.visible_spans)).toEqual([
    ['left'], ['left'], ['left'], ['left'],
  ]);
});

test('model digest captures ink offsets and stays stable under reversal and prewarming', async () => {
  const ids = ['a', 'b', 'c', 'd'];
  const wall = structuredClone(namesWall); wall.activeMode = 'model';
  const originConfig = structuredClone(DEFAULT_PROJECTION_CONFIG);
  originConfig.namesWall.activeMode = 'model';
  const input = payload({ records: records(ids), metrics: metrics(ids), namesWall: wall,
    config: originConfig,
    ring: [[0,0],[100,0],[100,80],[0,80],[0,0]], ringHash: 'digest-ink' });
  const first = await buildNamesWallLayout(input);
  const reversed = await buildNamesWallLayout({ ...input, records: records(ids).reverse() });
  const prewarmedConfig = structuredClone(DEFAULT_PROJECTION_CONFIG);
  prewarmedConfig.namesWall.activeMode = 'wall';
  const prewarmed = await buildNamesWallLayout({ ...input, config: prewarmedConfig });
  expect(reversed.digest).toBe(first.digest);
  expect(prewarmed.digest).toBe(first.digest);
  const horizontalMetrics = metrics(ids).map(([size, rows]) => [size, rows.map(([name, metric]) =>
    [name, { ...metric, left: 2, right: 6 }])]);
  const horizontal = await buildNamesWallLayout({ ...input, metrics: horizontalMetrics });
  expect(horizontal.placements[0].width).toBe(first.placements[0].width);
  expect(horizontal.placements[0].height).toBe(first.placements[0].height);
  expect(horizontal.placements[0].textOffsetX).not.toBe(first.placements[0].textOffsetX);
  expect(horizontal.digest).not.toBe(first.digest);
  const verticalMetrics = metrics(ids).map(([size, rows]) => [size, rows.map(([name, metric]) =>
    [name, { ...metric, ascent: 5, descent: 4 }])]);
  const vertical = await buildNamesWallLayout({ ...input, metrics: verticalMetrics });
  expect(vertical.placements[0].width).toBe(first.placements[0].width);
  expect(vertical.placements[0].height).toBe(first.placements[0].height);
  expect(vertical.placements[0].textOffsetY).not.toBe(first.placements[0].textOffsetY);
  expect(vertical.digest).not.toBe(first.digest);
  const regular = structuredClone(wall); regular.activeMode = 'wall';
  const wallFirst = await buildNamesWallLayout({ ...input, namesWall: regular });
  expect((await buildNamesWallLayout({ ...input, namesWall: regular })).digest).toBe(wallFirst.digest);
});

test('model waits for a wider later span without dropping the next long name', async () => {
  const ids = ['a', 'b', 'c'];
  const narrowFirst = { pieces: { left: [rectPiece(0, 60, 0, 40), rectPiece(70, 90, 0, 40)],
    right: [rectPiece(100, 160, 0, 40)] }, outputIdentities: coverage.outputIdentities };
  const measured = [[8, ids.map((id) => [`שם ${id}`, { width: id === 'a' ? 14 : 4,
    left: 0, right: id === 'a' ? 14 : 4, ascent: 7, descent: 2 }])]];
  const wall = structuredClone(namesWall); wall.activeMode = 'model';
  const result = await buildNamesWallLayout(payload({ records: records(ids), metrics: measured,
    coverage: narrowFirst, namesWall: wall,
    ring: [[0,0],[160,0],[160,40],[0,40],[0,0]], ringHash: 'wide-after-narrow' }));
  expect(result.diagnostics).toMatchObject({ state: 'valid', placed: 3, missing: 0, duplicate: 0,
    invalidCoverage: 0, overlap: 0 });
  expect(result.placements.map((p) => p.id)).toEqual(ids);
  expect(result.placements[0].output).toBe('left');
  expect(result.placements[0].x + result.placements[0].width / 2).toBeLessThanOrEqual(60);
  for (const p of result.placements) {
    expect(rectCoveredByPieces(p, narrowFirst.pieces[p.output])).toBe(true);
    expect(ringContainsGuardedRect([[0,0],[160,0],[160,40],[0,40],[0,0]], p)).toBe(true);
  }
});

test('model keeps the requested font when the full span can fit every name', async () => {
  const ids = ['a', 'b', 'c', 'd'];
  const oneRow = { pieces: { left: [rectPiece(0, 53, 0, 20)], right: [rectPiece(60, 113, 0, 20)] },
    outputIdentities: coverage.outputIdentities };
  const wall = structuredClone(namesWall); wall.activeMode = 'model';
  const result = await buildNamesWallLayout(payload({ records: records(ids),
    metrics: [...metrics(ids, 11, [8]), ...metrics(ids, 11, [7])], coverage: oneRow, namesWall: wall,
    ring: [[0,0],[113,0],[113,20],[0,20],[0,0]], ringHash: 'one-row' }));
  expect(result.diagnostics).toMatchObject({ state: 'valid', placed: 4, left: 2, right: 2,
    missing: 0, duplicate: 0, invalidCoverage: 0 });
  expect(result.fontSize).toBe(8);
  expect(result.placements.map((p) => p.id)).toEqual(ids);
});

test('model distributes each populated row across its full safe span', async () => {
  const ids = ['a', 'b', 'c', 'd'];
  const twoSpans = { pieces: { left: [rectPiece(0, 60, 0, 20)], right: [rectPiece(60, 120, 0, 20)] },
    outputIdentities: coverage.outputIdentities };
  const wall = structuredClone(namesWall); wall.activeMode = 'model';
  const result = await buildNamesWallLayout(payload({ records: records(ids), metrics: metrics(ids),
    coverage: twoSpans, namesWall: wall,
    ring: [[0,0],[120,0],[120,20],[0,20],[0,0]], ringHash: 'two-spans' }));
  expect(result.diagnostics).toMatchObject({ state: 'valid', placed: 4, left: 2, right: 2,
    invalidCoverage: 0, overlap: 0 });
  for (const side of ['left', 'right']) {
    const [first, second] = result.placements.filter((p) => p.output === side);
    expect(first.y).toBe(second.y);
    const [left, right] = side === 'left' ? [0, 60] : [60, 120];
    expect(first.x + first.width / 2).toBeCloseTo(right, 5);
    expect(second.x - second.width / 2).toBeCloseTo(left, 5);
    expect(first.x - first.width / 2 - (second.x + second.width / 2)).toBeGreaterThanOrEqual(2);
  }
});

test('model centers a single name in a safe span', async () => {
  const wall = structuredClone(namesWall); wall.activeMode = 'model';
  const result = await buildNamesWallLayout(payload({ records: records(['a']), metrics: metrics(['a']),
    namesWall: wall, ring: [[0,0],[100,0],[100,80],[0,80],[0,0]], ringHash: 'single' }));
  expect(result.diagnostics.state).toBe('valid');
  expect(result.placements).toHaveLength(1);
  expect(result.placements[0].x).toBeCloseTo(25, 5);
});

test('shrinks both outputs together below 8 px and never returns a partial field', async () => {
  const ids = ['a','b','c','d'];
  const narrow = { pieces: { left: [rectPiece(0, 35, 0, 28)], right: [rectPiece(50, 85, 0, 28)] },
    outputIdentities: coverage.outputIdentities };
  const input = payload({ records: records(ids), metrics: metrics(ids, 18, [1,2,3,4,5,6,7,8]), coverage: narrow });
  const result = await buildNamesWallLayout(input);
  expect(result.diagnostics.state).toBe('valid');
  expect(result.fontSize).toBeLessThan(8);
  expect(result.placements).toHaveLength(ids.length);
  const impossible = await buildNamesWallLayout({ ...input, coverage: { ...narrow,
    pieces: { left: [rectPiece(0, 3, 0, 3)], right: [rectPiece(50, 53, 0, 3)] } } });
  expect(impossible.diagnostics).toMatchObject({ state: 'invalid', placed: 0 });
  expect(impossible.placements).toEqual([]);
});

test('long Hebrew names stay whole, and missing metrics or duplicate IDs fail', async () => {
  const name = 'אביגיל בן דוד זכרונה לברכה';
  const row = { ...records(['a'])[0], name, orderKey: name };
  const long = await buildNamesWallLayout(payload({ records: [row], metrics: [[8, [[name,
    { width: 105, left: 105, right: 0, ascent: 7, descent: 1 }]]]] }));
  expect(long.diagnostics.state).toBe('invalid');
  expect(long.placements).toEqual([]);
  const missing = await buildNamesWallLayout(payload({ metrics: [[8, [['שם a', { width: 10, left: 0,
    right: 10, ascent: 7, descent: 1 }]]]] }));
  expect(missing.diagnostics.reason).toMatch(/missing font metrics/);
  const duplicate = await buildNamesWallLayout(payload({ records: records(['a', 'a']) }));
  expect(duplicate.diagnostics.duplicate).toBe(1);
});

test('full-height rows avoid a narrow hole, and every guarded rectangle is covered', async () => {
  const ids = ['a','b','c','d','e','f','g','h'];
  const holed = { pieces: { left: [rectPiece(0,50,0,30), rectPiece(0,24,30,34), rectPiece(26,50,30,34),
    rectPiece(0,50,34,80)], right: [rectPiece(50,100)] }, outputIdentities: coverage.outputIdentities };
  const result = await buildNamesWallLayout(payload({ coverage: holed, records: records(ids), metrics: metrics(ids) }));
  expect(result.diagnostics).toMatchObject({ state: 'valid', placed: 8, overlap: 0, invalidCoverage: 0 });
  for (const p of result.placements) expect(rectCoveredByPieces(p, holed.pieces[p.output])).toBe(true);
});

test('regular wall minimax spreads a sparse greedy tail over many rows', async () => {
  const ids = Array.from({ length: 66 }, (_, i) => String(i).padStart(2, '0'));
  const wide = { pieces: { left: [rectPiece(0, 100, 0, 200)], right: [rectPiece(100, 200, 0, 200)] },
    outputIdentities: coverage.outputIdentities };
  const result = await buildNamesWallLayout(payload({ records: records(ids), metrics: metrics(ids), coverage: wide }));
  expect(result.diagnostics.state).toBe('valid');
  expect(result.pages.left.rows).toBe(9);
  expect(result.pages.left.worstGap).toBeCloseTo(17, 6);
  const leftRows = [...Map.groupBy(result.placements.filter((p) => p.output === 'left'), (p) => p.y).values()];
  expect(leftRows.at(-1).length).toBeGreaterThanOrEqual(3);
});

test('regular wall minimax gap equals the best enumerated partition', async () => {
  const ids = Array.from({ length: 20 }, (_, i) => String(i).padStart(2, '0'));
  const widthByName = ids.map((id, i) => [`שם ${id}`, { width: 5 + i % 4, left: 0, right: 5 + i % 4,
    ascent: 7, descent: 2 }]);
  const wide = { pieces: { left: [rectPiece(0, 75, 0, 100)], right: [rectPiece(75, 150, 0, 100)] },
    outputIdentities: coverage.outputIdentities };
  const result = await buildNamesWallLayout(payload({ records: records(ids), metrics: [[8, widthByName]], coverage: wide }));
  expect(result.diagnostics.state).toBe('valid');
  const placed = result.placements.filter((p) => p.output === 'left');
  const page = result.pages.left, width = page.right - page.left, targetRows = page.rows;
  const best = (i, rows) => {
    if (!rows) return i === placed.length ? 0 : Infinity;
    let optimal = Infinity;
    for (let j = i + 2; j <= placed.length; j++) {
      const sum = placed.slice(i, j).reduce((total, p) => total + p.width, 0);
      if (sum + 2 * (j - i - 1) > width + 1e-7) break;
      optimal = Math.min(optimal, Math.max((width - sum) / (j - i - 1), best(j, rows - 1)));
    }
    return optimal;
  };
  expect(page.worstGap).toBeCloseTo(best(0, targetRows), 6);
});

test('regular wall skips a larger page whose ordered names cannot form legal pairs', async () => {
  const ids = Array.from({ length: 12 }, (_, i) => String(i).padStart(2, '0'));
  const metricRows = ids.map((id, i) => {
    const guarded = i % 6 === 5 ? 36 : 8, ink = guarded - 6;
    return [`שם ${id}`, { width: ink, left: ink / 2, right: ink / 2, ascent: 7, descent: 2 }];
  });
  const shaped = { pieces: { left: [rectPiece(0, 46, 0, 40), rectPiece(0, 40, 40, 60)],
    right: [rectPiece(50, 96, 0, 40), rectPiece(50, 90, 40, 60)] },
  outputIdentities: coverage.outputIdentities };
  const result = await buildNamesWallLayout(payload({ records: records(ids), metrics: [[8, metricRows]], coverage: shaped }));
  expect(result.diagnostics.state).toBe('valid');
  expect(result.pages.left.right - result.pages.left.left).toBeCloseTo(46, 6);
  expect(result.pages.left.rows).toBe(2);
});

test('model ring margin excludes notches and invalid rings fail', async () => {
  const ring = [[0,0],[100,0],[100,30],[60,30],[60,50],[100,50],[100,80],[0,80],[0,0]];
  const input = payload({ namesWall: { ...structuredClone(namesWall), activeMode: 'model',
    profiles: { ...structuredClone(namesWall.profiles), model: { requestedFontPx: 8, spacingPx: 2, edgeInsetPx: 2 } } },
    ring, ringHash: 'notch' });
  const result = await buildNamesWallLayout(input);
  expect(result.diagnostics.state).toBe('valid');
  for (const p of result.placements) expect(ringContainsGuardedRect(ring, p, 2)).toBe(true);
  const invalid = await buildNamesWallLayout({ ...input, ring: [[0,0],[100,80],[0,80],[100,0],[0,0]] });
  expect(invalid.diagnostics.reason).toMatch(/Tkuma ring/);
});

test('logical-plane heading and exact calibration contribute to content identity', async () => {
  const first = await buildNamesWallLayout(payload());
  const heading = await buildNamesWallLayout(payload({ logicalPlane: { heading: 17, planeScale: 1 } }));
  const identity = await buildNamesWallLayout(payload({ coverage: { ...coverage,
    outputIdentities: { left: 'other', right: 'r' } } }));
  expect(first.digest).not.toBe(heading.digest);
  expect(first.digest).not.toBe(identity.digest);
  expect(heading.logicalPlane).toEqual({ heading: 17, planeScale: 1 });
});

test('regular wall rows share fixed guarded page edges, including the last row', async () => {
  const ids = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const wide = { pieces: { left: [rectPiece(0, 100, 0, 100)], right: [rectPiece(100, 200, 0, 100)] },
    outputIdentities: coverage.outputIdentities };
  const result = await buildNamesWallLayout(payload({ records: records(ids), metrics: metrics(ids), coverage: wide }));
  expect(result.diagnostics.state).toBe('valid');
  for (const side of ['left', 'right']) {
    const rows = Map.groupBy(result.placements.filter((p) => p.output === side), (p) => p.y);
    expect(rows.size).toBeGreaterThan(1);
    const edges = [...rows.values()].map((row) => [Math.min(...row.map((p) => p.x - p.width / 2)),
      Math.max(...row.map((p) => p.x + p.width / 2))]);
    for (const row of rows.values()) expect(row.length).toBeGreaterThanOrEqual(2);
    for (const edge of edges) {
      expect(edge[0]).toBeCloseTo(edges[0][0], 6);
      expect(edge[1]).toBeCloseTo(edges[0][1], 6);
    }
  }
});

test('regular wall selects a shorter safe page and does not bridge a moving hole', async () => {
  const ids = Array.from({ length: 12 }, (_, i) => String(i).padStart(2, '0'));
  const left = [rectPiece(0, 100, 0, 25), rectPiece(0, 45, 25, 45),
    rectPiece(55, 100, 25, 45), rectPiece(0, 100, 45, 100)];
  const split = { pieces: { left, right: [rectPiece(100, 200, 0, 100)] },
    outputIdentities: coverage.outputIdentities };
  const result = await buildNamesWallLayout(payload({ records: records(ids), metrics: metrics(ids), coverage: split }));
  expect(result.diagnostics.state).toBe('valid');
  const chosen = result.pages.left;
  expect(chosen.y1 <= 25 || chosen.y0 >= 45).toBe(true);
  expect(rectCoveredByPieces({ x: (chosen.left + chosen.right) / 2, y: (chosen.y0 + chosen.y1) / 2,
    width: chosen.right - chosen.left, height: chosen.y1 - chosen.y0 }, left)).toBe(true);
});

test('regular wall single-name side is an explicit page-edge exception', async () => {
  const result = await buildNamesWallLayout(payload());
  expect(result.diagnostics.state).toBe('valid');
  expect(result.pages.right.singleton).toBe(true);
  expect(result.placements.filter((p) => p.output === 'right')).toHaveLength(1);
});

test('one regular-wall record leaves the unassigned right output empty', async () => {
  const result = await buildNamesWallLayout(payload({ records: records(['a']),
    metrics: metrics(['a'], 8, [1, 2, 3, 4, 5, 6, 7, 8]) }));
  expect(result.diagnostics).toMatchObject({ state: 'valid', expected: 1, placed: 1,
    missing: 0, duplicate: 0, left: 1, right: 0, invalidCoverage: 0 });
  expect(result.placements.map((p) => [p.id, p.output])).toEqual([['a', 'left']]);
  expect(rectCoveredByPieces(result.placements[0], coverage.pieces.left)).toBe(true);
  expect(result.pages.left.singleton).toBe(true);
  expect(result.pages.right).toBeNull();
  expect(result.placements[0].x - result.placements[0].width / 2).toBeGreaterThan(result.pages.left.left);
});

test('regular closeness moves only through safe inward slack at 0, 50 and 100 percent', async () => {
  const ids = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const wide = { pieces: { left: [rectPiece(0, 100, 0, 100)], right: [rectPiece(100, 200, 0, 100)] },
    outputIdentities: coverage.outputIdentities };
  const config = structuredClone(DEFAULT_PROJECTION_CONFIG);
  config.pre = { scale: 1, rotateDeg: 0, tx: 0, ty: 0 };
  for (const side of ['left', 'right']) {
    config.outputs[side].crop = { x0: 0, x1: 1, y0: 0, y1: 1 };
    config.outputs[side].post = { scale: 1, tx: 0, ty: 0 };
  }
  const meshes = Object.fromEntries(['left', 'right'].map((side) => {
    const mesh = createFullFrameProjectionMesh({ side });
    for (const vertex of mesh.vertices) vertex.x = vertex.u + (side === 'left' ? 0.3 : -0.3) * vertex.v;
    return [side, mesh];
  }));
  const run = (percent) => {
    const wall = structuredClone(config.namesWall);
    wall.profiles.wall = { requestedFontPx: 8, spacingPx: 2, edgeInsetPx: 0, inwardShiftPercent: percent };
    return buildNamesWallLayout(payload({ records: records(ids), metrics: metrics(ids), coverage: wide,
      namesWall: wall, meshes, geometry: { bounds: [[34, 31], [35, 32]], projectionConfig: config } }));
  };
  const [zero, half, full] = await Promise.all([run(0), run(50), run(100)]);
  for (const result of [zero, half, full]) expect(result.diagnostics).toMatchObject({ state: 'valid', placed: 24, invalidCoverage: 0, overlap: 0, left: 12, right: 12 });
  expect(new Set([zero.digest, half.digest, full.digest]).size).toBe(3);
  for (const side of ['left', 'right']) {
    const page = zero.pages[side];
    const pitch = (zero.placements.find((p) => p.output === side).height + 2);
    const slack = page.y1 - page.y0 - page.rows * pitch;
    expect(slack).toBeGreaterThan(0);
    expect(half.pages[side].left).toBe(page.left);
    expect(full.pages[side].right).toBe(page.right);
    const original = zero.placements.filter((p) => p.output === side);
    for (const [result, fraction] of [[half, 0.5], [full, 1]]) {
      const moved = result.placements.filter((p) => p.output === side);
      expect(moved.map((p) => [p.id, p.name, p.x, p.width, p.height])).toEqual(original.map((p) => [p.id, p.name, p.x, p.width, p.height]));
      moved.forEach((p, index) => expect(p.y - original[index].y).toBeCloseTo(slack * fraction, 6));
    }
  }
});
