import { loadShareOrigin } from "../shared/share-origin.js";
import { renderQr } from "../shared/qr-code.js";

const REFRESH_MS = 15_000;

export function initPrintableQr({ document = globalThis.document, location = globalThis.location, fetchImpl = globalThis.fetch, now, clock = globalThis } = {}) {
  if (!document || !location) return () => {};
  const target = document.getElementById("targetUrl");
  const host = document.getElementById("qrcode");
  const status = document.getElementById("shareStatus");
  let disposed = false;
  let serial = 0;
  let timer = null;

  const clearOutput = () => {
    if (target) target.textContent = "—";
    if (status) status.textContent = "Network address unavailable.";
    host?.replaceChildren?.();
  };
  const refresh = async () => {
    const currentSerial = ++serial;
    const origin = await loadShareOrigin({ location, fetchImpl, now });
    if (disposed || currentSerial !== serial) return;
    const href = origin ? new URL("/otef-interactive/remote-controller.html", origin).href : null;
    if (!href) {
      clearOutput();
      return;
    }
    if (target) target.textContent = href;
    if (status) status.textContent = "Ready to connect.";
    if (host) renderQr(host, href, { size: 256 });
  };
  const schedule = () => {
    if (disposed) return;
    if (!document.hidden) void refresh();
    timer = clock.setTimeout?.(schedule, REFRESH_MS);
  };
  const onFocus = () => { void refresh(); };
  const onVisibility = () => { if (!document.hidden) void refresh(); };
  globalThis.addEventListener?.("focus", onFocus);
  document.addEventListener?.("visibilitychange", onVisibility);
  void refresh();
  timer = clock.setTimeout?.(schedule, REFRESH_MS);
  return () => {
    disposed = true;
    serial += 1;
    if (timer != null) clock.clearTimeout?.(timer);
    globalThis.removeEventListener?.("focus", onFocus);
    document.removeEventListener?.("visibilitychange", onVisibility);
  };
}

if (typeof document !== "undefined") void initPrintableQr();
