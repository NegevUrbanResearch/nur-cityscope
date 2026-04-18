/**
 * Pure helpers for curated pink Leaflet rendering (GeoJSON → lat/lng paths,
 * palette resolution, off-road segment detection). Kept importable without Leaflet.
 */

const VALID_CSS_HEX_6 = /^#[0-9A-Fa-f]{6}$/;

/**
 * @param {string | null | undefined} displayColorHex
 * @returns {string | null} normalized `#RRGGBB` or null when invalid
 */
export function sanitizeDisplayColorHex(displayColorHex) {
  if (displayColorHex == null) return null;
  const raw = String(displayColorHex).trim();
  if (!VALID_CSS_HEX_6.test(raw)) return null;
  return `#${raw.slice(1).toUpperCase()}`;
}

/**
 * First feature in the collection with a palette-valid `display_color`.
 *
 * @param {{ features?: Array<{ properties?: Record<string, unknown> }> } | null | undefined} geojson
 * @returns {string | null}
 */
export function resolveFirstDisplayColorFromGeojson(geojson) {
  if (!geojson?.features) return null;
  for (const f of geojson.features) {
    const h = sanitizeDisplayColorHex((f.properties || {}).display_color);
    if (h) return h;
  }
  return null;
}

/**
 * First `pink_line_route` line geometry in publish order: GeoJSON [lng,lat] → Leaflet paths [[lat,lng], …].
 *
 * @param {{ features?: Array<Record<string, unknown>> } | null | undefined} geojson
 * @returns {{ feature: Record<string, unknown> | null; pathsLatLng: Array<Array<[number, number]>> }}
 */
export function parsePinkLineRouteFromGeojson(geojson) {
  if (!geojson?.features) return { feature: null, pathsLatLng: [] };
  for (const f of geojson.features) {
    const ft = f.properties?.feature_type;
    if (ft !== "pink_line_route") continue;
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "LineString" && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
      return {
        feature: f,
        pathsLatLng: [g.coordinates.map((c) => [c[1], c[0]])],
      };
    }
    if (g.type === "MultiLineString" && Array.isArray(g.coordinates)) {
      const pathsLatLng = g.coordinates
        .filter((line) => Array.isArray(line) && line.length >= 2)
        .map((line) => line.map((c) => [c[1], c[0]]));
      if (pathsLatLng.length > 0) return { feature: f, pathsLatLng };
    }
  }
  return { feature: null, pathsLatLng: [] };
}

/**
 * @param {number} aLat
 * @param {number} aLng
 * @param {number} bLat
 * @param {number} bLng
 * @returns {number}
 */
export function haversineMeters(aLat, aLng, bLat, bLng) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const m =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(m)));
}

/**
 * Consecutive edges longer than `gapMeters` (two vertices only per segment).
 *
 * @param {Array<Array<[number, number]>>} pathsLatLng
 * @param {number} gapMeters
 * @returns {Array<Array<[number, number]>>}
 */
export function findOffroadTwoPointSegments(pathsLatLng, gapMeters) {
  const out = [];
  for (const path of pathsLatLng) {
    for (let i = 0; i < path.length - 1; i++) {
      const [lat1, lng1] = path[i];
      const [lat2, lng2] = path[i + 1];
      if (haversineMeters(lat1, lng1, lat2, lng2) > gapMeters) {
        out.push([
          [lat1, lng1],
          [lat2, lng2],
        ]);
      }
    }
  }
  return out;
}
