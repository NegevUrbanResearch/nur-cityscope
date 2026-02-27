// OTEF Projection Display - Simplified for TouchDesigner integration
// Warping/calibration is handled by TouchDesigner, not by this page

// Load model bounds
let modelBounds;

fetch("data/model-bounds.json")
  .then((res) => res.json())
  .then((bounds) => {
    modelBounds = bounds;

    // Configure helpers and initialize layers after model bounds are loaded
    if (window.ProjectionLayerManager) {
      window.ProjectionLayerManager.configure({
        getModelBounds: () => modelBounds,
        getDisplayedImageBounds
      });
      window.ProjectionLayerManager.initializeLayers();
    }

    if (window.ProjectionBoundsEditor) {
      window.ProjectionBoundsEditor.configure({
        getModelBounds: () => modelBounds,
        getDisplayedImageBounds,
        itmToDisplayPixels
      });
    }

    if (window.ProjectionRotationEditor) {
      window.ProjectionRotationEditor.configure({
        getModelBounds: () => modelBounds,
        getDisplayedImageBounds,
      });
    }

    // Initialize shared OTEFDataContext and subscribe to state
    if (typeof OTEFDataContext !== 'undefined') {
      OTEFDataContext.init(TABLE_NAME).then(() => {
        const initialViewport = OTEFDataContext.getViewport();
        if (initialViewport) {
          if (initialViewport.corners) {
            updateHighlightQuad(initialViewport.corners);
          } else if (initialViewport.bbox) {
            updateHighlightRect(initialViewport.bbox);
          }
        }

        // Store unsubscribe functions for cleanup
        if (!window._otefUnsubscribeFunctions) {
          window._otefUnsubscribeFunctions = [];
        }

        window._otefUnsubscribeFunctions.push(
          OTEFDataContext.subscribe('viewport', (viewport) => {
            if (!viewport) return;
            if (viewport.corners) {
              updateHighlightQuad(viewport.corners);
            } else if (viewport.bbox) {
              updateHighlightRect(viewport.bbox);
            }
          })
        );

        const initialLayerGroups =
          typeof LayerStateHelper !== "undefined" && typeof LayerStateHelper.getEffectiveLayerGroups === "function"
            ? LayerStateHelper.getEffectiveLayerGroups()
            : OTEFDataContext.getLayerGroups();
        if (initialLayerGroups && initialLayerGroups.length > 0 && window.ProjectionLayerManager) {
          window.ProjectionLayerManager.syncLayerGroupsFromState(initialLayerGroups);
        }

        window._otefUnsubscribeFunctions.push(
          OTEFDataContext.subscribe('layerGroups', () => {
            const effective =
              typeof LayerStateHelper !== "undefined" && typeof LayerStateHelper.getEffectiveLayerGroups === "function"
                ? LayerStateHelper.getEffectiveLayerGroups()
                : OTEFDataContext.getLayerGroups();
            if (effective && effective.length > 0 && window.ProjectionLayerManager) {
              window.ProjectionLayerManager.syncLayerGroupsFromState(effective);
            }
          })
        );

      });
    }
  })
  .catch((error) => {
    console.error("Error loading model bounds:", error);
  });

// Table name for state management
const TABLE_NAME = 'otef';

function getDisplayedImageBounds() {
  const container = document.getElementById("displayContainer");
  if (!container) return null;

  const containerRect = container.getBoundingClientRect();

  // Return full-frame bounds - the entire container is the active region
  return {
    offsetX: 0,
    offsetY: 0,
    width: containerRect.width,
    height: containerRect.height,
    containerWidth: containerRect.width,
    containerHeight: containerRect.height,
  };
}

function itmToDisplayPixels(x, y) {
  const bounds = getDisplayedImageBounds();
  if (!bounds || !modelBounds) return null;

  // REMOVED rigid clamping [0, 1] to allow highlight to bleed off model area
  const pctX = (x - modelBounds.west) / (modelBounds.east - modelBounds.west);
  const pctY = (modelBounds.north - y) / (modelBounds.north - modelBounds.south);

  return {
    x: bounds.offsetX + pctX * bounds.width,
    y: bounds.offsetY + pctY * bounds.height,
  };
}

function isFullExtent(minX, minY, maxX, maxY) {
  if (!modelBounds) return false;
  const tol =
    (typeof MapProjectionConfig !== "undefined" &&
      MapProjectionConfig.PROJECTION_FULL_EXTENT_TOLERANCE) ||
    10;
  return (
    Math.abs(minX - modelBounds.west) < tol &&
    Math.abs(minY - modelBounds.south) < tol &&
    Math.abs(maxX - modelBounds.east) < tol &&
    Math.abs(maxY - modelBounds.north) < tol
  );
}

function getOrCreateHighlightBox() {
  const overlay = document.getElementById("highlightOverlay");
  let box = overlay.querySelector(".highlight-box");
  if (!box) {
    box = document.createElement("div");
    box.className = "highlight-box";
    // REMOVED CSS transition for LERP-based smoothing
    // Aesthetics are now handled in styles.css
    box.style.cssText = "position: absolute; pointer-events: none;";
    overlay.querySelector("svg")?.remove();
    overlay.appendChild(box);

    // Direction marker: visible in rotation edit mode to make angle calibration
    // obvious even when viewport shape is near-square.
    const heading = document.createElement("div");
    heading.className = "highlight-angle-indicator";
    heading.style.cssText =
      "position:absolute;left:50%;top:8%;width:3px;height:38%;background:rgba(255,200,0,0.95);box-shadow:0 0 10px rgba(255,200,0,0.8);transform:translateX(-50%);display:none;";
    box.appendChild(heading);

    // Initialize smoothing loop
    startSmoothingLoop(box);
  }
  return box;
}

// Smoothing state
let targetHighlight = { x: 0, y: 0, w: 0, h: 0 };
let currentHighlight = { x: 0, y: 0, w: 0, h: 0 };
if (typeof window !== "undefined") {
  if (typeof window.rotationEditModeActive === "undefined") {
    window.rotationEditModeActive = false;
  }
  if (typeof window.rotationPreviewAngleDeg === "undefined") {
    window.rotationPreviewAngleDeg = 0;
  }
}

function getProjectorSmoothingConfig() {
  const perfCfg =
    typeof MapProjectionConfig !== "undefined" &&
    MapProjectionConfig.GIS_PERF &&
    MapProjectionConfig.GIS_PERF.PROJECTOR_SMOOTHING
      ? MapProjectionConfig.GIS_PERF.PROJECTOR_SMOOTHING
      : null;
  return (
    perfCfg || {
      ENABLE_ADAPTIVE_SMOOTHING: false,
      BASE_LERP:
        (typeof MapProjectionConfig !== "undefined" &&
          MapProjectionConfig.PROJECTION_LERP_FACTOR) ||
        0.15,
      FAST_LERP:
        (typeof MapProjectionConfig !== "undefined" &&
          MapProjectionConfig.PROJECTION_LERP_FACTOR) ||
        0.15,
      SPEED_THRESHOLD_PX: 40,
    }
  );
}

function getLerpFactorForCurrentFrame(speedPx) {
  const cfg = getProjectorSmoothingConfig();
  if (
    typeof window !== "undefined" &&
    window.HighlightSmoothingPolicy &&
    typeof window.HighlightSmoothingPolicy.computeLerpFactor === "function"
  ) {
    return window.HighlightSmoothingPolicy.computeLerpFactor({ speedPx }, cfg);
  }
  return typeof cfg.BASE_LERP === "number" ? cfg.BASE_LERP : 0.15;
}

function getHighlightAngleDeg(state) {
  const isEditMode = !!(state && state.isEditMode);
  const preview = state && state.previewAngleDeg;
  if (!isEditMode) return 0;
  if (typeof preview !== "number" || Number.isNaN(preview)) return 0;
  return preview;
}

function startSmoothingLoop(box) {
  const heading = box.querySelector(".highlight-angle-indicator");
  const step = () => {
    const dx = targetHighlight.x - currentHighlight.x;
    const dy = targetHighlight.y - currentHighlight.y;
    const driftPx = Math.sqrt(dx * dx + dy * dy);
    const lerpFactor = getLerpFactorForCurrentFrame(driftPx);

    // Linear Interpolation (LERP)
    currentHighlight.x += dx * lerpFactor;
    currentHighlight.y += dy * lerpFactor;
    currentHighlight.w += (targetHighlight.w - currentHighlight.w) * lerpFactor;
    currentHighlight.h += (targetHighlight.h - currentHighlight.h) * lerpFactor;

    if (
      typeof window !== "undefined" &&
      window.MapPerfTelemetry &&
      typeof window.MapPerfTelemetry.record === "function"
    ) {
      window.MapPerfTelemetry.record("syncDriftPx", driftPx);
    }

    box.style.left = currentHighlight.x + "px";
    box.style.top = currentHighlight.y + "px";
    box.style.width = currentHighlight.w + "px";
    box.style.height = currentHighlight.h + "px";
    box.style.transformOrigin = "center center";
    const angle = getHighlightAngleDeg({
      isEditMode:
        typeof window !== "undefined" && !!window.rotationEditModeActive,
      previewAngleDeg:
        typeof window !== "undefined" ? window.rotationPreviewAngleDeg : 0,
    });
    box.style.transform = "rotate(" + angle + "deg)";
    if (heading) {
      const editModeActive =
        typeof window !== "undefined" && !!window.rotationEditModeActive;
      heading.style.display = editModeActive ? "block" : "none";
    }

    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function updateHighlightQuad(corners) {
  if (!modelBounds) return;

  lastMessage = { corners };
  const bounds = getDisplayedImageBounds();
  if (!bounds) return;

  const all_x = [corners.sw.x, corners.se.x, corners.nw.x, corners.ne.x];
  const all_y = [corners.sw.y, corners.se.y, corners.nw.y, corners.ne.y];
  const minX = Math.min(...all_x),
    minY = Math.min(...all_y);
  const maxX = Math.max(...all_x),
    maxY = Math.max(...all_y);

  let sw_px, se_px, nw_px, ne_px;
  if (isFullExtent(minX, minY, maxX, maxY)) {
    const { offsetX, offsetY, width, height } = bounds;
    sw_px = { x: offsetX, y: offsetY + height };
    se_px = { x: offsetX + width, y: offsetY + height };
    nw_px = { x: offsetX, y: offsetY };
    ne_px = { x: offsetX + width, y: offsetY };
  } else {
    sw_px = itmToDisplayPixels(corners.sw.x, corners.sw.y);
    se_px = itmToDisplayPixels(corners.se.x, corners.se.y);
    nw_px = itmToDisplayPixels(corners.nw.x, corners.nw.y);
    ne_px = itmToDisplayPixels(corners.ne.x, corners.ne.y);
    if (!sw_px || !se_px || !nw_px || !ne_px) return;
  }

  getOrCreateHighlightBox(); // Ensure loop is running
  const minPX = Math.min(sw_px.x, nw_px.x, se_px.x, ne_px.x);
  const maxPX = Math.max(sw_px.x, nw_px.x, se_px.x, ne_px.x);
  const minPY = Math.min(sw_px.y, nw_px.y, se_px.y, ne_px.y);
  const maxPY = Math.max(sw_px.y, nw_px.y, se_px.y, ne_px.y);

  targetHighlight = {
    x: minPX,
    y: minPY,
    w: maxPX - minPX,
    h: maxPY - minPY
  };
}

function updateHighlightRect(itmBbox) {
  if (!modelBounds) return;

  lastMessage = { bbox: itmBbox };
  const bounds = getDisplayedImageBounds();
  if (!bounds) return;

  let sw_px, ne_px;
  if (isFullExtent(itmBbox[0], itmBbox[1], itmBbox[2], itmBbox[3])) {
    const { offsetX, offsetY, width, height } = bounds;
    sw_px = { x: offsetX, y: offsetY + height };
    ne_px = { x: offsetX + width, y: offsetY };
  } else {
    sw_px = itmToDisplayPixels(itmBbox[0], itmBbox[1]);
    ne_px = itmToDisplayPixels(itmBbox[2], itmBbox[3]);
    if (!sw_px || !ne_px) return;
  }

  getOrCreateHighlightBox(); // Ensure loop is running
  targetHighlight = {
    x: sw_px.x,
    y: ne_px.y,
    w: ne_px.x - sw_px.x,
    h: sw_px.y - ne_px.y
  };
}

let lastMessage = null;

// Debounce resize handler
let resizeTimeout;
function handleResize() {
  if (lastMessage?.corners) updateHighlightQuad(lastMessage.corners);
  else if (lastMessage?.bbox) updateHighlightRect(lastMessage.bbox);

  // Update canvas renderer position on resize
  if (window.ProjectionLayerManager) {
    window.ProjectionLayerManager.handleResize();
  }
}

window.addEventListener("resize", () => {
  const debounceMs =
    (typeof MapProjectionConfig !== "undefined" &&
      MapProjectionConfig.PROJECTION_RESIZE_DEBOUNCE_MS) ||
    200;
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(handleResize, debounceMs); // Debounce
});

// Keyboard shortcuts
window.addEventListener("keydown", (event) => {
  // H key for help/instructions toggle
  if (event.key === "h" || event.key === "H") {
    const instructions = document.getElementById("instructions");
    instructions.classList.toggle("hidden");
  }

  // F key for fullscreen
  if (event.key === "f" || event.key === "F") {
    toggleFullScreen();
  }

  // B key for bounds editor toggle
  if (event.key === "b" || event.key === "B") {
    if (window.ProjectionBoundsEditor) {
      window.ProjectionBoundsEditor.toggle();
    }
  }

  // R key for rotation/orientation editor
  if (event.key === "r" || event.key === "R") {
    if (window.ProjectionRotationEditor) {
      window.ProjectionRotationEditor.toggle();
    }
  }
});

// Toggle fullscreen
function toggleFullScreen() {
  const doc = window.document;
  const docElement = doc.documentElement;
  const requestFullScreen =
    docElement.requestFullscreen ||
    docElement.mozRequestFullScreen ||
    docElement.webkitRequestFullScreen ||
    docElement.msRequestFullscreen;
  const cancelFullScreen =
    doc.exitFullscreen ||
    doc.mozCancelFullScreen ||
    doc.webkitExitFullscreen ||
    doc.msFullscreenFullscreen;

  if (
    !doc.fullscreenElement &&
    !doc.mozFullScreenElement &&
    !doc.webkitFullscreenElement &&
    !doc.msFullscreenElement
  ) {
    requestFullScreen.call(docElement);
  } else {
    cancelFullScreen.call(doc);
  }
}

// Show help for 3 seconds on load
setTimeout(() => {
  const instructions = document.getElementById("instructions");
  if (instructions) {
    instructions.classList.remove("hidden");
    setTimeout(() => {
      instructions.classList.add("hidden");
    }, 3000);
  }
}, 500);

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
