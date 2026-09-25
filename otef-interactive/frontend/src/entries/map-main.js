import TableSwitcher from "../shared/table-switcher.js";
import TableSwitcherPopup from "../shared/table-switcher-popup.js";
import { createGISMap, setGISBasemap, maplibregl } from "../map/maplibre-map.js";
import { setupViewportSync } from "../map/maplibre-viewport-sync.js";
import { applyLayerGroupsToMap, clearAllLayers, disposeLayerManagerForMap, removeCuratedLayersByPrefix } from "../map/maplibre-layer-manager.js";
import { raiseDarkBasemapPlaceLabels } from "../map/dark-basemap-labels.js";
import { attachGisFeaturePopups } from "../map/maplibre-gis-popups.js";
import { createGisPersonSelection } from "../map/maplibre-person-selection.js";
import { createNliArchiveCommandBridge, createNliArchiveWindowController } from "../map/nli-archive-window.js";
import { createGisPersonController } from "../map/maplibre-gis-person-controller.js";
import { createNliNameFieldController } from "../shared/nli-name-field-controller.js";
import { createGisNarrativeController } from "../map/nli-narrative-controller.js";
import { applyNarrativePeopleFilter } from "../map/nli-people-marker-filter.js";
import { createNovaEscapeCoordinator } from "../shared/nli-nova-escape-coordinator.js";
import { createMorRouteCoordinator } from "../shared/nli-mor-route-coordinator.js";
import { createGisBasemapStyleCoordinator } from "./map-main-style-lifecycle.js";
import {
  createLegendStyleLoadRefresh,
  installMapLegendLifecycle,
  positionGisLegend,
} from "../map/legend-integration.js";
import { filterGroupsForGisMap } from "../shared/gis-layer-filter.js";
import { isolateLayersWhileVictimNamesShown } from "../shared/nli-victim-name-layer-isolation.js";
import { normalizeGisBasemap } from "../shared/gis-basemap.js";
import OTEFDataContext from "../shared/OTEFDataContext.js";
import layerRegistry from "../shared/layer-registry.js";
import {
  loadCuratedLayerToMapLibre,
  removeCuratedHtmlMarkers,
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
  NLI_GIS_CLOCK_LAYOUT_STORAGE_KEY,
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

  let currentBasemap = normalizeGisBasemap(
    typeof OTEFDataContext.getBasemap === "function" ? OTEFDataContext.getBasemap() : "osm",
  );

  const map = createGISMap("map", {
    center,
    zoom: 11,
    basemap: currentBasemap,
  });

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
    let positionLegend = () => {};
    const applyStoredGisClockLayout = () => {
      const stored = OTEFDataContext.getNliClockLayout?.()?.gis || {};
      const slotId = gisClockLayoutSlotId(OTEFDataContext.getNarrativeState?.()?.id);
      const box = mergeGisClockLayout(slotId, stored, NLI_GIS_CLOCK_DEFAULT_LAYOUT);
      applyNliExplainerLayout(nliGisClockHost, box);
      positionLegend();
    };
    applyStoredGisClockLayout();
    registerDisposer(OTEFDataContext.subscribe("nliClockLayout", () => {
      if (window.NliExplainerDebug?.isVisible?.()) return;
      applyStoredGisClockLayout();
    }));
    registerDisposer(OTEFDataContext.subscribe("narrativeState", () => {
      if (window.NliExplainerDebug?.isVisible?.()) return;
      applyStoredGisClockLayout();
    }));
    const raiseGisClockHost = () => {
      if (typeof mapContainer?.appendChild !== "function" || !nliGisClockHost) return;
      mapContainer.appendChild(nliGisClockHost);
    };
    raiseGisClockHost();
    map.on?.("style.load", raiseGisClockHost);
    registerDisposer(() => map.off?.("style.load", raiseGisClockHost));
    const onGisClockResize = () => {
      if (window.NliExplainerDebug?.isVisible?.()) return;
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
      }).finally(() => raiseDarkBasemapPlaceLabels(map));
    };
    let explainerDebugVisible = false;
    let nliGisClockDebugApi = null;
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
        explainerDebugVisible: explainerDebugVisible === true,
        now: () =>
          typeof OTEFDataContext.correctedNow === "function"
            ? OTEFDataContext.correctedNow()
            : Date.now(),
        onClockFrame: (frameClock, frameNow) =>
          narrativeController?.syncInvestigationClock?.(frameClock, frameNow),
        getPersonSelection: () => OTEFDataContext.getPersonSelection(),
        narrativeFocus: narrativeController?.getDefinition?.() || null,
      }).finally(() => raiseDarkBasemapPlaceLabels(map));
    };
    try {
      nliGisClockDebugApi = installNliExplainerDebug({
        host: nliGisClockHost,
        captionEl: nliGisClockCaptionEl,
        registerDisposer,
        storageKey: NLI_GIS_CLOCK_LAYOUT_STORAGE_KEY,
        defaultLayout: NLI_GIS_CLOCK_DEFAULT_LAYOUT,
        enableSpanGuards: false,
        enableLayoutMapExport: false,
        mergeProjectionLayout: false,
        enableRotation: true,
        // GIS clock layout debug: ?ned=1 / nliExplainerDebug=1 or E
        initialVisible: isNliExplainerDebugRequestedInUrl(
          typeof window !== "undefined" ? window.location.search : "",
        ),
        onVisibleChange: (visible) => {
          explainerDebugVisible = visible === true;
          syncContextInvestigation();
        },
        getRemoteLayoutMap: () => OTEFDataContext.getNliClockLayout?.()?.gis || {},
        persistRemoteLayoutMap: (layout) => OTEFDataContext.setNliClockLayout({
          surface: "gis",
          layout,
        }),
      });
      if (typeof window !== "undefined" && nliGisClockDebugApi) {
        window.NliExplainerDebug = nliGisClockDebugApi;
        registerDisposer(() => {
          if (window.NliExplainerDebug === nliGisClockDebugApi) {
            delete window.NliExplainerDebug;
          }
          nliGisClockDebugApi = null;
        });
      }
    } catch (e) {
      console.warn("[map-main] NLI GIS clock debug failed to load", e);
    }
    nliGisClockDebugApi?.setGisClockLayoutSlot?.(
      gisClockLayoutSlotId(OTEFDataContext.getNarrativeState?.()?.id),
    );
    const onGisClockKeyDown = (event) => {
      if (event.defaultPrevented || event.repeat) return;
      const target = event.target;
      const targetTag = target?.tagName;
      if (targetTag === "INPUT" || targetTag === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      const key = String(event.key || "").toLowerCase();
      if (key === "e") {
        const handled = window.NliExplainerDebug?.handleGisClockHotkey?.(event);
        if (handled) event.preventDefault();
      }
    };
    window.addEventListener("keydown", onGisClockKeyDown);
    registerDisposer(() => window.removeEventListener("keydown", onGisClockKeyDown));
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
    let activeCuratedIds = new Set();

    const layerGroups = OTEFDataContext.getLayerGroups();
    const rawInitialLayerGroups = Array.isArray(layerGroups)
      ? layerGroups
      : Object.values(layerGroups || {});
    const initialGroups = filterGroupsForGisMap(gisDisplayGroups(rawInitialLayerGroups));
    const applyGisLayerGroups = (groups) => {
      applyLayerGroupsToMap(map, groups);
      applyNarrativePeopleFilter(map, OTEFDataContext.getNarrativeState?.()?.id ?? null);
      raiseDarkBasemapPlaceLabels(map);
    };
    applyGisLayerGroups(initialGroups);
    applyStoredNliLabelHeading(map);
    syncContextFlowAnimations();
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
    registerDisposer(OTEFDataContext.subscribe("narrativeState", (state) => {
      nliGisClockDebugApi?.setGisClockLayoutSlot?.(
        gisClockLayoutSlotId(state?.id ?? OTEFDataContext.getNarrativeState?.()?.id),
      );
    }));
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
    });
    registerDisposer(OTEFDataContext.subscribe("archiveWindow", (command) => { void archiveBridge.handleCommand(command); }));
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
     * Collect enabled curated fullLayerIds from current layer groups.
     * @param {Array} groups - filtered GIS layer groups
     * @returns {string[]}
     */
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

    const refreshCuratedLayers = async ({ affectedCuratedFullLayerIds, groupsOverride, syncFlow = true, isCurrent = () => true } = {}) => {
      if (!isCurrent()) return;
      const rawGroups = groupsOverride ?? OTEFDataContext.getLayerGroups();
      const groupsAsArray = gisDisplayGroups(rawGroups);
      const currentGroups = filterGroupsForGisMap(groupsAsArray);

      // Apply non-curated layer changes via registry path.
      if (!isCurrent()) return;
      applyGisLayerGroups(currentGroups);
      applyStoredNliLabelHeading(map);
      nameFieldController.sync(currentGroups);
      personVisual.bringToFront?.();
      if (syncFlow) syncContextFlowAnimations();

      // Determine which curated ids to refresh.
      const enabledCuratedIds = new Set(collectEnabledCuratedIds(currentGroups));
      const previousCuratedIds = new Set(activeCuratedIds);
      activeCuratedIds = enabledCuratedIds;

      // Disabled curated IDs must always be detached.
      for (const fullId of previousCuratedIds) {
        if (!isCurrent()) return;
        if (!enabledCuratedIds.has(fullId)) {
          removeCuratedLayersByPrefix(map, fullId);
          removeCuratedHtmlMarkers(fullId);
        }
      }

      let toRefresh;
      if (Array.isArray(affectedCuratedFullLayerIds) && affectedCuratedFullLayerIds.length > 0) {
        const affectedSet = new Set(affectedCuratedFullLayerIds.filter((id) => typeof id === "string"));
        // Remove all affected curated layers first, then re-load affected ids that remain enabled.
        for (const fullId of affectedSet) {
          if (!isCurrent()) return;
          removeCuratedLayersByPrefix(map, fullId);
          removeCuratedHtmlMarkers(fullId);
        }
        toRefresh = [...enabledCuratedIds].filter((id) => affectedSet.has(id));
      } else {
        // Full refresh semantics: reload all enabled curated layers.
        // Needed for Supabase pulls that omit affected layer ids.
        toRefresh = [...enabledCuratedIds];
      }

      if (toRefresh.length === 0) {
        if (!isCurrent()) return;
        if (syncFlow) syncContextFlowAnimations();
        personVisual.bringToFront?.();
        syncPinkLineAxisCompanionForMapLibre(map, groupsAsArray);
        if (!isCurrent()) return;
        narrativeController.onStyleLoad?.();
        return;
      }

      const maplibregl = await resolveMaplibregl();
      for (const fullId of toRefresh) {
        if (!isCurrent()) return;
        try {
          await loadCuratedLayerToMapLibre(map, fullId, { maplibregl, force: true });
        } catch (err) {
          console.warn(`[map-main] Failed to load curated layer ${fullId}`, err);
        }
      }
      if (!isCurrent()) return;
      if (syncFlow) syncContextFlowAnimations();
      personVisual.bringToFront?.();
      syncPinkLineAxisCompanionForMapLibre(map, groupsAsArray);
      if (!isCurrent()) return;
      narrativeController.onStyleLoad?.();
    };

    // Initial curated load for current layerGroups state (raw groups preserve parking toggle row).
    await refreshCuratedLayers({ groupsOverride: rawInitialLayerGroups });
    narrativeController.apply(OTEFDataContext.getNarrativeState?.());

    let legendLifecycle = null;
    const refreshLegendAfterStyleLoad = createLegendStyleLoadRefresh(
      () => legendLifecycle,
    );
    const basemapCoordinator = createGisBasemapStyleCoordinator({
      map,
      initialBasemap: currentBasemap,
      setBasemap: setGISBasemap,
      personVisual,
      narrativeController,
      getLayerGroups: () => OTEFDataContext.getLayerGroups(),
      onStyleLoad: refreshLegendAfterStyleLoad,
      refreshLayers: async ({ basemap, groupsOverride, syncFlow = false, isCurrent }) => {
        if (!isCurrent()) return;
        currentBasemap = basemap;
        clearAllLayers(map);
        activeCuratedIds = new Set();
        if (!isCurrent()) return;
        await refreshCuratedLayers({
          groupsOverride: groupsOverride ?? OTEFDataContext.getLayerGroups(),
          syncFlow,
          isCurrent,
        });
        if (!isCurrent()) return;
        if (!syncFlow) syncContextFlowAnimations();
      },
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
        void refreshCuratedLayers({ groupsOverride: groups });
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
            reloadCuratedOnMap: refreshCuratedLayers,
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
  const shouldContinue = initializeTableSwitcher();
  if (!shouldContinue) return;
  await bootstrapMapRuntime();
}

boot().catch((error) => console.error("[frontend-b] map bootstrap failed", error));
