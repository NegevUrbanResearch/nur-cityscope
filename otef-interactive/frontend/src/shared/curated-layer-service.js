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
import {
  colabBundleHasRenderableGeometry,
  parseColabRouteGeometryBundle,
} from "../map-utils/colab-route-geometry-bundle.js";
import {
  routeLineStylesForDisplayColor,
  STORED_PINK_ROUTE_OFFROAD_GAP_METERS,
} from "../map-utils/pink-route-map-styles.js";
import {
  clipProposedPathsLatLngExcludingOffroadGaps,
  collectOffroadJunctionLatLngs,
  findOffroadTwoPointSegments,
  parsePinkLineRouteFromGeojson,
  resolveFirstDisplayColorFromGeojson,
  sanitizeDisplayColorHex,
} from "../map/leaflet-curated-pink-helpers.js";
import {
  isAllowedSubmissionDisplayColor,
  normalizeSubmissionDisplayColorHex,
} from "../map-utils/submission-display-color.js";
import {
  assignPinkNodeDisplayOrders,
  isPinkDetourNumberingPoint,
} from "../map-utils/pink-route-optimizer.js";
import AdvancedStyleEngine from "../map-utils/advanced-style-engine.js";
import layerRegistry from "./layer-registry.js";
import MapProjectionConfig from "./map-projection-config.js";

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
 * @returns {{ color: string, weight: number, opacity: number, dashArray?: string, lineCap?: string, lineJoin?: string }}
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
  if (p.lineCap != null) out.lineCap = p.lineCap;
  if (p.lineJoin != null) out.lineJoin = p.lineJoin;
  return out;
}

/**
 * Resolve pink-line symbology from the same pack styles.json entry the GIS map
 * uses for `future_development` line layers (priority matches GeoJSON fetch).
 *
 * MATCH (curated parity): **color**, **weight**, **opacity**, **lineCap**, and **lineJoin**
 * align to `routeLineStylesForDisplayColor(null).axisPackLine` (regional axis pack line, not overlay
 * `solidLine`). **`dashArray`** is taken from the pack / raw style only when the raw style provides
 * it (spread raw first, then overlay axis-pack tokens) so dashed pack lines stay dashed while the
 * default pink axis stays solid.
 *
 * @returns {Promise<{
 *   styleConfigForProjection: { style: Object },
 *   leafletPolylineOptions: { color: string, weight: number, opacity: number, dashArray?: string, lineCap?: string, lineJoin?: string },
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
  const rawStyleFunction =
    AdvancedStyleEngine &&
    typeof AdvancedStyleEngine.getLeafletStyleFunction === "function"
      ? AdvancedStyleEngine.getLeafletStyleFunction(layerConfigForEngine)
      : () => ({ color: "#ff7f7f", weight: 1.3333333333333333, opacity: 1 });

  const curatedAxisPackLine = routeLineStylesForDisplayColor(null).axisPackLine;
  const styleFunction = (feature) => {
    const s = rawStyleFunction(feature) || {};
    return {
      ...s,
      color: curatedAxisPackLine.color,
      weight: curatedAxisPackLine.weight,
      opacity: curatedAxisPackLine.opacity,
      lineCap: curatedAxisPackLine.lineCap,
      lineJoin: curatedAxisPackLine.lineJoin,
    };
  };

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
 * Like {@link extractPointFeatures}, but only Point features that pass
 * {@link isPinkDetourNumberingPoint} (pink_line_node / untyped detour points;
 * memorial types and `pink_offroad_junction` excluded).
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
    if (!isPinkDetourNumberingPoint(props)) continue;
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
      // Non-memorial nodes: Colab-aligned ~30px diameter on canvas.
      curatedStyle = {
        fillColor: layerColor,
        color: "#fff",
        weight: 2,
        fillOpacity: 0.9,
        opacity: 1,
        radius: 15,
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

function parseDashArrayToNumbers(value) {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const nums = value.map((v) => Number(v)).filter((n) => !Number.isNaN(n));
    return nums.length ? nums : null;
  }
  if (typeof value === "string") {
    const nums = value
      .split(/[\s,]+/)
      .map((x) => Number(String(x).trim()))
      .filter((n) => !Number.isNaN(n));
    return nums.length ? nums : null;
  }
  return null;
}

/** @param {unknown} value */
function parseDashOffsetToNumber(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(String(value).trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * @param {Record<string, unknown>} leafletLike
 * @returns {Record<string, unknown>}
 */
function leafletPolylineLikeToCuratedCanvas(leafletLike) {
  if (!leafletLike) return {};
  const out = {
    color: leafletLike.color,
    weight: leafletLike.weight,
    opacity: leafletLike.opacity != null ? leafletLike.opacity : 1,
  };
  const dash = parseDashArrayToNumbers(leafletLike.dashArray);
  if (dash) out.dashArray = dash;
  if (leafletLike.lineCap != null) out.lineCap = leafletLike.lineCap;
  if (leafletLike.lineJoin != null) out.lineJoin = leafletLike.lineJoin;
  const dashOffset = parseDashOffsetToNumber(leafletLike.dashOffset);
  if (dashOffset != null) out.dashOffset = dashOffset;
  return out;
}

function pushCuratedLineWgs84(features, ptsLatLng, curatedStyle, extraProperties) {
  if (!ptsLatLng || ptsLatLng.length < 2) return;
  const coords = ptsLatLng.map(([lat, lng]) => [lng, lat]);
  features.push({
    type: "Feature",
    geometry: { type: "LineString", coordinates: coords },
    properties: { ...(extraProperties || {}), _curatedStyle: curatedStyle },
  });
}

/**
 * Legacy hook kept for call sites (`projection-curated-layer-load`, `projection-layer-manager`).
 *
 * **Previously** this function **rewrote** `_curatedStyle.opacity` on `pink_removed_halo` /
 * `pink_removed_line` features with `Math.max` floors (e.g. minimum ~0.32 on the pink ghost
 * line). That meant edits to ghost opacity in `pink-route-map-styles.js` (`GHOST_REMOVED_*`)
 * had **no effect on the projector** — opacity looked “stuck” while GIS could still change.
 *
 * Ghost stroke opacity is now **only** whatever `leafletPolylineLikeToCuratedCanvas` copies
 * from `routeLineStylesForDisplayColor` (same tokens as Leaflet). Tune **`GHOST_REMOVED_LINE_OPACITY`**
 * and **`GHOST_REMOVED_HALO_OPACITY`** in `pink-route-map-styles.js` for both surfaces.
 *
 * @param {Object|null|undefined} geojsonWgs84
 */
function applyProjectionCuratedOverlayContrast(geojsonWgs84) {
  void geojsonWgs84;
}

/**
 * Colab-aligned curated overlay as a single WGS84 FeatureCollection (LineStrings + Points)
 * for canvas projection — mirrors the GIS `leaflet-curated-layer-loader` stack.
 *
 * `basePaths` may be an empty array when the overlay is driven by detour points only
 * (planner branch), by `colab_route_geometry_bundle` (Django enrich), or when tests pass
 * `[]` for parity. Without a renderable bundle, `buildIntegratedRoute` still runs with no
 * base segments when detour points exist.
 *
 * @param {Array} basePaths - pink-line base paths [[lat,lng], …]; may be `[]` (see above)
 * @param {Object} geojsonWgs84 - published submission FeatureCollection (WGS84)
 * @param {string|null|undefined} fallbackDisplayColorHex - Allowlisted submission primary when GeoJSON has none (e.g. `UI_CONFIG.getSubmissionDisplayPrimaryForCuratedLayer`)
 * @param {{ useAllPointsAsDetourWhenEmpty?: boolean }} [options]
 * @returns {Object|null}
 */
function buildColabAlignedCuratedOverlayGeoJSON(
  basePaths,
  geojsonWgs84,
  fallbackDisplayColorHex,
  options,
) {
  if (
    typeof buildIntegratedRoute !== "function" ||
    !geojsonWgs84 ||
    !Array.isArray(geojsonWgs84.features)
  ) {
    return null;
  }
  const opts = options && typeof options === "object" ? options : {};
  /** When no pink detour nodes, use non-memorial Point coordinates for `buildIntegratedRoute` (projection workshop edge cases). */
  const useAllPointsAsDetourWhenEmpty = opts.useAllPointsAsDetourWhenEmpty === true;
  const basePathsResolved = Array.isArray(basePaths) ? basePaths : [];
  const parsedColabBundle = parseColabRouteGeometryBundle(
    geojsonWgs84.colab_route_geometry_bundle,
  );

  const detourPointItems = extractPinkDetourPointFeatures(geojsonWgs84);
  let userPointsDetour = detourPointItems.map((x) => x.latlng);
  if (userPointsDetour.length === 0 && useAllPointsAsDetourWhenEmpty) {
    userPointsDetour = extractPointFeatures(geojsonWgs84)
      .filter((x) => !getMemorialIconForFeature(x.feature.properties || {}))
      .map((x) => x.latlng);
  }
  if (
    userPointsDetour.length === 0 &&
    !colabBundleHasRenderableGeometry(parsedColabBundle)
  ) {
    return null;
  }

  const fromGeoColor = resolveFirstDisplayColorFromGeojson(geojsonWgs84);
  const normalizedFallback =
    fallbackDisplayColorHex != null &&
    fallbackDisplayColorHex !== "" &&
    isAllowedSubmissionDisplayColor(fallbackDisplayColorHex)
      ? normalizeSubmissionDisplayColorHex(fallbackDisplayColorHex)
      : undefined;
  const submissionHex = fromGeoColor ?? normalizedFallback ?? undefined;
  const baseStyles = routeLineStylesForDisplayColor(null);
  const proposedTint = routeLineStylesForDisplayColor(submissionHex);
  const styles = {
    ...baseStyles,
    proposedHalo: proposedTint.proposedHalo,
    proposedLine: proposedTint.proposedLine,
    ...(proposedTint.proposedSecondary
      ? { proposedSecondary: proposedTint.proposedSecondary }
      : {}),
  };
  const nodeFillHex =
    fromGeoColor ?? normalizedFallback ?? styles.proposedLine.color;

  const features = [];

  /**
   * Proposed paths: GeoJSON feature order is canvas draw order — halo (bottom),
   * optional `pink_proposed_secondary` dual dash, then `pink_proposed_line` (top).
   * Draw order matches `planPinkCuratedOverlayLayers` / Colab: see
   * `docs/colab-export-detour-paint-handoff.md`.
   */
  function pushProposedPinkStack(ptsLatLng) {
    if (!ptsLatLng || ptsLatLng.length < 2) return;
    pushCuratedLineWgs84(
      features,
      ptsLatLng,
      leafletPolylineLikeToCuratedCanvas(styles.proposedHalo),
      { curated_overlay_role: "pink_proposed_halo" },
    );
    if (styles.proposedSecondary) {
      pushCuratedLineWgs84(
        features,
        ptsLatLng,
        leafletPolylineLikeToCuratedCanvas(styles.proposedSecondary),
        { curated_overlay_role: "pink_proposed_secondary" },
      );
    }
    pushCuratedLineWgs84(
      features,
      ptsLatLng,
      leafletPolylineLikeToCuratedCanvas(styles.proposedLine),
      { curated_overlay_role: "pink_proposed_line" },
    );
  }

  if (parsedColabBundle.ok && colabBundleHasRenderableGeometry(parsedColabBundle)) {
    const { solid, removed } = parsedColabBundle.integratedRoute;
    const { detourPaint } = parsedColabBundle;
    solid.forEach((pts) => {
      if (!pts || pts.length < 2) return;
      pushCuratedLineWgs84(
        features,
        pts,
        leafletPolylineLikeToCuratedCanvas(styles.solidLine),
        { curated_overlay_role: "pink_axis_solid" },
      );
    });
    removed.forEach((pts) => {
      if (!pts || pts.length < 2) return;
      pushCuratedLineWgs84(
        features,
        pts,
        leafletPolylineLikeToCuratedCanvas(styles.oldHalo),
        { curated_overlay_role: "pink_removed_halo" },
      );
    });
    removed.forEach((pts) => {
      if (!pts || pts.length < 2) return;
      pushCuratedLineWgs84(
        features,
        pts,
        {
          ...leafletPolylineLikeToCuratedCanvas(styles.oldLine),
          _removedPinkStrokeShadow: true,
        },
        { curated_overlay_role: "pink_removed_line" },
      );
    });
    for (const path of detourPaint.road) {
      if (path.length < 2) continue;
      pushProposedPinkStack(path);
    }
    const offStyle = leafletPolylineLikeToCuratedCanvas(styles.offroadLine);
    detourPaint.offroad.forEach(({ roadEnd, target }) => {
      pushCuratedLineWgs84(features, [roadEnd, target], offStyle, {
        curated_overlay_role: "pink_offroad_segment",
      });
    });
    let junctionLatLngs = detourPaint.junctions.filter(
      (p) => Array.isArray(p) && p.length === 2,
    );
    if (junctionLatLngs.length === 0) {
      const seen = new Set();
      junctionLatLngs = [];
      for (const { roadEnd } of detourPaint.offroad) {
        const key = `${roadEnd[0]},${roadEnd[1]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        junctionLatLngs.push(roadEnd);
      }
    }
    for (const [lat, lng] of junctionLatLngs) {
      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: [lng, lat] },
        properties: {
          curated_overlay_role: "pink_offroad_junction",
          _curatedStyle: {
            fillColor: styles.offroadLine.color,
            color: "#fff",
            weight: 2,
            fillOpacity: 0.95,
            opacity: 1,
            radius: 11,
            _offroadJunctionCanvas: true,
          },
        },
      });
    }
  } else {
    const { solid, removed, dashed } = buildIntegratedRoute(
      basePathsResolved,
      userPointsDetour,
    );

    const { pathsLatLng } = parsePinkLineRouteFromGeojson(geojsonWgs84);
    const hasStoredPinkRoute = pathsLatLng.some((p) => p.length >= 2);

    solid.forEach((pts) => {
      pushCuratedLineWgs84(
        features,
        pts,
        leafletPolylineLikeToCuratedCanvas(styles.solidLine),
        { curated_overlay_role: "pink_axis_solid" },
      );
    });
    removed.forEach((pts) => {
      pushCuratedLineWgs84(
        features,
        pts,
        leafletPolylineLikeToCuratedCanvas(styles.oldHalo),
        { curated_overlay_role: "pink_removed_halo" },
      );
    });
    removed.forEach((pts) => {
      pushCuratedLineWgs84(
        features,
        pts,
        {
          ...leafletPolylineLikeToCuratedCanvas(styles.oldLine),
          _removedPinkStrokeShadow: true,
        },
        { curated_overlay_role: "pink_removed_line" },
      );
    });

    if (hasStoredPinkRoute) {
      const offroadEnabled = MapProjectionConfig.ENABLE_CURATED_OFFROAD_SPLIT === true;
      const proposedOverlayPaths =
        offroadEnabled && pathsLatLng.length > 0
          ? clipProposedPathsLatLngExcludingOffroadGaps(
              pathsLatLng,
              STORED_PINK_ROUTE_OFFROAD_GAP_METERS,
            )
          : pathsLatLng;
      for (const path of proposedOverlayPaths) {
        if (path.length < 2) continue;
        pushProposedPinkStack(path);
      }
      if (offroadEnabled) {
        const segs = findOffroadTwoPointSegments(
          pathsLatLng,
          STORED_PINK_ROUTE_OFFROAD_GAP_METERS,
        );
        const offSegStyle = leafletPolylineLikeToCuratedCanvas(styles.offroadLine);
        segs.forEach((seg) => {
          pushCuratedLineWgs84(features, seg, offSegStyle, {
            curated_overlay_role: "pink_offroad_segment",
          });
        });
        for (const [lat, lng] of collectOffroadJunctionLatLngs(segs)) {
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [lng, lat] },
            properties: {
              curated_overlay_role: "pink_offroad_junction",
              _curatedStyle: {
                fillColor: styles.offroadLine.color,
                color: "#fff",
                weight: 2,
                fillOpacity: 0.95,
                opacity: 1,
                radius: 11,
                _offroadJunctionCanvas: true,
              },
            },
          });
        }
      }
    } else {
      dashed.forEach((pts) => {
        pushProposedPinkStack(pts);
      });
    }
  }

  const pointItems = extractPointFeatures(geojsonWgs84);
  pointItems.forEach(({ feature, latlng }) => {
    const props = feature.properties || {};
    const memorialIcon = getMemorialIconForFeature(props);
    const [lat, lng] = latlng;
    let curatedStyle;
    if (memorialIcon) {
      const accentHex = sanitizeDisplayColorHex(props.display_color);
      curatedStyle = accentHex
        ? {
            _iconUrl: memorialIcon,
            _memorialAccentHex: accentHex,
            _memorialOuterPx: 38,
            _memorialImgPx: 28,
          }
        : { _iconUrl: memorialIcon, _iconSize: 36 };
    } else {
      curatedStyle = {
        fillColor: nodeFillHex,
        color: "#fff",
        weight: 2,
        fillOpacity: 0.9,
        opacity: 1,
        radius: 15,
      };
    }
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: { ...props, _curatedStyle: curatedStyle },
    });
  });

  assignPinkNodeDisplayOrders(features);

  return { type: "FeatureCollection", features };
}

export {
  fetchCuratedLayerData,
  extractPointFeatures,
  extractPinkDetourPointFeatures,
  fetchPinkLinePaths,
  buildCuratedRouteGeoJSON,
  buildColabAlignedCuratedOverlayGeoJSON,
  applyProjectionCuratedOverlayContrast,
  MEMORIAL_ICON_URLS,
  getMemorialIconForFeature,
  resolvePinkLinePackStyleBundle,
};
