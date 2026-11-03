const BIN_COUNT = 64;
const BARYCENTRIC_TOLERANCE = 1e-12;
const SOURCE_BOUND_TOLERANCE = BARYCENTRIC_TOLERANCE * 2;
const samplerCache = new WeakMap();

export function fingerprintBaselineMesh(mesh) {
  const sourceVertices = mesh?.vertices;
  const triangleIndices = mesh?.triangles;
  if (!Array.isArray(sourceVertices) || !Array.isArray(triangleIndices)) return null;
  const vertices = sourceVertices.map((point) => ['s', 't', 'x', 'y', 'u', 'v'].map((key) => point?.[key]));
  return JSON.stringify([vertices, triangleIndices]);
}

function finite(value, label) {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

function barycentric(point, a, b, c) {
  const abS = b.s - a.s;
  const abT = b.t - a.t;
  const acS = c.s - a.s;
  const acT = c.t - a.t;
  const area = abS * acT - abT * acS;
  const as = point.s - a.s;
  const at = point.t - a.t;
  const wa = ((b.s - point.s) * (c.t - point.t) - (b.t - point.t) * (c.s - point.s)) / area;
  const wb = (as * acT - at * acS) / area;
  const wc = 1 - wa - wb;
  if (wa < -BARYCENTRIC_TOLERANCE || wb < -BARYCENTRIC_TOLERANCE || wc < -BARYCENTRIC_TOLERANCE ||
      wa > 1 + BARYCENTRIC_TOLERANCE || wb > 1 + BARYCENTRIC_TOLERANCE || wc > 1 + BARYCENTRIC_TOLERANCE) return null;
  const weights = [wa, wb, wc].map((weight) => {
    if (Math.abs(weight) <= BARYCENTRIC_TOLERANCE) return 0;
    if (Math.abs(weight - 1) <= BARYCENTRIC_TOLERANCE) return 1;
    return weight;
  });
  const total = weights[0] + weights[1] + weights[2];
  return weights.map((weight) => weight / total);
}

function buildIndex(mesh) {
  if (!mesh || typeof mesh !== 'object' || !Array.isArray(mesh.vertices) || !Array.isArray(mesh.triangles) || mesh.triangles.length % 3 !== 0) {
    throw new TypeError('baseline mesh must contain vertices and triangle indices');
  }
  const vertices = mesh.vertices;
  for (const [index, vertex] of vertices.entries()) {
    for (const key of ['s', 't', 'x', 'y', 'u', 'v']) finite(vertex?.[key], `vertex ${index}.${key}`);
  }
  const bins = Array.from({ length: BIN_COUNT * BIN_COUNT }, () => []);
  const triangles = [];
  for (let id = 0; id < mesh.triangles.length / 3; id += 1) {
    const ids = mesh.triangles.slice(id * 3, id * 3 + 3);
    if (!ids.every((value) => Number.isInteger(value) && value >= 0 && value < vertices.length)) throw new RangeError(`baseline triangle ${id} has an invalid vertex index`);
    const points = ids.map((vertexId) => vertices[vertexId]);
    const area = (points[1].s - points[0].s) * (points[2].t - points[0].t) - (points[1].t - points[0].t) * (points[2].s - points[0].s);
    if (!(area > 0) || !Number.isFinite(area)) throw new RangeError(`baseline triangle ${id} must have positive source orientation`);
    const triangle = { id, points };
    triangles.push(triangle);
    const rawMinS = Math.min(...points.map((point) => point.s));
    const rawMaxS = Math.max(...points.map((point) => point.s));
    const rawMinT = Math.min(...points.map((point) => point.t));
    const rawMaxT = Math.max(...points.map((point) => point.t));
    const minS = Math.max(0, rawMinS - SOURCE_BOUND_TOLERANCE * Math.max(1, rawMaxS - rawMinS));
    const maxS = Math.min(1, rawMaxS + SOURCE_BOUND_TOLERANCE * Math.max(1, rawMaxS - rawMinS));
    const minT = Math.max(0, rawMinT - SOURCE_BOUND_TOLERANCE * Math.max(1, rawMaxT - rawMinT));
    const maxT = Math.min(1, rawMaxT + SOURCE_BOUND_TOLERANCE * Math.max(1, rawMaxT - rawMinT));
    if (minS > maxS || minT > maxT) continue;
    const x0 = Math.min(BIN_COUNT - 1, Math.floor(minS * BIN_COUNT));
    const x1 = Math.min(BIN_COUNT - 1, Math.floor(maxS * BIN_COUNT));
    const y0 = Math.min(BIN_COUNT - 1, Math.floor(minT * BIN_COUNT));
    const y1 = Math.min(BIN_COUNT - 1, Math.floor(maxT * BIN_COUNT));
    for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) bins[y * BIN_COUNT + x].push(id);
  }
  return { vertices, triangles, bins };
}

export function createBaselineSampler(mesh, { fingerprint = null } = {}) {
  if (!mesh || typeof mesh !== 'object') throw new TypeError('baseline mesh must be an object');
  const sourceFingerprint = fingerprint ?? fingerprintBaselineMesh(mesh);
  let cached = samplerCache.get(mesh);
  if (!cached || cached.fingerprint !== sourceFingerprint) {
    cached = { fingerprint: sourceFingerprint, index: buildIndex(mesh) };
    samplerCache.set(mesh, cached);
  }
  const { index } = cached;
  // An explicit triangle ID forces one provenance region and errors if the
  // point is outside it; without one, all accepted candidates are considered
  // and the lowest containing triangle ID wins deterministically.
  return (s, t, triangleId) => {
    finite(s, 's');
    finite(t, 't');
    if (s < 0 || s > 1 || t < 0 || t > 1) throw new RangeError('source point is outside the covered [0, 1] domain');
    if (triangleId !== undefined && (!Number.isInteger(triangleId) || triangleId < 0 || triangleId >= index.triangles.length)) {
      throw new RangeError('triangle hint is invalid');
    }
    const x = Math.min(BIN_COUNT - 1, Math.floor(s * BIN_COUNT));
    const y = Math.min(BIN_COUNT - 1, Math.floor(t * BIN_COUNT));
    const candidates = triangleId === undefined
      ? [...new Set(index.bins[y * BIN_COUNT + x])].sort((a, b) => a - b)
      : [triangleId];
    for (const id of candidates) {
      const triangle = index.triangles[id];
      const weights = barycentric({ s, t }, ...triangle.points);
      if (!weights) {
        if (triangleId !== undefined) throw new RangeError('requested triangle does not contain source point');
        continue;
      }
      const result = { s, t, triangleId: id };
      for (const key of ['x', 'y', 'u', 'v']) {
        result[key] = triangle.points[0][key] * weights[0] + triangle.points[1][key] * weights[1] + triangle.points[2][key] * weights[2];
      }
      return result;
    }
    throw new RangeError('source point is not covered by the baseline mesh');
  };
}
