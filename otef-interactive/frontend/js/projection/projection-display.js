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

        const initialLayers = OTEFDataContext.getLayers();
        if (initialLayers && window.ProjectionLayerManager) {
          window.ProjectionLayerManager.syncLayersFromState(initialLayers);
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

        const initialLayerGroups = OTEFDataContext.getLayerGroups();
        if (initialLayerGroups && window.ProjectionLayerManager) {
          window.ProjectionLayerManager.syncLayerGroupsFromState(initialLayerGroups);
        }

        window._otefUnsubscribeFunctions.push(
          OTEFDataContext.subscribe('layers', (layers) => {
            if (layers && window.ProjectionLayerManager) {
              window.ProjectionLayerManager.syncLayersFromState(layers);
            }
          })
        );

        window._otefUnsubscribeFunctions.push(
          OTEFDataContext.subscribe('layerGroups', (layerGroups) => {
            if (layerGroups && window.ProjectionLayerManager) {
              window.ProjectionLayerManager.syncLayerGroupsFromState(layerGroups);
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
    box.style.cssText =
      "position: absolute; border: 3px solid rgba(0, 255, 255, 0.9); background: rgba(0, 255, 255, 0.15); box-shadow: 0 0 30px rgba(0, 255, 255, 0.8), inset 0 0 30px rgba(0, 255, 255, 0.4); pointer-events: none;";
    overlay.querySelector("svg")?.remove();
    overlay.appendChild(box);

    // Initialize smoothing loop
    startSmoothingLoop(box);
  }
  return box;
}

// Smoothing state
let targetHighlight = { x: 0, y: 0, w: 0, h: 0 };
let currentHighlight = { x: 0, y: 0, w: 0, h: 0 };
const LERP_FACTOR =
  (typeof MapProjectionConfig !== "undefined" &&
    MapProjectionConfig.PROJECTION_LERP_FACTOR) ||
  0.15; // Lower = smoother/slower, Higher = snappier

function startSmoothingLoop(box) {
  const step = () => {
    // Linear Interpolation (LERP)
    currentHighlight.x += (targetHighlight.x - currentHighlight.x) * LERP_FACTOR;
    currentHighlight.y += (targetHighlight.y - currentHighlight.y) * LERP_FACTOR;
    currentHighlight.w += (targetHighlight.w - currentHighlight.w) * LERP_FACTOR;
    currentHighlight.h += (targetHighlight.h - currentHighlight.h) * LERP_FACTOR;

    box.style.left = currentHighlight.x + "px";
    box.style.top = currentHighlight.y + "px";
    box.style.width = currentHighlight.w + "px";
    box.style.height = currentHighlight.h + "px";

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
    doc.msExitFullscreen;

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
  instructions.classList.remove("hidden");
  setTimeout(() => {
    instructions.classList.add("hidden");
  }, 3000);
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
