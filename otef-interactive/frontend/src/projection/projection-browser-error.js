export function visibleProjectionBrowserError(host, error, { retry } = {}) {
  const doc = host?.ownerDocument || globalThis.document;
  if (!doc?.createElement || !host) return null;
  host.querySelector?.(".projection-browser-error")?.remove?.();
  const element = doc.createElement("div");
  element.className = "projection-browser-error";
  element.setAttribute?.("role", "alert");
  const message = `Browser projection unavailable: ${error?.message || error}`;
  element.textContent = message;
  Object.assign(element.style || {}, {
    position: "absolute", inset: "0", zIndex: "2100", display: "grid", placeItems: "center",
    padding: "2rem", color: "#fff", background: "rgba(0,0,0,.9)", font: "700 20px sans-serif",
    textAlign: "center",
  });
  if (typeof retry === "function" && doc.createElement) {
    element.textContent = "";
    const text = doc.createElement("p");
    text.textContent = message;
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = "Retry projection";
    button.addEventListener("click", retry);
    element.append(text, button);
  }
  host.appendChild?.(element);
  return element;
}
