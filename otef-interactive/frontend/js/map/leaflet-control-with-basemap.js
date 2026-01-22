/**
 * Leaflet-specific layer loaders for the GIS map.
 * These functions handle the Leaflet rendering side (creating L.geoJSON layers, PMTiles setup)
 * while delegating data fetching to the shared layer-loader.js helpers.
 * 
 * Depends on:
 * - map, layerState, parcelsLayer, roadsLayer, majorRoadsLayer, smallRoadsLayer (from map-initialization.js)
 * - CoordUtils.transformGeojsonToWgs84 (from coordinate-utils.js)
 * - getRoadStyle, getMajorRoadStyle, getSmallRoadStyle, getLandUseColor (from vector-styling.js)
 * - loadAllLayerConfigs, loadGeojsonFromConfig (from layer-loader.js)
 */

/**
 * Load all GeoJSON layers in parallel using shared loader helpers.
 */
async function loadGeoJSONLayers() {
  console.log("Loading layers...");

  const tableName = window.tableSwitcher?.getCurrentTable() || 'otef';

  try {
    // Use shared helper to fetch all layer configs
    const layers = await loadAllLayerConfigs(tableName);

    // Start all layer downloads in parallel
    // We pass the layer config object to the loader functions so they don't need to fetch it again
    await Promise.all([
      loadParcelsFromPMTiles(layers.find(l => l.name === 'parcels')),
      loadRoadsFromGeoJSON(layers.find(l => l.name === 'roads')),
      loadMajorRoadsFromGeoJSON(layers.find(l => l.name === 'majorRoads')),
      loadSmallRoadsFromGeoJSON(layers.find(l => l.name === 'smallRoads'))
    ]);

    updateMapLegend();
    console.log("All layers loaded successfully");

  } catch (error) {
    console.error("Critical error during layer loading:", error);
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

    // Create vector tile layer from local PMTiles file
    parcelsLayer = protomapsL.leafletLayer({
      url: 'data/parcels.pmtiles',
      paintRules: paintRules,
      labelRules: [],
      minZoom: 9,
      minDataZoom: 9,
      maxDataZoom: 18,
      attribution: 'OTEF Parcels',
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
 * Data is already in WGS84, no transformation needed
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
    const geojson = await loadGeojsonFromConfig(layerConfig);

    console.log(`Small roads: ${geojson.features?.length || 0} features`);

    // Already in WGS84, no transformation needed
    smallRoadsLayer = L.geoJSON(geojson, {
      // Use shared small road styling from vector-styling.js
      style: getSmallRoadStyle,
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
