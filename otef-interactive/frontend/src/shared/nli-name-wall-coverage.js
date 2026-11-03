import { outputToT3 } from './projection-config-geometry.js';
import { validateWarpMesh } from './projection-warp-geometry.js';
import { normalizeRotationDeg } from './nli-name-wall-config.js';

const WIDTH = 1920;
const HEIGHT = 1080;
const EPS = 1e-7;
const sides = ['left', 'right'];
const finite = (n) => typeof n === 'number' && Number.isFinite(n);
const area = (p) => p.reduce((n, a, i) => { const b = p[(i + 1) % p.length]; return n + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;
const rectPolygon = ({ x, y, width, height }) => [[x - width / 2, y - height / 2], [x + width / 2, y - height / 2], [x + width / 2, y + height / 2], [x - width / 2, y + height / 2]];
const boundsOf = (p) => ({ x0: Math.min(...p.map((q) => q[0])), x1: Math.max(...p.map((q) => q[0])), y0: Math.min(...p.map((q) => q[1])), y1: Math.max(...p.map((q) => q[1])) });
const overlaps = (a, b) => a.x0 < b.x1 - EPS && a.x1 > b.x0 + EPS && a.y0 < b.y1 - EPS && a.y1 > b.y0 + EPS;
const touches = (a, b) => a.x0 <= b.x1 + EPS && a.x1 >= b.x0 - EPS && a.y0 <= b.y1 + EPS && a.y1 >= b.y0 - EPS;
const indexCache = new WeakMap();
function indexedCandidates(pieces, box) {
  if (pieces.length < 24) return pieces;
  let bins = indexCache.get(pieces);
  if (!bins) {
    bins = new Map();
    for (const piece of pieces) {
      const b = piece.bounds || boundsOf(piece.polygon || piece);
      for (let x = Math.floor(b.x0 / 64); x <= Math.floor(b.x1 / 64); x++) for (let y = Math.floor(b.y0 / 64); y <= Math.floor(b.y1 / 64); y++) {
        const key = `${x}:${y}`;
        if (!bins.has(key)) bins.set(key, []);
        bins.get(key).push(piece);
      }
    }
    indexCache.set(pieces, bins);
  }
  const found = new Set();
  for (let x = Math.floor(box.x0 / 64); x <= Math.floor(box.x1 / 64); x++) for (let y = Math.floor(box.y0 / 64); y <= Math.floor(box.y1 / 64); y++) {
    for (const piece of bins.get(`${x}:${y}`) || []) found.add(piece);
  }
  return found;
}
const rotate = ([x, y], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

function clipHalf(polygon, signedDistance, minArea = EPS) {
  const result = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const da = signedDistance(a), db = signedDistance(b);
    if (da >= -EPS) result.push(a);
    if ((da < -EPS && db > EPS) || (da > EPS && db < -EPS)) {
      const t = da / (da - db);
      result.push(a.map((v, k) => v + t * (b[k] - v)));
    }
  }
  return result.length >= 3 && Math.abs(area(result.map((p) => p.slice(0, 2)))) > minArea ? result : [];
}
function clipBox(polygon, box, xIndex = 0, yIndex = 1, minArea = EPS) {
  let p = polygon;
  for (const [index, value, sign] of [[xIndex, box.x0, 1], [xIndex, box.x1, -1], [yIndex, box.y0, 1], [yIndex, box.y1, -1]]) {
    p = clipHalf(p, (q) => sign * (q[index] - value), minArea);
    if (!p.length) return [];
  }
  return p;
}
function clipConvex(subject, clip) {
  let p = subject;
  const sign = Math.sign(area(clip));
  for (let i = 0; i < clip.length; i += 1) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    p = clipHalf(p, (q) => sign * ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])));
    if (!p.length) return [];
  }
  return p;
}
export function rectIntersectsPieces(rect, pieces) {
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(finite) || rect.width <= 0 || rect.height <= 0) return false;
  const box = boundsOf(rectPolygon(rect));
  for (const piece of indexedCandidates(pieces, box)) {
    if (!overlaps(box, piece.bounds || boundsOf(piece.polygon || piece))) continue;
    const polygon = clipBox(piece.polygon || piece, box, 0, 1, 0);
    if (polygon.length && Math.abs(area(polygon)) > 0) return true;
  }
  return false;
}
export function rectCoveredByPieces(rect, pieces) {
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(finite) || rect.width <= 0 || rect.height <= 0) return false;
  const box = boundsOf(rectPolygon(rect));
  const clipped = [];
  for (const piece of indexedCandidates(pieces, box)) {
    if (!overlaps(box, piece.bounds || boundsOf(piece.polygon || piece))) continue;
    const polygon = clipBox(piece.polygon || piece, box, 0, 1, 0);
    if (polygon.length) clipped.push(polygon);
  }
  if (!clipped.length) return false;
  const events = [box.y0, box.y1];
  const edges = [];
  for (const polygon of clipped) for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    events.push(a[1]);
    if (Math.abs(a[1] - b[1]) > EPS) edges.push([a, b]);
  }
  const indexedEdges = edges.map(([a, b], index) => ({ a, b, index,
    x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]),
    y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) }));
  const xSpan = indexedEdges.reduce((sum, edge) => sum + (edge.x1 - edge.x0) / rect.width, 0);
  const ySpan = indexedEdges.reduce((sum, edge) => sum + (edge.y1 - edge.y0) / rect.height, 0);
  const sweepX = xSpan < ySpan;
  indexedEdges.sort((a, b) => (sweepX ? a.x0 - b.x0 : a.y0 - b.y0) || a.index - b.index);
  let activeEdges = [];
  for (const edge of indexedEdges) {
    const start = sweepX ? edge.x0 : edge.y0;
    activeEdges = activeEdges.filter((other) => (sweepX ? other.x1 : other.y1) >= start - EPS);
    for (const other of activeEdges) {
      if (edge.x0 > other.x1 + EPS || other.x0 > edge.x1 + EPS ||
          edge.y0 > other.y1 + EPS || other.y0 > edge.y1 + EPS) continue;
      const first = edge.index < other.index ? edge : other;
      const second = edge.index < other.index ? other : edge;
      const [a, b] = [first.a, first.b], [c, d] = [second.a, second.b];
      const dx1 = b[0] - a[0], dy1 = b[1] - a[1], dx2 = d[0] - c[0], dy2 = d[1] - c[1];
      const denom = dx1 * dy2 - dy1 * dx2;
      if (Math.abs(denom) <= EPS) continue;
      const t = ((c[0] - a[0]) * dy2 - (c[1] - a[1]) * dx2) / denom;
      const u = ((c[0] - a[0]) * dy1 - (c[1] - a[1]) * dx1) / denom;
      if (t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS) events.push(a[1] + t * dy1);
    }
    activeEdges.push(edge);
  }
  events.sort((a, b) => a - b);
  const sortedPolygons = clipped.map((polygon) => ({ polygon,
    y0: Math.min(...polygon.map((point) => point[1])), y1: Math.max(...polygon.map((point) => point[1])) }))
    .sort((a, b) => a.y0 - b.y0);
  let nextPolygon = 0, activePolygons = [];
  for (let i = 0; i < events.length - 1; i++) {
    if (events[i + 1] - events[i] <= EPS) continue;
    const y = (events[i] + events[i + 1]) / 2;
    while (nextPolygon < sortedPolygons.length && sortedPolygons[nextPolygon].y0 <= y) activePolygons.push(sortedPolygons[nextPolygon++]);
    activePolygons = activePolygons.filter((item) => item.y1 > y);
    const spans = [];
    for (const { polygon } of activePolygons) {
      const hits = [];
      for (let k = 0; k < polygon.length; k++) {
        const a = polygon[k], b = polygon[(k + 1) % polygon.length];
        if ((a[1] <= y && y < b[1]) || (b[1] <= y && y < a[1])) hits.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      if (hits.length >= 2) spans.push([Math.min(...hits), Math.max(...hits)]);
    }
    spans.sort((a, b) => a[0] - b[0]);
    let coveredUntil = box.x0;
    for (const [x0, x1] of spans) {
      if (x0 > coveredUntil + EPS) break;
      coveredUntil = Math.max(coveredUntil, x1);
      if (coveredUntil >= box.x1 - EPS) break;
    }
    if (coveredUntil < box.x1 - EPS) return false;
  }
  return true;
}

function t3ToPlane({ u, v }, config, logicalPlane) {
  const pre = config.pre;
  const scale = logicalPlane.planeScale ?? pre.scale * Math.min(config.outputs.left.post.scale, config.outputs.right.post.scale);
  const degrees = logicalPlane.heading ?? 41;
  const heading = (Number.isFinite(degrees) ? normalizeRotationDeg(degrees) : degrees) * Math.PI / 180;
  if (!finite(scale) || scale <= 0 || !finite(heading)) throw new Error('invalid logical name plane');
  const point = rotate([(u - 0.5) * WIDTH / pre.scale, (v - 0.5) * HEIGHT / pre.scale], pre.rotateDeg * Math.PI / 180);
  return rotate([point[0] - pre.tx * WIDTH, point[1] - pre.ty * HEIGHT], -heading).map((n) => n * scale);
}
function meshIdentity(mesh) {
  let h = 2166136261;
  for (const vertex of mesh.vertices) for (const key of ['x', 'y', 'u', 'v']) {
    const value = Math.round(vertex[key] * 1e7);
    h = Math.imul(h ^ value, 16777619) >>> 0;
  }
  for (const n of mesh.triangles) h = Math.imul(h ^ n, 16777619) >>> 0;
  return `${mesh.side || 'output'}:${mesh.vertices.length}:${mesh.triangles.length}:${h.toString(16)}`;
}
function meshPieces(mesh, branch, clip, config, logicalPlane, output) {
  validateWarpMesh(mesh);
  if (!Array.isArray(clip) || clip.length !== 4 || !clip.every(finite) || clip[0] < 0 || clip[1] < 0 || clip[2] > 1 || clip[3] > 1 || clip[2] <= clip[0] || clip[3] <= clip[1]) throw new Error(`invalid ${output} names compositor clip`);
  const result = [];
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const tri = mesh.triangles.slice(i, i + 3).map((n) => mesh.vertices[n]);
    const inner = config.namesWall?.innerEdgeInsetPx?.[output] || 0;
    const outputBox = { x0: output === 'right' ? inner / WIDTH : 0, y0: 0,
      x1: output === 'left' ? 1 - inner / WIDTH : 1, y1: 1 };
    let p = clipBox(tri.map((v) => [v.x, v.y, v.u, v.v]), outputBox);
    if (!p.length) continue;
    p = clipBox(p, { x0: clip[0], y0: clip[1], x1: clip[2], y1: clip[3] }, 2, 3);
    if (!p.length) continue;
    p = p.map((v) => [v[2], v[3]]);
    // Crop is applied before the browser warp. A composed pixel beyond it is blank.
    p = clipBox(p, { x0: 0, y0: 0, x1: 1, y1: 1 });
    if (!p.length) continue;
    const polygon = p.map(([u, v]) => t3ToPlane(outputToT3({ u, v }, branch), config, logicalPlane));
    const sourceRect = { x0: branch.crop.x0, x1: branch.crop.x1, y0: branch.crop.y0, y1: branch.crop.y1 };
    const logicalCrop = clipConvex(polygon, [[sourceRect.x0, sourceRect.y0], [sourceRect.x1, sourceRect.y0], [sourceRect.x1, sourceRect.y1], [sourceRect.x0, sourceRect.y1]].map(([u, v]) => t3ToPlane({ u, v }, config, logicalPlane)));
    if (logicalCrop.length) result.push({ output, polygon: logicalCrop, bounds: boundsOf(logicalCrop) });
  }
  return result;
}
export function evaluateNameWallCoverage({ config, meshes, compositorClips = {}, cameraMappings = {}, logicalPlane = {} } = {}) {
  if (!config?.pre || !config.outputs?.left || !config.outputs?.right) throw new Error('missing projection configuration');
  const pieces = {}, outputIdentities = {};
  for (const side of sides) {
    const mesh = meshes?.[side];
    if (!mesh) throw new Error(`missing ${side} evaluated projection mesh`);
    pieces[side] = meshPieces(mesh, cameraMappings[side] || config.outputs[side], compositorClips[side] || [0, 0, 1, 1], config, logicalPlane, side);
    if (!pieces[side].length) throw new Error(`${side} names coverage is empty`);
    outputIdentities[side] = meshIdentity(mesh);
  }
  return { pieces, outputIdentities, logicalPlane };
}

function intersectSpans(a, b) {
  const result = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const left = Math.max(a[i][0], b[j][0]), right = Math.min(a[i][1], b[j][1]);
    if (right > left + EPS) result.push([left, right]);
    if (a[i][1] < b[j][1]) i++; else j++;
  }
  return result;
}

function mergeSpans(spans) {
  const result = [];
  for (const span of spans.sort((a, b) => a[0] - b[0])) {
    if (result.length && span[0] <= result.at(-1)[1] + EPS) result.at(-1)[1] = Math.max(result.at(-1)[1], span[1]);
    else result.push([...span]);
  }
  return result;
}

const bandIndex = new WeakMap();
function indexedBandPolygons(polygons, y0, y1) {
  let index = bandIndex.get(polygons);
  if (!index) {
    const bins = new Map();
    const records = polygons.map((piece) => {
      const polygon = piece.polygon || piece;
      const box = boundsOf(polygon);
      const edges = polygon.map((a, edgeIndex) => {
        const b = polygon[(edgeIndex + 1) % polygon.length];
        return { a, b, y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]),
          x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]),
          at: (y) => a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]) };
      }).filter((edge) => edge.y1 - edge.y0 > EPS);
      return { polygon, box, edges };
    });
    for (const record of records) for (let bin = Math.floor(record.box.y0 / 32); bin <= Math.floor(record.box.y1 / 32); bin++) {
      if (!bins.has(bin)) bins.set(bin, []);
      bins.get(bin).push(record);
    }
    index = { bins };
    bandIndex.set(polygons, index);
  }
  const selected = new Set();
  for (let bin = Math.floor(y0 / 32); bin <= Math.floor(y1 / 32); bin++)
    for (const record of index.bins.get(bin) || []) if (record.box.y0 <= y1 + EPS && record.box.y1 >= y0 - EPS)
      selected.add(record);
  return [...selected];
}

function bandSpans(polygons, y0, y1) {
  if (y1 <= y0 + EPS) return [];
  const selected = indexedBandPolygons(polygons, y0, y1);
  const edges = selected.flatMap((record) => record.edges).sort((a, b) => a.x0 - b.x0);
  const events = [y0, y1];
  for (const { polygon } of selected) for (const point of polygon) if (point[1] > y0 + EPS && point[1] < y1 - EPS) events.push(point[1]);
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length && edges[j].x0 <= edges[i].x1 + EPS; j++) {
    const a = edges[i], b = edges[j];
    const low = Math.max(y0, a.y0, b.y0), high = Math.min(y1, a.y1, b.y1);
    if (high - low <= EPS || a.x1 < b.x0 - EPS || b.x1 < a.x0 - EPS) continue;
    const d0 = a.at(low) - b.at(low), d1 = a.at(high) - b.at(high);
    if (d0 * d1 < -EPS * EPS) events.push(low + (high - low) * d0 / (d0 - d1));
  }
  events.sort((a, b) => a - b);
  let safe = null;
  for (let i = 0; i < events.length - 1; i++) {
    const low = events[i], high = events[i + 1];
    if (high - low <= EPS) continue;
    const mid = (low + high) / 2;
    const intervals = [];
    for (const { edges: polygonEdges } of selected) {
      const hits = [];
      for (const edge of polygonEdges) {
        const { a, b } = edge;
        if ((a[1] <= mid && mid < b[1]) || (b[1] <= mid && mid < a[1])) {
          hits.push({ x: edge.at(mid), edge });
        }
      }
      // Evaluated mesh pieces are clipped triangles, so the common case has two intersections.
      if (hits.length === 2) {
        if (hits[0].x > hits[1].x) [hits[0], hits[1]] = [hits[1], hits[0]];
      } else if (hits.length > 2) hits.sort((a, b) => a.x - b.x);
      for (let k = 0; k + 1 < hits.length; k += 2) intervals.push({ left: hits[k], right: hits[k + 1] });
    }
    intervals.sort((a, b) => a.left.x - b.left.x);
    const groups = [];
    for (const interval of intervals) {
      const previous = groups.at(-1);
      if (previous && interval.left.x <= previous.right.x + EPS) {
        if (interval.right.x > previous.right.x) previous.right = interval.right;
      } else groups.push({ ...interval });
    }
    const slab = mergeSpans(groups.map(({ left, right }) => [
      Math.max(left.edge.at(low), left.edge.at(high)),
      Math.min(right.edge.at(low), right.edge.at(high)),
    ]).filter(([a, b]) => b > a + EPS));
    safe = safe === null ? slab : intersectSpans(safe, slab);
    if (!safe.length) return [];
  }
  return safe || [];
}

const ringBandPieces = new WeakMap();
const unionPieces = new WeakMap();
export function nameWallRowSpans(coverage, { output, outputs, y0, y1, inset = 0, ring = null, ringInset = inset } = {}) {
  let pieces = coverage?.pieces?.[output];
  if (outputs?.length && coverage?.pieces) {
    let unions = unionPieces.get(coverage);
    if (!unions) { unions = new Map(); unionPieces.set(coverage, unions); }
    const key = outputs.join(':');
    if (!unions.has(key)) unions.set(key, outputs.flatMap((side) => coverage.pieces[side] || []));
    pieces = unions.get(key);
  }
  if (!pieces || !finite(y0) || !finite(y1) || !finite(inset) || inset < 0 || !finite(ringInset) || ringInset < 0) return [];
  let spans = bandSpans(pieces, y0 - inset, y1 + inset)
    .map(([a, b]) => [a + inset, b - inset]).filter(([a, b]) => b > a + EPS);
  if (ring) {
    if (!ringBandPieces.has(ring)) ringBandPieces.set(ring, [{ polygon: ring }]);
    spans = intersectSpans(spans, bandSpans(ringBandPieces.get(ring), y0 - ringInset - EPS,
    y1 + ringInset + EPS).map(([a, b]) => [a + ringInset + 10 * EPS, b - ringInset - 10 * EPS])
    .filter(([a, b]) => b > a + EPS));
  }
  return spans;
}

function segmentsIntersect(a, b, c, d) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const x = cross(a, b, c), y = cross(a, b, d), z = cross(c, d, a), w = cross(c, d, b);
  return x * y < -EPS && z * w < -EPS;
}
function segmentsContact(a, b, c, d) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const on = (p, q, r) => Math.abs(cross(p, q, r)) <= EPS &&
    r[0] >= Math.min(p[0], q[0]) - EPS && r[0] <= Math.max(p[0], q[0]) + EPS &&
    r[1] >= Math.min(p[1], q[1]) - EPS && r[1] <= Math.max(p[1], q[1]) + EPS;
  return segmentsIntersect(a, b, c, d) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}
const ringCache = new WeakMap();
function ringInfo(ring) {
  if (ringCache.has(ring)) return ringCache.get(ring);
  let info = null;
  if (Array.isArray(ring) && ring.length >= 4 && ring.every((p) => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(finite)) &&
      Math.hypot(ring[0][0] - ring.at(-1)[0], ring[0][1] - ring.at(-1)[1]) <= EPS && Math.abs(area(ring.slice(0, -1))) > EPS) {
    const edges = ring.slice(0, -1).map((a, i) => ({ a, b: ring[i + 1], bounds: boundsOf([a, ring[i + 1]]) }));
    const simple = edges.every((edge, i) => Math.hypot(edge.a[0] - edge.b[0], edge.a[1] - edge.b[1]) > EPS &&
      edges.every((other, j) => i === j || Math.abs(i - j) === 1 || Math.abs(i - j) === edges.length - 1 ||
        !touches(edge.bounds, other.bounds) || !segmentsContact(edge.a, edge.b, other.a, other.b)));
    if (simple) {
      const yBins = new Map(), xyBins = new Map();
      for (const edge of edges) {
        const b = edge.bounds;
        for (let y = Math.floor(b.y0 / 64); y <= Math.floor(b.y1 / 64); y++) {
          if (!yBins.has(y)) yBins.set(y, []);
          yBins.get(y).push(edge);
          for (let x = Math.floor(b.x0 / 64); x <= Math.floor(b.x1 / 64); x++) {
            const key = `${x}:${y}`;
            if (!xyBins.has(key)) xyBins.set(key, []);
            xyBins.get(key).push(edge);
          }
        }
      }
      info = { edges, yBins, xyBins };
    }
  }
  ringCache.set(ring, info);
  return info;
}
export function validNameWallRing(ring) { return !!ringInfo(ring); }
function pointInRing(point, info) {
  let inside = false;
  for (const { a, b } of info.yBins.get(Math.floor(point[1] / 64)) || []) {
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
export function ringContainsGuardedRect(ring, rect, inset = 0, pieces = null) {
  if (!finite(inset) || inset < 0) return false;
  const info = ringInfo(ring);
  if (!info) return false;
  const expanded = rectPolygon({ ...rect, width: rect.width + 2 * inset, height: rect.height + 2 * inset });
  if (!expanded.every((point) => pointInRing(point, info))) return false;
  const b = boundsOf(expanded), candidates = new Set();
  for (let x = Math.floor(b.x0 / 64); x <= Math.floor(b.x1 / 64); x++) for (let y = Math.floor(b.y0 / 64); y <= Math.floor(b.y1 / 64); y++) {
    for (const edge of info.xyBins.get(`${x}:${y}`) || []) candidates.add(edge);
  }
  for (let i = 0; i < expanded.length; i++) for (const edge of candidates) {
    if (segmentsIntersect(expanded[i], expanded[(i + 1) % expanded.length], edge.a, edge.b)) return false;
  }
  return !pieces || rectCoveredByPieces({ ...rect, width: rect.width + 2 * inset, height: rect.height + 2 * inset }, pieces);
}
