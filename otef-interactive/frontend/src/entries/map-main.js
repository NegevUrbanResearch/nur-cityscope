import TableSwitcher from "../shared/table-switcher.js";
import TableSwitcherPopup from "../shared/table-switcher-popup.js";

async function bootstrapMapRuntime() {
  const modules = [
    "../shared/logger.js",
    "../shared/map-projection-config.js",
    "../shared/html-utils.js",
    "../map-utils/coordinate-utils.js",
    "../map-utils/popup-renderer.js",
    "../map-utils/advanced-style-engine.js",
    "../map-utils/advanced-style-drawing.js",
    "../map-utils/advanced-pmtiles-layer.js",
    "../map-utils/layer-factory.js",
    "../map-utils/visibility-utils.js",
    "../map-utils/visibility-controller.js",
    "../shared/message-protocol.js",
    "../shared/websocket-client.js",
    "../shared/api-client.js",
    "../shared/otef-data-context/index.js",
    "../shared/otef-data-context/OTEFDataContext-actions.js",
    "../shared/otef-data-context/OTEFDataContext-bounds.js",
    "../shared/otef-data-context/OTEFDataContext-websocket.js",
    "../shared/OTEFDataContext.js",
    "../shared/layer-state-helper.js",
    "../shared/layer-registry.js",
    "../shared/layer-name-utils.js",
    "../shared/gis-layer-filter.js",
    "../map-utils/style-applicator.js",
    "../map-utils/pink-line-route.js",
    "../map/map-options.js",
    "../map/perf-telemetry.js",
    "../map/viewport-apply-policy.js",
    "../map/viewport-sync-scheduler.js",
    "../map/leaflet-control-with-basemap.js",
    "../map/layer-state-manager.js",
    "../map/map-legend.js",
    "../map/viewport-sync.js",
    "../map/map-initialization.js",
  ];

  for (const mod of modules) {
    await import(mod);
  }
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
