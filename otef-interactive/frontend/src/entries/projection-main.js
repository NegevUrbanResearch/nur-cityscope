import TableSwitcher from "../shared/table-switcher.js";
import TableSwitcherPopup from "../shared/table-switcher-popup.js";

async function bootstrapProjectionRuntime() {
  const modules = [
    "../shared/logger.js",
    "../shared/map-projection-config.js",
    "../shared/animation-runtime.js",
    "../map/perf-telemetry.js",
    "../map-utils/coordinate-utils.js",
    "../map-utils/pink-line-route.js",
    "../map-utils/advanced-style-engine.js",
    "../map-utils/advanced-style-drawing.js",
    "../projection/layer-renderer-canvas.js",
    "../projection/wmts-layer-renderer.js",
    "../shared/message-protocol.js",
    "../shared/websocket-client.js",
    "../shared/api-client.js",
    "../shared/otef-data-context/index.js",
    "../shared/otef-data-context/OTEFDataContext-actions.js",
    "../shared/otef-data-context/OTEFDataContext-bounds.js",
    "../shared/otef-data-context/OTEFDataContext-websocket.js",
    "../shared/OTEFDataContext.js",
    "../shared/layer-registry.js",
    "../shared/layer-state-helper.js",
    "../map-utils/style-applicator.js",
    "../projection/highlight-smoothing-policy.js",
    "../projection/projection-layer-manager.js",
    "../projection/projection-bounds-editor.js",
    "../projection/projection-rotation-editor.js",
    "../projection/projection-display.js",
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
