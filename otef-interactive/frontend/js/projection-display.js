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
  })
  .catch((error) => {
    console.error("Error loading model bounds:", error);
  });

// WebSocket client instance
let wsClient = null;

// Layer state tracking
let layerState = {
  roads: true,
  parcels: false,
  model: false,
};

function setDebugStatus(status) {
  if (window.DebugOverlay) window.DebugOverlay.setWebSocketStatus(status);
}

function connectWebSocket() {
  wsClient = new OTEFWebSocketClient("/ws/otef/", {
    onConnect: () => {
      console.log("[Projection] WebSocket connected");
      setDebugStatus("connected");

      // Request current state from remote controller
      requestCurrentState();

      // Retry loading roads layer if it failed during init (server might be ready now)
      if (layerState.roads && !loadedLayers.roads) {
        console.log("[Projection] Retrying roads layer load after WebSocket connection");
        loadRoadsLayer().catch((error) => {
          console.error("[Projection] Failed to load roads layer after retry:", error);
        });
      }
    },
    onDisconnect: () => {
      console.log("[Projection] WebSocket disconnected");
      setDebugStatus("disconnected");
    },
    onError: (error) => {
      console.error("[Projection] WebSocket error:", error);
      setDebugStatus("error");
    },
  });

  // Handle STATE_RESPONSE - sync initial state
  wsClient.on(OTEF_MESSAGE_TYPES.STATE_RESPONSE, handleStateResponse);

  // Listen for viewport updates
  wsClient.on(OTEF_MESSAGE_TYPES.VIEWPORT_UPDATE, (msg) => {
    if (!validateViewportUpdate(msg)) {
      console.warn("[Projection] Invalid viewport update message:", msg);
      return;
    }

    if (msg.corners) {
      updateHighlightQuad(msg.corners);
    } else if (msg.bbox) {
      updateHighlightRect(msg.bbox);
    }
  });

  // Listen for layer updates (from remote controller)
  wsClient.on(OTEF_MESSAGE_TYPES.LAYER_UPDATE, handleLayerUpdate);

  // Connect
  wsClient.connect();
}

/**
 * Request current state from remote controller
 */
function requestCurrentState() {
  if (!wsClient || !wsClient.getConnected()) return;

  const request = createStateRequestMessage();
  wsClient.send(request);
  console.log("[Projection] State request sent");
}

/**
 * Handle STATE_RESPONSE - sync initial state
 */
function handleStateResponse(msg) {
  if (!validateStateResponse(msg)) {
    console.warn("[Projection] Invalid state response:", msg);
    return;
  }

  console.log("[Projection] Received state response, syncing...");

  // Sync viewport highlight
  if (msg.viewport) {
    if (msg.viewport.corners) {
      updateHighlightQuad(msg.viewport.corners);
    } else if (msg.viewport.bbox) {
      updateHighlightRect(msg.viewport.bbox);
    }
  }

  // Sync layers
  if (msg.layers) {
    // Update layer visibility to match state
    if (msg.layers.roads !== undefined && msg.layers.roads !== layerState.roads) {
      layerState.roads = msg.layers.roads;
      if (msg.layers.roads && !loadedLayers.roads) {
        // Load roads layer if not already loaded
        loadRoadsLayer().catch((error) => {
          console.error("[Projection] Failed to load roads layer:", error);
        });
      } else {
        updateLayerVisibility("roads", msg.layers.roads);
      }
    }

    if (msg.layers.parcels !== undefined && msg.layers.parcels !== layerState.parcels) {
      layerState.parcels = msg.layers.parcels;
      if (msg.layers.parcels && !loadedLayers.parcels) {
        // Load parcels layer if not already loaded
        loadParcelsLayer();
      } else {
        updateLayerVisibility("parcels", msg.layers.parcels);
      }
    }

    if (msg.layers.model !== undefined && msg.layers.model !== layerState.model) {
      layerState.model = msg.layers.model;
      const img = document.getElementById("displayedImage");
      if (img) {
        img.style.opacity = msg.layers.model ? "1" : "0";
      }
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

  const pctX = Math.max(
    0,
    Math.min(1, (x - modelBounds.west) / (modelBounds.east - modelBounds.west))
  );
  const pctY = Math.max(
    0,
    Math.min(
      1,
      (modelBounds.north - y) / (modelBounds.north - modelBounds.south)
    )
  );

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
    box.style.cssText =
      "position: absolute; border: 3px solid rgba(0, 255, 255, 0.9); background: rgba(0, 255, 255, 0.15); box-shadow: 0 0 30px rgba(0, 255, 255, 0.8), inset 0 0 30px rgba(0, 255, 255, 0.4); pointer-events: none; transition: left 0.15s ease-out, top 0.15s ease-out, width 0.15s ease-out, height 0.15s ease-out;";
    overlay.querySelector("svg")?.remove();
    overlay.appendChild(box);
  }
  return box;
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

  const box = getOrCreateHighlightBox();
  const minPX = Math.min(sw_px.x, nw_px.x, se_px.x, ne_px.x);
  const maxPX = Math.max(sw_px.x, nw_px.x, se_px.x, ne_px.x);
  const minPY = Math.min(sw_px.y, nw_px.y, se_px.y, ne_px.y);
  const maxPY = Math.max(sw_px.y, nw_px.y, se_px.y, ne_px.y);
  box.style.left = minPX + "px";
  box.style.top = minPY + "px";
  box.style.width = maxPX - minPX + "px";
  box.style.height = maxPY - minPY + "px";
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

  const box = getOrCreateHighlightBox();
  box.style.left = sw_px.x + "px";
  box.style.top = ne_px.y + "px";
  box.style.width = ne_px.x - sw_px.x + "px";
  box.style.height = sw_px.y - ne_px.y + "px";
}

let lastMessage = null;

// Debounce resize handler
let resizeTimeout;
function handleResize() {
  if (lastMessage?.corners) updateHighlightQuad(lastMessage.corners);
  else if (lastMessage?.bbox) updateHighlightRect(lastMessage.bbox);

  // Update SVG overlay position and re-render layers
  if (svgOverlay && modelBounds) {
    const displayBounds = getDisplayedImageBounds();
    if (displayBounds) {
      updateSVGPosition(svgOverlay, displayBounds, modelBounds, loadedLayers);
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

/**
 * Initialize layers - create Canvas renderer and load default layers
 */
function initializeLayers() {
  if (!modelBounds) {
    console.error("Cannot initialize layers: model bounds not loaded");
    return;
  }

  // Create Canvas renderer (replaces SVG for performance)
  try {
    canvasRenderer = new CanvasLayerRenderer("displayContainer");
    console.log("Canvas layer renderer created");

    // Update canvas position now
    const displayBounds = getDisplayedImageBounds();
    if (displayBounds) {
      canvasRenderer.updatePosition(displayBounds, modelBounds);
    }
  } catch (error) {
    console.error("Failed to create Canvas renderer:", error);
    return;
  }

  // Set default layer states (roads on, others off)
  layerState.roads = true;
  layerState.parcels = false;
  layerState.model = false;

  // Load roads layer (enabled by default, matching DEFAULT_LAYER_STATES)
  loadRoadsLayer().catch((error) => {
    console.error("[Projection] Failed to load roads layer on init:", error);
  });

  // Set model image visibility to match default state
  const img = document.getElementById("displayedImage");
  if (img) {
    img.style.opacity = layerState.model ? "1" : "0";
  }
}

/**
 * Load and render roads layer
 */
async function loadRoadsLayer() {
  const tableName = window.tableSwitcher?.getCurrentTable() || 'otef';
  const apiUrl = `/api/actions/get_otef_layers/?table=${tableName}`;

  try {
    // Try loading from database first
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Failed to load layers: ${response.status}`);
    }

    const layers = await response.json();
    const roadsLayer = layers.find(l => l.name === 'roads');

    if (roadsLayer) {
      let geojson;
      if (roadsLayer.geojson) {
        geojson = roadsLayer.geojson;
      } else if (roadsLayer.url) {
        const geojsonResponse = await fetch(roadsLayer.url);
        if (!geojsonResponse.ok) throw new Error('Failed to load layer data');
        geojson = await geojsonResponse.json();
      } else {
        throw new Error('Layer has no data source');
      }

      await renderLayerFromGeojson(geojson, 'roads', getRoadStyle);
      return;
    } else {
      throw new Error('Roads layer not found in database');
    }
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
    canvasRenderer.setLayerVisibility(layerName, layerState[layerName]);
  }

  console.log(`${layerName} layer loaded and rendered (Canvas)`);
}

/**
 * Load and render parcels layer (lazy load when enabled via WebSocket)
 */
async function loadParcelsLayer() {
  // Check if already loaded
  if (loadedLayers.parcels) {
    updateLayerVisibility("parcels", layerState.parcels);
    return;
  }

  console.log("[Projection] Loading parcels layer...");

  const tableName = window.tableSwitcher?.getCurrentTable() || 'otef';
  const apiUrl = `/api/actions/get_otef_layers/?table=${tableName}`;

  try {
    // Try loading from database first
    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Failed to load layers: ${response.status}`);
    }

    const layers = await response.json();
    const parcelsLayer = layers.find(l => l.name === 'parcels');

    if (parcelsLayer) {
      let geojson;
      if (parcelsLayer.geojson) {
        geojson = parcelsLayer.geojson;
      } else if (parcelsLayer.url) {
        const geojsonResponse = await fetch(parcelsLayer.url);
        if (!geojsonResponse.ok) throw new Error('Failed to load layer data');
        geojson = await geojsonResponse.json();
      } else {
        throw new Error('Layer has no data source');
      }

      await renderLayerFromGeojson(geojson, 'parcels', getParcelStyle);
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
 * Handle layer update from WebSocket
 */
function handleLayerUpdate(msg) {
  if (!validateLayerUpdate(msg)) {
    console.warn("[Projection] Invalid layer update message:", msg);
    return;
  }

  console.log("[Projection] Received layer update:", msg);

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
}

// Connect on load
connectWebSocket();

// Show help for 3 seconds on load
setTimeout(() => {
  const instructions = document.getElementById("instructions");
  instructions.classList.remove("hidden");
  setTimeout(() => {
    instructions.classList.add("hidden");
  }, 3000);
}, 500);
