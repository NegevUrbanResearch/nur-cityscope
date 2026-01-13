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
  zoomControl: true,
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

// Flag to prevent processing our own broadcasts (echo prevention)
let isProcessingLocalLayerUpdate = false;

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
    document.getElementById("toggleModel").checked = false; // Unchecked by default

    console.log("Map initialized with WGS84 basemap!");

    // Initialize WebSocket for remote control (before loading layers)
    initializeWebSocket();

    // Load GeoJSON layers
    loadGeoJSONLayers();
  })
  .catch((error) => {
    console.error("Error loading model bounds:", error);
  });

function loadGeoJSONLayers() {
  console.log(
    "Loading GeoJSON layers (simplified versions for performance)..."
  );

  // Load parcels (simplified)
  fetch(
    "/otef-interactive/data-source/layers-simplified/migrashim_simplified.json"
  )
    .then((res) => res.json())
    .then((geojson) => {
      console.log(
        `Loaded ${geojson.features.length} parcels (EPSG:2039, simplified)`
      );
      console.log("Transforming parcels to WGS84...");

      const transformed = transformGeojsonToWgs84(geojson);

      parcelsLayer = L.geoJSON(transformed, {
        style:
          typeof getParcelStyle === "function"
            ? getParcelStyle
            : {
                color: "#6495ED",
                fillColor: "#6495ED",
                weight: 1,
                fillOpacity: 0.3,
                opacity: 0.8,
              },
        onEachFeature: (feature, layer) => {
          // Bind popup with rich content
          if (typeof createPopupContent === "function") {
            layer.bindPopup(() => createPopupContent(feature.properties));
          }

          layer.on("click", () => {
            showFeatureInfo(feature);
          });
        },
      }); // Don't add to map on init

      window.parcelsLayer = parcelsLayer;
      const parcelToggle = document.getElementById("toggleParcels");
      parcelToggle.disabled = false;
      parcelToggle.checked = false; // Unchecked by default (matches DEFAULT_LAYER_STATES)
      parcelToggle.nextSibling.textContent = " Parcels";
      layerState.parcels = false;
      console.log("Parcels layer ready (hidden by default)");
    })
    .catch((error) => {
      console.error("Error loading parcels:", error);
      const parcelToggle = document.getElementById("toggleParcels");
      parcelToggle.nextSibling.textContent = " Parcels (ERROR - check console)";
      alert(
        "Failed to load parcels layer. Check browser console (F12) for details."
      );
    });

  // Load roads (fixed and simplified version)
  fetch(
    "/otef-interactive/data-source/layers-simplified/small_roads_simplified.json"
  )
    .then((res) => res.json())
    .then((geojson) => {
      console.log(
        `Loaded ${geojson.features.length} road features (EPSG:2039, simplified)`
      );

      // Roads are already in EPSG:2039 after fixing, so transform them
      console.log("Transforming roads to WGS84...");
      const transformed = transformGeojsonToWgs84(geojson);

      roadsLayer = L.geoJSON(transformed, {
        style:
          typeof getRoadStyle === "function"
            ? getRoadStyle
            : {
                color: "#FF8C00",
                weight: 2,
                opacity: 0.8,
              },
        onEachFeature: (feature, layer) => {
          layer.on("click", () => {
            showFeatureInfo(feature);
          });
        },
      }).addTo(map); // Add to map on init (visible by default)

      window.roadsLayer = roadsLayer;
      const roadToggle = document.getElementById("toggleRoads");
      roadToggle.disabled = false;
      roadToggle.checked = true; // Checked by default (matches DEFAULT_LAYER_STATES)
      roadToggle.nextSibling.textContent = " Roads";
      document.getElementById("roadsLegend").style.display = "block"; // Show legend
      layerState.roads = true;
      console.log("Roads layer ready and visible");
    })
    .catch((error) => {
      console.error("Error loading roads:", error);
      const roadToggle = document.getElementById("toggleRoads");
      roadToggle.nextSibling.textContent = " Roads (ERROR - check console)";
    });
}

map.on("moveend", () => {
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

  if (window.DebugOverlay) {
    window.DebugOverlay.updateMapDimensions(size.x, size.y);
    window.DebugOverlay.setZoom(map.getZoom());
    window.DebugOverlay.updateSentBbox(bbox);
  }

  // Send viewport update via shared WebSocket client
  if (wsClient && wsClient.getConnected()) {
    wsClient.send({
      type: OTEF_MESSAGE_TYPES.VIEWPORT_UPDATE,
      bbox,
      corners: corners_itm,
      zoom: map.getZoom(),
      timestamp: Date.now(),
    });
  }

  // Also send via legacy WebSocket if it exists (for backward compatibility)
  if (window.ws?.readyState === WebSocket.OPEN) {
    window.ws.send(
      JSON.stringify({
        type: "otef_viewport_update",
        bbox,
        corners: corners_itm,
        zoom: map.getZoom(),
        timestamp: Date.now(),
      })
    );
  }
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

document.getElementById("layerToggle").addEventListener("click", () => {
  document.getElementById("layerPanel").classList.toggle("hidden");
});

const toggleLayer = (layerName, legendId, stateKey) => (e) => {
  if (!window[layerName]) return;
  if (e.target.checked) {
    map.addLayer(window[layerName]);
    document.getElementById(legendId).style.display = "block";
    layerState[stateKey] = true;
  } else {
    map.removeLayer(window[layerName]);
    document.getElementById(legendId).style.display = "none";
    layerState[stateKey] = false;
  }

  // Broadcast layer update to all clients (this is a user action from UI)
  if (wsClient && wsClient.getConnected()) {
    isProcessingLocalLayerUpdate = true;
    const msg = createLayerUpdateMessage(layerState);
    wsClient.send(msg);
    console.log("[GIS Map] Broadcasting layer update from UI:", layerState);
    // Reset flag after sending (we'll ignore our own echo)
    setTimeout(() => {
      isProcessingLocalLayerUpdate = false;
    }, 500);
  }
};

document
  .getElementById("toggleParcels")
  .addEventListener(
    "change",
    toggleLayer("parcelsLayer", "parcelsLegend", "parcels")
  );
document
  .getElementById("toggleRoads")
  .addEventListener(
    "change",
    toggleLayer("roadsLayer", "roadsLegend", "roads")
  );
document
  .getElementById("toggleModel")
  .addEventListener(
    "change",
    toggleLayer("modelLayer", "modelLegend", "model")
  );

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
      console.log("[GIS Map] WebSocket connected for remote control");
      updateConnectionStatus(true);
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

  // Handle VIEWPORT_CONTROL messages (from remote)
  wsClient.on(OTEF_MESSAGE_TYPES.VIEWPORT_CONTROL, handleViewportControl);

  // Handle LAYER_UPDATE messages (from remote)
  wsClient.on(OTEF_MESSAGE_TYPES.LAYER_UPDATE, handleLayerUpdate);

  // Handle STATE_REQUEST messages (from remote)
  wsClient.on(OTEF_MESSAGE_TYPES.STATE_REQUEST, handleStateRequest);

  // Connect
  wsClient.connect();
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
    map.setZoom(targetZoom, { animate: true });
  }
}

/**
 * Handle layer update from remote or WebSocket echo
 */
function handleLayerUpdate(msg) {
  if (!validateLayerUpdate(msg)) {
    console.warn("[GIS Map] Invalid layer update message:", msg);
    return;
  }

  const layers = msg.layers;

  // Check if this update matches our current state (echo from our own broadcast)
  const isEcho =
    layers.roads === layerState.roads &&
    layers.parcels === layerState.parcels &&
    layers.model === layerState.model;

  // If it's an echo from our own UI action, ignore it
  if (isEcho && isProcessingLocalLayerUpdate) {
    console.log("[GIS Map] Ignoring echo of our own layer update");
    return;
  }

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

  // Update layer visibility
  if (layers.roads !== undefined && layers.roads !== layerState.roads) {
    if (layers.roads) {
      map.addLayer(roadsLayer);
      document.getElementById("roadsLegend").style.display = "block";
    } else {
      map.removeLayer(roadsLayer);
      document.getElementById("roadsLegend").style.display = "none";
    }
    document.getElementById("toggleRoads").checked = layers.roads;
    layerState.roads = layers.roads;
  }

  if (layers.parcels !== undefined && layers.parcels !== layerState.parcels) {
    if (layers.parcels) {
      map.addLayer(parcelsLayer);
      document.getElementById("parcelsLegend").style.display = "block";
    } else {
      map.removeLayer(parcelsLayer);
      document.getElementById("parcelsLegend").style.display = "none";
    }
    document.getElementById("toggleParcels").checked = layers.parcels;
    layerState.parcels = layers.parcels;
  }

  if (layers.model !== undefined && layers.model !== layerState.model) {
    if (layers.model) {
      map.addLayer(modelOverlay);
      document.getElementById("modelLegend").style.display = "block";
    } else {
      map.removeLayer(modelOverlay);
      document.getElementById("modelLegend").style.display = "none";
    }
    document.getElementById("toggleModel").checked = layers.model;
    layerState.model = layers.model;
  }

  // DO NOT broadcast - this update came from WebSocket (either remote or our own echo)
  // Broadcasting here would create an infinite loop
}

/**
 * Handle state request from remote
 */
function handleStateRequest(msg) {
  if (!msg || msg.type !== OTEF_MESSAGE_TYPES.STATE_REQUEST) {
    console.warn("[GIS Map] Invalid state request:", msg);
    return;
  }

  console.log("[GIS Map] Received state request, sending response...");

  // Get current viewport state
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

  // Send state response
  const response = createStateResponseMessage(
    {
      bbox: bbox,
      zoom: map.getZoom(),
      corners: corners_itm,
    },
    layerState
  );

  if (wsClient && wsClient.getConnected()) {
    wsClient.send(response);
  }
}

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
