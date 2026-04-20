/**
 * Leaflet curated layer loader.
 * Handles rendering of curated (OTEF) layers on the GIS map with
 * pink-line integration, node markers and tooltips/popups.
 *
 * Data fetching is delegated to CuratedLayerService;
 * this module handles only Leaflet-specific rendering (L.polyline, L.marker).
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
import {
  PINK_LINE_PARKING_ICON_URL,
  fetchPinkLineParkingLotsGeojson,
  createLeafletPinkLineParkingGroup,
} from "../map-utils/pink-line-parking.js";
import MapProjectionConfig from "../shared/map-projection-config.js";

let pinkLineBaseLayerInstance = null;
/** True when the last built pink base layer omitted vertices that overlap `removed` heritage (ghost) segments. */
let pinkLineBaseLayerIsClipped = false;
let pinkLineParkingLayerInstance = null;
/** Bumped whenever pink-line parking is detached; invalidates in-flight parking fetches. */
let pinkLineParkingAttachGeneration = 0;
let pinkLineParkingMapVisibleIntent = false;
const getCuratedLayerColor = UI_CONFIG.getCuratedColor;
const getSubmissionDisplayPrimaryForCuratedLayer =
  UI_CONFIG.getSubmissionDisplayPrimaryForCuratedLayer;

// Colab parity: Hebrew label for off-road junction tooltips (single source).
const PINK_OFFROAD_JUNCTION_TOOLTIP = "מחבר";

/** Dev-only: avoid spamming console when published GeoJSON has no stored route. */
const noStoredPinkRouteLoggedIds = new Set();

/**
 * One SVG renderer per Leaflet map for the dual proposed stack. Canvas paths ignore
 * `dashOffset` when `preferCanvas: true`, so the primary stroke covers the secondary;
 * SVG respects dash offset so both colors remain visible.
 */
const dualProposedSvgByMap = new WeakMap();

function rendererForDualProposedStack(mapInstance) {
  if (!mapInstance || typeof L === "undefined" || typeof L.svg !== "function") return null;
  let r = dualProposedSvgByMap.get(mapInstance);
  if (!r) {
    r = L.svg({ padding: 0.5 });
    dualProposedSvgByMap.set(mapInstance, r);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Tooltip / popup formatters
// ---------------------------------------------------------------------------

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
        `<div class="popup-field"><span class="popup-label">${escapeHtml(label)}:</span> <span class="popup-value">${escapeHtml(String(v))}</span></div>`
      );
    }
  });
  if (parts.length === 0) return '<div class="popup-content">—</div>';
  return '<div class="popup-content">' + parts.join("") + "</div>";
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function ensureCuratedPinkOffroadPane(mapInstance) {
  const paneName = "curatedPinkOffroad";
  if (!mapInstance || typeof mapInstance.getPane !== "function") return paneName;
  if (mapInstance.getPane(paneName)) return paneName;
  const pane = mapInstance.createPane(paneName);
  pane.style.zIndex = "650";
  pane.style.pointerEvents = "none";
  return paneName;
}

/**
 * @param {string} styleKey
 * @param {ReturnType<typeof routeLineStylesForDisplayColor>} styles
 * @param {string} offroadPaneName
 */
function resolvePinkOverlayPolylineStyle(styleKey, styles, offroadPaneName) {
  if (styleKey === "solidLine") return { ...styles.solidLine };
  if (styleKey === "oldHalo") return { ...styles.oldHalo };
  if (styleKey === "oldLine") return { ...styles.oldLine };
  if (styleKey === "proposedHalo") return { ...styles.proposedHalo };
  if (styleKey === "proposedSecondary") return { ...styles.proposedSecondary };
  if (styleKey === "proposedLine") return { ...styles.proposedLine };
  if (styleKey === "offroadLine") {
    const line = { ...styles.offroadLine };
    if (offroadPaneName) line.pane = offroadPaneName;
    return line;
  }
  return { ...styles.solidLine };
}

/**
 * @param {string} styleKey
 * @param {ReturnType<typeof routeLineStylesForDisplayColor>} styles
 * @param {string} offroadPaneName
 */
function resolvePinkOverlayCircleMarkerStyle(styleKey, styles, offroadPaneName) {
  if (styleKey === "offroadJunction") {
    const opts = {
      radius: 5,
      color: styles.offroadLine.color,
      fillColor: styles.offroadLine.color,
      fillOpacity: 0.85,
      weight: 1,
      opacity: 1,
      interactive: false,
    };
    if (offroadPaneName) opts.pane = offroadPaneName;
    return opts;
  }
  return {
    radius: 4,
    color: styles.proposedLine.color,
    fillColor: styles.proposedLine.color,
    fillOpacity: 0.9,
    weight: 1,
  };
}

// ---------------------------------------------------------------------------
// Pink-line base layer
// ---------------------------------------------------------------------------

/**
 * Ensure the shared pink-line base layer is added to the Leaflet map.
 *
 * **Colab parity (`nur-colab-map` MapPage):** the live map does **not** draw a separate full
 * heritage-pack polyline under the integrated overlay. It only draws `solid` + `removed` + detour
 * from `buildIntegratedRoute*`. When a curated submission has `removed` heritage, we **omit**
 * `pink_line_base` entirely and rely on overlay `solidLine` for kept segments — otherwise clipped
 * pack geometry can still mismatch bundle vertices and read as a full-opacity line under the ghost.
 *
 * @param {{ removedPaths?: Array<Array<[number, number]>> }} [options]
 */
async function ensurePinkLineBaseLayer(options = {}) {
  const removedPaths = options.removedPaths;
  const clip =
    Array.isArray(removedPaths) &&
    removedPaths.some((p) => Array.isArray(p) && p.length >= 2);
  try {
    if (clip) {
      if (pinkLineBaseLayerInstance && typeof map !== "undefined" && map) {
        try {
          if (map.hasLayer(pinkLineBaseLayerInstance)) {
            map.removeLayer(pinkLineBaseLayerInstance);
          }
        } catch (_) {}
        pinkLineBaseLayerInstance = null;
      }
      pinkLineBaseLayerIsClipped = true;
      return;
    }
    const [{ basePaths }, styleBundle] = await Promise.all([
      fetchPinkLinePaths(),
      resolvePinkLinePackStyleBundle(),
    ]);
    if (basePaths.length === 0) return;
    const pathsToDraw = basePaths;
    if (
      pinkLineBaseLayerInstance &&
      typeof map !== "undefined" &&
      map &&
      map.hasLayer(pinkLineBaseLayerInstance) &&
      !pinkLineBaseLayerIsClipped
    ) {
      return;
    }
    if (pinkLineBaseLayerInstance && typeof map !== "undefined" && map) {
      try {
        if (map.hasLayer(pinkLineBaseLayerInstance)) {
          map.removeLayer(pinkLineBaseLayerInstance);
        }
      } catch (_) {}
      pinkLineBaseLayerInstance = null;
    }
    if (!pathsToDraw.length) {
      pinkLineBaseLayerIsClipped = false;
      return;
    }
    const group = L.layerGroup();
    const baseStyle = styleBundle.leafletPolylineOptions;
    pathsToDraw.forEach((path) => {
      group.addLayer(L.polyline(path, baseStyle));
    });
    group.addTo(map);
    pinkLineBaseLayerInstance = group;
    pinkLineBaseLayerIsClipped = false;
  } catch (_) {}
}

/**
 * Parking lots along the pink line (static GeoJSON + icon). Tied to base pink visibility.
 */
async function ensurePinkLineParkingLayer() {
  if (typeof map === "undefined" || !map || typeof L === "undefined") return;
  if (pinkLineParkingLayerInstance && map.hasLayer(pinkLineParkingLayerInstance)) return;
  const attachGen = pinkLineParkingAttachGeneration;
  try {
    const geojson = await fetchPinkLineParkingLotsGeojson();
    if (attachGen !== pinkLineParkingAttachGeneration) return;
    if (!pinkLineBaseLayerInstance || !map.hasLayer(pinkLineBaseLayerInstance)) return;
    if (!geojson) return;
    const group = createLeafletPinkLineParkingGroup(L, geojson, PINK_LINE_PARKING_ICON_URL);
    if (!group) return;
    if (attachGen !== pinkLineParkingAttachGeneration) return;
    if (!pinkLineParkingMapVisibleIntent) return;
    if (!pinkLineBaseLayerInstance || !map.hasLayer(pinkLineBaseLayerInstance)) return;
    if (pinkLineParkingLayerInstance && map.hasLayer(pinkLineParkingLayerInstance)) return;
    group.addTo(map);
    pinkLineParkingLayerInstance = group;
  } catch (_) {}
}

/**
 * Control visibility of the shared pink-line *base polylines* on the GIS map
 * (not parking markers — use setPinkLineParkingMapVisibility).
 */
function setPinkLineBaseVisibility(visible) {
  if (typeof map === "undefined" || !map) return;

  if (visible) {
    if (pinkLineBaseLayerInstance) {
      if (!map.hasLayer(pinkLineBaseLayerInstance)) {
        pinkLineBaseLayerInstance.addTo(map);
      }
    } else {
      void ensurePinkLineBaseLayer();
    }
  } else if (
    pinkLineBaseLayerInstance &&
    typeof map.hasLayer === "function" &&
    typeof map.removeLayer === "function" &&
    map.hasLayer(pinkLineBaseLayerInstance)
  ) {
    map.removeLayer(pinkLineBaseLayerInstance);
  }
}

/**
 * Parking markers along the axis: independent of remote toggle intent vs base lines.
 */
function setPinkLineParkingMapVisibility(visible) {
  if (typeof map === "undefined" || !map) return;
  pinkLineParkingMapVisibleIntent = !!visible;

  if (!pinkLineParkingMapVisibleIntent) {
    pinkLineParkingAttachGeneration += 1;
    if (
      pinkLineParkingLayerInstance &&
      typeof map.hasLayer === "function" &&
      typeof map.removeLayer === "function" &&
      map.hasLayer(pinkLineParkingLayerInstance)
    ) {
      map.removeLayer(pinkLineParkingLayerInstance);
    }
    return;
  }

  if (pinkLineParkingLayerInstance) {
    if (!map.hasLayer(pinkLineParkingLayerInstance)) {
      if (pinkLineBaseLayerInstance && map.hasLayer(pinkLineBaseLayerInstance)) {
        pinkLineParkingLayerInstance.addTo(map);
      } else {
        void ensurePinkLineBaseLayer().then(() => {
          if (
            pinkLineParkingMapVisibleIntent &&
            pinkLineParkingLayerInstance &&
            pinkLineBaseLayerInstance &&
            map.hasLayer(pinkLineBaseLayerInstance) &&
            !map.hasLayer(pinkLineParkingLayerInstance)
          ) {
            pinkLineParkingLayerInstance.addTo(map);
          }
        });
      }
    }
    return;
  }

  void ensurePinkLineBaseLayer().then(() => {
    if (pinkLineParkingMapVisibleIntent) void ensurePinkLineParkingLayer();
  });
}

// ---------------------------------------------------------------------------
// loadCuratedLayerFromAPI
// ---------------------------------------------------------------------------

/**
 * Load a curated layer for Leaflet GIS display.
 * Data fetching / route building is delegated to the shared CuratedLayerService;
 * this function handles only the Leaflet-specific rendering (markers, polylines).
 *
 * @param {string} fullLayerId - e.g. "curated.42"
 * @param {Map} loadedLayersMap - the host module's loaded-layers map
 * @param {function} registerLoadedLayer - callback to register the layer
 * @param {{ force?: boolean }} [opts] - when `force === true`, replace an existing registration
 */
async function loadCuratedLayerFromAPI(fullLayerId, loadedLayersMap, registerLoadedLayer, opts = {}) {
  const force = opts && opts.force === true;
  if (!force && loadedLayersMap.has(fullLayerId)) return;

  if (force && typeof map !== "undefined" && map) {
    const existing = loadedLayersMap.get(fullLayerId);
    if (
      existing &&
      typeof map.hasLayer === "function" &&
      typeof map.removeLayer === "function" &&
      map.hasLayer(existing)
    ) {
      map.removeLayer(existing);
    }
    loadedLayersMap.delete(fullLayerId);
  }

  // --- Shared data fetch ---
  const result = await fetchCuratedLayerData(fullLayerId);
  if (!result) return;
  let { geojson, layerData } = result;

  // CRS normalisation (Leaflet expects WGS-84)
  const crs = geojson.crs?.properties?.name || "";
  if (crs.includes("2039") || crs.includes("ITM")) {
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

  // Detour markers read properties.pink_node_order (assignPinkNodeDisplayOrders).
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
  // Allow pink overlay when Django enrich supplies a renderable `colab_route_geometry_bundle`
  // even if the pink-line base pack is empty and there are no detour routing points.
  const usePinkLineProjection =
    hasRouteUtils &&
    (bundleRenderable ||
      (basePaths.length > 0 &&
        (routingLatLng.length > 0 || hasAnyLineGeometryInGeojson)));

  // --- Leaflet-specific rendering ---
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
      // Colab bundle path: geometry only from enrich bundle (no buildIntegratedRoute /
      // parsePinkLineRouteFromGeojson offroad heuristics). Draw order matches
      // `planPinkCuratedOverlayLayers` — see `docs/colab-export-detour-paint-handoff.md`.
      solid = parsedBundle.integratedRoute.solid;
      removed = parsedBundle.integratedRoute.removed;
      proposedPathsForOverlay = parsedBundle.detourPaint.road.filter((p) => p.length >= 2);
      offroadSegmentsLatLng = parsedBundle.detourPaint.offroad.map(({ roadEnd, target }) => [
        roadEnd,
        target,
      ]);
      hasStoredPinkRoute = true; // Same planPinkCuratedOverlayLayers branch as stored-route stacking (proposed paths + offroad + junctions), not “GeoJSON has pink_line_route”.
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
            "[CuratedLayer] No pink_line_route LineString/MultiLineString; proposed route uses integrated dashed segments from buildIntegratedRoute.",
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
      await ensurePinkLineBaseLayer(
        clipRemoved ? { removedPaths: removed } : {},
      );
    }

    const group = L.layerGroup();

    const offroadPaneName =
      offroadSegmentsLatLng.length > 0 && typeof map !== "undefined" && map
        ? ensureCuratedPinkOffroadPane(map)
        : "";

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

    for (const op of overlayOps) {
      if (op.kind === "polyline") {
        let lineOpts = resolvePinkOverlayPolylineStyle(op.styleKey, styles, offroadPaneName);
        if (
          styles.proposedSecondary != null &&
          (op.styleKey === "proposedHalo" ||
            op.styleKey === "proposedSecondary" ||
            op.styleKey === "proposedLine")
        ) {
          const svgRenderer = rendererForDualProposedStack(map);
          if (svgRenderer) lineOpts = { ...lineOpts, renderer: svgRenderer };
        }
        group.addLayer(L.polyline(op.latLngs, lineOpts));
      } else if (op.kind === "circleMarker") {
        if (op.role === "offroadJunction") {
          const lineColor = styles.offroadLine.color || "#c62828";
          const junctionMarker = L.marker(op.latLng, {
            icon: L.divIcon({
              className: "pink-offroad-junction-marker-root",
              html: `<div class="pink-offroad-junction-node" style="--pink-offroad-junction-color:${lineColor}"></div>`,
              iconSize: [22, 22],
              iconAnchor: [11, 11],
            }),
            interactive: true,
          });
          junctionMarker.bindTooltip(PINK_OFFROAD_JUNCTION_TOOLTIP, {
            permanent: false,
            direction: "top",
            className: "curated-node-tooltip",
          });
          group.addLayer(junctionMarker);
        } else {
          const markerOpts = resolvePinkOverlayCircleMarkerStyle(op.styleKey, styles, offroadPaneName);
          group.addLayer(L.circleMarker(op.latLng, markerOpts));
        }
      }
    }

    pointItems.forEach(({ feature, latlng }) => {
      const props = feature.properties || {};
      const memorialIconUrl = getMemorialIconForFeature(props);

      let marker;
      if (memorialIconUrl) {
        const accentHex = sanitizeDisplayColorHex(props.display_color);
        if (accentHex) {
          marker = L.marker(latlng, {
            icon: L.divIcon({
              className: "curation-memorial-marker-root",
              html: `<div class="curation-memorial-marker-shell curation-memorial-marker-accent" style="--memorial-accent:${accentHex}"><img class="curation-memorial-marker-img" src="${memorialIconUrl}" alt="" /></div>`,
              iconSize: [38, 38],
              iconAnchor: [19, 19],
              popupAnchor: [0, -19],
            }),
          });
        } else {
          const icon = L.icon({
            iconUrl: memorialIconUrl,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
            popupAnchor: [0, -14],
            className: "curation-memorial-marker-icon",
          });
          marker = L.marker(latlng, { icon });
        }
      } else {
        const pinkOrder = readPinkNodeOrder(props);
        if (pinkOrder == null) return;
        const label = `<span style="font-size:11px;font-weight:700;color:#fff;line-height:1;pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,0.45)">${pinkOrder}</span>`;
        const nodeFlex = "display:flex;align-items:center;justify-content:center;";
        marker = L.marker(latlng, {
          icon: L.divIcon({
            className: "pink-line-node-marker",
            html: `<div class="pink-line-node" style="background:${nodeFillHex};${nodeFlex}">${label}</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
        });
      }

      const tip = formatNodeTooltip(props);
      const popupContent = memorialIconUrl
        ? buildMemorialInspectHtml(props)
        : formatNodePopup(props);
      marker.bindTooltip(tip, { permanent: false, direction: "top", className: "curated-node-tooltip" });
      marker.bindPopup(popupContent, { className: "curated-node-popup" });
      group.addLayer(marker);
    });
    group.addTo(map);
    registerLoadedLayer(fullLayerId, group);
    return;
  }

  if (usePinkLineProjection && basePaths.length > 0 && routingLatLng.length === 0) {
    await ensurePinkLineBaseLayer();
    const layerColor = getCuratedLayerColor(fullLayerId, layerData);
    const group = L.layerGroup();
    const lineFeatures = geojson.features.filter(
      (f) => f.geometry && (f.geometry.type === "LineString" || f.geometry.type === "MultiLineString"),
    );
    if (lineFeatures.length > 0) {
      lineFeatures.forEach((f) => {
        const coords =
          f.geometry.type === "LineString"
            ? f.geometry.coordinates.map((c) => [c[1], c[0]])
            : f.geometry.coordinates.flatMap((line) => line.map((c) => [c[1], c[0]]));
        if (coords.length >= 2) {
          group.addLayer(L.polyline(coords, { color: layerColor, weight: 4, opacity: 0.9, dashArray: "10, 10" }));
        }
      });
    }
    group.addTo(map);
    registerLoadedLayer(fullLayerId, group);
    return;
  }

  // Fallback for point-only curated layers when pink-line base is unavailable:
  // still render node markers with memorial icons where applicable.
  if (pointItems.length > 0) {
    const layerColor = getCuratedLayerColor(fullLayerId, layerData);
    const group = L.layerGroup();
    pointItems.forEach(({ feature, latlng }) => {
      const props = feature.properties || {};
      const memorialIconUrl = getMemorialIconForFeature(props);

      let marker;
      if (memorialIconUrl) {
        const accentHex = sanitizeDisplayColorHex(props.display_color);
        if (accentHex) {
          marker = L.marker(latlng, {
            icon: L.divIcon({
              className: "curation-memorial-marker-root",
              html: `<div class="curation-memorial-marker-shell curation-memorial-marker-accent" style="--memorial-accent:${accentHex}"><img class="curation-memorial-marker-img" src="${memorialIconUrl}" alt="" /></div>`,
              iconSize: [38, 38],
              iconAnchor: [19, 19],
              popupAnchor: [0, -19],
            }),
          });
        } else {
          const icon = L.icon({
            iconUrl: memorialIconUrl,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
            popupAnchor: [0, -14],
            className: "curation-memorial-marker-icon",
          });
          marker = L.marker(latlng, { icon });
        }
      } else {
        const pinkOrder = readPinkNodeOrder(props);
        if (pinkOrder == null) return;
        const label = `<span style="font-size:11px;font-weight:700;color:#fff;line-height:1;pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,0.45)">${pinkOrder}</span>`;
        const nodeFlex = "display:flex;align-items:center;justify-content:center;";
        marker = L.marker(latlng, {
          icon: L.divIcon({
            className: "pink-line-node-marker",
            html: `<div class="pink-line-node" style="background:${layerColor};${nodeFlex}">${label}</div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          }),
        });
      }
      const tip = formatNodeTooltip(props);
      const popupContent = memorialIconUrl
        ? buildMemorialInspectHtml(props)
        : formatNodePopup(props);
      marker.bindTooltip(tip, { permanent: false, direction: "top", className: "curated-node-tooltip" });
      marker.bindPopup(popupContent, { className: "curated-node-popup" });
      group.addLayer(marker);
    });
    group.addTo(map);
    registerLoadedLayer(fullLayerId, group);
    return;
  }

  // Fallback: plain GeoJSON via LayerFactory
  const layerConfig = {
    style: {
      type: "simple",
      defaultStyle: {
        fillColor: "#00d4ff",
        fillOpacity: 0.4,
        strokeColor: "#00a8cc",
        strokeWidth: 2,
      },
    },
  };
  const leafletLayer =
    typeof LayerFactory !== "undefined"
      ? LayerFactory.createGeoJsonLayer({ fullLayerId, layerConfig, geojson, map })
      : null;
  if (!leafletLayer) return;
  leafletLayer.addTo(map);
  registerLoadedLayer(fullLayerId, leafletLayer);
}

export {
  loadCuratedLayerFromAPI,
  setPinkLineBaseVisibility,
  setPinkLineParkingMapVisibility,
};
