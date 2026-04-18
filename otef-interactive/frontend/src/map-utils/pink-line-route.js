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

function dist(a, b) {
  const dlat = a[0] - b[0];
  const dlng = a[1] - b[1];
  return Math.sqrt(dlat * dlat + dlng * dlng);
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

function distPointToSegment(p, a, b) {
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
  if (ab2 < 1e-18) return dist(p, a);
  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + t * abx;
  const qy = ay + t * aby;
  const dlat = py - qy;
  const dlng = px - qx;
  return Math.sqrt(dlat * dlat + dlng * dlng);
}

function minDistancePointToPolyline(p, path) {
  const n = path.length;
  if (n === 0) return Number.POSITIVE_INFINITY;
  if (n === 1) return dist(p, path[0]);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n - 1; i++) {
    const d = distPointToSegment(p, path[i], path[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

function buildPrefixDistances(path) {
  const prefix = [0];
  for (let i = 1; i < path.length; i++) {
    prefix[i] = prefix[i - 1] + dist(path[i - 1], path[i]);
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
      const added = dist(path[i], point) + dist(point, path[j]);
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
      const added = dist(prev, p) + dist(p, next) - dist(prev, next);
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

if (typeof window !== "undefined") {
  window.PinkLineRoute = { parseDefaultLinePaths, buildIntegratedRoute };
}

export { parseDefaultLinePaths, buildIntegratedRoute };
