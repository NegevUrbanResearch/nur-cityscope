import TableSwitcher from "../shared/table-switcher.js";
import TableSwitcherPopup from "../shared/table-switcher-popup.js";
import { createGISMap, setGISBasemap, maplibregl } from "../map/maplibre-map.js";
import { setupViewportSync } from "../map/maplibre-viewport-sync.js";
import { applyLayerGroupsToMap, disposeLayerManagerForMap } from "../map/maplibre-layer-manager.js";
import { raiseDarkBasemapPlaceLabels } from "../map/dark-basemap-labels.js";
import { attachGisFeaturePopups } from "../map/maplibre-gis-popups.js";
import { createGisPersonSelection } from "../map/maplibre-person-selection.js";
import {
  createNliArchiveCommandBridge,
  createNliArchiveWindowController,
  ownsArchiveWindowCommands,
} from "../map/nli-archive-window.js";
import { createNliArchivePagerClient } from "../map/nli-archive-pager-client.js";
import { createGisPersonController } from "../map/maplibre-gis-person-controller.js";
import { createNliNameFieldController } from "../shared/nli-name-field-controller.js";
import { createGisNarrativeController } from "../map/nli-narrative-controller.js";
import { loadNliPresentationManifest } from "../shared/nli-presentation-manifest.js";
import { applyNarrativeHouseOutlineFilter, applyNarrativePeopleFilter } from "../map/nli-people-marker-filter.js";
import { applyPeopleFocusDim, clearPeopleFocusDim } from "../shared/nli-people-focus-presentation.js";
import { createNovaEscapeCoordinator } from "../shared/nli-nova-escape-coordinator.js";
import { createMorRouteCoordinator } from "../shared/nli-mor-route-coordinator.js";
import { createGisBasemapStyleCoordinator } from "./map-main-style-lifecycle.js";
import { bootClockPreview } from "../map/clock-preview.js";
import { createNovaExplainerOverlay } from "../map/nli-nova-explainer-overlay.js";
import { attachSettlementOrientationRuntime } from "../shared/nli-settlement-orientation.js";
import {
  installMapLegendLifecycle,
  positionGisLegend,
} from "../map/legend-integration.js";
import { filterGroupsForGisMap } from "../shared/gis-layer-filter.js";
import { isolateLayersWhileVictimNamesShown } from "../shared/nli-victim-name-layer-isolation.js";
import { normalizeGisBasemap } from "../shared/gis-basemap.js";
import OTEFDataContext from "../shared/OTEFDataContext.js";
import { createNliVideoPlaybackPublisher } from "../shared/nli-video-playback-channel.js";
import layerRegistry from "../shared/layer-registry.js";
import {
  createCuratedDisplayGate,
  createGisCuratedRefresh,
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
import { resolveMotionMode } from "../shared/reduced-motion.js";
import {
  applyNliExplainerLayout,
  ensureNliExplainerHost,
  gisClockLayoutSlotId,
  mergeGisClockLayout,
  NLI_GIS_CLOCK_DEFAULT_LAYOUT,
} from "../projection/nli-explainer-overlay.js";
import {
  applyNliSharedTextHeading,
  NLI_LABEL_HEADING_STORAGE_KEY,
  readNliLabelHeading,
} from "../shared/nli-label-heading.js";

const DEFAULT_MAP_CENTER = [34.5, 31.4];

function applyStoredNliLabelHeading(map) {
  applyNliSharedTextHeading(
    map,
    readNliLabelHeading(typeof window !== "undefined" ? window.localStorage : undefined),
  );
}

function updateConnectionStatus(connected) {
  const el = document.getElementById("connectionStatus");
  if (!el) return;
  el.className = connected ? "status-connected" : "status-disconnected";
  el.title = connected ? "Connected to remote" : "Disconnected";
}

function itmPointToWgs84(itmX, itmY) {
  if (
    typeof proj4 !== "function" ||
    !Number.isFinite(itmX) ||
    !Number.isFinite(itmY)
  ) {
    return null;
  }
  const [lng, lat] = proj4("EPSG:2039", "EPSG:4326", [itmX, itmY]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    return null;
  }
  return [lng, lat];
}

function resolveCenterFromBounds(bounds) {
  if (!bounds) return null;

  if (
    Number.isFinite(bounds.west) &&
    Number.isFinite(bounds.east) &&
    Number.isFinite(bounds.south) &&
    Number.isFinite(bounds.north)
  ) {
    return itmPointToWgs84(
      (bounds.west + bounds.east) / 2,
      (bounds.south + bounds.north) / 2,
    );
  }

  if (Array.isArray(bounds) && bounds.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of bounds) {
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (
      Number.isFinite(minX) &&
      Number.isFinite(minY) &&
      Number.isFinite(maxX) &&
      Number.isFinite(maxY)
    ) {
      return itmPointToWgs84((minX + maxX) / 2, (minY + maxY) / 2);
    }
  }

  return null;
}

function resolveCenterFromViewport(viewport) {
  const bbox = viewport && viewport.bbox;
  if (!Array.isArray(bbox) || bbox.length !== 4) return null;
  const [west, south, east, north] = bbox;
  return itmPointToWgs84((west + east) / 2, (south + north) / 2);
}

async function bootstrapMapRuntime() {
  const modules = [
    "../shared/logger.js",
    "../shared/map-projection-config.js",
    "../shared/message-protocol.js",
    "../shared/websocket-client.js",
    "../shared/api-client.js",
    "../shared/otef-data-context/index.js",
    "../shared/otef-data-context/OTEFDataContext-actions.js",
    "../shared/otef-data-context/OTEFDataContext-bounds.js",
    "../shared/otef-data-context/OTEFDataContext-websocket.js",
    "../shared/layer-state-helper.js",
  ];

  for (const mod of modules) {
    await import(mod);
  }

  await OTEFDataContext.init("otef");
  await layerRegistry.init();

  if (typeof document !== "undefined" && document.fonts && typeof document.fonts.load === "function") {
    try {
      await document.fonts.load("14px 'Guttman Hatzvi'");
    } catch (err) {
      console.warn("[map-main] Guttman Hatzvi font preload failed; people-name labels may flash", err);
    }
  }

  const center =
    resolveCenterFromBounds(OTEFDataContext.getBounds()) ||
    resolveCenterFromViewport(OTEFDataContext.getViewport()) ||
    DEFAULT_MAP_CENTER;

  const currentBasemap = normalizeGisBasemap(
    typeof OTEFDataContext.getBasemap === "function" ? OTEFDataContext.getBasemap() : "osm",
  );

  const map = createGISMap("map", {
    center,
    zoom: 11,
    basemap: currentBasemap,
  });
  attachSettlementOrientationRuntime(map);

  if (typeof window !== "undefined") {
    window._maplibreMap = map;
  }

  const disposers = [];
  const registerDisposer = (fn) => {
    if (typeof fn === "function") disposers.push(fn);
  };

  const runDisposers = () => {
    while (disposers.length > 0) {
      const fn = disposers.pop();
      try {
        fn();
      } catch (error) {
        console.warn("[map-main] disposer failed", error);
      }
    }
  };

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", runDisposers, { once: true });
  }

  map.on("load", async () => {
    registerDisposer(() => disposeLayerManagerForMap(map));
    let presentationViewer = null;
    const videoPlaybackPublisher = createNliVideoPlaybackPublisher({
      table: OTEFDataContext._tableName || "otef",
    });
    let presentationManifest = null;
    let activePresentationSegmentId = null;
    let activePresentationSessionId = null;
    let activePresentationGeneration = 0;
    let highestPresentationGeneration = 0;
    let presentationBootstrapActive = true;
    const emitUnavailablePresentation = (command, message = "Presentation is unavailable") => {
      if (!command || typeof command !== "object") return;
      void OTEFDataContext.narrativePresentationResult({
        segmentId: command.segmentId,
        presentationSessionId: command.presentationSessionId,
        presentationGeneration: command.presentationGeneration,
        sequence: command.sequence,
        requestId: command.requestId,
        outcome: "unavailable",
        slide: null,
        range: null,
        message,
      });
    };
    registerDisposer(() => {
      presentationBootstrapActive = false;
      presentationViewer?.dispose?.();
      presentationViewer = null;
      videoPlaybackPublisher.dispose();
    });
    registerDisposer(OTEFDataContext.subscribe("narrativePresentation", (command) => {
      if (!presentationViewer) {
        emitUnavailablePresentation(command);
        return;
      }
      if (command.presentationAction === "open") {
        if (command.presentationGeneration > highestPresentationGeneration) {
          highestPresentationGeneration = command.presentationGeneration;
          activePresentationSegmentId = command.segmentId;
          activePresentationSessionId = command.presentationSessionId;
          activePresentationGeneration = command.presentationGeneration;
        }
      } else if (command.presentationAction === "close") {
        if (command.presentationSessionId === activePresentationSessionId &&
            command.presentationGeneration === activePresentationGeneration) {
          activePresentationSegmentId = null;
        }
      }
      void presentationViewer.handleCommand(command).catch((error) => {
        console.error("[map-main] NLI presentation command failed", error);
        emitUnavailablePresentation(command);
      });
    }));
    let handledExitRevision = 0;
    const narrativeStatesBeforeExitTracker = [];
    let trackingNarrativeExits = false;
    let applyNarrativeExit = () => {};
    const onNarrativeState = (state) => {
      if (!trackingNarrativeExits) {
        narrativeStatesBeforeExitTracker.push(state);
        return;
      }
      applyNarrativeExit(state);
    };
    registerDisposer(OTEFDataContext.subscribe("narrativeState", onNarrativeState));
    void (async () => {
      try {
        const manifest = await loadNliPresentationManifest();
        const { createNliRevealPresentation, shouldCloseViewerForNarrative } = await import("../map/nli-reveal-presentation.js");
        presentationManifest = manifest;
        applyNarrativeExit = (state) => {
          const segment = activePresentationSegmentId
            ? presentationManifest?.segments?.find((candidate) => candidate.id === activePresentationSegmentId) || null
            : null;
          const decision = shouldCloseViewerForNarrative({ handledExitRevision, state, segment });
          handledExitRevision = decision.handledExitRevision;
          if (!presentationBootstrapActive || !presentationViewer || !decision.close) return;
          void presentationViewer.close();
          activePresentationSegmentId = null;
          activePresentationSessionId = null;
          activePresentationGeneration = 0;
        };
        const queuedExits = narrativeStatesBeforeExitTracker.splice(0);
        trackingNarrativeExits = true;
        for (const state of queuedExits) applyNarrativeExit(state);
        if (!presentationBootstrapActive) return;
        const mapContainer =
          typeof map.getContainer === "function" ? map.getContainer() : document.getElementById("map");
        presentationViewer = createNliRevealPresentation(mapContainer, {
          manifest,
          emitResult: (result) => { void OTEFDataContext.narrativePresentationResult(result); },
          onVideoPlaybackChange: (playing) => videoPlaybackPublisher.setActive(playing),
        });
      } catch (error) {
        trackingNarrativeExits = true;
        narrativeStatesBeforeExitTracker.length = 0;
        console.error("[map-main] NLI presentation viewer failed to load", error);
      }
    })();
    const nameFieldController = createNliNameFieldController({ map, context: OTEFDataContext, displayProfile: "gis", motionMode: resolveMotionMode() });
    registerDisposer(() => nameFieldController.dispose());
    registerDisposer(() => {
      disposeRouteProgressOverlaysForMap(map);
      disposeInvestigationTimelineForMap(map);
    });

    const mapContainer =
      typeof map.getContainer === "function" ? map.getContainer() : document.getElementById("map");
    const { host: nliGisClockHost, captionEl: nliGisClockCaptionEl } = ensureNliExplainerHost(
      mapContainer,
      { hostId: "nliGisClockHost" },
    );
    const raiseGisPlaceLabels = () => raiseDarkBasemapPlaceLabels(map, {
      narrativeId: OTEFDataContext.getNarrativeState?.()?.id ?? null,
    });
    let positionLegend = () => {};
    const applyStoredGisClockLayout = () => {
      const stored = OTEFDataContext.getNliClockLayout?.()?.gis || {};
      const slotId = gisClockLayoutSlotId(OTEFDataContext.getNarrativeState?.()?.id);
      const box = mergeGisClockLayout(slotId, stored, NLI_GIS_CLOCK_DEFAULT_LAYOUT);
      applyNliExplainerLayout(nliGisClockHost, box);
      positionLegend();
    };
    applyStoredGisClockLayout();
    const novaExplainerOverlay = createNovaExplainerOverlay({
      map,
      container: mapContainer,
      getLayout: () => OTEFDataContext.getNliClockLayout?.()?.gisOverlays?.novaExplainers,
      getNarrativeId: () => OTEFDataContext.getNarrativeState?.()?.id ?? null,
      getEscapeMor: () => OTEFDataContext.getEscapeOverlay?.()?.mor === true,
      motionMode: resolveMotionMode(),
    });
    registerDisposer(() => novaExplainerOverlay.dispose());
    registerDisposer(OTEFDataContext.subscribe("nliClockLayout", () => {
      applyStoredGisClockLayout();
      novaExplainerOverlay.refresh();
    }));
    registerDisposer(OTEFDataContext.subscribe("narrativeState", () => {
      applyStoredGisClockLayout();
      raiseGisPlaceLabels();
      novaExplainerOverlay.refresh();
    }));
    registerDisposer(OTEFDataContext.subscribe("escapeOverlay", () => {
      novaExplainerOverlay.refresh();
    }));
    const raiseGisClockHost = () => {
      if (typeof mapContainer?.appendChild !== "function" || !nliGisClockHost) return;
      mapContainer.appendChild(nliGisClockHost);
      const novaExplainerHost = document.getElementById("nliNovaExplainerHost");
      if (novaExplainerHost && document.contains(novaExplainerHost)) {
        mapContainer.appendChild(novaExplainerHost);
      }
    };
    raiseGisClockHost();
    map.on?.("style.load", raiseGisClockHost);
    registerDisposer(() => map.off?.("style.load", raiseGisClockHost));
    const onGisClockResize = () => {
      applyStoredGisClockLayout();
      positionLegend();
    };
    window.addEventListener("resize", onGisClockResize);
    registerDisposer(() => window.removeEventListener("resize", onGisClockResize));

    const gisDisplayGroups = (raw) => {
      const groupsAsArray = Array.isArray(raw) ? raw : Object.values(raw || {});
      return isolateLayersWhileVictimNamesShown(groupsAsArray);
    };
    const gisOverlayGroups = () => {
      const groupsAsArray = gisDisplayGroups(OTEFDataContext.getLayerGroups());
      return {
        groupsAsArray,
        currentGroups: filterGroupsForGisMap(groupsAsArray),
      };
    };
    const syncContextRouteProgress = () => {
      const { groupsAsArray, currentGroups } = gisOverlayGroups();
      const anim =
        typeof OTEFDataContext.getAnimations === "function" ? OTEFDataContext.getAnimations() : {};
      void syncRouteProgressOverlaysToMap(map, anim, currentGroups, {
        visibilityLayerGroups: groupsAsArray,
      }).finally(raiseGisPlaceLabels);
    };
    let narrativeController = null;
    let novaEscapeCoordinator = null;
    let morRouteCoordinator = null;
    const syncContextInvestigation = () => {
      const { groupsAsArray, currentGroups } = gisOverlayGroups();
      const clock =
        typeof OTEFDataContext.getInvestigationClock === "function"
          ? OTEFDataContext.getInvestigationClock()
          : idleNliClock();
      const correctedNow =
        typeof OTEFDataContext.correctedNow === "function"
          ? OTEFDataContext.correctedNow()
          : Date.now();
      narrativeController?.syncInvestigationClock?.(clock, correctedNow);
      void syncInvestigationTimelineToMap(map, clock, currentGroups, {
        visibilityLayerGroups: groupsAsArray,
        displayProfile: "gis",
        nliCaptionMode: "clock-only",
        motionMode: resolveMotionMode(),
        captionEl: nliGisClockCaptionEl,
        allowMapCaption: false,
        onVisualFrame: novaExplainerOverlay.sync,
        now: () =>
          typeof OTEFDataContext.correctedNow === "function"
            ? OTEFDataContext.correctedNow()
            : Date.now(),
        onClockFrame: (frameClock, frameNow) =>
          narrativeController?.syncInvestigationClock?.(frameClock, frameNow),
        getPersonSelection: () => OTEFDataContext.getPersonSelection(),
        narrativeFocus: narrativeController?.getDefinition?.() || null,
      }).finally(raiseGisPlaceLabels);
    };
    const onNliLabelHeadingStorage = (event) => {
      if (event.key !== NLI_LABEL_HEADING_STORAGE_KEY) return;
      applyStoredNliLabelHeading(map);
      nameFieldController.reload();
    };
    window.addEventListener("storage", onNliLabelHeadingStorage);
    registerDisposer(() => window.removeEventListener("storage", onNliLabelHeadingStorage));
    const syncContextFlowAnimations = () => {
      syncContextRouteProgress();
      syncContextInvestigation();
    };
    registerDisposer(OTEFDataContext.subscribe("animations", syncContextRouteProgress));
    registerDisposer(OTEFDataContext.subscribe("investigationClock", syncContextInvestigation));

    const viewportSync = setupViewportSync(map, OTEFDataContext);
    registerDisposer(viewportSync);
    let gisMapAlive = true;
    const curatedDisplay = createCuratedDisplayGate({ isMapAlive: () => gisMapAlive });
    registerDisposer(() => {
      gisMapAlive = false;
      curatedDisplay.dispose();
    });

    const layerGroups = OTEFDataContext.getLayerGroups();
    const rawInitialLayerGroups = Array.isArray(layerGroups)
      ? layerGroups
      : Object.values(layerGroups || {});
    const initialGroups = filterGroupsForGisMap(gisDisplayGroups(rawInitialLayerGroups));
    const applyGisLayerGroups = (groups, layerStyleOptions) => {
      applyLayerGroupsToMap(map, groups, layerStyleOptions);
      applyNarrativePeopleFilter(map, OTEFDataContext.getNarrativeState?.()?.id ?? null);
      const selectedPid = OTEFDataContext.getPersonSelection?.()?.personId;
      if (selectedPid) applyPeopleFocusDim(map, selectedPid);
      else clearPeopleFocusDim(map);
      applyNarrativeHouseOutlineFilter(map, OTEFDataContext.getNarrativeState?.()?.id ?? null);
      raiseGisPlaceLabels();
    };
    syncContextInvestigation();
    applyGisLayerGroups(initialGroups);
    applyStoredNliLabelHeading(map);
    syncContextRouteProgress();
    const personVisual = createGisPersonSelection({
      map,
      maplibregl,
      beginCameraTravel: viewportSync.beginCameraTravel,
      onBubbleClick: (person) => archiveBridge.openSelected(person),
    });
    const archiveWindow = createNliArchiveWindowController();
    novaEscapeCoordinator = createNovaEscapeCoordinator({
      map,
      dataContext: OTEFDataContext,
      profile: "gis",
      surface: "gis",
    });
    registerDisposer(() => novaEscapeCoordinator?.dispose?.());
    morRouteCoordinator = createMorRouteCoordinator({
      map,
      dataContext: OTEFDataContext,
      profile: "gis",
    });
    registerDisposer(() => morRouteCoordinator?.dispose?.());
    narrativeController = createGisNarrativeController({
      map,
      dataContext: OTEFDataContext,
      viewportSync,
      personVisual,
      closeArchive: () => archiveWindow.close(),
      resolveExitCenter: () => resolveCenterFromBounds(OTEFDataContext.getBounds()) || DEFAULT_MAP_CENTER,
      syncTimeline: syncContextInvestigation,
      onStyleLoadOverlay: () => {
        novaEscapeCoordinator?.onStyleLoad?.({ styleLoss: true });
        morRouteCoordinator?.onStyleLoad?.({ styleLoss: true });
      },
    });
    registerDisposer(() => narrativeController?.dispose?.());
    registerDisposer(OTEFDataContext.subscribe("narrativeState", (state) => narrativeController?.apply(state)));
    const archivePager = createNliArchivePagerClient();
    const archiveBridge = createNliArchiveCommandBridge({
      windowController: archiveWindow,
      resolvePerson: (personId, datasetVersion) => personVisual.resolve(personId, datasetVersion),
      getPersonSelection: () => OTEFDataContext.getPersonSelection(),
      emitResult: (result) => OTEFDataContext.archiveWindowResult(
        result.outcome,
        result.personId,
        result.datasetVersion,
        result.requestId,
      ),
      pageArchive: (direction, requestId) => archivePager.page(direction, requestId),
    });
    const ownsArchiveCommands = ownsArchiveWindowCommands(window.location.search);
    if (ownsArchiveCommands) {
      registerDisposer(OTEFDataContext.subscribe("archiveWindow", (command) => {
        void archiveBridge.handleCommand(command);
      }));
    }
    OTEFDataContext._markArchiveWindowBridgeReady?.(ownsArchiveCommands);
    const syncContextPersonSelection = (selection) => {
      archiveBridge.handlePersonSelection(selection);
      wakeInvestigationTimelinePersonGlow(map);
    };
    registerDisposer(OTEFDataContext.subscribe("personSelection", syncContextPersonSelection));
    const personController = createGisPersonController({
      map,
      context: OTEFDataContext,
      visual: personVisual,
      isNarrativeActive: () => narrativeController?.isActive?.() === true,
      closeArchive: () => archiveWindow.close(),
      reducedMotion: resolveMotionMode(),
    });
    registerDisposer(() => personController.dispose?.());
    registerDisposer(attachGisFeaturePopups(map, maplibregl, { onGisClick: personController.handleMapClick }));

    updateConnectionStatus(!!OTEFDataContext.isConnected?.());
    registerDisposer(
      OTEFDataContext.subscribe("connection", (connected) => {
        updateConnectionStatus(!!connected);
      }),
    );

    /**
     * Resolve the MapLibre GL JS namespace for marker creation.
     * Prefers window.maplibregl (loaded via CDN or global); falls back to dynamic import.
     */
    async function resolveMaplibregl() {
      if (typeof window !== "undefined" && window.maplibregl) return window.maplibregl;
      try {
        return (await import("maplibre-gl")).default;
      } catch (_) {
        return null;
      }
    }

    const { refreshCuratedLayers } = createGisCuratedRefresh({
      map,
      displayGate: curatedDisplay,
      getLayerGroups: () => OTEFDataContext.getLayerGroups(),
      displayGroups: gisDisplayGroups,
      filterGroups: filterGroupsForGisMap,
      applyLayerGroups: applyGisLayerGroups,
      applyLabelHeading: applyStoredNliLabelHeading,
      nameFieldController,
      personVisual,
      syncFlowAnimations: syncContextFlowAnimations,
      getNarrativeController: () => narrativeController,
      resolveMaplibregl,
      syncPinkLine: syncPinkLineAxisCompanionForMapLibre,
    });

    // Initial curated load for current layerGroups state (raw groups preserve parking toggle row).
    await refreshCuratedLayers({
      groupsOverride: rawInitialLayerGroups,
    });
    narrativeController.apply(OTEFDataContext.getNarrativeState?.());

    let legendLifecycle = null;
    const basemapCoordinator = createGisBasemapStyleCoordinator({
      map,
      initialBasemap: currentBasemap,
      setBasemap: setGISBasemap,
    });
    registerDisposer(() => basemapCoordinator.dispose());
    registerDisposer(
      OTEFDataContext.subscribe("basemap", (basemap) => {
        const nextBasemap = normalizeGisBasemap(basemap);
        basemapCoordinator.request(nextBasemap);
      }),
    );

    // layerGroups updates must drive curated lifecycle (WebSocket + manual workshop refresh).
    registerDisposer(
      OTEFDataContext.subscribe("layerGroups", (groups) => {
        syncContextFlowAnimations();
        void refreshCuratedLayers({
          groupsOverride: groups,
        });
      }),
    );

    // Curated layers (Supabase-synced overlays like annotations, pink line route)
    try {
      const { syncCuratedMapLayersAfterSupabasePull } = await import(
        "../map/map-curated-supabase-sync.js"
      );

      if (typeof window !== "undefined" && !window._otefCuratedGeojsonRefreshBound) {
        window._otefCuratedGeojsonRefreshBound = true;
        const onCuratedRefresh = (ev) => {
          void syncCuratedMapLayersAfterSupabasePull({
            pullPayload: ev?.detail || {},
            reloadCuratedOnMap: (options = {}) => refreshCuratedLayers({
              ...options,
            }),
            applyLayerGroupsState: (groups) => {
              applyGisLayerGroups(filterGroupsForGisMap(gisDisplayGroups(groups)));
              applyStoredNliLabelHeading(map);
              syncContextFlowAnimations();
              legendLifecycle?.refresh();
            },
            mapDeps: {},
          });
        };
        window.addEventListener("otef-curated-geojson-refresh", onCuratedRefresh);
        registerDisposer(() => {
          window.removeEventListener("otef-curated-geojson-refresh", onCuratedRefresh);
          window._otefCuratedGeojsonRefreshBound = false;
        });
      }
    } catch (e) {
      console.warn("[map-main] Curated layer modules not available:", e);
    }

    // Map legend
    const legendElement = document.getElementById("mapLegend");
    legendLifecycle = installMapLegendLifecycle({
      element: legendElement,
      surface: "gis",
      dataContext: OTEFDataContext,
      registry: layerRegistry,
    });
    registerDisposer(() => legendLifecycle.dispose());
    positionLegend = () => positionGisLegend({
      element: legendElement,
      clockElement: nliGisClockHost,
    });
    positionLegend();
    if (typeof ResizeObserver !== "undefined") {
      const legendPlacementObserver = new ResizeObserver(positionLegend);
      legendPlacementObserver.observe(legendElement);
      legendPlacementObserver.observe(nliGisClockHost);
      registerDisposer(() => legendPlacementObserver.disconnect());
    }
  });
}

function initializeTableSwitcher() {
  if (typeof TableSwitcher !== "function") {
    throw new Error("TableSwitcher constructor not available");
  }

  const tableSwitcher = new TableSwitcher({
    defaultTable: "otef",
    onTableChange: (tableName) => {
      if (tableName !== "otef") {
        window.location.href = `/dashboard/?table=${tableName}`;
      }
    },
  });

  window.tableSwitcher = tableSwitcher;

  if (tableSwitcher.getCurrentTable() !== "otef") {
    window.location.href = `/dashboard/?table=${tableSwitcher.getCurrentTable()}`;
    return false;
  }

  if (typeof TableSwitcherPopup === "function") {
    new TableSwitcherPopup(tableSwitcher);
  }

  return true;
}

async function boot() {
  if (new URLSearchParams(window.location.search).get("clockPreview") === "1") {
    return bootClockPreview({ window, document, fetchImpl: window.fetch.bind(window) });
  }
  const shouldContinue = initializeTableSwitcher();
  if (!shouldContinue) return;
  await bootstrapMapRuntime();
}

boot().catch((error) => console.error("[frontend-b] map bootstrap failed", error));
