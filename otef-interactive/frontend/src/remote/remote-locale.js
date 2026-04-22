/**
 * Remote controller UI locale: Hebrew default, English toggle, lang + dir on document root.
 * Main content (`#remoteMain`) gets matching `dir` for readable flow; `body` for the remote shell
 * is LTR in CSS (see remote-styles) so header/bottom nav do not mirror with document `dir`.
 * WebSocket/API/layer ids are never translated here — only display copy.
 *
 * @see LOCALE_EVENT — fired after locale is applied; listeners re-render dynamic strings.
 */

export const LOCALE_STORAGE_KEY = "otef.remote.locale";
export const LOCALE_EVENT = "otef:locale";

const SUPPORTED = /** @type {const} */ (["he", "en"]);

/**
 * @typedef {"he" | "en"} LocaleId
 */

/** @type {LocaleId} */
let _locale = "he";

/**
 * Not translated via MESSAGES: language autonyms on toggle ("עברית", "English");
 * product token "OTEF" in page title; layer/group display names from API;
 * `curatedGroupLabel` is the fallback title when the `curated` group has no API name
 * (same English string as the former hard-coded fallback, localized for Hebrew).
 */

const MESSAGES = {
  he: {
    documentTitle: "OTEF",
    localeGroupAria: "בחירת שפה",
    navTablistAria: "אזורי בקרה",
    navNavigation: "ניווט",
    navLayers: "שכבות",
    navCuration: "סדנה",
    sectionNavigation: "ניווט",
    zoomLabel: "זום:",
    statusConnected: "מחובר",
    statusDisconnected: "מנותק",
    statusConnecting: "מתחבר…",
    statusError: "שגיאה",
    layerSheetTitle: "שכבות",
    layersActiveCount: "{{n}} פעיל",
    layerEmpty: "אין קבוצות שכבות",
    curationIframeTitle: "סדנה — אצירה",
    warningControlsDisabled: "המפה אינה מחוברת. הבקרות אינן פעילות.",
    ariaPanNorth: "הזזה צפונה",
    ariaPanSouth: "הזזה דרומה",
    ariaPanEast: "הזזה מזרחה",
    ariaPanWest: "הזזה מערבה",
    joystickAria: "מוט כיוון לגרירת המפה",
    ariaZoomLevel: "רמת מיקוד",
    ariaZoomIn: "התקרבות",
    ariaZoomOut: "התרחקות",
    flowLabel: "זרימה",
    curatedGroupLabel: "אסופה",
    layersOpenPack: "הצג",
    layersBack: "רשימת חבילות",
    ariaLayersBack: "חזרה לרשימת חבילות",
    ariaLayersOpenPack: "הצגת שכבות בחבילה",
  },
  en: {
    documentTitle: "OTEF",
    localeGroupAria: "Language",
    navTablistAria: "Controller areas",
    navNavigation: "Nav",
    navLayers: "Layers",
    navCuration: "Workshop",
    sectionNavigation: "Navigation",
    zoomLabel: "Zoom:",
    statusConnected: "Connected",
    statusDisconnected: "Disconnected",
    statusConnecting: "Connecting…",
    statusError: "Error",
    layerSheetTitle: "Layers",
    layersActiveCount: "{{n}} active",
    layerEmpty: "No layer groups available",
    curationIframeTitle: "Workshop — curation",
    warningControlsDisabled: "GIS map not connected. Controls disabled.",
    ariaPanNorth: "Pan North",
    ariaPanSouth: "Pan South",
    ariaPanEast: "Pan East",
    ariaPanWest: "Pan West",
    joystickAria: "Virtual joystick for map panning",
    ariaZoomLevel: "Zoom level",
    ariaZoomIn: "Zoom In",
    ariaZoomOut: "Zoom Out",
    flowLabel: "Flow",
    curatedGroupLabel: "Curated",
    layersOpenPack: "View",
    layersBack: "All packs",
    ariaLayersBack: "Back to all packs",
    ariaLayersOpenPack: "View layers in this pack",
  },
};

/**
 * @param {string} key
 * @returns {keyof (typeof MESSAGES)["he"]}
 */
function isMessageKey(key) {
  return key in MESSAGES.he;
}

/**
 * @param {string} [key]
 * @returns {key is LocaleId}
 */
function isLocaleId(key) {
  return key === "he" || key === "en";
}

function readStored() {
  try {
    const v = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocaleId(v)) return v;
  } catch {
    // ignore
  }
  return "he";
}

function applyDocumentRoot() {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  const dir = _locale === "he" ? "rtl" : "ltr";
  el.setAttribute("lang", _locale === "he" ? "he" : "en");
  el.setAttribute("dir", dir);
  if (typeof document.getElementById === "function") {
    const main = document.getElementById("remoteMain");
    if (main) {
      main.setAttribute("dir", dir);
    }
  }
}

/**
 * Fills [data-i18n] with `MESSAGES[locale][key]`. Values support `{{n}}` replacement when passed as data-i18n-n (optional).
 */
export function applyRemoteChromeI18n() {
  if (typeof document === "undefined") return;
  if (typeof document.querySelectorAll !== "function") return;
  const textNodes = document.querySelectorAll("[data-i18n]");
  textNodes.forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key || !isMessageKey(key)) return;
    const row = MESSAGES[_locale];
    const template = row[key] ?? MESSAGES.en[key] ?? key;
    let text = template;
    const nAttr = el.getAttribute("data-i18n-n");
    if (nAttr != null && nAttr !== "") {
      text = text.replace(/\{\{n\}\}/g, nAttr);
    } else {
      text = text.replace(/\{\{n\}\}/g, "");
    }
    el.textContent = text;
  });
  const ariaNodes = document.querySelectorAll("[data-i18n-aria]");
  ariaNodes.forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    if (!key || !isMessageKey(key)) return;
    el.setAttribute("aria-label", t(key));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (!key || !isMessageKey(key)) return;
    el.setAttribute("title", t(key));
  });
  const title = MESSAGES[_locale].documentTitle;
  if (typeof document.title === "string") {
    document.title = title;
  }
}

/**
 * @returns {LocaleId}
 */
export function getLocale() {
  return _locale;
}

/**
 * @param {LocaleId} next
 * @param {{ force?: boolean }} [opts]
 * @returns {void}
 */
export function setLocale(next, opts = {}) {
  if (!isLocaleId(next)) return;
  if (!opts.force && _locale === next) return;

  _locale = next;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, _locale);
  } catch {
    // ignore
  }
  applyDocumentRoot();
  applyRemoteChromeI18n();
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(
      new CustomEvent(LOCALE_EVENT, { detail: { locale: _locale } }),
    );
  }
}

/**
 * Read persisted locale, apply `lang` / `dir`, static chrome strings, and dispatch `LOCALE_EVENT`.
 */
export function initLocale() {
  const stored = readStored();
  if (stored === _locale) {
    applyDocumentRoot();
    applyRemoteChromeI18n();
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(
        new CustomEvent(LOCALE_EVENT, { detail: { locale: _locale } }),
      );
    }
  } else {
    setLocale(stored, { force: true });
  }
}

/**
 * @param {string} key
 * @param {{ n?: string | number }} [vars]
 * @returns {string}
 */
export function t(key, vars = {}) {
  if (!isMessageKey(key)) return String(key);
  const k = key;
  const row = MESSAGES[_locale];
  let text = (row && row[k]) || MESSAGES.en[k] || key;
  if (vars && vars.n != null) {
    text = text.replace(/\{\{n\}\}/g, String(vars.n));
  } else {
    text = text.replace(/\{\{n\}\}/g, "");
  }
  return text;
}

/**
 * @param {number} totalEnabled
 * @returns {string}
 */
export function formatActiveLayerCount(totalEnabled) {
  return t("layersActiveCount", { n: totalEnabled });
}

export { SUPPORTED as SUPPORTED_LOCALES };
