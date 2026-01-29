console.log(`[Map] Initializing leaflet-control-with-basemap.js (v1.2-fixed-scale-rendering)`);

/**
 * Leaflet-specific layer loaders for the GIS map.
 * Uses LayerRegistry and StyleApplicator only. Legacy road layers removed.
 *
 * Depends on:
 * - map, layerState, modelOverlay (from map-initialization.js)
 * - CoordUtils.transformGeojsonToWgs84 (from coordinate-utils.js)
 * - layerRegistry (from layer-registry.js)
 * - StyleApplicator (from style-applicator.js)
 */

// Store loaded layers by full layer ID (e.g., "map_3_future.mimushim")
const loadedLayersMap = new Map();
const missingLayerConfigs = new Set();

// Store PMTiles layers with their configs for feature picking (global for map click handler)
window.pmtilesLayersWithConfigs = window.pmtilesLayersWithConfigs || new Map();
const pmtilesLayersWithConfigs = window.pmtilesLayersWithConfigs;

/**
 * Helper: register a loaded layer with both internal map and window debug handle.
 * @param {string} fullLayerId
 * @param {Object} layerInstance
 */
function registerLoadedLayer(fullLayerId, layerInstance) {
  if (!fullLayerId || !layerInstance) return;
  const key = `layer_${fullLayerId.replace(/\./g, '_')}`;
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
 * Keeps the public window.pmtilesLayersWithConfigs API intact.
 * @param {string} fullLayerId
 * @param {Object} layerInstance
 * @param {Object} layerConfig
 * @param {Object} popupConfig
 */
function registerPmtilesPopupLayer(fullLayerId, layerInstance, layerConfig, popupConfig) {
  if (!fullLayerId || !layerInstance || !popupConfig) return;
  if (!window.pmtilesLayersWithConfigs) {
    window.pmtilesLayersWithConfigs = new Map();
  }
  window.pmtilesLayersWithConfigs.set(fullLayerId, {
    layer: layerInstance,
    config: layerConfig,
    popupConfig
  });
}

/**
 * Load all layers from the layer registry (layer groups only).
 */
async function loadGeoJSONLayers() {
  if (typeof layerRegistry === 'undefined') return;
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

  // Load all layers from all groups, excluding projector_base (projector-only layers)
  const loadPromises = [];
  for (const group of groups) {
    // Usually we skip projector_base group (projector-only layers),
    // but we want Tkuma_Area_LIne to render on GIS.
    for (const layer of group.layers || []) {
      if (group.id === 'projector_base' && layer.id !== 'Tkuma_Area_LIne') {
        continue;
      }
      const fullLayerId = `${group.id}.${layer.id}`;
      loadPromises.push(loadLayerFromRegistry(fullLayerId));
    }
  }

  await Promise.all(loadPromises);
}

/**
 * Load a single layer from the layer registry.
 * @param {string} fullLayerId - Full layer ID (e.g., "map_3_future.mimushim")
 */
async function loadLayerFromRegistry(fullLayerId) {
  if (loadedLayersMap.has(fullLayerId)) {
    // Skip already loaded layers silently
    return;
  }

  if (!layerRegistry || !layerRegistry._initialized) {
    return;
  }

  const layerConfig = layerRegistry.getLayerConfig(fullLayerId);
  if (!layerConfig) {
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

    console.log(`[Map] Loading layer ${fullLayerId}: pmtiles=${pmtilesUrl}, geojson=${geojsonUrl}`);

    if (fullLayerId.includes('שבילי_אופניים')) {
      console.log(`[Map Debug] Layer Config for ${fullLayerId}:`, JSON.stringify(layerConfig, null, 2));
    }

    if (pmtilesUrl) {
      // Use PMTiles for better performance in GIS
      console.log(`[Map] Using PMTiles for ${fullLayerId}`);
      await loadPMTilesLayer(fullLayerId, layerConfig, pmtilesUrl);
    } else if (geojsonUrl) {
      // Fallback to GeoJSON
      await loadGeoJSONLayer(fullLayerId, layerConfig, geojsonUrl);
    } else {
      console.warn(`[Map] No data URL for layer: ${fullLayerId}`);
      return;
    }

    // Layer is stored in loadedLayersMap by loadPMTilesLayer or loadGeoJSONLayer
    // Don't set it to true here - wait for the actual layer object
  } catch (error) {
    console.error(`[Map] Error loading layer ${fullLayerId}:`, error);
  }
}

/**
 * Load a GeoJSON layer from the registry.
 */
async function loadGeoJSONLayer(fullLayerId, layerConfig, dataUrl) {
  try {
    const response = await fetch(dataUrl);
    if (!response.ok) {
      throw new Error(`Failed to load layer data: ${response.status}`);
    }

    let geojson = await response.json();

    // Check CRS and transform to WGS84 if needed
    // Processed layers should already be in WGS84, but handle edge cases
    const crs = geojson.crs?.properties?.name || '';
    if (crs.includes('2039') || crs.includes('ITM')) {
      // Transform from EPSG:2039 (ITM) to WGS84
      geojson = CoordUtils.transformGeojsonToWgs84(geojson);
    } else if (crs.includes('3857') || crs.includes('Web Mercator')) {
      // Transform from EPSG:3857 (Web Mercator) to WGS84
      geojson = CoordUtils.transformGeojsonFrom3857ToWgs84(geojson);
    }
    // If already WGS84 or no CRS (assume WGS84), no transformation needed

    // Create Leaflet layer (style + popups) via LayerFactory
    const leafletLayer = typeof LayerFactory !== 'undefined'
      ? LayerFactory.createGeoJsonLayer({
          fullLayerId,
          layerConfig,
          geojson,
          map
        })
      : null;

    if (!leafletLayer) {
      console.warn(`[Map] Failed to create GeoJSON layer for ${fullLayerId}`);
      return;
    }

    // Apply minScale/maxScale visibility based on zoom level
    const scaleRange = layerConfig.style?.scaleRange;
    if (scaleRange) {
      const minScale = scaleRange.minScale;
      const maxScale = scaleRange.maxScale;

      // Prefer shared visibility-utils conversion when available
      const convertScaleToZoom = (scale) => {
        if (!scale) return null;
        if (typeof VisibilityUtils !== 'undefined' && typeof VisibilityUtils.scaleToZoom === 'function') {
          return VisibilityUtils.scaleToZoom(scale);
        }
        // Fallback to legacy inline formula (kept for safety)
        return Math.log2(591657550 / scale);
      };

      const minZoom = convertScaleToZoom(minScale);
      const maxZoom = convertScaleToZoom(maxScale);

      if (typeof MapProjectionConfig !== 'undefined' && MapProjectionConfig.ENABLE_MAP_VISIBILITY_DEBUG) {
        console.log(
          `[Map] Scale range for ${fullLayerId}: scale[${minScale || '-'}, ${maxScale || '-'}] -> zoom[${minZoom?.toFixed(1) || '-'}, ${maxZoom?.toFixed(1) || '-'}]`
        );
      }

      try {
        if (leafletLayer.setZIndex) leafletLayer.setZIndex(1000);
      } catch (e) { }

      // Also handle visibility on zoom change using visibility controller
      const updateLayerVisibility = () => {
        const currentZoom = map.getZoom();

        if (typeof VisibilityController !== 'undefined' && typeof LayerStateHelper !== 'undefined') {
          const allowed = VisibilityController.shouldLayerBeVisible({
            fullLayerId,
            scaleRange,
            zoom: currentZoom,
            layerStateHelper: LayerStateHelper
          });

          if (!allowed) {
            if (map.hasLayer(leafletLayer)) {
              console.log(`[Map] Hiding ${fullLayerId} at zoom ${currentZoom.toFixed(1)} (range ${minZoom?.toFixed(1)||'-'} to ${maxZoom?.toFixed(1)||'-'})`);
              map.removeLayer(leafletLayer);
            }
          } else if (!map.hasLayer(leafletLayer)) {
            console.log(`[Map] Showing ${fullLayerId} at zoom ${currentZoom.toFixed(1)}`);
            map.addLayer(leafletLayer);
          }
        }
      };

      map.on('zoomend', updateLayerVisibility);
      updateLayerVisibility(); // Initial check
    } else {
      // No scale restrictions - use normal visibility logic
      if (typeof LayerStateHelper !== 'undefined') {
        const state = LayerStateHelper.getLayerState(fullLayerId);
        if (state && state.enabled) {
          map.addLayer(leafletLayer);
        }
      }
    }

    // Store layer reference
    registerLoadedLayer(fullLayerId, leafletLayer);

    // Initial addition to map if enabled and in range
    if (typeof VisibilityController !== 'undefined' && typeof LayerStateHelper !== 'undefined') {
      const currentZoom = map.getZoom();
      const allowed = VisibilityController.shouldLayerBeVisible({
        fullLayerId,
        scaleRange,
        zoom: currentZoom,
        layerStateHelper: LayerStateHelper
      });

      if (typeof MapProjectionConfig !== 'undefined' && MapProjectionConfig.ENABLE_MAP_VISIBILITY_DEBUG) {
        const minZ = scaleRange && scaleRange.minScale ? convertScaleToZoom(scaleRange.minScale) : null;
        const maxZ = scaleRange && scaleRange.maxScale ? convertScaleToZoom(scaleRange.maxScale) : null;
        console.log(
          `[Map] Visibility Check ${fullLayerId}: Zoom=${currentZoom.toFixed(2)}, Range=[${minZ?.toFixed(2) || '-'}, ${maxZ?.toFixed(2) || '-'}], Visible=${allowed}`
        );
      }

      if (allowed) {
        map.addLayer(leafletLayer);
      }
    }
  } catch (error) {
    console.error(`[Map] Error loading GeoJSON layer ${fullLayerId}:`, error);
    throw error;
  }
}

/**
 * Load a PMTiles layer from the registry.
 */
async function loadPMTilesLayer(fullLayerId, layerConfig, dataUrl) {
  try {

    // Create vector tile layer from PMTiles file with custom pane for z-ordering
    const pmtilesLayer = typeof LayerFactory !== 'undefined'
      ? LayerFactory.createPmtilesLayer({
          fullLayerId,
          layerConfig,
          dataUrl
        })
      : null;

    if (!pmtilesLayer) {
      console.warn(`[Map] Failed to create PMTiles layer for ${fullLayerId}`);
      return;
    }

    // Apply scale ranges if present
    const scaleRange = layerConfig.style?.scaleRange;
    if (scaleRange) {
      const getZoomFromScale = (scale) => scale ? Math.log2(591657550 / scale) : null;
      const minZoom = getZoomFromScale(scaleRange.minScale);
      const maxZoom = getZoomFromScale(scaleRange.maxScale);

      const updatePmtilesVisibility = () => {
        const currentZoom = map.getZoom();

        if (typeof VisibilityController !== 'undefined' && typeof LayerStateHelper !== 'undefined') {
          const allowed = VisibilityController.shouldLayerBeVisible({
            fullLayerId,
            scaleRange,
            zoom: currentZoom,
            layerStateHelper: LayerStateHelper
          });

          if (!allowed) {
            if (map.hasLayer(pmtilesLayer)) map.removeLayer(pmtilesLayer);
          } else if (!map.hasLayer(pmtilesLayer)) {
            map.addLayer(pmtilesLayer);
          }
        }
      };

      map.on('zoomend', updatePmtilesVisibility);
      // Initial check will be handled by the context listener or below
    }

    // Register with global map click handler for popups if config exists
    const popupConfig = layerConfig.ui?.popup;
    if (popupConfig) {
      console.log(`[Map] Registering PMTiles layer ${fullLayerId} for popups`);
      registerPmtilesPopupLayer(fullLayerId, pmtilesLayer, layerConfig, popupConfig);
    }

    // Store layer reference
    registerLoadedLayer(fullLayerId, pmtilesLayer);

    // Initial addition to map if enabled (and in range)
    if (typeof VisibilityController !== 'undefined' && typeof LayerStateHelper !== 'undefined') {
      const currentZoom = map.getZoom();
      const allowed = VisibilityController.shouldLayerBeVisible({
        fullLayerId,
        scaleRange,
        zoom: currentZoom,
        layerStateHelper: LayerStateHelper
      });

      if (allowed) {
        map.addLayer(pmtilesLayer);
      }
    }
  } catch (error) {
    console.error(`[Map] Error loading PMTiles layer ${fullLayerId}:`, error);
  }
}

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
      if (typeof layerRegistry !== 'undefined') {
        const config = layerRegistry.getLayerConfig(fullLayerId);
          if (config && config.style && config.style.scaleRange) {
            const currentZoom = map.getZoom();
            const convertScaleToZoom = (scale) => {
              if (!scale) return null;
              if (typeof VisibilityUtils !== 'undefined' && typeof VisibilityUtils.scaleToZoom === 'function') {
                return VisibilityUtils.scaleToZoom(scale);
              }
              return Math.log2(591657550 / scale);
            };

            const minZ = convertScaleToZoom(config.style.scaleRange.minScale);
            const maxZ = convertScaleToZoom(config.style.scaleRange.maxScale);

            if (minZ !== null && currentZoom < minZ) inRange = false;
            if (maxZ !== null && currentZoom > maxZ) inRange = false;

            if (!inRange && typeof MapProjectionConfig !== 'undefined' && MapProjectionConfig.ENABLE_MAP_VISIBILITY_DEBUG) {
              console.log(
                `[Map] Skipping addLayer for ${fullLayerId} (Zoom ${currentZoom.toFixed(1)} out of range [${minZ?.toFixed(1) || '-'}, ${maxZ?.toFixed(1) || '-'}])`
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


