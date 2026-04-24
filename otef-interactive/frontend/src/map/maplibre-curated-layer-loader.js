/**
 * MapLibre curated layer loader.
 * MapLibre equivalent of leaflet-curated-layer-loader.js.
 *
 * Reuses renderer-agnostic pipeline:
 *   fetchCuratedLayerData, extractPointFeatures, extractPinkDetourPointFeatures,
 *   fetchPinkLinePaths, getMemorialIconForFeature, resolvePinkLinePackStyleBundle,
 *   buildIntegratedRoute, planPinkCuratedOverlayLayers, routeLineStylesForDisplayColor.
 *
 * Final materialization uses MapLibre sources + layers for polyline ops,
 * and MapLibre Marker with custom HTML for node/memorial markers.
 *
 * IMPORTANT: overlay plan latLngs are [lat, lng]; MapLibre GeoJSON requires [lng, lat].
 * Flip happens at materialization boundary via latLngToCoord().
 */

import { UI_CONFIG } from "../config/ui-config.js";
import {
  fetchCuratedLayerData,
  extractPointFeatures,
  extractPinkDetourPointFeatures,
  fetchPinkLinePaths,
  getMemorialIconForFeature,
  resolvePinkLinePackStyleBundle,
} from "../shared/curated-layer-service.js";
import { buildIntegratedRoute } from "../map-utils/pink-line-route.js";
import {
  colabBundleHasDetourPaint,
  colabBundleHasRenderableGeometry,
  parseColabRouteGeometryBundle,
} from "../map-utils/colab-route-geometry-bundle.js";
import { assignPinkNodeDisplayOrders } from "../map-utils/pink-route-optimizer.js";
import {
  STORED_PINK_ROUTE_OFFROAD_GAP_METERS,
  routeLineStylesForDisplayColor,
} from "../map-utils/pink-route-map-styles.js";
import {
  clipProposedPathsLatLngExcludingOffroadGaps,
  collectOffroadJunctionLatLngs,
  findOffroadTwoPointSegments,
  parsePinkLineRouteFromGeojson,
  resolveFirstDisplayColorFromGeojson,
  sanitizeDisplayColorHex,
} from "./leaflet-curated-pink-helpers.js";
import { planPinkCuratedOverlayLayers } from "./pink-curated-overlay-plan.js";
import { buildMemorialInspectHtml } from "./curated-memorial-inspect-html.js";
import { readPinkNodeOrder } from "../map-utils/pink-node-order.js";
import MapProjectionConfig from "../shared/map-projection-config.js";
import {
  addCuratedGeoJsonSource,
  removeCuratedLayersByPrefix,
  registerCuratedLayerIds,
} from "./maplibre-layer-manager.js";

const getCuratedLayerColor = UI_CONFIG.getCuratedColor;
const getSubmissionDisplayPrimaryForCuratedLayer =
  UI_CONFIG.getSubmissionDisplayPrimaryForCuratedLayer;

/** Dev-only: avoid spamming console when published GeoJSON has no stored route. */
const noStoredPinkRouteLoggedIds = new Set();

/**
 * Flip [lat, lng] → [lng, lat] for MapLibre GeoJSON coordinates.
 * @param {[number, number]} latLng
 * @returns {[number, number]}
 */
function latLngToCoord([lat, lng]) {
  return [lng, lat];
}

// ---------------------------------------------------------------------------
// HTML marker tracking
// ---------------------------------------------------------------------------

/** @type {Map<string, import("maplibre-gl").Marker[]>} */
const htmlMarkersByLayer = new Map();

/**
 * Remove all HTML markers associated with a layer.
 * @param {string} fullLayerId
 */
export function removeCuratedHtmlMarkers(fullLayerId) {
  const markers = htmlMarkersByLayer.get(fullLayerId) || [];
  for (const m of markers) {
    try {
      m.remove();
    } catch (_) {}
  }
  htmlMarkersByLayer.delete(fullLayerId);
}

// ---------------------------------------------------------------------------
// Pink-line base layer (MapLibre equivalent of ensurePinkLineBaseLayer)
// ---------------------------------------------------------------------------

/** Source/layer ids used for the shared pink-line base on this MapLibre map. */
const PINK_BASE_SOURCE_ID = "curated__pink_line_base__source";
const PINK_BASE_LAYER_ID = "curated__pink_line_base__layer";

/**
 * Ensure the pink-line base polylines are added to the MapLibre map.
 * Mirrors leaflet-curated-layer-loader.js `ensurePinkLineBaseLayer` logic:
 * when `removedPaths` are present, omit the base layer entirely (colab parity).
 *
 * @param {object} map - MapLibre map instance
 * @param {{ removedPaths?: Array<Array<[number, number]>> }} [options]
 */
async function ensurePinkLineBaseLayer(map, options = {}) {
  const removedPaths = options.removedPaths;
  const clip =
    Array.isArray(removedPaths) &&
    removedPaths.some((p) => Array.isArray(p) && p.length >= 2);

  try {
    if (clip) {
      // Remove base layer if present; rely on overlay solidLine for kept segments.
      if (map.getLayer(PINK_BASE_LAYER_ID)) map.removeLayer(PINK_BASE_LAYER_ID);
      if (map.getSource(PINK_BASE_SOURCE_ID)) map.removeSource(PINK_BASE_SOURCE_ID);
      return;
    }

    if (map.getLayer(PINK_BASE_LAYER_ID)) return; // already rendered

    const [{ basePaths }, styleBundle] = await Promise.all([
      fetchPinkLinePaths(),
      resolvePinkLinePackStyleBundle(),
    ]);
    if (!basePaths || basePaths.length === 0) return;

    const features = basePaths
      .filter((p) => Array.isArray(p) && p.length >= 2)
      .map((path) => ({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: path.map(latLngToCoord),
        },
        properties: {},
      }));
    if (features.length === 0) return;

    const geojsonData = { type: "FeatureCollection", features };
    if (!map.getSource(PINK_BASE_SOURCE_ID)) {
      map.addSource(PINK_BASE_SOURCE_ID, { type: "geojson", data: geojsonData });
    }

    const opts = styleBundle.leafletPolylineOptions || {};
    map.addLayer({
      id: PINK_BASE_LAYER_ID,
      type: "line",
      source: PINK_BASE_SOURCE_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": opts.color || "#FF69B4",
        "line-width": typeof opts.weight === "number" ? opts.weight : 5,
        "line-opacity": typeof opts.opacity === "number" ? opts.opacity : 0.9,
      },
    });
  } catch (_) {}
}

// ---------------------------------------------------------------------------
// Style translation: Leaflet-style objects → MapLibre paint/layout
// ---------------------------------------------------------------------------

/**
 * Convert a Leaflet polyline-style object to MapLibre line paint + layout.
 * @param {{ color?: string; weight?: number; opacity?: number; dashArray?: string; dashOffset?: string; lineCap?: string; lineJoin?: string }} leafletStyle
 * @returns {{ paint: object; layout: object }}
 */
function leafletStyleToMapLibre(leafletStyle) {
  const s = leafletStyle || {};
  const paint = {
    "line-color": s.color || "#FF69B4",
    "line-width": typeof s.weight === "number" ? s.weight : 4,
    "line-opacity": typeof s.opacity === "number" ? s.opacity : 1,
  };

  if (s.dashArray) {
    // Leaflet dashArray is a space-separated string like "10 8"; MapLibre expects [number, number, ...]
    const parts = String(s.dashArray)
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter((n) => Number.isFinite(n));
    if (parts.length >= 2) {
      paint["line-dasharray"] = parts;
    }
  }

  const layout = {
    "line-cap": s.lineCap || "round",
    "line-join": s.lineJoin || "round",
  };

  return { paint, layout };
}

/**
 * Resolve MapLibre paint/layout for a pink overlay styleKey.
 * @param {string} styleKey
 * @param {ReturnType<typeof routeLineStylesForDisplayColor>} styles
 * @returns {{ paint: object; layout: object }}
 */
function resolveMapLibrePolylineStyle(styleKey, styles) {
  const leafletStyle =
    styleKey === "solidLine" ? styles.solidLine
    : styleKey === "oldHalo" ? styles.oldHalo
    : styleKey === "oldLine" ? styles.oldLine
    : styleKey === "proposedHalo" ? styles.proposedHalo
    : styleKey === "proposedSecondary" ? styles.proposedSecondary
    : styleKey === "proposedLine" ? styles.proposedLine
    : styleKey === "offroadLine" ? styles.offroadLine
    : styles.solidLine;
  return leafletStyleToMapLibre(leafletStyle || styles.solidLine);
}

/**
 * Resolve MapLibre circle paint/layout for overlay circle marker ops.
 * Task 4 spec: circleMarker ops must materialize as GeoJSON point source + circle layer.
 * @param {string} styleKey
 * @param {ReturnType<typeof routeLineStylesForDisplayColor>} styles
 * @returns {{ paint: object; layout: object }}
 */
function resolveMapLibreCircleStyle(styleKey, styles) {
  if (styleKey === "offroadJunction") {
    const color = styles.offroadLine?.color || "#c62828";
    return {
      layout: {},
      paint: {
        "circle-radius": 5,
        "circle-color": color,
        "circle-stroke-color": color,
        "circle-stroke-width": 1,
        "circle-opacity": 0.85,
      },
    };
  }
  const color = styles.proposedLine?.color || "#ff587b";
  return {
    layout: {},
    paint: {
      "circle-radius": 4,
      "circle-color": color,
      "circle-stroke-color": color,
      "circle-stroke-width": 1,
      "circle-opacity": 0.9,
    },
  };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function makeLineStringFeature(latLngs) {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: latLngs.map(latLngToCoord),
    },
    properties: {},
  };
}

function makePointFeature(latLng) {
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: latLngToCoord(latLng),
    },
    properties: {},
  };
}

// ---------------------------------------------------------------------------
// HTML marker builders
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function formatNodeTooltip(properties) {
  const p = properties || {};
  const name = p.name || p.reason || p.description || "";
  if (!name) return "Node";
  return String(name).trim().slice(0, 80);
}

function formatNodePopup(properties) {
  const p = properties || {};
  const parts = [];
  ["name", "reason", "description", "note"].forEach((k) => {
    const v = p[k];
    if (v != null && String(v).trim() !== "") {
      let label = k;
      if (k === "name") label = "שם";
      else if (k === "description") label = "תיאור";
      parts.push(
        `<div class="popup-field"><span class="popup-label">${escapeHtml(label)}:</span> <span class="popup-value">${escapeHtml(String(v))}</span></div>`,
      );
    }
  });
  if (parts.length === 0) return '<div class="popup-content">—</div>';
  return '<div class="popup-content">' + parts.join("") + "</div>";
}

/**
 * Create a MapLibre Marker element for a node point.
 * @param {object} maplibregl - MapLibre GL JS namespace (must have Marker + Popup)
 * @param {[number, number]} latLng - [lat, lng]
 * @param {object} feature
 * @param {string} nodeFillHex
 * @param {string} fullLayerId
 * @returns {import("maplibre-gl").Marker | null}
 */
function createNodeMarker(maplibregl, latLng, feature, nodeFillHex, fullLayerId) {
  const props = feature.properties || {};
  const memorialIconUrl = getMemorialIconForFeature(props);

  const lngLat = [latLng[1], latLng[0]]; // [lng, lat] for MapLibre

  let el;
  if (memorialIconUrl) {
    const accentHex = sanitizeDisplayColorHex(props.display_color);
    el = document.createElement("div");
    if (accentHex) {
      el.className = "curation-memorial-marker-root";
      el.innerHTML = `<div class="curation-memorial-marker-shell curation-memorial-marker-accent" style="--memorial-accent:${accentHex}"><img class="curation-memorial-marker-img" src="${memorialIconUrl}" alt="" /></div>`;
      el.style.cssText = "width:38px;height:38px;";
    } else {
      el.className = "curation-memorial-marker-root";
      el.innerHTML = `<img class="curation-memorial-marker-icon" src="${memorialIconUrl}" alt="" style="width:28px;height:28px;" />`;
      el.style.cssText = "width:28px;height:28px;";
    }
  } else {
    const pinkOrder = readPinkNodeOrder(props);
    if (pinkOrder == null) return null;
    const label = `<span style="font-size:11px;font-weight:700;color:#fff;line-height:1;pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,0.45)">${pinkOrder}</span>`;
    el = document.createElement("div");
    el.className = "pink-line-node-marker";
    el.innerHTML = `<div class="pink-line-node" style="background:${nodeFillHex};display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;">${label}</div>`;
    el.style.cssText = "width:30px;height:30px;";
  }

  const marker = new maplibregl.Marker({ element: el })
    .setLngLat(lngLat);

  // Attach popup
  const popupContent = memorialIconUrl
    ? buildMemorialInspectHtml(props)
    : formatNodePopup(props);
  const popup = new maplibregl.Popup({ className: "curated-node-popup", offset: 15 })
    .setHTML(popupContent);
  marker.setPopup(popup);

  // Tooltip via title attribute on the element
  const tip = formatNodeTooltip(props);
  if (tip && el) el.title = tip;

  return marker;
}

// ---------------------------------------------------------------------------
// Main loader
// ---------------------------------------------------------------------------

/**
 * Load a curated layer for MapLibre GIS display.
 * Mirrors leaflet-curated-layer-loader.js `loadCuratedLayerFromAPI`.
 *
 * @param {object} map - MapLibre map instance
 * @param {string} fullLayerId - e.g. "curated.42"
 * @param {{ maplibregl?: object; force?: boolean }} [opts]
 */
export async function loadCuratedLayerToMapLibre(map, fullLayerId, opts = {}) {
  const maplibregl =
    opts.maplibregl ||
    (typeof window !== "undefined" && window.maplibregl) ||
    null;
  const force = opts && opts.force === true;

  if (force && map && fullLayerId) {
    removeCuratedLayersByPrefix(map, fullLayerId);
    removeCuratedHtmlMarkers(fullLayerId);
  }

  // --- Shared data fetch ---
  const result = await fetchCuratedLayerData(fullLayerId);
  if (!result) return;
  let { geojson, layerData } = result;

  // CRS normalisation — MapLibre expects WGS-84 [lng, lat]
  const crs = geojson.crs?.properties?.name || "";
  if (
    (crs.includes("2039") || crs.includes("ITM")) &&
    typeof CoordUtils !== "undefined" &&
    typeof CoordUtils.transformGeojsonToWgs84 === "function"
  ) {
    geojson = CoordUtils.transformGeojsonToWgs84(geojson);
  }

  // --- Shared point / pink-line extraction ---
  const pointItems = extractPointFeatures(geojson);
  const detourPointItems = extractPinkDetourPointFeatures(geojson);
  const userPointsDetour = detourPointItems.map((x) => x.latlng);
  let routingLatLng = userPointsDetour.slice();
  if (routingLatLng.length === 0 && pointItems.length > 0) {
    routingLatLng = pointItems
      .filter(({ feature }) => !getMemorialIconForFeature(feature.properties || {}))
      .map((x) => x.latlng);
  }

  assignPinkNodeDisplayOrders(pointItems.map((item) => item.feature));
  const { basePaths } = await fetchPinkLinePaths();

  const hasAnyLineGeometryInGeojson = geojson.features.some(
    (f) =>
      f.geometry &&
      (f.geometry.type === "LineString" || f.geometry.type === "MultiLineString"),
  );
  const hasRouteUtils = typeof buildIntegratedRoute === "function";
  const parsedBundle = parseColabRouteGeometryBundle(geojson.colab_route_geometry_bundle);
  const bundleRenderable = colabBundleHasRenderableGeometry(parsedBundle);
  const usePinkLineProjection =
    hasRouteUtils &&
    (bundleRenderable ||
      (basePaths.length > 0 &&
        (routingLatLng.length > 0 || hasAnyLineGeometryInGeojson)));

  const canRunPinkOverlay =
    usePinkLineProjection && (routingLatLng.length > 0 || bundleRenderable);

  if (canRunPinkOverlay) {
    const fromGeoColor = resolveFirstDisplayColorFromGeojson(geojson);
    const submissionHex =
      fromGeoColor ??
      getSubmissionDisplayPrimaryForCuratedLayer(fullLayerId, layerData) ??
      undefined;
    const baseStyles = routeLineStylesForDisplayColor(null);
    const proposedTint = routeLineStylesForDisplayColor(submissionHex);
    const styles = {
      ...baseStyles,
      proposedHalo: proposedTint.proposedHalo,
      proposedLine: proposedTint.proposedLine,
      ...(proposedTint.proposedSecondary != null
        ? { proposedSecondary: proposedTint.proposedSecondary }
        : {}),
    };
    const nodeFillHex = fromGeoColor ?? submissionHex ?? styles.proposedLine.color;

    let solid;
    let removed;
    let dashed = [];
    let proposedPathsForOverlay = [];
    let offroadSegmentsLatLng = [];
    let offroadJunctionsLatLng = [];
    let hasStoredPinkRoute = false;

    if (bundleRenderable) {
      solid = parsedBundle.integratedRoute.solid;
      removed = parsedBundle.integratedRoute.removed;
      proposedPathsForOverlay = parsedBundle.detourPaint.road.filter((p) => p.length >= 2);
      offroadSegmentsLatLng = parsedBundle.detourPaint.offroad.map(({ roadEnd, target }) => [
        roadEnd,
        target,
      ]);
      hasStoredPinkRoute = true;
      if (parsedBundle.detourPaint.junctions.length > 0) {
        offroadJunctionsLatLng = parsedBundle.detourPaint.junctions.filter(
          (p) => Array.isArray(p) && p.length === 2,
        );
      } else {
        const seen = new Set();
        offroadJunctionsLatLng = [];
        for (const { roadEnd } of parsedBundle.detourPaint.offroad) {
          const key = `${roadEnd[0]},${roadEnd[1]}`;
          if (seen.has(key)) continue;
          seen.add(key);
          offroadJunctionsLatLng.push(roadEnd);
        }
      }
    } else {
      const built = buildIntegratedRoute(basePaths, routingLatLng);
      solid = built.solid;
      removed = built.removed;
      dashed = built.dashed;

      const { pathsLatLng } = parsePinkLineRouteFromGeojson(geojson);
      hasStoredPinkRoute = pathsLatLng.some((p) => p.length >= 2);

      if (!hasStoredPinkRoute) {
        const isDev =
          typeof import.meta !== "undefined" &&
          import.meta.env &&
          import.meta.env.DEV &&
          import.meta.env.MODE !== "test";
        if (isDev && !noStoredPinkRouteLoggedIds.has(fullLayerId)) {
          noStoredPinkRouteLoggedIds.add(fullLayerId);
          console.debug(
            "[CuratedLayerMapLibre] No pink_line_route LineString/MultiLineString; proposed route uses integrated dashed segments.",
          );
        }
      }

      const offroadEnabled = MapProjectionConfig.ENABLE_CURATED_OFFROAD_SPLIT === true;
      proposedPathsForOverlay = pathsLatLng;
      if (hasStoredPinkRoute && offroadEnabled) {
        offroadSegmentsLatLng = findOffroadTwoPointSegments(
          pathsLatLng,
          STORED_PINK_ROUTE_OFFROAD_GAP_METERS,
        );
        offroadJunctionsLatLng = collectOffroadJunctionLatLngs(offroadSegmentsLatLng);
        proposedPathsForOverlay = clipProposedPathsLatLngExcludingOffroadGaps(
          pathsLatLng,
          STORED_PINK_ROUTE_OFFROAD_GAP_METERS,
        );
      }
    }

    if (basePaths.length > 0) {
      const clipRemoved =
        Array.isArray(removed) &&
        removed.some((p) => Array.isArray(p) && p.length >= 2);
      await ensurePinkLineBaseLayer(map, clipRemoved ? { removedPaths: removed } : {});
    }

    const hasDetourPoints =
      routingLatLng.length > 0 || colabBundleHasDetourPaint(parsedBundle);

    const overlayOps = planPinkCuratedOverlayLayers({
      hasDetourPoints,
      hasStoredPinkRoute,
      includeProposedSecondary: proposedTint.proposedSecondary != null,
      solid,
      removed,
      dashedPlanner: dashed,
      proposedPathsLatLng: proposedPathsForOverlay,
      offroadSegmentsLatLng,
      offroadJunctionsLatLng,
    });

    // --- Materialize polyline ops: group by styleKey for efficient source/layer creation ---
    /** @type {Map<string, { features: object[]; styleKey: string }>} */
    const polylineGroups = new Map();
    /** @type {Map<string, { features: object[]; styleKey: string }>} */
    const circleMarkerGroups = new Map();

    for (const op of overlayOps) {
      if (op.kind === "polyline") {
        const key = op.styleKey;
        if (!polylineGroups.has(key)) {
          polylineGroups.set(key, { features: [], styleKey: key });
        }
        polylineGroups.get(key).features.push(makeLineStringFeature(op.latLngs));
      } else if (op.kind === "circleMarker") {
        const key = op.styleKey;
        if (!circleMarkerGroups.has(key)) {
          circleMarkerGroups.set(key, { features: [], styleKey: key });
        }
        circleMarkerGroups.get(key).features.push(makePointFeature(op.latLng));
      }
    }

    const registeredLayerIds = [];

    // Add polyline groups as sources + layers in draw order
    let styleKeyIndex = 0;
    for (const [styleKey, group] of polylineGroups) {
      const sourceId = `${fullLayerId}__${styleKey}__src`;
      const layerId = `${fullLayerId}__${styleKey}__${styleKeyIndex}`;
      styleKeyIndex++;

      const { paint, layout } = resolveMapLibrePolylineStyle(styleKey, styles);
      const geojsonData = { type: "FeatureCollection", features: group.features };

      addCuratedGeoJsonSource(map, sourceId, geojsonData);
      if (!map.getSource(sourceId)) continue;

      try {
        map.addLayer({
          id: layerId,
          type: "line",
          source: sourceId,
          layout,
          paint,
        });
        registeredLayerIds.push(layerId);
      } catch (err) {
        console.warn(`[maplibre-curated-layer-loader] Failed to add layer ${layerId}`, err);
      }

      // Register each source keyed by its sourceId for cleanup
      registerCuratedLayerIds(map, sourceId, sourceId, [layerId]);
    }

    // Circle marker ops: GeoJSON point source + circle layer (spec parity).
    let circleStyleIndex = 0;
    for (const [styleKey, group] of circleMarkerGroups) {
      const sourceId = `${fullLayerId}__${styleKey}__circle__src`;
      const layerId = `${fullLayerId}__${styleKey}__circle__${circleStyleIndex}`;
      circleStyleIndex++;

      addCuratedGeoJsonSource(map, sourceId, {
        type: "FeatureCollection",
        features: group.features,
      });
      if (!map.getSource(sourceId)) continue;

      const { paint, layout } = resolveMapLibreCircleStyle(styleKey, styles);
      try {
        map.addLayer({
          id: layerId,
          type: "circle",
          source: sourceId,
          layout,
          paint,
        });
        registeredLayerIds.push(layerId);
      } catch (err) {
        console.warn(`[maplibre-curated-layer-loader] Failed to add circle layer ${layerId}`, err);
      }

      // Keep explicit source registration for manager/state-assisted cleanup.
      registerCuratedLayerIds(map, sourceId, sourceId, [layerId]);
    }

    // Node + memorial markers
    if (maplibregl && pointItems.length > 0) {
      const markers = htmlMarkersByLayer.get(fullLayerId) || [];
      for (const { feature, latlng } of pointItems) {
        const marker = createNodeMarker(maplibregl, latlng, feature, nodeFillHex, fullLayerId);
        if (!marker) continue;
        marker.addTo(map);
        markers.push(marker);
      }
      htmlMarkersByLayer.set(fullLayerId, markers);
    }

    // Register the logical fullLayerId in layer manager with all added layer ids
    registerCuratedLayerIds(map, fullLayerId, `${fullLayerId}__src`, registeredLayerIds);
    return;
  }

  // --- Fallback: pink projection without detour points ---
  if (usePinkLineProjection && basePaths.length > 0 && routingLatLng.length === 0) {
    await ensurePinkLineBaseLayer(map, {});
    const layerColor = getCuratedLayerColor(fullLayerId, layerData);
    const lineFeatures = geojson.features
      .filter(
        (f) =>
          f.geometry &&
          (f.geometry.type === "LineString" || f.geometry.type === "MultiLineString"),
      )
      .flatMap((f) => {
        if (f.geometry.type === "LineString") {
          const coords = f.geometry.coordinates;
          if (coords.length < 2) return [];
          return [{ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} }];
        }
        return f.geometry.coordinates
          .filter((line) => line.length >= 2)
          .map((line) => ({
            type: "Feature",
            geometry: { type: "LineString", coordinates: line },
            properties: {},
          }));
      });

    if (lineFeatures.length > 0) {
      const sourceId = `${fullLayerId}__fallback__src`;
      const layerId = `${fullLayerId}__fallback__0`;
      addCuratedGeoJsonSource(map, sourceId, { type: "FeatureCollection", features: lineFeatures });
      if (map.getSource(sourceId)) {
        try {
          map.addLayer({
            id: layerId,
            type: "line",
            source: sourceId,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": layerColor || "#00d4ff",
              "line-width": 4,
              "line-opacity": 0.9,
              "line-dasharray": [10, 10],
            },
          });
          registerCuratedLayerIds(map, fullLayerId, sourceId, [layerId]);
        } catch (err) {
          console.warn(`[maplibre-curated-layer-loader] Fallback layer error for ${fullLayerId}`, err);
        }
      }
    }
    return;
  }

  // --- Fallback: point-only curated layers ---
  if (maplibregl && pointItems.length > 0) {
    const layerColor = getCuratedLayerColor(fullLayerId, layerData);
    const markers = [];
    for (const { feature, latlng } of pointItems) {
      const marker = createNodeMarker(maplibregl, latlng, feature, layerColor || "#FF69B4", fullLayerId);
      if (!marker) continue;
      marker.addTo(map);
      markers.push(marker);
    }
    htmlMarkersByLayer.set(fullLayerId, markers);
    registerCuratedLayerIds(map, fullLayerId, `${fullLayerId}__src`, []);
    return;
  }

  // --- Final fallback: plain GeoJSON layer ---
  const fallbackSourceId = `${fullLayerId}__plain__src`;
  const fallbackLayerId = `${fullLayerId}__plain__0`;
  addCuratedGeoJsonSource(map, fallbackSourceId, geojson);
  if (map.getSource(fallbackSourceId)) {
    try {
      map.addLayer({
        id: fallbackLayerId,
        type: "fill",
        source: fallbackSourceId,
        paint: {
          "fill-color": "#00d4ff",
          "fill-opacity": 0.4,
        },
      });
      registerCuratedLayerIds(map, fullLayerId, fallbackSourceId, [fallbackLayerId]);
    } catch (err) {
      console.warn(`[maplibre-curated-layer-loader] Plain GeoJSON layer error for ${fullLayerId}`, err);
    }
  }
}
