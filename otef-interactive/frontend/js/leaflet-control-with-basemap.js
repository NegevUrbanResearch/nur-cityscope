// IMPROVED VERSION: Uses WGS84 with real basemap and transforms layers from EPSG:2039

// Define EPSG:2039 projection for transformation
proj4.defs(
  "EPSG:2039",
  "+proj=tmerc +lat_0=31.73439361111111 +lon_0=35.20451694444445 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=-24.0024,-17.1032,-17.8444,0.33077,-1.85269,1.66969,5.4248 +units=m +no_defs"
);

// Model bounds (in EPSG:2039)
let modelBounds;

// Initialize map in WGS84 (standard Leaflet)
const map = L.map("map", {
  minZoom: 10,
  maxZoom: 19,
  zoomControl: false, // Zoom controlled by remote controller only
  maxBoundsViscosity: 1.0, // Prevent dragging outside bounds
});

// Add OpenStreetMap basemap
const osmLayer = L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }
).addTo(map);

// Alternative basemaps (can be switched)
const basemaps = {
  OpenStreetMap: osmLayer,
  Satellite: L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Tiles &copy; Esri",
      maxZoom: 19,
    }
  ),
  Light: L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    {
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
      maxZoom: 19,
    }
  ),
};

// Layer references
let parcelsLayer, roadsLayer, modelOverlay, majorRoadsLayer, smallRoadsLayer;

// Layer state tracking
let layerState = {
  roads: true,
  parcels: false,
  model: false,
  majorRoads: false,
  smallRoads: false,
};

// WebSocket client instance
let wsClient = null;

// GIS map is receive-only - no need for echo prevention flags

// Helper function to transform coordinates from EPSG:2039 to WGS84
function transformItmToWgs84(x, y) {
  const [lon, lat] = proj4("EPSG:2039", "EPSG:4326", [x, y]);
  return [lat, lon]; // Return as [lat, lon] for Leaflet
}

// Helper function to transform GeoJSON from EPSG:2039 to WGS84
function transformGeojsonToWgs84(geojson) {
  const transformed = JSON.parse(JSON.stringify(geojson)); // Deep clone

  function transformCoords(coords, depth = 0) {
    if (depth > 10) return coords; // Safety limit

    if (typeof coords[0] === "number") {
      // This is a coordinate pair [x, y] in EPSG:2039
      const [lon, lat] = proj4("EPSG:2039", "EPSG:4326", [
        coords[0],
        coords[1],
      ]);
      return [lon, lat];
    } else {
      // Recurse into nested arrays
      return coords.map((c) => transformCoords(c, depth + 1));
    }
  }

  // Transform each feature's geometry
  if (transformed.features) {
    transformed.features.forEach((feature) => {
      if (feature.geometry && feature.geometry.coordinates) {
        feature.geometry.coordinates = transformCoords(
          feature.geometry.coordinates
        );
      }
    });
  }

  // Update CRS to WGS84
  transformed.crs = {
    type: "name",
    properties: { name: "EPSG:4326" },
  };

  return transformed;
}

// Load model bounds and initialize
fetch("data/model-bounds.json")
  .then((res) => res.json())
  .then((bounds) => {
    modelBounds = bounds;
    console.log("Model bounds loaded (EPSG:2039):", bounds);

    // Transform bounds to WGS84
    const [swLat, swLon] = transformItmToWgs84(bounds.west, bounds.south);
    const [neLat, neLon] = transformItmToWgs84(bounds.east, bounds.north);

    const wgs84Bounds = L.latLngBounds(
      L.latLng(swLat, swLon),
      L.latLng(neLat, neLon)
    );

    console.log("Model bounds in WGS84:", {
      sw: [swLat, swLon],
      ne: [neLat, neLon],
    });

    // Restrict map to model bounds only
    map.setMaxBounds(wgs84Bounds);

    // Calculate minimum zoom level that fits the geotif bounds exactly
    // This prevents zooming out beyond the maximum extent of the geotif
    const minZoomForBounds = map.getBoundsZoom(wgs84Bounds, false);
    map.setMinZoom(minZoomForBounds);

    console.log(`Minimum zoom set to ${minZoomForBounds} to fit geotif bounds`);

    map.fitBounds(wgs84Bounds);

    console.log("Map bounds restricted to model area");

    // Add model image overlay (hidden by default)
    modelOverlay = L.imageOverlay("data/model-transparent.png", wgs84Bounds, {
      opacity: 0.7,
      interactive: false,
      className: "model-overlay",
    }); // Don't add to map on init

    window.modelLayer = modelOverlay;
      layerState.model = false;
      updateMapLegend(); // Update legend

    console.log("Map initialized with WGS84 basemap!");

    // Initialize WebSocket for remote control (before loading layers)
    initializeWebSocket();

    // Load GeoJSON layers
    loadGeoJSONLayers();
  })
  .catch((error) => {
    console.error("Error loading model bounds:", error);
  });

async function loadGeoJSONLayers() {
  console.log("Loading layers...");

  // Load parcels from PMTiles (fast vector tiles)
  await loadParcelsFromPMTiles();

  // Load roads from GeoJSON (small layer, keep simple)
  await loadRoadsFromGeoJSON();

  updateMapLegend();
  console.log("All layers loaded");
}

/**
 * Load parcels layer from PMTiles (vector tiles for performance)
 */
async function loadParcelsFromPMTiles() {
  console.log("Loading parcels from PMTiles...");

  try {
    // Land use color mapping for protomaps styling
    const LAND_USE_COLORS = {
      'מגורים': '#FFD700', 'דיור': '#FFE4B5',
      'מסחר': '#FF6B6B', 'משרדים': '#FFA07A',
      'תעשיה': '#9370DB', 'תעשיה ומלאכה': '#8A2BE2', 'מלאכה': '#BA55D3',
      'שטח ציבורי פתוח': '#90EE90', 'שטחים פתוחים': '#98FB98', 'גן': '#7CFC00', 'פארק': '#ADFF2F',
      'חקלאות': '#F0E68C', 'יערות': '#228B22', 'יערות - חורשות': '#2E8B57',
      'דרכים': '#C0C0C0', 'שטח לדרכים': '#D3D3D3', 'דרך': '#BEBEBE',
      'מוסד ציבורי': '#87CEEB', 'מבנה ציבור': '#4682B4', 'חינוך': '#4169E1', 'בריאות': '#6495ED',
      'ספורט': '#7FFFD4', 'תיירות': '#FF69B4', 'דת': '#E6E6FA', 'בית עלמין': '#2F4F4F',
    };
    const DEFAULT_COLOR = '#E0E0E0';

    // Create paint rules for protomaps-leaflet
    // Each rule colors parcels based on TARGUMYEUD or KVUZ_TRG property
    const paintRules = [
      {
        dataLayer: "parcels",
        symbolizer: new protomapsL.PolygonSymbolizer({
          fill: (zoom, feature) => {
            const landUse = feature.props?.TARGUMYEUD || feature.props?.KVUZ_TRG || '';
            for (const [key, color] of Object.entries(LAND_USE_COLORS)) {
              if (landUse.includes(key)) return color;
            }
            return DEFAULT_COLOR;
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

    // If state says parcels should be visible, add layer now
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
 */
async function loadRoadsFromGeoJSON() {
  console.log("Loading roads from GeoJSON...");

  const tableName = window.tableSwitcher?.getCurrentTable() || 'otef';
  const apiUrl = `/api/actions/get_otef_layers/?table=${tableName}`;

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Failed to load layers: ${response.status}`);
    }

    const layers = await response.json();
    const roadsData = layers.find(l => l.name === 'roads');

    if (!roadsData) {
      console.warn("Roads layer not found in database");
      return;
    }

    let geojson;
    if (roadsData.geojson) {
      geojson = roadsData.geojson;
    } else if (roadsData.url) {
      const geojsonResponse = await fetch(roadsData.url);
      if (!geojsonResponse.ok) throw new Error('Failed to load roads data');
      geojson = await geojsonResponse.json();
    } else {
      throw new Error('Roads layer has no data source');
    }

    console.log(`Roads: ${geojson.features?.length || 0} features, transforming...`);
    const transformed = transformGeojsonToWgs84(geojson);

    roadsLayer = L.geoJSON(transformed, {
      style: typeof getRoadStyle === "function" ? getRoadStyle : {
        color: "#505050",
        weight: 2,
        opacity: 0.8,
      },
    });

    window.roadsLayer = roadsLayer;
    layerState.roads = true;
    roadsLayer.addTo(map);

    console.log("Roads layer ready (GeoJSON)");
  } catch (error) {
    console.error("Error loading roads:", error);
  }
}

/**
 * Load major roads layer from GeoJSON file (road-big.geojson)
 * Data is in EPSG:2039, needs transformation
 */
async function loadMajorRoadsFromGeoJSON() {
  console.log("Loading major roads from GeoJSON...");

  const tableName = window.tableSwitcher?.getCurrentTable() || 'otef';
  const apiUrl = `/api/actions/get_otef_layers/?table=${tableName}`;

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Failed to load layers: ${response.status}`);
    }

    const layers = await response.json();
    const majorRoadsData = layers.find(l => l.name === 'majorRoads');

    if (!majorRoadsData) {
      console.warn("Major roads layer not found in database");
      return;
    }

    let geojson;
    if (majorRoadsData.geojson) {
      geojson = majorRoadsData.geojson;
    } else if (majorRoadsData.url) {
      const geojsonResponse = await fetch(majorRoadsData.url);
      if (!geojsonResponse.ok) throw new Error('Failed to load layer data');
      geojson = await geojsonResponse.json();
    } else {
      throw new Error('Layer has no data source');
    }

    console.log(`Major roads: ${geojson.features?.length || 0} features, transforming...`);

    // Transform from EPSG:2039 to WGS84
    const transformed = transformGeojsonToWgs84(geojson);

    majorRoadsLayer = L.geoJSON(transformed, {
      style: typeof getMajorRoadStyle === "function" ? getMajorRoadStyle : {
        color: "#B22222",
        weight: 3,
        opacity: 0.9,
      },
    });

    window.majorRoadsLayer = majorRoadsLayer;
    // Don't add to map - starts hidden

    console.log("Major roads layer ready (GeoJSON)");
  } catch (error) {
    console.error("Error loading major roads:", error);
  }
}

/**
 * Load small roads layer from GeoJSON file (Small-road-limited.geojson)
 * Data is already in WGS84, no transformation needed
 */
async function loadSmallRoadsFromGeoJSON() {
  console.log("Loading small roads from GeoJSON...");

  const tableName = window.tableSwitcher?.getCurrentTable() || 'otef';
  const apiUrl = `/api/actions/get_otef_layers/?table=${tableName}`;

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Failed to load layers: ${response.status}`);
    }

    const layers = await response.json();
    const smallRoadsData = layers.find(l => l.name === 'smallRoads');

    if (!smallRoadsData) {
      console.warn("Small roads layer not found in database");
      return;
    }

    let geojson;
    if (smallRoadsData.geojson) {
      geojson = smallRoadsData.geojson;
    } else if (smallRoadsData.url) {
      const geojsonResponse = await fetch(smallRoadsData.url);
      if (!geojsonResponse.ok) throw new Error('Failed to load layer data');
      geojson = await geojsonResponse.json();
    } else {
      throw new Error('Layer has no data source');
    }

    console.log(`Small roads: ${geojson.features?.length || 0} features`);

    // Already in WGS84, no transformation needed
    smallRoadsLayer = L.geoJSON(geojson, {
      style: typeof getSmallRoadStyle === "function" ? getSmallRoadStyle : {
        fillColor: "#A0A0A0",
        fillOpacity: 0.6,
        color: "#707070",
        weight: 0.5,
        opacity: 0.8,
      },
    });

    window.smallRoadsLayer = smallRoadsLayer;
    // Don't add to map - starts hidden

    console.log("Small roads layer ready (GeoJSON)");
  } catch (error) {
    console.error("Error loading small roads:", error);
  }
}

/**
 * Send viewport update to all connected clients
 * @param {number} zoomOverride - Optional zoom value to use instead of map.getZoom()
 */
function sendViewportUpdate(zoomOverride = null) {
  const size = map.getSize();
  const corners_pixel = {
    sw: L.point(0, size.y),
    se: L.point(size.x, size.y),
    nw: L.point(0, 0),
    ne: L.point(size.x, 0),
  };

  const corners_wgs84 = Object.fromEntries(
    Object.entries(corners_pixel).map(([name, pixel]) => [
      name,
      map.containerPointToLatLng(pixel),
    ])
  );

  const corners_itm = Object.fromEntries(
    Object.entries(corners_wgs84).map(([name, latlng]) => {
      const [x, y] = proj4("EPSG:4326", "EPSG:2039", [latlng.lng, latlng.lat]);
      return [name, { x, y }];
    })
  );

  const all_x = Object.values(corners_itm).map((c) => c.x);
  const all_y = Object.values(corners_itm).map((c) => c.y);
  const bbox = [
    Math.min(...all_x),
    Math.min(...all_y),
    Math.max(...all_x),
    Math.max(...all_y),
  ];

  const zoom = zoomOverride !== null ? zoomOverride : map.getZoom();

  if (window.DebugOverlay) {
    window.DebugOverlay.updateMapDimensions(size.x, size.y);
    window.DebugOverlay.setZoom(zoom);
    window.DebugOverlay.updateSentBbox(bbox);
  }

  // Send viewport update via shared WebSocket client using factory function
  if (wsClient && wsClient.getConnected()) {
    const viewportMsg = createViewportUpdateMessage({
      bbox,
      corners: corners_itm,
      zoom: zoom,
    });
    wsClient.send(viewportMsg);
  }
}

map.on("moveend", () => {
  sendViewportUpdate();
});

map.on("click", (e) => {
  const { lat, lng } = e.latlng;
  const [x, y] = proj4("EPSG:4326", "EPSG:2039", [lng, lat]);

  showFeatureInfo({
    type: "Point",
    coordinates: [lng, lat],
    properties: {
      Latitude: lat.toFixed(6),
      Longitude: lng.toFixed(6),
      "ITM X": Math.round(x),
      "ITM Y": Math.round(y),
      Zoom: map.getZoom(),
    },
  });
});

// GIS map is receive-only - no layer controls, only displays state from remote

// Add basemap control
L.control.layers(basemaps, null, { position: "topleft" }).addTo(map);

function showFeatureInfo(feature) {
  const panel = document.getElementById("featureInfo");
  const props = Object.entries(feature.properties)
    .map(([key, value]) => `<p><strong>${key}:</strong> ${value}</p>`)
    .join("");
  panel.innerHTML = "<h4>Feature Info</h4>" + props;
  panel.classList.remove("hidden");
  setTimeout(() => panel.classList.add("hidden"), 7000);
}

/**
 * Initialize WebSocket connection for remote control
 */
function initializeWebSocket() {
  wsClient = new OTEFWebSocketClient("/ws/otef/", {
    onConnect: () => {
      console.log("[GIS Map] WebSocket connected");
      updateConnectionStatus(true);

      // Send initial viewport update so remote controller has state
      sendViewportUpdate();

      // Request current state from remote controller
      requestCurrentState();
    },
    onDisconnect: () => {
      console.log("[GIS Map] WebSocket disconnected");
      updateConnectionStatus(false);
    },
    onError: (error) => {
      console.error("[GIS Map] WebSocket error:", error);
      updateConnectionStatus(false);
    },
  });

  // Handle STATE_RESPONSE - sync initial state
  wsClient.on(OTEF_MESSAGE_TYPES.STATE_RESPONSE, handleStateResponse);

  // Handle VIEWPORT_CONTROL messages (from remote)
  wsClient.on(OTEF_MESSAGE_TYPES.VIEWPORT_CONTROL, handleViewportControl);

  // Handle LAYER_UPDATE messages (from remote)
  wsClient.on(OTEF_MESSAGE_TYPES.LAYER_UPDATE, handleLayerUpdate);

  // Connect
  wsClient.connect();
}

/**
 * Request current state from remote controller
 */
function requestCurrentState() {
  if (!wsClient || !wsClient.getConnected()) return;

  const request = createStateRequestMessage();
  wsClient.send(request);
  console.log("[GIS Map] State request sent");
}

/**
 * Handle STATE_RESPONSE - sync initial state
 */
function handleStateResponse(msg) {
  if (!validateStateResponse(msg)) {
    console.warn("[GIS Map] Invalid state response:", msg);
    return;
  }

  console.log("[GIS Map] Received state response, syncing...");

  // Sync viewport
  if (msg.viewport && msg.viewport.zoom) {
    const targetZoom = Math.max(
      map.getMinZoom(),
      Math.min(map.getMaxZoom(), Math.round(msg.viewport.zoom))
    );
    if (targetZoom !== map.getZoom()) {
      map.setZoom(targetZoom, { animate: false });
      console.log(`[GIS Map] Zoom synced to ${targetZoom}`);
    }
  }

  // Sync layers
  if (msg.layers) {
    // Update layer visibility to match state
    if (msg.layers.roads !== undefined && msg.layers.roads !== layerState.roads) {
      if (roadsLayer) {
        if (msg.layers.roads) {
          map.addLayer(roadsLayer);
        } else {
          map.removeLayer(roadsLayer);
        }
      }
      layerState.roads = msg.layers.roads;
    }

    if (msg.layers.parcels !== undefined && msg.layers.parcels !== layerState.parcels) {
      if (parcelsLayer) {
        if (msg.layers.parcels) {
          map.addLayer(parcelsLayer);
        } else {
          map.removeLayer(parcelsLayer);
        }
      }
      layerState.parcels = msg.layers.parcels;
    }

    if (msg.layers.model !== undefined && msg.layers.model !== layerState.model) {
      if (msg.layers.model) {
        map.addLayer(modelOverlay);
      } else {
        map.removeLayer(modelOverlay);
      }
      layerState.model = msg.layers.model;
    }

    // Sync majorRoads layer
    if (msg.layers.majorRoads !== undefined && msg.layers.majorRoads !== layerState.majorRoads) {
      if (msg.layers.majorRoads && !majorRoadsLayer) {
        // Lazy load if needed
        loadMajorRoadsFromGeoJSON().then(() => {
          if (majorRoadsLayer && msg.layers.majorRoads) {
            map.addLayer(majorRoadsLayer);
          }
        });
      } else if (majorRoadsLayer) {
        if (msg.layers.majorRoads) {
          map.addLayer(majorRoadsLayer);
        } else {
          map.removeLayer(majorRoadsLayer);
        }
      }
      layerState.majorRoads = msg.layers.majorRoads;
    }

    // Sync smallRoads layer
    if (msg.layers.smallRoads !== undefined && msg.layers.smallRoads !== layerState.smallRoads) {
      if (msg.layers.smallRoads && !smallRoadsLayer) {
        // Lazy load if needed
        loadSmallRoadsFromGeoJSON().then(() => {
          if (smallRoadsLayer && msg.layers.smallRoads) {
            map.addLayer(smallRoadsLayer);
          }
        });
      } else if (smallRoadsLayer) {
        if (msg.layers.smallRoads) {
          map.addLayer(smallRoadsLayer);
        } else {
          map.removeLayer(smallRoadsLayer);
        }
      }
      layerState.smallRoads = msg.layers.smallRoads;
    }

    updateMapLegend();
  }

  // Send viewport update to confirm sync
  sendViewportUpdate();
}

/**
 * Handle viewport control commands from remote
 */
function handleViewportControl(msg) {
  if (!validateViewportControl(msg)) {
    console.warn("[GIS Map] Invalid viewport control message:", msg);
    return;
  }

  console.log("[GIS Map] Received viewport control:", msg);

  // Handle pan command
  if (msg.pan && msg.pan.direction) {
    handlePanCommand(msg.pan.direction, msg.pan.delta || 0.15);
  }

  // Handle zoom command
  if (typeof msg.zoom === "number") {
    handleZoomCommand(msg.zoom);
  }
}

/**
 * Handle pan command
 */
function handlePanCommand(direction, delta) {
  if (!modelBounds) return;

  const bounds = map.getBounds();
  const center = map.getCenter();
  const zoom = map.getZoom();

  // Calculate viewport size in meters (approximate)
  const ne = bounds.getNorthEast();
  const sw = bounds.getSouthWest();
  const [neX, neY] = proj4("EPSG:4326", "EPSG:2039", [ne.lng, ne.lat]);
  const [swX, swY] = proj4("EPSG:4326", "EPSG:2039", [sw.lng, sw.lat]);

  const widthMeters = neX - swX;
  const heightMeters = neY - swY;

  // Calculate pan distance as percentage of viewport
  const panDistanceX = widthMeters * delta;
  const panDistanceY = heightMeters * delta;

  // Convert to lat/lng delta
  let deltaLat = 0;
  let deltaLng = 0;

  switch (direction) {
    case "north":
      deltaLat = (ne.lat - sw.lat) * delta;
      break;
    case "south":
      deltaLat = -(ne.lat - sw.lat) * delta;
      break;
    case "east":
      deltaLng = (ne.lng - sw.lng) * delta;
      break;
    case "west":
      deltaLng = -(ne.lng - sw.lng) * delta;
      break;
    case "northeast":
      deltaLat = (ne.lat - sw.lat) * delta;
      deltaLng = (ne.lng - sw.lng) * delta;
      break;
    case "northwest":
      deltaLat = (ne.lat - sw.lat) * delta;
      deltaLng = -(ne.lng - sw.lng) * delta;
      break;
    case "southeast":
      deltaLat = -(ne.lat - sw.lat) * delta;
      deltaLng = (ne.lng - sw.lng) * delta;
      break;
    case "southwest":
      deltaLat = -(ne.lat - sw.lat) * delta;
      deltaLng = -(ne.lng - sw.lng) * delta;
      break;
  }

  // Pan the map
  const newCenter = L.latLng(center.lat + deltaLat, center.lng + deltaLng);
  map.panTo(newCenter, { animate: true, duration: 0.3 });
}

/**
 * Handle zoom command
 */
function handleZoomCommand(zoom) {
  const currentZoom = map.getZoom();
  const minZoom = map.getMinZoom();
  const maxZoom = map.getMaxZoom();

  // Clamp zoom to valid range
  const targetZoom = Math.max(minZoom, Math.min(maxZoom, Math.round(zoom)));

  if (targetZoom !== currentZoom) {
    console.log(`[GIS Map] Zoom command: ${currentZoom} -> ${targetZoom}`);

    // Use setZoom without animation for immediate effect, especially when tab is inactive
    // Animation can be throttled/skipped when tab is inactive, preventing zoom from working
    map.setZoom(targetZoom, { animate: false });

    // Immediately send viewport update with the TARGET zoom value
    // This ensures the update is sent even if map.getZoom() hasn't updated yet (tab inactive)
    // Use requestAnimationFrame to ensure the zoom change has been processed
    requestAnimationFrame(() => {
      // Send update with target zoom to ensure correct value is broadcast
      sendViewportUpdate(targetZoom);
      console.log(`[GIS Map] Viewport update sent with zoom: ${targetZoom}`);
    });
  }
}

/**
 * Handle layer update from remote controller
 * GIS map is receive-only, so all updates come from remote
 */
function handleLayerUpdate(msg) {
  if (!validateLayerUpdate(msg)) {
    console.warn("[GIS Map] Invalid layer update message:", msg);
    return;
  }

  const layers = msg.layers;

  // Check if there are any actual changes
  const hasChanges =
    (layers.roads !== undefined && layers.roads !== layerState.roads) ||
    (layers.parcels !== undefined && layers.parcels !== layerState.parcels) ||
    (layers.model !== undefined && layers.model !== layerState.model) ||
    (layers.majorRoads !== undefined && layers.majorRoads !== layerState.majorRoads) ||
    (layers.smallRoads !== undefined && layers.smallRoads !== layerState.smallRoads);

  if (!hasChanges) {
    console.log("[GIS Map] Layer update matches current state, ignoring");
    return;
  }

  console.log("[GIS Map] Processing layer update from remote:", layers);

  // Update layer visibility (GIS map is receive-only, no broadcasting)
  if (layers.roads !== undefined && layers.roads !== layerState.roads) {
    if (layers.roads) {
      map.addLayer(roadsLayer);
    } else {
      map.removeLayer(roadsLayer);
    }
    layerState.roads = layers.roads;
  }

  if (layers.parcels !== undefined && layers.parcels !== layerState.parcels) {
    if (layers.parcels) {
      map.addLayer(parcelsLayer);
    } else {
      map.removeLayer(parcelsLayer);
    }
    layerState.parcels = layers.parcels;
  }

  if (layers.model !== undefined && layers.model !== layerState.model) {
    if (layers.model) {
      map.addLayer(modelOverlay);
    } else {
      map.removeLayer(modelOverlay);
    }
    layerState.model = layers.model;
  }

  // Update majorRoads layer
  if (layers.majorRoads !== undefined && layers.majorRoads !== layerState.majorRoads) {
    if (layers.majorRoads && !majorRoadsLayer) {
      // Lazy load if needed
      loadMajorRoadsFromGeoJSON().then(() => {
        if (majorRoadsLayer && layers.majorRoads) {
          map.addLayer(majorRoadsLayer);
          updateMapLegend();
        }
      });
    } else if (majorRoadsLayer) {
      if (layers.majorRoads) {
        map.addLayer(majorRoadsLayer);
      } else {
        map.removeLayer(majorRoadsLayer);
      }
    }
    layerState.majorRoads = layers.majorRoads;
  }

  // Update smallRoads layer
  if (layers.smallRoads !== undefined && layers.smallRoads !== layerState.smallRoads) {
    if (layers.smallRoads && !smallRoadsLayer) {
      // Lazy load if needed
      loadSmallRoadsFromGeoJSON().then(() => {
        if (smallRoadsLayer && layers.smallRoads) {
          map.addLayer(smallRoadsLayer);
          updateMapLegend();
        }
      });
    } else if (smallRoadsLayer) {
      if (layers.smallRoads) {
        map.addLayer(smallRoadsLayer);
      } else {
        map.removeLayer(smallRoadsLayer);
      }
    }
    layerState.smallRoads = layers.smallRoads;
  }

  // Update legend to show only active layers
  updateMapLegend();

  // GIS map is receive-only - no broadcasting needed
}

/**
 * Update cartographic legend to show only active layers
 */
function updateMapLegend() {
  const legend = document.getElementById("mapLegend");
  if (!legend) return;

  const activeLayers = [];

  // Roads layer
  if (layerState.roads) {
    activeLayers.push({
      title: "Roads",
      items: [
        {
          symbol: { background: "#505050", border: "#303030" },
          label: "Road Network"
        }
      ]
    });
  }

  // Parcels layer with land use categories
  if (layerState.parcels) {
    activeLayers.push({
      title: "Land Use",
      items: [
        { symbol: { background: "#ffd700", border: "#b8860b" }, label: "Residential" },
        { symbol: { background: "#ff6b6b", border: "#cc5555" }, label: "Commercial" },
        { symbol: { background: "#9370db", border: "#7b5cb5" }, label: "Industry" },
        { symbol: { background: "#90ee90", border: "#5fad5f" }, label: "Public Open Space" },
        { symbol: { background: "#228b22", border: "#1a6b1a" }, label: "Forest" },
        { symbol: { background: "#87ceeb", border: "#6ba5c7" }, label: "Public Institution" },
        { symbol: { background: "#e0e0e0", border: "#b0b0b0" }, label: "Other" }
      ]
    });
  }

  // Model base layer
  if (layerState.model) {
    activeLayers.push({
      title: "Model Base",
      items: [
        {
          symbol: null,
          label: "Physical 3D model overlay"
        }
      ]
    });
  }

  // Major roads layer
  if (layerState.majorRoads) {
    activeLayers.push({
      title: "Major Roads",
      items: [
        { symbol: { background: "#B22222", border: "#8B1A1A" }, label: "Primary Road" },
        { symbol: { background: "#CD853F", border: "#A06B30" }, label: "Regional Road" }
      ]
    });
  }

  // Small roads layer
  if (layerState.smallRoads) {
    activeLayers.push({
      title: "Small Roads",
      items: [
        { symbol: { background: "#A0A0A0", border: "#707070" }, label: "Local Roads" }
      ]
    });
  }

  // Build legend HTML
  if (activeLayers.length === 0) {
    legend.innerHTML = "";
    return;
  }

  let html = '<div class="map-legend-title has-groups">Legend</div>';

  activeLayers.forEach((group, groupIndex) => {
    html += '<div class="map-legend-group">';
    html += `<div class="map-legend-group-title">${group.title}</div>`;

    group.items.forEach(item => {
      html += '<div class="map-legend-item">';
      if (item.symbol) {
        html += `<span class="map-legend-symbol" style="background: ${item.symbol.background}; border-color: ${item.symbol.border};"></span>`;
      } else {
        html += '<span class="map-legend-symbol" style="background: transparent; border: none;"></span>';
      }
      html += `<span class="map-legend-label">${item.label}</span>`;
      html += '</div>';
    });

    html += '</div>';
  });

  legend.innerHTML = html;
}

// GIS map is receive-only - it does not send state updates
// The remote controller is the single source of truth for state

/**
 * Update connection status UI
 */
function updateConnectionStatus(connected) {
  const el = document.getElementById("connectionStatus");
  if (el) {
    el.className = connected ? "status-connected" : "status-disconnected";
    el.title = connected ? "Connected to remote" : "Disconnected";
  }
}
