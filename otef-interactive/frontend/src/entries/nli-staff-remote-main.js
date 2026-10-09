import TableSwitcher from "../shared/table-switcher.js";
import { initLocale } from "../remote/remote-locale.js";
import { bindRemoteConnectionRecovery } from "../remote/remote-connection-recovery.js";
import { initNliStaffRemote } from "../remote/nli-staff-remote.js";
import { createStaffRemoteManagement } from "../remote/staff-remote-management.js";
import { OTEF_API } from "../shared/api-client.js";
import { FRONTEND_BUILD_ID } from "../../runtime/frontend-version.js";

export { FRONTEND_BUILD_ID };

if (typeof document !== "undefined") {
  document.documentElement.dataset.frontendBuildId = FRONTEND_BUILD_ID;
}

async function bootstrapRemoteRuntime() {
  const modules = [
    "../shared/logger.js",
    "../shared/map-projection-config.js",
    "../shared/html-utils.js",
    "../shared/message-protocol.js",
    "../shared/websocket-client.js",
    "../shared/api-client.js",
    "../shared/otef-data-context/index.js",
    "../shared/otef-data-context/OTEFDataContext-actions.js",
    "../shared/otef-data-context/OTEFDataContext-bounds.js",
    "../shared/otef-data-context/OTEFDataContext-websocket.js",
    "../shared/OTEFDataContext.js",
    "../shared/layer-registry.js",
    "../shared/layer-name-utils.js",
    "../shared/layer-state-helper.js",
  ];
  for (const mod of modules) {
    await import(mod);
  }
}

function initializeTableSwitcher() {
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
  initLocale();
  if (!initializeTableSwitcher()) return;
  await bootstrapRemoteRuntime();
  const [{ default: layerRegistry }, { default: OTEFDataContext }] = await Promise.all([
    import("../shared/layer-registry.js"),
    import("../shared/OTEFDataContext.js"),
  ]);
  await layerRegistry.init();
  await OTEFDataContext.init("otef");
  bindRemoteConnectionRecovery(() => OTEFDataContext.reconnect());
  let staffRemote = null;
  let sessionStorage = null;
  try { sessionStorage = window.sessionStorage; } catch { /* refresh will reject when storage is unavailable */ }
  const management = createStaffRemoteManagement({
    socket: OTEFDataContext.getManagementSocket(),
    buildId: FRONTEND_BUILD_ID,
    getRefreshState: () => staffRemote?.getRefreshState?.() || { ready: false, refreshBlockReason: "not_ready" },
    readCanonicalState: async ({ signal }) => {
      const response = await fetch(`${OTEF_API.baseUrl}/otef/`, { signal, cache: "no-store" });
      if (!response.ok) throw new Error(`Failed to fetch canonical state: ${response.status}`);
      return response.json();
    },
    storage: sessionStorage,
    window,
    document,
    reload: () => window.location.reload(),
  });
  staffRemote = initNliStaffRemote(OTEFDataContext, { onHomeSuccess: () => management.noteHomeSuccess() });
}

boot().catch((error) => console.error("[nli-staff-remote] bootstrap failed", error));
