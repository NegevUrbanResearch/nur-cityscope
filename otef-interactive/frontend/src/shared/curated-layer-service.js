/**
 * Shared curated-layer service — renderer-agnostic helpers for fetching,
 * parsing, and building curated-layer data used by both the Leaflet GIS map
 * and the Canvas projection display.
 *
 * Consumers:
 *   - leaflet-control-with-basemap.js  (Leaflet / GIS)
 *   - projection-layer-manager.js      (Canvas / projection)
 */

// ---------------------------------------------------------------------------
// fetchCuratedLayerData
// ---------------------------------------------------------------------------
/**
 * Fetch a single curated layer's GeoJSON from the OTEF layers API.
 *
 * @param {string} fullLayerId - e.g. "curated.42"
 * @returns {Promise<{geojson: Object, layerData: Object} | null>}
 *   Resolves with the parsed GeoJSON and raw API record, or `null` when
 *   the layer cannot be found / is not of type "geojson".
 */
async function fetchCuratedLayerData(fullLayerId) {
  const parts = fullLayerId.split(".");
  if (parts[0] !== "curated" || parts.length < 2) return null;
  const layerId = parts.slice(1).join(".");

  let response;
  try {
    response = await fetch("/api/actions/get_otef_layers/?table=otef");
    if (!response.ok) throw new Error(response.status);
  } catch (e) {
    console.warn("[CuratedLayerService] Failed to fetch OTEF layers:", e);
    return null;
  }

  const list = await response.json();
  const layerData = Array.isArray(list)
    ? list.find((l) => String(l.id) === String(layerId))
    : null;
  if (!layerData || layerData.layer_type !== "geojson") return null;

  let geojson = layerData.geojson;
  if (!geojson && layerData.url) {
    const r = await fetch(layerData.url);
    if (!r.ok) throw new Error(r.status);
    geojson = await r.json();
  }
  if (!geojson || !geojson.features) return null;

  return { geojson, layerData };
}

// ---------------------------------------------------------------------------
// extractPointFeatures
// ---------------------------------------------------------------------------
/**
 * Extract Point features (with full properties) and their [lat, lng] coords
 * from a GeoJSON FeatureCollection.  Used to build marker/node layers.
 *
 * @param {Object} geojson - GeoJSON FeatureCollection
 * @returns {Array<{feature: Object, latlng: [number, number]}>}
 */
function extractPointFeatures(geojson) {
  const list = [];
  if (!geojson || !geojson.features) return list;
  for (const f of geojson.features) {
    const geom = f.geometry;
    if (!geom || geom.type !== "Point" || !geom.coordinates) continue;
    const c = geom.coordinates;
    list.push({ feature: f, latlng: [c[1], c[0]] });
  }
  return list;
}

// ---------------------------------------------------------------------------
// fetchPinkLinePaths
// ---------------------------------------------------------------------------
/**
 * Fetch the pink-line base data from `/api/pink-line/` and parse it into an
 * array of path coordinate arrays via the global `parseDefaultLinePaths`.
 *
 * Returns an empty array when the endpoint is unreachable or the parser
 * is not available.
 *
 * @returns {Promise<{basePaths: Array, pinkGeojson: Object|null}>}
 */
async function fetchPinkLinePaths() {
  if (typeof parseDefaultLinePaths !== "function") {
    return { basePaths: [], pinkGeojson: null };
  }
  try {
    const pinkRes = await fetch("/api/pink-line/");
    if (!pinkRes.ok) return { basePaths: [], pinkGeojson: null };
    const pinkGeojson = await pinkRes.json();
    const basePaths = parseDefaultLinePaths(pinkGeojson);
    return { basePaths, pinkGeojson };
  } catch (_) {
    return { basePaths: [], pinkGeojson: null };
  }
}

// ---------------------------------------------------------------------------
// buildCuratedRouteGeoJSON
// ---------------------------------------------------------------------------
/**
 * Build a renderer-agnostic GeoJSON FeatureCollection that represents a
 * curated route overlay: dashed route segments in `layerColor` plus styled
 * point markers for every node.
 *
 * This uses the global `buildIntegratedRoute(basePaths, userPoints)` helper
 * to compute the integrated route variation.
 *
 * @param {Array}  basePaths     - Parsed pink-line base paths
 * @param {Array}  userPoints    - [[lat, lng], …] from extracted points
 * @param {string} layerColor    - CSS hex color for this layer
 * @param {Array}  pointFeatures - Original GeoJSON Point features
 * @returns {Object|null} - GeoJSON FeatureCollection or null if route
 *   cannot be built (missing `buildIntegratedRoute` or empty paths).
 */
function buildCuratedRouteGeoJSON(basePaths, userPoints, layerColor, pointFeatures) {
  if (
    typeof buildIntegratedRoute !== "function" ||
    basePaths.length === 0 ||
    userPoints.length === 0
  ) {
    return null;
  }

  const { dashed } = buildIntegratedRoute(basePaths, userPoints);
  const features = [];

  // Dashed route segments
  dashed.forEach((path) => {
    const coords = path.map(([lat, lng]) => [lng, lat]);
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: {
        _curatedStyle: {
          color: layerColor,
          weight: 5,
          opacity: 0.9,
          dashArray: [10, 10],
        },
      },
    });
  });

  // Point markers (nodes)
  pointFeatures.forEach((f) => {
    const c = f.geometry.coordinates;
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [c[0], c[1]] },
      properties: {
        ...f.properties,
        _curatedStyle: {
          fillColor: layerColor,
          color: "#fff",
          weight: 1,
          fillOpacity: 0.9,
          opacity: 1,
          radius: 6,
        },
      },
    });
  });

  return { type: "FeatureCollection", features };
}

export {
  fetchCuratedLayerData,
  extractPointFeatures,
  fetchPinkLinePaths,
  buildCuratedRouteGeoJSON,
};
