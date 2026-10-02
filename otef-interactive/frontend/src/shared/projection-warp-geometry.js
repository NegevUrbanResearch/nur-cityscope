import { SIDES, validateProjectionWarp, validateProjectionWarpV7 } from './projection-warp-schema.js';
import { prepareGridWarpMesh, evaluateGridWarpPoint } from './projection-grid-mesh.js';
import { createBaselineSampler } from './projection-baseline-sampler.js';
import { relativeTriangleError } from './projection-relative-mesh.js';

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

function createEvaluator(warp, side = null, schemaVersion = null) {
  const resolvedSide = side || sideForWarp(warp);
  const errors = schemaVersion === 7 || Object.hasOwn(warp?.grid || {}, 'columnPositions') || Object.hasOwn(warp?.grid || {}, 'rowPositions')
    ? validateProjectionWarpV7(warp, side, {})
    : validateProjectionWarp(warp, resolvedSide);
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

/**
 * Evaluate one warp point. x/y are baseline destination coordinates; s/t are
 * source coordinates. V7 requires options.side, and options.schemaVersion=7
 * forces v7 validation even when axis arrays are missing. Disabled v7 warps
 * return [x, y]; enabled uniform grids use legacy geometry, while enabled
 * nonlegacy grids require options.mesh: the original trusted source baseline
 * used to prepare the render mesh, never a previously deformed mesh.
 */
export function evaluateWarpPoint(x, y, warp, s = x, t = y, options = {}) {
  const side = options.side || null;
  const schemaVersion = options.schemaVersion || null;
  let actual = warp;
  if (schemaVersion === 7 || Object.hasOwn(warp?.grid || {}, 'columnPositions') || Object.hasOwn(warp?.grid || {}, 'rowPositions')) {
    if (!side) throw new Error('v7 warp evaluation requires explicit side');
    const validation = validateProjectionWarpV7(warp, side);
    if (Object.keys(validation).length) throw new Error(`invalid warp: ${Object.entries(validation).map(([path, message]) => `${path} ${message}`).join('; ')}`);
    if (warp.enabled && !isLegacyV7Grid(warp.grid, side)) {
      if (!options.mesh) throw new Error('configurable grid point evaluation requires a trusted source mesh');
      return evaluateGridWarpPoint(options.mesh, warp, s, t);
    }
    actual = structuredClone(warp);
    if (actual.enabled === false) return [x, y];
    delete actual.grid.columnPositions;
    delete actual.grid.rowPositions;
  } else if (schemaVersion === 7) {
    throw new Error('v7 warp requires both axis arrays');
  }
  return createEvaluator(actual, side, null)(x, y, s, t);
}

function isLegacyV7Grid(grid, side) {
  const dimensions = SIDES[side];
  if (!dimensions || grid.columns !== dimensions.columns || grid.rows !== dimensions.rows) return false;
  return [[grid.columnPositions, grid.columns], [grid.rowPositions, grid.rows]].every(([axis, count]) =>
    axis.length === count && axis.every((value, index) => Math.abs(value - index / (count - 1)) <= 1e-12));
}

function hasGridControlVertices(mesh, grid) {
  if (!Array.isArray(mesh?.vertices) || !Array.isArray(mesh?.triangles)) return false;
  const connected = new Set(mesh.triangles);
  return grid.rowPositions.every((t) => grid.columnPositions.every((s) =>
    mesh.vertices.some((point, index) => connected.has(index) &&
      Math.abs(point.s - s) <= 1e-12 && Math.abs(point.t - t) <= 1e-12)));
}

function requiresGridPreparation(mesh, warp, side) {
  return !isLegacyV7Grid(warp.grid, side) ||
    (warp.baseline?.type === 'tdMesh' && !hasGridControlVertices(mesh, warp.grid));
}

function meshError(mesh) {
  if (!mesh || mesh.width !== 1920 || mesh.height !== 1080) return 'projection mesh must be 1920x1080';
  if (mesh.validationProfile !== undefined && mesh.validationProfile !== 'relative-source-v1') return 'projection mesh validation profile is unknown';
  if (!Array.isArray(mesh.vertices) || !Array.isArray(mesh.triangles) || mesh.vertices.length < 3 || mesh.triangles.length < 3 || mesh.triangles.length % 3) return 'projection mesh geometry is incomplete';
  if (mesh.vertices.length > 65536) return 'projection mesh exceeds unsigned-short vertex capacity';
  for (let index = 0; index < mesh.vertices.length; index += 1) {
    const point = mesh.vertices[index];
    if (!point || !['s', 't', 'x', 'y', 'u', 'v'].every((key) => finite(point[key]))) return `projection mesh vertex ${index} is non-finite`;
    if (!['s', 't', 'u', 'v'].every((key) => point[key] >= -RANGE_EPSILON && point[key] <= 1 + RANGE_EPSILON)) return `projection mesh vertex ${index} has invalid parameter coordinates`;
    if (!['x', 'y'].every((key) => point[key] >= MIN - RANGE_EPSILON && point[key] <= MAX + RANGE_EPSILON)) return `projection mesh vertex ${index} is outside safe extent [-1, 2]`;
  }
  for (let index = 0; index < mesh.triangles.length; index += 3) {
    const indices = mesh.triangles.slice(index, index + 3);
    if (!indices.every((value) => Number.isInteger(value) && value >= 0 && value <= 65535 && value < mesh.vertices.length)) return `projection mesh triangle ${index / 3} has an invalid index`;
    const [a, b, c] = indices.map((value) => mesh.vertices[value]);
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (mesh.validationProfile === 'relative-source-v1') {
      const relativeError = relativeTriangleError(a, b, c);
      if (relativeError === 'render') return 'render precision collapses or inverts a grid triangle';
      if (relativeError) return `projection mesh triangle ${index / 3} is inverted or degenerate`;
    } else if (!(area > AREA_EPSILON)) return `projection mesh triangle ${index / 3} is inverted or degenerate`;
  }
  if (mesh.validationProfile !== undefined && mesh.validationProfile !== 'relative-source-v1') return 'projection mesh validation profile is unknown';
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

export function evaluateWarpMesh(mesh, warp, { side = null, schemaVersion = null } = {}) {
  const hasAxes = Object.hasOwn(warp?.grid || {}, 'columnPositions') || Object.hasOwn(warp?.grid || {}, 'rowPositions');
  const isV7 = schemaVersion === 7 || hasAxes;
  const resolvedSide = side || (isV7 ? null : mesh?.side || sideForWarp(warp));
  let sourceValidated = false;
  if (isV7) {
    if (!resolvedSide) throw new Error('v7 warp evaluation requires explicit side');
    const errors = validateProjectionWarpV7(warp, resolvedSide);
    if (Object.keys(errors).length) throw new Error(`invalid warp: ${Object.entries(errors).map(([path, message]) => `${path} ${message}`).join('; ')}`);
    if (warp.enabled === false) return validateWarpMesh(createFullFrameProjectionMesh({ side: resolvedSide }));
    if (mesh) { validateWarpMesh(mesh); sourceValidated = true; }
    if (requiresGridPreparation(mesh, warp, resolvedSide)) {
      if (!mesh && warp.baseline?.type === 'identity') mesh = createFullFrameProjectionMesh({ side: resolvedSide });
      return validateWarpMesh(prepareGridWarpMesh(mesh, warp, { side: resolvedSide }));
    }
    warp = structuredClone(warp);
    delete warp.grid.columnPositions;
    delete warp.grid.rowPositions;
  } else if (schemaVersion === 7) {
    throw new Error('v7 warp requires both axis arrays');
  }
  if (warp?.enabled === false) return validateWarpMesh(createFullFrameProjectionMesh({ side: resolvedSide || mesh?.side || sideForWarp(warp) }));
  if (!mesh && warp?.baseline?.type === 'identity') mesh = createIdentityProjectionMesh({ side: resolvedSide || sideForWarp(warp) });
  if (!sourceValidated) validateWarpMesh(mesh);
  const evaluate = createEvaluator(warp, resolvedSide);
  const result = { ...mesh, vertices: mesh.vertices.map((point) => {
    const [x, y] = evaluate(point.x, point.y, point.s, point.t);
    return { ...point, x, y };
  }) };
  return validateWarpMesh(result);
}

/** Compare two prepared layouts at deterministic source samples in 1920x1080 pixels.
 * This reports a sampled difference, not a continuous error bound.
 */
export function compareRenderedLayouts(baselineMesh, oldWarp, newWarp, { side } = {}) {
  if (!side) throw new Error('rendered layout comparison requires explicit side');
  const oldMesh=evaluateWarpMesh(baselineMesh,oldWarp,{side,schemaVersion:7});
  const newMesh=evaluateWarpMesh(baselineMesh,newWarp,{side,schemaVersion:7});
  const oldSample=createBaselineSampler(oldMesh),newSample=createBaselineSampler(newMesh),xs=new Set([0,1]),ys=new Set([0,1]);
  for(const warp of [oldWarp,newWarp]){for(const x of warp.grid.columnPositions)xs.add(x);for(const y of warp.grid.rowPositions)ys.add(y);}
  const xAxis=[...xs].sort((a,b)=>a-b),yAxis=[...ys].sort((a,b)=>a-b),points=[];
  for(let y=0;y<=32;y++)for(let x=0;x<=32;x++)points.push([x/32,y/32]);
  for(const t of yAxis)for(const s of xAxis)points.push([s,t]);
  for(let r=0;r<yAxis.length-1;r++)for(let c=0;c<xAxis.length-1;c++){const x0=xAxis[c],x1=xAxis[c+1],y0=yAxis[r],y1=yAxis[r+1];points.push([(x0+x1)/2,(y0+y1)/2],[(3*x0+x1)/4,(3*y0+y1)/4],[(x0+3*x1)/4,(3*y0+y1)/4],[(3*x0+x1)/4,(y0+3*y1)/4],[(x0+3*x1)/4,(y0+3*y1)/4]);}
  let maximumDifferencePx=0,maximumSample=null;
  for(const [s,t] of points){const a=oldSample(s,t),b=newSample(s,t),differencePx=Math.hypot((a.x-b.x)*1920,(a.y-b.y)*1080);if(differencePx>maximumDifferencePx){maximumDifferencePx=differencePx;maximumSample={s,t};}}
  return {maximumDifferencePx,maximumSample,sampleCount:points.length,comparison:'sampled-only'};
}
