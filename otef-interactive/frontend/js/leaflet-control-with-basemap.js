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
let parcelsLayer, roadsLayer, modelOverlay;

// Layer state tracking
let layerState = {
  roads: true,
  parcels: false,
  model: false,
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
  console.log("Loading GeoJSON layers from database...");

  // Get current table name
  const tableName = window.tableSwitcher?.getCurrentTable() || 'otef';
  const apiUrl = `/api/actions/get_otef_layers/?table=${tableName}`;

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Failed to load layers: ${response.status} ${response.statusText}`);
    }

    const layers = await response.json();
    console.log(`Loaded ${layers.length} layers from database`);

    // Process each layer (API already filters to active layers)
    for (const layerData of layers) {
      let geojson;
      
      // Load GeoJSON data
      if (layerData.geojson) {
        // Data is embedded in response
        geojson = layerData.geojson;
      } else if (layerData.url) {
        // Data is served via separate endpoint
        const geojsonResponse = await fetch(layerData.url);
        if (!geojsonResponse.ok) {
          console.warn(`Failed to load layer data from ${layerData.url}`);
          continue;
        }
        geojson = await geojsonResponse.json();
      } else {
        console.warn(`Layer ${layerData.name} has no data source`);
        continue;
      }

      console.log(`Processing layer: ${layerData.display_name} (${geojson.features?.length || 0} features)`);
      console.log("Transforming to WGS84...");

      const transformed = transformGeojsonToWgs84(geojson);

      // Get style from layer config or use defaults
      const styleConfig = layerData.style_config || {};
      const defaultStyle = layerData.name === 'parcels' 
        ? {
            color: "#6495ED",
            fillColor: "#6495ED",
            weight: 1,
            fillOpacity: 0.3,
            opacity: 0.8,
          }
        : {
            color: "#FF8C00",
            weight: 2,
            opacity: 0.8,
          };

      const layerStyle = {
        ...defaultStyle,
        ...styleConfig,
      };

      // Create Leaflet layer
      const leafletLayer = L.geoJSON(transformed, {
        style: layerData.name === 'parcels' && typeof getParcelStyle === "function"
          ? getParcelStyle
          : layerData.name === 'roads' && typeof getRoadStyle === "function"
          ? getRoadStyle
          : layerStyle,
        onEachFeature: (feature, layer) => {
          if (layerData.name === 'parcels' && typeof createPopupContent === "function") {
            layer.bindPopup(() => createPopupContent(feature.properties));
          }
          layer.on("click", () => {
            showFeatureInfo(feature);
          });
        },
      });

      // Store layer reference
      if (layerData.name === 'parcels') {
        parcelsLayer = leafletLayer;
        window.parcelsLayer = parcelsLayer;
        layerState.parcels = false;
      } else if (layerData.name === 'roads') {
        roadsLayer = leafletLayer;
        window.roadsLayer = roadsLayer;
        layerState.roads = true;
        leafletLayer.addTo(map); // Add roads to map on init (visible by default)
      }

      console.log(`Layer ${layerData.display_name} ready`);
    }

    updateMapLegend();
    console.log("All layers loaded from database");
  } catch (error) {
    console.error("Error loading layers from database:", error);
    throw error;
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
      if (msg.layers.roads) {
        map.addLayer(roadsLayer);
      } else {
        map.removeLayer(roadsLayer);
      }
      layerState.roads = msg.layers.roads;
    }

    if (msg.layers.parcels !== undefined && msg.layers.parcels !== layerState.parcels) {
      if (msg.layers.parcels) {
        map.addLayer(parcelsLayer);
      } else {
        map.removeLayer(parcelsLayer);
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
    (layers.model !== undefined && layers.model !== layerState.model);

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
