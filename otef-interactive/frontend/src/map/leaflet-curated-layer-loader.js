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
import { optimizePinkNodeVisitOrder } from "../map-utils/pink-route-optimizer.js";
import {
  OFFICIAL_NETWORK_GAP_METERS,
  routeLineStylesForDisplayColor,
} from "../map-utils/pink-route-map-styles.js";
import {
  findOffroadTwoPointSegments,
  parsePinkLineRouteFromGeojson,
  resolveFirstDisplayColorFromGeojson,
  sanitizeDisplayColorHex,
} from "./leaflet-curated-pink-helpers.js";
import { planPinkCuratedOverlayLayers } from "./pink-curated-overlay-plan.js";
import {
  PINK_LINE_PARKING_ICON_URL,
  fetchPinkLineParkingLotsGeojson,
  createLeafletPinkLineParkingGroup,
} from "../map-utils/pink-line-parking.js";

let pinkLineBaseLayerInstance = null;
let pinkLineParkingLayerInstance = null;
/** Bumped whenever pink-line parking is detached; invalidates in-flight parking fetches. */
let pinkLineParkingAttachGeneration = 0;
let pinkLineParkingMapVisibleIntent = false;
const getCuratedLayerColor = UI_CONFIG.getCuratedColor;

/** Dev-only: avoid spamming console when published GeoJSON has no stored route. */
const noStoredPinkRouteLoggedIds = new Set();

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

function collectOffroadJunctionLatLngs(offroadSegments) {
  const seen = new Set();
  const out = [];
  for (const seg of offroadSegments) {
    if (!Array.isArray(seg) || seg.length !== 2) continue;
    for (const ll of seg) {
      if (!ll || ll.length < 2) continue;
      const key = `${ll[0]},${ll[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(ll);
    }
  }
  return out;
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
  if (styleKey === "proposedLine") return { ...styles.proposedLine };
  if (styleKey === "offroadLine") {
    const line = { ...styles.offroadLine };
    if (offroadPaneName) line.pane = offroadPaneName;
    return line;
  }
  if (styleKey === "dashedPlannerHalo") return { ...styles.proposedHalo };
  if (styleKey === "dashedPlannerStroke") {
    return {
      color: styles.proposedLine.color,
      weight: 5,
      opacity: 0.9,
      dashArray: "10, 10",
      lineCap: "round",
      lineJoin: "round",
    };
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
 * Delegates data fetching to the shared CuratedLayerService.
 */
async function ensurePinkLineBaseLayer() {
  if (pinkLineBaseLayerInstance && map.hasLayer(pinkLineBaseLayerInstance)) return;
  try {
    const [{ basePaths }, styleBundle] = await Promise.all([
      fetchPinkLinePaths(),
      resolvePinkLinePackStyleBundle(),
    ]);
    if (basePaths.length === 0) return;
    const group = L.layerGroup();
    const baseStyle = styleBundle.leafletPolylineOptions;
    basePaths.forEach((path) => {
      group.addLayer(L.polyline(path, baseStyle));
    });
    group.addTo(map);
    pinkLineBaseLayerInstance = group;
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

  const pinkNodeOrderByFeature = new Map();
  if (detourPointItems.length > 0) {
    const nodes = detourPointItems.map((x, i) => ({
      id: `__pink:${i}`,
      lat: x.latlng[0],
      lng: x.latlng[1],
    }));
    const ordered = optimizePinkNodeVisitOrder(nodes);
    ordered.forEach((n, pos) => {
      const m = /^__pink:(\d+)$/.exec(n.id);
      if (m) {
        const item = detourPointItems[Number(m[1])];
        if (item) pinkNodeOrderByFeature.set(item.feature, pos + 1);
      }
    });
  }
  const { basePaths } = await fetchPinkLinePaths();

  const hasRouteUtils = typeof buildIntegratedRoute === "function";
  const usePinkLineProjection =
    basePaths.length > 0 &&
    (userPointsDetour.length > 0 ||
      geojson.features.some(
        (f) =>
          f.geometry &&
          (f.geometry.type === "LineString" || f.geometry.type === "MultiLineString"),
      ));

  // --- Leaflet-specific rendering ---
  if (usePinkLineProjection && userPointsDetour.length > 0 && hasRouteUtils) {
    await ensurePinkLineBaseLayer();
    const { solid, removed, dashed } = buildIntegratedRoute(basePaths, userPointsDetour);

    const fromGeoColor = resolveFirstDisplayColorFromGeojson(geojson);
    const fallbackCurated = getCuratedLayerColor(fullLayerId, layerData);
    const styles = routeLineStylesForDisplayColor(fromGeoColor ?? fallbackCurated);
    const nodeFillHex =
      fromGeoColor ??
      sanitizeDisplayColorHex(fallbackCurated) ??
      styles.proposedLine.color;

    const { pathsLatLng } = parsePinkLineRouteFromGeojson(geojson);
    const hasStoredPinkRoute = pathsLatLng.some((p) => p.length >= 2);

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

    const group = L.layerGroup();

    const offroadEnabled =
      typeof MapProjectionConfig !== "undefined" &&
      MapProjectionConfig &&
      MapProjectionConfig.ENABLE_CURATED_OFFROAD_SPLIT === true;
    let offroadSegmentsLatLng = [];
    let offroadJunctionsLatLng = [];
    if (hasStoredPinkRoute && offroadEnabled && typeof map !== "undefined" && map) {
      offroadSegmentsLatLng = findOffroadTwoPointSegments(pathsLatLng, OFFICIAL_NETWORK_GAP_METERS);
      offroadJunctionsLatLng = collectOffroadJunctionLatLngs(offroadSegmentsLatLng);
    }

    const offroadPaneName =
      offroadSegmentsLatLng.length > 0 && typeof map !== "undefined" && map
        ? ensureCuratedPinkOffroadPane(map)
        : "";

    const overlayOps = planPinkCuratedOverlayLayers({
      hasDetourPoints: userPointsDetour.length > 0,
      hasStoredPinkRoute,
      solid,
      removed,
      dashedPlanner: dashed,
      proposedPathsLatLng: pathsLatLng,
      offroadSegmentsLatLng,
      offroadJunctionsLatLng,
    });

    for (const op of overlayOps) {
      if (op.kind === "polyline") {
        const lineOpts = resolvePinkOverlayPolylineStyle(op.styleKey, styles, offroadPaneName);
        group.addLayer(L.polyline(op.latLngs, lineOpts));
      } else if (op.kind === "circleMarker") {
        const markerOpts = resolvePinkOverlayCircleMarkerStyle(op.styleKey, styles, offroadPaneName);
        group.addLayer(L.circleMarker(op.latLng, markerOpts));
      }
    }

    pointItems.forEach(({ feature, latlng }) => {
      const props = feature.properties || {};
      const memorialIconUrl = getMemorialIconForFeature(props);

      let marker;
      if (memorialIconUrl) {
        const icon = L.icon({
          iconUrl: memorialIconUrl,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
          popupAnchor: [0, -18],
          className: "curation-memorial-marker-icon",
        });
        marker = L.marker(latlng, { icon });
      } else {
        const pinkOrder = pinkNodeOrderByFeature.get(feature);
        const label =
          typeof pinkOrder === "number"
            ? `<span style="font-size:8px;font-weight:700;color:#fff;line-height:1;pointer-events:none">${pinkOrder}</span>`
            : "";
        const nodeFlex =
          typeof pinkOrder === "number" ? "display:flex;align-items:center;justify-content:center;" : "";
        marker = L.marker(latlng, {
          icon: L.divIcon({
            className: "pink-line-node-marker",
            html: `<div class="pink-line-node" style="background:${nodeFillHex};${nodeFlex}">${label}</div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          }),
        });
      }

      const tip = formatNodeTooltip(props);
      const popupContent = formatNodePopup(props);
      marker.bindTooltip(tip, { permanent: false, direction: "top", className: "curated-node-tooltip" });
      marker.bindPopup(popupContent, { className: "curated-node-popup" });
      group.addLayer(marker);
    });
    group.addTo(map);
    registerLoadedLayer(fullLayerId, group);
    return;
  }

  if (usePinkLineProjection && basePaths.length > 0 && userPointsDetour.length === 0) {
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
        const icon = L.icon({
          iconUrl: memorialIconUrl,
          iconSize: [36, 36],
          iconAnchor: [18, 18],
          popupAnchor: [0, -18],
          className: "curation-memorial-marker-icon",
        });
        marker = L.marker(latlng, { icon });
      } else {
        marker = L.marker(latlng, {
          icon: L.divIcon({
            className: "pink-line-node-marker",
            html: `<div class="pink-line-node" style="background:${layerColor}"></div>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          }),
        });
      }
      const tip = formatNodeTooltip(props);
      const popupContent = formatNodePopup(props);
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
