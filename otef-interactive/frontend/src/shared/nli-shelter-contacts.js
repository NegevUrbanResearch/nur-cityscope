/** Spatial contacts at immutable source points, indexed once per input revision. */
import { buildLinePathMetrics } from "./maplibre-line-progress-primitives.js";
import {
  isUnconfirmedRoute,
  unconfirmedLineCoordinates,
} from "./nli-unconfirmed-route-progress.js";
import { orientInvestigationLineFeature } from "./nli-investigation-route-geometry.js";
import { visibleInvestigationFeatures } from "./nli-investigation-visibility.js";

export const SHELTER_ITM =
  "+proj=tmerc +lat_0=31.73439361111111 +lon_0=35.20451694444445 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=-24.0024,-17.1032,-17.8444,0.33077,-1.85269,1.66969,5.4248 +units=m +no_defs";
export const SHELTER_CONTACT_METERS = 25;
// GIS/projection pages load proj4 before their native module entry. A bare
// package import here would require a bundler and break the nginx-served pages.
const metric = (coordinate) => {
  if (typeof globalThis.proj4 !== "function") {
    throw new Error("Shelter contact projection is unavailable");
  }
  return globalThis.proj4("EPSG:4326", SHELTER_ITM, coordinate);
};
const objectId = (f) => String(f?.properties?.OBJECTID ?? f?.id);
const valid = (p) =>
  Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(Number.isFinite);
const parts = (g) =>
  (g?.type === "LineString"
    ? [g.coordinates]
    : g?.type === "MultiLineString"
      ? g.coordinates
      : []
  ).filter((p) => Array.isArray(p) && p.length > 1 && p.every(valid));
const sq = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

function segmentEntry(p, a, b, radius) {
  if (sq(p, a) <= radius ** 2 + 1e-6) return 0;
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    ax = a[0] - p[0],
    ay = a[1] - p[1];
  const aa = dx * dx + dy * dy;
  if (aa <= 1e-14) return null;
  const bb = 2 * (ax * dx + ay * dy),
    cc = ax * ax + ay * ay - radius * radius;
  const discriminant = bb * bb - 4 * aa * cc;
  if (discriminant < -1e-5) return null;
  const t = (-bb - Math.sqrt(Math.max(0, discriminant))) / (2 * aa);
  return t >= -1e-9 && t <= 1 + 1e-9 ? Math.max(0, Math.min(1, t)) : null;
}

function insideRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

function polygonTouches(p, geometry, radius) {
  const polygons =
    geometry?.type === "Polygon"
      ? [geometry.coordinates]
      : geometry?.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  return polygons.some((polygon) => {
    const rings = polygon
      .filter((r) => Array.isArray(r) && r.length >= 4 && r.every(valid))
      .map((r) => r.map(metric));
    if (!rings.length) return false;
    if (
      insideRing(p, rings[0]) &&
      !rings.slice(1).some((r) => insideRing(p, r))
    )
      return true;
    return rings.some((r) =>
      r.some(
        (a, i) => segmentEntry(p, a, r[(i + 1) % r.length], radius) != null,
      ),
    );
  });
}

// @maplibre/geojson-vt convert.ts: lineMetrics explodes multipart lines and
// accumulates Euclidean normalized Web Mercator length separately per part.
function gradientMetrics(coords) {
  const mercator = coords.map(([lon, lat]) => [
    lon / 360 + 0.5,
    0.5 -
      Math.log(
        (1 + Math.sin((lat * Math.PI) / 180)) /
          (1 - Math.sin((lat * Math.PI) / 180)),
      ) /
        (4 * Math.PI),
  ]);
  const cumulative = [0];
  for (let i = 1; i < mercator.length; i++)
    cumulative.push(
      cumulative[i - 1] + Math.sqrt(sq(mercator[i], mercator[i - 1])),
    );
  return { cumulative, total: cumulative.at(-1) };
}

function firstContact(p, coords, radius, metrics) {
  if (coords.length < 2 || !(metrics.total > 0)) return Infinity;
  const projected = coords.map(metric);
  for (let i = 1; i < projected.length; i++) {
    const t = segmentEntry(p, projected[i - 1], projected[i], radius);
    if (t != null)
      return (
        (metrics.cumulative[i - 1] +
          t * (metrics.cumulative[i] - metrics.cumulative[i - 1])) /
        metrics.total
      );
  }
  return Infinity;
}

export function buildShelterContactIndex({
  shelters = [],
  polygonFeatures = [],
  lineFeatures = [],
  toleranceMeters = SHELTER_CONTACT_METERS,
} = {}) {
  if (!Number.isFinite(toleranceMeters) || toleranceMeters < 0)
    throw new Error("Invalid shelter contact tolerance");
  const polygons = visibleInvestigationFeatures(polygonFeatures);
  const lines = lineFeatures
    .filter((f) => !isUnconfirmedRoute(f))
    .map(orientInvestigationLineFeature);
  const index = new Map();
  for (const shelter of shelters) {
    if (!valid(shelter?.geometry?.coordinates))
      throw new Error("Invalid source shelter coordinate");
    const p = metric(shelter.geometry.coordinates);
    const polygonContacts = polygons
      .filter((f) => polygonTouches(p, f.geometry, toleranceMeters))
      .map((f) => ({
        id: objectId(f),
        minute: Number(f.properties?.timeline_minutes),
      }));
    const lineContacts = new Map();
    for (const line of lines) {
      const rendered = parts(line.geometry);
      const gradient = Math.min(
        ...rendered.map((c) =>
          firstContact(p, c, toleranceMeters, gradientMetrics(c)),
        ),
      );
      const longest = unconfirmedLineCoordinates(line);
      const clip = firstContact(
        p,
        longest,
        toleranceMeters,
        buildLinePathMetrics(longest),
      );
      if (Number.isFinite(gradient) || Number.isFinite(clip))
        lineContacts.set(objectId(line), { gradient, clip });
    }
    index.set(shelter.id, { polygonContacts, lineContacts });
  }
  return index;
}

export function deriveShelterImpactIds({
  frame = {},
  polygonVisible = false,
  confirmedCompleted = [],
  confirmedActive = [],
  contactIndex = new Map(),
} = {}) {
  const achievedIds = Array.isArray(frame.achievedPolygonObjectIds)
    ? new Set(frame.achievedPolygonObjectIds.map(String))
    : null;
  const beats = new Set(frame.achievedPolygonBeats || []);
  const impacted = new Set();
  for (const [id, contact] of contactIndex) {
    const polygonHit =
      polygonVisible &&
      contact.polygonContacts.some((c) =>
        achievedIds ? achievedIds.has(c.id) : beats.has(c.minute),
      );
    const completedHit = confirmedCompleted.some(
      (f) =>
        !isUnconfirmedRoute(f) &&
        Number.isFinite(contact.lineContacts.get(objectId(f))?.gradient),
    );
    const activeHit = confirmedActive.some(
      ({ feature, progress, clipGeometry }) => {
        if (isUnconfirmedRoute(feature) || !(progress > 0)) return false;
        const threshold = contact.lineContacts.get(objectId(feature))?.[
          clipGeometry ? "clip" : "gradient"
        ];
        return Number.isFinite(threshold) && progress >= threshold;
      },
    );
    if (polygonHit || completedHit || activeHit) impacted.add(id);
  }
  return impacted;
}
