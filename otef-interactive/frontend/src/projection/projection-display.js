// OTEF Projection Display - Simplified for TouchDesigner integration
// Warping/calibration is handled by TouchDesigner, not by this page

import {
  configure as configureLayerManager,
  initializeLayers,
  syncLayerGroupsFromState,
  handleResize as layerManagerResize,
  requestAnimationFrameForAnimations,
  reloadProjectionCuratedLayersFromSupabase,
} from "./projection-layer-manager.js";
import { startCuratedSupabaseHeartbeat } from "../shared/curated-supabase-heartbeat.js";

function projectionReloadOptsFromCuratedPayload(detail) {
  const d =
    detail && typeof detail === "object" ? detail : {};
  const raw = d.affected_curated_full_layer_ids;
  const ids = Array.isArray(raw)
    ? raw.filter((id) => typeof id === "string" && id.length > 0)
    : [];
  return ids.length > 0 ? { affectedCuratedFullLayerIds: ids } : {};
}

if (typeof window !== "undefined") {
  window.addEventListener("otef-curated-geojson-refresh", (ev) => {
    if (typeof reloadProjectionCuratedLayersFromSupabase !== "function") {
      return;
    }
    const opts = projectionReloadOptsFromCuratedPayload(ev && ev.detail);
    void reloadProjectionCuratedLayersFromSupabase(opts);
  });
}

// Load model bounds
let modelBounds;

fetch("data/model-bounds.json")
  .then((res) => res.json())
  .then((bounds) => {
    modelBounds = bounds;

    // Configure helpers and initialize layers after model bounds are loaded
    configureLayerManager({
      getModelBounds: () => modelBounds,
      getDisplayedImageBounds
    });
    initializeLayers();

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
          setHighlightOverlayVisibilityFromZoom(initialViewport.zoom);
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
            setHighlightOverlayVisibilityFromZoom(viewport.zoom);
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
        if (initialLayerGroups && initialLayerGroups.length > 0) {
          syncLayerGroupsFromState(initialLayerGroups);
        }

        window._otefUnsubscribeFunctions.push(
          OTEFDataContext.subscribe('layerGroups', () => {
            const effective =
              typeof LayerStateHelper !== "undefined" && typeof LayerStateHelper.getEffectiveLayerGroups === "function"
                ? LayerStateHelper.getEffectiveLayerGroups()
                : OTEFDataContext.getLayerGroups();
            if (effective && effective.length > 0) {
              syncLayerGroupsFromState(effective);
            }
          })
        );

        window._otefUnsubscribeFunctions.push(
          OTEFDataContext.subscribe("animations", () => {
            requestAnimationFrameForAnimations();
          }),
        );

        const stopCuratedHeartbeat = startCuratedSupabaseHeartbeat({
          table: TABLE_NAME,
          onUpdated: async (pullPayload) => {
            const opts = projectionReloadOptsFromCuratedPayload(
              pullPayload && typeof pullPayload === "object" ? pullPayload : {},
            );
            await reloadProjectionCuratedLayersFromSupabase(opts);
            window.dispatchEvent(
              new CustomEvent("nur-curated-supabase-pull", {
                detail: { source: "projection" },
              }),
            );
          },
        });
        window._otefUnsubscribeFunctions.push(() => {
          stopCuratedHeartbeat();
        });

      });
    }
  })
  .catch((error) => {
    console.error("Error loading model bounds:", error);
  });

// Table name for state management
const TABLE_NAME = 'otef';

// Viewport highlight: hidden at zoom 10 & 11 (covers whole map), visible from 12+
const HIGHLIGHT_VISIBLE_MIN_ZOOM = 12;

function setHighlightOverlayVisibilityFromZoom(zoom) {
  const overlay = document.getElementById("highlightOverlay");
  if (!overlay) return;
  const visible =
    zoom == null || (typeof zoom === "number" && zoom >= HIGHLIGHT_VISIBLE_MIN_ZOOM);
  overlay.style.visibility = visible ? "" : "hidden";
}

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
    overlay.querySelector("svg")?.remove();
    overlay.appendChild(box);

    // Direction marker: visible in rotation edit mode to make angle calibration
    // obvious even when viewport shape is near-square.
    const heading = document.createElement("div");
    heading.className = "highlight-angle-indicator";
    heading.style.cssText =
      "position:absolute;left:50%;top:8%;width:3px;height:38%;background:rgba(255,200,0,0.95);box-shadow:0 0 10px rgba(255,200,0,0.8);transform:translateX(-50%);display:none;";
    box.appendChild(heading);
  }
  return box;
}

let targetHighlight = { x: 0, y: 0, w: 0, h: 0 };
if (typeof window !== "undefined") {
  if (typeof window.rotationEditModeActive === "undefined") {
    window.rotationEditModeActive = false;
  }
  if (typeof window.rotationPreviewAngleDeg === "undefined") {
    window.rotationPreviewAngleDeg = 0;
  }
}

function getHighlightAngleDeg(state) {
  const isEditMode = !!(state && state.isEditMode);
  const preview = state && state.previewAngleDeg;
  if (!isEditMode) return 0;
  if (typeof preview !== "number" || Number.isNaN(preview)) return 0;
  return preview;
}

function applyHighlightPosition(box) {
  const heading = box.querySelector(".highlight-angle-indicator");
  const t = targetHighlight;
  box.style.width = t.w + "px";
  box.style.height = t.h + "px";
  box.style.transformOrigin = "center center";
  const angle = getHighlightAngleDeg({
    isEditMode:
      typeof window !== "undefined" && !!window.rotationEditModeActive,
    previewAngleDeg:
      typeof window !== "undefined" ? window.rotationPreviewAngleDeg : 0,
  });
  box.style.transform =
    "translate(" + t.x + "px, " + t.y + "px) rotate(" + angle + "deg)";
  if (heading) {
    const editModeActive =
      typeof window !== "undefined" && !!window.rotationEditModeActive;
    heading.style.display = editModeActive ? "block" : "none";
  }
}

function refreshHighlightPositionIfReady() {
  const overlay = document.getElementById("highlightOverlay");
  const box = overlay && overlay.querySelector(".highlight-box");
  if (!box) return;
  applyHighlightPosition(box);
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
  const box = getOrCreateHighlightBox();
  applyHighlightPosition(box);
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

  targetHighlight = {
    x: sw_px.x,
    y: ne_px.y,
    w: ne_px.x - sw_px.x,
    h: sw_px.y - ne_px.y
  };
  const box = getOrCreateHighlightBox();
  applyHighlightPosition(box);
}

let lastMessage = null;

if (typeof window !== "undefined") {
  window.addEventListener("otef-rotation-preview-updated", () => {
    refreshHighlightPositionIfReady();
  });
}

// Debounce resize handler
let resizeTimeout;
function handleResize() {
  if (lastMessage?.corners) updateHighlightQuad(lastMessage.corners);
  else if (lastMessage?.bbox) updateHighlightRect(lastMessage.bbox);

  // Update canvas renderer position on resize
  layerManagerResize();
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
