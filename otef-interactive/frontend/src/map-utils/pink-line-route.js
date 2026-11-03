/**
 * Integrated route along the pink line with detours to visit user points.
 * Solid = unchanged original route; dashed = detour segments.
 * Ported from nur-colab-map pinkLineRoute.ts (buildIntegratedRoute + heritage normalization).
 */

/** Max haversine length (meters) of a single heritage edge; longer edges start a new run. */
const MAX_HERITAGE_GAP_METERS = 3500;

const CHANGE_PENALTY = 0.7;

function toLatLng(coord) {
  return [coord[1], coord[0]];
}

/** Haversine distance in meters; `a` and `b` are [lat, lng]. */
function haversineM(a, b) {
  const R = 6371000;
  const lat1 = (a[0] * Math.PI) / 180;
  const lat2 = (b[0] * Math.PI) / 180;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function parseDefaultLinePaths(geojson) {
  const paths = [];
  if (!geojson || !geojson.features) return paths;
  for (const f of geojson.features) {
    const geom = f.geometry;
    if (!geom || geom.type === "Point") continue;
    if (geom.type === "LineString") {
      paths.push(geom.coordinates.map(toLatLng));
    } else if (geom.type === "MultiLineString") {
      for (const ring of geom.coordinates) {
        paths.push(ring.map(toLatLng));
      }
    }
  }
  return paths;
}

/**
 * Split one path where consecutive vertices are farther than {@link MAX_HERITAGE_GAP_METERS}
 * apart (haversine). Drops degenerate runs with fewer than two points.
 * @param {Array<[number, number]>} path
 * @returns {Array<Array<[number, number]>>}
 */
function splitPathAtMaxGapMeters(path, maxGapMeters) {
  const runs = [];
  if (!path || path.length < 2) return runs;
  let cur = [path[0]];
  for (let i = 1; i < path.length; i++) {
    if (haversineM(path[i - 1], path[i]) > maxGapMeters) {
      if (cur.length >= 2) runs.push(cur);
      cur = [path[i]];
    } else {
      cur.push(path[i]);
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}

/**
 * Colab `normalizeHeritageSegments`: split each input path at large internal gaps; each
 * resulting run is a separate heritage segment (no cross-path snap merge).
 * @param {Array<Array<[number, number]>>} paths
 * @returns {Array<Array<[number, number]>>}
 */
function normalizeHeritageSegments(paths) {
  const out = [];
  for (const p of paths) {
    for (const run of splitPathAtMaxGapMeters(p, MAX_HERITAGE_GAP_METERS)) {
      out.push(run);
    }
  }
  return out;
}

/**
 * Closest point on segment a–b to p in WGS84; `p`, `a`, `b` are [lat, lng].
 * Uses planar projection in lng/lat for the projection step (Colab `pinkLineRoute.ts`).
 */
function closestLatLngOnSegment(p, a, b) {
  const px = p[1];
  const py = p[0];
  const ax = a[1];
  const ay = a[0];
  const bx = b[1];
  const by = b[0];
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 < 1e-18) return a;
  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * abx;
  const qy = ay + t * aby;
  return [qy, qx];
}

function haversinePointToSegmentMeters(p, a, b) {
  const q = closestLatLngOnSegment(p, a, b);
  return haversineM(p, q);
}

function minDistancePointToPolyline(p, path) {
  const n = path.length;
  if (n === 0) return Number.POSITIVE_INFINITY;
  if (n === 1) return haversineM(p, path[0]);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n - 1; i++) {
    const d = haversinePointToSegmentMeters(p, path[i], path[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

function buildPrefixDistances(path) {
  const prefix = [0];
  for (let i = 1; i < path.length; i++) {
    prefix[i] = prefix[i - 1] + haversineM(path[i - 1], path[i]);
  }
  return prefix;
}

function segmentLength(prefix, i, j) {
  if (j <= i) return 0;
  return prefix[j] - prefix[i];
}

function bestIntervalForPoint(path, prefix, point) {
  const n = path.length;
  if (n < 2) return null;
  let bestCost = Number.POSITIVE_INFINITY;
  let bestStart = 0;
  let bestEnd = 0;

  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const removed = segmentLength(prefix, i, j);
      const added =
        haversineM(path[i], point) + haversineM(point, path[j]);
      const addedDist = added - removed;
      const cost = addedDist + CHANGE_PENALTY * removed;
      if (cost < bestCost) {
        bestCost = cost;
        bestStart = i;
        bestEnd = j;
      }
    }
  }

  return { start: bestStart, end: bestEnd };
}

function mergeIntervals(intervals) {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged = [];
  let current = { ...sorted[0] };

  for (let k = 1; k < sorted.length; k++) {
    const next = sorted[k];
    if (next.start <= current.end) {
      current.end = Math.max(current.end, next.end);
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);
  return merged;
}

function orderPointsBetweenEndpoints(start, end, points) {
  if (points.length === 0) return [];
  if (points.length === 1) return [...points];
  const route = [start, end];
  for (const p of points) {
    let bestCost = Number.POSITIVE_INFINITY;
    let bestIdx = 1;
    for (let i = 1; i < route.length; i++) {
      const prev = route[i - 1];
      const next = route[i];
      const added =
        haversineM(prev, p) + haversineM(p, next) - haversineM(prev, next);
      if (added < bestCost) {
        bestCost = added;
        bestIdx = i;
      }
    }
    route.splice(bestIdx, 0, p);
  }
  return route.slice(1, -1);
}

/**
 * @param {Array<[number,number]>} basePath
 * @param {Array<[number,number]>} userPoints
 * @returns {{ solid: Array<Array<[number,number]>>, dashed: Array<Array<[number,number]>>, removed: Array<Array<[number,number]>> }}
 */
function buildIntegratedRouteOneSegment(basePath, userPoints) {
  const solid = [];
  const dashed = [];
  const removed = [];

  if (!basePath || basePath.length === 0) return { solid, dashed, removed };

  if (userPoints.length === 0) {
    solid.push([...basePath]);
    return { solid, dashed, removed };
  }

  const prefix = buildPrefixDistances(basePath);

  const pointIntervals = [];
  for (const p of userPoints) {
    const interval = bestIntervalForPoint(basePath, prefix, p);
    if (!interval || interval.end <= interval.start) continue;
    pointIntervals.push({ point: p, start: interval.start, end: interval.end });
  }
  const byStart = [...pointIntervals].sort((a, b) => a.start - b.start);
  const mergedIntervals = mergeIntervals(
    byStart.map((x) => ({ start: x.start, end: x.end })),
  );

  for (const intr of mergedIntervals) {
    const leave = basePath[intr.start];
    const rejoin = basePath[intr.end];
    const inThisDetour = byStart.filter(
      (x) => x.start <= intr.end && x.end >= intr.start,
    );
    const pointsInOrder = orderPointsBetweenEndpoints(
      leave,
      rejoin,
      inThisDetour.map((x) => x.point),
    );
    dashed.push([leave, ...pointsInOrder, rejoin]);
    removed.push(basePath.slice(intr.start, intr.end + 1));
  }

  let lastEnd = 0;
  for (const intr of mergedIntervals) {
    if (intr.start > lastEnd) {
      solid.push(basePath.slice(lastEnd, intr.start + 1));
    }
    lastEnd = Math.max(lastEnd, intr.end);
  }
  if (lastEnd < basePath.length - 1) {
    solid.push(basePath.slice(lastEnd, basePath.length));
  }

  return { solid, dashed, removed };
}

/**
 * @param {Array<Array<[number,number]>>} basePaths - from parseDefaultLinePaths
 * @param {Array<[number,number]>} userPoints - [lat, lng] per point
 * @returns {{ solid: Array<Array<[number,number]>>, dashed: Array<Array<[number,number]>>, removed: Array<Array<[number,number]>> }}
 *   `removed` lists base-path polylines replaced by each merged detour (heritage segments), empty when there are no user points.
 */
function buildIntegratedRoute(basePaths, userPoints) {
  const solid = [];
  const dashed = [];
  const removed = [];

  const segments = normalizeHeritageSegments(basePaths);
  if (segments.length === 0) return { solid, dashed, removed };

  if (userPoints.length === 0) {
    for (const s of segments) solid.push([...s]);
    return { solid, dashed, removed };
  }

  const pointsBySegment = segments.map(() => []);
  for (const p of userPoints) {
    let bestSi = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let si = 0; si < segments.length; si++) {
      const d = minDistancePointToPolyline(p, segments[si]);
      if (d < bestD) {
        bestD = d;
        bestSi = si;
      }
    }
    pointsBySegment[bestSi].push(p);
  }

  for (let si = 0; si < segments.length; si++) {
    const part = buildIntegratedRouteOneSegment(
      segments[si],
      pointsBySegment[si],
    );
    solid.push(...part.solid);
    dashed.push(...part.dashed);
    removed.push(...part.removed);
  }
  return { solid, dashed, removed };
}

/** Max vertex distance (m) when matching a `removed` polyline to a heritage segment. */
const CLIP_REMOVED_SUBPATH_TOLERANCE_M = 2.5;

/**
 * Max distance from a removed point to the heritage polyline when snapping by projection.
 * Colab bundle `integrated_route.removed` may densify or resample vertices so they no longer match
 * pack vertices within {@link CLIP_REMOVED_SUBPATH_TOLERANCE_M}; without a fallback the base axis
 * is not clipped and full-opacity pink stays under the ghost stack.
 */
const CLIP_REMOVED_PROJECTION_TOLERANCE_M = 25;

function coordsMatchForClip(a, b, toleranceM) {
  return haversineM(a, b) <= toleranceM;
}

/**
 * Closest point on `path` to `p`, with cumulative arclength from the start of `path` to that point.
 * @param {[number, number]} p - [lat, lng]
 * @param {Array<[number, number]>} path
 * @returns {{ distM: number, arclength: number }}
 */
function closestPointOnPolylineWithArclength(p, path) {
  const prefix = buildPrefixDistances(path);
  let best = { distM: Number.POSITIVE_INFINITY, arclength: 0 };
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const q = closestLatLngOnSegment(p, a, b);
    const d = haversineM(p, q);
    if (d < best.distM) {
      const alongEdge = haversineM(a, q);
      best = { distM: d, arclength: prefix[i] + alongEdge };
    }
  }
  return best;
}

/**
 * When strict vertex-for-vertex matching fails, map `removed` onto `segment` by projecting each
 * point to the nearest location on the polyline and taking the inclusive vertex span that covers
 * the resulting arclength range.
 * @returns {{ start: number, end: number } | null}
 */
function findRemovedIntervalByProjection(
  segment,
  removed,
  toleranceM = CLIP_REMOVED_PROJECTION_TOLERANCE_M,
) {
  if (!segment || segment.length < 2 || !removed || removed.length < 2) return null;
  const prefix = buildPrefixDistances(segment);
  const projected = [];
  for (const r of removed) {
    const hit = closestPointOnPolylineWithArclength(r, segment);
    if (hit.distM > toleranceM) return null;
    projected.push(hit.arclength);
  }
  const lo = Math.min(...projected);
  const hi = Math.max(...projected);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;

  let startIdx = -1;
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] >= lo) {
      startIdx = i;
      break;
    }
  }
  if (startIdx < 0) return null;

  let endIdx = -1;
  for (let i = prefix.length - 1; i >= 0; i--) {
    if (prefix[i] <= hi) {
      endIdx = i;
      break;
    }
  }
  if (endIdx < 0 || startIdx > endIdx) return null;

  if (startIdx === endIdx && endIdx < segment.length - 1) {
    endIdx += 1;
  }
  if (startIdx > endIdx) return null;

  return { start: startIdx, end: endIdx };
}

/**
 * If `removed` is a contiguous run of vertices on `segment`, returns inclusive vertex indices.
 * @returns {{ start: number, end: number } | null}
 */
function findSubpathVertexIndices(segment, removed, toleranceM = CLIP_REMOVED_SUBPATH_TOLERANCE_M) {
  if (!segment || segment.length < 2 || !removed || removed.length < 2) return null;
  if (removed.length > segment.length) return null;
  outer: for (let i = 0; i <= segment.length - removed.length; i++) {
    for (let k = 0; k < removed.length; k++) {
      if (!coordsMatchForClip(segment[i + k], removed[k], toleranceM)) {
        continue outer;
      }
    }
    return { start: i, end: i + removed.length - 1 };
  }
  return null;
}

/**
 * @returns {{ start: number, end: number } | null}
 */
function findRemovedVertexIntervalOnSegment(segment, removed) {
  const strict = findSubpathVertexIndices(segment, removed);
  if (strict) return strict;
  return findRemovedIntervalByProjection(segment, removed);
}

/**
 * @param {Array<{ start: number, end: number }>} intervals - inclusive vertex indices on one polyline
 */
function mergeInclusiveVertexIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out = [];
  let cur = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n.start <= cur.end + 1) {
      cur.end = Math.max(cur.end, n.end);
    } else {
      out.push(cur);
      cur = { ...n };
    }
  }
  out.push(cur);
  return out;
}

/**
 * Drop inclusive vertex ranges from one polyline; returns zero or more polylines (each length ≥ 2).
 * @param {Array<[number, number]>} basePath
 * @param {Array<{ start: number, end: number }>} merged - merged inclusive intervals
 */
function clipBasePathByRemovedIntervals(basePath, merged) {
  if (!merged.length) return basePath.length >= 2 ? [[...basePath]] : [];
  const parts = [];
  let cursor = 0;
  for (const { start: s, end: e } of merged) {
    if (s > cursor) {
      const part = basePath.slice(cursor, s + 1);
      if (part.length >= 2) parts.push(part);
    }
    cursor = e;
  }
  if (cursor < basePath.length) {
    const part = basePath.slice(cursor);
    if (part.length >= 2) parts.push(part);
  }
  return parts;
}

/**
 * Regional pink axis paths with “removed heritage” vertex chains cut out so the base layer does not
 * shine through under ghost strokes. Uses the same {@link normalizeHeritageSegments} split as
 * {@link buildIntegratedRoute}; `removedPolylines` are Colab / integrated-route subpaths of those segments.
 *
 * @param {Array<Array<[number, number]>>} basePaths - raw pack paths (same source as `fetchPinkLinePaths`)
 * @param {Array<Array<[number, number]>>} removedPolylines - `removed` from bundle or `buildIntegratedRoute`
 * @returns {Array<Array<[number, number]>>} polylines to draw for the axis (may be shorter / more pieces than input)
 */
function clipPinkBasePathsExcludingRemoved(basePaths, removedPolylines) {
  if (!Array.isArray(basePaths) || basePaths.length === 0) return [];
  if (!Array.isArray(removedPolylines) || removedPolylines.length === 0) {
    return basePaths.filter((p) => p && p.length >= 2);
  }
  const segments = normalizeHeritageSegments(basePaths);
  const out = [];
  for (const seg of segments) {
    const intervals = [];
    for (const rem of removedPolylines) {
      if (!rem || rem.length < 2) continue;
      const idx = findRemovedVertexIntervalOnSegment(seg, rem);
      if (idx) intervals.push(idx);
    }
    if (intervals.length === 0) {
      if (seg.length >= 2) out.push(seg);
    } else {
      const merged = mergeInclusiveVertexIntervals(intervals);
      out.push(...clipBasePathByRemovedIntervals(seg, merged));
    }
  }
  return out;
}

if (typeof window !== "undefined") {
  window.PinkLineRoute = { parseDefaultLinePaths, buildIntegratedRoute };
}

export { parseDefaultLinePaths, buildIntegratedRoute, clipPinkBasePathsExcludingRemoved };
