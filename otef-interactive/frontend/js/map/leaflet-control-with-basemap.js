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

  // Load all layers from all groups
  const loadPromises = [];
  for (const group of groups) {
    for (const layer of group.layers || []) {
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

    if (pmtilesUrl) {
      // Use PMTiles for better performance in GIS
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

    // Check CRS and transform from EPSG:2039 (ITM) to WGS84 if needed
    // Most processed layers are in EPSG:2039 and need transformation for Leaflet
    const crs = geojson.crs?.properties?.name || '';
    if (crs.includes('2039') || crs.includes('ITM') || !crs || crs === '') {
      // Transform from EPSG:2039 (or assume it if no CRS)
      geojson = CoordUtils.transformGeojsonToWgs84(geojson);
    }

    // Get style function from StyleApplicator
    const styleFunction = StyleApplicator.getLeafletStyle(layerConfig);

    // Get popup config if available
    const popupConfig = layerConfig.ui?.popup;

    // Get layer name for popup display
    const layerDisplayName = layerConfig.name || fullLayerId.split('.').pop();

    // Create Leaflet layer with custom pane for proper z-ordering above basemaps
    let leafletLayer;
    if (layerConfig.geometryType === 'point') {
      // Use circle markers for points
      const markerOptions = StyleApplicator.getPointMarkerOptions(layerConfig);
      markerOptions.pane = 'vectorOverlay';
      leafletLayer = L.geoJSON(geojson, {
        pane: 'vectorOverlay',
        pointToLayer: (feature, latlng) => {
          return L.circleMarker(latlng, markerOptions);
        },
        onEachFeature: (feature, layer) => {
          // Attach click handler if popup config exists
          if (popupConfig && typeof renderPopupContent === 'function') {
            layer.on('click', (e) => {
              const content = renderPopupContent(feature, popupConfig, layerDisplayName);
              L.popup()
                .setLatLng(e.latlng)
                .setContent(content)
                .openOn(map);
            });
          }
        }
      });
    } else {
      // Use style function for polygons and lines
      leafletLayer = L.geoJSON(geojson, {
        pane: 'vectorOverlay',
        style: styleFunction,
        onEachFeature: (feature, layer) => {
          // Attach click handler if popup config exists
          if (popupConfig && typeof renderPopupContent === 'function') {
            layer.on('click', (e) => {
              const content = renderPopupContent(feature, popupConfig, layerDisplayName);
              L.popup()
                .setLatLng(e.latlng)
                .setContent(content)
                .openOn(map);
            });
          }
        }
      });
    }

    // Store layer reference
    window[`layer_${fullLayerId.replace(/\./g, '_')}`] = leafletLayer;
    loadedLayersMap.set(fullLayerId, leafletLayer);

    // Check if layer should be visible (from OTEFDataContext)
    // Note: Individual layer.enabled is the source of truth, not group.enabled
    if (typeof OTEFDataContext !== 'undefined') {
      const layerGroups = OTEFDataContext.getLayerGroups();
      if (layerGroups) {
        const [groupId, layerId] = fullLayerId.split('.');
        const group = layerGroups.find(g => g.id === groupId);
        if (group) {
          const layerStateObj = group.layers.find(l => l.id === layerId);
          if (layerStateObj && layerStateObj.enabled) {
            map.addLayer(leafletLayer);
          }
        }
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

    // Get style function from StyleApplicator
    const styleFunction = StyleApplicator.getLeafletStyle(layerConfig);

    // Create paint rules for protomaps-leaflet
    const paintRules = [];
    if (layerConfig.geometryType === 'polygon') {
      paintRules.push({
        dataLayer: "layer",
        symbolizer: new protomapsL.PolygonSymbolizer({
          fill: (zoom, feature) => {
            const style = styleFunction(feature);
            return style.fillColor || '#808080';
          },
          stroke: (zoom, feature) => {
            const style = styleFunction(feature);
            return style.color || '#000000';
          },
          width: (zoom, feature) => {
            const style = styleFunction(feature);
            return style.weight || 1.0;
          },
          opacity: (zoom, feature) => {
            const style = styleFunction(feature);
            return style.fillOpacity !== undefined ? style.fillOpacity : 0.7;
          }
        })
      });
    } else if (layerConfig.geometryType === 'line') {
      paintRules.push({
        dataLayer: "layer",
        symbolizer: new protomapsL.LineSymbolizer({
          stroke: (zoom, feature) => {
            const style = styleFunction(feature);
            return style.color || '#000000';
          },
          width: (zoom, feature) => {
            const style = styleFunction(feature);
            return style.weight || 1.0;
          },
          opacity: (zoom, feature) => {
            const style = styleFunction(feature);
            return style.opacity !== undefined ? style.opacity : 1.0;
          }
        })
      });
    }

    // Create vector tile layer from PMTiles file with custom pane for z-ordering
    const pmtilesLayer = protomapsL.leafletLayer({
      url: dataUrl,
      paintRules: paintRules,
      labelRules: [],
      minZoom: 9,
      minDataZoom: 9,
      maxDataZoom: 18,
      attribution: layerConfig.name || fullLayerId,
      pane: 'vectorOverlay',  // Ensure layer renders above basemaps
    });

    // Store layer reference
    window[`layer_${fullLayerId.replace(/\./g, '_')}`] = pmtilesLayer;
    loadedLayersMap.set(fullLayerId, pmtilesLayer);

    // Store PMTiles layer with config for feature picking if popup config exists
    const popupConfig = layerConfig.ui?.popup;
    if (popupConfig) {
      pmtilesLayersWithConfigs.set(fullLayerId, {
        layer: pmtilesLayer,
        config: layerConfig,
        popupConfig: popupConfig
      });
    }

    // Check if layer should be visible
    // Note: Individual layer.enabled is the source of truth, not group.enabled
    if (typeof OTEFDataContext !== 'undefined') {
      const layerGroups = OTEFDataContext.getLayerGroups();
      if (layerGroups) {
        const [groupId, layerId] = fullLayerId.split('.');
        const group = layerGroups.find(g => g.id === groupId);
        if (group) {
          const layerStateObj = group.layers.find(l => l.id === layerId);
          if (layerStateObj && layerStateObj.enabled) {
            map.addLayer(pmtilesLayer);
          }
        }
      }
    }
  } catch (error) {
    console.error(`[Map] Error loading PMTiles layer ${fullLayerId}:`, error);
    throw error;
  }
}

/**
 * Update layer visibility for a layer from the registry.
 * @param {string} fullLayerId - Full layer ID
 * @param {boolean} visible - Whether layer should be visible
 */
function updateLayerVisibilityFromRegistry(fullLayerId, visible) {
  const layer = loadedLayersMap.get(fullLayerId);
  if (!layer) {
    // Layer may not be loaded yet - this is normal during initial load
    return;
  }

  if (visible) {
    if (!map.hasLayer(layer)) {
      map.addLayer(layer);
    }
  } else {
    if (map.hasLayer(layer)) {
      map.removeLayer(layer);
    }
  }
}


