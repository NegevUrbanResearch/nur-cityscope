// OTEF Remote Controller
// Mobile-friendly remote control for OTEF interactive GIS map

// Authoritative state - remote controller is the single source of truth
let authoritativeState = {
  viewport: {
    bbox: null,
    corners: null,
    zoom: 15,
  },
  layers: {
    roads: true,
    parcels: false,
    model: false,
  },
  animations: {
    parcels: false,  // Parcel animation enabled/disabled
  },
};

// UI state (for display purposes)
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

// Throttle/debounce timers
let panThrottleTimer = null;
let zoomThrottleTimer = null;
const PAN_THROTTLE_MS = 150;
const ZOOM_THROTTLE_MS = 100;

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
  initializeAnimationControls();
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
      // WebSocket is connected - show connected status immediately
      currentState.gisMapConnected = true;
      updateConnectionStatus("connected");
      updateUI();
      console.log("[Remote] WebSocket connected - ready to send commands");
    },
    onDisconnect: () => {
      updateConnectionStatus("disconnected");
      currentState.gisMapConnected = false;
      updateUI();
    },
    onError: (error) => {
      console.error("[Remote] WebSocket error:", error);
      updateConnectionStatus("error");
      currentState.gisMapConnected = false;
      updateUI();
    },
  });

  // Listen for STATE_REQUEST - respond with current authoritative state
  wsClient.on(OTEF_MESSAGE_TYPES.STATE_REQUEST, handleStateRequest);

  // Listen for viewport updates from GIS map (updates state)
  wsClient.on(OTEF_MESSAGE_TYPES.VIEWPORT_UPDATE, (msg) => {
    handleViewportUpdate(msg);
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
    connected: { class: "connected", text: "Connected", showWarning: false },
    disconnected: { class: "disconnected", text: "Disconnected", showWarning: true },
    connecting: { class: "connecting", text: "Connecting...", showWarning: false },
    error: { class: "disconnected", text: "Error", showWarning: true },
  };

  const config = statusConfig[status] || statusConfig.disconnected;

  indicator.classList.remove("connected", "disconnected", "connecting");
  indicator.classList.add(config.class);
  text.textContent = config.text;

  // Update gisMapConnected based on WebSocket connection status
  // "connected" means WebSocket is connected and ready to send commands
  // Controls work as long as WebSocket is connected, even if GIS map tab isn't open
  if (status === "connected") {
    currentState.gisMapConnected = true;
  } else if (status === "disconnected" || status === "error") {
    currentState.gisMapConnected = false;
  }

  if (warning) {
    warning.classList.toggle("hidden", !config.showWarning);
  }

  updateUI();
}

// Connection status is based on WebSocket connection - shows "connected" when WebSocket is connected
// This means the remote controller is ready to send commands, regardless of whether other tabs are open

/**
 * Handle STATE_REQUEST - respond with current authoritative state
 */
function handleStateRequest(msg) {
  if (!validateStateRequest(msg)) {
    console.warn("[Remote] Invalid state request:", msg);
    return;
  }

  console.log("[Remote] Received state request, responding with current state");

  if (!wsClient || !wsClient.getConnected()) return;

  // Only respond if we have valid viewport data (bbox and zoom required)
  if (!authoritativeState.viewport.bbox || !authoritativeState.viewport.zoom) {
    console.log("[Remote] Cannot respond to state request: viewport not initialized yet");
    return;
  }

  // Respond with current authoritative state
  const stateResponse = createStateResponseMessage(
    authoritativeState.viewport,
    authoritativeState.layers
  );

  wsClient.send(stateResponse);
  console.log("[Remote] State response sent:", stateResponse);
}

/**
 * Handle viewport update from GIS map - update authoritative state
 */
function handleViewportUpdate(msg) {
  if (!validateViewportUpdate(msg)) {
    console.warn("[Remote] Invalid viewport update message:", msg);
    return;
  }

  // Update authoritative viewport state
  if (msg.bbox) {
    authoritativeState.viewport.bbox = msg.bbox;
  }
  if (msg.corners) {
    authoritativeState.viewport.corners = msg.corners;
  }
  if (typeof msg.zoom === "number") {
    authoritativeState.viewport.zoom = msg.zoom;
    currentState.zoom = msg.zoom;
    updateZoomUI(msg.zoom);
    console.log("[Remote] Viewport state updated, zoom:", msg.zoom);
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

  // Update UI optimistically
  updateZoomUI(zoom);

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

      // Update authoritative state and broadcast
      const newLayers = {
        ...authoritativeState.layers,
        [layerName]: e.target.checked,
      };

      sendLayerUpdate(newLayers);

      // Update animation button state for parcels
      if (layerName === 'parcels') {
        updateAnimationButtonState();

        // If parcels layer is turned off, also disable animation
        if (!e.target.checked && authoritativeState.animations.parcels) {
          sendAnimationToggle('parcels', false);
        }
      }
    });
  });
}

/**
 * Initialize animation controls
 */
function initializeAnimationControls() {
  const animateBtn = document.getElementById('animateParcels');
  if (!animateBtn) return;

  animateBtn.addEventListener('click', () => {
    if (!currentState.gisMapConnected) return;
    if (!authoritativeState.layers.parcels) return;  // Parcels must be enabled

    // Toggle animation state
    const newState = !authoritativeState.animations.parcels;
    sendAnimationToggle('parcels', newState);
  });

  // Initial state
  updateAnimationButtonState();
}

/**
 * Update animation button enabled/disabled state
 */
function updateAnimationButtonState() {
  const animateBtn = document.getElementById('animateParcels');
  if (!animateBtn) return;

  const parcelsEnabled = authoritativeState.layers.parcels;
  animateBtn.disabled = !parcelsEnabled || !currentState.gisMapConnected;

  // Update active state
  if (authoritativeState.animations.parcels && parcelsEnabled) {
    animateBtn.classList.add('active');
  } else {
    animateBtn.classList.remove('active');
  }
}

/**
 * Send animation toggle to projector
 */
function sendAnimationToggle(layerId, enabled) {
  if (!wsClient || !wsClient.getConnected()) {
    console.warn("[Remote] Cannot send animation toggle: not connected");
    return;
  }

  // Update authoritative state
  authoritativeState.animations[layerId] = enabled;

  // Send animation toggle message
  const msg = createAnimationToggleMessage(layerId, enabled);
  const sent = wsClient.send(msg);
  if (sent) {
    console.log(`[Remote] Animation toggle sent: ${layerId} = ${enabled}`);
    updateAnimationButtonState();
  } else {
    console.error("[Remote] Failed to send animation toggle");
  }
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

  // Update authoritative state
  authoritativeState.layers = { ...layers };
  currentState.layers = { ...layers };

  // Broadcast layer update
  const msg = createLayerUpdateMessage(layers);
  const sent = wsClient.send(msg);
  if (sent) {
    console.log("[Remote] Layer update broadcast:", layers);
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

  Object.entries(toggles).forEach(([id, layerName]) => {
    const checkbox = document.getElementById(id);
    if (checkbox && checkbox.checked !== currentState.layers[layerName]) {
      checkbox.checked = currentState.layers[layerName];
    }
  });
}

/**
 * Update all UI elements based on current state
 */
function updateUI() {
  // Update zoom
  updateZoomUI(currentState.zoom);

  // Update layer checkboxes
  updateLayerCheckboxes();

  // Update animation button state
  updateAnimationButtonState();

  // Disable controls if GIS map not connected
  const controls = document.querySelectorAll(
    ".dpad-button, .zoom-button, .zoom-slider, .layer-toggle, .layer-toggle-with-action"
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
  if (wsClient) {
    wsClient.disconnect();
  }
  // Cleanup joystick
  if (joystickManager) {
    joystickManager.destroy();
  }
});
