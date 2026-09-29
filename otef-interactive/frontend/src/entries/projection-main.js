import TableSwitcher from "../shared/table-switcher.js";
import TableSwitcherPopup from "../shared/table-switcher-popup.js";
import {
  createProjectionMap,
  ensureProjectionHighlightLayers,
  PROJECTION_HIGHLIGHT_FILL_LAYER_ID,
  PROJECTION_HIGHLIGHT_LINE_LAYER_ID,
  raiseProjectionHighlightLayers,
  setProjectionHighlightVisibility,
  shouldShowProjectionViewportHighlight,
  updateHighlightFromViewport,
} from "../projection/maplibre-projection.js";
import { installProjectionRenderDebugOverlay } from "../projection/projection-render-debug-overlay.js";
import { syncProjectionLayers } from "../projection/maplibre-projection-layers.js";
import { applyNarrativeHouseOutlineFilter, applyNarrativePeopleFilter } from "../map/nli-people-marker-filter.js";
import { applyPeopleFocusDim, clearPeopleFocusDim } from "../shared/nli-people-focus-presentation.js";
import {
  createCuratedDisplayGate,
  createProjectionCuratedRefresh,
  syncPinkLineAxisCompanionForMapLibre,
} from "../map/maplibre-curated-layer-loader.js";
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
import { subscribeNliVideoPlayback } from "../shared/nli-video-playback-channel.js";
import { resolveMotionMode } from "../shared/reduced-motion.js";
import { getLayerLifecycleRuntime } from "../shared/layer-lifecycle-fade.js";
import { projectionModelSubscribeReady, releaseProjectionModelImage, syncProjectionModelImage } from "../projection/projection-model-image.js";
import { loadPeopleRuntime } from "../map/maplibre-person-selection.js";
import { bindProjectionPersonHalo } from "../projection/projection-person-halo.js";
import {
  createProjectionSettlementGlow,
  syncProjectionSettlementGlow,
} from "../projection/projection-settlement-glow.js";
import { createNliNameFieldController } from "../shared/nli-name-field-controller.js";
import { prepareProjectionNameWall, disposeProjectionNameWallPreparation } from "../shared/nli-name-field-data.js";
import {
  isolateLayersWhileVictimNamesShown,
  victimNamesAreShown,
} from "../shared/nli-victim-name-layer-isolation.js";
import { loadSettlementFeatures } from "../shared/nli-investigation-timeline-data.js";
import { installProjectionPreviewBridge } from "../projection/projection-preview-bridge.js";
import { bindProjectionHeadingStorage } from "../projection/projection-heading-storage.js";
import { createProjectionConfigClient } from "../shared/projection-config-client.js";
import { createProjectionConfigRuntime } from "../projection/projection-config-runtime.js";
import { createUuid } from "../shared/uuid.js";
import { createProjectionNarrativeController } from "../projection/projection-narrative-controller.js";
import { createNovaEscapeCoordinator } from "../shared/nli-nova-escape-coordinator.js";
import { createMorRouteCoordinator } from "../shared/nli-mor-route-coordinator.js";
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
  createProjectionImageDescriptor,
  createProjectionImageReadiness,
  createProjectionMapDescriptor,
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
  applyNliSharedTextHeading,
  readNliLabelHeading,
} from "../shared/nli-label-heading.js";
import { createProjectionPattern } from "../projection/projection-pattern.js";
import { createProjectionCaptionAdapter, drawProjectionCaptionForSpan } from "../projection/projection-caption-adapter.js";
import { createProjectionLegendAdapter } from "../projection/projection-legend-adapter.js";
import { createProjectionPatternAdapter } from "../projection/projection-pattern-adapter.js";
import { getInvestigationTimelineRenderSnapshot } from "../shared/maplibre-investigation-timeline.js";
import { loadCapturedProjectionFraming } from "../projection/projection-captured-baseline.js";
import { visibleProjectionBrowserError } from "../projection/projection-browser-error.js";
import { projectionCandidateResult } from '../projection/projection-candidate-validation.js';
import { createProjectionLifecycle } from "../projection/projection-lifecycle.js";
import {
  createLegendStyleLoadRefresh,
  installMapLegendLifecycle,
} from "../map/legend-integration.js";

export function bindProjectionClockLayout({ dataContext, host, span, onLayout, getBrowserSurface, win = globalThis.window }) {
  const apply = () => {
    const remote = dataContext.getNliClockLayout?.()?.projection?.left;
    const layout = mergeNliExplainerLayout("left", remote ? { left: remote } : {}, MapProjectionConfig.NLI_EXPLAINER_LAYOUT);
    onLayout(layout);
    applyNliExplainerLayout(host, layout);
    applyNliExplainerHostPresence(host, span);
  };
  apply();
  const onChange = () => {
    apply();
    getBrowserSurface()?.requestDraw?.();
  };
  const unsubscribe = dataContext.subscribe("nliClockLayout", onChange);
  win.addEventListener("resize", onChange);
  return () => { unsubscribe?.(); win.removeEventListener("resize", onChange); };
}

function getEffectiveProjectionLayerGroups() {
  const groups = (
    typeof window !== "undefined" &&
    window.LayerStateHelper &&
    typeof window.LayerStateHelper.getEffectiveLayerGroups === "function"
  )
    ? window.LayerStateHelper.getEffectiveLayerGroups()
    : OTEFDataContext.getLayerGroups();
  return isolateLayersWhileVictimNamesShown(groups);
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
  const startupSearch = typeof window !== "undefined" ? window.location.search : "";
  const projectionSpanId = parseProjectionSpanId(startupSearch);
  const projectionOutputMode = new URLSearchParams(String(startupSearch).replace(/^\?/, "")).get("outputMode") === "browser"
    ? "browser"
    : "td";
  const browserMode = !!(projectionSpanId && projectionOutputMode === "browser");
  const projectionLifecycle = createProjectionLifecycle();
  let runtimeDisposed = false;
  const disposers = [];
  const isRuntimeAlive = () => !runtimeDisposed && projectionLifecycle.isAlive();
  const registerDisposer = (fn) => {
    if (typeof fn !== "function") return;
    if (runtimeDisposed) {
      try { fn(); } catch (error) { console.warn("[projection-main] late disposer failed", error); }
      return;
    }
    disposers.push(fn);
  };
  const cleanup = () => {
    if (runtimeDisposed) return;
    runtimeDisposed = true;
    projectionLifecycle.dispose();
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
    registerDisposer(() => window.removeEventListener("beforeunload", cleanup));
  }
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
    if (!isRuntimeAlive()) return;
  }

  await OTEFDataContext.init("otef");
  if (!isRuntimeAlive()) return;
  await layerRegistry.init();
  if (!isRuntimeAlive()) return;

  const boundsResp = await fetch("data/model-bounds.json", { signal: projectionLifecycle.signal });
  if (!isRuntimeAlive()) return;
  if (!boundsResp.ok) {
    throw new Error(`Failed to load model-bounds.json (${boundsResp.status})`);
  }
  const modelBoundsData = await boundsResp.json();
  if (!isRuntimeAlive()) return;

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
    modelImgEl.__otefProjectionImage = {
      bounds: modelBounds.bounds,
      corners: imageGeoCorners,
      itmCorners: imageItmCorners,
      width: modelBoundsData.image_width,
      height: modelBoundsData.image_height,
    };
  }

  if (typeof document !== "undefined" && document.fonts && typeof document.fonts.load === "function") {
    try {
      await document.fonts.load("11px 'Guttman Hatzvi'");
      if (!isRuntimeAlive()) return;
    } catch (err) {
      console.warn("[projection-main] Guttman Hatzvi font preload failed; labels may flash", err);
    }
  }

  let capturedProjection = null;
  let effectiveProjectionConfig = DEFAULT_PROJECTION_CONFIG;
  if (projectionSpanId) {
    try {
      capturedProjection = await loadCapturedProjectionFraming({ signal: projectionLifecycle.signal });
    } catch (error) {
      if (browserMode && isRuntimeAlive() && error?.name !== "AbortError") {
        visibleProjectionBrowserError(document.getElementById("displayContainer"), error);
      }
      if (!browserMode || error?.name === "AbortError") {
        cleanup();
        return;
      }
      console.warn("[projection-main] captured framing unavailable; browser calibration will use the saved identity/default until a TD baseline is available", error);
      capturedProjection = null;
      effectiveProjectionConfig = DEFAULT_PROJECTION_CONFIG;
    }
    if (capturedProjection) effectiveProjectionConfig = capturedProjection.framing;
  }
  if (!isRuntimeAlive()) return;
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
  if (!isRuntimeAlive()) return;
  const urlOrConfigPixelRatio = resolveProjectionMapPixelRatio();
  const map = createProjectionMap("projectionMap", modelBounds, {
    ...(urlOrConfigPixelRatio !== undefined ? { pixelRatio: urlOrConfigPixelRatio } : {}),
    ...(projectionSpanId && projectionOutputMode === "browser"
      ? { canvasContextAttributes: { preserveDrawingBuffer: true } }
      : {}),
  });
  let browserSurface = null;
  const imageReadiness = browserMode && modelImgEl ? createProjectionImageReadiness({
    imageEl: modelImgEl,
    onReady: () => {
      map.triggerRepaint?.();
      getLayerLifecycleRuntime(map)?.markMemberReady("projector_base.model_base");
    },
    onInvalidate: () => map.triggerRepaint?.(),
    onError: (error) => {
      visibleProjectionBrowserError(displayContainerEl, error);
      getLayerLifecycleRuntime(map)?.markMemberFailed("projector_base.model_base");
    },
  }) : null;
  if (imageReadiness) registerDisposer(() => imageReadiness.dispose());
  if (modelImgEl && modelImageUrl) {
    if (imageReadiness) imageReadiness.setSource(modelImageUrl);
    else modelImgEl.src = modelImageUrl;
  }
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
  let projectionPattern = null;
  let lastViewport = null;
  /** @type {ReturnType<import("../shared/slideshow-pack-runtime.js").createSlideshowPackRuntime> | null} */
  let slideshowRuntime = null;

  const syncProjectionHighlight = (viewport) => {
    const exhibitMode = OTEFDataContext.getExhibitMode?.() === true;
    const slideshowActive = slideshowRuntime?.shouldSuppressProjectionHighlight?.() === true;
    const show = shouldShowProjectionViewportHighlight({ slideshowActive, exhibitMode });
    setProjectionHighlightVisibility(map, show);
    if (viewport) {
      updateHighlightFromViewport(map, viewport, modelBounds, null);
    }
    if (!show) {
      if (map.getLayer(PROJECTION_HIGHLIGHT_FILL_LAYER_ID)) {
        map.setPaintProperty(PROJECTION_HIGHLIGHT_FILL_LAYER_ID, "fill-opacity", 0);
      }
      if (map.getLayer(PROJECTION_HIGHLIGHT_LINE_LAYER_ID)) {
        map.setPaintProperty(PROJECTION_HIGHLIGHT_LINE_LAYER_ID, "line-opacity", 0);
      }
    }
  };

  /** @type {null | { toggle: () => void; setVisible: (v: boolean) => void; getActive: () => boolean; dispose: () => void }} */
  let shemotLabelDebugApi = null;
  /** @type {null | { toggle: () => void; setVisible: (v: boolean) => void; isVisible: () => boolean; dispose: () => void }} */

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
  const onProjectionMapLoad = async () => {
    if (!isRuntimeAlive()) return;
    if (projectionMapBooted) return;
    projectionMapBooted = true;
    const captionAdapter = browserMode ? createProjectionCaptionAdapter({}) : null;
    const legendAdapter = browserMode ? createProjectionLegendAdapter({}) : null;
    const patternAdapter = browserMode ? createProjectionPatternAdapter({ spanId: projectionSpanId }) : null;
    if (captionAdapter) registerDisposer(() => captionAdapter.dispose());
    if (legendAdapter) registerDisposer(() => legendAdapter.dispose());
    if (patternAdapter) registerDisposer(() => patternAdapter.dispose());
    const nameFieldController = createNliNameFieldController({ map, context: OTEFDataContext, displayProfile: "projection", projectionSpan: projectionSpanId,
      motionMode: resolveMotionMode() });
    registerDisposer(() => nameFieldController.dispose());
    const motionMode = resolveMotionMode();
    const settlementGlow = createProjectionSettlementGlow({
      map,
      loadSettlements: () => loadSettlementFeatures({}),
      motionMode,
    });
    registerDisposer(() => settlementGlow.dispose());
    const peopleRuntimePromise = loadPeopleRuntime();
    let lastPlaceId = null;
    const raiseProjectionHighlightAndGlow = (targetMap = map) => {
      raiseProjectionHighlightLayers(targetMap);
      settlementGlow.raise(targetMap);
    };
    const syncSettlementGlow = () => {
      if (lastPlaceId == null) {
        lastPlaceId = nameFieldController.getPendingPlaceId?.() ?? null;
      }
      const exhibitMode = OTEFDataContext.getExhibitMode?.() === true;
      const narrativeId = OTEFDataContext.getNarrativeState?.()?.id ?? null;
      const selection = OTEFDataContext.getPersonSelection?.();
      const wallEnabled = victimNamesAreShown(OTEFDataContext.getLayerGroups());
      const placeName = nameFieldController.placeNameForPlace?.(lastPlaceId) ?? null;
      return peopleRuntimePromise.then((runtime) => {
        const personLocation = runtime?.resolve?.(selection?.personId, selection?.datasetVersion)?.location ?? null;
        return syncProjectionSettlementGlow(settlementGlow, {
          exhibitMode,
          narrativeId,
          personLocation,
          placeName,
          wallEnabled,
        });
      }).catch(() => syncProjectionSettlementGlow(settlementGlow, {
        exhibitMode,
        narrativeId,
        personLocation: null,
        placeName,
        wallEnabled,
      }));
    };
    if (projectionSpanId) nameFieldController.setProjectionConfig(effectiveProjectionConfig);
    else nameFieldController.setProjectionConfig(DEFAULT_PROJECTION_CONFIG);
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
    let currentCaptionLayout = {};
    registerDisposer(bindProjectionClockLayout({ dataContext: OTEFDataContext, host: nliExplainerHost, span: projectionSpanId,
      onLayout: (layout) => { currentCaptionLayout = layout; }, getBrowserSurface: () => browserSurface }));
    await new Promise((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
    });
    if (!isRuntimeAlive()) return;
    const legendElement = document.getElementById("mapLegend");
    const legendSpan = nliExplainerSpanKey(
      typeof window !== "undefined" ? window.location.search : "",
    );
    let legendLifecycle = installMapLegendLifecycle({
      element: legendElement,
      surface: "projection",
      projectionSpan: legendSpan,
      dataContext: OTEFDataContext,
      registry: layerRegistry,
      onRenderSnapshot: (snapshot) => {
        legendAdapter?.sync(snapshot);
        browserSurface?.requestDraw?.();
      },
    });
    const refreshLegendAfterStyleLoad = createLegendStyleLoadRefresh(
      () => legendLifecycle,
    );
    registerDisposer(() => legendLifecycle.dispose());
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
        liveGroups: isolateLayersWhileVictimNamesShown(rawAsArray),
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
    let projectionNarrativeController = null;
    let novaEscapeCoordinator = null;
    let morRouteCoordinator = null;
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
        now: () =>
          typeof OTEFDataContext.correctedNow === "function"
            ? OTEFDataContext.correctedNow()
            : Date.now(),
        getPersonSelection: () => OTEFDataContext.getPersonSelection(),
        narrativeFocus: projectionNarrativeController?.getDefinition(),
        parallelImpactIds,
      }).then(() => {
        captionAdapter?.sync({
          snapshot: getInvestigationTimelineRenderSnapshot(map),
          layout: currentCaptionLayout,
        });
        browserSurface?.requestDraw?.();
      });
    };
    const syncContextFlowAnimations = () => {
      syncContextRouteProgress();
      syncContextInvestigation();
    };

    if (projectionSpanId && !previewMode && OTEFDataContext._wsClient) {
      projectionPattern = createProjectionPattern({
        host: document.getElementById("projectionMap") || displayContainer,
        spanId: projectionSpanId,
        onRenderSnapshot: (snapshot) => {
          patternAdapter?.sync(snapshot);
          browserSurface?.requestDraw?.();
        },
      });
      projectionPattern.setConfig(effectiveProjectionConfig);
      const patternHandler = (message) => projectionPattern.receive(message);
      const disconnectPattern = () => projectionPattern.clear();
      OTEFDataContext._wsClient.on("otef_projection_pattern", patternHandler);
      OTEFDataContext._wsClient.on("disconnect", disconnectPattern);
      registerDisposer(() => {
        projectionPattern.dispose();
        projectionPattern = null;
        OTEFDataContext._wsClient.off?.("otef_projection_pattern", patternHandler);
        OTEFDataContext._wsClient.off?.("disconnect", disconnectPattern);
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
    morRouteCoordinator = createMorRouteCoordinator({
      map,
      dataContext: OTEFDataContext,
      profile: "projection",
    });
    registerDisposer(() => morRouteCoordinator?.dispose?.());
    projectionNarrativeController = createProjectionNarrativeController({
      map,
      syncTimeline: syncContextInvestigation,
      onStyleLoadOverlay: () => {
        novaEscapeCoordinator?.onStyleLoad?.();
        morRouteCoordinator?.onStyleLoad?.();
      },
    });
    registerDisposer(() => projectionNarrativeController?.dispose());
    registerDisposer(
      OTEFDataContext.subscribe("narrativeState", (state) => {
        projectionNarrativeController?.apply(state);
        void syncSettlementGlow();
      }),
    );
    projectionNarrativeController.apply(OTEFDataContext.getNarrativeState());
    void syncSettlementGlow();
    registerDisposer(OTEFDataContext.subscribe("animations", syncContextRouteProgress));
    registerDisposer(OTEFDataContext.subscribe("investigationClock", syncContextInvestigation));
    registerDisposer(bindProjectionPersonHalo({
      map,
      subscribe: (topic, listener) => OTEFDataContext.subscribe(topic, listener),
      loadPeopleRuntime: () => peopleRuntimePromise,
      motionMode,
    }));
    const wakeProjectionPersonGlow = () => {
      wakeInvestigationTimelinePersonGlow(map);
    };
    registerDisposer(OTEFDataContext.subscribe("personSelection", wakeProjectionPersonGlow));
    registerDisposer(OTEFDataContext.subscribe("personSelection", () => {
      void syncSettlementGlow();
    }));
    registerDisposer(OTEFDataContext.subscribe("navigationCommand", (command) => {
      if (command?.cancelFocus) lastPlaceId = null;
      else if (command?.placeId) lastPlaceId = command.placeId;
      void syncSettlementGlow();
    }));
    let applyPreviewProjectionConfig = null;
    let previewApplySequence = 0;
    registerDisposer(bindProjectionHeadingStorage({ win: window, browserMode, previewMode,
      applyHeading: () => applyStoredNliLabelHeading(map), disposePreparation: disposeProjectionNameWallPreparation,
      controller: nameFieldController,
      reapplyRuntime: () => projectionRuntime?.reapply('name heading changed; rebuilding wall'),
      repreparePreview: (signal) => applyPreviewProjectionConfig?.(browserSurface.getConfig(), { signal }),
      onError: (error) => {
        if (isRuntimeAlive() && error?.name !== 'AbortError') visibleProjectionBrowserError(displayContainer, error);
      },
    }));

    let projectionMapAlive = true;
    const projectionDisplay = createCuratedDisplayGate({
      isMapAlive: () => projectionMapAlive && isRuntimeAlive(),
    });
    registerDisposer(() => {
      projectionMapAlive = false;
      projectionDisplay.dispose();
    });

    function asLayerGroupsArray(raw) {
      if (Array.isArray(raw)) return raw;
      if (raw && typeof raw === "object") return Object.values(raw);
      return [];
    }

    async function resolveMaplibregl() {
      if (typeof window !== "undefined" && window.maplibregl) return window.maplibregl;
      try {
        return (await import("maplibre-gl")).default;
      } catch (_) {
        return null;
      }
    }

    const shouldSkipLiveProjectionRefresh = () =>
      !!(
        slideshowRuntime?.isActive() &&
        MapProjectionConfig.PROJECTION_SLIDESHOW?.ignoreLiveLayerUpdatesWhileActive
      );
    const { applyProjectionRefresh } = createProjectionCuratedRefresh({
      map,
      displayGate: projectionDisplay,
      isRuntimeAlive,
      getLayerGroups: getEffectiveProjectionLayerGroups,
      asLayerGroups: asLayerGroupsArray,
      updateModelVisibility: (rawGroups, modelInfo) => syncProjectionModelImage({
        map,
        imageEl: modelImgEl,
        layerGroups: rawGroups,
        modelInfo,
        requestDraw: () => browserSurface?.requestDraw?.(),
        sealBatch: false,
        subscribeReady: imageReadiness
          ? projectionModelSubscribeReady(modelImgEl, imageReadiness)
          : undefined,
      }),
      syncProjectionLayersWithNarrative,
      applyLabelHeading: applyStoredNliLabelHeading,
      nameFieldController,
      syncFlowAnimations: syncContextFlowAnimations,
      getNarrativeController: () => projectionNarrativeController,
      refreshLegend: refreshLegendAfterStyleLoad,
      raiseHighlight: raiseProjectionHighlightAndGlow,
      resolveMaplibregl,
      syncPinkLine: syncPinkLineAxisCompanionForMapLibre,
      shouldSkipLiveRefresh: shouldSkipLiveProjectionRefresh,
    });
    let projectionCuratedRefreshChain = Promise.resolve();
    const refreshProjectionCuratedLayers = (options = {}) => {
      const groups = options.groupsOverride ?? getEffectiveProjectionLayerGroups();
      projectionCuratedRefreshChain = projectionCuratedRefreshChain
        .catch(() => {})
        .then(() => applyProjectionRefresh({ ...options, groupsOverride: groups }));
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

    syncContextInvestigation();
    await loadProjectionCuratedLayers(map);
    if (!isRuntimeAlive()) return;

    if (browserMode) {
      try {
        const { createProjectionBrowserSurface } = await import("../projection/projection-browser-route.js");
        if (!isRuntimeAlive()) return;
        const renderBrowserScene = () => {
          // MapLibre render ticks carry the canonical timeline snapshot forward;
          // the caption adapter caches unchanged snapshots and only rerasterizes
          // when the producer's model or layout actually changes.
          captionAdapter?.sync({
            snapshot: getInvestigationTimelineRenderSnapshot(map),
            layout: currentCaptionLayout,
          });
          return {
          image: imageReadiness?.contentVersion() == null ? null : createProjectionImageDescriptor({ map, imageEl: modelImgEl, contentVersion: imageReadiness.contentVersion(), config: effectiveProjectionConfig, spanId: projectionSpanId }),
          map: createProjectionMapDescriptor({ map, config: effectiveProjectionConfig, spanId: projectionSpanId }),
          caption: drawProjectionCaptionForSpan(captionAdapter, projectionSpanId),
          pattern: patternAdapter?.draw?.(),
          legend: legendAdapter?.draw?.(),
          };
        };
        const hiddenSources = [
          document.getElementById("projectionImageClip"),
          document.getElementById("projectionMap"),
          nliExplainerHost,
          legendElement,
        ];
        registerDisposer(() => browserSurface?.dispose?.());
        browserSurface = await createProjectionBrowserSurface({
          host: displayContainer,
          spanId: projectionSpanId,
          image: modelImgEl,
          mapCanvas: map.getCanvas?.(),
          getScene: renderBrowserScene,
          hideTargets: hiddenSources,
          signal: projectionLifecycle.signal,
          initialConfig: effectiveProjectionConfig,
          onContextLost: () => projectionRuntime?.invalidate?.(),
          onContextRestored: () => { projectionRuntime?.reapply?.(); map.triggerRepaint?.(); },
        });
        if (!isRuntimeAlive()) {
          browserSurface.dispose();
          browserSurface = null;
          return;
        }
        nameFieldController.installProjectionCanvas(browserSurface.getNameAdapter());
        registerDisposer(disposeProjectionNameWallPreparation);
        const unsubscribeVideoPlayback = subscribeNliVideoPlayback({
          table: OTEFDataContext._tableName || "otef",
          onChange: (active) => browserSurface?.setVideoPlaybackActive?.(active),
        });
        registerDisposer(unsubscribeVideoPlayback);
        const onMapRender = () => browserSurface?.requestDraw?.();
        map.on?.("render", onMapRender);
        registerDisposer(() => map.off?.("render", onMapRender));
      } catch (error) {
        if (isRuntimeAlive() && error?.name !== "AbortError") {
          visibleProjectionBrowserError(displayContainer, error);
          console.warn("[projection-main] browser projection unavailable", error);
        }
        return;
      }
    }

    if (previewMode && browserMode) applyPreviewProjectionConfig = async (config, { signal }) => {
        const generation = ++previewApplySequence;
        const checkCurrent = () => {
          if (signal.aborted || generation !== previewApplySequence)
            throw Object.assign(new Error('Preview superseded'), { name: 'AbortError' });
        };
        checkCurrent();
        const pair = await browserSurface.preparePair(config);
        checkCurrent();
        const field = await prepareProjectionNameWall({ config, meshes: pair.meshes,
          datasetVersion: OTEFDataContext.getPersonSelection?.()?.datasetVersion || undefined,
          heading: readNliLabelHeading(window.localStorage), signal });
        checkCurrent();
        await nameFieldController.prepareProjectionCandidate({ generation, identity: JSON.stringify(config),
          config, field, signal });
        try { checkCurrent(); }
        catch (error) { nameFieldController.rollbackProjectionCandidate(generation); throw error; }
        const previous = browserSurface.getConfig();
        browserSurface.commitPair(pair);
        try {
          if (map.setEffectiveProjectionConfig(config) === false) throw new Error('Projection camera rejected draft');
          nameFieldController.commitProjectionCandidate(generation);
          browserSurface.finalizePair(pair);
          nameFieldController.finalizeProjectionCandidate(generation);
          return { committed: true };
        } catch (error) {
          nameFieldController.rollbackProjectionCandidate(generation);
          browserSurface.rollbackPair(pair);
          map.setEffectiveProjectionConfig(previous);
          throw error;
        }
      };

    if (previewMode) registerDisposer(installProjectionPreviewBridge({
      win: window,
      output: projectionSpanId,
      map,
      nameFieldController,
      syncContextInvestigation,
      applyProjectionConfig: applyPreviewProjectionConfig,
      validateWall: browserMode ? async (config, { revision, signal }) => {
        const prepared = await browserSurface.preparePair(config);
        if (signal?.aborted) throw new Error('Wall preview superseded');
        const field = await prepareProjectionNameWall({ config, meshes: prepared.meshes,
          datasetVersion: OTEFDataContext.getPersonSelection?.()?.datasetVersion || undefined,
          heading: readNliLabelHeading(window.localStorage), signal });
        const result = projectionCandidateResult(config, field, JSON.stringify(config));
        if (!result.valid) return { reason: result.reason, diagnostics: result.diagnostics };
        return { ...result.wall, diagnostics: result.diagnostics };
      } : null,
    }));

    if (browserMode && !previewMode && OTEFDataContext._wsClient) {
      const sourceId = createUuid();
      const configClient = createProjectionConfigClient({
        table: "otef",
        sourceId,
        socket: OTEFDataContext._wsClient,
      });
      const applyBrowserConfig = (config, revision) => {
        if (browserSurface?.applyConfig?.(config) === false) throw new Error("browser projection rejected calibration");
        if (projectionConfigBridge.setEffectiveConfig(config, revision) === false) throw new Error("projection camera rejected calibration");
        if (!nameFieldController.setProjectionConfig(config, revision)) throw new Error("projection labels rejected calibration");
        projectionPattern?.setConfig?.(config);
      };
      projectionRuntime = createProjectionConfigRuntime({
        map,
        spanId: projectionSpanId,
        client: configClient,
        socket: OTEFDataContext._wsClient,
        instanceId: sourceId,
        applyConfig: applyBrowserConfig,
        prepareCandidate: async (config, revision, generation, signal) => {
          const surfacePair = await browserSurface.preparePair(config);
          if (signal?.aborted) throw Object.assign(new Error('projection preparation cancelled'), { name: 'AbortError' });
          const field = await prepareProjectionNameWall({ config, meshes: surfacePair.meshes,
            datasetVersion: OTEFDataContext.getPersonSelection?.()?.datasetVersion || undefined,
            heading: readNliLabelHeading(window.localStorage), signal });
          const wall = await nameFieldController.prepareProjectionCandidate({ generation,
            identity: JSON.stringify(config), config, field, revision, signal });
          return { surfacePair, wall, generation };
        },
        commitCandidate: (pair, config, revision) => {
          browserSurface.commitPair(pair.surfacePair);
          if (projectionConfigBridge.setEffectiveConfig(config, revision) === false) throw new Error('projection camera rejected calibration');
          nameFieldController.commitProjectionCandidate(pair.generation);
          projectionPattern?.setConfig?.(config);
        },
        rollbackCandidate: (pair, previousConfig, revision) => {
          nameFieldController.rollbackProjectionCandidate(pair.generation);
          if (!browserSurface.rollbackPair(pair.surfacePair)) return;
          projectionConfigBridge.setEffectiveConfig(previousConfig, revision);
          projectionPattern?.setConfig?.(previousConfig);
        },
        finalizeCandidate: (pair) => { nameFieldController.finalizeProjectionCandidate(pair.generation); browserSurface.finalizePair(pair.surfacePair); },
        drawCompletion: () => browserSurface?.draw?.() === true,
        getDatasetVersion: () => OTEFDataContext.getPersonSelection?.()?.datasetVersion || null,
        route: "browser",
        baseline: (config) => browserSurface?.getBaselineIdentity?.(config) || null,
      });
      registerDisposer(() => { projectionRuntime?.stop?.(); projectionRuntime = null; configClient.stop?.(); });
      await projectionRuntime.start();
      registerDisposer(OTEFDataContext.subscribe('personSelection', () => projectionRuntime?.datasetChanged?.()));
    }

    try {
      const { installShemotLabelDebug } = await import(
        "../projection/projection-shemot-label-debug.js"
      );
      if (!isRuntimeAlive()) return;
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
      syncProjectionLayers(targetMap, groups, { ...options, suppressCanvasNameSymbols: Boolean(browserSurface?.getNameAdapter()) });
      applyNarrativePeopleFilter(targetMap, OTEFDataContext.getNarrativeState?.()?.id ?? null);
      const selectedPid = OTEFDataContext.getPersonSelection?.()?.personId;
      if (selectedPid) applyPeopleFocusDim(targetMap, selectedPid);
      else clearPeopleFocusDim(targetMap);
      applyNarrativeHouseOutlineFilter(targetMap, OTEFDataContext.getNarrativeState?.()?.id ?? null);
    }

    const syncProjectionLayersAndRaiseHighlight = (projectionMap, groups, options) => {
      syncProjectionLayersWithNarrative(projectionMap, groups, options);
      nameFieldController.sync(groups);
      void syncSettlementGlow();
      applyStoredNliLabelHeading(projectionMap);
      syncContextFlowAnimations();
      projectionNarrativeController?.onStyleLoad();
      refreshLegendAfterStyleLoad();
      raiseProjectionHighlightAndGlow(projectionMap);
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
        const groups = getEffectiveProjectionLayerGroups();
        void applyProjectionRefresh({
          groupsOverride: groups,
        });
        void syncSettlementGlow();
      }),
    );
    registerDisposer(() => {
      releaseProjectionModelImage(map);
      getLayerLifecycleRuntime(map)?.dispose();
    });
    const refreshProjectionAfterStyleLoad = () => {
      if (!isRuntimeAlive()) return;
      releaseProjectionModelImage(map);
      projectionDisplay.invalidateStyle();
      const groups = getEffectiveProjectionLayerGroups();
      void applyProjectionRefresh({
        groupsOverride: groups,
        reopenGate: true,
      });
      void syncSettlementGlow();
    };
    map.on("style.load", refreshProjectionAfterStyleLoad);
    registerDisposer(() => map.off?.("style.load", refreshProjectionAfterStyleLoad));

    registerDisposer(
      OTEFDataContext.subscribe("viewport", (viewport) => {
        lastViewport = viewport;
        syncProjectionHighlight(viewport);
      }),
    );
    registerDisposer(
      OTEFDataContext.subscribe("exhibitMode", () => {
        syncProjectionHighlight(lastViewport);
        void syncSettlementGlow();
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
              void syncSettlementGlow();
              syncContextFlowAnimations();
              projectionNarrativeController?.onStyleLoad();
              refreshLegendAfterStyleLoad();
              raiseProjectionHighlightAndGlow(map);
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
  };
  const projectionMapLoadListener = () => {
    void onProjectionMapLoad().catch((error) => {
      if (browserMode && isRuntimeAlive() && error?.name !== "AbortError") {
        visibleProjectionBrowserError(document.getElementById("displayContainer"), error);
      }
      console.error("[projection-main] projection map startup failed", error);
    });
  };
  map.on("load", projectionMapLoadListener);
  registerDisposer(() => map.off?.("load", projectionMapLoadListener));
  if (map.loaded() || map._loaded) map.fire("load");

  if (previewMode) return;
  await import("../projection/projection-bounds-editor.js");
  if (!isRuntimeAlive()) return;
  await import("../projection/projection-rotation-editor.js");
  if (!isRuntimeAlive()) return;

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
    });
    if (handled) event.preventDefault();
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
  if (new URLSearchParams(window.location.search).get("clockPreview") === "1") {
    const { bootProjectionClockPreview } = await import("../projection/projection-clock-preview.js");
    await bootProjectionClockPreview({ window, document, fetchImpl: window.fetch.bind(window) });
    return;
  }
  const previewMode = new URLSearchParams(window.location.search).get("preview") === "1";
  const shouldContinue = previewMode || initializeTableSwitcher();
  if (!shouldContinue) return;
  await bootstrapProjectionRuntime();
}

boot().catch((error) => {
  const search = typeof window !== "undefined" ? window.location.search : "";
  const browserMode = parseProjectionSpanId(search) &&
    new URLSearchParams(String(search).replace(/^\?/, "")).get("outputMode") === "browser";
  if (browserMode) {
    visibleProjectionBrowserError(document.getElementById("displayContainer"), error);
  }
  console.error("[frontend-b] projection bootstrap failed", error);
});
