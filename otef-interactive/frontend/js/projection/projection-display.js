// OTEF Projection Display - Simplified for TouchDesigner integration
// Warping/calibration is handled by TouchDesigner, not by this page

// Load model bounds
let modelBounds;
let canvasRenderer = null;  // Canvas-based layer renderer for performance
let loadedLayers = {}; // Store layer data for resize handling

fetch("data/model-bounds.json")
  .then((res) => res.json())
  .then((bounds) => {
    modelBounds = bounds;
    console.log("Model bounds loaded:", bounds);

    // Update debug overlay with model dimensions
    if (window.DebugOverlay) {
      window.DebugOverlay.updateModelDimensions(
        bounds.image_width,
        bounds.image_height
      );
    }

    // Initialize layers after model bounds are loaded
    initializeLayers();

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
        if (initialLayers) {
          syncLayersFromState(initialLayers);
        }

        const initialAnimations = OTEFDataContext.getAnimations();
        if (initialAnimations && initialAnimations.parcels !== undefined) {
          handleAnimationToggle({ layerId: 'parcels', enabled: initialAnimations.parcels });
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
        if (initialLayerGroups) {
          syncLayerGroupsFromState(initialLayerGroups);
        }

        window._otefUnsubscribeFunctions.push(
          OTEFDataContext.subscribe('layers', (layers) => {
            if (layers) {
              syncLayersFromState(layers);
            }
          })
        );

        window._otefUnsubscribeFunctions.push(
          OTEFDataContext.subscribe('layerGroups', (layerGroups) => {
            if (layerGroups) {
              syncLayerGroupsFromState(layerGroups);
            }
          })
        );

        window._otefUnsubscribeFunctions.push(
          OTEFDataContext.subscribe('animations', (animations) => {
            if (animations && animations.parcels !== undefined) {
              handleAnimationToggle({ layerId: 'parcels', enabled: animations.parcels });
            }
          })
        );
      });
    }
  })
  .catch((error) => {
    console.error("Error loading model bounds:", error);
  });

// Layer state tracking
let layerState = {
  roads: true,
  parcels: false,
  model: false,
  majorRoads: false,
  smallRoads: false,
};

// Animation state
let animationState = {
  parcels: false,  // Parcel animation enabled/disabled
};

// Parcel animator instance (WebGL-based)
let parcelAnimator = null;

function setDebugStatus(status) {
  if (window.DebugOverlay) window.DebugOverlay.setWebSocketStatus(status);
}

// Table name for state management
const TABLE_NAME = 'otef';

/**
 * Sync layers from state object (shared by API fetch and notifications)
 */
function syncLayersFromState(layers) {
  // Update roads layer
  if (layers.roads !== undefined && layers.roads !== layerState.roads) {
    layerState.roads = layers.roads;
    if (layers.roads && !loadedLayers.roads) {
      loadRoadsLayer().catch((error) => {
        console.error("[Projection] Failed to load roads layer:", error);
      });
    } else {
      updateLayerVisibility("roads", layers.roads);
    }
  }

  // Update parcels layer
  if (layers.parcels !== undefined && layers.parcels !== layerState.parcels) {
    layerState.parcels = layers.parcels;
    if (layers.parcels && !loadedLayers.parcels) {
      loadParcelsLayer();
    } else {
      updateLayerVisibility("parcels", layers.parcels);

      // If parcels layer is hidden, stop animation
      if (!layers.parcels && animationState.parcels && parcelAnimator) {
        parcelAnimator.stop();
        animationState.parcels = false;
      }
    }
  }

  // Update model base layer
  if (layers.model !== undefined && layers.model !== layerState.model) {
    layerState.model = layers.model;
    const img = document.getElementById("displayedImage");
    if (img) {
      img.style.opacity = layers.model ? "1" : "0";
    }
  }

  // Update majorRoads layer
  if (layers.majorRoads !== undefined && layers.majorRoads !== layerState.majorRoads) {
    layerState.majorRoads = layers.majorRoads;
    if (layers.majorRoads && !loadedLayers.majorRoads) {
      loadMajorRoadsLayer();
    } else {
      updateLayerVisibility("majorRoads", layers.majorRoads);
    }
  }

  // Update smallRoads layer
  if (layers.smallRoads !== undefined && layers.smallRoads !== layerState.smallRoads) {
    layerState.smallRoads = layers.smallRoads;
    if (layers.smallRoads && !loadedLayers.smallRoads) {
      loadSmallRoadsLayer();
    } else {
      updateLayerVisibility("smallRoads", layers.smallRoads);
    }
  }
}

/**
 * Update visibility of a layer using Canvas renderer
 */
function updateLayerVisibility(layerId, visible) {
  if (canvasRenderer) {
    canvasRenderer.setLayerVisibility(layerId, visible);
  }
}

function getDisplayedImageBounds() {
  const img = document.getElementById("displayedImage");
  const container = document.getElementById("displayContainer");
  if (!img?.naturalWidth || !container) return null;

  const imgRect = img.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  return {
    offsetX: imgRect.left - containerRect.left,
    offsetY: imgRect.top - containerRect.top,
    width: imgRect.width,
    height: imgRect.height,
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
  const tol = 10;
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
const LERP_FACTOR = 0.15; // Lower = smoother/slower, Higher = snappier

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

  if (window.DebugOverlay) {
    const bbox = [minX, minY, maxX, maxY];
    window.DebugOverlay.updateReceivedBbox(bbox);
    const [pxMin, pyMin, pxMax, pyMax] = CoordUtils.bboxItmToPixel(
      bbox,
      modelBounds
    );
    window.DebugOverlay.updatePixelCoords(pxMin, pyMin, pxMax, pyMax);
    const left =
      ((Math.min(sw_px.x, nw_px.x) - bounds.offsetX) / bounds.width) * 100;
    const top =
      ((Math.min(nw_px.y, ne_px.y) - bounds.offsetY) / bounds.height) * 100;
    const right =
      ((Math.max(se_px.x, ne_px.x) - bounds.offsetX) / bounds.width) * 100;
    const bottom =
      ((Math.max(sw_px.y, se_px.y) - bounds.offsetY) / bounds.height) * 100;
    window.DebugOverlay.updateHighlightPercentages(
      left,
      top,
      right - left,
      bottom - top
    );
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

  if (window.DebugOverlay) {
    window.DebugOverlay.updateReceivedBbox(itmBbox);
    const [pxMin, pyMin, pxMax, pyMax] = CoordUtils.bboxItmToPixel(
      itmBbox,
      modelBounds
    );
    window.DebugOverlay.updatePixelCoords(pxMin, pyMin, pxMax, pyMax);
    const left = ((sw_px.x - bounds.offsetX) / bounds.width) * 100;
    const top = ((ne_px.y - bounds.offsetY) / bounds.height) * 100;
    const width = ((ne_px.x - sw_px.x) / bounds.width) * 100;
    const height = ((sw_px.y - ne_px.y) / bounds.height) * 100;
    window.DebugOverlay.updateHighlightPercentages(left, top, width, height);
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
  if (canvasRenderer && modelBounds) {
    const displayBounds = getDisplayedImageBounds();
    if (displayBounds) {
      canvasRenderer.updatePosition(displayBounds, modelBounds);
    }
  }
}

window.addEventListener("resize", () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(handleResize, 200); // Debounce 200ms
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
    toggleBoundsEditMode();
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

// ------------------------
// Bounds editor (polygon)
// ------------------------

let boundsEditMode = false;
let boundsWorkingPolygon = null; // Array of { x, y } in ITM
let boundsDragState = null; // { index, offsetX, offsetY }

function displayPixelsToItm(px, py) {
  const bounds = getDisplayedImageBounds();
  if (!bounds || !modelBounds) return null;

  const pctX = (px - bounds.offsetX) / bounds.width;
  const pctY = (py - bounds.offsetY) / bounds.height;

  const x = modelBounds.west + pctX * (modelBounds.east - modelBounds.west);
  const y = modelBounds.north - pctY * (modelBounds.north - modelBounds.south);

  return { x, y };
}

function ensureBoundsEditorElements() {
  const svg = document.getElementById("boundsEditorOverlay");
  if (!svg) return null;
  return svg;
}

function getDefaultBoundsPolygon() {
  if (!modelBounds) return null;
  return [
    { x: modelBounds.west, y: modelBounds.south },
    { x: modelBounds.east, y: modelBounds.south },
    { x: modelBounds.east, y: modelBounds.north },
    { x: modelBounds.west, y: modelBounds.north },
  ];
}

function renderBoundsEditorPolygon() {
  const svg = ensureBoundsEditorElements();
  if (!svg) return;
  const polygon = boundsWorkingPolygon;
  const displayBounds = getDisplayedImageBounds();
  if (!polygon || polygon.length < 2 || !displayBounds) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    return;
  }

  // Clear existing
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  // SVG needs its own size to match container
  const container = document.getElementById("displayContainer");
  const rect = container.getBoundingClientRect();
  svg.setAttribute("width", rect.width);
  svg.setAttribute("height", rect.height);

  // Convert ITM vertices to pixels
  const pixelPoints = polygon
    .map((v) => itmToDisplayPixels(v.x, v.y))
    .filter(Boolean);

  if (pixelPoints.length < 2) return;

  // Draw edges
  for (let i = 0; i < pixelPoints.length; i++) {
    const a = pixelPoints[i];
    const b = pixelPoints[(i + 1) % pixelPoints.length];
    const edge = document.createElementNS("http://www.w3.org/2000/svg", "line");
    edge.setAttribute("x1", a.x);
    edge.setAttribute("y1", a.y);
    edge.setAttribute("x2", b.x);
    edge.setAttribute("y2", b.y);
    edge.classList.add("bounds-edge");
    edge.dataset.edgeIndex = String(i);

    edge.addEventListener("click", (event) => {
      event.stopPropagation();
      handleBoundsEdgeClick(i);
    });

    svg.appendChild(edge);
  }

  // Draw vertices
  pixelPoints.forEach((pt, index) => {
    const vertex = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    vertex.setAttribute("cx", pt.x);
    vertex.setAttribute("cy", pt.y);
    vertex.setAttribute("r", 6);
    vertex.classList.add("bounds-vertex");
    vertex.dataset.vertexIndex = String(index);

    vertex.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      startBoundsVertexDrag(event, index);
    });

    vertex.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleBoundsVertexDelete(index);
    });

    svg.appendChild(vertex);
  });
}

function startBoundsVertexDrag(event, index) {
  const container = document.getElementById("displayContainer");
  const rect = container.getBoundingClientRect();
  const startX = event.clientX - rect.left;
  const startY = event.clientY - rect.top;

  boundsDragState = {
    index,
    startX,
    startY,
  };

  const onMove = (moveEvent) => {
    if (!boundsDragState) return;
    const currentX = moveEvent.clientX - rect.left;
    const currentY = moveEvent.clientY - rect.top;
    const itm = displayPixelsToItm(currentX, currentY);
    if (!itm) return;

    boundsWorkingPolygon[boundsDragState.index] = { x: itm.x, y: itm.y };
    renderBoundsEditorPolygon();
  };

  const onUp = () => {
    boundsDragState = null;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

function handleBoundsEdgeClick(edgeIndex) {
  if (!boundsWorkingPolygon || boundsWorkingPolygon.length < 2) return;

  const a = boundsWorkingPolygon[edgeIndex];
  const b = boundsWorkingPolygon[(edgeIndex + 1) % boundsWorkingPolygon.length];
  const mid = {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };

  boundsWorkingPolygon.splice(edgeIndex + 1, 0, mid);
  renderBoundsEditorPolygon();
}

function handleBoundsVertexDelete(vertexIndex) {
  if (!boundsWorkingPolygon || boundsWorkingPolygon.length <= 3) return;
  boundsWorkingPolygon.splice(vertexIndex, 1);
  renderBoundsEditorPolygon();
}

function enterBoundsEditMode() {
  if (boundsEditMode) return;
  if (!modelBounds) {
    console.warn("[Projection] Cannot enter bounds editor: modelBounds not loaded");
    return;
  }

  const root = document.body;
  root.classList.add("bounds-editor-active");

  // Get current bounds from DataContext or fall back to rectangle
  let polygon = null;
  if (typeof OTEFDataContext !== "undefined") {
    const current = OTEFDataContext.getBounds();
    if (Array.isArray(current) && current.length >= 3) {
      polygon = current;
    }
  }
  if (!polygon) {
    polygon = getDefaultBoundsPolygon();
  }

  // Deep copy to avoid mutating live state until Apply
  boundsWorkingPolygon = polygon.map((v) => ({ x: v.x, y: v.y }));
  boundsEditMode = true;

  const toolbar = document.getElementById("boundsToolbar");
  if (toolbar) {
    toolbar.style.display = "block";
  }

  const applyBtn = document.getElementById("boundsApplyBtn");
  const resetBtn = document.getElementById("boundsResetBtn");
  const cancelBtn = document.getElementById("boundsCancelBtn");

  if (applyBtn) {
    applyBtn.onclick = async () => {
      await handleBoundsApply();
    };
  }
  if (resetBtn) {
    resetBtn.onclick = () => {
      boundsWorkingPolygon = getDefaultBoundsPolygon();
      renderBoundsEditorPolygon();
    };
  }
  if (cancelBtn) {
    cancelBtn.onclick = () => {
      exitBoundsEditMode(true);
    };
  }

  renderBoundsEditorPolygon();
}

function exitBoundsEditMode(discardChanges) {
  if (!boundsEditMode) return;
  boundsEditMode = false;
  boundsWorkingPolygon = discardChanges ? null : boundsWorkingPolygon;

  const root = document.body;
  root.classList.remove("bounds-editor-active");

  const toolbar = document.getElementById("boundsToolbar");
  if (toolbar) {
    toolbar.style.display = "none";
  }

  const svg = document.getElementById("boundsEditorOverlay");
  if (svg) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }
}

async function handleBoundsApply() {
  if (!boundsWorkingPolygon || boundsWorkingPolygon.length < 3) {
    alert("Bounds polygon must have at least 3 vertices.");
    return;
  }

  if (typeof OTEFDataContext === "undefined") {
    console.warn("[Projection] OTEFDataContext not available; cannot save bounds");
    return;
  }

  try {
    const result = await OTEFDataContext.saveBounds(boundsWorkingPolygon);
    if (!result || !result.ok) {
      console.error("[Projection] Failed to save bounds:", result && result.error);
      alert("Failed to save bounds. See console for details.");
      return;
    }
    exitBoundsEditMode(false);
  } catch (err) {
    console.error("[Projection] Error while saving bounds:", err);
    alert("Error while saving bounds. See console for details.");
  }
}

function toggleBoundsEditMode() {
  if (boundsEditMode) {
    exitBoundsEditMode(true);
  } else {
    enterBoundsEditMode();
  }
}

/**
 * Initialize layers - create Canvas renderer and load default layers
 */
async function initializeLayers() {
  if (!modelBounds) {
    console.error("Cannot initialize layers: model bounds not loaded");
    return;
  }

  // Create Canvas renderer (replaces SVG for performance)
  try {
    canvasRenderer = new CanvasLayerRenderer("displayContainer");
    console.log("[Projection] Canvas layer renderer created");

    // Update canvas position now
    const displayBounds = getDisplayedImageBounds();
    if (displayBounds) {
      canvasRenderer.updatePosition(displayBounds, modelBounds);
    }
  } catch (error) {
    console.error("[Projection] Failed to create Canvas renderer:", error);
    return;
  }

  // Initialize layer registry if available
  if (typeof layerRegistry !== 'undefined') {
    await layerRegistry.init();

    // Load layers from new layer groups system
    if (layerRegistry._initialized) {
      await loadProjectionLayerGroups();

      // Now that layerRegistry is initialized, sync with current state from OTEFDataContext
      // This handles the case where OTEFDataContext loaded state before layerRegistry was ready
      if (typeof OTEFDataContext !== 'undefined') {
        const currentLayerGroups = OTEFDataContext.getLayerGroups();
        if (currentLayerGroups) {
          // Sync layer groups after registry init
          syncLayerGroupsFromState(currentLayerGroups);
        }
      }
    }
  }

  // Set default layer states (roads on, others off)
  layerState.roads = true;
  layerState.parcels = false;
  layerState.model = false;

  // Parallel loading for initial legacy layers
  const tableName = window.tableSwitcher?.getCurrentTable() || 'otef';
  const apiUrl = `/api/actions/get_otef_layers/?table=${tableName}`;

  fetch(apiUrl)
    .then(res => {
      if (!res.ok) throw new Error("Failed to load layer config");
      return res.json();
    })
    .then(layers => {
       // Load roads layer immediately (it's default visible)
       loadRoadsLayer(layers.find(l => l.name === 'roads')).catch((error) => {
         console.error("[Projection] Failed to load roads layer on init:", error);
       });
    })
    .catch(err => {
       console.error("[Projection] Failed to fetch initial layer config:", err);
       // Fallback to legacy single load
       loadRoadsLayer().catch((error) => {
         console.error("[Projection] Failed to load roads layer on init:", error);
       });
    });

  // Set model image visibility to match default state
  const img = document.getElementById("displayedImage");
  if (img) {
    img.style.opacity = layerState.model ? "1" : "0";
  }
}

/**
 * Load all layers from the new layer groups system for projection display.
 */
async function loadProjectionLayerGroups() {
  if (!layerRegistry || !layerRegistry._initialized) {
    console.warn("[Projection] Layer registry not initialized");
    return;
  }

  const groups = layerRegistry.getGroups();
  // Log only in debug mode
  // console.log(`[Projection] Found ${groups.length} layer group(s)`);

  // Load all layers from all groups
  for (const group of groups) {
    for (const layer of group.layers || []) {
      const fullLayerId = `${group.id}.${layer.id}`;
      await loadProjectionLayerFromRegistry(fullLayerId);
    }
  }

  // Removed verbose log - layers loaded silently unless error
}

/**
 * Load a single layer from the layer registry for projection display.
 * @param {string} fullLayerId - Full layer ID (e.g., "map_3_future.mimushim")
 */
async function loadProjectionLayerFromRegistry(fullLayerId) {
  if (loadedLayers[fullLayerId]) {
    return;
  }

  const layerConfig = layerRegistry.getLayerConfig(fullLayerId);
  if (!layerConfig) {
    console.warn(`[Projection] Layer config not found: ${fullLayerId}`);
    return;
  }

  try {
    // Projection always uses GeoJSON (PMTiles not supported in Canvas renderer)

    const dataUrl = layerRegistry.getLayerDataUrl(fullLayerId);
    if (!dataUrl) {
      console.warn(`[Projection] No GeoJSON data URL for layer: ${fullLayerId}`);
      return;
    }

    const response = await fetch(dataUrl);
    if (!response.ok) {
      throw new Error(`Failed to load layer data: ${response.status}`);
    }

    let geojson = await response.json();

    // Check CRS and transform from WGS84 to ITM if needed
    // Projection canvas expects ITM coordinates to match model bounds
    const crs = geojson.crs?.properties?.name || '';
    if (crs.includes('4326') || crs.includes('WGS')) {
      geojson = CoordUtils.transformGeojsonToItm(geojson);
    } else if (!crs || crs === '') {
      // No CRS specified - check if coordinates look like WGS84 (small values) vs ITM (large values)
      const firstCoord = getFirstCoordinate(geojson);
      if (firstCoord && Math.abs(firstCoord[0]) < 180 && Math.abs(firstCoord[1]) < 90) {
        geojson = CoordUtils.transformGeojsonToItm(geojson);
      }
    }

    // Get canvas style function from StyleApplicator
    const canvasStyleFunction = StyleApplicator.getCanvasStyle(layerConfig);

    // Render layer using Canvas renderer
    await renderLayerFromGeojson(geojson, fullLayerId, canvasStyleFunction);
  } catch (error) {
    console.error(`[Projection] Error loading layer ${fullLayerId}:`, error);
  }
}

/**
 * Extract the first coordinate from a GeoJSON to detect CRS
 * @param {Object} geojson - GeoJSON object
 * @returns {Array|null} First coordinate [x, y] or null
 */
function getFirstCoordinate(geojson) {
  if (!geojson.features || geojson.features.length === 0) return null;

  for (const feature of geojson.features) {
    if (!feature.geometry || !feature.geometry.coordinates) continue;

    let coords = feature.geometry.coordinates;
    // Drill down to find a coordinate pair
    while (Array.isArray(coords) && Array.isArray(coords[0])) {
      coords = coords[0];
    }
    if (Array.isArray(coords) && typeof coords[0] === 'number') {
      return coords;
    }
  }
  return null;
}

/**
 * Sync layer groups state for projection display.
 *
 * Note: group.enabled acts as a "toggle all" shortcut, not a gate.
 * Individual layers can be shown/hidden regardless of group.enabled state.
 */
function syncLayerGroupsFromState(layerGroups) {
  if (!layerGroups || !Array.isArray(layerGroups)) {
    console.warn("[Projection] Invalid layer groups state");
    return;
  }

  // Guard against race condition: layerRegistry must be initialized before syncing
  if (typeof layerRegistry === 'undefined' || !layerRegistry._initialized) {
    return;
  }

  // Process each group - individual layer.enabled is the source of truth for visibility
  for (const group of layerGroups) {
    for (const layer of group.layers || []) {
      const fullLayerId = `${group.id}.${layer.id}`;

      if (layer.enabled) {
        // Layer should be visible - load if needed, then show
        if (!loadedLayers[fullLayerId]) {
          loadProjectionLayerFromRegistry(fullLayerId).then(() => {
            updateLayerVisibility(fullLayerId, true);
          }).catch(err => {
            console.error(`[Projection] Failed to load layer ${fullLayerId}:`, err);
          });
        } else {
          updateLayerVisibility(fullLayerId, true);
        }
      } else {
        // Layer is disabled, hide it
        updateLayerVisibility(fullLayerId, false);
      }
    }
  }
}

/**
 * Load and render roads layer
 */
async function loadRoadsLayer(layerConfig) {
  try {
      const tableName = window.tableSwitcher?.getCurrentTable() || 'otef';
      const result = layerConfig
        ? { geojson: await loadGeojsonFromConfig(layerConfig) }
        : await loadLayerGeojson(tableName, 'roads');

      if (!result || !result.geojson) {
        console.warn('[Projection] Roads layer not found in database');
        return;
      }

      await renderLayerFromGeojson(result.geojson, 'roads', getRoadStyle);
  } catch (error) {
    console.error("Error loading roads layer from database:", error);
    throw error;
  }
}

/**
 * Helper function to render a layer from GeoJSON using Canvas
 */
async function renderLayerFromGeojson(geojson, layerName, styleFunction) {
  const displayBounds = getDisplayedImageBounds();
  if (!displayBounds) {
    throw new Error("Display bounds not available");
  }

  // Store for Canvas renderer (raw ITM coordinates, Canvas does transformation)
  loadedLayers[layerName] = {
    originalGeojson: geojson,
    styleFunction: styleFunction,
  };

  // Add layer to Canvas renderer
  if (canvasRenderer) {
    canvasRenderer.setLayer(layerName, geojson, styleFunction);
    canvasRenderer.updatePosition(displayBounds, modelBounds);
    
    // For registry layers (fullLayerId format), check layerGroups state instead of legacy layerState
    // Legacy layers use simple names like 'roads', 'parcels' which are in layerState
    // Note: Individual layer.enabled is the source of truth, not group.enabled
    let shouldBeVisible = false;
    if (layerName.includes('.')) {
      // Registry layer - check individual layer.enabled state (not group.enabled)
      if (typeof OTEFDataContext !== 'undefined') {
        const layerGroups = OTEFDataContext.getLayerGroups();
        if (layerGroups) {
          const [groupId, layerId] = layerName.split('.');
          const group = layerGroups.find(g => g.id === groupId);
          if (group) {
            const layerStateObj = group.layers.find(l => l.id === layerId);
            shouldBeVisible = layerStateObj ? layerStateObj.enabled : false;
          }
        } else {
          // LayerGroups not loaded yet, default to hidden (state will update when loaded)
          shouldBeVisible = false;
        }
      } else {
        // OTEFDataContext not available, default to hidden
        shouldBeVisible = false;
      }
    } else {
      // Legacy layer - use layerState
      shouldBeVisible = layerState[layerName] === true;
    }
    
    canvasRenderer.setLayerVisibility(layerName, shouldBeVisible);
  }

  // Layer loaded silently
}

/**
 * Load and render parcels layer (lazy load when enabled via WebSocket)
 */
async function loadParcelsLayer(layerConfig) {
  // Check if already loaded
  if (loadedLayers.parcels) {
    updateLayerVisibility("parcels", layerState.parcels);
    return;
  }

  // Loading parcels layer

  try {
    const tableName = window.tableSwitcher?.getCurrentTable() || 'otef';
    const result = layerConfig
      ? { geojson: await loadGeojsonFromConfig(layerConfig) }
      : await loadLayerGeojson(tableName, 'parcels');

    if (result && result.geojson) {
      const geojson = result.geojson;

      await renderLayerFromGeojson(geojson, 'parcels', getParcelStyle);

      // Initialize WebGL animator for parcels
      initializeParcelsAnimator(geojson);

      return;
    } else {
      throw new Error('Parcels layer not found in database');
    }
  } catch (error) {
    console.error("[Projection] Error loading parcels layer from database:", error);
    throw error;
  }
}

/**
 * Initialize the WebGL animator for parcels
 */
function initializeParcelsAnimator(geojson) {
  if (!window.ParcelAnimator) {
    console.warn("[Projection] ParcelAnimator not available, animation disabled");
    return;
  }

  const container = document.getElementById('displayContainer');
  if (!container || !modelBounds) {
    console.warn("[Projection] Cannot initialize animator: missing container or bounds");
    return;
  }

  try {
    parcelAnimator = new ParcelAnimator(container);

    const displayBounds = getDisplayedImageBounds();
    if (displayBounds) {
      parcelAnimator.updatePosition(displayBounds, modelBounds);
      parcelAnimator.setPolygonData(geojson, getParcelStyle, modelBounds, displayBounds);
    }

    // Parcel animator initialized

    // Check if animation should be running (from initial API state)
    if (animationState.parcels) {
      // Starting pending animation after initialization

      // Hide static parcels layer
      if (canvasRenderer) {
        canvasRenderer.setLayerVisibility('parcels', false);
      }

      parcelAnimator.start();
    }
  } catch (error) {
    console.error("[Projection] Failed to initialize parcel animator:", error);
  }
}

/**
 * Load and render major roads layer (road-big.geojson)
 * Data is in EPSG:2039, same as model bounds
 */
async function loadMajorRoadsLayer(layerConfig) {
  if (loadedLayers.majorRoads) {
    updateLayerVisibility("majorRoads", layerState.majorRoads);
    return;
  }

  // Loading major roads layer

  try {
    const tableName = window.tableSwitcher?.getCurrentTable() || 'otef';
    const result = layerConfig
      ? { geojson: await loadGeojsonFromConfig(layerConfig) }
      : await loadLayerGeojson(tableName, 'majorRoads');

    if (!result || !result.geojson) {
      console.warn("[Projection] Major roads layer not found in database");
      return;
    }

    const geojson = result.geojson;

    await renderLayerFromGeojson(geojson, 'majorRoads', getMajorRoadStyle);
  } catch (error) {
    console.error("[Projection] Error loading major roads layer:", error);
  }
}

/**
 * Load and render small roads layer (Small-road-limited.geojson)
 * Data is in WGS84 (lat/lon), but we render in ITM space - Canvas handles it
 */
async function loadSmallRoadsLayer() {
  if (loadedLayers.smallRoads) {
    updateLayerVisibility("smallRoads", layerState.smallRoads);
    return;
  }

  // Loading small roads layer

  try {
    const tableName = window.tableSwitcher?.getCurrentTable() || 'otef';
    const result = await loadLayerGeojson(tableName, 'smallRoads');

    if (!result || !result.geojson) {
      console.warn("[Projection] Small roads layer not found in database");
      return;
    }

    const geojson = result.geojson;

    await renderLayerFromGeojson(geojson, 'smallRoads', getSmallRoadStyle);
  } catch (error) {
    console.error("[Projection] Error loading small roads layer:", error);
  }
}

/**
 * Handle layer update from WebSocket
 */
function handleLayerUpdate(msg) {
  if (!validateLayerUpdate(msg)) {
    console.warn("[Projection] Invalid layer update message:", msg);
    return;
  }

  // Removed verbose log for layer update

  const layers = msg.layers;

  // Update roads layer (lazy load if needed)
  if (layers.roads !== undefined && layers.roads !== layerState.roads) {
    layerState.roads = layers.roads;
    if (layers.roads && !loadedLayers.roads) {
      // Load roads layer if not already loaded
      loadRoadsLayer().catch((error) => {
        console.error("[Projection] Failed to load roads layer:", error);
      });
    } else {
      updateLayerVisibility("roads", layers.roads);
    }
  }

  // Update parcels layer (lazy load if needed)
  if (layers.parcels !== undefined && layers.parcels !== layerState.parcels) {
    layerState.parcels = layers.parcels;
    if (layers.parcels && !loadedLayers.parcels) {
      // Load parcels layer if not already loaded
      loadParcelsLayer();
    } else {
      updateLayerVisibility("parcels", layers.parcels);

      // If parcels layer is hidden, stop animation
      if (!layers.parcels && animationState.parcels && parcelAnimator) {
        parcelAnimator.stop();
        animationState.parcels = false;
      }
    }
  }

  // Update model base layer (image visibility)
  if (layers.model !== undefined && layers.model !== layerState.model) {
    layerState.model = layers.model;
    const img = document.getElementById("displayedImage");
    if (img) {
      img.style.opacity = layers.model ? "1" : "0";
    }
  }

  // Update major roads layer (lazy load if needed)
  if (layers.majorRoads !== undefined && layers.majorRoads !== layerState.majorRoads) {
    layerState.majorRoads = layers.majorRoads;
    if (layers.majorRoads && !loadedLayers.majorRoads) {
      loadMajorRoadsLayer();
    } else {
      updateLayerVisibility("majorRoads", layers.majorRoads);
    }
  }

  // Update small roads layer (lazy load if needed)
  if (layers.smallRoads !== undefined && layers.smallRoads !== layerState.smallRoads) {
    layerState.smallRoads = layers.smallRoads;
    if (layers.smallRoads && !loadedLayers.smallRoads) {
      loadSmallRoadsLayer();
    } else {
      updateLayerVisibility("smallRoads", layers.smallRoads);
    }
  }
}

/**
 * Handle animation toggle from WebSocket (supports both legacy and new format)
 */
function handleAnimationToggle(msg) {
  // Validate basic structure (layerId and enabled must exist)
  if (typeof msg.layerId !== 'string' || typeof msg.enabled !== 'boolean') {
    console.warn("[Projection] Invalid animation toggle message:", msg);
    return;
  }

  // Removed verbose log for animation toggle

  if (msg.layerId === 'parcels') {
    animationState.parcels = msg.enabled;

    if (msg.enabled) {
      // Start animation - hide static canvas, show WebGL
      if (parcelAnimator) {
        // Ensure animator has latest data and position
        const displayBounds = getDisplayedImageBounds();
        if (displayBounds && modelBounds) {
          parcelAnimator.updatePosition(displayBounds, modelBounds);
        }

        // Hide static parcels layer, show animated version
        if (canvasRenderer) {
          canvasRenderer.setLayerVisibility('parcels', false);
        }
        parcelAnimator.start();
        // Parcel animation started
      } else {
        console.warn("[Projection] Cannot start animation: animator not initialized");
      }
    } else {
      // Stop animation - show static canvas, hide WebGL
      if (parcelAnimator) {
        parcelAnimator.stop();
      }
      if (canvasRenderer && layerState.parcels) {
        canvasRenderer.setLayerVisibility('parcels', true);
      }
      // Parcel animation stopped
    }
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
