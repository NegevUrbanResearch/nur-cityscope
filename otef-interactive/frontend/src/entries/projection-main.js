import TableSwitcher from "../shared/table-switcher.js";
import TableSwitcherPopup from "../shared/table-switcher-popup.js";
import {
  createProjectionMap,
  ensureProjectionHighlightLayers,
  raiseProjectionHighlightLayers,
  setProjectionHighlightVisibility,
  updateHighlightFromViewport,
} from "../projection/maplibre-projection.js";
import { installProjectionRenderDebugOverlay } from "../projection/projection-render-debug-overlay.js";
import { syncProjectionLayers } from "../projection/maplibre-projection-layers.js";
import { applyNarrativePeopleFilter } from "../map/nli-people-marker-filter.js";
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
import {
  disposeInvestigationTimelineForMap,
  syncInvestigationTimelineToMap,
  wakeInvestigationTimelinePersonGlow,
} from "../shared/maplibre-investigation-timeline.js";
import { idleNliClock } from "../shared/nli-investigation-clock.js";
import { resolveMotionMode } from "../shared/reduced-motion.js";
import { loadPeopleRuntime } from "../map/maplibre-person-selection.js";
import { bindProjectionPersonHalo } from "../projection/projection-person-halo.js";
import { createNliNameFieldController } from "../shared/nli-name-field-controller.js";
import { installProjectionPreviewBridge } from "../projection/projection-preview-bridge.js";
import { createProjectionNarrativeController } from "../projection/projection-narrative-controller.js";
import { createNovaEscapeCoordinator } from "../shared/nli-nova-escape-coordinator.js";
import MapProjectionConfig from "../shared/map-projection-config.js";
import {
  createSlideshowPackRuntime,
  resolvePresentationOverlayVisibility,
  suppressInvestigationPlayback,
  syncSlideshowPresentationPoll,
} from "../shared/slideshow-pack-runtime.js";
import { subscribeSlideshowProjection } from "../shared/slideshow-projection-channel.js";
import OTEFDataContext from "../shared/OTEFDataContext.js";
import layerRegistry from "../shared/layer-registry.js";
import {
  applyProjectionSpanView,
  clearProjectionSpanBase,
  parseProjectionSpanId,
  restoreProjectionSpanBase,
  runWhenMapIdle,
} from "../projection/projection-span-view.js";
import {
  DEFAULT_PROJECTION_CONFIG,
  validateProjectionConfig,
} from "../shared/projection-config-schema.js";
import {
  dispatchProjectionDisplayHotkey,
  readProjectionDisplayHotkey,
} from "../projection/projection-display-hotkeys.js";
import {
  applyNliExplainerLayout,
  applyNliExplainerHostPresence,
  ensureNliExplainerHost,
  mergeNliExplainerLayout,
  nliExplainerSpanKey,
} from "../projection/nli-explainer-overlay.js";
import {
  installNliExplainerDebug,
  isNliExplainerDebugRequestedInUrl,
} from "../projection/nli-explainer-debug.js";
import {
  applyNliSharedTextHeading,
  NLI_LABEL_HEADING_STORAGE_KEY,
  readNliLabelHeading,
} from "../shared/nli-label-heading.js";
import { createProjectionConfigClient } from "../shared/projection-config-client.js";
import { createUuid } from "../shared/uuid.js";
import { createProjectionConfigRuntime } from "../projection/projection-config-runtime.js";
import { createProjectionPattern } from "../projection/projection-pattern.js";

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

function applyStoredNliLabelHeading(map) {
  applyNliSharedTextHeading(
    map,
    readNliLabelHeading(typeof window !== "undefined" ? window.localStorage : undefined),
  );
}

/**
 * Query: `?projectionRenderDebug=1` or `?prd=1` (also true/yes/on; 0/false/no/off disables).
 * For embedded WebViews (e.g. TouchDesigner) that cannot use the D key or executeJavaScript.
 * @returns {boolean}
 */
function isProjectionRenderDebugRequestedInUrl() {
  if (typeof window === "undefined" || typeof window.location?.search !== "string") return false;
  const q = window.location.search;
  if (!q || q === "?") return false;
  const params = new URLSearchParams(q);
  const raw = params.get("projectionRenderDebug") ?? params.get("prd");
  if (raw === null || raw === "") return false;
  const lower = String(raw).trim().toLowerCase();
  if (lower === "0" || lower === "false" || lower === "no" || lower === "off") return false;
  return true;
}

/** Cap avoids accidental huge framebuffers (e.g. mpr=99). */
const MAX_PROJECTION_MAP_PIXEL_RATIO = 3;

/**
 * MapLibre `pixelRatio` for projection (supersampling). URL wins over config.
 * Use `?mapPixelRatio=1.5` or short `?mpr=1.5` (TouchDesigner: append to projection URL).
 * @returns {number | undefined} Omit Map option when undefined (MapLibre uses devicePixelRatio).
 */
function resolveProjectionMapPixelRatio() {
  if (typeof window !== "undefined" && typeof window.location?.search === "string") {
    const q = window.location.search;
    if (q && q !== "?") {
      const params = new URLSearchParams(q);
      const raw = params.get("mapPixelRatio") ?? params.get("mpr");
      if (raw !== null && raw !== "") {
        const n = Number(String(raw).trim());
        if (Number.isFinite(n) && n > 0 && n <= MAX_PROJECTION_MAP_PIXEL_RATIO) {
          return n;
        }
      }
    }
  }
  const c =
    typeof window !== "undefined" && window.MapProjectionConfig?.PROJECTION_MAP_PIXEL_RATIO;
  if (typeof c === "number" && Number.isFinite(c) && c > 0 && c <= MAX_PROJECTION_MAP_PIXEL_RATIO) {
    return c;
  }
  return undefined;
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
  const previewMode = new URLSearchParams(window.location.search).get("preview") === "1";
  if (previewMode) document.body.classList.add("projection-preview");
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
  const imageItmCorners = [
    [itmBounds.west, itmBounds.north],
    [itmBounds.east, itmBounds.north],
    [itmBounds.east, itmBounds.south],
    [itmBounds.west, itmBounds.south],
  ];
  const imageGeoCorners = imageItmCorners.map((point) => proj4("EPSG:2039", "EPSG:4326", point));
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
    modelImgEl.__otefProjectionImage = {
      bounds: modelBounds.bounds,
      corners: imageGeoCorners,
      itmCorners: imageItmCorners,
      width: modelBoundsData.image_width,
      height: modelBoundsData.image_height,
    };
    updateModelBaseImageVisibility(getEffectiveProjectionLayerGroups(), modelImgEl);
  }

  if (typeof document !== "undefined" && document.fonts && typeof document.fonts.load === "function") {
    try {
      await document.fonts.load("11px 'Guttman Hatzvi'");
    } catch (err) {
      console.warn("[projection-main] Guttman Hatzvi font preload failed; labels may flash", err);
    }
  }

  const projectionSpanId = parseProjectionSpanId(
    typeof window !== "undefined" ? window.location.search : "",
  );
  let effectiveProjectionConfig = DEFAULT_PROJECTION_CONFIG;
  const getEffectiveProjectionConfig = () => effectiveProjectionConfig;
  const displayContainerEl = document.getElementById("displayContainer");
  if (projectionSpanId) {
    applyProjectionSpanView({
      map: null,
      imageEl: modelImgEl,
      containerEl: displayContainerEl,
      spanId: projectionSpanId,
      config: effectiveProjectionConfig,
    });
  }
  const urlOrConfigPixelRatio = resolveProjectionMapPixelRatio();
  const map = createProjectionMap("projectionMap", modelBounds, {
    ...(urlOrConfigPixelRatio !== undefined ? { pixelRatio: urlOrConfigPixelRatio } : {}),
  });
  if (typeof window !== "undefined") {
    window._maplibreMap = map;
  }
  map._otefProjectionImage = {
    bounds: modelBounds.bounds,
    corners: imageGeoCorners,
    itmCorners: imageItmCorners,
    width: modelBoundsData.image_width,
    height: modelBoundsData.image_height,
  };
  const applySpanCamera = (revision) => {
    applyProjectionSpanView({
      map,
      imageEl: modelImgEl,
      containerEl: document.getElementById("displayContainer"),
      spanId: projectionSpanId,
      config: effectiveProjectionConfig,
      revision,
    });
  };
  const projectionConfigBridge = {
    getEffectiveConfig: getEffectiveProjectionConfig,
    setEffectiveConfig: (nextConfig, revision) => {
      if (!nextConfig?.pre || !nextConfig?.outputs?.left || !nextConfig?.outputs?.right) {
        return false;
      }
      if (Object.keys(validateProjectionConfig(nextConfig)).length > 0) return false;
      if (
        Number.isFinite(revision) &&
        Number.isFinite(map._otefProjectionSpanRevision) &&
        revision < map._otefProjectionSpanRevision
      ) {
        return false;
      }
      effectiveProjectionConfig = nextConfig;
      return applySpanCamera(revision);
    },
  };
  map._otefProjectionConfigBridge = projectionConfigBridge;
  map.getEffectiveProjectionConfig = getEffectiveProjectionConfig;
  map.setEffectiveProjectionConfig = projectionConfigBridge.setEffectiveConfig;
  let projectionRuntime = null;
  let lastViewport = null;
  /** @type {ReturnType<import("../shared/slideshow-pack-runtime.js").createSlideshowPackRuntime> | null} */
  let slideshowRuntime = null;

  const syncProjectionHighlight = (viewport) => {
    if (slideshowRuntime?.shouldSuppressProjectionHighlight?.()) {
      setProjectionHighlightVisibility(map, false);
      return;
    }
    setProjectionHighlightVisibility(map, true);
    if (viewport) {
      updateHighlightFromViewport(map, viewport, modelBounds, null);
    }
  };

  const disposers = [];
  /** @type {null | { toggle: () => void; setVisible: (v: boolean) => void; getActive: () => boolean; dispose: () => void }} */
  let shemotLabelDebugApi = null;
  /** @type {null | { toggle: () => void; setVisible: (v: boolean) => void; isVisible: () => boolean; dispose: () => void }} */
  let nliExplainerDebugApi = null;
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

  /** Tesuga reads Web Render info DAT `title`; keep in sync with `slideshowRuntime.isActive()`. */
  let presentationPollId = null;
  let lastPresentationFlag = null;

  function syncPresentationFlag() {
    const active = !!(slideshowRuntime && slideshowRuntime.isActive());
    const flag = active ? "on" : "off";
    if (lastPresentationFlag === flag) {
      return;
    }
    lastPresentationFlag = flag;
    if (typeof document !== "undefined") {
      if (document.body) {
        document.body.dataset.presentation = flag;
      }
      document.title = active
        ? "OTEF Projection Display | pres=on"
        : "OTEF Projection Display | pres=off";
    }
    if (typeof window !== "undefined") {
      window.OTEFPresentationActive = active;
    }
  }

  function clearPresentationPoll() {
    if (presentationPollId != null) {
      window.clearInterval(presentationPollId);
      presentationPollId = null;
    }
  }

  function startPresentationPoll() {
    if (presentationPollId != null) {
      return;
    }
    presentationPollId = window.setInterval(() => {
      syncPresentationFlag();
      const waitingToBecomeActive =
        slideshowRuntime &&
        !slideshowRuntime.isActive() &&
        typeof slideshowRuntime.shouldSuppressProjectionHighlight === "function" &&
        slideshowRuntime.shouldSuppressProjectionHighlight();
      if (!waitingToBecomeActive) {
        clearPresentationPoll();
      }
    }, 250);
  }

  syncPresentationFlag();
  registerDisposer(clearPresentationPoll);

  const projectionRenderDebugApi = installProjectionRenderDebugOverlay({
    map,
    registerDisposer,
    initialVisible: isProjectionRenderDebugRequestedInUrl(),
  });

  // TouchDesigner Web Browser DAT (and similar hosts) often do not deliver real key events;
  // expose the overlay API like ProjectionBoundsEditor for executeJavaScript().
  if (typeof window !== "undefined" && projectionRenderDebugApi) {
    window.ProjectionRenderDebug = projectionRenderDebugApi;
    registerDisposer(() => {
      if (window.ProjectionRenderDebug === projectionRenderDebugApi) {
        delete window.ProjectionRenderDebug;
      }
    });
  }

  let projectionMapBooted = false;
  map.on("load", async () => {
    if (projectionMapBooted) return;
    projectionMapBooted = true;
    const nameFieldController = createNliNameFieldController({ map, context: OTEFDataContext, displayProfile: "projection", projectionSpan: projectionSpanId, motionMode: resolveMotionMode() });
    registerDisposer(() => nameFieldController.dispose());
    nameFieldController.setProjectionConfig(DEFAULT_PROJECTION_CONFIG);
    if (modelBounds && modelBounds.bounds && typeof map.fitBounds === "function") {
      map.fitBounds(modelBounds.bounds, { animate: false, padding: 0 });
    }
    runWhenMapIdle(map, () => {
      clearProjectionSpanBase(map);
      applySpanCamera();
    });
    ensureProjectionHighlightLayers(map);

    const displayContainer = document.getElementById("displayContainer");
    const { host: nliExplainerHost, captionEl: nliExplainerCaptionEl } =
      ensureNliExplainerHost(displayContainer);
    const applyStoredExplainerLayout = () => {
      const search = typeof window !== "undefined" ? window.location.search : "";
      const remote = OTEFDataContext.getNliClockLayout?.()?.projection;
      const stored = remote && typeof remote === "object" ? remote : {};
      const spanKey = nliExplainerSpanKey(search);
      applyNliExplainerLayout(
        nliExplainerHost,
        mergeNliExplainerLayout(spanKey, stored, MapProjectionConfig.NLI_EXPLAINER_LAYOUT),
      );
      applyNliExplainerHostPresence(nliExplainerHost, spanKey);
    };
    applyStoredExplainerLayout();
    registerDisposer(OTEFDataContext.subscribe("nliClockLayout", () => {
      if (window.NliExplainerDebug?.isVisible?.()) return;
      applyStoredExplainerLayout();
    }));
    try {
      const { updateMapLegend } = await import("../map/map-legend.js");
      registerDisposer(
        OTEFDataContext.subscribe("layerGroups", () => {
          updateMapLegend({ surface: "projection" });
        }),
      );
      registerDisposer(
        OTEFDataContext.subscribe("narrativeState", () => {
          updateMapLegend({ surface: "projection" });
        }),
      );
      updateMapLegend({ surface: "projection" });
    } catch (e) {
      console.warn("[projection-main] Legend module not available:", e);
    }
    const onExplainerResize = () => {
      if (window.NliExplainerDebug?.isVisible?.()) return;
      applyStoredExplainerLayout();
    };
    window.addEventListener("resize", onExplainerResize);
    registerDisposer(() => window.removeEventListener("resize", onExplainerResize));

    registerDisposer(() => {
      disposeRouteProgressOverlaysForMap(map);
      disposeInvestigationTimelineForMap(map);
    });

    const projectionOverlayContext = () => {
      const rawGroups = OTEFDataContext.getLayerGroups();
      const rawAsArray = Array.isArray(rawGroups) ? rawGroups : Object.values(rawGroups || {});
      const currentGroups = asLayerGroupsArray(getEffectiveProjectionLayerGroups());
      const presentationActive =
        typeof slideshowRuntime?.shouldSuppressProjectionHighlight === "function"
          ? slideshowRuntime.shouldSuppressProjectionHighlight()
          : !!(slideshowRuntime && slideshowRuntime.isActive());
      const overlayGroups = resolvePresentationOverlayVisibility({
        presentationActive,
        incomingGroups:
          typeof slideshowRuntime?.getCommittedGroups === "function"
            ? slideshowRuntime.getCommittedGroups()
            : null,
        liveGroups: rawAsArray,
        keepSettlementNames: MapProjectionConfig.PROJECTION_SLIDESHOW?.keepSettlementNames === true,
        excludedPresentationPackIds:
          MapProjectionConfig.PROJECTION_SLIDESHOW?.excludedPresentationPackIds,
      });
      return { currentGroups, overlayGroups, presentationActive };
    };
    const syncContextRouteProgress = () => {
      const { currentGroups, overlayGroups, presentationActive } = projectionOverlayContext();
      const anim =
        typeof OTEFDataContext.getAnimations === "function" ? OTEFDataContext.getAnimations() : {};
      const overlayAnim = suppressInvestigationPlayback(anim, presentationActive);
      void syncRouteProgressOverlaysToMap(map, overlayAnim, currentGroups, {
        visibilityLayerGroups: overlayGroups,
      });
    };
    let explainerDebugVisible = false;
    let projectionNarrativeController = null;
    let novaEscapeCoordinator = null;
    let parallelImpactIds = new Set();
    const syncContextInvestigation = () => {
      const { currentGroups, overlayGroups, presentationActive } = projectionOverlayContext();
      const clock =
        typeof OTEFDataContext.getInvestigationClock === "function"
          ? OTEFDataContext.getInvestigationClock()
          : idleNliClock();
      const overlayClock = presentationActive ? idleNliClock(clock) : clock;
      void syncInvestigationTimelineToMap(map, overlayClock, currentGroups, {
        visibilityLayerGroups: overlayGroups,
        displayProfile: "projection",
        nliCaptionMode: "clock-only",
        motionMode: resolveMotionMode(),
        captionEl: nliExplainerCaptionEl,
        allowMapCaption: false,
        explainerDebugVisible: explainerDebugVisible === true,
        now: () =>
          typeof OTEFDataContext.correctedNow === "function"
            ? OTEFDataContext.correctedNow()
            : Date.now(),
        getPersonSelection: () => OTEFDataContext.getPersonSelection(),
        narrativeFocus: projectionNarrativeController?.getDefinition(),
        parallelImpactIds,
      });
    };
    try {
      nliExplainerDebugApi = installNliExplainerDebug({
        host: nliExplainerHost,
        captionEl: nliExplainerCaptionEl,
        registerDisposer,
        initialVisible: isNliExplainerDebugRequestedInUrl(
          typeof window !== "undefined" ? window.location.search : "",
        ),
        onVisibleChange: (visible) => {
          explainerDebugVisible = visible === true;
          syncContextInvestigation();
        },
        getProjectionConfig: getEffectiveProjectionConfig,
        getRemoteLayoutMap: () => OTEFDataContext.getNliClockLayout?.()?.projection || {},
        persistRemoteLayoutMap: (layout) => OTEFDataContext.setNliClockLayout({
          surface: "projection",
          layout,
        }),
      });
      if (typeof window !== "undefined" && nliExplainerDebugApi) {
        window.NliExplainerDebug = nliExplainerDebugApi;
        registerDisposer(() => {
          if (window.NliExplainerDebug === nliExplainerDebugApi) {
            delete window.NliExplainerDebug;
          }
          nliExplainerDebugApi = null;
        });
      }
    } catch (e) {
      console.warn("[projection-main] NLI explainer debug failed to load", e);
    }
    const syncContextFlowAnimations = () => {
      syncContextRouteProgress();
      syncContextInvestigation();
    };

    if (previewMode) registerDisposer(installProjectionPreviewBridge({
      win: window, output: projectionSpanId, map, nameFieldController, syncContextInvestigation,
    }));

    if (projectionSpanId && !previewMode && OTEFDataContext._wsClient) {
      const projectionConfigClient = createProjectionConfigClient({
        table: "otef",
        sourceId: createUuid(),
        socket: OTEFDataContext._wsClient,
      });
      const projectionPattern = createProjectionPattern({
        host: document.getElementById("projectionMap") || displayContainer,
        spanId: projectionSpanId,
      });
      const patternHandler = (message) => projectionPattern.receive(message);
      const disconnectPattern = () => projectionPattern.clear();
      OTEFDataContext._wsClient.on("otef_projection_pattern", patternHandler);
      OTEFDataContext._wsClient.on("disconnect", disconnectPattern);
      const applyEffectiveProjectionConfig = (config, revision) => {
        if (map.setEffectiveProjectionConfig(config, revision) === false) {
          throw new Error("projection camera rejected calibration");
        }
        if (typeof nameFieldController.setProjectionConfig === "function" && !nameFieldController.setProjectionConfig(config, revision)) {
          throw new Error("projection names rejected calibration");
        }
        projectionPattern.setConfig(config);
        syncContextInvestigation();
        return true;
      };
      projectionRuntime = createProjectionConfigRuntime({
        map,
        spanId: projectionSpanId,
        client: projectionConfigClient,
        socket: OTEFDataContext._wsClient,
        instanceId: createUuid(),
        applyConfig: applyEffectiveProjectionConfig,
      });
      registerDisposer(() => {
        projectionRuntime.stop();
        projectionConfigClient.stop?.();
        projectionPattern.dispose();
        OTEFDataContext._wsClient.off?.("otef_projection_pattern", patternHandler);
        OTEFDataContext._wsClient.off?.("disconnect", disconnectPattern);
      });
      void projectionRuntime.start().catch((error) => {
        console.warn("[projection-main] projection config runtime failed", error);
      });
    }
    novaEscapeCoordinator = createNovaEscapeCoordinator({
      map,
      dataContext: OTEFDataContext,
      profile: "projection",
      surface: "projection",
      onParallelImpactIdsChanged: (ids) => {
        parallelImpactIds = ids instanceof Set ? ids : new Set(ids || []);
        syncContextInvestigation();
      },
    });
    registerDisposer(() => novaEscapeCoordinator?.dispose?.());
    projectionNarrativeController = createProjectionNarrativeController({
      map,
      syncTimeline: syncContextInvestigation,
      onStyleLoadOverlay: () => novaEscapeCoordinator?.onStyleLoad?.(),
    });
    registerDisposer(() => projectionNarrativeController?.dispose());
    registerDisposer(
      OTEFDataContext.subscribe("narrativeState", (state) => {
        projectionNarrativeController?.apply(state);
      }),
    );
    projectionNarrativeController.apply(OTEFDataContext.getNarrativeState());
    registerDisposer(OTEFDataContext.subscribe("animations", syncContextRouteProgress));
    registerDisposer(OTEFDataContext.subscribe("investigationClock", syncContextInvestigation));
    registerDisposer(bindProjectionPersonHalo({
      map,
      subscribe: (topic, listener) => OTEFDataContext.subscribe(topic, listener),
      loadPeopleRuntime,
      motionMode: resolveMotionMode(),
    }));
    const wakeProjectionPersonGlow = () => {
      wakeInvestigationTimelinePersonGlow(map);
    };
    registerDisposer(OTEFDataContext.subscribe("personSelection", wakeProjectionPersonGlow));
    const onNliLabelHeadingStorage = (event) => {
      if (event.key !== NLI_LABEL_HEADING_STORAGE_KEY) return;
      applyStoredNliLabelHeading(map);
      nameFieldController.reload();
    };
    window.addEventListener("storage", onNliLabelHeadingStorage);
    registerDisposer(() => window.removeEventListener("storage", onNliLabelHeadingStorage));

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

    function hasMapLibreLayerWithPrefix(targetMap, prefix) {
      if (!targetMap || !prefix || typeof targetMap.getStyle !== "function") return false;
      const style = targetMap.getStyle();
      return (style?.layers || []).some((layer) => layer?.id?.startsWith(prefix));
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
      fromSlideshowTick,
      groupsOverride,
      layerStyleOptions,
    } = {}) => {
      const rawGroups = groupsOverride ?? getEffectiveProjectionLayerGroups();
      const currentGroups = asLayerGroupsArray(rawGroups);

      updateModelBaseImageVisibility(rawGroups, modelImgEl);

      syncProjectionLayersWithNarrative(map, currentGroups, layerStyleOptions);
      applyStoredNliLabelHeading(map);
      nameFieldController.sync(currentGroups);
      syncContextFlowAnimations();

      const enabledCuratedIds = new Set(collectEnabledCuratedIds(currentGroups));
      const previousCuratedIds = new Set(activeCuratedIds);
      activeCuratedIds = enabledCuratedIds;

      for (const fullId of previousCuratedIds) {
        if (!enabledCuratedIds.has(fullId)) {
          removeCuratedLayersByPrefix(map, fullId, layerStyleOptions);
          removeCuratedHtmlMarkers(fullId);
        }
      }

      let toRefresh;
      if (Array.isArray(affectedCuratedFullLayerIds) && affectedCuratedFullLayerIds.length > 0) {
        const affectedSet = new Set(
          affectedCuratedFullLayerIds.filter((id) => typeof id === "string"),
        );
        for (const fullId of affectedSet) {
          removeCuratedHtmlMarkers(fullId);
        }
        toRefresh = [...enabledCuratedIds].filter((id) => affectedSet.has(id));
      } else {
        toRefresh = [...enabledCuratedIds];
      }

      if (toRefresh.length === 0) {
        syncContextFlowAnimations();
        syncPinkLineAxisCompanionForMapLibre(map, currentGroups);
        projectionNarrativeController?.onStyleLoad();
        raiseProjectionHighlightLayers(map);
        return;
      }

      const maplibregl = await resolveMaplibregl();
      for (const fullId of toRefresh) {
        if (fromSlideshowTick && hasMapLibreLayerWithPrefix(map, fullId)) {
          continue;
        }
        try {
          await loadCuratedLayerToMapLibre(map, fullId, {
            maplibregl,
            force: true,
          });
        } catch (err) {
          console.warn(`[projection-main] Failed to load curated layer ${fullId}`, err);
        }
      }
      syncContextFlowAnimations();
      syncPinkLineAxisCompanionForMapLibre(map, currentGroups);
      projectionNarrativeController?.onStyleLoad();
      raiseProjectionHighlightLayers(map);
    };
    const shouldSkipLiveProjectionRefresh = () =>
      !!(
        slideshowRuntime?.isActive() &&
        MapProjectionConfig.PROJECTION_SLIDESHOW?.ignoreLiveLayerUpdatesWhileActive
      );
    const applyProjectionRefresh = ({
      groupsOverride,
      affectedCuratedFullLayerIds,
      fromSlideshowTick,
      layerStyleOptions,
    } = {}) => {
      if (!fromSlideshowTick && shouldSkipLiveProjectionRefresh()) {
        return Promise.resolve();
      }
      return runProjectionCuratedRefresh({
        groupsOverride,
        affectedCuratedFullLayerIds,
        fromSlideshowTick,
        layerStyleOptions,
      });
    };
    let projectionCuratedRefreshChain = Promise.resolve();
    const refreshProjectionCuratedLayers = (options = {}) => {
      projectionCuratedRefreshChain = projectionCuratedRefreshChain
        .catch(() => {})
        .then(() => applyProjectionRefresh(options));
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
      syncProjectionHighlight(lastViewport);
    }

    await loadProjectionCuratedLayers(map);

    try {
      const { installShemotLabelDebug } = await import(
        "../projection/projection-shemot-label-debug.js"
      );
      shemotLabelDebugApi = installShemotLabelDebug({ map, registerDisposer });
      if (typeof window !== "undefined" && shemotLabelDebugApi) {
        window.ShemotLabelDebug = shemotLabelDebugApi;
        registerDisposer(() => {
          if (window.ShemotLabelDebug === shemotLabelDebugApi) {
            delete window.ShemotLabelDebug;
          }
          shemotLabelDebugApi = null;
        });
      }
    } catch (e) {
      console.warn("[projection-main] Shemot label debug failed to load", e);
    }

    function syncProjectionLayersWithNarrative(targetMap, groups, options) {
      syncProjectionLayers(targetMap, groups, options);
      applyNarrativePeopleFilter(targetMap, OTEFDataContext.getNarrativeState?.()?.id ?? null);
    }

    const syncProjectionLayersAndRaiseHighlight = (projectionMap, groups, options) => {
      syncProjectionLayersWithNarrative(projectionMap, groups, options);
      nameFieldController.sync(groups);
      applyStoredNliLabelHeading(projectionMap);
      syncContextFlowAnimations();
      projectionNarrativeController?.onStyleLoad();
      raiseProjectionHighlightLayers(projectionMap);
    };

    slideshowRuntime = createSlideshowPackRuntime({
      map,
      config: MapProjectionConfig.PROJECTION_SLIDESHOW,
      getEffectiveLayerGroups: getEffectiveProjectionLayerGroups,
      syncProjectionLayers: syncProjectionLayersAndRaiseHighlight,
      applyProjectionRefresh,
      syncPresentationOverlays: syncContextFlowAnimations,
    });
    registerDisposer(() => {
      if (slideshowRuntime) {
        void slideshowRuntime.dispose();
      }
      slideshowRuntime = null;
    });

    const syncAfterStart = () => {
      syncPresentationFlag();
      syncSlideshowPresentationPoll(slideshowRuntime, {
        start: startPresentationPoll,
        clear: clearPresentationPoll,
      });
      syncContextFlowAnimations();
      syncProjectionHighlight(lastViewport);
    };

    const syncAfterStop = syncAfterStart;
    const syncAfterStopFailure = () => {
      syncPresentationFlag();
      syncSlideshowPresentationPoll(slideshowRuntime, {
        start: startPresentationPoll,
        clear: clearPresentationPoll,
      });
      syncProjectionHighlight(lastViewport);
    };

    function handleSlideshowProjectionMessage(msg) {
      if (!slideshowRuntime || !msg?.type) return;
      if (msg.type === "start") {
        const startPromise = slideshowRuntime.start(msg.payload || {});
        syncAfterStart();
        void Promise.resolve(startPromise).then(syncAfterStart, syncAfterStart);
        return;
      }
      if (msg.type === "stop") {
        void slideshowRuntime
          .stop()
          .then(syncAfterStop)
          .catch((err) => {
            syncAfterStopFailure();
            console.warn(
              "[projection-main] slideshow stop or projection refresh after stop failed",
              err,
            );
          });
      }
    }

    registerDisposer(subscribeSlideshowProjection(handleSlideshowProjectionMessage));
    registerDisposer(
      OTEFDataContext.subscribe("projectionSlideshow", (raw) => {
        if (!raw || typeof raw !== "object" || !raw.type) return;
        const payload =
          raw.payload && typeof raw.payload === "object" ? raw.payload : {};
        handleSlideshowProjectionMessage({ type: raw.type, payload });
      }),
    );

    registerDisposer(
      OTEFDataContext.subscribe("layerGroups", () => {
        // Raw `groups` from the event omit LayerStateHelper merge rules (e.g. שמות_יישובים
        // + Locations_Lines → one row with fullLayerIds). Sync must use the same effective
        // groups as loadProjectionCuratedLayers or Locations_Lines never loads on toggle.
        void applyProjectionRefresh({
          groupsOverride: getEffectiveProjectionLayerGroups(),
        });
      }),
    );

    registerDisposer(
      OTEFDataContext.subscribe("viewport", (viewport) => {
        lastViewport = viewport;
        syncProjectionHighlight(viewport);
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
          if (shouldSkipLiveProjectionRefresh()) {
            return;
          }
          void syncCuratedMapLayersAfterSupabasePull({
            pullPayload: ev?.detail || {},
            reloadCuratedOnMap: refreshProjectionCuratedLayers,
            applyLayerGroupsState: (groups) => {
              if (shouldSkipLiveProjectionRefresh()) {
                return;
              }
              syncProjectionLayersWithNarrative(
                map,
                Array.isArray(groups) ? groups : Object.values(groups || {}),
              );
              applyStoredNliLabelHeading(map);
              nameFieldController.sync(Array.isArray(groups) ? groups : Object.values(groups || {}));
              syncContextFlowAnimations();
              projectionNarrativeController?.onStyleLoad();
              raiseProjectionHighlightLayers(map);
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
  if (map.loaded() || map._loaded) map.fire("load");

  if (previewMode) return;
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
    if (!bounds || typeof map.project !== "function") return null;
    let lngLat;
    try {
      const projected = proj4("EPSG:2039", "EPSG:4326", [x, y]);
      if (!Array.isArray(projected) || !projected.every(Number.isFinite)) return null;
      lngLat = projected;
    } catch {
      return null;
    }
    let point;
    try {
      point = map.project(lngLat);
    } catch {
      return null;
    }
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    const mapRect = map.getContainer?.().getBoundingClientRect?.();
    const displayRect = document.getElementById("displayContainer")?.getBoundingClientRect?.();
    const offsetX = mapRect && displayRect ? mapRect.left - displayRect.left : 0;
    const offsetY = mapRect && displayRect ? mapRect.top - displayRect.top : 0;
    return {
      x: bounds.offsetX + offsetX + point.x,
      y: bounds.offsetY + offsetY + point.y,
    };
  };

  const displayPixelsToItm = (x, y) => {
    if (typeof map.unproject !== "function") return null;
    const bounds = getDisplayedImageBounds();
    if (!bounds) return null;
    const mapRect = map.getContainer?.().getBoundingClientRect?.();
    const displayRect = document.getElementById("displayContainer")?.getBoundingClientRect?.();
    const offsetX = mapRect && displayRect ? mapRect.left - displayRect.left : 0;
    const offsetY = mapRect && displayRect ? mapRect.top - displayRect.top : 0;
    let lngLat;
    try {
      lngLat = map.unproject([
        x - bounds.offsetX - offsetX,
        y - bounds.offsetY - offsetY,
      ]);
    } catch {
      return null;
    }
    const lng = Number(lngLat?.lng ?? lngLat?.[0]);
    const lat = Number(lngLat?.lat ?? lngLat?.[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    let itm;
    try {
      itm = proj4("EPSG:4326", "EPSG:2039", [lng, lat]);
    } catch {
      return null;
    }
    return Array.isArray(itm) && itm.every(Number.isFinite)
      ? { x: itm[0], y: itm[1] }
      : null;
  };

  if (window.ProjectionBoundsEditor) {
    window.ProjectionBoundsEditor.configure({
      getModelBounds: () => itmBounds,
      getDisplayedImageBounds,
      itmToDisplayPixels,
      displayPixelsToItm,
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
    projectionRuntime?.invalidate();
    if (resizeTimer) {
      window.clearTimeout(resizeTimer);
    }
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      if (typeof map.resize === "function") {
        restoreProjectionSpanBase(map);
        map.resize();
        if (modelBounds && modelBounds.bounds) {
          map.fitBounds(modelBounds.bounds, { animate: false, padding: 0 });
        }
      }
      const syncHighlight = () => {
        pendingResizeIdleHandler = null;
        clearProjectionSpanBase(map);
        applySpanCamera();
        projectionRuntime?.resume();
        projectionRuntime?.requestStatus();
        syncProjectionHighlight(lastViewport);
      };
      if (pendingResizeIdleHandler && typeof map.off === "function") {
        map.off("idle", pendingResizeIdleHandler);
        pendingResizeIdleHandler = null;
      }
      if (typeof map.isMoving === "function" && map.isMoving()) {
        pendingResizeIdleHandler = syncHighlight;
      }
      runWhenMapIdle(map, syncHighlight);
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
    const action = readProjectionDisplayHotkey(event);
    if (!action) return;
    const handled = dispatchProjectionDisplayHotkey(action, {
      toggleHelp: () => {
        const instructions = document.getElementById("instructions");
        if (instructions) instructions.classList.toggle("hidden");
      },
      toggleFullscreen: toggleProjectionFullscreen,
      toggleBounds: () => {
        if (window.ProjectionBoundsEditor) window.ProjectionBoundsEditor.toggle();
      },
      toggleRotation: () => {
        if (window.ProjectionRotationEditor) window.ProjectionRotationEditor.toggle();
      },
      toggleRenderDebug: () => {
        if (projectionRenderDebugApi) projectionRenderDebugApi.toggle();
      },
      toggleLabelDebug: () => {
        if (shemotLabelDebugApi) shemotLabelDebugApi.toggle();
      },
      toggleExplainerDebug: () => {
        if (window.NliExplainerDebug) window.NliExplainerDebug.toggle();
      },
    });
    if (handled && action === "explainerDebug") event.preventDefault();
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
  const previewMode = new URLSearchParams(window.location.search).get("preview") === "1";
  const shouldContinue = previewMode || initializeTableSwitcher();
  if (!shouldContinue) return;
  await bootstrapProjectionRuntime();
}

boot().catch((error) => console.error("[frontend-b] projection bootstrap failed", error));
