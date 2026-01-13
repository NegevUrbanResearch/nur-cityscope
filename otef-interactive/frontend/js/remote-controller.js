// OTEF Remote Controller
// Mobile-friendly remote control for OTEF interactive GIS map

// State management
let currentState = {
  zoom: 15,
  layers: {
    roads: true,
    parcels: false,
    model: false,
  },
  gisMapConnected: false,
};

// Control state management (prevent simultaneous use)
let activeControl = null; // null, 'dpad', or 'joystick'
let joystickManager = null; // Nipple.js instance
let joystickInterval = null; // For continuous pan updates

// WebSocket client instance
let wsClient = null;

// Connection monitoring
let connectionMonitor = null;
let gisMapLastSeen = null;
const CONNECTION_CHECK_INTERVAL = 1000; // Check every second
const GIS_MAP_TIMEOUT = 5000; // Consider offline if no messages for 5 seconds
const STATE_REQUEST_INTERVAL = 10000; // Request state every 10s if not connected

// Throttle/debounce timers
let panThrottleTimer = null;
let zoomThrottleTimer = null;
const PAN_THROTTLE_MS = 150;
const ZOOM_THROTTLE_MS = 100;

// Flag to prevent echo when receiving layer updates
let isReceivingLayerUpdate = false;

// Initialize on DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}

function initialize() {
  console.log("[Remote] Initializing...");

  // Initialize WebSocket connection
  initializeWebSocket();

  // Initialize UI controls
  initializePanControls();
  initializeZoomControls();
  initializeLayerControls();
  initializeJoystick();

  // Update UI with default state
  updateUI();

  console.log("[Remote] Initialized");
}

/**
 * Initialize WebSocket connection
 */
function initializeWebSocket() {
  wsClient = new OTEFWebSocketClient("/ws/otef/", {
    onConnect: () => {
      updateConnectionStatus("connecting");
      requestState();
      startConnectionMonitor();
    },
    onDisconnect: () => {
      updateConnectionStatus("disconnected");
      currentState.gisMapConnected = false;
      stopConnectionMonitor();
      updateUI();
    },
    onError: (error) => {
      console.error("[Remote] WebSocket error:", error);
      updateConnectionStatus("error");
      currentState.gisMapConnected = false;
      stopConnectionMonitor();
      updateUI();
    },
  });

  // Listen for state responses (indicates GIS map is connected)
  wsClient.on(OTEF_MESSAGE_TYPES.STATE_RESPONSE, handleStateResponse);

  // Listen for layer updates (from GIS map or remote)
  // Note: handleLayerUpdate will mark GIS map as seen if it's from GIS map
  wsClient.on(OTEF_MESSAGE_TYPES.LAYER_UPDATE, handleLayerUpdate);

  // Listen for viewport updates (to sync zoom when GIS map changes)
  wsClient.on(OTEF_MESSAGE_TYPES.VIEWPORT_UPDATE, (msg) => {
    handleViewportUpdate(msg);
    markGISMapSeen();
  });

  // Connect
  wsClient.connect();
}

/**
 * Update connection status UI
 */
function updateConnectionStatus(status) {
  const indicator = document.getElementById("statusIndicator");
  const text = document.getElementById("statusText");
  const warning = document.getElementById("warningOverlay");

  if (!indicator || !text) return;

  const statusConfig = {
    connected: { class: "connected", text: "Connected", connected: true, showWarning: false },
    disconnected: { class: "disconnected", text: "Disconnected", connected: false, showWarning: true },
    connecting: { class: "connecting", text: "Connecting...", connected: false, showWarning: false },
    error: { class: "disconnected", text: "Error", connected: false, showWarning: true },
  };

  const config = statusConfig[status] || statusConfig.disconnected;

  indicator.classList.remove("connected", "disconnected", "connecting");
  indicator.classList.add(config.class);
  text.textContent = config.text;
  currentState.gisMapConnected = config.connected;

  if (warning) {
    warning.classList.toggle("hidden", !config.showWarning);
  }

  updateUI();
}

/**
 * Mark GIS map as seen (received a message from it)
 */
function markGISMapSeen() {
  gisMapLastSeen = Date.now();
  if (!currentState.gisMapConnected) {
    // GIS map just came online, request full state
    requestState();
  }
}

/**
 * Start connection monitoring (heartbeat + state requests)
 */
function startConnectionMonitor() {
  stopConnectionMonitor();
  
  let lastStateRequest = 0;
  
  connectionMonitor = setInterval(() => {
    if (!wsClient || !wsClient.getConnected()) {
      return;
    }
    
    const now = Date.now();
    
    if (currentState.gisMapConnected) {
      // Monitor heartbeat - check if GIS map is still alive
      const timeSinceLastSeen = gisMapLastSeen ? now - gisMapLastSeen : Infinity;
      
      if (timeSinceLastSeen > GIS_MAP_TIMEOUT) {
        console.warn("[Remote] GIS map appears offline (no messages for", Math.round(timeSinceLastSeen / 1000), "seconds)");
        currentState.gisMapConnected = false;
        updateConnectionStatus("disconnected");
        updateUI();
        lastStateRequest = 0; // Reset to allow immediate retry
      }
    } else {
      // Not connected - periodically request state
      if (now - lastStateRequest >= STATE_REQUEST_INTERVAL) {
        requestState();
        lastStateRequest = now;
      }
    }
  }, CONNECTION_CHECK_INTERVAL);
}

/**
 * Stop connection monitoring
 */
function stopConnectionMonitor() {
  if (connectionMonitor) {
    clearInterval(connectionMonitor);
    connectionMonitor = null;
  }
}

/**
 * Request current state from GIS map
 */
function requestState() {
  if (!wsClient || !wsClient.getConnected()) {
    console.warn("[Remote] Cannot request state: not connected");
    return;
  }

  const msg = createStateRequestMessage();
  wsClient.send(msg);
  console.log("[Remote] State request sent");
}

/**
 * Handle state response from GIS map
 */
function handleStateResponse(msg) {
  if (!validateStateResponse(msg)) {
    console.warn("[Remote] Invalid state response:", msg);
    return;
  }

  console.log("[Remote] Received state response:", msg);

  // Update local state
  currentState.zoom = msg.viewport.zoom;
  currentState.layers = { ...msg.layers };
  currentState.gisMapConnected = true;

  // Mark GIS map as seen
  markGISMapSeen();

  // Update UI
  updateUI();

  // Update connection status - GIS map is now confirmed connected
  updateConnectionStatus("connected");
  
  // Connection monitor is already running, it will handle heartbeat from now on
}

/**
 * Handle layer update from GIS map
 */
function handleLayerUpdate(msg) {
  if (!validateLayerUpdate(msg)) {
    console.warn("[Remote] Invalid layer update:", msg);
    return;
  }

  console.log("[Remote] Received layer update:", msg);

  // Set flag to prevent echo
  isReceivingLayerUpdate = true;

  // Mark GIS map as seen (this update came from GIS map, not from ourselves)
  markGISMapSeen();

  // Update local state
  currentState.layers = { ...msg.layers };

  // Update UI checkboxes (without triggering events)
  updateLayerCheckboxes();

  // Reset flag after a short delay
  setTimeout(() => {
    isReceivingLayerUpdate = false;
  }, 100);
}

/**
 * Handle viewport update from GIS map (to sync zoom)
 */
function handleViewportUpdate(msg) {
  if (!msg || msg.type !== OTEF_MESSAGE_TYPES.VIEWPORT_UPDATE) {
    return;
  }

  // Update zoom if it changed
  if (typeof msg.zoom === "number" && msg.zoom !== currentState.zoom) {
    currentState.zoom = msg.zoom;
    updateZoomUI(msg.zoom);
    console.log("[Remote] Zoom synced from GIS map:", msg.zoom);
  }
}

/**
 * Initialize pan controls (directional pad)
 */
function initializePanControls() {
  const directions = {
    panNorth: "north",
    panSouth: "south",
    panEast: "east",
    panWest: "west",
  };

  // Handle directional buttons
  Object.entries(directions).forEach(([id, direction]) => {
    const button = document.getElementById(id);
    if (!button) return;

    // Touch/mouse events
    // Using { passive: false } because we need preventDefault() to block scrolling
    button.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        handlePanStart(direction, button);
      },
      { passive: false }
    );

    button.addEventListener(
      "touchend",
      (e) => {
        e.preventDefault();
        handlePanEnd(button);
      },
      { passive: false }
    );

    button.addEventListener("mousedown", (e) => {
      e.preventDefault();
      handlePanStart(direction, button);
    });

    button.addEventListener("mouseup", () => {
      handlePanEnd(button);
    });

    button.addEventListener("mouseleave", () => {
      handlePanEnd(button);
    });
  });
}

let panActive = false;
let panDirection = null;
let panInterval = null;

function handlePanStart(direction, button) {
  if (!currentState.gisMapConnected) return;

  // Check if joystick is active
  if (activeControl === "joystick") return;

  // Set active control
  activeControl = "dpad";

  panActive = true;
  panDirection = direction;
  button.classList.add("active");

  // Send immediate pan command
  sendPanCommand(direction);

  // Set up continuous panning
  panInterval = setInterval(() => {
    if (panActive && panDirection === direction) {
      sendPanCommand(direction);
    }
  }, PAN_THROTTLE_MS);
}

function handlePanEnd(button) {
  // Reset active control
  activeControl = null;

  panActive = false;
  panDirection = null;
  button.classList.remove("active");

  if (panInterval) {
    clearInterval(panInterval);
    panInterval = null;
  }
}

function sendPanCommand(direction) {
  if (!wsClient || !wsClient.getConnected()) return;

  // Throttle rapid pan commands
  if (panThrottleTimer) return;

  const msg = createPanControlMessage(direction, 0.15);
  wsClient.send(msg);

  panThrottleTimer = setTimeout(() => {
    panThrottleTimer = null;
  }, PAN_THROTTLE_MS);
}

/**
 * Initialize zoom controls
 */
function initializeZoomControls() {
  const slider = document.getElementById("zoomSlider");
  const zoomIn = document.getElementById("zoomIn");
  const zoomOut = document.getElementById("zoomOut");
  const zoomValue = document.getElementById("zoomValue");

  if (!slider || !zoomIn || !zoomOut || !zoomValue) return;

  // Slider change
  slider.addEventListener("input", (e) => {
    const zoom = parseInt(e.target.value);
    zoomValue.textContent = zoom;
    // Throttle slider updates
    clearTimeout(zoomThrottleTimer);
    zoomThrottleTimer = setTimeout(() => {
      sendZoomCommand(zoom);
    }, ZOOM_THROTTLE_MS);
  });

  // Zoom in button
  zoomIn.addEventListener("click", () => {
    if (!currentState.gisMapConnected) return;
    const newZoom = Math.min(19, currentState.zoom + 1);
    sendZoomCommand(newZoom);
    updateZoomUI(newZoom);
  });

  // Zoom out button
  zoomOut.addEventListener("click", () => {
    if (!currentState.gisMapConnected) return;
    const newZoom = Math.max(10, currentState.zoom - 1);
    sendZoomCommand(newZoom);
    updateZoomUI(newZoom);
  });
}

function sendZoomCommand(zoom) {
  if (!wsClient || !wsClient.getConnected()) return;

  const msg = createZoomControlMessage(zoom);
  wsClient.send(msg);
  console.log("[Remote] Zoom command sent:", zoom);
}

function updateZoomUI(zoom) {
  const slider = document.getElementById("zoomSlider");
  const zoomValue = document.getElementById("zoomValue");

  if (slider) {
    slider.value = zoom;
  }
  if (zoomValue) {
    zoomValue.textContent = zoom;
  }

  currentState.zoom = zoom;
}

/**
 * Initialize layer controls
 */
function initializeLayerControls() {
  const toggles = {
    toggleRoads: "roads",
    toggleParcels: "parcels",
    toggleModel: "model",
  };

  Object.entries(toggles).forEach(([id, layerName]) => {
    const checkbox = document.getElementById(id);
    if (!checkbox) return;

    checkbox.addEventListener("change", (e) => {
      if (!currentState.gisMapConnected) {
        // Revert checkbox if GIS map not connected
        e.target.checked = currentState.layers[layerName];
        return;
      }

      // Don't send if we're currently receiving an update (prevent echo)
      if (isReceivingLayerUpdate) {
        return;
      }

      const newLayers = {
        ...currentState.layers,
        [layerName]: e.target.checked,
      };

      sendLayerUpdate(newLayers);
    });
  });
}

/**
 * Initialize joystick control
 */
function initializeJoystick() {
  const zone = document.getElementById("joystickZone");
  if (!zone) return;

  // Create joystick instance with configuration
  joystickManager = nipplejs.create({
    zone: zone,
    mode: "static",
    position: { left: "50%", top: "50%" },
    color: "#00d4ff", // cyan accent
    size: 100,
    threshold: 0.15, // 15% dead zone
    fadeTime: 200,
    restOpacity: 0.6,
  });

  // Event handlers
  joystickManager.on("start", handleJoystickStart);
  joystickManager.on("move", handleJoystickMove);
  joystickManager.on("end", handleJoystickEnd);

  console.log("[Remote] Joystick initialized");
}

/**
 * Handle joystick start event
 */
function handleJoystickStart(evt, data) {
  if (!currentState.gisMapConnected) return;

  activeControl = "joystick";
  disableDPad();

  // Visual feedback
  const zone = document.getElementById("joystickZone");
  if (zone) zone.classList.add("active");

  // Haptic feedback
  if (navigator.vibrate) {
    navigator.vibrate(20);
  }

  console.log("[Remote] Joystick activated");
}

/**
 * Handle joystick move event
 */
function handleJoystickMove(evt, data) {
  if (!currentState.gisMapConnected || activeControl !== "joystick") return;

  // data.angle.radian: angle in radians
  // data.distance: distance from center (0-50 for size:100)
  // data.force: normalized force (0-1)

  // Convert to direction and magnitude
  const magnitude = Math.min(data.force, 1.0); // Clamp to 1.0

  // 15% dead zone already handled by Nipple.js threshold
  if (magnitude < 0.15) return;

  // Calculate pan direction (8-way for simplicity)
  const angle = data.angle.degree;
  const direction = getDirectionFromAngle(angle);

  // Adjust pan speed by magnitude (scaled distance)
  let panSpeed = 0.15 + (magnitude - 0.15) * 0.35; // 0.15 to 0.50 range

  // Reduce sensitivity at higher zoom levels for finer control
  // Base zoom is 10, so at zoom 10 speed is unchanged, at zoom 19 it's ~53% slower
  const zoomMultiplier = 10 / currentState.zoom;
  panSpeed = panSpeed * zoomMultiplier;

  // Throttle continuous updates
  if (!joystickInterval) {
    sendJoystickPanCommand(direction, panSpeed);
    joystickInterval = setTimeout(() => {
      joystickInterval = null;
    }, PAN_THROTTLE_MS);
  }
}

/**
 * Handle joystick end event
 */
function handleJoystickEnd(evt, data) {
  activeControl = null;
  enableDPad();

  // Visual feedback
  const zone = document.getElementById("joystickZone");
  if (zone) zone.classList.remove("active");

  // Haptic feedback
  if (navigator.vibrate) {
    navigator.vibrate(15);
  }

  // Clear any pending updates
  if (joystickInterval) {
    clearTimeout(joystickInterval);
    joystickInterval = null;
  }

  console.log("[Remote] Joystick released");
}

/**
 * Convert angle in degrees to 8-way direction
 */
function getDirectionFromAngle(degrees) {
  // Convert 360° to 8 cardinal directions
  // 0° = right, 90° = up, 180° = left, 270° = down
  const normalized = ((degrees + 22.5) % 360) / 45;
  const directions = [
    "east",
    "northeast",
    "north",
    "northwest",
    "west",
    "southwest",
    "south",
    "southeast",
  ];
  return directions[Math.floor(normalized)];
}

/**
 * Send joystick pan command
 */
function sendJoystickPanCommand(direction, magnitude) {
  if (!wsClient || !wsClient.getConnected()) return;

  const msg = createPanControlMessage(direction, magnitude);
  wsClient.send(msg);
  console.log(
    `[Remote] Joystick pan: ${direction} @ ${magnitude.toFixed(2)}`
  );
}

/**
 * Disable D-pad buttons when joystick is active
 */
function disableDPad() {
  const buttons = document.querySelectorAll(".dpad-button");
  buttons.forEach((btn) => {
    btn.style.opacity = "0.3";
    btn.style.pointerEvents = "none";
  });
}

/**
 * Enable D-pad buttons when joystick is released
 */
function enableDPad() {
  const buttons = document.querySelectorAll(".dpad-button");
  buttons.forEach((btn) => {
    btn.style.opacity = "";
    btn.style.pointerEvents = "";
  });
}

function sendLayerUpdate(layers) {
  if (!wsClient || !wsClient.getConnected()) {
    console.warn("[Remote] Cannot send layer update: not connected");
    return;
  }

  const msg = createLayerUpdateMessage(layers);
  const sent = wsClient.send(msg);
  if (sent) {
    console.log("[Remote] Layer update sent:", layers);
    // Update local state optimistically
    currentState.layers = { ...layers };
  } else {
    console.error("[Remote] Failed to send layer update");
  }
}

function updateLayerCheckboxes() {
  const toggles = {
    toggleRoads: "roads",
    toggleParcels: "parcels",
    toggleModel: "model",
  };

  // Set flag to prevent triggering change events
  isReceivingLayerUpdate = true;

  Object.entries(toggles).forEach(([id, layerName]) => {
    const checkbox = document.getElementById(id);
    if (checkbox && checkbox.checked !== currentState.layers[layerName]) {
      checkbox.checked = currentState.layers[layerName];
    }
  });

  // Reset flag after a short delay
  setTimeout(() => {
    isReceivingLayerUpdate = false;
  }, 100);
}

/**
 * Update all UI elements based on current state
 */
function updateUI() {
  // Update zoom
  updateZoomUI(currentState.zoom);

  // Update layer checkboxes
  updateLayerCheckboxes();

  // Disable controls if GIS map not connected
  const controls = document.querySelectorAll(
    ".dpad-button, .zoom-button, .zoom-slider, .layer-toggle"
  );
  controls.forEach((control) => {
    if (currentState.gisMapConnected) {
      control.style.opacity = "1";
      control.style.pointerEvents = "auto";
    } else {
      control.style.opacity = "0.5";
      control.style.pointerEvents = "none";
    }
  });
}

// Handle page visibility changes (reconnect when visible)
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && wsClient && !wsClient.getConnected()) {
    console.log("[Remote] Page visible, reconnecting...");
    wsClient.connect();
  }
});

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  stopConnectionMonitor();
  if (wsClient) {
    wsClient.disconnect();
  }
  // Cleanup joystick
  if (joystickManager) {
    joystickManager.destroy();
  }
});
