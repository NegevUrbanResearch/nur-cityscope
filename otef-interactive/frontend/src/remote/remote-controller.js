// OTEF Remote Controller
// Mobile-friendly remote control for OTEF interactive GIS map
// Uses centralized OTEFDataContext for shared state (viewport, layers, animations, connection)

import { rotateViewerVectorToItm } from "../shared/orientation-transform.js";
import { startCuratedSupabaseHeartbeat } from "../shared/curated-supabase-heartbeat.js";
import {
  LOCALE_EVENT,
  getLocale,
  setLocale,
  t,
} from "./remote-locale.js";
import { shouldReapplyDpadAfterFullControlRefresh } from "./remote-control-refresh-invariants.js";

// Current UI state (synced from API)
let currentState = {
  viewport: {
    bbox: null,
    corners: null,
    zoom: 15,
  },
  isConnected: false,
  viewerAngleDeg: 0,
};

// Control state management (prevent simultaneous use)
let activeControl = null; // null, 'dpad', or 'joystick'
let joystickManager = null; // Nipple.js instance
let joystickInterval = null; // For continuous pan updates

// Throttle/debounce timers
let zoomThrottleTimer = null;
const ZOOM_THROTTLE_MS = 100;
let zoomCommandInFlight = false;
let pendingZoomTarget = null;

// Table name for this controller
const TABLE_NAME = "otef";

/** Bottom shell tabs: matches LTR bar order (Workshop | Layers | Nav); arrow key navigation. */
const REMOTE_TAB_KEYS = ["curation", "layers", "navigation"];

/*
 * Legacy `#toggleModel` wiring was removed: that checkbox is not part of the remote shell
 * (Layers are toggled in the Layers tab / layer sheet). If a model quick-toggle is added
 * to remote-controller.html later, reintroduce a small initializer here — do not reference a
 * missing id from init (dead listeners).
 */

// Store unsubscribe functions for cleanup
let unsubscribeFunctions = [];

/** Last connection cluster state for re-applying translated status after locale change */
let lastConnectionUiStatus = "connecting";

// Initialize on DOM ready
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
}

async function initialize() {
  // Initialize layer registry if available
  if (typeof layerRegistry !== "undefined") {
    await layerRegistry.init();
  }

  // Initialize shared DataContext (single WS + API state)
  await OTEFDataContext.init(TABLE_NAME);

  // Wire DataContext subscriptions to local UI state
  unsubscribeFunctions.push(
    OTEFDataContext.subscribe("viewport", (viewport) => {
      if (!viewport) return;
      currentState.viewport = viewport;
      updateZoomUI(viewport.zoom);
      updateUI();
    }),
  );

  unsubscribeFunctions.push(
    OTEFDataContext.subscribe("layerGroups", () => {
      updateUI();
    }),
  );

  unsubscribeFunctions.push(
    OTEFDataContext.subscribe("connection", (isConnected) => {
      currentState.isConnected = !!isConnected;
      updateConnectionStatus(isConnected ? "connected" : "disconnected");
    }),
  );

  // Track orientation for viewer-frame → ITM-frame mapping
  unsubscribeFunctions.push(
    OTEFDataContext.subscribe("orientation", (angle) => {
      if (typeof angle === "number" && !Number.isNaN(angle)) {
        currentState.viewerAngleDeg = angle;
      }
    }),
  );

  // Seed orientation from API state (subscribe may not replay on first paint)
  if (
    typeof OTEFDataContext.getViewerAngleDeg === "function"
  ) {
    const angle = OTEFDataContext.getViewerAngleDeg();
    if (typeof angle === "number" && !Number.isNaN(angle)) {
      currentState.viewerAngleDeg = angle;
    }
  }

  // Initialize UI controls
  initializePanControls();
  initializeZoomControls();
  initializeJoystick();
  initRemoteShellTabs();
  initRemoteLocaleControls();

  // Initial UI render with whatever state DataContext has
  updateUI();

  const stopCuratedHeartbeat = startCuratedSupabaseHeartbeat({
    table: TABLE_NAME,
    onUpdated: async (pullPayload) => {
      if (
        typeof OTEFDataContext.refreshLayerGroupsFromApi === "function"
      ) {
        await OTEFDataContext.refreshLayerGroupsFromApi();
      }
      if (typeof window !== "undefined") {
        const detail =
          pullPayload &&
          Array.isArray(pullPayload.affected_curated_full_layer_ids)
            ? { affected_curated_full_layer_ids: pullPayload.affected_curated_full_layer_ids }
            : {};
        window.dispatchEvent(new CustomEvent("otef-curated-geojson-refresh", { detail }));
      }
      updateUI();
    },
  });
  unsubscribeFunctions.push(stopCuratedHeartbeat);
}

/**
 * Tab shell: show one `data-remote-tab` panel, sync `role="tab"` (Task 4; locale in Task 5).
 */
function setRemoteTab(activeKey) {
  if (!REMOTE_TAB_KEYS.includes(activeKey)) return;

  const panels = document.querySelectorAll(".remote-tab-panel[data-remote-tab]");
  panels.forEach((panel) => {
    const key = panel.getAttribute("data-remote-tab");
    const isActive = key === activeKey;
    panel.hidden = !isActive;
  });

  const nav = document.getElementById("remoteBottomNav");
  if (!nav) return;

  nav.querySelectorAll('[role="tab"][data-remote-tab]').forEach((tab) => {
    const key = tab.getAttribute("data-remote-tab");
    const isActive = key === activeKey;
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    tab.classList.toggle("is-active", isActive);
    tab.tabIndex = isActive ? 0 : -1;
  });

  if (activeKey !== "layers" && window.layerSheetController) {
    const ctrl = window.layerSheetController;
    // Preserves focused pack; see LayerSheetController.onLayersTabHidden.
    if (typeof ctrl.onLayersTabHidden === "function") ctrl.onLayersTabHidden();
  }

  if (activeKey === "layers" && window.layerSheetController) {
    const ctrl = window.layerSheetController;
    if (typeof ctrl.open === "function") ctrl.open();
  }
}

/**
 * Hebrew / English toggle and `otef:locale` → connection line + toggle `aria-pressed`
 */
function initRemoteLocaleControls() {
  const heBtn = document.getElementById("remoteLocaleHe");
  const enBtn = document.getElementById("remoteLocaleEn");

  const syncToggleFromLocale = () => {
    const loc = getLocale();
    if (heBtn) {
      heBtn.classList.toggle("is-active", loc === "he");
      heBtn.setAttribute("aria-pressed", loc === "he" ? "true" : "false");
    }
    if (enBtn) {
      enBtn.classList.toggle("is-active", loc === "en");
      enBtn.setAttribute("aria-pressed", loc === "en" ? "true" : "false");
    }
  };

  syncToggleFromLocale();

  if (heBtn) {
    heBtn.addEventListener("click", () => setLocale("he"));
  }
  if (enBtn) {
    enBtn.addEventListener("click", () => setLocale("en"));
  }

  if (typeof window !== "undefined") {
    window.addEventListener(LOCALE_EVENT, () => {
      syncToggleFromLocale();
      updateConnectionStatus(lastConnectionUiStatus);
    });
  }

  updateConnectionStatus(
    currentState.isConnected ? "connected" : "disconnected",
  );
}

function initRemoteShellTabs() {
  const nav = document.getElementById("remoteBottomNav");
  if (!nav) return;

  nav.addEventListener("click", (e) => {
    const tab = e.target.closest('[role="tab"][data-remote-tab]');
    if (!tab || !nav.contains(tab)) return;
    const k = tab.getAttribute("data-remote-tab");
    if (k) setRemoteTab(k);
  });

  nav.addEventListener("keydown", (e) => {
    const el = e.target;
    if (!el || el.getAttribute("role") !== "tab" || !nav.contains(el)) return;
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const key = el.getAttribute("data-remote-tab");
    const i = REMOTE_TAB_KEYS.indexOf(key);
    if (i < 0) return;
    const delta = e.key === "ArrowRight" ? 1 : -1;
    const next = (i + delta + REMOTE_TAB_KEYS.length) % REMOTE_TAB_KEYS.length;
    const nextKey = REMOTE_TAB_KEYS[next];
    setRemoteTab(nextKey);
    document.getElementById(`remote-tab-${nextKey}`)?.focus();
  });

  // Single source of truth on load: panels + tablist aria (HTML may omit `hidden` on nav tab)
  setRemoteTab("navigation");
}

/**
 * Update connection status UI
 */
function updateConnectionStatus(status) {
  lastConnectionUiStatus = status;

  const indicator = document.getElementById("statusIndicator");
  const text = document.getElementById("statusText");
  const warning = document.getElementById("warningOverlay");

  if (!indicator || !text) return;

  const statusConfig = {
    connected: { class: "connected", textKey: "statusConnected", showWarning: false },
    disconnected: {
      class: "disconnected",
      textKey: "statusDisconnected",
      showWarning: true,
    },
    connecting: {
      class: "connecting",
      textKey: "statusConnecting",
      showWarning: false,
    },
    error: { class: "disconnected", textKey: "statusError", showWarning: true },
  };

  const config = statusConfig[status] || statusConfig.disconnected;

  indicator.classList.remove("connected", "disconnected", "connecting");
  indicator.classList.add(config.class);
  text.textContent = t(config.textKey);

  currentState.isConnected = status === "connected";

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

      const viewport = getLiveViewport();
      if (!viewport || !viewport.bbox) return;
      const width = viewport.bbox[2] - viewport.bbox[0];
      const height = viewport.bbox[3] - viewport.bbox[1];
      const speed = getPanSpeedFactorForZoom(Number(viewport.zoom));
      const viewerVec = {
        dx: vector.vx * width * speed,
        dy: vector.vy * height * speed,
      };
      const angle = currentState.viewerAngleDeg || 0;
      const rotated = rotateViewerVectorToItm(viewerVec, -angle);

      OTEFDataContext.sendVelocity(rotated.dx, rotated.dy);
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
      queueZoomCommand(zoom);
    }, ZOOM_THROTTLE_MS);
  });

  // Zoom in button
  zoomIn.addEventListener("click", () => {
    if (!currentState.isConnected) return;
    const baseZoom = getCurrentZoomForControls();
    const newZoom = Math.min(19, baseZoom + 1);
    queueZoomCommand(newZoom);
  });

  // Zoom out button
  zoomOut.addEventListener("click", () => {
    if (!currentState.isConnected) return;
    const baseZoom = getCurrentZoomForControls();
    const newZoom = Math.max(10, baseZoom - 1);
    queueZoomCommand(newZoom);
  });
}

function getCurrentZoomForControls() {
  const slider = document.getElementById("zoomSlider");
  const sliderZoom = slider ? Number.parseInt(slider.value, 10) : NaN;
  if (Number.isFinite(sliderZoom)) return sliderZoom;

  const liveViewport =
    typeof OTEFDataContext !== "undefined" &&
    typeof OTEFDataContext.getViewport === "function"
      ? OTEFDataContext.getViewport()
      : null;
  const liveZoom = Number(liveViewport && liveViewport.zoom);
  if (Number.isFinite(liveZoom)) return liveZoom;

  const stateZoom = Number(currentState.viewport && currentState.viewport.zoom);
  return Number.isFinite(stateZoom) ? stateZoom : 15;
}

function getLiveViewport() {
  if (
    typeof OTEFDataContext !== "undefined" &&
    typeof OTEFDataContext.getViewport === "function"
  ) {
    const viewport = OTEFDataContext.getViewport();
    if (viewport && viewport.bbox) {
      return viewport;
    }
  }
  return currentState.viewport;
}

function getPanSpeedFactorForZoom(zoom) {
  if (!Number.isFinite(zoom)) return 0.32;
  if (zoom >= 18) return 0.16;
  if (zoom >= 17) return 0.2;
  if (zoom >= 16) return 0.24;
  if (zoom >= 15) return 0.28;
  return 0.32;
}

function queueZoomCommand(zoom) {
  const clampedZoom = Math.max(10, Math.min(19, Number(zoom)));
  if (!Number.isFinite(clampedZoom)) return;

  pendingZoomTarget = clampedZoom;
  updateZoomUI(clampedZoom);
  if (currentState.viewport) {
    currentState.viewport = { ...currentState.viewport, zoom: clampedZoom };
  }

  if (!zoomCommandInFlight) {
    void flushZoomQueue();
  }
}

async function flushZoomQueue() {
  if (zoomCommandInFlight) return;
  zoomCommandInFlight = true;
  try {
    while (pendingZoomTarget !== null) {
      const targetZoom = pendingZoomTarget;
      pendingZoomTarget = null;
      await sendZoomCommand(targetZoom);
    }
  } finally {
    zoomCommandInFlight = false;
  }
}

async function sendZoomCommand(zoom) {
  if (!currentState.isConnected) return;

  // Update UI optimistically; DataContext will sync real value via subscription
  updateZoomUI(zoom);

  try {
    await OTEFDataContext.zoom(zoom);
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
}

function handleJoystickMove(evt, data) {
  if (!currentState.isConnected || activeControl !== "joystick") return;

  const force = Math.min(data.force, 1.5);
  if (force < 0.15) {
    OTEFDataContext.sendVelocity(0, 0);
    return;
  }

  const angleRad = data.angle.radian;
  const viewport = getLiveViewport();
  if (!viewport || !viewport.bbox) return;

  const width = viewport.bbox[2] - viewport.bbox[0];
  const height = viewport.bbox[3] - viewport.bbox[1];

  // Max speed factor: move fraction of viewport per second
  // We use 0.4 (40%) to keep it smooth but responsive
  const maxSpeedFactor = getPanSpeedFactorForZoom(Number(viewport.zoom));
  const viewerVec = {
    dx: Math.cos(angleRad) * force * width * maxSpeedFactor,
    dy: Math.sin(angleRad) * force * height * maxSpeedFactor,
  };
  const angle = currentState.viewerAngleDeg || 0;
  const rotated = rotateViewerVectorToItm(viewerVec, -angle);

  // Reduced frequency for network messages (DataContext manages local 60fps loop)
  if (!joystickInterval) {
    OTEFDataContext.sendVelocity(rotated.dx, rotated.dy);
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

/**
 * Update all UI elements based on current state
 */
function updateUI() {
  // Update zoom
  updateZoomUI(currentState.viewport.zoom);

  // Disable controls if not connected
  const controls = document.querySelectorAll(
    ".dpad-button, .zoom-button, .zoom-slider, .layer-toggle, .layer-toggle-with-action",
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

  if (
    currentState.isConnected &&
    shouldReapplyDpadAfterFullControlRefresh(activeControl)
  ) {
    disableDPad();
  }
}

// Cleanup on page unload
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    // Unsubscribe from all DataContext subscriptions
    unsubscribeFunctions.forEach((unsubscribe) => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    });
    unsubscribeFunctions = [];

    if (joystickManager) {
      joystickManager.destroy();
    }
  });
}
