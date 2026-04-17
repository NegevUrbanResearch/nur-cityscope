const MAX_CSS_COLOR_LEN = 120;

/** Reject CSS injection / chaining in color strings (semicolons, comments, url(), expression(), etc.). */
const CSS_COLOR_INJECTION = /[;{}]|\/\*|\*\/|\\|url\s*\(|expression\s*\(/i;

const RGB_FULL = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i;
const RGBA_FULL =
  /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*((?:\d+(?:\.\d+)?|\.\d+))\s*\)$/i;

function channelOk(n) {
  const v = Number(n);
  return Number.isInteger(v) && v >= 0 && v <= 255 && String(v) === String(n);
}

function alphaOk(raw) {
  const s = String(raw);
  if (/[eE]/.test(s)) return false;
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) return false;
  const a = Number(s);
  return Number.isFinite(a) && a >= 0 && a <= 1;
}

/**
 * Shared CSS color sanitization for curation UI (swatches, inline styles).
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export function sanitizeCssColor(raw) {
  const s = String(raw || "").trim();
  if (!s || s.length > MAX_CSS_COLOR_LEN) return null;
  if (CSS_COLOR_INJECTION.test(s)) return null;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s;

  const rgb = RGB_FULL.exec(s);
  if (rgb) {
    if (channelOk(rgb[1]) && channelOk(rgb[2]) && channelOk(rgb[3])) return s;
    return null;
  }

  const rgba = RGBA_FULL.exec(s);
  if (rgba) {
    if (!channelOk(rgba[1]) || !channelOk(rgba[2]) || !channelOk(rgba[3])) return null;
    if (!alphaOk(rgba[4])) return null;
    return s;
  }

  return null;
}
