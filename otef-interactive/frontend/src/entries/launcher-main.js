import { copyUrl } from "../shared/copy-url.js";
import { loadShareOrigin } from "../shared/share-origin.js";
import { renderQr } from "../shared/qr-code.js";

const REFRESH_MS = 15_000;
const LOCAL_LINKS = [
  ["gis", "/otef-interactive/index.html"],
  ["projection", "/otef-interactive/projection.html"],
  ["projectionLeft", "/otef-interactive/projection.html?span=left"],
  ["projectionRight", "/otef-interactive/projection.html?span=right"],
  ["config", "/otef-interactive/projection-config.html"],
  ["curation", "/otef-interactive/curation.html"],
];

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
  const displayed = document.getElementById(`${id}Url`);
  if (displayed) displayed.textContent = href || "—";
  const cardDisplayed = document.getElementById(`${id}CardUrl`);
  if (cardDisplayed) cardDisplayed.textContent = href || "—";
}

export function initLauncher({
  document = globalThis.document,
  location = globalThis.location,
  fetchImpl = globalThis.fetch,
  now,
  clock = globalThis,
} = {}) {
  if (!document || !location) return () => {};
  const localOrigin = location.origin && location.origin !== "null" ? location.origin : null;
  for (const [id, pathname] of LOCAL_LINKS) {
    const href = absoluteUrl(localOrigin, pathname);
    setLink(document, id, href);
  }
  setLink(document, "remote", null);

  const remoteCopy = document.getElementById("remoteCopy");
  const shareStatus = document.getElementById("shareStatus");
  const qrHost = document.getElementById("remoteQr");
  let disposed = false;
  let refreshTimer = null;
  let refreshSerial = 0;
  const copyTimers = new Set();

  const setShareUnavailable = () => {
    setLink(document, "remote", null);
    if (shareStatus) shareStatus.textContent = "Network address unavailable.";
    if (qrHost) qrHost.replaceChildren?.();
  };

  const refreshShare = async () => {
    const serial = ++refreshSerial;
    const origin = await loadShareOrigin({ location, fetchImpl, now });
    if (disposed || serial !== refreshSerial) return;
    const href = origin ? absoluteUrl(origin, "/otef-interactive/remote-controller.html") : null;
    if (!href) {
      setShareUnavailable();
      return;
    }
    setLink(document, "remote", href);
    if (shareStatus) shareStatus.textContent = "Ready to connect.";
    if (qrHost) renderQr(qrHost, href, { size: 256 });
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
  for (const [, pathname] of LOCAL_LINKS) {
    const id = LOCAL_LINKS.find(([, path]) => path === pathname)?.[0];
    document.getElementById(`${id}Copy`)?.addEventListener("click", onCopy);
  }
  remoteCopy?.addEventListener("click", onCopy);

  const onFocus = () => { void refreshShare(); };
  const onVisibility = () => {
    if (!document.hidden) void refreshShare();
  };
  globalThis.addEventListener?.("focus", onFocus);
  document.addEventListener?.("visibilitychange", onVisibility);
  const schedule = () => {
    if (disposed) return;
    if (!document.hidden) void refreshShare();
    refreshTimer = clock.setTimeout?.(schedule, REFRESH_MS);
  };
  void refreshShare();
  refreshTimer = clock.setTimeout?.(schedule, REFRESH_MS);

  return () => {
    disposed = true;
    if (refreshTimer != null) clock.clearTimeout?.(refreshTimer);
    for (const timer of copyTimers) clock.clearTimeout?.(timer);
    copyTimers.clear();
    globalThis.removeEventListener?.("focus", onFocus);
    document.removeEventListener?.("visibilitychange", onVisibility);
    for (const [id] of LOCAL_LINKS) document.getElementById(`${id}Copy`)?.removeEventListener("click", onCopy);
    remoteCopy?.removeEventListener("click", onCopy);
  };
}

if (typeof document !== "undefined") initLauncher();
