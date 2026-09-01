/** Pure route-boundary collision indexing and settlement-state derivation. */

const EPSILON = 1e-10;

function finiteCoordinate(value) {
  return Array.isArray(value) &&
    Number.isFinite(Number(value[0])) &&
    Number.isFinite(Number(value[1]));
}

function reviewedRouteParts(feature) {
  const geometry = feature?.geometry;
  let parts = geometry?.type === "LineString"
    ? [geometry.coordinates]
    : geometry?.type === "MultiLineString"
      ? geometry.coordinates
      : [];
  parts = (Array.isArray(parts) ? parts : [])
    .map((part) => (Array.isArray(part) ? part.filter(finiteCoordinate) : []))
    .filter((part) => part.length > 1);
  if (feature?.properties?.flow_direction !== "reverse") return parts;
  return [...parts].reverse().map((part) => [...part].reverse());
}

function boundaryRings(geometry) {
  if (geometry?.type === "Polygon") return geometry.coordinates || [];
  if (geometry?.type === "MultiPolygon") {
    return (geometry.coordinates || []).flatMap((polygon) => polygon || []);
  }
  return [];
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function segmentLength(start, end) {
  const latScale = Math.cos(
    ((Number(start[1]) + Number(end[1])) * Math.PI / 180) / 2,
  );
  return Math.hypot(
    (Number(end[0]) - Number(start[0])) * Math.max(0.0001, latScale),
    Number(end[1]) - Number(start[1]),
  );
}

function segmentIntersectionProgress(start, end, boundaryStart, boundaryEnd) {
  const rx = Number(end[0]) - Number(start[0]);
  const ry = Number(end[1]) - Number(start[1]);
  const sx = Number(boundaryEnd[0]) - Number(boundaryStart[0]);
  const sy = Number(boundaryEnd[1]) - Number(boundaryStart[1]);
  const qpx = Number(boundaryStart[0]) - Number(start[0]);
  const qpy = Number(boundaryStart[1]) - Number(start[1]);
  const denominator = cross(rx, ry, sx, sy);
  if (Math.abs(denominator) > EPSILON) {
    const t = cross(qpx, qpy, sx, sy) / denominator;
    const u = cross(qpx, qpy, rx, ry) / denominator;
    return t >= -EPSILON && t <= 1 + EPSILON && u >= -EPSILON && u <= 1 + EPSILON
      ? Math.min(1, Math.max(0, t))
      : null;
  }
  if (Math.abs(cross(qpx, qpy, rx, ry)) > EPSILON) return null;
  const lengthSquared = rx * rx + ry * ry;
  if (lengthSquared <= EPSILON) return null;
  const t0 = (qpx * rx + qpy * ry) / lengthSquared;
  const t1 = t0 + (sx * rx + sy * ry) / lengthSquared;
  const first = Math.max(0, Math.min(t0, t1));
  const last = Math.min(1, Math.max(t0, t1));
  return first <= last + EPSILON ? first : null;
}

function routeLength(parts) {
  let total = 0;
  for (const part of parts) {
    for (let index = 1; index < part.length; index += 1) {
      total += segmentLength(part[index - 1], part[index]);
    }
  }
  return total;
}

function firstBoundaryProgress(parts, geometry) {
  const totalLength = routeLength(parts);
  if (totalLength <= EPSILON) return null;
  const rings = boundaryRings(geometry);
  let travelled = 0;
  let first = Infinity;
  for (const part of parts) {
    for (let index = 1; index < part.length; index += 1) {
      const start = part[index - 1];
      const end = part[index];
      const currentSegmentLength = segmentLength(start, end);
      if (currentSegmentLength <= EPSILON) continue;
      for (const ring of rings) {
        const coordinates = Array.isArray(ring) ? ring.filter(finiteCoordinate) : [];
        if (coordinates.length < 2) continue;
        const closed = coordinates.length > 2 && (
          Number(coordinates[0][0]) !== Number(coordinates.at(-1)[0]) ||
          Number(coordinates[0][1]) !== Number(coordinates.at(-1)[1])
        ) ? [...coordinates, coordinates[0]] : coordinates;
        for (let boundaryIndex = 1; boundaryIndex < closed.length; boundaryIndex += 1) {
          const local = segmentIntersectionProgress(
            start,
            end,
            closed[boundaryIndex - 1],
            closed[boundaryIndex],
          );
          if (local != null) first = Math.min(
            first,
            (travelled + local * currentSegmentLength) / totalLength,
          );
        }
      }
      travelled += currentSegmentLength;
    }
  }
  return Number.isFinite(first) ? Math.round(first * 1e12) / 1e12 : null;
}

function routeObjectId(feature) {
  const value = feature?.properties?.OBJECTID ?? feature?.id;
  return value == null ? null : String(value);
}

function outlineObjectId(feature) {
  const value = feature?.properties?.outlineObjectId ??
    feature?.properties?.outlineObjectID ??
    feature?.properties?.OBJECTID ??
    feature?.id;
  return value == null ? null : String(value);
}

/** Build route associations once, in reviewed route orientation. */
export function buildRouteSettlementCollisionIndex(routeFeatures, settlementFeatures) {
  const index = new Map();
  for (const routeFeature of Array.isArray(routeFeatures) ? routeFeatures : []) {
    const routeId = routeObjectId(routeFeature);
    if (routeId == null) continue;
    const parts = reviewedRouteParts(routeFeature);
    const associations = [];
    for (const settlementFeature of Array.isArray(settlementFeatures) ? settlementFeatures : []) {
      const outlineId = outlineObjectId(settlementFeature);
      if (outlineId == null) continue;
      const progress = firstBoundaryProgress(parts, settlementFeature?.geometry);
      if (progress != null) associations.push({ outlineObjectId: outlineId, progress });
    }
    associations.sort((a, b) => a.progress - b.progress || a.outlineObjectId.localeCompare(b.outlineObjectId));
    index.set(routeId, associations);
  }
  return index;
}

function lookup(index, key) {
  if (index instanceof Map) return index.get(String(key)) ?? index.get(key);
  return index?.[key] ?? index?.[String(key)];
}

function associatedOutlineId(value) {
  const id = value && typeof value === "object"
    ? value.outlineObjectId ?? value.outlineObjectID ?? value.objectId ?? value.OBJECTID
    : value;
  return id == null ? null : String(id);
}

function addRouteAssociations(result, collisionIndex, features, progress) {
  for (const feature of Array.isArray(features) ? features : []) {
    const routeId = routeObjectId(feature);
    if (routeId == null) continue;
    for (const association of lookup(collisionIndex, routeId) || []) {
      if (Number(progress) + EPSILON >= Number(association?.progress)) {
        const id = associatedOutlineId(association);
        if (id != null) result.add(id);
      }
    }
  }
}

/** Derive the inclusive OR of polygon-associated and route-reached outlines. */
export function deriveAchievedSettlementOutlineIds({
  achievedPolygonBeats = [],
  polygonFeatures = [],
  locationToOutlineObjectId = null,
  collisionIndex = null,
  completedRouteFeatures = [],
  activeRouteFeatures = [],
  activeRouteProgress = 0,
} = {}) {
  const result = new Set();
  const achieved = new Set((achievedPolygonBeats || []).map(Number).filter(Number.isFinite));
  for (const feature of Array.isArray(polygonFeatures) ? polygonFeatures : []) {
    if (!achieved.has(Number(feature?.properties?.timeline_minutes))) continue;
    const id = associatedOutlineId(lookup(locationToOutlineObjectId, feature?.properties?.מיקום));
    if (id != null) result.add(id);
  }
  addRouteAssociations(result, collisionIndex, completedRouteFeatures, 1);
  addRouteAssociations(result, collisionIndex, activeRouteFeatures, activeRouteProgress);
  return result;
}
