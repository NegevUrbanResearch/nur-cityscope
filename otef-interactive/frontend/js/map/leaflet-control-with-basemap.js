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

/**
 * Load all layers from the new layer groups system and legacy layers.
 */
async function loadGeoJSONLayers() {
  console.log("[Map] Loading layers...");

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
    console.log("[Map] All layers loaded successfully");

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
  console.log(`[Map] Found ${groups.length} layer group(s)`);

  // Load all layers from all groups
  const loadPromises = [];
  for (const group of groups) {
    for (const layer of group.layers || []) {
      const fullLayerId = `${group.id}.${layer.id}`;
      loadPromises.push(loadLayerFromRegistry(fullLayerId));
    }
  }

  await Promise.all(loadPromises);
  console.log(`[Map] Loaded ${loadedLayersMap.size} layer(s) from registry`);
}

/**
 * Load a single layer from the layer registry.
 * @param {string} fullLayerId - Full layer ID (e.g., "map_3_future.mimushim")
 */
async function loadLayerFromRegistry(fullLayerId) {
  if (loadedLayersMap.has(fullLayerId)) {
    console.log(`[Map] Layer ${fullLayerId} already loaded`);
    return;
  }

  const layerConfig = layerRegistry.getLayerConfig(fullLayerId);
  if (!layerConfig) {
    console.warn(`[Map] Layer config not found: ${fullLayerId}`);
    return;
  }

  console.log(`[Map] Loading layer: ${fullLayerId} (${layerConfig.geometryType}, ${layerConfig.format})`);

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
    console.log(`[Map] Loaded ${geojson.features?.length || 0} features for ${fullLayerId}`);

    // Check CRS and transform from EPSG:2039 (ITM) to WGS84 if needed
    // Most processed layers are in EPSG:2039 and need transformation for Leaflet
    const crs = geojson.crs?.properties?.name || '';
    if (crs.includes('2039') || crs.includes('ITM')) {
      console.log(`[Map] Transforming ${fullLayerId} from EPSG:2039 to WGS84`);
      geojson = CoordUtils.transformGeojsonToWgs84(geojson);
    } else if (!crs || crs === '') {
      // No CRS specified - assume EPSG:2039 for processed layers (safe default for this project)
      console.log(`[Map] No CRS specified for ${fullLayerId}, assuming EPSG:2039 - transforming to WGS84`);
      geojson = CoordUtils.transformGeojsonToWgs84(geojson);
    }

    // Get style function from StyleApplicator
    const styleFunction = StyleApplicator.getLeafletStyle(layerConfig);

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
        }
      });
    } else {
      // Use style function for polygons and lines
      leafletLayer = L.geoJSON(geojson, {
        pane: 'vectorOverlay',
        style: styleFunction
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

    console.log(`[Map] Layer ${fullLayerId} ready (GeoJSON)`);
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
    console.log(`[Map] Loading PMTiles layer: ${fullLayerId}`);

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

    console.log(`[Map] Layer ${fullLayerId} ready (PMTiles)`);
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
    console.warn(`[Map] Layer not found for visibility update: ${fullLayerId}`);
    return;
  }

  console.log(`[Map] Updating visibility for ${fullLayerId}: visible=${visible}, hasLayer=${map.hasLayer(layer)}`);
  
  if (visible) {
    if (!map.hasLayer(layer)) {
      console.log(`[Map] Adding layer to map: ${fullLayerId}`);
      map.addLayer(layer);
    }
  } else {
    if (map.hasLayer(layer)) {
      console.log(`[Map] Removing layer from map: ${fullLayerId}`);
      map.removeLayer(layer);
    }
  }
}

/**
 * Load parcels layer from PMTiles (vector tiles for performance)
 */
async function loadParcelsFromPMTiles(layerConfig) {
  console.log("Loading parcels from PMTiles...");

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

    console.log("Parcels layer ready (PMTiles)");
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
    console.warn("Roads layer configuration not found");
    return;
  }

  console.log("Loading roads from GeoJSON...");

  try {
    // Use shared helper to resolve config to GeoJSON
    const geojson = await loadGeojsonFromConfig(layerConfig);

    console.log(`Roads: ${geojson.features?.length || 0} features, transforming...`);

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

    console.log("Roads layer ready (GeoJSON)");
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
    console.warn("Major roads layer configuration not found");
    return;
  }

  console.log("Loading major roads from GeoJSON...");

  try {
    // Use shared helper to resolve config to GeoJSON
    const geojson = await loadGeojsonFromConfig(layerConfig);

    console.log(`Major roads: ${geojson.features?.length || 0} features, transforming...`);

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

    console.log("Major roads layer ready (GeoJSON)");
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
    console.warn("Small roads layer configuration not found");
    return;
  }

  console.log("Loading small roads from GeoJSON...");

  try {
    // Use shared helper to resolve config to GeoJSON
    let geojson = await loadGeojsonFromConfig(layerConfig);

    console.log(`Small roads: ${geojson.features?.length || 0} features`);

    // Check CRS and transform if needed (some files may be in EPSG:2039)
    const crs = geojson.crs?.properties?.name || '';
    if (crs.includes('2039') || crs.includes('ITM')) {
      console.log("Small roads: Transforming from EPSG:2039 to WGS84");
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

    console.log("Small roads layer ready (GeoJSON)");
  } catch (error) {
    console.error("Error loading small roads:", error);
  }
}
