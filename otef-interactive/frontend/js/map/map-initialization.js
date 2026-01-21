/**
 * Map initialization and configuration for the Leaflet GIS map.
 * Handles map setup, basemaps, bounds configuration, and model overlay.
 * Depends on global `proj4` and `L` (Leaflet).
 */

// Define EPSG:2039 projection for transformation
proj4.defs(
  "EPSG:2039",
  "+proj=tmerc +lat_0=31.73439361111111 +lon_0=35.20451694444445 +k=1.0000067 +x_0=219529.584 +y_0=626907.39 +ellps=GRS80 +towgs84=-24.0024,-17.1032,-17.8444,0.33077,-1.85269,1.66969,5.4248 +units=m +no_defs"
);

// Model bounds (in EPSG:2039) - will be set by initializeMap()
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

// Add basemap control
L.control.layers(basemaps, null, { position: "topleft" }).addTo(map);

// Layer references (will be set by layer loaders)
let parcelsLayer, roadsLayer, modelOverlay, majorRoadsLayer, smallRoadsLayer;

// Layer state tracking
let layerState = {
  roads: false, // Start false, let API enable it
  parcels: false,
  model: false,
  majorRoads: false,
  smallRoads: false,
};

// Flag to prevent echo when applying remote state
let isApplyingRemoteState = false;

/**
 * Initialize the map with model bounds and set up OTEFDataContext subscriptions.
 * This is called after model-bounds.json is loaded.
 */
function initializeMap(bounds) {
  modelBounds = bounds;
  console.log("Model bounds loaded (EPSG:2039):", bounds);

  // Transform bounds to WGS84
  const [swLat, swLon] = CoordUtils.transformItmToWgs84(bounds.west, bounds.south);
  const [neLat, neLon] = CoordUtils.transformItmToWgs84(bounds.east, bounds.north);

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

  // Initialize shared OTEFDataContext and subscribe to state
  if (typeof OTEFDataContext !== 'undefined') {
    OTEFDataContext.init('otef').then(() => {
      const initialViewport = OTEFDataContext.getViewport();
      if (initialViewport) {
        applyViewportFromAPI(initialViewport);
      }
      const initialLayers = OTEFDataContext.getLayers();
      if (initialLayers) {
        applyLayerState(initialLayers);
      }
      const initialConnection = OTEFDataContext.isConnected();
      updateConnectionStatus(!!initialConnection);

      // Store unsubscribe functions for cleanup
      if (!window._otefUnsubscribeFunctions) {
        window._otefUnsubscribeFunctions = [];
      }

      window._otefUnsubscribeFunctions.push(
        OTEFDataContext.subscribe('viewport', (viewport) => {
          if (viewport) {
            applyViewportFromAPI(viewport);
          }
        })
      );

      window._otefUnsubscribeFunctions.push(
        OTEFDataContext.subscribe('layers', (layers) => {
          if (layers) {
            applyLayerState(layers);
          }
        })
      );

      window._otefUnsubscribeFunctions.push(
        OTEFDataContext.subscribe('connection', (connected) => {
          updateConnectionStatus(!!connected);
        })
      );
    });
  }

  // Load GeoJSON layers (independent of shared state)
  loadGeoJSONLayers();
}

// Load model bounds and initialize
fetch("data/model-bounds.json")
  .then((res) => res.json())
  .then((bounds) => {
    initializeMap(bounds);
  })
  .catch((error) => {
    console.error("Error loading model bounds:", error);
  });

// Cleanup subscriptions on page unload
window.addEventListener("beforeunload", () => {
  if (window._otefUnsubscribeFunctions) {
    window._otefUnsubscribeFunctions.forEach(unsubscribe => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    });
    window._otefUnsubscribeFunctions = [];
  }
});

// Map click handler
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
 * Update connection status UI
 */
function updateConnectionStatus(connected) {
  const el = document.getElementById("connectionStatus");
  if (el) {
    el.className = connected ? "status-connected" : "status-disconnected";
    el.title = connected ? "Connected to remote" : "Disconnected";
  }
}
