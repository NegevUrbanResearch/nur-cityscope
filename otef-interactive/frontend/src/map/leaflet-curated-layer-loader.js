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
} from "../shared/curated-layer-service.js";
import { buildIntegratedRoute } from "../map-utils/pink-line-route.js";

let pinkLineBaseLayerInstance = null;
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
    const { basePaths } = await fetchPinkLinePaths();
    if (basePaths.length === 0) return;
    const group = L.layerGroup();
    const baseStyle = { color: "#ff69b4", weight: 5, opacity: 1 };
    basePaths.forEach((path) => {
      group.addLayer(L.polyline(path, baseStyle));
    });
    group.addTo(map);
    pinkLineBaseLayerInstance = group;
  } catch (_) {}
}

/**
 * Explicitly control visibility of the shared pink-line base layer on the GIS map.
 * Called from layer-state-manager so that when all curated layers are disabled,
 * the base pink line is also hidden.
 */
function setPinkLineBaseVisibility(visible) {
  if (typeof map === "undefined" || !map) return;

  if (visible) {
    if (pinkLineBaseLayerInstance) {
      if (!map.hasLayer(pinkLineBaseLayerInstance)) {
        pinkLineBaseLayerInstance.addTo(map);
      }
    } else {
      // Lazily create and add the base layer when first needed.
      // No need to await; it will appear once loaded.
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
  let { geojson } = result;

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

  // --- Memorial-only layers: render as PNG icons, no pink-line integration ---
  const hasMemorialPoints = pointItems.some(({ feature }) =>
    getMemorialIconForFeature((feature && feature.properties) || {}),
  );
  const hasLineFeatures = geojson.features.some(
    (f) =>
      f.geometry &&
      (f.geometry.type === "LineString" ||
        f.geometry.type === "MultiLineString"),
  );

  if (hasMemorialPoints && !hasLineFeatures) {
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
        marker = L.marker(latlng);
      }

      const tip = formatNodeTooltip(props);
      const popupContent = formatNodePopup(props);
      marker.bindTooltip(tip, {
        permanent: false,
        direction: "top",
        className: "curated-node-tooltip",
      });
      marker.bindPopup(popupContent, {
        className: "curated-node-popup",
      });
      group.addLayer(marker);
    });
    group.addTo(map);
    registerLoadedLayer(fullLayerId, group);
    return;
  }

  // --- Leaflet-specific rendering ---
  if (usePinkLineProjection && userPoints.length > 0 && hasRouteUtils) {
    await ensurePinkLineBaseLayer();
    const { dashed } = buildIntegratedRoute(basePaths, userPoints);
    const layerColor = getCuratedLayerColor(fullLayerId);
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
    const layerColor = getCuratedLayerColor(fullLayerId);
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

export { loadCuratedLayerFromAPI, setPinkLineBaseVisibility };
