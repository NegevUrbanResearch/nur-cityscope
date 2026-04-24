import TableSwitcher from "../shared/table-switcher.js";
import TableSwitcherPopup from "../shared/table-switcher-popup.js";
import { createGISMap } from "../map/maplibre-map.js";
import { setupViewportSync } from "../map/maplibre-viewport-sync.js";
import { applyLayerGroupsToMap } from "../map/maplibre-layer-manager.js";
import OTEFDataContext from "../shared/OTEFDataContext.js";
import layerRegistry from "../shared/layer-registry.js";

function updateConnectionStatus(connected) {
  const el = document.getElementById("connectionStatus");
  if (!el) return;
  el.className = connected ? "status-connected" : "status-disconnected";
  el.title = connected ? "Connected to remote" : "Disconnected";
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

  const bounds = OTEFDataContext.getBounds();
  const center =
    bounds && typeof proj4 !== "undefined"
      ? proj4("EPSG:2039", "EPSG:4326", [
          (bounds.west + bounds.east) / 2,
          (bounds.south + bounds.north) / 2,
        ])
      : [34.5, 31.4];

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
    registerDisposer(setupViewportSync(map, OTEFDataContext));

    const layerGroups = OTEFDataContext.getLayerGroups();
    applyLayerGroupsToMap(map, layerGroups);

    registerDisposer(
      OTEFDataContext.subscribe("layerGroups", (groups) => {
        applyLayerGroupsToMap(map, groups);
      }),
    );

    updateConnectionStatus(!!OTEFDataContext.isConnected?.());
    registerDisposer(
      OTEFDataContext.subscribe("connection", (connected) => {
        updateConnectionStatus(!!connected);
      }),
    );

    const refreshCuratedLayers = ({ affectedCuratedFullLayerIds } = {}) => {
      const currentGroups = OTEFDataContext.getLayerGroups();
      if (!Array.isArray(affectedCuratedFullLayerIds) || affectedCuratedFullLayerIds.length === 0) {
        applyLayerGroupsToMap(map, currentGroups);
        return;
      }

      const groupsAsArray = Array.isArray(currentGroups)
        ? currentGroups
        : Object.values(currentGroups || {});
      const affectedSet = new Set(
        affectedCuratedFullLayerIds.filter((id) => typeof id === "string"),
      );
      const temporaryGroups = groupsAsArray.map((group) => ({
        ...group,
        layers: (group.layers || []).map((layer) => {
          const fullId = `${group.id}.${layer.id}`;
          if (!affectedSet.has(fullId)) return layer;
          return { ...layer, enabled: false };
        }),
      }));

      // Force-remove only affected curated layers, then re-apply live state.
      applyLayerGroupsToMap(map, temporaryGroups);
      applyLayerGroupsToMap(map, currentGroups);
    };

    // Curated layers (Supabase-synced overlays like annotations, pink line route)
    try {
      const { syncCuratedMapLayersAfterSupabasePull } = await import(
        "../map/map-curated-supabase-sync.js"
      );
      const { startCuratedSupabaseHeartbeat } = await import(
        "../shared/curated-supabase-heartbeat.js"
      );

      if (typeof window !== "undefined" && !window._otefCuratedGeojsonRefreshBound) {
        window._otefCuratedGeojsonRefreshBound = true;
        const onCuratedRefresh = (ev) => {
          void syncCuratedMapLayersAfterSupabasePull({
            pullPayload: ev?.detail || {},
            reloadCuratedOnMap: refreshCuratedLayers,
            applyLayerGroupsState: (groups) => applyLayerGroupsToMap(map, groups),
            mapDeps: {},
          });
        };
        window.addEventListener("otef-curated-geojson-refresh", onCuratedRefresh);
        registerDisposer(() => {
          window.removeEventListener("otef-curated-geojson-refresh", onCuratedRefresh);
          window._otefCuratedGeojsonRefreshBound = false;
        });
      }

      const stopCuratedHeartbeat = startCuratedSupabaseHeartbeat({
        table: "otef",
        onUpdated: async (data) => {
          await syncCuratedMapLayersAfterSupabasePull({
            pullPayload: data,
            reloadCuratedOnMap: refreshCuratedLayers,
            applyLayerGroupsState: (groups) => applyLayerGroupsToMap(map, groups),
            mapDeps: {},
          });
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent("nur-curated-supabase-pull", { detail: { source: "gis" } }),
            );
          }
        },
      });
      registerDisposer(stopCuratedHeartbeat);
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
