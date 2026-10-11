import TableSwitcher from "../shared/table-switcher.js";
import { initLocale } from "../remote/remote-locale.js";
import { bindRemoteConnectionRecovery } from "../remote/remote-connection-recovery.js";
import { initNliStaffRemote } from "../remote/nli-staff-remote.js";
import { createStaffRemoteManagement, createStaffRemoteDocumentIdentity } from "../remote/staff-remote-management.js";
import { createStaffRemoteReload } from "../remote/staff-remote-reload.js";
import { createStaffRemoteUpdates } from "../remote/staff-remote-updates.js";
import { createStaffRemoteUpdateView } from "../remote/staff-remote-update-view.js";
import { createStaffRemoteUpdateApi, readFrontendBuildId } from "../shared/staff-remote-update-api.js";
import { OTEF_API } from "../shared/api-client.js";
import { FRONTEND_BUILD_ID } from "../../runtime/frontend-version.js";
import { createNliFontSubscription } from "../shared/nli-font-subscription.js";
import { NLI_FONT_DEFAULTS } from "../shared/nli-font-settings.js";
import { createUuid } from "../shared/uuid.js";

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
  const stopRecovery = bindRemoteConnectionRecovery(() => OTEFDataContext.reconnect());
  let publishedNliFontChoices = { ...NLI_FONT_DEFAULTS };
  const getNliFontChoices = () => ({ ...publishedNliFontChoices });
  let staffRemote = null;
  let updates = null;
  const nliFontSubscription = createNliFontSubscription({
    socket: OTEFDataContext.getManagementSocket(),
    sourceId: createUuid(),
    fetchImpl: window.fetch.bind(window),
    onChoices: choices => {
      publishedNliFontChoices = choices;
      void staffRemote?.applyNliFontChoices?.(choices);
    },
    onError: error => console.warn("[nli-staff-remote] NLI font settings unavailable", error),
  });
  void nliFontSubscription.start().catch(() => {});
  window.addEventListener("beforeunload", () => nliFontSubscription.stop(), { once: true });
  let sessionStorage = null;
  let localStorage = null;
  try { sessionStorage = window.sessionStorage; } catch { /* refresh will reject when storage is unavailable */ }
  try { localStorage = window.localStorage; } catch { /* registration will report unavailable persistence */ }
  const socket = OTEFDataContext.getManagementSocket();
  const ids = createStaffRemoteDocumentIdentity({ storage: sessionStorage });
  const getRefreshState = () => staffRemote?.getRefreshState?.() || { ready: false, refreshBlockReason: "not_ready" };
  const readCanonicalState = async ({ signal }) => {
    const response = await fetch(`${OTEF_API.baseUrl}/otef/`, { signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to fetch canonical state: ${response.status}`);
    return response.json();
  };
  const reloadController = createStaffRemoteReload({ getRefreshState, readCanonicalState, isConnected: () => socket.getConnected(),
    storage: sessionStorage, ...ids, reload: () => window.location.reload() });
  const management = createStaffRemoteManagement({
    socket, ids, reloadController, getDeviceId: () => updates?.getStoredDeviceId() ?? null,
    buildId: FRONTEND_BUILD_ID,
    getRefreshState, readCanonicalState,
    storage: sessionStorage,
    window,
    document,
    reload: () => window.location.reload(),
  });
  updates = createStaffRemoteUpdates({ api: createStaffRemoteUpdateApi(), readBuildId: () => readFrontendBuildId(),
    loadedBuildId: FRONTEND_BUILD_ID, socket, reloadController, getIdentity: management.getIdentity,
    reportBinding: management.reportDeviceBinding, getRefreshState, localStorage, document, window });
  staffRemote = initNliStaffRemote(OTEFDataContext, {
    getNliFontChoices,
    onHomeSuccess: () => { management.noteHomeSuccess(); updates.refreshStateChanged(); window.otefStaffStartupReady?.(); },
    onRefreshStateChange: () => updates.refreshStateChanged(),
  });
  const view = createStaffRemoteUpdateView({ document, updates });
  window.addEventListener("pagehide", event => {
    if (event.persisted) return;
    view.dispose(); updates.dispose(); management.dispose(); reloadController.dispose(); stopRecovery();
  }, { once: true });
}

if (typeof document !== "undefined") boot().catch((error) => console.error("[nli-staff-remote] bootstrap failed", error));
