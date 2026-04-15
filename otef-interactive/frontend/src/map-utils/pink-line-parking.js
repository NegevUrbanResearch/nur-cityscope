/**
 * Pink-line companion: parking lots along the heritage axis (ported from nur-colab-map
 * `public/line-layer` + `utils/parkingLayer.ts`). Static GeoJSON + shared icon URL;
 * no generic API fallback — missing assets are non-fatal.
 */

const PINK_LINE_PARKING_GEOJSON_URL =
  "/otef-interactive/img/pink-line-parking/parking-lots.geojson";
const PINK_LINE_PARKING_ICON_URL =
  "/otef-interactive/img/pink-line-parking/parking-icon.png";

function escapeHtmlParking(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Popup HTML for a parking feature (matches colab default copy when empty).
 *
 * @param {Record<string, unknown> | null | undefined} props
 * @returns {string}
 */
function formatParkingLotPopupHtml(props) {
  const p = props || {};
  const name = p.name != null && String(p.name).trim() !== "" ? String(p.name) : null;
  const notes = p.notes != null && String(p.notes).trim() !== "" ? String(p.notes) : null;
  const parts = [];
  if (name) parts.push(`<strong>${escapeHtmlParking(name)}</strong>`);
  if (notes) parts.push(escapeHtmlParking(notes));
  if (parts.length > 0) return parts.join("<br/>");
  return "חניה פוטנציאלית";
}

/**
 * @returns {Promise<import("geojson").FeatureCollection | null>}
 */
async function fetchPinkLineParkingLotsGeojson() {
  try {
    const res = await fetch(PINK_LINE_PARKING_GEOJSON_URL);
    if (!res.ok) return null;
    const geojson = await res.json();
    if (!geojson || geojson.type !== "FeatureCollection" || !Array.isArray(geojson.features)) {
      return null;
    }
    return geojson;
  } catch (_) {
    return null;
  }
}

/**
 * Leaflet layer group of parking markers (not added to the map).
 *
 * @param {typeof import("leaflet")} L
 * @param {import("geojson").FeatureCollection} geojson
 * @param {string} iconUrl
 * @returns {import("leaflet").LayerGroup | null}
 */
function createLeafletPinkLineParkingGroup(L, geojson, iconUrl) {
  if (!L || !geojson || !Array.isArray(geojson.features)) return null;
  const icon = L.icon({
    iconUrl,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -18],
    className: "pink-line-parking-marker-icon",
  });
  const group = L.layerGroup();
  for (const f of geojson.features) {
    const g = f.geometry;
    if (!g || g.type !== "Point" || !Array.isArray(g.coordinates)) continue;
    const c = g.coordinates;
    const lng = c[0];
    const lat = c[1];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const html = formatParkingLotPopupHtml(f.properties);
    L.marker([lat, lng], { icon }).bindPopup(html).addTo(group);
  }
  if (!group.getLayers().length) return null;
  return group;
}

/**
 * WGS84 FeatureCollection with per-feature `_curatedStyle` for projection canvas
 * (same contract as memorial / curated point nodes).
 *
 * @param {import("geojson").FeatureCollection} geojson
 * @param {string} iconUrl
 * @returns {import("geojson").FeatureCollection}
 */
function enrichParkingGeojsonForProjection(geojson, iconUrl) {
  const features = [];
  if (!geojson || !Array.isArray(geojson.features)) {
    return { type: "FeatureCollection", features };
  }
  for (const f of geojson.features) {
    const g = f.geometry;
    if (!g || g.type !== "Point" || !Array.isArray(g.coordinates)) continue;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [g.coordinates[0], g.coordinates[1]] },
      properties: {
        ...(f.properties || {}),
        _curatedStyle: { _iconUrl: iconUrl, _iconSize: 36 },
      },
    });
  }
  return { type: "FeatureCollection", features };
}

export {
  PINK_LINE_PARKING_GEOJSON_URL,
  PINK_LINE_PARKING_ICON_URL,
  escapeHtmlParking,
  formatParkingLotPopupHtml,
  fetchPinkLineParkingLotsGeojson,
  createLeafletPinkLineParkingGroup,
  enrichParkingGeojsonForProjection,
};
