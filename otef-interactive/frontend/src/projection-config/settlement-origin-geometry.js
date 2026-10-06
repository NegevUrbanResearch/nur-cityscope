import { nearestSettlementBoundaryHit } from '../projection/settlement-name-connectors.js';

export function validSettlementOriginGeometry(value) {
  if (value == null) return true;
  if (typeof value.citycode !== 'string' || !value.citycode || ![value.point?.x, value.point?.y].every(Number.isFinite)) return false;
  const world = value.worldRings, projected = value.projectedRings;
  if (!Array.isArray(world) || !world.length || world.length > 128 || !Array.isArray(projected) || world.length !== projected.length) return false;
  const finitePoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
  return world.every((ring, i) => Array.isArray(ring) && ring.length >= 2 && ring.length <= 20000
    && Array.isArray(projected[i]) && ring.length === projected[i].length && ring.every(finitePoint) && projected[i].every(finitePoint));
}

/** Snap a pointer in map pixels to an outline edge and retain its geographic location. */
export function snapSettlementOrigin(point, worldRings, projectedRings) {
  const hit = nearestSettlementBoundaryHit(projectedRings, point);
  if (!hit) return null;
  const ring = worldRings?.[hit.ringIndex];
  const a = ring?.[hit.segmentIndex], b = ring?.[(hit.segmentIndex + 1) % ring.length];
  if (!a || !b || ![...a, ...b].every(Number.isFinite)) return null;
  const t = hit.fraction;
  return { origin: { lng: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t }, point: hit.point };
}
