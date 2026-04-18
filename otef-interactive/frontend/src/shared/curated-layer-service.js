/**
 * Shared curated-layer service — renderer-agnostic helpers for fetching,
 * parsing, and building curated-layer data used by both the Leaflet GIS map
 * and the Canvas projection display.
 *
 * Consumers:
 *   - leaflet-control-with-basemap.js  (Leaflet / GIS)
 *   - projection-layer-manager.js      (Canvas / projection)
 */

import {
  parseDefaultLinePaths,
  buildIntegratedRoute,
} from "../map-utils/pink-line-route.js";
import AdvancedStyleEngine from "../map-utils/advanced-style-engine.js";
import layerRegistry from "./layer-registry.js";

/**
 * Full layer ids for the canonical pink-line geometry (same GeoJSON the GIS map
 * loads from the processed layer pack). Some deployments still use the legacy
 * `הקו_הורוד` id while newer manifests expose `הציר_הורוד_חדש`.
 */
const PINK_LINE_PACK_LAYER_IDS = [
  "future_development.הציר_הורוד_חדש",
  "future_development.הקו_הורוד",
];

const PINK_LINE_LAYER_SUFFIX_PRIORITY = ["הציר_הורוד_חדש", "הקו_הורוד"];

/**
 * Build ordered full layer ids for pink-line pack GeoJSON: manifest-driven
 * first (via registry), then {@link PINK_LINE_PACK_LAYER_IDS} for legacy ids.
 *
 * @param {{ getAllLayerIds?: () => string[], getLayerDataUrl?: (id: string) => string | null }} registry
 * @returns {string[]}
 */
function collectPinkLinePackFullLayerIds(registry) {
  const out = [];
  const seen = new Set();
  const add = (id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  };

  if (registry && typeof registry.getAllLayerIds === "function") {
    const all = registry.getAllLayerIds();
    const ranked = [];
    if (Array.isArray(all)) {
      for (const fullId of all) {
        if (!fullId || typeof fullId !== "string") continue;
        const dot = fullId.indexOf(".");
        if (dot < 0) continue;
        const layerOnly = fullId.slice(dot + 1);
        const rank = PINK_LINE_LAYER_SUFFIX_PRIORITY.indexOf(layerOnly);
        if (rank >= 0) ranked.push({ fullId, rank });
      }
    }
    ranked.sort((a, b) => a.rank - b.rank || a.fullId.localeCompare(b.fullId));
    ranked.forEach((x) => add(x.fullId));
  }

  for (const id of PINK_LINE_PACK_LAYER_IDS) add(id);
  return out;
}

/**
 * Stroke from `future_development` pink-line .lyrx when styles.json is not
 * loaded (e.g. empty registry in isolated tests). Matches processed pack output.
 */
const PINK_LINE_PACK_STYLE_FALLBACK = {
  renderer: "simple",
  defaultStyle: {
    color: "#ff7f7f",
    weight: 1.3333333333333333,
    opacity: 1,
  },
};

/**
 * @param {Object} leafletProps
 * @returns {{ color: string, weight: number, opacity: number, dashArray?: string }}
 */
function leafletPropsToPolylineOptions(leafletProps) {
  const p = leafletProps || {};
  const out = {
    color: p.color,
    weight: p.weight,
    opacity: p.opacity,
  };
  if (p.dashArray != null) {
    out.dashArray = Array.isArray(p.dashArray)
      ? p.dashArray.join(",")
      : String(p.dashArray);
  }
  return out;
}

/**
 * Resolve pink-line symbology from the same pack styles.json entry the GIS map
 * uses for `future_development` line layers (priority matches GeoJSON fetch).
 *
 * @returns {Promise<{
 *   styleConfigForProjection: { style: Object },
 *   leafletPolylineOptions: { color: string, weight: number, opacity: number, dashArray?: string },
 *   styleFunction: (feature: object) => object,
 *   geometryType: string,
 *   sourceFullLayerId: string | null
 * }>}
 */
async function resolvePinkLinePackStyleBundle() {
  if (layerRegistry && typeof layerRegistry.init === "function") {
    await layerRegistry.init();
  }

  const ids = collectPinkLinePackFullLayerIds(layerRegistry);
  let packStyle = null;
  let geometryType = "line";
  let sourceFullLayerId = null;

  for (const fullId of ids) {
    const raw =
      layerRegistry && typeof layerRegistry.getPackStyleJsonForLayer === "function"
        ? layerRegistry.getPackStyleJsonForLayer(fullId)
        : null;
    if (!raw) {
      continue;
    }
    packStyle = raw;
    sourceFullLayerId = fullId;
    if (typeof layerRegistry.getLayerConfig === "function") {
      const cfg = layerRegistry.getLayerConfig(fullId);
      if (cfg && cfg.geometryType) {
        geometryType = cfg.geometryType;
      }
    }
    break;
  }

  if (!packStyle) {
    packStyle = PINK_LINE_PACK_STYLE_FALLBACK;
    sourceFullLayerId = null;
  }

  const layerConfigForEngine = { geometryType, style: packStyle };
  const styleFunction =
    AdvancedStyleEngine &&
    typeof AdvancedStyleEngine.getLeafletStyleFunction === "function"
      ? AdvancedStyleEngine.getLeafletStyleFunction(layerConfigForEngine)
      : () => ({ color: "#ff7f7f", weight: 1.3333333333333333, opacity: 1 });

  const leafletPolylineOptions = leafletPropsToPolylineOptions(styleFunction({}));

  return {
    styleConfigForProjection: { style: packStyle },
    leafletPolylineOptions,
    styleFunction,
    geometryType,
    sourceFullLayerId,
  };
}

let _pinkLinePackUnavailableLogged = false;

function warnPinkLinePackEmptyOnce() {
  if (
    typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.MODE === "test"
  ) {
    return;
  }
  if (_pinkLinePackUnavailableLogged) return;
  _pinkLinePackUnavailableLogged = true;
  console.warn(
    "[CuratedLayerService] Pink line unavailable: OTEF processed layer pack did not provide usable line geometry (pack-only).",
  );
}

// ---------------------------------------------------------------------------
// Memorial icon configuration (shared between curation, map, and projection)
// ---------------------------------------------------------------------------

const MEMORIAL_ICON_URLS = {
  central: "/otef-interactive/img/memorial-sites/regional-memorial-site.png",
  local: "/otef-interactive/img/memorial-sites/local-memorial-site.png",
};

/**
 * Return the memorial icon URL for a feature based on feature_type, or null
 * when the feature is not a memorial.
 *
 * @param {Object} props - Feature properties
 * @returns {string|null}
 */
function getMemorialIconForFeature(props) {
  const p = props || {};
  const rawType = p.feature_type;
  if (!rawType) return null;
  const key = String(rawType).toLowerCase();
  return MEMORIAL_ICON_URLS[key] || null;
}

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
  const groupId = parts[0] || "";
  if (!groupId.startsWith("curated") || parts.length < 2) return null;
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

/**
 * Memorial `feature_type` values must not contribute to pink detour / integrated
 * route geometry (only route nodes and untyped points do).
 *
 * @param {unknown} featureType - `properties.feature_type`
 * @returns {boolean}
 */
function isPinkDetourPointFeatureType(featureType) {
  if (featureType === null || featureType === undefined) return true;
  if (typeof featureType !== "string") return false;
  const normalized = featureType.trim().toLowerCase();
  if (normalized === "central" || normalized === "local") return false;
  if (normalized === "") return true;
  return normalized === "pink_line_node";
}

/**
 * Like {@link extractPointFeatures}, but only Point features whose
 * `feature_type` is `pink_line_node` (any case), missing, `null`, or `""`
 * after trim. Memorial types `central` and `local` are excluded.
 *
 * @param {Object} geojson - GeoJSON FeatureCollection
 * @returns {Array<{feature: Object, latlng: [number, number]}>}
 */
function extractPinkDetourPointFeatures(geojson) {
  const list = [];
  if (!geojson || !geojson.features) return list;
  for (const f of geojson.features) {
    const geom = f.geometry;
    if (!geom || geom.type !== "Point" || !geom.coordinates) continue;
    const props = f.properties || {};
    if (!isPinkDetourPointFeatureType(props.feature_type)) continue;
    const c = geom.coordinates;
    list.push({ feature: f, latlng: [c[1], c[0]] });
  }
  return list;
}

// ---------------------------------------------------------------------------
// fetchPinkLinePaths
// ---------------------------------------------------------------------------
/**
 * Load pink-line geometry from the processed OTEF layer pack (same source as
 * GIS / projection for the canonical pink-line layer in `future_development`).
 *
 * @returns {Promise<{basePaths: Array, pinkGeojson: Object|null}>}
 */
async function fetchPinkLinePathsFromLayerPack() {
  if (typeof parseDefaultLinePaths !== "function") {
    return { basePaths: [], pinkGeojson: null };
  }
  try {
    if (layerRegistry && typeof layerRegistry.init === "function") {
      await layerRegistry.init();
    }
    const fullLayerIds = collectPinkLinePackFullLayerIds(layerRegistry);
    for (const fullLayerId of fullLayerIds) {
      const url =
        layerRegistry && typeof layerRegistry.getLayerDataUrl === "function"
          ? layerRegistry.getLayerDataUrl(fullLayerId)
          : null;
      if (!url) continue;
      const res = await fetch(url);
      if (!res.ok) continue;
      const pinkGeojson = await res.json();
      const basePaths = parseDefaultLinePaths(pinkGeojson);
      if (basePaths.length > 0) {
        return { basePaths, pinkGeojson };
      }
    }
  } catch (err) {
    const isDev =
      typeof import.meta !== "undefined" &&
      import.meta.env &&
      import.meta.env.DEV &&
      import.meta.env.MODE !== "test";
    if (isDev) {
      console.warn("[CuratedLayerService] Pink line layer pack load failed:", err);
    }
  }
  warnPinkLinePackEmptyOnce();
  return { basePaths: [], pinkGeojson: null };
}

/**
 * Fetch pink-line base paths for integrated curation / curated routes.
 * Uses only the processed OTEF layer pack (same GeoJSON URLs as the GIS map);
 * there is no alternate HTTP source for this geometry.
 *
 * @returns {Promise<{basePaths: Array, pinkGeojson: Object|null}>}
 */
async function fetchPinkLinePaths() {
  if (typeof parseDefaultLinePaths !== "function") {
    return { basePaths: [], pinkGeojson: null };
  }
  return fetchPinkLinePathsFromLayerPack();
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

  // Point markers (nodes) – attach per-point curated style, including
  // memorial icon styles when feature_type is "central" or "local".
  pointFeatures.forEach((f) => {
    const c = f.geometry.coordinates;
    const props = f.properties || {};
    const memorialIcon = getMemorialIconForFeature(props);

    let curatedStyle;
    if (memorialIcon) {
      // Memorial nodes render as icons on the projector canvas.
      curatedStyle = {
        _iconUrl: memorialIcon,
        _iconSize: 32,
      };
    } else {
      // Non-memorial nodes use the existing circular style.
      curatedStyle = {
        fillColor: layerColor,
        color: "#fff",
        weight: 1,
        fillOpacity: 0.9,
        opacity: 1,
        radius: 6,
      };
    }

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [c[0], c[1]] },
      properties: {
        ...props,
        _curatedStyle: curatedStyle,
      },
    });
  });

  return { type: "FeatureCollection", features };
}

export {
  fetchCuratedLayerData,
  extractPointFeatures,
  extractPinkDetourPointFeatures,
  fetchPinkLinePaths,
  buildCuratedRouteGeoJSON,
  MEMORIAL_ICON_URLS,
  getMemorialIconForFeature,
  resolvePinkLinePackStyleBundle,
};
