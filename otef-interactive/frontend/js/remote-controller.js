// OTEF Remote Controller
// Mobile-friendly remote control for OTEF interactive GIS map
// Now uses API-first stateless architecture - all state from PostgreSQL

// Current UI state (synced from API)
let currentState = {
  viewport: {
    bbox: null,
    corners: null,
    zoom: 15,
  },
  layers: {
    roads: true,
    parcels: false,
    model: false,
    majorRoads: false,
    smallRoads: false,
  },
  animations: {
    parcels: false,
  },
  isConnected: false,
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

// Table name for this controller
const TABLE_NAME = 'otef';

// Initialize on DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}

async function initialize() {
  console.log("[Remote] Initializing with API-first architecture...");

  // Initialize WebSocket connection (for notifications)
  initializeWebSocket();

  // Fetch initial state from API
  await fetchStateFromAPI();

  // Initialize UI controls
  initializePanControls();
  initializeZoomControls();
  initializeLayerControls();
  initializeAnimationControls();
  initializeJoystick();

  // Update UI with fetched state
  updateUI();

  console.log("[Remote] Initialized");
}

/**
 * Fetch current state from API (database)
 */
async function fetchStateFromAPI() {
  try {
    const state = await OTEF_API.getState(TABLE_NAME);

    // Update local state from API response
    currentState.viewport = state.viewport || currentState.viewport;
    currentState.layers = state.layers || currentState.layers;
    currentState.animations = state.animations || currentState.animations;

    console.log("[Remote] State fetched from API:", state);
    updateUI();
  } catch (error) {
    console.error("[Remote] Failed to fetch state from API:", error);
    // Use defaults if API fails
  }
}

/**
 * Initialize WebSocket connection for notifications
 */
function initializeWebSocket() {
  wsClient = new OTEFWebSocketClient("/ws/otef/", {
    onConnect: () => {
      currentState.isConnected = true;
      updateConnectionStatus("connected");
      console.log("[Remote] WebSocket connected - ready to send commands");
    },
    onDisconnect: () => {
      updateConnectionStatus("disconnected");
      currentState.isConnected = false;
      updateUI();
    },
    onError: (error) => {
      console.error("[Remote] WebSocket error:", error);
      updateConnectionStatus("error");
      currentState.isConnected = false;
      updateUI();
    },
  });

  // Listen for state change notifications
  // Remote controller initiated changes, so we only need to fetch if NOT waiting for our own update
  wsClient.on(OTEF_MESSAGE_TYPES.VIEWPORT_CHANGED, async (msg) => {
    console.log("[Remote] Viewport changed notification");
    // Always fetch viewport changes (these come from server-side commands)
    await fetchStateFromAPI();
  });

  // Skip layer refetch - we already have the local state after our own update
  wsClient.on(OTEF_MESSAGE_TYPES.LAYERS_CHANGED, (msg) => {
    console.log("[Remote] Layers changed notification (ignored - using local state)");
    // Don't refetch - we initiated the change
  });

  wsClient.on(OTEF_MESSAGE_TYPES.ANIMATION_CHANGED, (msg) => {
    console.log("[Remote] Animation changed:", msg);
    if (msg.layerId && typeof msg.enabled === 'boolean') {
      currentState.animations[msg.layerId] = msg.enabled;
      updateAnimationButtonState();
    }
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

  currentState.isConnected = (status === "connected");

  if (warning) {
    warning.classList.toggle("hidden", !config.showWarning);
  }

  updateUI();
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

  Object.entries(directions).forEach(([id, direction]) => {
    const button = document.getElementById(id);
    if (!button) return;

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
  if (!currentState.isConnected) return;
  if (activeControl === "joystick") return;

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
  activeControl = null;
  panActive = false;
  panDirection = null;
  button.classList.remove("active");

  if (panInterval) {
    clearInterval(panInterval);
    panInterval = null;
  }
}

async function sendPanCommand(direction) {
  if (!currentState.isConnected) return;

  // Throttle rapid pan commands
  if (panThrottleTimer) return;

  // Send command via API for server-side execution
  try {
    await OTEF_API.executeCommand(TABLE_NAME, {
      action: 'pan',
      direction: direction,
      delta: 0.15
    });
  } catch (error) {
    console.error("[Remote] Pan command failed:", error);
  }

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
    if (!currentState.isConnected) return;
    const newZoom = Math.min(19, currentState.viewport.zoom + 1);
    sendZoomCommand(newZoom);
    updateZoomUI(newZoom);
  });

  // Zoom out button
  zoomOut.addEventListener("click", () => {
    if (!currentState.isConnected) return;
    const newZoom = Math.max(10, currentState.viewport.zoom - 1);
    sendZoomCommand(newZoom);
    updateZoomUI(newZoom);
  });
}

async function sendZoomCommand(zoom) {
  if (!currentState.isConnected) return;

  // Update UI optimistically
  updateZoomUI(zoom);
  currentState.viewport.zoom = zoom;

  // Send command via API for server-side execution
  try {
    await OTEF_API.executeCommand(TABLE_NAME, {
      action: 'zoom',
      level: zoom
    });
    console.log("[Remote] Zoom command sent:", zoom);
  } catch (error) {
    console.error("[Remote] Zoom command failed:", error);
  }
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
}

/**
 * Initialize layer controls
 */
function initializeLayerControls() {
  const toggles = {
    toggleRoads: "roads",
    toggleParcels: "parcels",
    toggleModel: "model",
    toggleMajorRoads: "majorRoads",
    toggleSmallRoads: "smallRoads",
  };

  Object.entries(toggles).forEach(([id, layerName]) => {
    const checkbox = document.getElementById(id);
    if (!checkbox) return;

    checkbox.addEventListener("change", async (e) => {
      if (!currentState.isConnected) {
        // Revert checkbox if not connected
        e.target.checked = currentState.layers[layerName];
        return;
      }

      // Update local state and send to API
      const newLayers = {
        ...currentState.layers,
        [layerName]: e.target.checked,
      };

      currentState.layers = newLayers;

      try {
        await OTEF_API.updateLayers(TABLE_NAME, newLayers);
        console.log("[Remote] Layers updated:", newLayers);
      } catch (error) {
        console.error("[Remote] Layer update failed:", error);
        // Revert on error
        e.target.checked = !e.target.checked;
        currentState.layers[layerName] = !currentState.layers[layerName];
      }

      // Update animation button state for parcels
      if (layerName === 'parcels') {
        updateAnimationButtonState();

        // If parcels layer is turned off, also disable animation
        if (!e.target.checked && currentState.animations.parcels) {
          await sendAnimationToggle('parcels', false);
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

  animateBtn.addEventListener('click', async () => {
    if (!currentState.isConnected) return;
    if (!currentState.layers.parcels) return;  // Parcels must be enabled

    // Toggle animation state
    const newState = !currentState.animations.parcels;
    await sendAnimationToggle('parcels', newState);
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

  const parcelsEnabled = currentState.layers.parcels;
  animateBtn.disabled = !parcelsEnabled || !currentState.isConnected;

  // Update active state
  if (currentState.animations.parcels && parcelsEnabled) {
    animateBtn.classList.add('active');
  } else {
    animateBtn.classList.remove('active');
  }
}

/**
 * Send animation toggle via API
 */
async function sendAnimationToggle(layerId, enabled) {
  if (!currentState.isConnected) {
    console.warn("[Remote] Cannot send animation toggle: not connected");
    return;
  }

  // Update local state optimistically
  currentState.animations[layerId] = enabled;
  updateAnimationButtonState();

  try {
    await OTEF_API.updateAnimations(TABLE_NAME, currentState.animations);
    console.log(`[Remote] Animation toggle sent: ${layerId} = ${enabled}`);
  } catch (error) {
    console.error("[Remote] Animation toggle failed:", error);
    // Revert on error
    currentState.animations[layerId] = !enabled;
    updateAnimationButtonState();
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
    color: "#00d4ff",
    size: 100,
    threshold: 0.15,
    fadeTime: 200,
    restOpacity: 0.6,
  });

  // Event handlers
  joystickManager.on("start", handleJoystickStart);
  joystickManager.on("move", handleJoystickMove);
  joystickManager.on("end", handleJoystickEnd);

  console.log("[Remote] Joystick initialized");
}

function handleJoystickStart(evt, data) {
  if (!currentState.isConnected) return;

  activeControl = "joystick";
  disableDPad();

  const zone = document.getElementById("joystickZone");
  if (zone) zone.classList.add("active");

  if (navigator.vibrate) {
    navigator.vibrate(20);
  }

  console.log("[Remote] Joystick activated");
}

function handleJoystickMove(evt, data) {
  if (!currentState.isConnected || activeControl !== "joystick") return;

  const magnitude = Math.min(data.force, 1.0);
  if (magnitude < 0.15) return;

  const angle = data.angle.degree;
  const direction = getDirectionFromAngle(angle);

  let panSpeed = 0.15 + (magnitude - 0.15) * 0.35;
  const zoomMultiplier = 10 / currentState.viewport.zoom;
  panSpeed = panSpeed * zoomMultiplier;

  // Throttle continuous updates
  if (!joystickInterval) {
    sendJoystickPanCommand(direction, panSpeed);
    joystickInterval = setTimeout(() => {
      joystickInterval = null;
    }, PAN_THROTTLE_MS);
  }
}

function handleJoystickEnd(evt, data) {
  activeControl = null;
  enableDPad();

  const zone = document.getElementById("joystickZone");
  if (zone) zone.classList.remove("active");

  if (navigator.vibrate) {
    navigator.vibrate(15);
  }

  if (joystickInterval) {
    clearTimeout(joystickInterval);
    joystickInterval = null;
  }

  console.log("[Remote] Joystick released");
}

function getDirectionFromAngle(degrees) {
  const normalized = ((degrees + 22.5) % 360) / 45;
  const directions = [
    "east", "northeast", "north", "northwest",
    "west", "southwest", "south", "southeast",
  ];
  return directions[Math.floor(normalized)];
}

async function sendJoystickPanCommand(direction, magnitude) {
  if (!currentState.isConnected) return;

  try {
    await OTEF_API.executeCommand(TABLE_NAME, {
      action: 'pan',
      direction: direction,
      delta: magnitude
    });
    console.log(`[Remote] Joystick pan: ${direction} @ ${magnitude.toFixed(2)}`);
  } catch (error) {
    console.error("[Remote] Joystick pan failed:", error);
  }
}

function disableDPad() {
  const buttons = document.querySelectorAll(".dpad-button");
  buttons.forEach((btn) => {
    btn.style.opacity = "0.3";
    btn.style.pointerEvents = "none";
  });
}

function enableDPad() {
  const buttons = document.querySelectorAll(".dpad-button");
  buttons.forEach((btn) => {
    btn.style.opacity = "";
    btn.style.pointerEvents = "";
  });
}

function updateLayerCheckboxes() {
  const toggles = {
    toggleRoads: "roads",
    toggleParcels: "parcels",
    toggleModel: "model",
    toggleMajorRoads: "majorRoads",
    toggleSmallRoads: "smallRoads",
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
  updateZoomUI(currentState.viewport.zoom);

  // Update layer checkboxes
  updateLayerCheckboxes();

  // Update animation button state
  updateAnimationButtonState();

  // Disable controls if not connected
  const controls = document.querySelectorAll(
    ".dpad-button, .zoom-button, .zoom-slider, .layer-toggle, .layer-toggle-with-action"
  );
  controls.forEach((control) => {
    if (currentState.isConnected) {
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
  if (joystickManager) {
    joystickManager.destroy();
  }
});
