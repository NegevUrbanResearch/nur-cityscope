import { createProjectionConfigClient } from "../shared/projection-config-client.js";
import { createUuid } from "../shared/uuid.js";
import { loadShareHosts } from "../shared/share-origin.js";
import { copyUrl } from "../shared/copy-url.js";
import { renderQr } from "../shared/qr-code.js";
import { OTEFWebSocketClient } from "../shared/websocket-client.js";
import { mountProjectionConfig } from "../projection-config/config-controller.js";
import { createOutputWindowController } from "../projection-config/output-window-controller.js";

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

export function bootProjectionConfig({ document = globalThis.document, location = globalThis.location, fetchImpl = globalThis.fetch, socket } = {}) {
  const root = document?.getElementById("projectionConfig");
  if (!root) return () => {};
  const ws = socket || new OTEFWebSocketClient("/ws/otef/");
  const ownsSocket = !socket;
  let mounted = null;
  const client = createProjectionConfigClient({ fetchImpl, socket: ws, sourceId: createUuid(), onConflict: (message) => mounted?.setConflict?.(message) });
  const outputLocation = location?.href ? new URL("./projection.html", location.href).href : "projection.html";
  const outputController = createOutputWindowController({ location: outputLocation, open: globalThis.open, screenApi: globalThis, navigatorApi: globalThis.navigator, storage: (() => { try { return globalThis.localStorage; } catch { return null; } })() });
  mounted = mountProjectionConfig(root, { client, socket: ws, outputController, share: () => shareConfigUrl({ location, fetchImpl, document }), onExport: downloadExport, onImport: readImportFile });
  return () => { mounted.dispose(); if (ownsSocket) ws.disconnect?.(); };
}

if (typeof document !== "undefined") bootProjectionConfig();
