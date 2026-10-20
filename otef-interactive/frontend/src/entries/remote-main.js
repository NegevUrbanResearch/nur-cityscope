import TableSwitcher from "../shared/table-switcher.js";
import { initLocale } from "../remote/remote-locale.js";
import { bindRemoteConnectionRecovery } from "../remote/remote-connection-recovery.js";
import { installRegularRemoteManagement } from "../remote/regular-remote-management.js";
import { FRONTEND_BUILD_ID } from "../../runtime/frontend-version.js";

export { FRONTEND_BUILD_ID };
if (typeof document !== "undefined") document.documentElement.dataset.frontendBuildId = FRONTEND_BUILD_ID;

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
    "../shared/orientation-transform.js",
    "../shared/layer-registry.js",
    "../shared/layer-name-utils.js",
    "../shared/layer-state-helper.js",
    "../remote/remote-controller.js",
    "../remote/layer-sheet-controller.js",
    "../remote/slideshow-tab-controller.js",
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
  initLocale();
  const shouldContinue = initializeTableSwitcher();
  if (!shouldContinue) return;
  await bootstrapRemoteRuntime();
  const { remoteReady } = await import("../remote/remote-controller.js");
  await remoteReady;
  const [{ initRemotePlaceNavigation, placeIsWithinRemoteBounds }, { default: OTEFDataContext }] = await Promise.all(
    [
      import("../remote/remote-place-navigation.js"),
      import("../shared/OTEFDataContext.js"),
    ],
  );

  const stopRecovery = bindRemoteConnectionRecovery(() => OTEFDataContext.reconnect());
  const navigation = initRemotePlaceNavigation({
    dataContext: OTEFDataContext,
    isConnected: () => OTEFDataContext.isConnected?.() !== false,
    narrativeActive: () => !!OTEFDataContext.getNarrativeState?.()?.id,
    canNavigateToPlace: (place) => placeIsWithinRemoteBounds(place, OTEFDataContext),
  });
  const management = installRegularRemoteManagement({ dataContext: OTEFDataContext, loadedBuildId: FRONTEND_BUILD_ID });
  const dispose = event => {
    if (event.persisted) return;
    management.dispose(); navigation?.destroy(); stopRecovery();
    window.removeEventListener("pagehide", dispose);
  };
  window.addEventListener("pagehide", dispose);
}

boot().catch((error) => console.error("[frontend-b] remote bootstrap failed", error));
