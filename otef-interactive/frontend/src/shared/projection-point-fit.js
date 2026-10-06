import { createBaselineSampler } from './projection-baseline-sampler.js';
import { evaluateGridWarpPoint } from './projection-grid-mesh.js';
import { validateProjectionConfig } from './projection-config-schema.js';
import { SIDES } from './projection-warp-schema.js';
import { createIdentityProjectionMesh, evaluateWarpMesh,
  evaluateWarpPoint, invertRenderedMeshPoint, validateWarpMesh } from './projection-warp-geometry.js';

const WIDTH = 1920, HEIGHT = 1080;
const UNIT_CORNERS = [[0, 0], [1, 0], [0, 1], [1, 1]];
const DIFFERENCE = 1e-6;
const ADAPTIVE_BUDGET_MS = 2000;
const clone = value => structuredClone(value);
const finitePair = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
const fail = (reason, message) => Object.assign(new Error(message), { fitReason: reason });
const defaultYield = () => new Promise(resolve => setTimeout(resolve, 0));
const maximum = errors => Math.max(...errors.map(point => point.errorPx));

/** Pixel clicks are inverted in the acknowledged rendered mesh, never its UVs. */
export function pickProjectionLandmark({ evaluatedMesh, outputPointPx } = {}) {
  if (!finitePair(outputPointPx)) return { ok: false, reason: 'degenerate' };
  return invertRenderedMeshPoint(evaluatedMesh, { x: outputPointPx[0] / WIDTH, y: outputPointPx[1] / HEIGHT });
}

/** Measures any fit anchors or checkpoints in logical 1920x1080 pixels. */
export function measureProjectionLandmarks({ preparedMesh, anchors }) {
  const sample = createBaselineSampler(preparedMesh);
  return anchors.map(({ id, s, t, targetPx }) => {
    const point = sample(s, t);
    const renderedPx = [point.x * WIDTH, point.y * HEIGHT];
    return { id, renderedPx, targetPx: [...targetPx], errorPx: Math.hypot(renderedPx[0] - targetPx[0], renderedPx[1] - targetPx[1]) };
  });
}

// Scaled partial pivoting avoids depending on equation units. A weak pivot
// rejects the solve instead of producing a numerically unstable candidate.
function solve(matrix, values) {
  const rows = matrix.map((row, i) => [...row, values[i]]);
  const scales = matrix.map(row => Math.max(...row.map(Math.abs)));
  for (let column = 0; column < 8; column++) {
    let pivot = column;
    for (let row = column + 1; row < 8; row++) {
      if (Math.abs(rows[row][column]) / scales[row] > Math.abs(rows[pivot][column]) / scales[pivot]) pivot = row;
    }
    if (!scales[pivot] || Math.abs(rows[pivot][column]) / scales[pivot] < 1e-8) throw fail('conditioning', 'Landmarks do not determine a stable keystone. Choose four well-spaced points.');
    [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
    [scales[column], scales[pivot]] = [scales[pivot], scales[column]];
    for (let row = column + 1; row < 8; row++) {
      const ratio = rows[row][column] / rows[column][column];
      for (let k = column; k <= 8; k++) rows[row][k] -= ratio * rows[column][k];
    }
  }
  const result = Array(8).fill(0);
  for (let row = 7; row >= 0; row--) {
    let value = rows[row][8];
    for (let k = row + 1; k < 8; k++) value -= rows[row][k] * result[k];
    result[row] = value / rows[row][row];
  }
  if (!result.every(Number.isFinite)) throw fail('conditioning', 'Keystone solution is not finite.');
  return result;
}

function normalize(points) {
  const center = [0, 1].map(k => points.reduce((sum, p) => sum + p[k], 0) / points.length);
  const radius = Math.sqrt(points.reduce((sum, p) => sum + (p[0] - center[0]) ** 2 + (p[1] - center[1]) ** 2, 0) / points.length);
  if (radius < .025) throw fail('conditioning', 'Landmarks are too closely clustered. Choose points across the output.');
  const scale = Math.SQRT2 / radius;
  const to = p => p.map((v, k) => (v - center[k]) * scale);
  const from = p => p.map((v, k) => v / scale + center[k]);
  const normalized = points.map(to);
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    if (Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]) < .001) throw fail('conditioning', 'Landmarks are duplicated or too close together.');
    for (let k = j + 1; k < 4; k++) {
      const [a, b, c] = [normalized[i], normalized[j], normalized[k]];
      const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(area) < 1e-4) throw fail('conditioning', 'Three landmarks are nearly collinear. Choose four well-spaced points.');
    }
  }
  return { to, from, points: normalized };
}

function algebraicCorners(source, destination) {
  const a = normalize(source), b = normalize(destination), matrix = [], values = [];
  a.points.forEach(([x, y], i) => {
    const [u, v] = b.points[i];
    matrix.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); values.push(u);
    matrix.push([0, 0, 0, x, y, 1, -x * v, -y * v]); values.push(v);
  });
  const h = solve(matrix, values);
  return UNIT_CORNERS.map(p => {
    const [x, y] = a.to(p), denominator = h[6] * x + h[7] * y + 1;
    if (Math.abs(denominator) < 1e-9) throw fail('conditioning', 'Keystone solution has an invalid projective denominator.');
    return b.from([(h[0] * x + h[1] * y + h[2]) / denominator, (h[3] * x + h[4] * y + h[5]) / denominator]);
  });
}

function legacyTopology(source, warp, side) {
  const dimensions = SIDES[side], grid = warp.grid;
  if (grid.columns !== dimensions.columns || grid.rows !== dimensions.rows) return false;
  if (![grid.columnPositions, grid.rowPositions].every(axis => axis.every((v, i) => Math.abs(v - i / (axis.length - 1)) <= 1e-12))) return false;
  if (warp.baseline.type === 'identity') return true;
  const connected = new Set(source.triangles);
  return grid.rowPositions.every(t => grid.columnPositions.every(s => source.vertices.some((p, i) => connected.has(i) && Math.abs(p.s - s) <= 1e-12 && Math.abs(p.t - t) <= 1e-12)));
}

// Legacy rendering transforms baseline vertices, then interpolates triangles.
// Retain the exact containing triangles at the four landmarks for iteration;
// the whole final mesh still passes authoritative renderer validation.
function landmarkTriangles(source, anchors, sample) {
  const ids = [...new Set(anchors.map(p => sample(p.s, p.t).triangleId))];
  const vertices = [], triangles = [];
  for (const id of ids) {
    for (const vertexId of source.triangles.slice(id * 3, id * 3 + 3)) {
      triangles.push(vertices.length); vertices.push(source.vertices[vertexId]);
    }
  }
  return { ...source, vertices, triangles };
}

function fittingAnchors(anchors) {
  if (!Array.isArray(anchors) || anchors.length > 6) throw fail('input', 'Provide four recorded fit landmarks and at most two checkpoints.');
  const seen = new Set();
  for (const p of anchors) {
    if (!p || !Number.isInteger(p.id) || p.id < 1 || p.id > 6 || seen.has(p.id) ||
      !Number.isFinite(p.s) || !Number.isFinite(p.t) || p.s < 0 || p.s > 1 || p.t < 0 || p.t > 1 ||
      !finitePair(p.targetPx) || typeof p.recorded !== 'boolean') throw fail('input', 'Landmark coordinates, identifiers or capture state are invalid.');
    seen.add(p.id);
  }
  const fit = anchors.filter(p => p.id <= 4 && p.recorded).sort((a, b) => a.id - b.id);
  if (fit.length !== 4) throw fail('input', 'Record all four fit landmarks before fitting.');
  return fit.map(p => ({ ...p, targetPx: [Math.max(0, Math.min(WIDTH, p.targetPx[0])), Math.max(0, Math.min(HEIGHT, p.targetPx[1]))] }));
}

/** Fits all four s/t correspondences together, changing only one keystone.
 * baselineMesh is already trusted by the caller; this module never fetches it.
 * Cancellation and changed input snapshots always return a failure, no config.
 */
export async function fitProjectionKeystone({ config, output, baselineMesh = null, anchors,
  maxErrorPx = .5, signal, yieldControl = defaultYield } = {}) {
  try {
    if (signal?.aborted) throw fail('cancelled', 'Projection point fit cancelled.');
    if (!['left', 'right'].includes(output) || !config || config.schemaVersion !== 7 ||
      Object.keys(validateProjectionConfig(config)).length || !Number.isFinite(maxErrorPx) || maxErrorPx <= 0 || maxErrorPx > .5 || typeof yieldControl !== 'function') throw fail('input', 'Invalid projection fit configuration or tolerance.');
    const candidate = clone(config), warp = candidate.outputs[output].warp;
    if (!warp.enabled) throw fail('bypassed', 'Enable Grid Warp before fitting keystone landmarks.');
    const fit = fittingAnchors(clone(anchors));
    // Renderer preparation gets null for identity even if the caller retained
    // a TD asset. Analytic B/G sampling uses its own canonical identity source.
    const trusted = warp.baseline.type === 'tdMesh' ? baselineMesh : null;
    if (warp.baseline.type === 'tdMesh' && (!trusted || trusted.side !== output)) throw fail('mesh', 'Trusted projection baseline is missing or belongs to another output.');
    const source = trusted || createIdentityProjectionMesh({ side: output });
    validateWarpMesh(source);
    const sample = createBaselineSampler(source);
    normalize(fit.map(p => { const b = sample(p.s, p.t); return [b.x, b.y]; }));
    normalize(fit.map(p => [p.targetPx[0] / WIDTH, p.targetPx[1] / HEIGHT]));
    const inputIdentity = JSON.stringify([config, anchors]);
    const baselineIdentity = trusted ? JSON.stringify(trusted) : null;
    const check = () => {
      if (signal?.aborted) throw fail('cancelled', 'Projection point fit cancelled.');
      if (JSON.stringify([config, anchors]) !== inputIdentity || (trusted && JSON.stringify(trusted) !== baselineIdentity)) throw fail('stale', 'Projection fit inputs changed. Capture or fit again.');
    };
    const yieldAndCheck = async () => { await yieldControl(); check(); };
    const options = { side: output, schemaVersion: candidate.schemaVersion };
    const prepareActual = () => evaluateWarpMesh(trusted, warp, options);
    const stable = legacyTopology(source, warp, output);
    const subset = stable ? landmarkTriangles(source, fit, sample) : null;
    const started = performance.now();
    const checkBudget = () => {
      if (!stable && performance.now() - started > ADAPTIVE_BUDGET_MS) throw fail('performance', 'This adaptive baseline exceeds the two-second fitting budget. Fit fewer grid axes or use ordinary keystone editing.');
    };
    const evaluate = async () => {
      checkBudget();
      if (!stable) await yieldAndCheck();
      const mesh = stable ? validateWarpMesh({ ...subset, vertices: subset.vertices.map(p => {
        const [x, y] = evaluateWarpPoint(p.x, p.y, warp, p.s, p.t, options);
        return { ...p, x, y };
      }) }) : prepareActual();
      checkBudget();
      return measureProjectionLandmarks({ preparedMesh: mesh, anchors: fit });
    };
    // Preserve exact no-op geometry, including an existing perspective warp.
    let errors = await evaluate();
    if (maximum(errors) > maxErrorPx) {
      const identityWarp = clone(warp); identityWarp.keystone.corners = clone(UNIT_CORNERS);
      const bases = fit.map(p => sample(p.s, p.t));
      const targets = fit.map((p, i) => {
        const point = evaluateGridWarpPoint(source, identityWarp, p.s, p.t);
        return [p.targetPx[0] / WIDTH - (point[0] - bases[i].x), p.targetPx[1] / HEIGHT - (point[1] - bases[i].y)];
      });
      warp.keystone.corners = algebraicCorners(bases.map(p => [p.x, p.y]), targets);
      errors = await evaluate();
      for (let iteration = 0; maximum(errors) > maxErrorPx && iteration < 4; iteration++) {
        await yieldAndCheck();
        const current = warp.keystone.corners.flat();
        const residual = errors.flatMap((p, i) => [(fit[i].targetPx[0] - p.renderedPx[0]) / WIDTH, (fit[i].targetPx[1] - p.renderedPx[1]) / HEIGHT]);
        const jacobian = Array.from({ length: 8 }, () => Array(8));
        for (let component = 0; component < 8; component++) {
          const perturbed = [...current]; perturbed[component] += DIFFERENCE;
          warp.keystone.corners = UNIT_CORNERS.map((_, i) => perturbed.slice(i * 2, i * 2 + 2));
          const shifted = await evaluate();
          shifted.forEach((p, i) => {
            jacobian[i * 2][component] = (p.renderedPx[0] - errors[i].renderedPx[0]) / WIDTH / DIFFERENCE;
            jacobian[i * 2 + 1][component] = (p.renderedPx[1] - errors[i].renderedPx[1]) / HEIGHT / DIFFERENCE;
          });
        }
        const step = solve(jacobian, residual);
        let accepted = false;
        for (const scale of [1, .5, .25, .125]) {
          warp.keystone.corners = UNIT_CORNERS.map((_, i) => [0, 1].map(k => current[i * 2 + k] + scale * step[i * 2 + k]));
          try {
            const next = await evaluate();
            if (maximum(next) < maximum(errors)) { errors = next; accepted = true; break; }
          } catch (error) {
            if (error.fitReason) throw error;
            // Invalid geometry may still have a valid shorter Newton step.
          }
        }
        if (!accepted) throw fail('convergence', 'No safe keystone correction reduces all landmark errors.');
      }
    }
    if (maximum(errors) > maxErrorPx) throw fail('convergence', 'Keystone fit did not reach the requested pixel tolerance within four corrections.');
    check(); checkBudget();
    const finalMesh = prepareActual();
    check(); checkBudget();
    const finalErrors = measureProjectionLandmarks({ preparedMesh: finalMesh, anchors: fit });
    if (maximum(finalErrors) > maxErrorPx) throw fail('convergence', 'Final rendered keystone differs from the landmark fit.');
    return { ok: true, config: candidate, renderedErrorsPx: finalErrors.map(p => p.errorPx), maxRenderedErrorPx: maximum(finalErrors) };
  } catch (error) {
    return { ok: false, reason: error.fitReason || 'mesh', message: String(error?.message || 'Projection point fit unavailable.').slice(0, 240) };
  }
}
