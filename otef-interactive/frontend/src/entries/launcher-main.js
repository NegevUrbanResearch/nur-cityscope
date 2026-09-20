import { copyUrl } from "../shared/copy-url.js";
import { loadShareHosts, originForMode } from "../shared/share-origin.js";
import { renderQr } from "../shared/qr-code.js";

const SHARE_MODE_KEY = "otef.share.mode";
const SHARE_QR_KEY = "otef.share.qr";
const LOCAL_LINKS = [
  ["gis", "/otef-interactive/index.html"],
  ["remote", "/otef-interactive/remote-controller.html"],
  ["staffRemote", "/otef-interactive/nli-staff-remote.html"],
  ["projection", "/otef-interactive/projection.html"],
  ["projectionLeft", "/otef-interactive/projection.html?span=left"],
  ["projectionRight", "/otef-interactive/projection.html?span=right"],
  ["config", "/otef-interactive/projection-config.html"],
  ["curation", "/otef-interactive/curation.html"],
];
const SHARE_REMOTE_IDS = ["remote", "staffRemote"];

function absoluteUrl(origin, pathname) {
  try {
    return new URL(pathname, origin).href;
  } catch {
    return null;
  }
}

function setLink(document, id, href) {
  const link = document.getElementById(`${id}Open`);
  const copy = document.getElementById(`${id}Copy`);
  if (link) {
    if (href) {
      link.href = href;
      link.removeAttribute("aria-disabled");
    } else {
      link.removeAttribute("href");
      link.setAttribute("aria-disabled", "true");
    }
  }
  if (copy) copy.disabled = !href;
  if (link) link.dataset.url = href || "";
  if (copy) copy.dataset.url = href || "";
  const cardDisplayed = document.getElementById(`${id}CardUrl`);
  if (cardDisplayed) cardDisplayed.textContent = href || "—";
  else {
    const displayed = document.getElementById(`${id}Url`);
    if (displayed) displayed.textContent = href || "—";
  }
}

function linkFor(origin, id) {
  const pathname = LOCAL_LINKS.find(([linkId]) => linkId === id)?.[1];
  return pathname ? absoluteUrl(origin, pathname) : null;
}

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
    // Private mode and quota errors should not block the launcher.
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
    // Private mode and quota errors should not block the launcher.
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

function qrLinkId(target) {
  switch (target) {
    case "remote":
      return "remote";
    case "nli":
      return "staffRemote";
    default:
      throw new Error(`unknown share qr: ${target}`);
  }
}

export function initLauncher({
  document = globalThis.document,
  location = globalThis.location,
  fetchImpl = globalThis.fetch,
  clock = globalThis,
  storage = globalThis.localStorage,
} = {}) {
  if (!document || !location) return () => {};
  const pageOrigin = location.origin && location.origin !== "null" ? location.origin : null;
  for (const [id, pathname] of LOCAL_LINKS) {
    if (SHARE_REMOTE_IDS.includes(id)) {
      setLink(document, id, null);
      continue;
    }
    setLink(document, id, absoluteUrl(pageOrigin, pathname));
  }

  const shareStatus = document.getElementById("shareStatus");
  const shareUrl = document.getElementById("remoteUrl");
  const qrHost = document.getElementById("remoteQr");
  const localButton = document.getElementById("shareModeLocal");
  const tailnetButton = document.getElementById("shareModeTailnet");
  const qrRemoteButton = document.getElementById("shareQrRemote");
  const qrNliButton = document.getElementById("shareQrNli");
  let disposed = false;
  let hosts = { localOrigin: null, tailnetOrigin: null, fromShareFile: false };
  let mode = readStoredMode(storage);
  let qrTarget = readStoredQr(storage);
  const copyTimers = new Set();

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
    for (const id of SHARE_REMOTE_IDS) setLink(document, id, shareOrigin ? linkFor(shareOrigin, id) : null);
    const qrHref = shareOrigin ? linkFor(shareOrigin, qrLinkId(qrTarget)) : null;
    if (shareUrl) shareUrl.textContent = qrHref || "—";
    if (shareStatus) {
      shareStatus.textContent = qrHref
        ? "Ready to connect."
        : "Run start-otef to publish a share address.";
    }
    if (!qrHost) return;
    if (qrHref) renderQr(qrHost, qrHref, { size: 256 });
    else qrHost.replaceChildren?.();
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

  const onCopy = async (event) => {
    const button = event.currentTarget;
    const href = button?.dataset.url;
    if (!href) return;
    const copied = await copyUrl(href, { document });
    const original = button.textContent;
    button.textContent = copied ? "Copied" : "Copy failed";
    const timer = clock.setTimeout?.(() => {
      copyTimers.delete(timer);
      if (!disposed) button.textContent = original;
    }, 1800);
    if (timer != null) copyTimers.add(timer);
  };
  for (const [id] of LOCAL_LINKS) {
    document.getElementById(`${id}Copy`)?.addEventListener("click", onCopy);
  }
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
    for (const timer of copyTimers) clock.clearTimeout?.(timer);
    copyTimers.clear();
    for (const [id] of LOCAL_LINKS) document.getElementById(`${id}Copy`)?.removeEventListener("click", onCopy);
    localButton?.removeEventListener("click", onLocal);
    tailnetButton?.removeEventListener("click", onTailnet);
    qrRemoteButton?.removeEventListener("click", onQrRemote);
    qrNliButton?.removeEventListener("click", onQrNli);
  };
}

if (typeof document !== "undefined") initLauncher();
