// OTEF Remote Controller
// Mobile-friendly remote control for OTEF interactive GIS map
// Uses centralized OTEFDataContext for shared state (viewport, layers, animations, connection)

import {
  isGisBasemapId,
  isSatelliteBasemap,
  normalizeGisBasemap,
} from "../shared/gis-basemap.js";
import { normalizeNarrativeState } from "../shared/nli-narratives.js";
import {
  LOCALE_EVENT,
  getLocale,
  setLocale,
  t,
} from "./remote-locale.js";
import { shouldReapplyDpadAfterFullControlRefresh } from "./remote-control-refresh-invariants.js";
import { DEFAULT_ZOOM } from "./remote-zoom-control-contract.js";
import { createRemoteZoomController } from "./remote-zoom-controls.js";
import {
  createRemoteDpadController,
  createRemoteJoystickController,
} from "./remote-joystick-controls.js";

// Current UI state (synced from API)
let currentState = {
  viewport: {
    bbox: null,
    corners: null,
    zoom: DEFAULT_ZOOM,
  },
  isConnected: false,
  viewerAngleDeg: 0,
  basemap: "osm",
  narrativeState: normalizeNarrativeState(null),
};

// Control state management (prevent simultaneous use)
let activeControl = null; // null, 'dpad', or 'joystick'
let joystickController = null;
let dpadController = null;
let basemapControlController = null;
let zoomController = null;

// Table name for this controller
const TABLE_NAME = "otef";

/** Bottom shell tabs: LTR bar order (Library launcher | Presentation | Layers | Navigation). */
const REMOTE_TAB_KEYS = ["curation", "slideshow", "layers", "navigation"];
const LAUNCHER_REMOTE_TAB_KEYS = new Set(["curation"]);
const NLI_STAFF_REMOTE_HREF = "nli-staff-remote.html";

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

  zoomController = createRemoteZoomController({
    slider: document.getElementById("zoomSlider"),
    zoomIn: document.getElementById("zoomIn"),
    zoomOut: document.getElementById("zoomOut"),
    zoomValue: document.getElementById("zoomValue"),
    getViewport: () => OTEFDataContext.getViewport(),
    zoom: (level) => OTEFDataContext.zoom(level),
    isConnected: () => currentState.isConnected,
    getStateViewport: () => currentState.viewport,
    setStateViewport: (viewport) => {
      currentState.viewport = viewport;
    },
  });

  // Wire DataContext subscriptions to local UI state
  unsubscribeFunctions.push(
    OTEFDataContext.subscribe("viewport", (viewport) => {
      if (!viewport) return;
      currentState.viewport = viewport;
      zoomController?.syncFromViewport(viewport);
      updateUI();
    }),
  );

  unsubscribeFunctions.push(
    OTEFDataContext.subscribe("layerGroups", () => {
      updateUI();
    }),
  );

  unsubscribeFunctions.push(
    OTEFDataContext.subscribe("basemap", (basemap) => {
      currentState.basemap = normalizeGisBasemap(basemap);
      updateBasemapUI(currentState.basemap);
      updateUI();
    }),
  );

  unsubscribeFunctions.push(
    OTEFDataContext.subscribe("narrativeState", (narrativeState) => {
      currentState.narrativeState = normalizeNarrativeState(narrativeState);
      updateBasemapUI(currentState.basemap);
      updateUI();
    }),
  );

  unsubscribeFunctions.push(
    OTEFDataContext.subscribe("connection", (isConnected) => {
      currentState.isConnected = !!isConnected;
      updateBasemapUI(currentState.basemap);
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
  dpadController = createRemoteDpadController({
    isConnected: () => currentState.isConnected,
    getViewport: getLiveViewport,
    getViewerAngleDeg: () => currentState.viewerAngleDeg || 0,
    sendVelocity: (dx, dy) => OTEFDataContext.sendVelocity(dx, dy),
    isBlocked: () => activeControl === "joystick",
  });
  dpadController.init();
  initializeBasemapControls();
  zoomController.init();
  joystickController = createRemoteJoystickController({
    zone: document.getElementById("joystickZone"),
    nipplejs: typeof globalThis.nipplejs !== "undefined" ? globalThis.nipplejs : null,
    isConnected: () => currentState.isConnected,
    getViewport: getLiveViewport,
    getViewerAngleDeg: () => currentState.viewerAngleDeg || 0,
    sendVelocity: (dx, dy) => OTEFDataContext.sendVelocity(dx, dy),
    onStart: () => {
      activeControl = "joystick";
      dpadController?.setEnabled(false);
    },
    onEnd: () => {
      activeControl = null;
      dpadController?.setEnabled(true);
    },
    color: "#00d4ff",
  });
  joystickController.init();
  initRemoteShellTabs();
  initRemoteLocaleControls();

  // Initial UI render with whatever state DataContext has
  updateUI();
}

function openNliStaffRemote() {
  const url = new URL(NLI_STAFF_REMOTE_HREF, window.location.href);
  url.searchParams.set("from", "remote");
  window.location.assign(`${url.pathname}${url.search}`);
}

/**
 * Tab shell: show one `data-remote-tab` panel, sync `role="tab"` (Task 4; locale in Task 5).
 */
function setRemoteTab(activeKey) {
  if (!REMOTE_TAB_KEYS.includes(activeKey) || LAUNCHER_REMOTE_TAB_KEYS.has(activeKey)) return;
  const nav = document.getElementById("remoteBottomNav");
  const previousActiveKey =
    nav
      ?.querySelector('[role="tab"][data-remote-tab][aria-selected="true"]')
      ?.getAttribute("data-remote-tab") || null;

  const panels = document.querySelectorAll(".remote-tab-panel[data-remote-tab]");
  panels.forEach((panel) => {
    const key = panel.getAttribute("data-remote-tab");
    const isActive = key === activeKey;
    panel.hidden = !isActive;
  });

  if (!nav) return;

  nav.querySelectorAll('[role="tab"][data-remote-tab]').forEach((tab) => {
    const key = tab.getAttribute("data-remote-tab");
    const isActive = key === activeKey;
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    tab.classList.toggle("is-active", isActive);
    tab.tabIndex = LAUNCHER_REMOTE_TAB_KEYS.has(key) || isActive ? 0 : -1;
  });

  if (
    previousActiveKey === "layers" &&
    activeKey !== "layers" &&
    window.layerSheetController
  ) {
    const ctrl = window.layerSheetController;
    // Preserves focused pack; see LayerSheetController.onLayersTabHidden.
    if (typeof ctrl.onLayersTabHidden === "function") ctrl.onLayersTabHidden();
  }

  if (activeKey === "layers" && window.layerSheetController) {
    const ctrl = window.layerSheetController;
    if (typeof ctrl.open === "function") ctrl.open();
  }

  if (
    previousActiveKey === "slideshow" &&
    activeKey !== "slideshow" &&
    window.slideshowTabController
  ) {
    const ctrl = window.slideshowTabController;
    if (typeof ctrl.onSlideshowTabHidden === "function") {
      ctrl.onSlideshowTabHidden();
    }
  }

  if (activeKey === "slideshow" && window.slideshowTabController) {
    const ctrl = window.slideshowTabController;
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
    if (LAUNCHER_REMOTE_TAB_KEYS.has(k) || tab.getAttribute("data-nli-remote-launch") === "true") {
      openNliStaffRemote();
      return;
    }
    if (tab.getAttribute("aria-disabled") === "true") return;
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
    const enabledTabKeys = REMOTE_TAB_KEYS.filter((tabKey) => !LAUNCHER_REMOTE_TAB_KEYS.has(tabKey));
    const enabledIndex = enabledTabKeys.indexOf(key);
    if (enabledIndex < 0) return;
    const next = (enabledIndex + delta + enabledTabKeys.length) % enabledTabKeys.length;
    const nextKey = enabledTabKeys[next];
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

function initializeBasemapControls() {
  const control = document.getElementById("basemapControl");
  if (!control) return;
  basemapControlController?.destroy?.();
  basemapControlController = createRemoteBasemapController({
    root: control,
    initialBasemap: currentState.basemap,
    getBasemap: () => OTEFDataContext.getBasemap(),
    isConnected: () => currentState.isConnected,
    isNarrativeActive: () => normalizeNarrativeState(currentState.narrativeState).id !== null,
    setBasemap: (basemap) => OTEFDataContext.setBasemap(basemap),
    onBasemapSelected: (basemap) => {
      currentState.basemap = basemap;
    },
    onError: (error) => {
      console.error("[Remote] Basemap command failed:", error);
    },
  });
}

export function deriveBasemapControlState(
  basemap,
  narrativeActive = false,
  connected = true,
) {
  const normalized = normalizeGisBasemap(basemap);
  return {
    parentActive: isSatelliteBasemap(normalized),
    colorPressed: normalized === "satellite",
    bwPressed: normalized === "satellite_bw",
    disabled: !!narrativeActive || !connected,
  };
}

function renderRemoteBasemapControls(
  root,
  basemap,
  narrativeActive,
  connected,
  menuOpen = false,
  pending = false,
) {
  const normalized = normalizeGisBasemap(basemap);
  const state = deriveBasemapControlState(normalized, narrativeActive, connected);
  root.querySelectorAll(".basemap-button[data-basemap]").forEach((button) => {
    const isParent = button.id === "basemapSatellite";
    const isActive = isParent
      ? state.parentActive
      : button.getAttribute("data-basemap") === normalized;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
    button.disabled = state.disabled || pending;
    button.setAttribute("aria-disabled", button.disabled ? "true" : "false");
    button.style.opacity = button.disabled ? "0.5" : "1";
    button.style.pointerEvents = button.disabled ? "none" : "auto";
  });
  const parent = root.querySelector("#basemapSatellite");
  parent?.setAttribute("aria-expanded", menuOpen ? "true" : "false");
  const variants = root.querySelector("#basemapSatelliteVariants");
  if (variants) variants.hidden = !menuOpen;
  return state;
}

export function createRemoteBasemapController(options = {}) {
  const root = options.root;
  if (!root) return null;
  let basemap = normalizeGisBasemap(options.initialBasemap);
  let confirmedBasemap = basemap;
  let menuOpen = false;
  let pending = false;
  const documentTarget = options.document ?? (
    typeof document !== "undefined" ? document : null
  );
  const render = (nextBasemap = basemap, { confirmed = true } = {}) => {
    basemap = normalizeGisBasemap(nextBasemap);
    if (confirmed) confirmedBasemap = basemap;
    const narrativeActive = options.isNarrativeActive?.() === true;
    const connected = options.isConnected?.() !== false;
    if (narrativeActive || !connected) menuOpen = false;
    return renderRemoteBasemapControls(
      root,
      basemap,
      narrativeActive,
      connected,
      menuOpen,
      pending,
    );
  };
  const closeMenu = ({ restoreFocus = false } = {}) => {
    if (!menuOpen) return;
    menuOpen = false;
    render(basemap, { confirmed: false });
    if (restoreFocus) root.querySelector("#basemapSatellite")?.focus?.();
  };
  const parent = root.querySelector("#basemapSatellite");
  const variants = root.querySelector("#basemapSatelliteVariants");
  const parentWrapper = parent?.closest?.(".basemap-satellite-wrapper");
  parentWrapper?.append?.(variants);
  const handleClick = (event) => {
    const button = event?.target?.closest?.("[data-basemap]");
    if (
      !button ||
      !root.contains(button) ||
      button.disabled ||
      options.isConnected?.() === false ||
      options.isNarrativeActive?.() === true
    ) return;
    if (button.id === "basemapSatellite") {
      menuOpen = !menuOpen;
      render(basemap, { confirmed: false });
      if (menuOpen) variants?.querySelector?.("[data-basemap]")?.focus?.();
      return;
    }
    const nextBasemap = button.getAttribute("data-basemap");
    if (!isGisBasemapId(nextBasemap)) return;
    const requestedBasemap = normalizeGisBasemap(nextBasemap);
    basemap = requestedBasemap;
    menuOpen = false;
    pending = true;
    options.onBasemapSelected?.(requestedBasemap);
    render(requestedBasemap, { confirmed: false });
    Promise.resolve()
      .then(() => options.setBasemap?.(requestedBasemap))
      .then((result) => {
        if (result?.ok === false) throw result.error ?? "Basemap command failed";
        confirmedBasemap = requestedBasemap;
      })
      .catch((error) => options.onError?.(error))
      .finally(() => {
        pending = false;
        if (basemap !== confirmedBasemap) {
          const authoritative = options.getBasemap?.();
          basemap = normalizeGisBasemap(authoritative ?? confirmedBasemap);
        }
        render(basemap);
      });
  };
  const handleDocumentClick = (event) => {
    if (menuOpen && !root.contains(event?.target)) closeMenu();
  };
  const handleDocumentKeydown = (event) => {
    if (event?.key === "Escape") closeMenu({ restoreFocus: true });
  };
  const handleDocumentFocusIn = (event) => {
    if (menuOpen && !root.contains(event?.target)) closeMenu();
  };
  root.addEventListener("click", handleClick);
  documentTarget?.addEventListener("click", handleDocumentClick);
  documentTarget?.addEventListener("keydown", handleDocumentKeydown);
  documentTarget?.addEventListener("focusin", handleDocumentFocusIn);
  render(basemap);
  return {
    render,
    destroy() {
      root.removeEventListener("click", handleClick);
      documentTarget?.removeEventListener("click", handleDocumentClick);
      documentTarget?.removeEventListener("keydown", handleDocumentKeydown);
      documentTarget?.removeEventListener("focusin", handleDocumentFocusIn);
    },
  };
}

function updateBasemapUI(basemap) {
  if (basemapControlController) {
    basemapControlController.render(basemap);
    return;
  }
  const root = document.getElementById("basemapControl");
  if (!root) return;
  renderRemoteBasemapControls(
    root,
    basemap,
    normalizeNarrativeState(currentState.narrativeState).id !== null,
    currentState.isConnected,
  );
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

function disableDPad() {
  dpadController?.setEnabled(false);
}

function enableDPad() {
  dpadController?.setEnabled(true);
}

/**
 * Update all UI elements based on current state
 */
function updateUI() {
  zoomController?.updateZoomUI(currentState.viewport.zoom);

  // Disable controls if not connected
  const controls = document.querySelectorAll(
    ".dpad-button, .zoom-button, .zoom-slider, .basemap-button, .layer-toggle, .layer-toggle-with-action",
  );
  controls.forEach((control) => {
    if (currentState.isConnected && !control.disabled) {
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

    window.layerSheetController?.destroy?.();
    basemapControlController?.destroy?.();
    basemapControlController = null;

    joystickController?.destroy?.();
    joystickController = null;
    dpadController?.destroy?.();
    dpadController = null;
  });
}
