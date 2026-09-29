import { createProjectionConfigClient } from "../shared/projection-config-client.js";
import { createUuid } from "../shared/uuid.js";
import { loadShareHosts } from "../shared/share-origin.js";
import { copyUrl } from "../shared/copy-url.js";
import { renderQr } from "../shared/qr-code.js";
import { OTEFWebSocketClient } from "../shared/websocket-client.js";
import { mountProjectionConfig } from "../projection-config/config-controller.js";
import { createOutputWindowController } from "../projection-config/output-window-controller.js";
import { loadCapturedProjectionAsset, loadCapturedProjectionFraming } from '../projection/projection-captured-baseline.js';
import { createProjectionCandidateValidator, readProjectionCandidateInputs } from '../projection/projection-candidate-validation.js';
import { disposeProjectionNameWallPreparation, prepareProjectionNameWall } from '../shared/nli-name-field-data.js';
import { OTEF_API } from "../shared/api-client.js";
import { createClockLayoutClient } from "../projection-config/clock-layout-client.js";
import { createSettlementNameClient } from "../projection-config/settlement-name-client.js";
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

async function shareConfigUrl({ location = globalThis.location, fetchImpl = globalThis.fetch, document = globalThis.document } = {}) {
  const hosts = await loadShareHosts({ location, fetchImpl });
  const origin = hosts.fromShareFile ? hosts.localOrigin : location.origin;
  if (!origin || origin === "null") return null;
  const url = new URL("/otef-interactive/projection-config.html", origin).href;
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
  let mounted = null;
  const layoutSourceId = createUuid();
  const layoutClient = createClockLayoutClient({
    tableName: "otef",
    getSnapshot: (options) => OTEF_API.getState("otef", options),
    writeClockSlot: (intent) => OTEF_API.setNliClockLayout("otef", intent.surface, intent.slot, intent.layout, { baseRevision: intent.baseRevision, sourceId: layoutSourceId }),
    writeLegendSlot: (intent) => OTEF_API.setLegendSettings("otef", { span: intent.span, layout: intent.layout }, { baseRevision: intent.baseRevision }),
    socket: ws,
  });
  try { await layoutClient.hydrate({ forceFresh: true }); } catch { /* The client retains hydration health for the editor's Retry action. */ }
  const settlementClient = createSettlementNameClient({
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
  const capturedBySignal = new WeakMap();
  const candidateValidator = createProjectionCandidateValidator({
    loadBaseline: async (side, signal) => {
      let captured = capturedBySignal.get(signal);
      if (!captured) {
        captured = loadCapturedProjectionFraming({ fetchImpl, signal });
        capturedBySignal.set(signal, captured);
      }
      return loadCapturedProjectionAsset({ fetchImpl, spanId: side, captured: await captured, signal });
    },
    prepareWall: prepareProjectionNameWall,
    readInputs: (signal) => readProjectionCandidateInputs({ fetchImpl, signal }),
    disposePreparation: disposeProjectionNameWallPreparation,
  });
  mounted = mountProjectionConfig(root, { client, socket: ws, layoutClient, settlementClient, catalog, outputController, candidateValidator, share: () => shareConfigUrl({ location, fetchImpl, document }), onExport: downloadExport, onImport: readImportFile });
  return () => { mounted.dispose(); layoutClient.destroy(); settlementClient.destroy(); if (ownsSocket) ws.disconnect?.(); };
}

if (typeof document !== "undefined") void bootProjectionConfig().catch((error) => console.error("[projection-config] boot failed", error));
