import TableSwitcher from "../shared/table-switcher.js";
import TableSwitcherPopup from "../shared/table-switcher-popup.js";
import { createProjectionMap, updateHighlightFromViewport } from "../projection/maplibre-projection.js";
import { installProjectionRenderDebugOverlay } from "../projection/projection-render-debug-overlay.js";
import { syncProjectionLayers } from "../projection/maplibre-projection-layers.js";
import {
  loadCuratedLayerToMapLibre,
  removeCuratedHtmlMarkers,
  syncPinkLineAxisCompanionForMapLibre,
} from "../map/maplibre-curated-layer-loader.js";
import { removeCuratedLayersByPrefix } from "../map/maplibre-layer-manager.js";
import {
  disposeRouteProgressOverlaysForMap,
  syncRouteProgressOverlaysToMap,
} from "../shared/maplibre-route-progress-overlay.js";
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

function updateModelBaseImageVisibility(layerGroups, modelImgEl) {
  if (!modelImgEl) return;
  const groups = Array.isArray(layerGroups)
    ? layerGroups
    : layerGroups && typeof layerGroups === "object"
      ? Object.values(layerGroups)
      : [];
  const projectorBase = groups.find((g) => g?.id === "projector_base");
  if (!projectorBase || projectorBase.enabled === false) {
    modelImgEl.style.opacity = "0";
    return;
  }
  const modelLayer = (projectorBase.layers || []).find((l) => l?.id === "model_base");
  const enabled = !!(modelLayer && modelLayer.enabled);
  modelImgEl.style.opacity = enabled ? "1" : "0";
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
    updateModelBaseImageVisibility(getEffectiveProjectionLayerGroups(), modelImgEl);
  }

  if (typeof document !== "undefined" && document.fonts && typeof document.fonts.load === "function") {
    try {
      await document.fonts.load("11px 'Guttman Hatzvi'");
    } catch (err) {
      console.warn("[projection-main] Guttman Hatzvi font preload failed; labels may flash", err);
    }
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

  const projectionRenderDebugApi = installProjectionRenderDebugOverlay({
    map,
    registerDisposer,
    initialVisible: false,
  });

  map.on("load", async () => {
    registerDisposer(() => {
      disposeRouteProgressOverlaysForMap(map);
    });

    const syncContextFlowAnimations = () => {
      const rawGroups = OTEFDataContext.getLayerGroups();
      const rawAsArray = Array.isArray(rawGroups) ? rawGroups : Object.values(rawGroups || {});
      const currentGroups = asLayerGroupsArray(getEffectiveProjectionLayerGroups());
      const anim =
        typeof OTEFDataContext.getAnimations === "function" ? OTEFDataContext.getAnimations() : {};
      void syncRouteProgressOverlaysToMap(map, anim, currentGroups, {
        visibilityLayerGroups: rawAsArray,
      });
    };
    registerDisposer(OTEFDataContext.subscribe("animations", syncContextFlowAnimations));

    let activeCuratedIds = new Set();

    function asLayerGroupsArray(raw) {
      if (Array.isArray(raw)) return raw;
      if (raw && typeof raw === "object") return Object.values(raw);
      return [];
    }

    function collectEnabledCuratedIds(groups) {
      const ids = [];
      for (const group of groups || []) {
        if (!group || !group.id || !group.id.startsWith("curated")) continue;
        for (const layer of group.layers || []) {
          if (layer && layer.enabled) ids.push(`${group.id}.${layer.id}`);
        }
      }
      return ids;
    }

    async function resolveMaplibregl() {
      if (typeof window !== "undefined" && window.maplibregl) return window.maplibregl;
      try {
        return (await import("maplibre-gl")).default;
      } catch (_) {
        return null;
      }
    }

    const runProjectionCuratedRefresh = async ({
      affectedCuratedFullLayerIds,
      groupsOverride,
    } = {}) => {
      const rawGroups = groupsOverride ?? getEffectiveProjectionLayerGroups();
      const currentGroups = asLayerGroupsArray(rawGroups);

      updateModelBaseImageVisibility(rawGroups, modelImgEl);

      syncProjectionLayers(map, currentGroups);
      syncContextFlowAnimations();

      const enabledCuratedIds = new Set(collectEnabledCuratedIds(currentGroups));
      const previousCuratedIds = new Set(activeCuratedIds);
      activeCuratedIds = enabledCuratedIds;

      for (const fullId of previousCuratedIds) {
        if (!enabledCuratedIds.has(fullId)) {
          removeCuratedLayersByPrefix(map, fullId);
          removeCuratedHtmlMarkers(fullId);
        }
      }

      let toRefresh;
      if (Array.isArray(affectedCuratedFullLayerIds) && affectedCuratedFullLayerIds.length > 0) {
        const affectedSet = new Set(
          affectedCuratedFullLayerIds.filter((id) => typeof id === "string"),
        );
        for (const fullId of affectedSet) {
          removeCuratedLayersByPrefix(map, fullId);
          removeCuratedHtmlMarkers(fullId);
        }
        toRefresh = [...enabledCuratedIds].filter((id) => affectedSet.has(id));
      } else {
        toRefresh = [...enabledCuratedIds];
      }

      if (toRefresh.length === 0) {
        syncContextFlowAnimations();
        syncPinkLineAxisCompanionForMapLibre(map, currentGroups);
        return;
      }

      const maplibregl = await resolveMaplibregl();
      for (const fullId of toRefresh) {
        try {
          await loadCuratedLayerToMapLibre(map, fullId, { maplibregl, force: true });
        } catch (err) {
          console.warn(`[projection-main] Failed to load curated layer ${fullId}`, err);
        }
      }
      syncContextFlowAnimations();
      syncPinkLineAxisCompanionForMapLibre(map, currentGroups);
    };
    let projectionCuratedRefreshChain = Promise.resolve();
    const refreshProjectionCuratedLayers = (options = {}) => {
      projectionCuratedRefreshChain = projectionCuratedRefreshChain
        .catch(() => {})
        .then(() => runProjectionCuratedRefresh(options));
      return projectionCuratedRefreshChain;
    };

    async function loadProjectionCuratedLayers(targetMap) {
      if (!targetMap) return;
      await refreshProjectionCuratedLayers({
        groupsOverride: getEffectiveProjectionLayerGroups(),
      });
    }

    lastViewport = OTEFDataContext.getViewport();
    if (lastViewport) {
      updateHighlightFromViewport(map, lastViewport, modelBounds, highlightEl);
    }

    await loadProjectionCuratedLayers(map);

    registerDisposer(
      OTEFDataContext.subscribe("layerGroups", () => {
        syncContextFlowAnimations();
        // Raw `groups` from the event omit LayerStateHelper merge rules (e.g. שמות_יישובים
        // + Locations_Lines → one row with fullLayerIds). Sync must use the same effective
        // groups as loadProjectionCuratedLayers or Locations_Lines never loads on toggle.
        void refreshProjectionCuratedLayers({
          groupsOverride: getEffectiveProjectionLayerGroups(),
        });
      }),
    );

    registerDisposer(
      OTEFDataContext.subscribe("viewport", (viewport) => {
        lastViewport = viewport;
        updateHighlightFromViewport(map, viewport, modelBounds, highlightEl);
      }),
    );

    try {
      const { syncCuratedMapLayersAfterSupabasePull } = await import(
        "../map/map-curated-supabase-sync.js"
      );
      if (
        typeof window !== "undefined" &&
        !window._otefProjectionCuratedGeojsonRefreshBound
      ) {
        window._otefProjectionCuratedGeojsonRefreshBound = true;
        const onCuratedRefresh = (ev) => {
          void syncCuratedMapLayersAfterSupabasePull({
            pullPayload: ev?.detail || {},
            reloadCuratedOnMap: refreshProjectionCuratedLayers,
            applyLayerGroupsState: (groups) => {
              syncProjectionLayers(
                map,
                Array.isArray(groups) ? groups : Object.values(groups || {}),
              );
              syncContextFlowAnimations();
            },
            mapDeps: {},
          });
        };
        window.addEventListener("otef-curated-geojson-refresh", onCuratedRefresh);
        registerDisposer(() => {
          window.removeEventListener("otef-curated-geojson-refresh", onCuratedRefresh);
          window._otefProjectionCuratedGeojsonRefreshBound = false;
        });
      }
    } catch (e) {
      console.warn("[projection-main] Curated layer modules not available:", e);
    }
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
  let pendingResizeIdleHandler = null;
  const onResize = () => {
    if (resizeTimer) {
      window.clearTimeout(resizeTimer);
    }
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      const syncHighlight = () => {
        if (lastViewport) {
          updateHighlightFromViewport(map, lastViewport, modelBounds, highlightEl);
        }
      };
      if (typeof map.resize === "function") {
        map.resize();
      }
      if (typeof map.once === "function") {
        if (pendingResizeIdleHandler) {
          map.off("idle", pendingResizeIdleHandler);
        }
        pendingResizeIdleHandler = () => {
          pendingResizeIdleHandler = null;
          syncHighlight();
        };
        map.once("idle", pendingResizeIdleHandler);
      } else {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(syncHighlight);
        });
      }
    }, 120);
  };
  const handleWindowResize = () => onResize();
  window.addEventListener("resize", handleWindowResize);

  let resizeObserver = null;
  if (typeof ResizeObserver !== "undefined") {
    const observedTargets = new Set();
    const observeTarget = (target) => {
      if (!target || observedTargets.has(target)) return;
      observedTargets.add(target);
      resizeObserver.observe(target);
    };

    resizeObserver = new ResizeObserver(() => onResize());
    observeTarget(document.getElementById("displayContainer"));
    observeTarget(document.getElementById("projectionMap"));
    observeTarget(highlightEl?.parentElement || null);
  }

  registerDisposer(() => {
    if (resizeTimer) {
      window.clearTimeout(resizeTimer);
      resizeTimer = null;
    }
    if (pendingResizeIdleHandler && typeof map.off === "function") {
      map.off("idle", pendingResizeIdleHandler);
      pendingResizeIdleHandler = null;
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    window.removeEventListener("resize", handleWindowResize);
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
      return;
    }
    if (key === "d" && projectionRenderDebugApi) {
      projectionRenderDebugApi.toggle();
      return;
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
