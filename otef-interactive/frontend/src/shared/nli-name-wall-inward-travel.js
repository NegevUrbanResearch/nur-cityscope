import { planeToOutputUv } from './projection-config-geometry.js';

const EPS = 1e-10;
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];

function triangleAt(point, mesh) {
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const [a, b, c] = mesh.triangles.slice(i, i + 3).map((index) => mesh.vertices[index]);
    const origin = [a.u, a.v], ab = [b.u - a.u, b.v - a.v], ac = [c.u - a.u, c.v - a.v];
    const denominator = cross(ab, ac);
    if (Math.abs(denominator) <= EPS) continue;
    const relative = subtract(point, origin);
    const bWeight = cross(relative, ac) / denominator, cWeight = cross(ab, relative) / denominator;
    if (bWeight >= -EPS && cWeight >= -EPS && bWeight + cWeight <= 1 + EPS) return [a, b, c];
  }
  return null;
}

function projectedX(point, triangle) {
  const [a, b, c] = triangle;
  const ab = [b.u - a.u, b.v - a.v], ac = [c.u - a.u, c.v - a.v];
  const relative = subtract(point, [a.u, a.v]), denominator = cross(ab, ac);
  const bWeight = cross(relative, ac) / denominator, cWeight = cross(ab, relative) / denominator;
  return a.x + bWeight * (b.x - a.x) + cWeight * (c.x - a.x);
}

/** Largest connected inward shift from the current row origin through evaluated mesh triangles. */
export function inwardPageTravel({ page, occupiedRows, pitch, output, config, mesh, logicalPlane }) {
  const slack = Math.max(0, page.y1 - page.y0 - occupiedRows * pitch);
  if (!slack || !mesh?.triangles?.length || !config) return 0;
  const x = (page.left + page.right) / 2;
  const first = planeToOutputUv([x, page.y0 + occupiedRows * pitch / 2], config, output, logicalPlane);
  const last = planeToOutputUv([x, page.y0 + occupiedRows * pitch / 2 + slack], config, output, logicalPlane);
  const start = [first.u, first.v], end = [last.u, last.v], direction = subtract(end, start);
  const points = [0, 1];
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const triangle = mesh.triangles.slice(i, i + 3).map((index) => mesh.vertices[index]);
    for (let edge = 0; edge < 3; edge++) {
      const a = [triangle[edge].u, triangle[edge].v];
      const b = [triangle[(edge + 1) % 3].u, triangle[(edge + 1) % 3].v];
      const segment = subtract(b, a), denominator = cross(direction, segment);
      if (Math.abs(denominator) <= EPS) continue;
      const relative = subtract(a, start);
      const t = cross(relative, segment) / denominator, s = cross(relative, direction) / denominator;
      if (t > EPS && t < 1 - EPS && s >= -EPS && s <= 1 + EPS) points.push(t);
    }
  }
  points.sort((a, b) => a - b);
  const inward = output === 'left' ? 1 : -1;
  for (let i = 0; i < points.length - 1; i++) {
    const t0 = points[i], t1 = points[i + 1];
    if (t1 - t0 <= EPS) continue;
    const sample = start.map((value, index) => value + direction[index] * (t0 + t1) / 2);
    const triangle = triangleAt(sample, mesh);
    if (!triangle) return t0 * slack;
    const at = (t) => start.map((value, index) => value + direction[index] * t);
    if ((projectedX(at(t1), triangle) - projectedX(at(t0), triangle)) * inward <= EPS) return t0 * slack;
  }
  return slack;
}
