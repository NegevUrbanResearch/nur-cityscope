/**
 * Shared bilingual copy for legend-specific display text.
 *
 * Layer names live in layer-display-glossary.js. This module owns pack titles
 * and the small set of category labels that are not layer names.
 */

/** @typedef {"he" | "en"} LegendLocale */

const PACK_LABELS = {
  october_7th: { he: "7 באוקטובר", en: "October 7th" },
  projector_base: { he: "בסיס מקרן", en: "Projector base" },
  map_3_future: { he: "מפה 3 — עתיד", en: "Map 3 — future" },
  curated_moresht_axis: { he: "סדנה", en: "Workshop" },
  future_development: { he: "פיתוח עתידי", en: "Future development" },
  gaza: { he: "עזה", en: "Gaza" },
  greens: { he: "ירוקים", en: "Greens" },
  land_use: { he: "שימושי קרקע", en: "Land use" },
  municipality_transport: { he: "תחבורה מוניציפלית", en: "Municipal transport" },
  municpality_transport: { he: "תחבורה מוניציפלית", en: "Municipal transport" },
  muniplicity_transport: { he: "תחבורה מוניציפלית", en: "Municipal transport" },
  nli: { he: "ספרייה לאומית", en: "National Library" },
};

export const REQUIRED_PACK_IDS = /** @type {const} */ ([
  "october_7th",
  "projector_base",
  "map_3_future",
  "curated_moresht_axis",
  "future_development",
  "gaza",
  "greens",
  "land_use",
  "municipality_transport",
  "municpality_transport",
  "muniplicity_transport",
  "curated",
]);

/**
 * Copy for categories whose values are stable but have no layer glossary row.
 * Keep this map independent from style colors and symbol definitions.
 */
export const LEGEND_CATEGORY_COPY = Object.freeze({
  "future_development.מורשת-מוצע": Object.freeze({
    "ארכיון מקומי": Object.freeze({ he: "ארכיון מקומי", en: "Local archive" }),
    "ארכיון מקומי‎": Object.freeze({ he: "ארכיון מקומי", en: "Local archive" }),
    "בית עלמין": Object.freeze({ he: "בית עלמין", en: "Cemetery" }),
    "בתי עדות או שרידי מבנים לשימור": Object.freeze({ he: "בתי עדות או שרידי מבנים לשימור", en: "Testimony houses or preserved ruins" }),
    "גל עד מרכזי למורשת והנצחה": Object.freeze({ he: "גל עד מרכזי למורשת והנצחה", en: "Central heritage and memorial monument" }),
    "יוזמות לאחר ה-7 באוקטובר": Object.freeze({ he: "יוזמות לאחר ה-7 באוקטובר", en: "Initiatives after October 7" }),
    "לקהל הרחב": Object.freeze({ he: "לקהל הרחב", en: "For the general public" }),
    "מוקד מורשת והנצחה": Object.freeze({ he: "מוקד מורשת והנצחה", en: "Heritage and memorial site" }),
    "פרויקט זמני ": Object.freeze({ he: "פרויקט זמני", en: "Temporary project" }),
    "תכנון נופי למורשת והנצחה": Object.freeze({ he: "תכנון נופי למורשת והנצחה", en: "Landscape planning for heritage and memorials" }),
  }),
  "future_development.מורשת-קיים": Object.freeze({
    "ארכיון מקומי": Object.freeze({ he: "ארכיון מקומי", en: "Local archive" }),
    "ארכיון מקומי‎": Object.freeze({ he: "ארכיון מקומי", en: "Local archive" }),
    "בית עלמין": Object.freeze({ he: "בית עלמין", en: "Cemetery" }),
    "בתי עדות או שרידי מבנים לשימור": Object.freeze({ he: "בתי עדות או שרידי מבנים לשימור", en: "Testimony houses or preserved ruins" }),
    "גל עד מרכזי למורשת והנצחה": Object.freeze({ he: "גל עד מרכזי למורשת והנצחה", en: "Central heritage and memorial monument" }),
    "יוזמות לאחר ה-7 באוקטובר": Object.freeze({ he: "יוזמות לאחר ה-7 באוקטובר", en: "Initiatives after October 7" }),
    "לקהל הרחב": Object.freeze({ he: "לקהל הרחב", en: "For the general public" }),
    "מוקד מורשת והנצחה": Object.freeze({ he: "מוקד מורשת והנצחה", en: "Heritage and memorial site" }),
    "פרויקט זמני ": Object.freeze({ he: "פרויקט זמני", en: "Temporary project" }),
    "תכנון נופי למורשת והנצחה": Object.freeze({ he: "תכנון נופי למורשת והנצחה", en: "Landscape planning for heritage and memorials" }),
  }),
  "future_development.מימושים": Object.freeze({
    "0": Object.freeze({ he: "לא מומש", en: "Not implemented" }),
    "1": Object.freeze({ he: "מומש", en: "Implemented" }),
  }),
  "future_development.מתחמי_דיור": Object.freeze({
    "0": Object.freeze({ he: "יוזמות וכוונות תכנון", en: "Planning initiatives and intentions" }),
    "1": Object.freeze({ he: "קדם תכנון", en: "Pre-planning" }),
    "2": Object.freeze({ he: "בתהליך", en: "In progress" }),
    "3": Object.freeze({ he: "מאושר", en: "Approved" }),
  }),
  "gaza.Gaza_Roads": Object.freeze({
    "Internal Road": Object.freeze({ he: "דרך פנימית", en: "Internal road" }),
    "Local Road": Object.freeze({ he: "דרך מקומית", en: "Local road" }),
    "Main Road": Object.freeze({ he: "דרך ראשית", en: "Main road" }),
    "Regional Road": Object.freeze({ he: "דרך אזורית", en: "Regional road" }),
  }),
  "greens.נחלים": Object.freeze({
    "<Null>": Object.freeze({ he: "לא ידוע", en: "Unknown" }),
    "משני": Object.freeze({ he: "משני", en: "Secondary" }),
    "ראשי": Object.freeze({ he: "ראשי", en: "Primary" }),
  }),
  "land_use.אחסנה": Object.freeze({ "240": Object.freeze({ he: "אחסנה", en: "Storage" }) }),
  "land_use.חניון": Object.freeze({ "870": Object.freeze({ he: "חניון", en: "Parking" }) }),
  "land_use.כרייה_וחציבה": Object.freeze({ "12": Object.freeze({ he: "כריה וחציבה", en: "Quarries" }) }),
  "land_use.מתקני_הנדסה": Object.freeze({ "10": Object.freeze({ he: "מתקני הנדסה", en: "Engineering facilities" }) }),
  "land_use.ספורט": Object.freeze({ "15": Object.freeze({ he: "ספורט", en: "Sports" }) }),
  "land_use.תחבורה": Object.freeze({ "13": Object.freeze({ he: "תחבורה", en: "Transportation" }) }),
  "muniplicity_transport.מועצות_אזוריות": Object.freeze({
    "אשכול": Object.freeze({ he: "אשכול", en: "Eshkol" }),
    "אשקלון": Object.freeze({ he: "אשקלון", en: "Ashkelon" }),
    "חוף אשקלון": Object.freeze({ he: "חוף אשקלון", en: "Hof Ashkelon" }),
    "שדות נגב": Object.freeze({ he: "שדות נגב", en: "Sdot Negev" }),
    "שדרות": Object.freeze({ he: "שדרות", en: "Sderot" }),
    "שער הנגב": Object.freeze({ he: "שער הנגב", en: "Sha'ar HaNegev" }),
  }),
  "muniplicity_transport.מועצות_אזוריות_מתאר": Object.freeze({
    "אשכול": Object.freeze({ he: "אשכול", en: "Eshkol" }),
    "אשקלון": Object.freeze({ he: "אשקלון", en: "Ashkelon" }),
    "חוף אשקלון": Object.freeze({ he: "חוף אשקלון", en: "Hof Ashkelon" }),
    "שדות נגב": Object.freeze({ he: "שדות נגב", en: "Sdot Negev" }),
    "שער הנגב": Object.freeze({ he: "שער הנגב", en: "Sha'ar HaNegev" }),
  }),
  "nli.people": Object.freeze({
    "Murdered": Object.freeze({ he: "נרצחו", en: "Murdered" }),
    "Killed on duty": Object.freeze({ he: "נפלו בעת מילוי תפקידם", en: "Killed on duty" }),
    "Kidnap survivor": Object.freeze({ he: "שורדי חטיפה", en: "Kidnap survivors" }),
    "Murdered in captivity": Object.freeze({ he: "נרצחו בשבי", en: "Murdered in captivity" }),
  }),
  "nli.investigation_polygons": Object.freeze({
    "מרחב לחימה - קרב": Object.freeze({ he: "מוקד קרב/טבח", en: "Battle or massacre site" }),
    "שריפה": Object.freeze({ he: "מוקד שריפה", en: "Fire site" }),
    "מוקד חטיפה": Object.freeze({ he: "מוקד חטיפה", en: "Kidnapping site" }),
  }),
});

// Stable policy for current registered helper layers. This map carries display
// copy and explicit summary permission only; symbol data remains in styles.
export const LEGEND_POLICY = Object.freeze({
  "gaza.Gaza_Roads": Object.freeze({
    label: Object.freeze({ he: "דרכי עזה", en: "Gaza roads" }),
    summary: Object.freeze({ label: Object.freeze({ he: "דרכי עזה", en: "Gaza roads" }) }),
  }),
  "greens.נחלים": Object.freeze({
    label: Object.freeze({ he: "נחלים", en: "Streams" }),
    summary: Object.freeze({ label: Object.freeze({ he: "נחלים", en: "Streams" }) }),
  }),
  "projector_base.ישובים": Object.freeze({ label: Object.freeze({ he: "יישובים", en: "Settlements" }) }),
  "projector_base.Tkuma_Area_LIne": Object.freeze({ label: Object.freeze({ he: "גבול אזור תקומה", en: "Tkuma area boundary" }) }),
  "projector_base.Locations_Lines": Object.freeze({ label: Object.freeze({ he: "קווי מיקום", en: "Location lines" }) }),
  "projector_base.שמות_יישובים": Object.freeze({ label: Object.freeze({ he: "שמות יישובים", en: "Settlement names" }) }),
});

export function normalizePackId(id) {
  return String(id)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function getPackDisplayLabel(packId, locale) {
  const idStr = String(packId);
  if (idStr === "curated" || normalizePackId(idStr) === "curated") return null;
  const loc = locale === "en" ? "en" : "he";
  const row = PACK_LABELS[idStr] || PACK_LABELS[normalizePackId(idStr)];
  if (!row) return null;
  const label = row[loc];
  return label != null && String(label).trim() !== "" ? String(label) : null;
}

export function getLegendCategoryCopy(fullLayerId, value, locale) {
  const values = LEGEND_CATEGORY_COPY[String(fullLayerId)];
  const valueKey = String(value);
  const row = values?.[valueKey] || values?.[valueKey.trim()];
  if (!row) return null;
  const label = row[locale === "en" ? "en" : "he"];
  return label == null || String(label).trim() === "" ? null : String(label);
}

export { PACK_LABELS };
