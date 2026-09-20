import { loadShareHosts, originForMode } from "../shared/share-origin.js";
import { renderQr } from "../shared/qr-code.js";

const SHARE_MODE_KEY = "otef.share.mode";
const SHARE_QR_KEY = "otef.share.qr";
const GUEST_REMOTE_PATH = "/otef-interactive/remote-controller.html";
const STAFF_REMOTE_PATH = "/otef-interactive/nli-staff-remote.html";

function readStoredMode(storage) {
  try {
    return storage?.getItem?.(SHARE_MODE_KEY);
  } catch {
    return null;
  }
}

function writeStoredMode(storage, mode) {
  try {
    storage?.setItem?.(SHARE_MODE_KEY, mode);
  } catch {
    // Private mode and quota errors should not block the QR page.
  }
}

function readStoredQr(storage) {
  try {
    return storage?.getItem?.(SHARE_QR_KEY);
  } catch {
    return null;
  }
}

function writeStoredQr(storage, target) {
  try {
    storage?.setItem?.(SHARE_QR_KEY, target);
  } catch {
    // Private mode and quota errors should not block the QR page.
  }
}

function setPressed(button, pressed) {
  button?.setAttribute?.("aria-pressed", pressed ? "true" : "false");
}

function resolveShareMode(stored, hosts) {
  const value = stored === "local" || stored === "tailnet" ? stored : "local";
  switch (value) {
    case "local":
      return "local";
    case "tailnet":
      return hosts.tailnetOrigin ? "tailnet" : "local";
    default:
      throw new Error(`unknown share mode: ${value}`);
  }
}

function resolveQrTarget(stored) {
  const value = stored === "nli" ? "nli" : "remote";
  switch (value) {
    case "remote":
    case "nli":
      return value;
    default:
      throw new Error(`unknown share qr: ${value}`);
  }
}

function remoteHref(origin, target) {
  const pathname = (() => {
    switch (target) {
      case "remote":
        return GUEST_REMOTE_PATH;
      case "nli":
        return STAFF_REMOTE_PATH;
      default:
        throw new Error(`unknown share qr: ${target}`);
    }
  })();
  try {
    return origin ? new URL(pathname, origin).href : null;
  } catch {
    return null;
  }
}

export function initPrintableQr({
  document = globalThis.document,
  location = globalThis.location,
  fetchImpl = globalThis.fetch,
  storage = globalThis.localStorage,
} = {}) {
  if (!document || !location) return () => {};
  const target = document.getElementById("targetUrl");
  const host = document.getElementById("qrcode");
  const status = document.getElementById("shareStatus");
  const localButton = document.getElementById("shareModeLocal");
  const tailnetButton = document.getElementById("shareModeTailnet");
  const qrRemoteButton = document.getElementById("shareQrRemote");
  const qrNliButton = document.getElementById("shareQrNli");
  let disposed = false;
  let hosts = { localOrigin: null, tailnetOrigin: null, fromShareFile: false };
  let mode = readStoredMode(storage);
  let qrTarget = readStoredQr(storage);

  const clearOutput = () => {
    if (target) target.textContent = "—";
    if (status) status.textContent = "Run start-otef to publish a share address.";
    host?.replaceChildren?.();
  };

  const applyShare = () => {
    if (tailnetButton) tailnetButton.hidden = !hosts.tailnetOrigin;
    mode = resolveShareMode(mode, hosts);
    qrTarget = resolveQrTarget(qrTarget);
    writeStoredMode(storage, mode);
    writeStoredQr(storage, qrTarget);
    setPressed(localButton, mode === "local");
    setPressed(tailnetButton, mode === "tailnet");
    setPressed(qrRemoteButton, qrTarget === "remote");
    setPressed(qrNliButton, qrTarget === "nli");
    const shareOrigin = hosts.fromShareFile || hosts.localOrigin ? originForMode(mode, hosts) : null;
    const href = remoteHref(shareOrigin, qrTarget);
    if (!href) {
      clearOutput();
      return;
    }
    if (target) target.textContent = href;
    if (status) status.textContent = "Ready to connect.";
    if (host) renderQr(host, href, { size: 256 });
  };

  const setMode = (next) => {
    switch (next) {
      case "local":
      case "tailnet":
        mode = next;
        writeStoredMode(storage, mode);
        applyShare();
        return;
      default:
        throw new Error(`unknown share mode: ${next}`);
    }
  };

  const setQrTarget = (next) => {
    switch (next) {
      case "remote":
      case "nli":
        qrTarget = next;
        writeStoredQr(storage, qrTarget);
        applyShare();
        return;
      default:
        throw new Error(`unknown share qr: ${next}`);
    }
  };

  const onLocal = () => setMode("local");
  const onTailnet = () => setMode("tailnet");
  const onQrRemote = () => setQrTarget("remote");
  const onQrNli = () => setQrTarget("nli");
  localButton?.addEventListener("click", onLocal);
  tailnetButton?.addEventListener("click", onTailnet);
  qrRemoteButton?.addEventListener("click", onQrRemote);
  qrNliButton?.addEventListener("click", onQrNli);

  void loadShareHosts({ location, fetchImpl }).then((loaded) => {
    if (disposed) return;
    hosts = loaded;
    applyShare();
  });

  return () => {
    disposed = true;
    localButton?.removeEventListener("click", onLocal);
    tailnetButton?.removeEventListener("click", onTailnet);
    qrRemoteButton?.removeEventListener("click", onQrRemote);
    qrNliButton?.removeEventListener("click", onQrNli);
  };
}

if (typeof document !== "undefined") void initPrintableQr();
