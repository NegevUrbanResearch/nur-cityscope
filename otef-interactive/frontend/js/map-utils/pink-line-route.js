/**
 * Integrated route along the pink line with detours to visit user points.
 * Solid = unchanged original route; dashed = detour segments.
 * Ported from nur-colab-map pinkLineRoute.ts.
 */

function toLatLng(coord) {
  return [coord[1], coord[0]];
}

function dist(a, b) {
  const dlat = a[0] - b[0];
  const dlng = a[1] - b[1];
  return Math.sqrt(dlat * dlat + dlng * dlng);
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

function mergePaths(paths) {
  if (paths.length === 0) return [];
  const merged = [];
  for (const path of paths) {
    if (merged.length === 0) {
      merged.push(...path);
    } else {
      const last = merged[merged.length - 1];
      const first = path[0];
      if (last[0] === first[0] && last[1] === first[1]) {
        merged.push(...path.slice(1));
      } else {
        merged.push(...path);
      }
    }
  }
  return merged;
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

const CHANGE_PENALTY = 0.75;

function bestIntervalForPoint(path, prefix, point) {
  const n = path.length;
  if (n === 0) return null;
  let bestCost = Number.POSITIVE_INFINITY;
  let bestStart = 0;
  let bestEnd = 0;

  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
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
 * @param {Array<Array<[number,number]>>} basePaths - from parseDefaultLinePaths
 * @param {Array<[number,number]>} userPoints - [lat, lng] per point
 * @returns {{ solid: Array<Array<[number,number]>>, dashed: Array<Array<[number,number]>> }}
 */
function buildIntegratedRoute(basePaths, userPoints) {
  const solid = [];
  const dashed = [];

  const basePath = mergePaths(basePaths);
  if (basePath.length === 0) return { solid, dashed };

  if (userPoints.length === 0) {
    solid.push([...basePath]);
    return { solid, dashed };
  }

  const prefix = buildPrefixDistances(basePath);

  const pointIntervals = [];
  for (const p of userPoints) {
    const interval = bestIntervalForPoint(basePath, prefix, p);
    if (!interval) continue;
    pointIntervals.push({ point: p, start: interval.start, end: interval.end });
  }
  const byStart = [...pointIntervals].sort((a, b) => a.start - b.start);
  const mergedIntervals = mergeIntervals(
    byStart.map((x) => ({ start: x.start, end: x.end }))
  );

  for (const intr of mergedIntervals) {
    const leave = basePath[intr.start];
    const rejoin = basePath[intr.end];
    const inThisDetour = byStart.filter(
      (x) => x.start <= intr.end && x.end >= intr.start
    );
    const pointsInOrder = orderPointsBetweenEndpoints(
      leave,
      rejoin,
      inThisDetour.map((x) => x.point)
    );
    dashed.push([leave, ...pointsInOrder, rejoin]);
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

  if (solid.length === 0) {
    solid.push([...basePath]);
  }

  return { solid, dashed };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseDefaultLinePaths, buildIntegratedRoute };
}
