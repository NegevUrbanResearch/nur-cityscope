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
import { withRequestDeadline } from "../shared/request-deadline.js";
import { createClockLayoutClient } from "../projection-config/clock-layout-client.js";
import { createSettlementNameClient } from "../projection-config/settlement-name-client.js";
import { createProjectionTrace } from "../projection-config/projection-trace.js";
import { loadSettlementNameCatalog } from "../shared/settlement-name-catalog.js";
import { LayerRegistry } from "../shared/layer-registry.js";

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
  const bootAbort = new AbortController();
  let traceSessionId = readProjectionTraceSession(location);
  let trace = null;
  let mounted = null;
  let layoutClient = null;
  let settlementClient = null;
  let disposed = false;
  let catalogGeneration = 0;
  let catalogAbort = null;
  let currentCatalog = { entries: [] };

  function linkedAbortSignal(...signals) {
    const controller = new AbortController();
    const listeners = [];
    const abort = (signal) => controller.abort(signal.reason);
    for (const signal of signals.filter(Boolean)) {
      if (signal.aborted) abort(signal);
      else {
        const listener = () => abort(signal);
        signal.addEventListener("abort", listener, { once: true });
        listeners.push([signal, listener]);
      }
    }
    return { signal: controller.signal, dispose: () => listeners.forEach(([signal, listener]) => signal.removeEventListener("abort", listener)) };
  }

  const getSnapshot = (options = {}) => withRequestDeadline(async (deadlineSignal) => {
    const linked = linkedAbortSignal(deadlineSignal, options.signal);
    try {
      const response = await fetchImpl(`${OTEF_API.baseUrl}/otef/`, { signal: linked.signal });
      if (!response.ok) throw new Error(`Settings unavailable: ${response.status}`);
      return await response.json();
    } finally { linked.dispose(); }
  }, { signal: bootAbort.signal });

  function showCoreError(error) {
    const panel = document.createElement("section");
    panel.className = "projection-config-boot-error";
    panel.setAttribute("role", "alert");
    const message = document.createElement("p");
    message.textContent = `Calibration could not start: ${error?.message || "settings unavailable"}`;
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry calibration";
    retry.addEventListener("click", () => { if (!disposed) mountCore(); });
    panel.append(message, retry);
    root.replaceChildren(panel);
  }

  async function startCatalog() {
    if (disposed || !mounted) return;
    const generation = ++catalogGeneration;
    catalogAbort?.abort();
    catalogAbort = new AbortController();
    mounted.setSettlementCatalog?.(currentCatalog, { status: "loading" });
    const linked = linkedAbortSignal(bootAbort.signal, catalogAbort.signal);
    try {
      const catalog = await withRequestDeadline(async (signal) => {
        const request = linkedAbortSignal(signal, linked.signal);
        try {
          const registry = new LayerRegistry({ fetchImpl: (url, options = {}) => fetchImpl(url, { ...options, signal: request.signal }) });
          await registry.init();
          return await loadSettlementNameCatalog({ registry, fetchImpl: (url, options = {}) => fetchImpl(url, { ...options, signal: request.signal }), signal: request.signal });
        } finally { request.dispose(); }
      }, { signal: linked.signal });
      if (!disposed && generation === catalogGeneration) {
        currentCatalog = catalog;
        mounted?.setSettlementCatalog?.(catalog, { status: "ready" });
      }
    } catch (error) {
      if (!disposed && generation === catalogGeneration) mounted?.setSettlementCatalog?.(currentCatalog, { status: "error", error: error?.message || "Settlement list unavailable" });
    } finally { linked.dispose(); }
  }

  function mountCore() {
    if (disposed) return;
    let client = null;
    let outputController = null;
    let candidateValidator = null;
    try {
      traceSessionId = readProjectionTraceSession(location);
      trace = createProjectionTrace({ sessionId: traceSessionId, socket: ws, window: document?.defaultView || globalThis.window, document });
      const layoutSourceId = createUuid();
      layoutClient = createClockLayoutClient({
        tableName: "otef", getSnapshot,
        writeClockSlot: (intent) => OTEF_API.setNliClockLayout("otef", intent.surface, intent.slot, intent.layout, { baseRevision: intent.baseRevision, sourceId: layoutSourceId }),
        writeLegendSlot: (intent) => OTEF_API.setLegendSettings("otef", { span: intent.span, layout: intent.layout }, { baseRevision: intent.baseRevision }), socket: ws,
      });
      settlementClient = createSettlementNameClient({ getSnapshot,
        writeOperation: (body) => OTEF_API.setSettlementNames("otef", body, { sourceId: createUuid() }), socket: ws,
      });
      client = createProjectionConfigClient({ fetchImpl, socket: ws, sourceId: createUuid(), onConflict: (message) => mounted?.setConflict?.(message) });
      const outputLocation = location?.href ? new URL("./projection.html", location.href).href : "projection.html";
      outputController = createOutputWindowController({ location: outputLocation, open: globalThis.open, screenApi: globalThis, navigatorApi: globalThis.navigator, storage: (() => { try { return globalThis.localStorage; } catch { return null; } })() });
      const baselineCatalogLoader = createProjectionBaselineCatalogLoader({ fetchImpl });
      candidateValidator = createProjectionGeometryValidator({ baselineCatalogLoader });
      mounted = mountProjectionConfig(root, { client, socket: ws, layoutClient, settlementClient, catalog: { entries: [] }, catalogStatus: { status: "loading" }, retrySettlementCatalog: () => { void startCatalog(); }, outputController, candidateValidator, baselineCatalogLoader,
        readNamesDataset: () => readProjectionCandidateInputs({ fetchImpl }), trace,
        share: () => shareConfigUrl({ location, fetchImpl, document, traceSessionId: trace.enabled ? traceSessionId : null }), onExport: downloadExport, onImport: readImportFile });
      void layoutClient.hydrate({ forceFresh: true }).catch(() => {});
      void settlementClient.hydrate({ forceFresh: true }).catch(() => {});
      void startCatalog();
    } catch (error) {
      try { mounted?.dispose?.(); } catch {}
      mounted = null;
      try { layoutClient?.destroy?.(); } catch {}
      layoutClient = null;
      try { settlementClient?.destroy?.(); } catch {}
      settlementClient = null;
      try { client?.stop?.(); } catch {}
      try { outputController?.dispose?.(); } catch {}
      try { candidateValidator?.dispose?.(); } catch {}
      try { trace?.dispose?.(); } catch {}
      trace = null;
      showCoreError(error);
    }
  }

  mountCore();
  return () => {
    if (disposed) return;
    disposed = true;
    catalogGeneration += 1;
    catalogAbort?.abort();
    bootAbort.abort();
    try { mounted?.dispose?.(); } catch {}
    try { layoutClient?.destroy?.(); } catch {}
    try { settlementClient?.destroy?.(); } catch {}
    try { trace?.dispose?.(); } catch {}
    if (ownsSocket) { try { ws.disconnect?.(); } catch {} }
  };
}

if (typeof document !== "undefined") void bootProjectionConfig().catch((error) => console.error("[projection-config] boot failed", error));
