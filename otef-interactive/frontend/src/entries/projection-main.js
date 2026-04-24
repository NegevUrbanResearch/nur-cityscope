import TableSwitcher from "../shared/table-switcher.js";
import TableSwitcherPopup from "../shared/table-switcher-popup.js";
import {
  createProjectionMap,
  updateProjectionViewport,
  updateHighlightFromViewport,
} from "../projection/maplibre-projection.js";
import { syncProjectionLayers } from "../projection/maplibre-projection-layers.js";
import OTEFDataContext from "../shared/OTEFDataContext.js";
import layerRegistry from "../shared/layer-registry.js";

function getEffectiveProjectionLayerGroups() {
  if (
    typeof window !== "undefined" &&
    window.LayerStateHelper &&
    typeof window.LayerStateHelper.getEffectiveLayerGroups === "function"
  ) {
    return window.LayerStateHelper.getEffectiveLayerGroups();
  }
  return OTEFDataContext.getLayerGroups();
}

function toggleProjectionFullscreen() {
  const doc = window.document;
  const docElement = doc.documentElement;
  const requestFullScreen =
    docElement.requestFullscreen ||
    docElement.mozRequestFullScreen ||
    docElement.webkitRequestFullscreen ||
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
    if (typeof requestFullScreen === "function") {
      requestFullScreen.call(docElement);
    }
  } else if (typeof cancelFullScreen === "function") {
    cancelFullScreen.call(doc);
  }
}

async function bootstrapProjectionRuntime() {
  const modules = [
    "../shared/logger.js",
    "../shared/map-projection-config.js",
    "../shared/animation-runtime.js",
    "../shared/message-protocol.js",
    "../shared/websocket-client.js",
    "../shared/api-client.js",
    "../shared/layer-state-helper.js",
    "../shared/otef-data-context/index.js",
    "../shared/otef-data-context/OTEFDataContext-actions.js",
    "../shared/otef-data-context/OTEFDataContext-bounds.js",
    "../shared/otef-data-context/OTEFDataContext-websocket.js",
  ];

  for (const mod of modules) {
    await import(mod);
  }

  await OTEFDataContext.init("otef");
  await layerRegistry.init();

  const boundsResp = await fetch("data/model-bounds.json");
  if (!boundsResp.ok) {
    throw new Error(`Failed to load model-bounds.json (${boundsResp.status})`);
  }
  const modelBoundsData = await boundsResp.json();

  const itmBounds = {
    west: modelBoundsData.west ?? modelBoundsData.bounds?.west,
    south: modelBoundsData.south ?? modelBoundsData.bounds?.south,
    east: modelBoundsData.east ?? modelBoundsData.bounds?.east,
    north: modelBoundsData.north ?? modelBoundsData.bounds?.north,
  };
  if (
    !Number.isFinite(itmBounds.west) ||
    !Number.isFinite(itmBounds.south) ||
    !Number.isFinite(itmBounds.east) ||
    !Number.isFinite(itmBounds.north)
  ) {
    throw new Error("model-bounds.json missing valid ITM bounds");
  }

  const sw = proj4("EPSG:2039", "EPSG:4326", [itmBounds.west, itmBounds.south]);
  const ne = proj4("EPSG:2039", "EPSG:4326", [itmBounds.east, itmBounds.north]);
  const modelBounds = {
    bounds: [sw, ne],
    center: [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2],
    zoom: 12,
    bearing: modelBoundsData.viewer_angle_deg || 0,
    itm: itmBounds,
  };

  const modelImageUrl =
    modelBoundsData.model_image || layerRegistry.getLayerDataUrl("projector_base.model_base");
  const modelImgEl = document.getElementById("displayedImage");
  if (modelImgEl && modelImageUrl) {
    modelImgEl.src = modelImageUrl;
    modelImgEl.style.opacity = "1";
  }

  const map = createProjectionMap("projectionMap", modelBounds);
  const highlightEl = document.getElementById("highlightOverlay");
  let lastViewport = null;

  const disposers = [];
  const registerDisposer = (fn) => {
    if (typeof fn === "function") disposers.push(fn);
  };
  const cleanup = () => {
    while (disposers.length > 0) {
      const fn = disposers.pop();
      try {
        fn();
      } catch (error) {
        console.warn("[projection-main] disposer failed", error);
      }
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", cleanup, { once: true });
  }

  map.on("load", () => {
    syncProjectionLayers(map, getEffectiveProjectionLayerGroups());

    lastViewport = OTEFDataContext.getViewport();
    if (lastViewport) {
      updateProjectionViewport(map, lastViewport, modelBounds);
      updateHighlightFromViewport(lastViewport, modelBounds, highlightEl);
    }

    registerDisposer(
      OTEFDataContext.subscribe("layerGroups", () => {
        syncProjectionLayers(map, getEffectiveProjectionLayerGroups());
      }),
    );

    registerDisposer(
      OTEFDataContext.subscribe("viewport", (viewport) => {
        lastViewport = viewport;
        updateProjectionViewport(map, viewport, modelBounds);
        updateHighlightFromViewport(viewport, modelBounds, highlightEl);
      }),
    );
  });

  await import("../projection/projection-bounds-editor.js");
  await import("../projection/projection-rotation-editor.js");

  const getDisplayedImageBounds = () => {
    const container = document.getElementById("displayContainer");
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    return {
      offsetX: 0,
      offsetY: 0,
      width: rect.width,
      height: rect.height,
      containerWidth: rect.width,
      containerHeight: rect.height,
    };
  };

  const itmToDisplayPixels = (x, y) => {
    const bounds = getDisplayedImageBounds();
    if (!bounds) return null;
    const pctX = (x - itmBounds.west) / (itmBounds.east - itmBounds.west);
    const pctY = (itmBounds.north - y) / (itmBounds.north - itmBounds.south);
    return {
      x: bounds.offsetX + pctX * bounds.width,
      y: bounds.offsetY + pctY * bounds.height,
    };
  };

  if (window.ProjectionBoundsEditor) {
    window.ProjectionBoundsEditor.configure({
      getModelBounds: () => itmBounds,
      getDisplayedImageBounds,
      itmToDisplayPixels,
    });
  }

  if (window.ProjectionRotationEditor) {
    window.ProjectionRotationEditor.configure({
      getModelBounds: () => ({
        ...itmBounds,
        viewer_angle_deg: modelBoundsData.viewer_angle_deg || 0,
      }),
      getDisplayedImageBounds,
    });
  }

  let resizeTimer = null;
  const onResize = () => {
    if (resizeTimer) {
      window.clearTimeout(resizeTimer);
    }
    resizeTimer = window.setTimeout(() => {
      map.resize();
      if (lastViewport) {
        updateHighlightFromViewport(lastViewport, modelBounds, highlightEl);
      }
      resizeTimer = null;
    }, 120);
  };
  window.addEventListener("resize", onResize);
  registerDisposer(() => {
    if (resizeTimer) {
      window.clearTimeout(resizeTimer);
      resizeTimer = null;
    }
    window.removeEventListener("resize", onResize);
  });

  const onKeyDown = (event) => {
    if (event.defaultPrevented || event.repeat) return;
    const target = event.target;
    const targetTag = target?.tagName;
    if (
      targetTag === "INPUT" ||
      targetTag === "TEXTAREA" ||
      target?.isContentEditable
    ) {
      return;
    }

    const key = String(event.key || "").toLowerCase();
    if (key === "h") {
      const instructions = document.getElementById("instructions");
      if (instructions) instructions.classList.toggle("hidden");
      return;
    }
    if (key === "f") {
      toggleProjectionFullscreen();
      return;
    }
    if (key === "b" && window.ProjectionBoundsEditor) {
      window.ProjectionBoundsEditor.toggle();
      return;
    }
    if (key === "r" && window.ProjectionRotationEditor) {
      window.ProjectionRotationEditor.toggle();
    }
  };
  window.addEventListener("keydown", onKeyDown);
  registerDisposer(() => window.removeEventListener("keydown", onKeyDown));
}

function initializeTableSwitcher() {
  if (typeof TableSwitcher !== "function") {
    throw new Error("TableSwitcher constructor not available");
  }

  const tableSwitcher = new TableSwitcher({
    defaultTable: "otef",
    onTableChange: (tableName) => {
      if (tableName !== "otef") {
        window.location.href = `/projection/?table=${tableName}`;
      }
    },
  });

  window.tableSwitcher = tableSwitcher;

  if (tableSwitcher.getCurrentTable() !== "otef") {
    window.location.href = `/projection/?table=${tableSwitcher.getCurrentTable()}`;
    return false;
  }

  if (typeof TableSwitcherPopup === "function") {
    new TableSwitcherPopup(tableSwitcher);
  }

  return true;
}

async function boot() {
  const shouldContinue = initializeTableSwitcher();
  if (!shouldContinue) return;
  await bootstrapProjectionRuntime();
}

boot().catch((error) => console.error("[frontend-b] projection bootstrap failed", error));
