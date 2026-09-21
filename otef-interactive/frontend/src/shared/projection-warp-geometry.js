import { SIDES, validateProjectionWarp } from './projection-warp-schema.js';

const EPSILON = 1e-9;
const AREA_EPSILON = 1e-5;
const RANGE_EPSILON = 1e-5;
const MIN = -1;
const MAX = 2;

function finite(value) { return typeof value === 'number' && Number.isFinite(value); }

function solve(matrix, values) {
  const a = matrix.map((row, index) => [...row, values[index]]);
  for (let column = 0; column < 8; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < 8; row += 1) if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    if (Math.abs(a[pivot][column]) <= EPSILON) throw new Error('keystone corners produce a singular homography');
    [a[column], a[pivot]] = [a[pivot], a[column]];
    for (let row = column + 1; row < 8; row += 1) {
      const factor = a[row][column] / a[column][column];
      for (let item = column; item <= 8; item += 1) a[row][item] -= factor * a[column][item];
    }
  }
  const x = Array(8).fill(0);
  for (let row = 7; row >= 0; row -= 1) {
    let value = a[row][8];
    for (let column = row + 1; column < 8; column += 1) value -= a[row][column] * x[column];
    x[row] = value / a[row][row];
  }
  return [...x, 1];
}

function homography(corners) {
  const source = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const matrix = [];
  const values = [];
  for (let index = 0; index < 4; index += 1) {
    const [x, y] = source[index];
    const [u, v] = corners[index];
    matrix.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); values.push(u);
    matrix.push([0, 0, 0, x, y, 1, -x * v, -y * v]); values.push(v);
  }
  return solve(matrix, values);
}

export function interpolateGridOffset(s, t, grid) {
  const columns = grid.columns;
  const rows = grid.rows;
  const x = Math.min(1, Math.max(0, s)) * (columns - 1);
  const y = Math.min(1, Math.max(0, t)) * (rows - 1);
  const x0 = Math.floor(x); const y0 = Math.floor(y);
  const x1 = Math.min(columns - 1, x0 + 1); const y1 = Math.min(rows - 1, y0 + 1);
  const fx = x - x0; const fy = y - y0;
  const at = (column, row) => grid.offsets[row * columns + column];
  const a = at(x0, y0); const b = at(x1, y0); const c = at(x0, y1); const d = at(x1, y1);
  return [
    (a[0] * (1 - fx) + b[0] * fx) * (1 - fy) + (c[0] * (1 - fx) + d[0] * fx) * fy,
    (a[1] * (1 - fx) + b[1] * fx) * (1 - fy) + (c[1] * (1 - fx) + d[1] * fx) * fy,
  ];
}

function sideForWarp(warp, fallback = 'left') { return warp?.side || (warp?.grid?.columns === 8 ? 'right' : fallback); }

function createEvaluator(warp) {
  const errors = validateProjectionWarp(warp, sideForWarp(warp));
  if (Object.keys(errors).length) throw new Error(`invalid warp: ${Object.entries(errors).map(([path, message]) => `${path} ${message}`).join('; ')}`);
  const h = homography(warp.keystone.corners);
  return (x, y, s = x, t = y) => {
    if (!finite(x) || !finite(y)) throw new Error('warp point must be finite');
    const denominator = h[6] * x + h[7] * y + h[8];
    if (!Number.isFinite(denominator) || Math.abs(denominator) <= EPSILON) throw new Error('keystone projective denominator is invalid');
    const point = [(h[0] * x + h[1] * y + h[2]) / denominator, (h[3] * x + h[4] * y + h[5]) / denominator];
    const offset = interpolateGridOffset(s, t, warp.grid);
    const result = [point[0] + offset[0], point[1] + offset[1]];
    if (!result.every((value) => Number.isFinite(value) && value >= MIN && value <= MAX)) throw new Error('warped point is outside safe extent [-1, 2]');
    return result;
  };
}

export function evaluateWarpPoint(x, y, warp, s = x, t = y) {
  return createEvaluator(warp)(x, y, s, t);
}

function meshError(mesh) {
  if (!mesh || mesh.width !== 1920 || mesh.height !== 1080) return 'projection mesh must be 1920x1080';
  if (!Array.isArray(mesh.vertices) || !Array.isArray(mesh.triangles) || mesh.vertices.length < 3 || mesh.triangles.length < 3 || mesh.triangles.length % 3) return 'projection mesh geometry is incomplete';
  for (let index = 0; index < mesh.vertices.length; index += 1) {
    const point = mesh.vertices[index];
    if (!point || !['s', 't', 'x', 'y', 'u', 'v'].every((key) => finite(point[key]))) return `projection mesh vertex ${index} is non-finite`;
    if (!['s', 't', 'u', 'v'].every((key) => point[key] >= -RANGE_EPSILON && point[key] <= 1 + RANGE_EPSILON)) return `projection mesh vertex ${index} has invalid parameter coordinates`;
    if (!['x', 'y'].every((key) => point[key] >= MIN - RANGE_EPSILON && point[key] <= MAX + RANGE_EPSILON)) return `projection mesh vertex ${index} is outside safe extent [-1, 2]`;
  }
  for (let index = 0; index < mesh.triangles.length; index += 3) {
    const indices = mesh.triangles.slice(index, index + 3);
    if (!indices.every((value) => Number.isInteger(value) && value >= 0 && value < mesh.vertices.length)) return `projection mesh triangle ${index / 3} has an invalid index`;
    const [a, b, c] = indices.map((value) => mesh.vertices[value]);
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (!(area > AREA_EPSILON)) return `projection mesh triangle ${index / 3} is inverted or degenerate`;
  }
  return null;
}

export function validateWarpMesh(mesh) {
  const error = meshError(mesh);
  if (error) throw new Error(error);
  return mesh;
}

export function createFullFrameProjectionMesh({ side = 'left' } = {}) {
  return {
    version: 1,
    type: 'tdMesh',
    side,
    width: 1920,
    height: 1080,
    origin: 'top-left',
    vertices: [
      { s: 0, t: 0, x: 0, y: 0, u: 0, v: 0 },
      { s: 1, t: 0, x: 1, y: 0, u: 1, v: 0 },
      { s: 0, t: 1, x: 0, y: 1, u: 0, v: 1 },
      { s: 1, t: 1, x: 1, y: 1, u: 1, v: 1 },
    ],
    triangles: [0, 1, 2, 2, 1, 3],
  };
}

export function createIdentityProjectionMesh({ side = 'left' } = {}) {
  const dimensions = SIDES[side];
  if (!dimensions) throw new Error('side must be left or right');
  const vertices = [];
  for (let row = 0; row < dimensions.rows; row += 1) {
    for (let column = 0; column < dimensions.columns; column += 1) {
      const s = column / (dimensions.columns - 1);
      const t = row / (dimensions.rows - 1);
      vertices.push({ s, t, x: s, y: t, u: s, v: t });
    }
  }
  const triangles = [];
  for (let row = 0; row < dimensions.rows - 1; row += 1) {
    for (let column = 0; column < dimensions.columns - 1; column += 1) {
      const a = row * dimensions.columns + column;
      const b = a + 1;
      const c = a + dimensions.columns;
      const d = c + 1;
      triangles.push(a, b, c, c, b, d);
    }
  }
  return { version: 1, type: 'tdMesh', side, width: 1920, height: 1080, origin: 'top-left', logicalGrid: dimensions, vertices, triangles };
}

export function evaluateWarpMesh(mesh, warp) {
  if (warp?.enabled === false) return validateWarpMesh(createFullFrameProjectionMesh({ side: mesh?.side || sideForWarp(warp) }));
  if (!mesh && warp?.baseline?.type === 'identity') mesh = createIdentityProjectionMesh({ side: sideForWarp(warp) });
  validateWarpMesh(mesh);
  const evaluate = createEvaluator(warp);
  const result = { ...mesh, vertices: mesh.vertices.map((point) => {
    const [x, y] = evaluate(point.x, point.y, point.s, point.t);
    return { ...point, x, y };
  }) };
  return validateWarpMesh(result);
}
