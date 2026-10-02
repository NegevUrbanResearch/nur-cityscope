import { createProjectionConfigClient } from "../shared/projection-config-client.js";
import { createUuid } from "../shared/uuid.js";
import { loadShareHosts } from "../shared/share-origin.js";
import { copyUrl } from "../shared/copy-url.js";
import { renderQr } from "../shared/qr-code.js";
import { OTEFWebSocketClient } from "../shared/websocket-client.js";
import { mountProjectionConfig } from "../projection-config/config-controller.js";
import { createOutputWindowController } from "../projection-config/output-window-controller.js";
import { createProjectionBaselineCatalogLoader } from '../projection/projection-captured-baseline.js';
import { createProjectionGeometryValidator, readProjectionCandidateInputs } from '../projection/projection-candidate-validation.js';
import { OTEF_API } from "../shared/api-client.js";
import { createClockLayoutClient } from "../projection-config/clock-layout-client.js";
import { createSettlementNameClient } from "../projection-config/settlement-name-client.js";
import { createProjectionTrace } from "../projection-config/projection-trace.js";
import { loadSettlementNameCatalog } from "../shared/settlement-name-catalog.js";
import layerRegistry from "../shared/layer-registry.js";

function downloadExport(content, name) {
  if (typeof document === "undefined" || typeof URL?.createObjectURL !== "function") return;
  const blob = new Blob([content], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${String(name || "projection-calibration").replace(/[^a-z0-9_-]+/gi, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function readImportFile(file) {
  if (!file || typeof file.text !== "function") throw new Error("select a calibration JSON file");
  return file.text();
}

const PROJECTION_TRACE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readProjectionTraceSession(location = globalThis.location) {
  try {
    const search = location?.href ? new URL(location.href).search : location?.search;
    const values = new URLSearchParams(search || "").getAll("projectionTrace");
    return values.length === 1 && PROJECTION_TRACE_UUID.test(values[0]) ? values[0] : null;
  } catch { return null; }
}

export async function shareConfigUrl({ location = globalThis.location, fetchImpl = globalThis.fetch, document = globalThis.document, traceSessionId = null } = {}) {
  const hosts = await loadShareHosts({ location, fetchImpl });
  const origin = hosts.fromShareFile ? hosts.localOrigin : location.origin;
  if (!origin || origin === "null") return null;
  const shareUrl = new URL("/otef-interactive/projection-config.html", origin);
  if (typeof traceSessionId === "string" && PROJECTION_TRACE_UUID.test(traceSessionId)) shareUrl.searchParams.set("projectionTrace", traceSessionId);
  const url = shareUrl.href;
  const copied = await copyUrl(url, { document });
  const qrHost = document?.getElementById("shareQr");
  let qrRendered = false;
  if (qrHost) { try { renderQr(qrHost, url, { size: 240 }); qrRendered = true; } catch { qrHost.replaceChildren(); } }
  return { href: url, copied, qrRendered };
}

export async function bootProjectionConfig({ document = globalThis.document, location = globalThis.location, fetchImpl = globalThis.fetch, socket } = {}) {
  const root = document?.getElementById("projectionConfig");
  if (!root) return () => {};
  const ws = socket || new OTEFWebSocketClient("/ws/otef/");
  const ownsSocket = !socket;
  const traceSessionId = readProjectionTraceSession(location);
  const trace = createProjectionTrace({ sessionId: traceSessionId, socket: ws, window: document?.defaultView || globalThis.window, document });
  let mounted = null;
  let layoutClient = null;
  let settlementClient = null;
  try {
  const layoutSourceId = createUuid();
  layoutClient = createClockLayoutClient({
    tableName: "otef",
    getSnapshot: (options) => OTEF_API.getState("otef", options),
    writeClockSlot: (intent) => OTEF_API.setNliClockLayout("otef", intent.surface, intent.slot, intent.layout, { baseRevision: intent.baseRevision, sourceId: layoutSourceId }),
    writeLegendSlot: (intent) => OTEF_API.setLegendSettings("otef", { span: intent.span, layout: intent.layout }, { baseRevision: intent.baseRevision }),
    socket: ws,
  });
  try { await layoutClient.hydrate({ forceFresh: true }); } catch { /* The client retains hydration health for the editor's Retry action. */ }
  settlementClient = createSettlementNameClient({
    getSnapshot: (options) => OTEF_API.getState("otef", options),
    writeOperation: (body) => OTEF_API.setSettlementNames("otef", body, { sourceId: createUuid() }),
    socket: ws,
  });
  try { await settlementClient.hydrate({ forceFresh: true }); } catch { /* Retry stays available when settings are missing or uninitialized. */ }
  let catalog = { entries: [] };
  try {
    await layerRegistry.init();
    catalog = await loadSettlementNameCatalog({ registry: layerRegistry, fetchImpl });
  } catch { catalog = { entries: [] }; }
  const client = createProjectionConfigClient({ fetchImpl, socket: ws, sourceId: createUuid(), onConflict: (message) => mounted?.setConflict?.(message) });
  const outputLocation = location?.href ? new URL("./projection.html", location.href).href : "projection.html";
  const outputController = createOutputWindowController({ location: outputLocation, open: globalThis.open, screenApi: globalThis, navigatorApi: globalThis.navigator, storage: (() => { try { return globalThis.localStorage; } catch { return null; } })() });
  const baselineCatalogLoader = createProjectionBaselineCatalogLoader({ fetchImpl });
  const candidateValidator = createProjectionGeometryValidator({ baselineCatalogLoader });
  mounted = mountProjectionConfig(root, { client, socket: ws, layoutClient, settlementClient, catalog, outputController, candidateValidator, baselineCatalogLoader,
    readNamesDataset: () => readProjectionCandidateInputs({ fetchImpl }),
    trace, share: () => shareConfigUrl({ location, fetchImpl, document, traceSessionId: trace.enabled ? traceSessionId : null }), onExport: downloadExport, onImport: readImportFile });
  return () => { mounted.dispose(); layoutClient.destroy(); settlementClient.destroy(); trace.dispose(); if (ownsSocket) ws.disconnect?.(); };
  } catch (error) {
    try { mounted?.dispose?.(); } catch { /* preserve the boot error */ }
    try { layoutClient?.destroy?.(); } catch { /* preserve the boot error */ }
    try { settlementClient?.destroy?.(); } catch { /* preserve the boot error */ }
    try { trace.dispose?.(); } catch { /* preserve the boot error */ }
    if (ownsSocket) { try { ws.disconnect?.(); } catch { /* preserve the boot error */ } }
    throw error;
  }
}

if (typeof document !== "undefined") void bootProjectionConfig().catch((error) => console.error("[projection-config] boot failed", error));
