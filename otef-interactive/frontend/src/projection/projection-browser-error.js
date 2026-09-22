export function visibleProjectionBrowserError(host, error) {
  const doc = host?.ownerDocument || globalThis.document;
  if (!doc?.createElement || !host) return null;
  host.querySelector?.(".projection-browser-error")?.remove?.();
  const element = doc.createElement("div");
  element.className = "projection-browser-error";
  element.setAttribute?.("role", "alert");
  element.textContent = `Browser projection unavailable: ${error?.message || error}`;
  Object.assign(element.style || {}, {
    position: "absolute", inset: "0", zIndex: "2100", display: "grid", placeItems: "center",
    padding: "2rem", color: "#fff", background: "rgba(0,0,0,.9)", font: "700 20px sans-serif",
    textAlign: "center",
  });
  host.appendChild?.(element);
  return element;
}
