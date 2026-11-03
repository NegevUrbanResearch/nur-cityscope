import { IDENTIFICATION_DURATION_MS } from "../projection-config/display-identification.js";

export function bootDisplayIdentification({ document, window }) {
  const value = new URLSearchParams(window.location.search).get("display");
  const valid = /^[1-9]\d{0,2}$/.test(value || "");
  document.getElementById("displayNumber").textContent = valid ? value : "?";
  document.title = valid ? `Display ${value}` : "Unknown display";
  const close = () => window.close();
  document.getElementById("closeIdentify").addEventListener("click", close);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
  window.setTimeout(close, IDENTIFICATION_DURATION_MS);
}

if (typeof document !== "undefined") bootDisplayIdentification({ document, window });
