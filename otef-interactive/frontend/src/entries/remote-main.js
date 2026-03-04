import TableSwitcher from "../shared/table-switcher.js";

async function bootstrapRemoteRuntime() {
  const modules = [
    "../shared/logger.js",
    "../shared/html-utils.js",
    "../shared/message-protocol.js",
    "../shared/websocket-client.js",
    "../shared/api-client.js",
    "../shared/otef-data-context/index.js",
    "../shared/otef-data-context/OTEFDataContext-actions.js",
    "../shared/otef-data-context/OTEFDataContext-bounds.js",
    "../shared/otef-data-context/OTEFDataContext-websocket.js",
    "../shared/OTEFDataContext.js",
    "../shared/orientation-transform.js",
    "../shared/layer-registry.js",
    "../shared/layer-name-utils.js",
    "../shared/layer-state-helper.js",
    "../remote/remote-controller.js",
    "../remote/layer-sheet-controller.js",
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
        window.location.href = `/remote-controller/?table=${tableName}`;
      }
    },
  });

  if (tableSwitcher.getCurrentTable() !== "otef") {
    window.location.href = `/remote-controller/?table=${tableSwitcher.getCurrentTable()}`;
    return false;
  }

  tableSwitcher.createSwitcherUI();
  return true;
}

async function boot() {
  const shouldContinue = initializeTableSwitcher();
  if (!shouldContinue) return;
  await bootstrapRemoteRuntime();
}

boot().catch((error) => console.error("[frontend-b] remote bootstrap failed", error));
