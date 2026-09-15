import { buildRouteSettlementCollisionIndex } from "./nli-route-settlement-collisions.js";

export const NOVA_ESCAPE_IMPACT_LAYER_ID = "nli-nova-escape-impact-outline";
export const NOVA_ESCAPE_IMPACT_COLOR = "#f57a00";
export const NOVA_SITE_POLYGON_OBJECT_ID = 100;

const EPSILON = 1e-10;
const SITE_OUTLINE_ID = String(NOVA_SITE_POLYGON_OBJECT_ID);

function finiteCoordinate(value) {
  return Array.isArray(value) &&
    Number.isFinite(Number(value[0])) &&
    Number.isFinite(Number(value[1]));
}

function routeParts(feature) {
  const geometry = feature?.geometry;
  const parts = geometry?.type === "LineString"
    ? [geometry.coordinates]
    : geometry?.type === "MultiLineString"
      ? geometry.coordinates
      : [];
  return (Array.isArray(parts) ? parts : [])
    .map((part) => (Array.isArray(part) ? part.filter(finiteCoordinate) : []))
    .filter((part) => part.length > 1);
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

function routeLength(parts) {
  let total = 0;
  for (const part of parts) {
    for (let index = 1; index < part.length; index += 1) {
      total += segmentLength(part[index - 1], part[index]);
    }
  }
  return total;
}

function pointInRing(point, ring) {
  const x = Number(point[0]);
  const y = Number(point[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  const coords = Array.isArray(ring) ? ring.filter(finiteCoordinate) : [];
  if (coords.length < 3) return false;
  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const xi = Number(coords[i][0]);
    const yi = Number(coords[i][1]);
    const xj = Number(coords[j][0]);
    const yj = Number(coords[j][1]);
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInGeometry(point, geometry) {
  if (geometry?.type === "Polygon") return pointInRing(point, geometry.coordinates?.[0]);
  if (geometry?.type === "MultiPolygon") {
    return (geometry.coordinates || []).some((polygon) => pointInRing(point, polygon?.[0]));
  }
  return false;
}

function firstInsideProgress(parts, geometry) {
  const totalLength = routeLength(parts);
  if (totalLength <= EPSILON) {
    const start = parts[0]?.[0];
    return start && pointInGeometry(start, geometry) ? 0 : null;
  }
  let travelled = 0;
  for (const part of parts) {
    for (let index = 0; index < part.length; index += 1) {
      if (pointInGeometry(part[index], geometry)) {
        return Math.round((travelled / totalLength) * 1e12) / 1e12;
      }
      if (index + 1 < part.length) travelled += segmentLength(part[index], part[index + 1]);
    }
  }
  return null;
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function segmentIntersectionProgress(start, end, otherStart, otherEnd) {
  const rx = Number(end[0]) - Number(start[0]);
  const ry = Number(end[1]) - Number(start[1]);
  const sx = Number(otherEnd[0]) - Number(otherStart[0]);
  const sy = Number(otherEnd[1]) - Number(otherStart[1]);
  const qpx = Number(otherStart[0]) - Number(start[0]);
  const qpy = Number(otherStart[1]) - Number(start[1]);
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

function closedRing(ring) {
  const coordinates = Array.isArray(ring) ? ring.filter(finiteCoordinate) : [];
  if (coordinates.length < 2) return [];
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (Number(first[0]) === Number(last[0]) && Number(first[1]) === Number(last[1])) return coordinates;
  return [...coordinates, first];
}

function polygonRings(geometry) {
  if (geometry?.type === "Polygon") return Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
  if (geometry?.type === "MultiPolygon") {
    return (geometry.coordinates || []).flatMap((polygon) => polygon || []);
  }
  return [];
}

function lineGeometryParts(geometry) {
  if (geometry?.type === "LineString") return [geometry.coordinates];
  if (geometry?.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function firstLocalPolygonHit(start, end, geometry) {
  if (pointInGeometry(start, geometry)) return 0;
  let best = null;
  for (const ring of polygonRings(geometry)) {
    const closed = closedRing(ring);
    for (let index = 1; index < closed.length; index += 1) {
      const local = segmentIntersectionProgress(start, end, closed[index - 1], closed[index]);
      if (local == null) continue;
      best = best == null ? local : Math.min(best, local);
    }
  }
  if (best != null) return best;
  return pointInGeometry(end, geometry) ? 1 : null;
}

function firstLocalLineHit(start, end, geometry) {
  let best = null;
  for (const part of lineGeometryParts(geometry)) {
    const coords = Array.isArray(part) ? part.filter(finiteCoordinate) : [];
    for (let index = 1; index < coords.length; index += 1) {
      const local = segmentIntersectionProgress(start, end, coords[index - 1], coords[index]);
      if (local == null) continue;
      best = best == null ? local : Math.min(best, local);
    }
  }
  return best;
}

function firstCumulativeHit(parts, localHit) {
  const totalLength = routeLength(parts);
  if (totalLength <= EPSILON) {
    const start = parts[0]?.[0];
    return start && localHit(start, start) != null ? 0 : null;
  }
  let travelled = 0;
  let first = Infinity;
  for (const part of parts) {
    for (let index = 1; index < part.length; index += 1) {
      const start = part[index - 1];
      const end = part[index];
      const currentSegmentLength = segmentLength(start, end);
      if (currentSegmentLength <= EPSILON) continue;
      const local = localHit(start, end);
      if (local != null) {
        first = Math.min(first, (travelled + local * currentSegmentLength) / totalLength);
      }
      travelled += currentSegmentLength;
    }
  }
  return Number.isFinite(first) ? Math.round(first * 1e12) / 1e12 : null;
}

function outlineObjectId(feature) {
  const value = feature?.properties?.outlineObjectId ??
    feature?.properties?.outlineObjectID ??
    feature?.properties?.OBJECTID ??
    feature?.id;
  return value == null ? null : String(value);
}

function routeObjectId(feature) {
  const value = feature?.properties?.OBJECTID ?? feature?.id;
  return value == null ? null : String(value);
}

function lookupProgress(progressByObjectId, routeId) {
  if (!progressByObjectId || typeof progressByObjectId !== "object") return 0;
  const value = progressByObjectId[routeId] ?? progressByObjectId[Number(routeId)];
  const progress = Number(value);
  return Number.isFinite(progress) ? progress : 0;
}

let contactsCache = null;

/** Precompute route→yeshuv first-entry u once per route/settlement collection pair. */
export function buildEscapeImpactContacts(routes, settlements) {
  const routeList = Array.isArray(routes) ? routes : [];
  const settlementList = Array.isArray(settlements) ? settlements : [];
  const index = buildRouteSettlementCollisionIndex(routeList, settlementList);
  const contacts = [];
  for (const route of routeList) {
    const routeId = routeObjectId(route);
    if (routeId == null) continue;
    const parts = routeParts(route);
    const firstEntry = new Map();
    for (const association of index.get(routeId) || []) {
      const id = association?.outlineObjectId == null ? null : String(association.outlineObjectId);
      if (id == null || id === SITE_OUTLINE_ID) continue;
      firstEntry.set(id, Number(association.progress));
    }
    for (const settlement of settlementList) {
      const id = outlineObjectId(settlement);
      if (id == null || id === SITE_OUTLINE_ID) continue;
      const inside = firstInsideProgress(parts, settlement?.geometry);
      if (inside == null) continue;
      const previous = firstEntry.get(id);
      firstEntry.set(id, previous == null ? inside : Math.min(previous, inside));
    }
    for (const [id, entry] of firstEntry) {
      if (id === SITE_OUTLINE_ID) continue;
      contacts.push({ routeId, outlineObjectId: id, u: Number(entry) });
    }
  }
  return contacts;
}

function cachedEscapeImpactContacts(routes, settlements) {
  if (contactsCache?.routes === routes && contactsCache?.settlements === settlements) {
    return contactsCache.contacts;
  }
  const contacts = buildEscapeImpactContacts(routes, settlements);
  contactsCache = { routes, settlements, contacts };
  return contacts;
}

/** Yeshuv outlines reached by prep-reversed fleeing paths. Polygon 100 is never included. */
export function escapeImpactOutlineIds({
  routes,
  settlements,
  progressByObjectId,
  contacts,
} = {}) {
  const result = new Set();
  const routeList = Array.isArray(routes) ? routes : [];
  const settlementList = Array.isArray(settlements) ? settlements : [];
  const resolved = Array.isArray(contacts)
    ? contacts
    : cachedEscapeImpactContacts(routeList, settlementList);
  for (const contact of resolved) {
    const id = contact?.outlineObjectId == null ? null : String(contact.outlineObjectId);
    if (id == null || id === SITE_OUTLINE_ID) continue;
    if (lookupProgress(progressByObjectId, contact.routeId) + EPSILON >= Number(contact.u)) {
      result.add(id);
    }
  }
  return result;
}

export function shouldIncludeNarrativeSettlementOutline(narrativeFocus) {
  return narrativeFocus?.id !== "nova";
}

export const NOVA_PARALLEL_DIM_OPACITY = 0.28;
export const NOVA_PARALLEL_IMPACT_KIND_POLYGON = "polygon";
export const NOVA_PARALLEL_IMPACT_KIND_LINE = "line";

function fleeingFeatureKind(geometry) {
  const type = geometry?.type;
  if (type === "LineString" || type === "MultiLineString") return NOVA_PARALLEL_IMPACT_KIND_LINE;
  if (type === "Polygon" || type === "MultiPolygon") return NOVA_PARALLEL_IMPACT_KIND_POLYGON;
  return null;
}

function parseCrossingKey(key) {
  const raw = String(key);
  const first = raw.indexOf(":");
  const second = first < 0 ? -1 : raw.indexOf(":", first + 1);
  if (first < 0 || second < 0) return null;
  return {
    routeId: raw.slice(0, first),
    kind: raw.slice(first + 1, second),
    featureId: raw.slice(second + 1),
  };
}

export function novaParallelImpactObjectIds(ids, kind) {
  const prefix = `${kind}:`;
  return [...(ids instanceof Set ? ids : Array.isArray(ids) ? ids : [])]
    .map(String)
    .filter((id) => id.startsWith(prefix))
    .map((id) => id.slice(prefix.length))
    .filter(Boolean)
    .sort();
}

export function firstFleeingPolygonCrossingProgress(parts, geometry) {
  return firstCumulativeHit(parts, (start, end) => firstLocalPolygonHit(start, end, geometry));
}

export function firstFleeingLineCrossingProgress(parts, geometry) {
  return firstCumulativeHit(parts, (start, end) => firstLocalLineHit(start, end, geometry));
}

export function buildFleeingCrossingIndex(routes, features) {
  const index = new Map();
  for (const feature of Array.isArray(features) ? features : []) {
    const kind = fleeingFeatureKind(feature?.geometry);
    const featureId = String(feature?.properties?.OBJECTID ?? feature?.id ?? "");
    if (!kind || !featureId) continue;
    for (const route of Array.isArray(routes) ? routes : []) {
      const routeId = String(route?.properties?.OBJECTID ?? route?.id ?? "");
      if (!routeId) continue;
      const parts = routeParts(route);
      const u = kind === NOVA_PARALLEL_IMPACT_KIND_LINE
        ? firstFleeingLineCrossingProgress(parts, feature.geometry)
        : firstFleeingPolygonCrossingProgress(parts, feature.geometry);
      if (u != null) index.set(`${routeId}:${kind}:${featureId}`, u);
    }
  }
  return index;
}

export function novaParallelImpactFeatureIds({
  routes,
  features,
  progressByObjectId,
  crossingIndex,
} = {}) {
  const index = crossingIndex instanceof Map
    ? crossingIndex
    : buildFleeingCrossingIndex(routes, features);
  const result = new Set();
  for (const [key, u] of index) {
    const parsed = parseCrossingKey(key);
    if (!parsed) continue;
    const { routeId, kind, featureId } = parsed;
    if (!kind || !featureId) continue;
    const progress = lookupProgress(progressByObjectId, routeId);
    if (progress <= 0) continue;
    if (progress + EPSILON >= u) result.add(`${kind}:${featureId}`);
  }
  return result;
}
