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
 * Not translated via MESSAGES: compact language labels on the toggle ("עב", "en" in markup);
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
    navSlideshow: "מצגת",
    sectionNavigation: "ניווט",
    navPanGroupLabel: "",
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
    slideshowTitle: "מצגת הקרנה",
    slideshowPackOrderHint: "סדר החבילות נקבע לפי הרשימה. אפשר להזיז למעלה/למטה לפני התחלה.",
    slideshowStart: "התחל מצגת",
    slideshowStop: "עצור",
    slideshowStatusIdle: "מצב: ממתין",
    slideshowStatusRunning: "מצב: פעיל",
    slideshowNoPacks: "אין חבילות שכבות להצגה. הוסיפו קבוצות לפני התחלת המצגת.",
    slideshowProjectionDisconnected:
      "כשהבקר מחובר לשרת, המצגת מסתנכרנת להקרנה דרך הרשת (כמו שאר הבקרה). שידור מקומי (אותו דפדפן) משמש לבדיקות בלבד.",
    slideshowMoveUp: "למעלה",
    slideshowMoveDown: "למטה",
    ariaSlideshowMoveUp: "העבר חבילה למעלה",
    ariaSlideshowMoveDown: "העבר חבילה למטה",
    slideshowIntervalSecLabel: "מרווח (שניות)",
    slideshowCrossfadeSecLabel: "מיזוג (שניות)",
    slideshowWarmupLeadSecLabel: "זמן הכנה (שניות)",
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
    layersPackActiveCount: "{{e}}/{{t}}",
    ariaLayerAnimationToggle: "הפעלת או כיבוי אנימציית זרימה לשכבה",
    layersBulkVisibility: "כל השכבות בחבילה",
    ariaLayersBulkVisibility: "הפעלת או כיבוי כל השכבות בחבילה שנבחרה",
    layersBack: "רשימת חבילות",
    ariaLayersBack: "חזרה לרשימת חבילות",
    ariaLayersOpenPack: "הצגת שכבות בחבילה",
    curationSubmissionsRefreshTitle: "רענון רשימת הגשות",
    curationSubmissionsRefreshAria: "רענון רשימת ההגשות",
    curationSubmissionsHeading: "הגשות",
    curationPageTitle: "אצירה",
    curationBackLink: "בקר",
    curationBackAria: "פתיחת בקר",
    curationHeaderRefresh: "רענון",
    curationHeaderRefreshAria: "רענון",
    curationRefreshInProgress: "מסנכרנים עם השרת…",
    curationRefreshPullError: "סנכרון Supabase נכשל ({{e}}). נסו שוב.",
    curationDocumentTitle: "OTEF | אצירה",
    curationPublishHeading: "פרסום",
    curationPublishButton: "פרסם שכבה",
    curationSelectSubmissionError: "בחרו הגשה לפרסום.",
    curationMissingGroupError: "חסר שם קבוצה לאסוף.",
    curationNoFeaturesError: "אין תצוגה נוכחית לפרסום עבור הגשה זו.",
    curationPublishing: "מפרסמים…",
    curationPublishedSuccess: "פורסם \"{{e}}\".",
    curationPublishFailed: "הפרסום נכשל: {{e}}",
    curationUnpublishAllConfirm: "להסיר את כל שכבות האצירה המפורסמות מהבקר המרוחק?",
    curationUnpublishAllInProgress: "מסירים את כל שכבות האצירה המפורסמות…",
    curationUnpublishAllRemovedN: "הוסרו {{n}} שכבה/ות מפורסמות.",
    curationUnpublishAllSuccess: "הוסרו כל שכבות האצירה המפורסמות.",
    curationUnpublishAllError: "לא ניתן לבטל את כל הפרסומים: {{e}}",
    curationLoadWorkshopError: "לא ניתן לטעון מצב סדנה: {{e}}",
    curationWorkshopOnSuccess: "פרסום אוטומטי לסדנה מופעל: הגשות חדשות עשויות להתפרסם אוטומטית.",
    curationWorkshopOffSuccess: "פרסום אוטומטי לסדנה כבוי.",
    curationUpdateWorkshopError: "לא ניתן לעדכן מצב סדנה: {{e}}",
    curationPublishedHeading: "שכבות מפורסמות בבקר",
    curationWorkshopAutoPublish: "פרסום אוטומטי לסדנה",
    curationWorkshopAutoPublishAria: "פרסום אוטומטי לסדנה",
    curationUnpublishAll: "הסר הכל",
    curationPublishedLoading: "טוען שכבות אצירה מפורסמות…",
    curationSubmissionSearchPlaceholder: "חיפוש או בחירת הגשה…",
    curationSubmissionSearchAria: "חיפוש ובחירת הגשה",
    curationSubmissionListAria: "הגשות",
    curationSubmissionsEmpty: "לא נטענו הגשות.",
    curationSubmissionsNoMatch: "אין תוצאות.",
    curationSubmissionsLoading: "טוען הגשות…",
    curationSubmissionsLoadError: "לא ניתן לטעון הגשות: {{e}}",
    curationNoPublishedLayers: "אין שכבות אצירה מפורסמות.",
    curationLoadingPublished: "טוען שכבות אצירה מפורסמות…",
    curationLoadPublishedError: "לא ניתן לטעון שכבות אצירה: {{e}}",
    curationTagTkumaLine: "קו תקומה",
    curationTagMemorials: "הנצחה",
    curationSubmissionColorTitle: "צבע הגשה",
    curationOpenSubmissionForLayer: "פתח את ההגשה \"{{e}}\" עבור השכבה \"{{n}}\"",
    curationOpenSubmissionUnnamed: "פתח את ההגשה עבור השכבה \"{{e}}\"",
    curationPublishedLayerUnknown: "שכבה \"{{e}}\": הגשה לא ידועה (מרובות או חסרה); הודעת מצב",
    curationLayerUpdatedTitle: "עדכון אחרון לשכבה",
    curationLayerTypeTagsAria: "תגי סוג לשכבה",
    curationUnpublishButton: "הסרה",
    curationUnpublishButtonAria: "הסרת שכבה מן הבקר",
    curationUnpublishOneConfirm: "להסיר את \"{{e}}\" מרשימת השכבות המפורסמות?",
    curationUnpublishOneSuccess: "הוסרה \"{{e}}\" מרשימת הפרסומים.",
    curationUnpublishOneError: "לא ניתן להסיר שכבה: {{e}}",
    curationMapUnknownSubmissions: "השכבה המפורסמת מתאימה למספר הגשות או אינה ידועה.",
    curationMapSubmissionNotInList: "ההגשה {{e}} אינה מופיעה ברשימת ההגשות.",
  },
  en: {
    documentTitle: "OTEF",
    localeGroupAria: "Language",
    navTablistAria: "Controller areas",
    navNavigation: "Navigation",
    navLayers: "Layers",
    navCuration: "Workshop",
    navSlideshow: "Slideshow",
    sectionNavigation: "Navigation",
    navPanGroupLabel: "",
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
    slideshowTitle: "Projection slideshow",
    slideshowPackOrderHint: "Pack order follows this list. Move items up/down before starting.",
    slideshowStart: "Start slideshow",
    slideshowStop: "Stop",
    slideshowStatusIdle: "Status: idle",
    slideshowStatusRunning: "Status: running",
    slideshowNoPacks: "No layer packs to show. Add groups before starting the slideshow.",
    slideshowProjectionDisconnected:
      "When this remote is connected to the server, the slideshow syncs to the projection over the network, like the rest of the controls. Same-browser broadcast is for local testing only.",
    slideshowMoveUp: "Up",
    slideshowMoveDown: "Down",
    ariaSlideshowMoveUp: "Move pack up",
    ariaSlideshowMoveDown: "Move pack down",
    slideshowIntervalSecLabel: "Interval (seconds)",
    slideshowCrossfadeSecLabel: "Crossfade (seconds)",
    slideshowWarmupLeadSecLabel: "Warmup lead (seconds)",
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
    layersPackActiveCount: "{{e}}/{{t}}",
    ariaLayerAnimationToggle: "Enable or disable flow animation for this layer",
    layersBulkVisibility: "All layers in pack",
    ariaLayersBulkVisibility: "Enable or disable every layer in the selected pack",
    layersBack: "All packs",
    ariaLayersBack: "Back to all packs",
    ariaLayersOpenPack: "View layers in this pack",
    curationSubmissionsRefreshTitle: "Refresh submissions list",
    curationSubmissionsRefreshAria: "Refresh submissions list",
    curationSubmissionsHeading: "Submissions",
    curationPageTitle: "Curation",
    curationBackLink: "Controller",
    curationBackAria: "Open controller",
    curationHeaderRefresh: "Refresh",
    curationHeaderRefreshAria: "Refresh",
    curationRefreshInProgress: "Syncing with server…",
    curationRefreshPullError: "Supabase sync failed ({{e}}). Try again.",
    curationDocumentTitle: "OTEF | Curation",
    curationPublishHeading: "Publish",
    curationPublishButton: "Publish layer",
    curationSelectSubmissionError: "Select a submission to publish.",
    curationMissingGroupError: "Missing curated group name.",
    curationNoFeaturesError: "No current features to publish for this submission.",
    curationPublishing: "Publishing…",
    curationPublishedSuccess: "Published “{{e}}”.",
    curationPublishFailed: "Publish failed: {{e}}",
    curationUnpublishAllConfirm: "Remove all published curated layers from the remote?",
    curationUnpublishAllInProgress: "Removing all published curated layers…",
    curationUnpublishAllRemovedN: "Removed {{n}} published layer(s) from remote.",
    curationUnpublishAllSuccess: "All published curated layers removed from remote.",
    curationUnpublishAllError: "Could not unpublish all: {{e}}",
    curationLoadWorkshopError: "Could not load workshop mode: {{e}}",
    curationWorkshopOnSuccess:
      "Workshop auto-publish is on: new submissions can publish automatically when eligible.",
    curationWorkshopOffSuccess: "Workshop auto-publish is off.",
    curationUpdateWorkshopError: "Could not update workshop mode: {{e}}",
    curationPublishedHeading: "Published layers on remote",
    curationWorkshopAutoPublish: "Workshop auto-publish",
    curationWorkshopAutoPublishAria: "Workshop auto-publish",
    curationUnpublishAll: "Unpublish all",
    curationPublishedLoading: "Loading published curated layers…",
    curationSubmissionSearchPlaceholder: "Search or choose submission…",
    curationSubmissionSearchAria: "Search and select submission",
    curationSubmissionListAria: "Submissions",
    curationSubmissionsEmpty: "No submissions loaded.",
    curationSubmissionsNoMatch: "No matching submissions.",
    curationSubmissionsLoading: "Loading submissions…",
    curationSubmissionsLoadError: "Could not load submissions: {{e}}",
    curationNoPublishedLayers: "No published curated layers.",
    curationLoadingPublished: "Loading published curated layers…",
    curationLoadPublishedError: "Could not load published curated layers: {{e}}",
    curationTagTkumaLine: "Tkuma Line",
    curationTagMemorials: "Memorials",
    curationSubmissionColorTitle: "Submission color",
    curationOpenSubmissionForLayer: 'Open submission “{{e}}” for published layer “{{n}}”',
    curationOpenSubmissionUnnamed: 'Open submission for published layer “{{e}}”',
    curationPublishedLayerUnknown:
      'Published layer “{{e}}”: submission unavailable (multiple or unknown); shows status',
    curationLayerUpdatedTitle: "Layer last updated",
    curationLayerTypeTagsAria: "Layer type tags",
    curationUnpublishButton: "Remove",
    curationUnpublishButtonAria: "Remove layer from remote",
    curationUnpublishOneConfirm: 'Remove “{{e}}” from published remote layers?',
    curationUnpublishOneSuccess: 'Removed “{{e}}” from published remote layers.',
    curationUnpublishOneError: "Could not remove published layer: {{e}}",
    curationMapUnknownSubmissions: "This published layer maps to multiple/unknown submissions.",
    curationMapSubmissionNotInList: "Submission {{e}} is not available in the submissions list.",
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

/** @type {boolean} */
let _localeStorageListenerBound = false;

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
  if (typeof document.querySelectorAll === "function") {
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      if (!key || !isMessageKey(key)) return;
      if ("placeholder" in el) {
        el.placeholder = t(key);
      }
    });
  }
  if (typeof document.title === "string") {
    const isCuration =
      typeof document.querySelector === "function" && document.querySelector(".curation-layout");
    document.title = isCuration ? t("curationDocumentTitle") : MESSAGES[_locale].documentTitle;
  }
  if (typeof document.getElementById === "function") {
    const submissionSearch = document.getElementById("curationSubmissionSearch");
    if (submissionSearch) {
      submissionSearch.setAttribute("dir", _locale === "he" ? "rtl" : "ltr");
    }
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
  if (
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function" &&
    !_localeStorageListenerBound
  ) {
    _localeStorageListenerBound = true;
    window.addEventListener("storage", (e) => {
      if (e.key !== LOCALE_STORAGE_KEY) return;
      const v = e.newValue;
      if (v === "he" || v === "en") {
        setLocale(/** @type {LocaleId} */ (v), { force: true });
      }
    });
  }
}

/**
 * @param {string} key
 * @param {{ n?: string | number; e?: string | number; t?: string | number }} [vars]
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
  if (vars) {
    if (vars.e != null) {
      text = text.replace(/\{\{e\}\}/g, String(vars.e));
    } else {
      text = text.replace(/\{\{e\}\}/g, "");
    }
    if (vars.t != null) {
      text = text.replace(/\{\{t\}\}/g, String(vars.t));
    } else {
      text = text.replace(/\{\{t\}\}/g, "");
    }
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
