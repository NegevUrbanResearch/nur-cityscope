/**
 * Leaflet-specific layer orchestration for the GIS map.
 * Delegates heavy loading logic to dedicated loader modules.
 */

import { UI_CONFIG } from "../config/ui-config.js";
import { updateMapLegend } from "./map-legend.js";
import { loadCuratedLayerFromAPI as _loadCurated } from "./leaflet-curated-layer-loader.js";
import { loadGeoJSONLayer } from "./map-geojson-layer-loader.js";
import { loadPMTilesLayer } from "./map-pmtiles-layer-loader.js";

// Store loaded layers by full layer ID (e.g., "map_3_future.mimushim")
const loadedLayersMap = new Map();
const pendingLayerLoads = new Map();
const missingLayerConfigs = new Set();

// Store PMTiles layers with their configs for feature picking
const pmtilesLayersWithConfigs = new Map();

/**
 * Helper: register a loaded layer with both internal map and window debug handle.
 * @param {string} fullLayerId
 * @param {Object} layerInstance
 */
function registerLoadedLayer(fullLayerId, layerInstance) {
  if (!fullLayerId || !layerInstance) return;
  const existing = loadedLayersMap.get(fullLayerId);
  if (
    existing &&
    existing !== layerInstance &&
    typeof map !== "undefined" &&
    map &&
    typeof map.hasLayer === "function" &&
    typeof map.removeLayer === "function" &&
    map.hasLayer(existing)
  ) {
    map.removeLayer(existing);
  }
  const key = `layer_${fullLayerId.replace(/\./g, "_")}`;
  window[key] = layerInstance;
  loadedLayersMap.set(fullLayerId, layerInstance);
}

/**
 * Helper: get a loaded layer instance by id.
 * @param {string} fullLayerId
 * @returns {Object|null}
 */
function getLoadedLayer(fullLayerId) {
  return loadedLayersMap.get(fullLayerId) || null;
}

/**
 * Helper: register a PMTiles layer for popup handling.
 * Keeps the exported pmtilesLayersWithConfigs Map up to date.
 * @param {string} fullLayerId
 * @param {Object} layerInstance
 * @param {Object} layerConfig
 * @param {Object} popupConfig
 */
function registerPmtilesPopupLayer(
  fullLayerId,
  layerInstance,
  layerConfig,
  popupConfig,
) {
  if (!fullLayerId || !layerInstance || !popupConfig) return;
  pmtilesLayersWithConfigs.set(fullLayerId, {
    layer: layerInstance,
    config: layerConfig,
    popupConfig,
  });
}

/**
 * Load all layers from the layer registry (layer groups only).
 */
async function loadGeoJSONLayers() {
  if (typeof layerRegistry === "undefined") return;
  try {
    await layerRegistry.init();
    if (layerRegistry._initialized) {
      await loadLayerGroups();
    }
    updateMapLegend();
  } catch (error) {
    console.error("[Map] Critical error during layer loading:", error);
  }
}

/**
 * Load all layers from the new layer groups system.
 */
async function loadLayerGroups() {
  if (!layerRegistry || !layerRegistry._initialized) {
    console.warn("[Map] Layer registry not initialized");
    return;
  }

  const groups = layerRegistry.getGroups();

  // Load all layers from all groups (GIS-visible only; see gis-layer-filter.js)
  const loadPromises = [];
  for (const group of groups) {
    for (const layer of group.layers || []) {
      if (
        typeof shouldShowLayerOnGisMap === "function" &&
        !shouldShowLayerOnGisMap(group.id, layer.id)
      ) {
        continue;
      }
      const fullLayerId = `${group.id}.${layer.id}`;
      loadPromises.push(loadLayerFromRegistry(fullLayerId));
    }
  }

  await Promise.all(loadPromises);
}

/**
 * Load a curated layer — delegates to the curated-layer-loader module.
 */
async function loadCuratedLayerFromAPI(fullLayerId) {
  return _loadCurated(fullLayerId, loadedLayersMap, registerLoadedLayer);
}

/**
 * Load a single layer from the layer registry.
 * @param {string} fullLayerId - Full layer ID (e.g., "map_3_future.mimushim")
 */
async function loadLayerFromRegistry(fullLayerId) {
  if (pendingLayerLoads.has(fullLayerId)) {
    return pendingLayerLoads.get(fullLayerId);
  }

  const loadPromise = (async () => {
  if (loadedLayersMap.has(fullLayerId)) {
    // Skip already loaded layers silently
    return;
  }

  if (!layerRegistry || !layerRegistry._initialized) {
    if (fullLayerId.startsWith("curated")) {
      await loadCuratedLayerFromAPI(fullLayerId);
    }
    return;
  }

  const layerConfig = layerRegistry.getLayerConfig(fullLayerId);
  if (!layerConfig) {
    if (fullLayerId.startsWith("curated")) {
      await loadCuratedLayerFromAPI(fullLayerId);
      return;
    }
    if (!missingLayerConfigs.has(fullLayerId)) {
      missingLayerConfigs.add(fullLayerId);
      console.warn(`[Map] Layer config not found: ${fullLayerId}`);
    }
    return;
  }

  try {
    // Prefer PMTiles for GIS if available, fallback to GeoJSON
    const pmtilesUrl = layerRegistry.getLayerPMTilesUrl(fullLayerId);
    const geojsonUrl = layerRegistry.getLayerDataUrl(fullLayerId);

    if (pmtilesUrl) {
      // Use PMTiles for better performance in GIS
      await loadPMTilesLayer(fullLayerId, layerConfig, pmtilesUrl, {
        registerLoadedLayer,
        registerPmtilesPopupLayer,
      });
    } else if (geojsonUrl) {
      await loadGeoJSONLayer(
        fullLayerId,
        layerConfig,
        geojsonUrl,
        registerLoadedLayer,
      );
    } else {
      console.warn(`[Map] No data URL for layer: ${fullLayerId}`);
      return;
    }

    // Layer is stored in loadedLayersMap by loadPMTilesLayer or loadGeoJSONLayer
    // Don't set it to true here - wait for the actual layer object
  } catch (error) {
    console.error(`[Map] Error loading layer ${fullLayerId}:`, error);
  }
  })();

  pendingLayerLoads.set(fullLayerId, loadPromise);
  try {
    await loadPromise;
  } finally {
    pendingLayerLoads.delete(fullLayerId);
  }
}

// Heavy loader functions are implemented in dedicated modules:
// - loadGeoJSONLayer (map-geojson-layer-loader.js)
// - loadPMTilesLayer (map-pmtiles-layer-loader.js)

/**
 * Update layer visibility for a layer from the registry.
 * @param {string} fullLayerId - Full layer ID
 * @param {boolean} visible - Whether layer should be visible
 */
function updateLayerVisibilityFromRegistry(fullLayerId, visible) {
  const layer = getLoadedLayer(fullLayerId);
  if (!layer) {
    // Layer may not be loaded yet - this is normal during initial load
    return;
  }

  if (visible) {
    if (!map.hasLayer(layer)) {
      // Check scale/zoom constraints before adding
      if (!layer.options) layer.options = {}; // Ensure options exist

      // We need access to the config to check scaleRange.
      // The layer object itself doesn't easily expose the original config unless we stored it.
      // But we can check if the layer has zIndex of 1000 (which we set for scaled layers)
      // or try to find it in loaded configs.

      // Better approach: Re-evaluate the scale check logic here.
      // We stored the layer in loadedLayersMap. Check if we can get the config.
      // NOTE: loadedLayersMap only stores the Leaflet layer instance.

      // Let's retrieve the config from the registry again to be safe.
      let inRange = true;
      if (typeof layerRegistry !== "undefined") {
        const config = layerRegistry.getLayerConfig(fullLayerId);
        if (config && config.style && config.style.scaleRange) {
          const currentZoom = map.getZoom();
          const convertScaleToZoom = (scale) => {
            if (!scale) return null;
            if (
              typeof VisibilityUtils !== "undefined" &&
              typeof VisibilityUtils.scaleToZoom === "function"
            ) {
              return VisibilityUtils.scaleToZoom(scale);
            }
            return Math.log2(591657550 / scale);
          };

          const minZ = convertScaleToZoom(config.style.scaleRange.minScale);
          const maxZ = convertScaleToZoom(config.style.scaleRange.maxScale);

          if (minZ !== null && currentZoom < minZ) inRange = false;
          if (maxZ !== null && currentZoom > maxZ) inRange = false;

          if (
            !inRange &&
            typeof MapProjectionConfig !== "undefined" &&
            MapProjectionConfig.ENABLE_MAP_VISIBILITY_DEBUG
          ) {
            console.log(
              `[Map] Skipping addLayer for ${fullLayerId} (Zoom ${currentZoom.toFixed(
                1,
              )} out of range [${minZ?.toFixed(1) || "-"}, ${
                maxZ?.toFixed(1) || "-"
              }])`,
            );
          }
        }
      }

      if (inRange) {
        map.addLayer(layer);
      }
    }
  } else {
    if (map.hasLayer(layer)) {
      map.removeLayer(layer);
    }
  }
}

/**
 * Expose loader API for map bootstrap. map-initialization builds mapDeps from this
 * so layer-state-manager can receive explicit deps instead of relying on globals.
 * @returns {{ loadLayerFromRegistry: function, updateLayerVisibilityFromRegistry: function, loadedLayersMap: Map }}
 */
function getMapLayerLoaderAPI() {
  return {
    loadLayerFromRegistry,
    updateLayerVisibilityFromRegistry,
    loadedLayersMap,
  };
}


export {
  loadGeoJSONLayers,
  loadLayerFromRegistry,
  updateLayerVisibilityFromRegistry,
  getMapLayerLoaderAPI,
  loadedLayersMap,
  pmtilesLayersWithConfigs,
};
