/**
 * Leaflet-specific layer loaders for the GIS map.
 * These functions handle the Leaflet rendering side (creating L.geoJSON layers, PMTiles setup)
 * while delegating data fetching to the shared layer-loader.js helpers.
 *
 * Updated to support new layer groups system with LayerRegistry and StyleApplicator.
 * Maintains backward compatibility with legacy layers.
 *
 * Depends on:
 * - map, layerState, parcelsLayer, roadsLayer, majorRoadsLayer, smallRoadsLayer (from map-initialization.js)
 * - CoordUtils.transformGeojsonToWgs84 (from coordinate-utils.js)
 * - getRoadStyle, getMajorRoadStyle, getSmallRoadStyle, getLandUseColor (from vector-styling.js)
 * - loadAllLayerConfigs, loadGeojsonFromConfig (from layer-loader.js)
 * - layerRegistry (from layer-registry.js)
 * - StyleApplicator (from style-applicator.js)
 */

// Store loaded layers by full layer ID (e.g., "map_3_future.mimushim")
const loadedLayersMap = new Map();

// Store PMTiles layers with their configs for feature picking (global for map click handler)
window.pmtilesLayersWithConfigs = window.pmtilesLayersWithConfigs || new Map();
const pmtilesLayersWithConfigs = window.pmtilesLayersWithConfigs;

/**
 * Load all layers from the new layer groups system and legacy layers.
 */
async function loadGeoJSONLayers() {

  // Initialize layer registry if available
  if (typeof layerRegistry !== 'undefined') {
    await layerRegistry.init();
  }

  const tableName = window.tableSwitcher?.getCurrentTable() || 'otef';

  try {
    // Load new layer groups system
    if (typeof layerRegistry !== 'undefined' && layerRegistry._initialized) {
      await loadLayerGroups();
    }

    // Load legacy layers for backward compatibility
    const layers = await loadAllLayerConfigs(tableName);
    await Promise.all([
      loadParcelsFromPMTiles(layers.find(l => l.name === 'parcels')),
      loadRoadsFromGeoJSON(layers.find(l => l.name === 'roads')),
      loadMajorRoadsFromGeoJSON(layers.find(l => l.name === 'majorRoads')),
      loadSmallRoadsFromGeoJSON(layers.find(l => l.name === 'smallRoads'))
    ]);

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

  const layerConfig = layerRegistry.getLayerConfig(fullLayerId);
  if (!layerConfig) {
    console.warn(`[Map] Layer config not found: ${fullLayerId}`);
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

/**
 * Load parcels layer from PMTiles (vector tiles for performance)
 */
async function loadParcelsFromPMTiles(layerConfig) {

  try {
    // Create paint rules for protomaps-leaflet
    // Each rule colors parcels based on TARGUMYEUD or KVUZ_TRG property
    const paintRules = [
      {
        dataLayer: "parcels",
        symbolizer: new protomapsL.PolygonSymbolizer({
          fill: (zoom, feature) => {
            const landUse = feature.props?.TARGUMYEUD || feature.props?.KVUZ_TRG || '';
            // Delegate to shared land-use color helper from vector-styling.js
            if (typeof getLandUseColor === 'function') {
              return getLandUseColor(landUse);
            }
            // Very conservative fallback if helper is unavailable for some reason
            return '#E0E0E0';
          },
          stroke: "#333333",
          width: 0.5,
          opacity: 0.5,  // Transparency to see map beneath
        })
      }
    ];

    // Create vector tile layer from local PMTiles file with custom pane for z-ordering
    parcelsLayer = protomapsL.leafletLayer({
      url: 'data/parcels.pmtiles',
      paintRules: paintRules,
      labelRules: [],
      minZoom: 9,
      minDataZoom: 9,
      maxDataZoom: 18,
      attribution: 'OTEF Parcels',
      pane: 'vectorOverlay',  // Ensure layer renders above basemaps
    });

    window.parcelsLayer = parcelsLayer;

    // Check state - if enabled, add to map immediately
    if (layerState.parcels) {
      map.addLayer(parcelsLayer);
    }
  } catch (error) {
    console.error("Error loading parcels from PMTiles:", error);
    // Fallback: parcels layer unavailable
    parcelsLayer = null;
  }
}

/**
 * Load roads layer from GeoJSON (small layer, simple approach)
 * Uses shared layer-loader.js helpers for data fetching.
 */
async function loadRoadsFromGeoJSON(layerConfig) {
  // If config not provided (legacy call), fetch it using shared helper
  if (!layerConfig) {
    const tableName = window.tableSwitcher?.getCurrentTable() || 'otef';
    try {
      layerConfig = await loadLayerConfig(tableName, 'roads');
    } catch(e) {
      console.warn("Failed to fetch legacy layer config", e);
    }
  }

  if (!layerConfig) {
    return;
  }

  try {
    // Use shared helper to resolve config to GeoJSON
    const geojson = await loadGeojsonFromConfig(layerConfig);

    // Transform from EPSG:2039 to WGS84 using shared coordinate utils
    const transformed = CoordUtils.transformGeojsonToWgs84(geojson);

    roadsLayer = L.geoJSON(transformed, {
      // Use shared road styling from vector-styling.js (single source of truth)
      style: getRoadStyle,
      pane: 'vectorOverlay',  // Ensure layer renders above basemaps
    });

    window.roadsLayer = roadsLayer;

    // Check state - if enabled, add to map immediately
    if (layerState.roads) {
      map.addLayer(roadsLayer);
    }
  } catch (error) {
    console.error("Error loading roads:", error);
  }
}

/**
 * Load major roads layer from GeoJSON file (road-big.geojson)
 * Data is in EPSG:2039, needs transformation
 * Uses shared layer-loader.js helpers for data fetching.
 */
async function loadMajorRoadsFromGeoJSON(layerConfig) {
  // If config not provided (legacy call), fetch it using shared helper
  if (!layerConfig) {
    const tableName = window.tableSwitcher?.getCurrentTable() || 'otef';
    try {
      layerConfig = await loadLayerConfig(tableName, 'majorRoads');
    } catch(e) {
      console.warn("Failed to fetch legacy layer config", e);
    }
  }

  if (!layerConfig) {
    return;
  }

  try {
    // Use shared helper to resolve config to GeoJSON
    const geojson = await loadGeojsonFromConfig(layerConfig);

    // Transform from EPSG:2039 to WGS84 using shared coordinate utils
    const transformed = CoordUtils.transformGeojsonToWgs84(geojson);

    majorRoadsLayer = L.geoJSON(transformed, {
      // Use shared major road styling from vector-styling.js
      style: getMajorRoadStyle,
      pane: 'vectorOverlay',  // Ensure layer renders above basemaps
    });

    window.majorRoadsLayer = majorRoadsLayer;

    // Check state - if enabled, add to map immediately
    if (layerState.majorRoads) {
      map.addLayer(majorRoadsLayer);
    }
  } catch (error) {
    console.error("Error loading major roads:", error);
  }
}

/**
 * Load small roads layer from GeoJSON file (Small-road-limited.geojson)
 * Data may be in EPSG:2039 or WGS84, check and transform if needed.
 * Uses shared layer-loader.js helpers for data fetching.
 */
async function loadSmallRoadsFromGeoJSON(layerConfig) {
  // If config not provided (legacy call), fetch it using shared helper
  if (!layerConfig) {
    const tableName = window.tableSwitcher?.getCurrentTable() || 'otef';
    try {
      layerConfig = await loadLayerConfig(tableName, 'smallRoads');
    } catch(e) {
      console.warn("Failed to fetch legacy layer config", e);
    }
  }

  if (!layerConfig) {
    return;
  }

  try {
    // Use shared helper to resolve config to GeoJSON
    let geojson = await loadGeojsonFromConfig(layerConfig);

    // Check CRS and transform if needed (some files may be in EPSG:2039)
    const crs = geojson.crs?.properties?.name || '';
    if (crs.includes('2039') || crs.includes('ITM')) {
      geojson = CoordUtils.transformGeojsonToWgs84(geojson);
    }

    smallRoadsLayer = L.geoJSON(geojson, {
      // Use shared small road styling from vector-styling.js
      style: getSmallRoadStyle,
      pane: 'vectorOverlay',  // Ensure layer renders above basemaps
    });

    window.smallRoadsLayer = smallRoadsLayer;

    // Check state - if enabled, add to map immediately
    if (layerState.smallRoads) {
      map.addLayer(smallRoadsLayer);
    }
  } catch (error) {
    console.error("Error loading small roads:", error);
  }
}
