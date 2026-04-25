import TableSwitcher from "../shared/table-switcher.js";
import TableSwitcherPopup from "../shared/table-switcher-popup.js";
import { createGISMap } from "../map/maplibre-map.js";
import { setupViewportSync } from "../map/maplibre-viewport-sync.js";
import { applyLayerGroupsToMap, removeCuratedLayersByPrefix } from "../map/maplibre-layer-manager.js";
import { filterGroupsForGisMap } from "../shared/gis-layer-filter.js";
import OTEFDataContext from "../shared/OTEFDataContext.js";
import layerRegistry from "../shared/layer-registry.js";
import {
  loadCuratedLayerToMapLibre,
  removeCuratedHtmlMarkers,
  syncPinkLineAxisCompanionForMapLibre,
} from "../map/maplibre-curated-layer-loader.js";
import {
  applyContextFlowAnimationsToMap,
  startFlowAnimation,
  stopFlowAnimation,
  stopAllFlowAnimations,
} from "../shared/maplibre-flow-animation.js";

const DEFAULT_MAP_CENTER = [34.5, 31.4];

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

  const center =
    resolveCenterFromBounds(OTEFDataContext.getBounds()) ||
    resolveCenterFromViewport(OTEFDataContext.getViewport()) ||
    DEFAULT_MAP_CENTER;

  const map = createGISMap("map", {
    center,
    zoom: 11,
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
    if (typeof window !== "undefined") {
      window.MapLibreFlowAnimation = {
        startFlowAnimation: (layerId, opts) => startFlowAnimation(map, layerId, opts),
        stopFlowAnimation: (layerId) => stopFlowAnimation(map, layerId),
        stopAllFlowAnimations: () => stopAllFlowAnimations(map),
      };
    }
    registerDisposer(() => stopAllFlowAnimations(map));

    const syncContextFlowAnimations = () => {
      applyContextFlowAnimationsToMap(
        map,
        typeof OTEFDataContext.getAnimations === "function"
          ? OTEFDataContext.getAnimations()
          : {},
      );
    };
    registerDisposer(OTEFDataContext.subscribe("animations", syncContextFlowAnimations));

    registerDisposer(setupViewportSync(map, OTEFDataContext));
    let activeCuratedIds = new Set();

    const layerGroups = OTEFDataContext.getLayerGroups();
    const rawInitialLayerGroups = Array.isArray(layerGroups)
      ? layerGroups
      : Object.values(layerGroups || {});
    const initialGroups = filterGroupsForGisMap(rawInitialLayerGroups);
    applyLayerGroupsToMap(map, initialGroups);
    syncContextFlowAnimations();

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

    const refreshCuratedLayers = async ({ affectedCuratedFullLayerIds, groupsOverride } = {}) => {
      const rawGroups = groupsOverride ?? OTEFDataContext.getLayerGroups();
      const groupsAsArray = Array.isArray(rawGroups)
        ? rawGroups
        : Object.values(rawGroups || {});
      const currentGroups = filterGroupsForGisMap(groupsAsArray);

      // Apply non-curated layer changes via registry path.
      applyLayerGroupsToMap(map, currentGroups);
      syncContextFlowAnimations();

      // Determine which curated ids to refresh.
      const enabledCuratedIds = new Set(collectEnabledCuratedIds(currentGroups));
      const previousCuratedIds = new Set(activeCuratedIds);
      activeCuratedIds = enabledCuratedIds;

      // Disabled curated IDs must always be detached.
      for (const fullId of previousCuratedIds) {
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
        syncContextFlowAnimations();
        syncPinkLineAxisCompanionForMapLibre(map, groupsAsArray);
        return;
      }

      const maplibregl = await resolveMaplibregl();
      for (const fullId of toRefresh) {
        try {
          await loadCuratedLayerToMapLibre(map, fullId, { maplibregl, force: true });
        } catch (err) {
          console.warn(`[map-main] Failed to load curated layer ${fullId}`, err);
        }
      }
      syncContextFlowAnimations();
      syncPinkLineAxisCompanionForMapLibre(map, groupsAsArray);
    };

    // Initial curated load for current layerGroups state (raw groups preserve parking toggle row).
    await refreshCuratedLayers({ groupsOverride: rawInitialLayerGroups });

    // layerGroups updates must drive curated lifecycle (WebSocket + manual workshop refresh).
    registerDisposer(
      OTEFDataContext.subscribe("layerGroups", (groups) => {
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
              applyLayerGroupsToMap(
                map,
                filterGroupsForGisMap(
                  Array.isArray(groups) ? groups : Object.values(groups || {}),
                ),
              );
              syncContextFlowAnimations();
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
    try {
      const { updateMapLegend } = await import("../map/map-legend.js");
      registerDisposer(
        OTEFDataContext.subscribe("layerGroups", () => {
          updateMapLegend(OTEFDataContext.getLayerGroups());
        }),
      );
      updateMapLegend(OTEFDataContext.getLayerGroups());
    } catch (e) {
      console.warn("[map-main] Legend module not available:", e);
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
