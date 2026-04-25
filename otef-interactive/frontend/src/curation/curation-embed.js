/**
 * `curation.html` when loaded inside remote-controller must use `?embed=1` (or `embed=true`).
 * Curated Supabase sync is manual (workshop refresh); no polling in this document.
 * Heartbeat is skipped only when the embed flag is set **and** this document is in a
 * subframe (true iframe); a top-level page with `?embed=1` must still run its own poll.
 */

/**
 * @param {string} [locationSearch] — e.g. `window.location.search` or `?embed=1`
 */
export function getCurationEmbedModeFromSearch(locationSearch) {
  const raw = String(locationSearch ?? "");
  const q = raw.startsWith("?") ? raw.slice(1) : raw;
  try {
    const v = new URLSearchParams(q).get("embed");
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}

/**
 * @returns {boolean} True when this window is not the top-level browsing context (e.g. iframe).
 */
export function isOtefCurationInIframeContext() {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return false;
  }
}

/** @returns {boolean} */
export function isOtefCurationEmbedded() {
  if (typeof window === "undefined") return false;
  if (!getCurationEmbedModeFromSearch(window.location.search)) return false;
  return isOtefCurationInIframeContext();
}
