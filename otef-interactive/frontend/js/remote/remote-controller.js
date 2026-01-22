// OTEF Remote Controller
// Mobile-friendly remote control for OTEF interactive GIS map
// Uses centralized OTEFDataContext for shared state (viewport, layers, animations, connection)

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

// Throttle/debounce timers
let zoomThrottleTimer = null;
const ZOOM_THROTTLE_MS = 100;

// Table name for this controller
const TABLE_NAME = 'otef';

// Store unsubscribe functions for cleanup
let unsubscribeFunctions = [];

// Initialize on DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}

async function initialize() {
  console.log("[Remote] Initializing with OTEFDataContext...");

  // Initialize shared DataContext (single WS + API state)
  await OTEFDataContext.init(TABLE_NAME);

  // Wire DataContext subscriptions to local UI state
  unsubscribeFunctions.push(
    OTEFDataContext.subscribe('viewport', (viewport) => {
      if (!viewport) return;
      currentState.viewport = viewport;
      updateZoomUI(viewport.zoom);
      updateUI();
    })
  );

  unsubscribeFunctions.push(
    OTEFDataContext.subscribe('layers', (layers) => {
      if (!layers) return;
      currentState.layers = layers;
      updateUI();
    })
  );

  unsubscribeFunctions.push(
    OTEFDataContext.subscribe('animations', (animations) => {
      if (!animations) return;
      currentState.animations = animations;
      updateAnimationButtonState();
    })
  );

  unsubscribeFunctions.push(
    OTEFDataContext.subscribe('connection', (isConnected) => {
      currentState.isConnected = !!isConnected;
      updateConnectionStatus(isConnected ? "connected" : "disconnected");
    })
  );

  // Initialize UI controls
  initializePanControls();
  initializeZoomControls();
  initializeLayerControls();
  initializeAnimationControls();
  initializeJoystick();

  // Initial UI render with whatever state DataContext has
  updateUI();

  console.log("[Remote] Initialized");
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
    panNorth: { vx: 0, vy: 1 },
    panSouth: { vx: 0, vy: -1 },
    panEast: { vx: 1, vy: 0 },
    panWest: { vx: -1, vy: 0 },
  };

  Object.entries(directions).forEach(([id, vector]) => {
    const button = document.getElementById(id);
    if (!button) return;

    const startHandler = (e) => {
      e.preventDefault();
      if (!currentState.isConnected || activeControl === "joystick") return;
      activeControl = "dpad";
      button.classList.add("active");

      const viewport = currentState.viewport;
      if (!viewport || !viewport.bbox) return;
      const width = viewport.bbox[2] - viewport.bbox[0];
      const height = viewport.bbox[3] - viewport.bbox[1];
      const speed = 0.5; // 50% of viewport per second

      OTEFDataContext.sendVelocity(vector.vx * width * speed, vector.vy * height * speed);
      if (navigator.vibrate) navigator.vibrate(20);
    };

    const endHandler = (e) => {
      if (activeControl === "dpad") {
        activeControl = null;
        button.classList.remove("active");
        OTEFDataContext.sendVelocity(0, 0);
      }
    };

    button.addEventListener("touchstart", startHandler, { passive: false });
    button.addEventListener("touchend", endHandler, { passive: false });
    button.addEventListener("mousedown", startHandler);
    button.addEventListener("mouseup", endHandler);
    button.addEventListener("mouseleave", endHandler);
  });
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

  // Update UI optimistically; DataContext will sync real value via subscription
  updateZoomUI(zoom);

  try {
    await OTEFDataContext.zoom(zoom);
    console.log("[Remote] Zoom command sent via DataContext:", zoom);
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

      try {
        const result = await OTEFDataContext.toggleLayer(layerName, e.target.checked);
        if (!result || !result.ok) {
          throw result && result.error ? result.error : new Error("Layer update failed");
        }
        console.log("[Remote] Layers updated via DataContext");
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

  try {
    const result = await OTEFDataContext.toggleAnimation(layerId, enabled);
    if (!result || !result.ok) {
      throw result && result.error ? result.error : new Error("Animation toggle failed");
    }
    console.log(`[Remote] Animation toggle sent via DataContext: ${layerId} = ${enabled}`);
  } catch (error) {
    console.error("[Remote] Animation toggle failed:", error);
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
  console.log('[Remote] Joystick Move:', data.force.toFixed(2), data.angle.radian.toFixed(2));

  const force = Math.min(data.force, 1.5);
  if (force < 0.15) {
    OTEFDataContext.sendVelocity(0, 0);
    return;
  }

  const angleRad = data.angle.radian;
  const viewport = currentState.viewport;
  if (!viewport || !viewport.bbox) return;

  const width = viewport.bbox[2] - viewport.bbox[0];
  const height = viewport.bbox[3] - viewport.bbox[1];

  // Max speed factor: move fraction of viewport per second
  // We use 0.4 (40%) to keep it smooth but responsive
  const maxSpeedFactor = 0.4;
  const vx = Math.cos(angleRad) * force * width * maxSpeedFactor;
  const vy = Math.sin(angleRad) * force * height * maxSpeedFactor;

  // Reduced frequency for network messages (DataContext manages local 60fps loop)
  if (!joystickInterval) {
    OTEFDataContext.sendVelocity(vx, vy);
    joystickInterval = setTimeout(() => {
      joystickInterval = null;
    }, 100);
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

  // Send explicit stop command
  OTEFDataContext.sendVelocity(0, 0);

  console.log("[Remote] Joystick released");
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

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  // Unsubscribe from all DataContext subscriptions
  unsubscribeFunctions.forEach(unsubscribe => {
    if (typeof unsubscribe === 'function') {
      unsubscribe();
    }
  });
  unsubscribeFunctions = [];

  if (joystickManager) {
    joystickManager.destroy();
  }
});
