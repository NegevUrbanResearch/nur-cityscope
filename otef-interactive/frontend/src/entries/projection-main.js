import TableSwitcher from "../shared/table-switcher.js";
import { filterProjectionCalibrationScene } from '../shared/projection-calibration-scene.js';
import { createProjectionCalibrationView, createProjectionCalibrationCover } from '../projection/projection-calibration-view.js';
import { createProjectionCalibrationRenderer, createProjectionCalibrationMapMask, waitForProjectionCalibrationMap } from '../projection/projection-calibration-renderer.js';
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
import { attachSettlementOrientationRuntime } from "../shared/nli-settlement-orientation.js";
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
import { bindProjectionMatchCursor, readProjectionMatchLaunch } from '../projection/projection-match-cursor.js';
import { readProjectionCandidateInputs } from "../projection/projection-candidate-validation.js";
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
import { loadSettlementNameCatalog } from "../shared/settlement-name-catalog.js";
import { bindProjectionSettlementNames } from "../projection/projection-settlement-name-runtime.js";
import {
  applyProjectionSpanView,
  clearProjectionSpanBase,
  parseProjectionSpanId,
  restoreProjectionSpanBase,
  runWhenMapIdle,
  drawAfterMapRender,
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
import { resolveProjectionResolution, projectionMapPixelRatio, bindProjectionMapResolution } from '../projection/output-resolution.js';
import { getInvestigationTimelineRenderSnapshot } from "../shared/maplibre-investigation-timeline.js";
import { loadCapturedProjectionFraming } from "../projection/projection-captured-baseline.js";
import { visibleProjectionBrowserError } from "../projection/projection-browser-error.js";
import { waitForProjectionConfigStartup } from "../projection/projection-config-startup.js";
import { cancelProjectionPreviewNames, commitProjectionPreviewNamesCandidate, rollbackProjectionPreviewApply, settleProjectionPreviewTaskOnAbort } from "../projection/projection-preview-task.js";
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

function getRawEffectiveProjectionLayerGroups() {
  const groups = (
    typeof window !== "undefined" &&
    window.LayerStateHelper &&
    typeof window.LayerStateHelper.getEffectiveLayerGroups === "function"
  )
    ? window.LayerStateHelper.getEffectiveLayerGroups()
    : OTEFDataContext.getLayerGroups();
  return groups;
}
const getNormalProjectionLayerGroups = () => isolateLayersWhileVictimNamesShown(getRawEffectiveProjectionLayerGroups());

function applyStoredNliLabelHeading(map) {
  applyNliSharedTextHeading(
    map,
    readNliLabelHeading(typeof window !== "undefined" ? window.localStorage : undefined),
  );
}

let activeProjectionBrowserStartupGate = null;

function createProjectionBrowserStartupGate(host) {
  const doc = host?.ownerDocument || globalThis.document;
  if (!host || !doc?.createElement) return { ready() {}, fail() {}, dispose() {} };
  const element = doc.createElement("div");
  const message = doc.createElement("p");
  const retry = doc.createElement("button");
  element.className = "projection-browser-startup";
  element.setAttribute("role", "status");
  message.textContent = "Loading calibrated projection…";
  retry.type = "button";
  retry.textContent = "Retry calibration";
  retry.hidden = true;
  retry.addEventListener("click", () => doc.defaultView?.location?.reload?.());
  element.append(message, retry);
  Object.assign(element.style || {}, { position: "absolute", inset: "0", zIndex: "2200", display: "grid", placeContent: "center", gap: "1rem",
    padding: "2rem", color: "#fff", background: "#000", font: "700 20px sans-serif", textAlign: "center" });
  host.appendChild(element);
  const gate = {
    ready() {
      element.remove?.();
      if (activeProjectionBrowserStartupGate === gate) activeProjectionBrowserStartupGate = null;
    },
    fail(error) {
      element.setAttribute("role", "alert");
      message.textContent = `Browser calibration unavailable: ${error?.message || error}`;
      retry.hidden = false;
    },
    dispose() { element.remove?.(); },
  };
  return gate;
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
  let calibrationGroups = null, calibrationView = null, calibrationEpoch = 0, settlementNameRuntime = null;
  const calibrationActive = () => calibrationGroups !== null;
  const getEffectiveProjectionLayerGroups = () => calibrationGroups ?? getNormalProjectionLayerGroups();
  if (previewMode) document.body.classList.add("projection-preview");
  const startupSearch = typeof window !== "undefined" ? window.location.search : "";
  const projectionSpanId = parseProjectionSpanId(startupSearch);
  const projectionOutputMode = new URLSearchParams(String(startupSearch).replace(/^\?/, "")).get("outputMode") === "browser"
    ? "browser"
    : "td";
  const browserMode = !!(projectionSpanId && projectionOutputMode === "browser");
  const matchLaunch = readProjectionMatchLaunch({ spanId: projectionSpanId, search: startupSearch });
  if (browserMode && !previewMode && !matchLaunch) throw new Error('Invalid projection match display route');
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
  const browserStartupGate = browserMode
    ? createProjectionBrowserStartupGate(document.getElementById("displayContainer"))
    : null;
  if (browserStartupGate) {
    activeProjectionBrowserStartupGate = browserStartupGate;
    registerDisposer(() => {
      browserStartupGate.dispose();
      if (activeProjectionBrowserStartupGate === browserStartupGate) activeProjectionBrowserStartupGate = null;
    });
  }
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
  let projectionConfigClient = null;
  let projectionConfigHydrationPromise = null;
  let projectionConfigSourceId = null;
  if (browserMode && !previewMode) {
    if (!OTEFDataContext._wsClient) throw new Error("Projection config connection is unavailable");
    projectionConfigSourceId = createUuid();
    projectionConfigClient = createProjectionConfigClient({
      table: "otef",
      sourceId: projectionConfigSourceId,
      socket: OTEFDataContext._wsClient,
    });
    projectionConfigHydrationPromise = waitForProjectionConfigStartup(projectionConfigClient, { signal: projectionLifecycle.signal });
    registerDisposer(() => projectionConfigClient?.stop?.());
  }
  const projectionFontReady = typeof document !== "undefined" && document.fonts && typeof document.fonts.load === "function"
    ? Promise.resolve().then(() => document.fonts.load("11px 'Guttman Hatzvi'", "אבגדהוזחטיכלמנסעפצקרשת")).then((faces) => {
      if (!faces.length) throw new Error("Guttman Hatzvi font is unavailable");
    })
    : Promise.resolve();
  projectionFontReady.catch(() => {});
  const layerRegistryPromise = layerRegistry.init();
  const boundsResponsePromise = fetch("data/model-bounds.json", { signal: projectionLifecycle.signal });
  await layerRegistryPromise;
  if (!isRuntimeAlive()) return;

  const boundsResp = await boundsResponsePromise;
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

  const modelImgEl = document.getElementById("displayedImage");
  if (modelImgEl) {
    modelImgEl.__otefProjectionImage = {
      bounds: modelBounds.bounds,
      corners: imageGeoCorners,
      itmCorners: imageItmCorners,
      width: modelBoundsData.image_width,
      height: modelBoundsData.image_height,
    };
  }

  let capturedProjection = null;
  let effectiveProjectionConfig = DEFAULT_PROJECTION_CONFIG;
  if (browserMode && !previewMode) {
    const startupConfigState = await projectionConfigHydrationPromise;
    const acceptedConfig = startupConfigState?.snapshot?.config;
    if (startupConfigState?.hydrationError || !acceptedConfig || Object.keys(validateProjectionConfig(acceptedConfig)).length > 0) {
      throw new Error(startupConfigState?.hydrationError || "Accepted browser calibration is unavailable");
    }
    effectiveProjectionConfig = structuredClone(acceptedConfig);
  } else if (projectionSpanId && !browserMode) {
    try {
      capturedProjection = await loadCapturedProjectionFraming({ signal: projectionLifecycle.signal });
    } catch (error) {
      if (error?.name === "AbortError") { cleanup(); return; }
      throw error;
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
  const outputResolution = resolveProjectionResolution(window.location.search);
  const map = createProjectionMap("projectionMap", modelBounds, {
    ...(urlOrConfigPixelRatio !== undefined ? { pixelRatio: urlOrConfigPixelRatio }
      : browserMode ? { pixelRatio: projectionMapPixelRatio(outputResolution, displayContainerEl) } : {}),
    ...(projectionSpanId && projectionOutputMode === "browser"
      ? { canvasContextAttributes: { preserveDrawingBuffer: true } }
      : {}),
  });
  if (browserMode && urlOrConfigPixelRatio === undefined) registerDisposer(bindProjectionMapResolution({ map, container: displayContainerEl, resolution: outputResolution }));
  attachSettlementOrientationRuntime(map);
  let browserSurface = null;
  if (modelImgEl) {
    modelImgEl.removeAttribute?.("src");
    modelImgEl.style.opacity = "0";
  }
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
    const show = !calibrationActive() && shouldShowProjectionViewportHighlight({ slideshowActive, exhibitMode });
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
    const captionAdapter = browserMode ? createProjectionCaptionAdapter({ rasterScale: outputResolution.scale }) : null;
    const legendAdapter = browserMode ? createProjectionLegendAdapter({ rasterScale: outputResolution.scale }) : null;
    const patternAdapter = browserMode ? createProjectionPatternAdapter({ spanId: projectionSpanId, rasterScale: outputResolution.scale }) : null;
    if (captionAdapter) registerDisposer(() => captionAdapter.dispose());
    if (legendAdapter) registerDisposer(() => legendAdapter.dispose());
    if (patternAdapter) registerDisposer(() => patternAdapter.dispose());
    const nameFieldController = createNliNameFieldController({ map, context: OTEFDataContext, displayProfile: "projection", projectionSpan: projectionSpanId,
      motionMode: resolveMotionMode(), manualProjectionPreparation: browserMode });
    registerDisposer(() => nameFieldController.dispose());
    const motionMode = resolveMotionMode();
    const settlementGlow = createProjectionSettlementGlow({
      map,
      loadSettlements: () => loadSettlementFeatures({}),
      motionMode,
    });
    registerDisposer(() => settlementGlow.dispose());
    const peopleRuntimePromise = loadPeopleRuntime();
    let acceptedDatasetVersion = null;
    let acceptedDatasetIdentityError = null;
    void readProjectionCandidateInputs().then(({ datasetVersion }) => {
      acceptedDatasetVersion = datasetVersion;
      acceptedDatasetIdentityError = null;
      projectionRuntime?.datasetChanged?.();
    }).catch((error) => {
      acceptedDatasetIdentityError = `${error?.message || "Accepted name dataset identity unavailable"}. Refresh the output before retrying Run.`;
      projectionRuntime?.datasetIdentityFailed?.(acceptedDatasetIdentityError);
    });
    let lastPlaceId = null;
    const raiseProjectionHighlightAndGlow = (targetMap = map) => {
      raiseProjectionHighlightLayers(targetMap);
      settlementGlow.raise(targetMap);
    };
    const syncSettlementGlow = ({ isCurrent = () => true } = {}) => {
      const epoch = calibrationEpoch;
      const current = () => isRuntimeAlive() && epoch === calibrationEpoch && isCurrent();
      if (calibrationActive()) return settlementGlow.setFocus({ suppressed: true, isCurrent: current });
      if (lastPlaceId == null) {
        lastPlaceId = nameFieldController.getPendingPlaceId?.() ?? null;
      }
      const apply = (personLocation) => {
        if (!current() || calibrationActive()) return;
        return syncProjectionSettlementGlow({ setFocus: options => settlementGlow.setFocus({ ...options,
          isCurrent: () => current() && !calibrationActive() }) }, {
          exhibitMode: OTEFDataContext.getExhibitMode?.() === true,
          narrativeId: OTEFDataContext.getNarrativeState?.()?.id ?? null,
          personLocation,
          placeName: nameFieldController.placeNameForPlace?.(lastPlaceId) ?? null,
          wallEnabled: victimNamesAreShown(OTEFDataContext.getLayerGroups()),
        });
      };
      return peopleRuntimePromise.then((runtime) => {
        const selection = OTEFDataContext.getPersonSelection?.();
        const personLocation = runtime?.resolve?.(selection?.personId, selection?.datasetVersion)?.location ?? null;
        return apply(personLocation);
      }).catch(() => apply(null));
    };
    if (projectionSpanId) nameFieldController.setProjectionConfig(effectiveProjectionConfig);
    else nameFieldController.setProjectionConfig(DEFAULT_PROJECTION_CONFIG);
    if (!browserMode && modelBounds && modelBounds.bounds && typeof map.fitBounds === "function") {
      map.fitBounds(modelBounds.bounds, { animate: false, padding: 0 });
    }
    if (browserMode) {
      clearProjectionSpanBase(map);
      applySpanCamera();
    } else runWhenMapIdle(map, () => {
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
      if (calibrationActive()) { disposeRouteProgressOverlaysForMap(map); return; }
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
      if (calibrationActive()) { disposeInvestigationTimelineForMap(map); return; }
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
        if (calibrationActive()) return;
        novaEscapeCoordinator?.onStyleLoad?.();
        morRouteCoordinator?.onStyleLoad?.();
      },
    });
    registerDisposer(() => projectionNarrativeController?.dispose());
    registerDisposer(
      OTEFDataContext.subscribe("narrativeState", (state) => {
        projectionNarrativeController?.apply(state);
        if (calibrationActive()) {
          applyNarrativePeopleFilter(map, null); applyNarrativeHouseOutlineFilter(map, null); clearPeopleFocusDim(map);
        }
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
    let previewNamesSequence = 0;
    let previewNamesAbort = null;
    let previewNamesPromise = null;
    let previewNamesInitializationStarted = false;
      let previewGeometryAccepted = false;
    if (!browserMode) {
      registerDisposer(bindProjectionHeadingStorage({ win: window, browserMode, previewMode,
        applyHeading: () => applyStoredNliLabelHeading(map), disposePreparation: disposeProjectionNameWallPreparation,
        controller: nameFieldController,
        reapplyRuntime: () => projectionRuntime?.reapply('name heading changed; rebuilding wall'),
        repreparePreview: (signal) => applyPreviewProjectionConfig?.(browserSurface.getConfig(), { signal }),
        onError: (error) => {
          if (isRuntimeAlive() && error?.name !== 'AbortError') visibleProjectionBrowserError(displayContainer, error);
        },
      }));
    }

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
      !calibrationActive() && !!(
        slideshowRuntime?.isActive() &&
        MapProjectionConfig.PROJECTION_SLIDESHOW?.ignoreLiveLayerUpdatesWhileActive
      );
    const { applyProjectionRefresh: refreshOrdinaryScene } = createProjectionCuratedRefresh({
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
      applyLabelHeading: (targetMap) => { if (!browserMode) applyStoredNliLabelHeading(targetMap); },
      nameFieldController,
      syncFlowAnimations: syncContextFlowAnimations,
      getNarrativeController: () => calibrationActive() ? null : projectionNarrativeController,
      refreshLegend: refreshLegendAfterStyleLoad,
      raiseHighlight: raiseProjectionHighlightAndGlow,
      resolveMaplibregl,
      syncPinkLine: syncPinkLineAxisCompanionForMapLibre,
      shouldSkipLiveRefresh: shouldSkipLiveProjectionRefresh,
    });
    const applyProjectionRefresh = (options = {}) => {
      const token = calibrationEpoch, providedCurrent = options.isCurrent;
      return refreshOrdinaryScene({ ...options, groupsOverride: calibrationGroups ?? options.groupsOverride ?? getEffectiveProjectionLayerGroups(),
        isCurrent: (...args) => token === calibrationEpoch && (!providedCurrent || providedCurrent(...args)) });
    };
    let projectionCuratedRefreshChain = Promise.resolve();
    const refreshProjectionCuratedLayers = (options = {}) => {
      const token = calibrationEpoch, providedCurrent = options.isCurrent;
      const groups = options.groupsOverride ?? getEffectiveProjectionLayerGroups();
      projectionCuratedRefreshChain = projectionCuratedRefreshChain
        .catch(() => {})
        .then(() => applyProjectionRefresh({ ...options, groupsOverride: groups,
          isCurrent: (...args) => token === calibrationEpoch && (!providedCurrent || providedCurrent(...args)) }));
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
          filterScene: scene => calibrationActive() ? filterProjectionCalibrationScene(scene) : scene,
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
        try {
          const settlementCatalog = await loadSettlementNameCatalog({ registry: layerRegistry, fetchImpl: window.fetch.bind(window), signal: projectionLifecycle.signal });
          if (isRuntimeAlive()) {
            settlementNameRuntime = bindProjectionSettlementNames({
            dataContext: OTEFDataContext,
            adapter: browserSurface.getSettlementAdapter(),
            output: projectionSpanId,
            getConfig: () => effectiveProjectionConfig,
            catalog: settlementCatalog,
            map,
            getGroups: getEffectiveProjectionLayerGroups,
            getCalibrationActive: calibrationActive,
            onReadinessChange: () => calibrationView?.normalSceneChanged(),
            onDraw: () => { browserSurface?.draw?.(); },
            onError: (error) => visibleProjectionBrowserError(displayContainer, error),
            host: displayContainer,
            });
            registerDisposer(settlementNameRuntime);
          }
        } catch (error) {
          if (error?.name !== "AbortError") console.warn("Settlement names unavailable:", error?.message || error);
        }
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
          if (browserStartupGate) browserStartupGate.fail(error);
          else visibleProjectionBrowserError(displayContainer, error);
          console.warn("[projection-main] browser projection unavailable", error);
        }
        return;
      }
    }

    let previewCalibrationSequence = 0;
    const previewCalibrationSourceId = createUuid(), previewCalibrationSessionId = createUuid();
    if (browserMode && browserSurface) {
      const instanceId = projectionConfigSourceId || createUuid();
      const cover = createProjectionCalibrationCover({ document, host: displayContainer });
      const mapMask = createProjectionCalibrationMapMask({ map });
      map.on('styledata', mapMask.refresh);
      const applyScene = createProjectionCalibrationRenderer({
        setOverride: groups => { calibrationGroups = groups; calibrationEpoch += 1; if (groups) mapMask.apply(groups); else mapMask.clear(); },
        refreshScene: applyProjectionRefresh,
        readNormalGroups: getNormalProjectionLayerGroups,
        getLabels: () => settlementNameRuntime,
        draw: () => isRuntimeAlive() && browserSurface.draw(),
        waitForMap: options => waitForProjectionCalibrationMap({ map, clock: window,
          onDiagnostic: diagnostic => { browserSurface.canvas.dataset.calibrationMapDiagnostics = JSON.stringify(diagnostic); },
          getRenderedReadiness: () => getLayerLifecycleRuntime(map).getRenderedReadiness(), ...options }),
        suppressOverlays: () => {
          disposeRouteProgressOverlaysForMap(map); disposeInvestigationTimelineForMap(map);
          void syncSettlementGlow(); syncProjectionHighlight(lastViewport);
        },
        restoreOverlays: async ({ isCurrent }) => {
          await syncSettlementGlow({ isCurrent });
          if (isCurrent()) syncProjectionHighlight(lastViewport);
        },
      });
      calibrationView = createProjectionCalibrationView({ output: projectionSpanId, instanceId, clock: window,
        onState: state => Object.assign(browserSurface.canvas.dataset, {
          calibrationScene: state.active ? 'landmarks' : 'normal', calibrationReady: String(state.ready),
          calibrationSceneIdentity: state.ready ? state.sceneIdentity || '' : '', calibrationError: state.error || '',
        }),
        readRoute: () => matchLaunch || { displaySide: projectionSpanId, reversed: false },
        isVisible: () => document.visibilityState !== 'hidden' && isRuntimeAlive(),
        requestFrame: window.requestAnimationFrame.bind(window), setBlackout: cover.setBlackout, applyScene,
        readNormalScene: () => ({ groups: getRawEffectiveProjectionLayerGroups(),
          settlementSettings: OTEFDataContext.getSettlementNameSettings?.(),
          settlementRevision: OTEFDataContext.getSettlementNameRevision?.() }),
        sendAck: message => { if (!previewMode) OTEFDataContext._wsClient?.send?.(message); },
      });
      // Named read-only hooks for Task 2. No source-frame signature is produced here.
      map._otefProjectionCalibrationState = () => calibrationView.getState();
      map._otefProjectionEffectiveSceneGroups = getEffectiveProjectionLayerGroups;
      map._otefProjectionSettlementLabelReadiness = () => settlementNameRuntime?.getReadiness() || { ready: false };
      const socket = OTEFDataContext._wsClient;
      if (!previewMode && socket) {
        socket.on('otef_projection_calibration_view', calibrationView.receive);
        socket.on('disconnect', calibrationView.clear);
        registerDisposer(() => { socket.off('otef_projection_calibration_view', calibrationView.receive); socket.off('disconnect', calibrationView.clear); });
      }
      registerDisposer(() => { calibrationView.dispose(); cover.dispose();
        map.off('styledata', mapMask.refresh); mapMask.clear();
        delete map._otefProjectionCalibrationState; delete map._otefProjectionEffectiveSceneGroups; delete map._otefProjectionSettlementLabelReadiness; });
      // Local preview uses the same resolver/effect, with no physical blackout.
      map._otefSetPreviewCalibrationView = (enabled) => {
        calibrationView.receive({ type: 'otef_projection_calibration_view', table: 'otef', output: projectionSpanId, instanceId,
          sourceId: previewCalibrationSourceId, sessionId: previewCalibrationSessionId, sequence: ++previewCalibrationSequence,
          mode: enabled ? 'landmarks' : 'off', blackout: false });
        if (!enabled) return { ready: true, sceneIdentity: null, missingIds: [], error: null };
        return calibrationView.getState();
      };
      registerDisposer(() => { delete map._otefSetPreviewCalibrationView; });
    }

    if (previewMode && browserMode) {
      const throwIfPreviewAborted = (signal, generation, latest) => {
        if (signal?.aborted || generation !== latest() || !projectionMapAlive || !isRuntimeAlive())
          throw Object.assign(new Error('Preview superseded'), { name: 'AbortError' });
      };
      const rebuildPreviewNames = async (config, signal, generation) => {
        await previewNamesPromise?.catch(() => {});
        throwIfPreviewAborted(signal, generation, () => previewNamesSequence);
        await projectionFontReady;
        throwIfPreviewAborted(signal, generation, () => previewNamesSequence);
        const identity = JSON.stringify(config);
        if (JSON.stringify(browserSurface.getConfig()) !== identity) throw new Error('Run names requires the preview to match the applied calibration');
        const pair = await browserSurface.preparePair(config, signal);
        throwIfPreviewAborted(signal, generation, () => previewNamesSequence);
        const field = await prepareProjectionNameWall({ config, meshes: pair.meshes,
          datasetVersion: acceptedDatasetVersion || undefined, signal });
        throwIfPreviewAborted(signal, generation, () => previewNamesSequence);
        return commitProjectionPreviewNamesCandidate({
          prepare: () => nameFieldController.prepareProjectionCandidate({ generation, identity, config, field, signal }),
          isCurrent: () => !signal?.aborted && generation === previewNamesSequence,
          commit: () => nameFieldController.commitProjectionCandidate(generation),
          draw: () => browserSurface.draw(),
          finalize: () => nameFieldController.finalizeProjectionCandidate(generation),
          rollback: () => nameFieldController.rollbackProjectionCandidate(generation),
        });
      };
      const startPreviewNames = (config, signal) => {
        cancelPreviewNames();
        const controller = new AbortController();
        previewNamesAbort = controller;
        const generation = ++previewNamesSequence;
        const abortFromRequest = () => controller.abort();
        if (signal?.aborted) controller.abort();
        else signal?.addEventListener?.('abort', abortFromRequest, { once: true });
        const localSignal = controller.signal;
        const task = settleProjectionPreviewTaskOnAbort(rebuildPreviewNames(config, localSignal, generation), localSignal).finally(() => {
          signal?.removeEventListener?.('abort', abortFromRequest);
          if (previewNamesPromise === task) previewNamesPromise = null;
          if (previewNamesAbort?.signal === localSignal) previewNamesAbort = null;
        });
        previewNamesPromise = task;
        return task;
      };
      const cancelPreviewNames = () => {
        const generation = previewNamesSequence++;
        return cancelProjectionPreviewNames({
          abort: () => previewNamesAbort?.abort(),
          rollback: () => nameFieldController.rollbackProjectionCandidate(generation),
          pending: previewNamesPromise,
        });
      };
      registerDisposer(() => { void cancelPreviewNames(); });
      applyPreviewProjectionConfig = async (config, { signal, requestSignal = signal, runNames = false } = {}) => {
        if (runNames) {
          if (!previewGeometryAccepted) throw new Error('Preview calibration is not ready');
          return startPreviewNames(config, signal);
        }
        await cancelPreviewNames();
        const generation = ++previewApplySequence;
        const checkCurrent = () => throwIfPreviewAborted(signal, generation, () => previewApplySequence);
        const checkRequestCurrent = () => throwIfPreviewAborted(requestSignal, generation, () => previewApplySequence);
        checkCurrent();
        const previous = browserSurface.getConfig();
        const pair = await browserSurface.preparePair(config, signal);
        checkCurrent();
        try {
          browserSurface.commitPair(pair);
          const drawn = await drawAfterMapRender(map, () => browserSurface.draw(), { signal, timeoutMs: 15000, beforeRender: () => {
            checkCurrent();
            if (map.setEffectiveProjectionConfig(config) === false) throw new Error('Projection camera rejected draft');
            if (!nameFieldController.applyProjectionConfigGeometry(config, generation)) throw new Error('Projection labels rejected draft');
          } });
          checkCurrent();
          if (!drawn) throw new Error('Projection preview draw failed');
          browserSurface.finalizePair(pair);
          previewGeometryAccepted = true;
          browserStartupGate?.ready();
        } catch (error) {
          if (requestSignal?.aborted || generation !== previewApplySequence || !projectionMapAlive || !isRuntimeAlive()) throw error;
          try {
            await rollbackProjectionPreviewApply({
              isCurrent: () => !requestSignal?.aborted && generation === previewApplySequence && projectionMapAlive && isRuntimeAlive(),
              signal: requestSignal,
              rollback: () => {
                checkRequestCurrent();
                browserSurface.rollbackPair(pair);
                checkRequestCurrent();
                map.setEffectiveProjectionConfig(previous);
                checkRequestCurrent();
                nameFieldController.applyProjectionConfigGeometry(previous, generation);
              },
              redraw: (rollbackSignal) => drawAfterMapRender(map, () => {
                checkRequestCurrent();
                return browserSurface.draw();
              }, { signal: rollbackSignal, timeoutMs: 5000 }),
            });
          } catch { /* Keep the original apply error if bounded rollback cannot finish. */ }
          throw error;
        }
        if (!previewNamesInitializationStarted) {
          previewNamesInitializationStarted = true;
          void startPreviewNames(config, new AbortController().signal).catch((error) => {
          if (error?.name !== 'AbortError') console.warn('[projection-main] preview names unavailable:', error?.message || error);
          });
        }
        return { committed: true };
      };
    }

    if (previewMode) registerDisposer(installProjectionPreviewBridge({
      win: window,
      output: projectionSpanId,
      map,
      nameFieldController,
      syncContextInvestigation,
      applyProjectionConfig: applyPreviewProjectionConfig,
      setCalibrationView: (enabled, options) => map._otefSetPreviewCalibrationView?.(enabled, options),
      validateWall: browserMode ? async (config, { revision, signal }) => {
        const prepared = await browserSurface.preparePair(config);
        if (signal?.aborted) throw new Error('Wall preview superseded');
        await projectionFontReady;
        if (signal?.aborted) throw new Error('Wall preview superseded');
        const field = await prepareProjectionNameWall({ config, meshes: prepared.meshes,
          datasetVersion: acceptedDatasetVersion || undefined, signal });
        const result = projectionCandidateResult(config, field, JSON.stringify(config));
        if (!result.valid) return { reason: result.reason, diagnostics: result.diagnostics };
        return { ...result.wall, heading: field.heading, diagnostics: result.diagnostics };
      } : null,
    }));

    if (browserMode && !previewMode && projectionConfigClient && OTEFDataContext._wsClient) {
      const sourceId = projectionConfigSourceId;
      const configClient = projectionConfigClient;
      const onStartupApplied = (message) => {
        if (message?.output === projectionSpanId && message?.instanceId === sourceId && message?.success === false) {
          browserStartupGate?.fail(new Error(message.error || "The accepted calibration could not be drawn"));
        }
      };
      OTEFDataContext._wsClient.on?.("otef_projection_applied", onStartupApplied);
      registerDisposer(() => OTEFDataContext._wsClient?.off?.("otef_projection_applied", onStartupApplied));
      const applyBrowserConfig = (config, revision, geometryPair = null) => {
        if (geometryPair) browserSurface.commitPair(geometryPair);
        else if (browserSurface?.applyConfig?.(config) === false) throw new Error("browser projection rejected calibration");
        if (projectionConfigBridge.setEffectiveConfig(config, revision) === false) throw new Error("projection camera rejected calibration");
        if (map?._otefProjectionConfigRollback === true) {
          const rollbackFlag = map._otefProjectionConfigRollback;
          delete map._otefProjectionConfigRollback;
          try {
            if (!nameFieldController.applyProjectionConfigGeometry(config, revision)) throw new Error("projection labels rejected calibration");
          } finally { map._otefProjectionConfigRollback = rollbackFlag; }
        } else if (!nameFieldController.applyProjectionConfigGeometry(config, revision)) throw new Error("projection labels rejected calibration");
        projectionPattern?.setConfig?.(config);
      };
      projectionRuntime = createProjectionConfigRuntime({
        map,
        spanId: projectionSpanId,
        client: configClient,
        socket: OTEFDataContext._wsClient,
        instanceId: sourceId,
        applyConfig: applyBrowserConfig,
        prepareGeometry: (config, _revision, signal) => browserSurface.preparePair(config, signal),
        rollbackGeometry: (pair) => browserSurface.rollbackPair(pair),
        finalizeGeometry: (pair) => browserSurface.finalizePair(pair),
        prepareCandidate: async (config, revision, generation, signal) => {
          const surfacePair = await browserSurface.preparePair(config, signal);
          if (signal?.aborted) throw Object.assign(new Error('projection preparation cancelled'), { name: 'AbortError' });
          await projectionFontReady;
          if (signal?.aborted) throw Object.assign(new Error('projection preparation cancelled'), { name: 'AbortError' });
          const field = await prepareProjectionNameWall({ config, meshes: surfacePair.meshes,
            datasetVersion: acceptedDatasetVersion || undefined, signal });
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
        rollbackCandidate: (pair, previousConfig, revision, { namesOnly = false } = {}) => {
          nameFieldController.rollbackProjectionCandidate(pair.generation);
          if (namesOnly) {
            browserSurface.finalizePair(pair.surfacePair);
            return;
          }
          if (!browserSurface.rollbackPair(pair.surfacePair)) return;
          projectionConfigBridge.setEffectiveConfig(previousConfig, revision);
          projectionPattern?.setConfig?.(previousConfig);
        },
        finalizeCandidate: (pair) => { nameFieldController.finalizeProjectionCandidate(pair.generation); browserSurface.finalizePair(pair.surfacePair); },
        drawCompletion: () => {
          const drawn = browserSurface?.draw?.() === true;
          if (drawn) browserStartupGate?.ready();
          return drawn;
        },
        getDatasetVersion: () => acceptedDatasetVersion,
        getDatasetIdentityError: () => acceptedDatasetIdentityError,
        route: "browser",
        ...matchLaunch,
        baseline: (config) => browserSurface?.getBaselineIdentity?.(config) || null,
      });
      registerDisposer(() => { projectionRuntime?.stop?.(); projectionRuntime = null; });
      await projectionRuntime.start();
      const matchCursor = bindProjectionMatchCursor({ document, host: displayContainer, output: projectionSpanId,
        instanceId: sourceId, socket: OTEFDataContext._wsClient, runtime: projectionRuntime, launch: matchLaunch,
        // Task 2 installs the evaluated source-frame reader; never infer readiness from a server snapshot.
        readSourceContext: () => map._otefProjectionMatchSourceContext?.() ?? null,
        requestFrame: window.requestAnimationFrame.bind(window), cancelFrame: window.cancelAnimationFrame.bind(window), clock: window });
      map._otefProjectionMatchCursor = matchCursor;
      const onMatchRender = () => matchCursor.contextChanged();
      map.on('render', onMatchRender);
      registerDisposer(() => { map.off('render', onMatchRender); matchCursor.dispose(); delete map._otefProjectionMatchCursor; });
      if (acceptedDatasetIdentityError) projectionRuntime.datasetIdentityFailed(acceptedDatasetIdentityError);
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
      if (calibrationActive()) groups = calibrationGroups;
      syncProjectionLayers(targetMap, groups, { ...options, suppressCanvasNameSymbols: Boolean(browserSurface?.getNameAdapter()), suppressSettlementSymbols: Boolean(browserSurface?.getSettlementAdapter()) });
      applyNarrativePeopleFilter(targetMap, calibrationActive() ? null : OTEFDataContext.getNarrativeState?.()?.id ?? null);
      const selectedPid = calibrationActive() ? null : OTEFDataContext.getPersonSelection?.()?.personId;
      if (selectedPid) applyPeopleFocusDim(targetMap, selectedPid);
      else clearPeopleFocusDim(targetMap);
      applyNarrativeHouseOutlineFilter(targetMap, calibrationActive() ? null : OTEFDataContext.getNarrativeState?.()?.id ?? null);
    }

    const syncProjectionLayersAndRaiseHighlight = (projectionMap, groups, options) => {
      syncProjectionLayersWithNarrative(projectionMap, groups, options);
      nameFieldController.sync(groups);
      void syncSettlementGlow();
      if (!browserMode) applyStoredNliLabelHeading(projectionMap);
      syncContextFlowAnimations();
      if (!calibrationActive()) projectionNarrativeController?.onStyleLoad();
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
        if (calibrationActive()) { calibrationView?.normalSceneChanged(); return; }
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
      if (calibrationActive()) { calibrationView?.normalSceneChanged({force:true}); return; }
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
              if (!browserMode) applyStoredNliLabelHeading(map);
              nameFieldController.sync(Array.isArray(groups) ? groups : Object.values(groups || {}));
              void syncSettlementGlow();
              syncContextFlowAnimations();
              if (!calibrationActive()) projectionNarrativeController?.onStyleLoad();
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
  const previewParams = new URLSearchParams(window.location.search);
  const clockPreview = previewParams.get("clockPreview") === "1";
  const settlementPreview = previewParams.get("settlementPreview") === "1";
  if (settlementPreview) {
    const span = previewParams.get("span");
    if (clockPreview || !previewParams.get("previewSession") || (span !== "left" && span !== "right") || previewParams.get("outputMode") !== "browser") {
      throw new Error(clockPreview ? "Projection preview flags are mutually exclusive" : "Projection settlement preview session is missing or invalid");
    }
    const { bootProjectionSettlementNamePreview } = await import("../projection/projection-settlement-name-preview.js");
    await bootProjectionSettlementNamePreview({ window, document, fetchImpl: window.fetch.bind(window) });
    return;
  }
  if (clockPreview) {
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
    if (activeProjectionBrowserStartupGate) activeProjectionBrowserStartupGate.fail(error);
    else visibleProjectionBrowserError(document.getElementById("displayContainer"), error, { retry: () => window.location.reload() });
  }
  console.error("[frontend-b] projection bootstrap failed", error);
});
