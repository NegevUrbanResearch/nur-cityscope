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
  fetchPinkLinePaths,
  getMemorialIconForFeature,
  resolvePinkLinePackStyleBundle,
} from "../shared/curated-layer-service.js";
import { buildIntegratedRoute } from "../map-utils/pink-line-route.js";
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
 */
async function loadCuratedLayerFromAPI(fullLayerId, loadedLayersMap, registerLoadedLayer) {
  if (loadedLayersMap.has(fullLayerId)) return;

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
  const userPoints = pointItems.map((x) => x.latlng);
  const { basePaths } = await fetchPinkLinePaths();

  const hasRouteUtils = typeof buildIntegratedRoute === "function";
  const usePinkLineProjection =
    basePaths.length > 0 &&
    (userPoints.length > 0 ||
      geojson.features.some(
        (f) =>
          f.geometry &&
          (f.geometry.type === "LineString" ||
            f.geometry.type === "MultiLineString"),
      ));

  // --- Leaflet-specific rendering ---
  if (usePinkLineProjection && userPoints.length > 0 && hasRouteUtils) {
    await ensurePinkLineBaseLayer();
    const { dashed } = buildIntegratedRoute(basePaths, userPoints);
    const layerColor = getCuratedLayerColor(fullLayerId, layerData);
    const group = L.layerGroup();
    const dashedStyle = { color: layerColor, weight: 5, opacity: 0.9, dashArray: "10, 10" };
    dashed.forEach((pts) => {
      group.addLayer(L.polyline(pts, dashedStyle));
    });
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

  if (usePinkLineProjection && basePaths.length > 0 && userPoints.length === 0) {
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
