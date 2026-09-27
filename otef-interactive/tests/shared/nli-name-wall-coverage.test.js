import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_PROJECTION_CONFIG } from '../../frontend/src/shared/projection-config-schema.js';
import { createFullFrameProjectionMesh, evaluateWarpMesh } from '../../frontend/src/shared/projection-warp-geometry.js';
import { migrateProjectionConfigToV2 } from '../../frontend/src/shared/projection-warp-schema.js';
import { outputToT3, planeToOutputUv } from '../../frontend/src/shared/projection-config-geometry.js';
import { evaluateNameWallCoverage, nameWallRowSpans, rectCoveredByPieces, ringContainsGuardedRect } from '../../frontend/src/shared/nli-name-wall-coverage.js';

test('row spans exclude a hole that moves through the band', () => {
  const coverage = { pieces: { left: [
    { polygon: [[-5,0],[0,0],[3,10],[-5,10]] },
    { polygon: [[1,0],[8,0],[8,10],[4,10]] },
  ], right: [] } };
  const spans = nameWallRowSpans(coverage, {
    output: 'left', y0: 0, y1: 10, inset: 0, ring: null,
  });
  expect(spans).toEqual([[-5,0],[4,8]]);
  expect(spans.some(([a,b]) => a <= 2 && 2 <= b)).toBe(false);
});

test('each final-output inner inset clips its own safe plane polygons', () => {
  const config = structuredClone(simpleConfig);
  config.namesWall.innerEdgeInsetPx = { left: 480, right: 240 };
  const result = coverage({ config });
  expect(Math.max(...result.pieces.left.flatMap((piece) => piece.polygon.map(([x]) => x)))).toBeCloseTo(480);
  expect(Math.min(...result.pieces.right.flatMap((piece) => piece.polygon.map(([x]) => x)))).toBeCloseTo(-720);
  expect(result).not.toHaveProperty('ownership');
  expect(result).not.toHaveProperty('seamBands');
});

test('band intersection keeps overlapping fragments as one union without filling a moving strip', () => {
  const pieces = { left: [
    { polygon: [[-5,0],[0,0],[3,10],[-5,10]] },
    { polygon: [[-4,0],[0.5,0],[3.5,10],[-4,10]] },
    { polygon: [[1,0],[8,0],[8,10],[4,10]] },
  ], right: [] };
  const spans = nameWallRowSpans({ pieces }, { output: 'left', y0: 0, y1: 10, inset: 0 });
  expect(spans[0][0]).toBe(-5);
  expect(spans[0][1]).toBeCloseTo(0.5);
  expect(spans[1]).toEqual([4,8]);
  expect(spans.some(([a,b]) => a <= 2 && b >= 2)).toBe(false);
});

const simpleConfig = structuredClone(DEFAULT_PROJECTION_CONFIG);
simpleConfig.pre = { scale: 1, rotateDeg: 0, tx: 0, ty: 0 };
for (const side of ['left', 'right']) simpleConfig.outputs[side] = { ...simpleConfig.outputs[side], crop: { x0: 0, x1: 1, y0: 0, y1: 1 }, post: { scale: 1, tx: 0, ty: 0 } };
const full = (side) => createFullFrameProjectionMesh({ side });
const coverage = (options = {}) => evaluateNameWallCoverage({ config: simpleConfig, meshes: { left: full('left'), right: full('right') }, logicalPlane: { heading: 0, planeScale: 1 }, ...options });

test('clips destination mesh on all four sides and maps sampled UV into the logical plane', () => {
  const mesh = full('left');
  mesh.vertices = mesh.vertices.map((v) => ({ ...v, x: v.x * 1.4 - 0.2, y: v.y * 1.4 - 0.2 }));
  const result = coverage({ meshes: { left: mesh, right: full('right') }, compositorClips: { left: [0.25, 0.25, 0.75, 0.75], right: [0, 0, 1, 1] } });
  const points = result.pieces.left.flatMap((piece) => piece.polygon);
  expect(Math.min(...points.map((p) => p[0]))).toBeCloseTo(-480);
  expect(Math.max(...points.map((p) => p[0]))).toBeCloseTo(480);
  expect(Math.min(...points.map((p) => p[1]))).toBeCloseTo(-270);
  expect(Math.max(...points.map((p) => p[1]))).toBeCloseTo(270);
});

test('default −50 degree pre-rotation, 41 degree heading, and asymmetric camera match the inverse name renderer map', () => {
  const result = evaluateNameWallCoverage({ config: DEFAULT_PROJECTION_CONFIG, meshes: { left: full('left'), right: full('right') } });
  const t3 = outputToT3({ u: 0.5, v: 0.5 }, DEFAULT_PROJECTION_CONFIG.outputs.left);
  const pre = DEFAULT_PROJECTION_CONFIG.pre;
  const rotate = ([x, y], degrees) => {
    const angle = degrees * Math.PI / 180;
    return [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
  };
  const scaled = [(t3.u - 0.5) * 1920 / pre.scale, (t3.v - 0.5) * 1080 / pre.scale];
  const translated = rotate(scaled, pre.rotateDeg);
  const headed = [translated[0] - pre.tx * 1920, translated[1] - pre.ty * 1080];
  const planeScale = pre.scale * Math.min(DEFAULT_PROJECTION_CONFIG.outputs.left.post.scale, DEFAULT_PROJECTION_CONFIG.outputs.right.post.scale);
  const known = rotate(headed, -41).map((v) => v * planeScale);
  const mapped = planeToOutputUv(known, DEFAULT_PROJECTION_CONFIG, 'left');
  const inverse = planeToOutputUv(known, DEFAULT_PROJECTION_CONFIG, 'right');
  expect(mapped.u).toBeCloseTo(0.5, 1);
  expect(mapped.v).toBeCloseTo(0.5, 1);
  expect(inverse.u).not.toBeCloseTo(mapped.u, 1);
  expect(result.pieces.left.some((piece) => piece.bounds.x0 < known[0] && piece.bounds.x1 > known[0] && piece.bounds.y0 < known[1] && piece.bounds.y1 > known[1])).toBe(true);
});

test('captured TD meshes map to pinned reference-plane polygons for both outputs', () => {
  const read = (name) => JSON.parse(readFileSync(new URL(`../../public/projection-calibration/${name}`, import.meta.url), 'utf8'));
  const config = migrateProjectionConfigToV2(read('td-source-config.json'));
  const meshes = Object.fromEntries(['left', 'right'].map((side) => [side,
    evaluateWarpMesh(read(`td-baselines/${side}.json`), config.outputs[side].warp)]));
  const result = evaluateNameWallCoverage({ config, meshes });
  const expected = {
    left: [[462.384073, 1239.617605], [463.513980, 1238.006555], [463.692675, 1239.517609]],
    right: [[324.871022, 67.692531], [311.960878, 69.798249], [311.888784, 65.667992], [324.515388, 65.447593]],
  };
  for (const side of ['left', 'right']) {
    expect(result.pieces[side][0].polygon).toHaveLength(expected[side].length);
    result.pieces[side][0].polygon.forEach((point, i) => point.forEach((value, j) => expect(value).toBeCloseTo(expected[side][i][j], 4)));
  }
});

test('missing or non-finite evaluated mesh fails coverage preparation', () => {
  expect(() => coverage({ meshes: { left: full('left') } })).toThrow(/missing right/);
  const bad = full('left'); bad.vertices[0].u = Number.NaN;
  expect(() => coverage({ meshes: { left: bad, right: full('right') } })).toThrow(/non-finite/);
});

test('uses renderer destination winding: reversed indices and true inversion both fail', () => {
  const reversed = full('left');
  reversed.triangles = reversed.triangles.flatMap((_, i) => i % 3 === 0 ? [reversed.triangles[i + 2], reversed.triangles[i + 1], reversed.triangles[i]] : []);
  expect(() => coverage({ meshes: { left: reversed, right: full('right') } })).toThrow(/inverted|degenerate/);
  const inverted = full('left');
  inverted.vertices[1].x = -1;
  expect(() => coverage({ meshes: { left: inverted, right: full('right') } })).toThrow(/inverted|degenerate/);
});

test('a complete center-based rectangle is covered across touching pieces, but a real gap fails', () => {
  const pieces = [
    { polygon: [[0, 0], [5, 0], [5, 10], [0, 10]] },
    { polygon: [[5, 0], [10, 0], [10, 10], [5, 10]] },
  ];
  expect(rectCoveredByPieces({ x: 5, y: 5, width: 8, height: 8 }, pieces)).toBe(true);
  pieces[1].polygon = [[5.1, 0], [10, 0], [10, 10], [5.1, 10]];
  expect(rectCoveredByPieces({ x: 5, y: 5, width: 8, height: 8 }, pieces)).toBe(false);
});

test('exact coverage keeps crossings and disjoint edge spans distinct', () => {
  const stripe = (x0, x1, y0, y1) => ({ polygon: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
  const pieces = Array.from({ length: 20 }, (_, index) => stripe(0, 10, index * 5, (index + 1) * 5));
  expect(rectCoveredByPieces({ x: 5, y: 50, width: 8, height: 100 }, pieces)).toBe(true);
  expect(rectCoveredByPieces({ x: 5, y: 50, width: 8, height: 100 }, pieces.filter((_, index) => index !== 10))).toBe(false);
  const crossing = [
    { polygon: [[0, 0], [10, 0], [10, 10]] },
    { polygon: [[0, 0], [10, 10], [0, 10]] },
  ];
  expect(rectCoveredByPieces({ x: 5, y: 5, width: 8, height: 8 }, crossing)).toBe(true);
});

test('disjoint slanted ownership covers a complete row while a narrow interior hole does not', () => {
  const left = { polygon: [[0, 0], [5, 0], [7, 10], [0, 10]] };
  const right = { polygon: [[5, 0], [10, 0], [10, 10], [7, 10]] };
  const rect = { x: 5, y: 5, width: 8, height: 8 };
  expect(rectCoveredByPieces(rect, [left, right])).toBe(true);
  const gappedRight = { polygon: [[5.1, 0], [10, 0], [10, 10], [7.1, 10]] };
  expect(rectCoveredByPieces(rect, [left, gappedRight])).toBe(false);
  const surrounding = [
    { polygon: [[0, 0], [10, 0], [10, 4], [0, 4]] },
    { polygon: [[0, 6], [10, 6], [10, 10], [0, 10]] },
    { polygon: [[0, 4], [4, 4], [4, 6], [0, 6]] },
    { polygon: [[6, 4], [10, 4], [10, 6], [6, 6]] },
  ];
  expect(rectCoveredByPieces(rect, surrounding)).toBe(false);
});

test('canonical-style concave notch excludes guarded rectangles even when corners are inside', () => {
  const ring = [[0, 0], [10, 0], [10, 4], [6, 4], [6, 6], [10, 6], [10, 10], [0, 10], [0, 0]];
  expect(ringContainsGuardedRect(ring, { x: 5, y: 5, width: 8, height: 8 }, 0)).toBe(false);
  expect(ringContainsGuardedRect(ring, { x: 2, y: 5, width: 2, height: 8 }, 0)).toBe(true);
});

test('model containment rejects a self-intersecting or open canonical ring', () => {
  const rect = { x: 5, y: 5, width: 1, height: 1 };
  expect(ringContainsGuardedRect([[0, 0], [10, 10], [0, 10], [10, 0], [0, 0]], rect)).toBe(false);
  expect(ringContainsGuardedRect([[0, 0], [10, 0], [10, 10], [0, 10]], rect)).toBe(false);
});

test('model containment rejects nonadjacent vertex contact and collinear overlap', () => {
  const rect = { x: 7, y: 3, width: 1, height: 1 };
  expect(ringContainsGuardedRect([[0, 0], [10, 0], [10, 10], [5, 5], [0, 10], [5, 5], [0, 0]], rect)).toBe(false);
  expect(ringContainsGuardedRect([[0, 0], [10, 0], [10, 10], [0, 10], [5, 10], [5, 0], [0, 0]], rect)).toBe(false);
});

test('exact coverage retains tiny positive-area clipped fragments but still rejects a real hole', () => {
  const rect = { x: 0.55, y: 0.54995, width: 0.1, height: 0.1001 };
  const complete = [
    { polygon: [[0, 0], [1, 0], [0, 1]] },
    { polygon: [[1, 0], [1, 1], [0, 1]] },
  ];
  expect(rectCoveredByPieces(rect, complete)).toBe(true);
  const hole = [
    { polygon: [[0, 0], [0.49995, 0], [0.49995, 1], [0, 1]] },
    { polygon: [[0.50005, 0], [1, 0], [1, 1], [0.50005, 1]] },
  ];
  expect(rectCoveredByPieces({ x: 0.5, y: 0.5, width: 0.2, height: 0.2 }, hole)).toBe(false);
});
