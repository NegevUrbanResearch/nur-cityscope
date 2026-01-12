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

// WebSocket client instance
let wsClient = null;

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
      // Request current state from GIS map
      // Retry if no response within 2 seconds
      requestState();
      setTimeout(() => {
        if (!currentState.gisMapConnected) {
          console.warn("[Remote] No response from GIS map, retrying...");
          requestState();
        }
      }, 2000);
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

  // Listen for state responses (indicates GIS map is connected)
  wsClient.on(OTEF_MESSAGE_TYPES.STATE_RESPONSE, handleStateResponse);

  // Listen for layer updates (from GIS map or remote)
  wsClient.on(OTEF_MESSAGE_TYPES.LAYER_UPDATE, handleLayerUpdate);

  // Listen for viewport updates (to sync zoom when GIS map changes)
  wsClient.on(OTEF_MESSAGE_TYPES.VIEWPORT_UPDATE, handleViewportUpdate);

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

  // Remove all status classes
  indicator.classList.remove("connected", "disconnected", "connecting");

  switch (status) {
    case "connected":
      indicator.classList.add("connected");
      text.textContent = "Connected";
      currentState.gisMapConnected = true;
      if (warning) warning.classList.add("hidden");
      break;
    case "disconnected":
      indicator.classList.add("disconnected");
      text.textContent = "Disconnected";
      currentState.gisMapConnected = false;
      if (warning) warning.classList.remove("hidden");
      break;
    case "connecting":
      indicator.classList.add("connecting");
      text.textContent = "Connecting...";
      currentState.gisMapConnected = false;
      break;
    case "error":
      indicator.classList.add("disconnected");
      text.textContent = "Error";
      currentState.gisMapConnected = false;
      if (warning) warning.classList.remove("hidden");
      break;
  }

  updateUI();
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

  // Update UI
  updateUI();

  // Update connection status - GIS map is now confirmed connected
  updateConnectionStatus("connected");
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
  if (wsClient) {
    wsClient.disconnect();
  }
});
