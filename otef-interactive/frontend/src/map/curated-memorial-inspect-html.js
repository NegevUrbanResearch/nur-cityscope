/**
 * Memorial point inspect HTML for curated Leaflet popups (RTL, Hebrew fallbacks).
 */

const NAME_FALLBACK = "ללא שם";
const DESC_FALLBACK = "אין תיאור";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * @param {Record<string, unknown> | null | undefined} properties
 * @returns {string}
 */
export function buildMemorialInspectHtml(properties) {
  const p = properties || {};
  const nameRaw = p.name == null ? "" : String(p.name).trim();
  const descRaw = p.description == null ? "" : String(p.description).trim();
  const name = nameRaw || NAME_FALLBACK;
  const desc = descRaw || DESC_FALLBACK;
  return (
    `<div dir="rtl" class="memorial-inspect-html">` +
    `<div class="popup-field"><span class="popup-label">שם:</span> <span class="popup-value">${escapeHtml(name)}</span></div>` +
    `<div class="popup-field"><span class="popup-label">תיאור:</span> <span class="popup-value">${escapeHtml(desc)}</span></div>` +
    `</div>`
  );
}
