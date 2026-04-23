/**
 * Bilingual display labels for known full layer ids (pack.layer) from processed metadata.
 * Unknown ids fall back to formatLayerLabelForDisplay(rawLabel) for consistent UI.
 *
 * @typedef {"he" | "en"} LayerDisplayLocale
 */

import { formatLayerLabelForDisplay } from "./layer-name-utils.js";

/**
 * Stable full id → { he, en }. Keys use the exact ids from manifests / OTEF (including
 * alternate spellings for the same feature where both appear in runtime).
 * @type {Record<string, { he: string, en: string }>}
 */
const LAYER_DISPLAY_LABELS = {
  // --- october_7th (from processed metadata / layer report) ---
  "october_7th.אזור_הרס_אזור": {
    he: "אזור הרס — אזור",
    en: "Destruction — area",
  },
  "october_7th.אזור_הרס_נקודה": {
    he: "אזור הרס — נקודה",
    en: "Destruction — point",
  },
  "october_7th.אירוע_נקודתי_רציחה_חטיפה_אזור": {
    he: "אירוע נקודתי: רציחה/חטיפה — אזור",
    en: "Point event: fatality or abduction — area",
  },
  "october_7th.אירוע_נקודתי_רציחה_חטיפה": {
    he: "אירוע נקודתי: רציחה/חטיפה",
    en: "Point event: fatality or abduction",
  },
  "october_7th.ביזה_אזור": { he: "ביזה — אזור", en: "Looting — area" },
  "october_7th.ביזה_נקודה": { he: "ביזה — נקודה", en: "Looting — point" },
  "october_7th.חדירה_לישוב_אזור": {
    he: "חדירה לישוב — אזור",
    en: "Infiltration into a community — area",
  },
  "october_7th.חדירה_לישוב_נקודה": {
    he: "חדירה לישוב — נקודה",
    en: "Infiltration into a community — point",
  },
  "october_7th.חדירה_לישוב-אזור": {
    he: "חדירה לישוב — אזור",
    en: "Infiltration into a community — area",
  },
  "october_7th.חדירה_לישוב-נקודה": {
    he: "חדירה לישוב — נקודה",
    en: "Infiltration into a community — point",
  },
  "october_7th.חדירה_לישוב-ציר": {
    he: "חדירה לישוב — ציר",
    en: "Infiltration into a community — axis",
  },
  "october_7th.חדירה_לישוב_ציר": {
    he: "חדירה לישוב — ציר",
    en: "Infiltration into a community — axis",
  },
  "october_7th.מאבק_וגבורה_אזור": {
    he: "מאבק וגבורה — אזור",
    en: "Fighting and heroism — area",
  },
  "october_7th.מאבק_וגבורה_נקודה": {
    he: "מאבק וגבורה — נקודה",
    en: "Fighting and heroism — point",
  },
  "october_7th.מאבק_וגבורה_ציר": {
    he: "מאבק וגבורה — ציר",
    en: "Fighting and heroism — axis",
  },
  "october_7th.מאבק_וגבורה-אזור": {
    he: "מאבק וגבורה — אזור",
    en: "Fighting and heroism — area",
  },
  "october_7th.מאבק_וגבורה-נקודה": {
    he: "מאבק וגבורה — נקודה",
    en: "Fighting and heroism — point",
  },
  "october_7th.מאבק_וגבורה-ציר": {
    he: "מאבק וגבורה — ציר",
    en: "Fighting and heroism — axis",
  },
  "october_7th.מוקד_מאבק_וגבורה_אזור": {
    he: "מוקד מאבק וגבורה — אזור",
    en: "Fighting and heroism focus — area",
  },
  "october_7th.מוקד_מאבק_וגבורה_נקודה": {
    he: "מוקד מאבק וגבורה — נקודה",
    en: "Fighting and heroism focus — point",
  },
  "october_7th.מוקד_מאבק_וגבורה_ציר": {
    he: "מוקד מאבק וגבורה — ציר",
    en: "Fighting and heroism focus — axis",
  },
  "october_7th.מרחב_לחימה": { he: "מרחב לחימה", en: "Combat area" },
  "october_7th.פגיעה_נקודתית_אזור": {
    he: "פגיעה נקודתית — אזור",
    en: "Point impact — area",
  },
  "october_7th.פגיעה_נקודתית_נקודה": {
    he: "פגיעה נקודתית — נקודה",
    en: "Point impact — point",
  },
  "october_7th.שטחים_פתוחים_פגועים": {
    he: "שטחים פתוחים פגועים",
    en: "Damaged open areas",
  },
  // Same features as above; layer ids in october_7th/manifest.json use hyphens in places.
  "october_7th.אזור_הרס-אזור": {
    he: "אזור הרס — אזור",
    en: "Destruction — area",
  },
  "october_7th.אזור_הרס-נקודה": {
    he: "אזור הרס — נקודה",
    en: "Destruction — point",
  },
  "october_7th.אירוע_נקודתי-רציחה_חטיפה": {
    he: "אירוע נקודתי: רציחה/חטיפה",
    en: "Point event: fatality or abduction",
  },
  "october_7th.אירוע_נקודתי-רציחה_חטיפה-אזור": {
    he: "אירוע נקודתי: רציחה/חטיפה — אזור",
    en: "Point event: fatality or abduction — area",
  },
  "october_7th.ביזה-אזור": { he: "ביזה — אזור", en: "Looting — area" },
  "october_7th.ביזה-נקודה": { he: "ביזה — נקודה", en: "Looting — point" },
  "october_7th.בין_1_ל15_עדויות": {
    he: "עדויות — גילאי 1–15",
    en: "Testimonies — ages 1–15",
  },
  "october_7th.בין_16_ל40_עדויות": {
    he: "עדויות — גילאי 16–40",
    en: "Testimonies — ages 16–40",
  },
  "october_7th.מעל_41_עדויות": {
    he: "עדויות — מעל גיל 41",
    en: "Testimonies — age 41+",
  },
  "october_7th.פגיעה_נקודתית-אזור": {
    he: "פגיעה נקודתית — אזור",
    en: "Point impact — area",
  },
  "october_7th.פגיעה_נקודתית-נקודה": {
    he: "פגיעה נקודתית — נקודה",
    en: "Point impact — point",
  },
  // --- projector_base ---
  "projector_base.sea": { he: "ים", en: "Sea" },
  "projector_base.רקע_שחור": { he: "רקע שחור", en: "Black background" },
  "projector_base.tkuma_area_line": {
    he: "קו אזור תקומה",
    en: "Tkuma area line",
  },
  "projector_base.Tkuma_Area_LIne": {
    he: "קו אזור תקומה",
    en: "Tkuma area line",
  },
  "projector_base.model_base": { he: "מודל בסיס", en: "Base model" },
  // --- map_3_future (pack id; layer ids from tests / config) ---
  "map_3_future.greens": { he: "ירוקים", en: "Greens" },
  "map_3_future.land_use": { he: "שימושי קרקע", en: "Land use" },
  "map_3_future.mimushim": { he: "מימושים", en: "Implementations" },
  "map_3_future.other": { he: "שכבה", en: "Layer" },
  "map_3_future.x": { he: "שכבה", en: "Layer" },
  // --- future_development (runtime pack ids from manifests / layer report) ---
  "future_development.אנדרטאות_ומוקדי_הנצחה": {
    he: "אנדרטאות ומוקדי הנצחה",
    en: "Monuments and memorial sites",
  },
  "future_development.הקו_הורוד": { he: "הקו הורוד", en: "Pink line" },
  "future_development.הציר_הורוד_חדש": {
    he: "הציר הורוד החדש",
    en: "New pink axis",
  },
  "future_development.מוזיאונים_מרכזי_מבקרים_ומוקדי_תרבות": {
    he: "מוזיאונים, מרכזי מבקרים ומוקדי תרבות",
    en: "Museums, visitor centers, and culture hubs",
  },
  "future_development.מוקדי_מורשת": { he: "מוקדי מורשת", en: "Heritage focal points" },
  "future_development.מוקדים_ארכאולוגיים": {
    he: "מוקדים ארכאולוגיים",
    en: "Archaeological sites",
  },
  "future_development.מורשת_מוצע": { he: "מורשת — מוצע", en: "Heritage — proposed" },
  "future_development.מורשת_קיים": { he: "מורשת — קיים", en: "Heritage — existing" },
  "future_development.מורשת-מוצע": { he: "מורשת — מוצע", en: "Heritage — proposed" },
  "future_development.מורשת-קיים": { he: "מורשת — קיים", en: "Heritage — existing" },
  "future_development.מימושים": { he: "מימושים", en: "Zoning build-out" },
  "future_development.מתחמי_דיור": { he: "מתחמי דיור", en: "Housing clusters" },
  "future_development.ציר_232": { he: "ציר 232", en: "Route 232 corridor" },
  "future_development.יציאה_כביש": {
    he: "יציאת כביש",
    en: "Road exit",
  },
  // --- greens ---
  "greens.גן_לאומי": { he: "גן לאומי", en: "National park" },
  "greens.חקלאות": { he: "חקלאות", en: "Agriculture" },
  "greens.יער_טבעי": { he: "יער טבעי", en: "Natural forest" },
  "greens.יער_פארק": { he: "יער פארק", en: "Park forest" },
  "greens.יערות_קקל": { he: "יערות קק\"ל", en: "KKL forests" },
  "greens.מישורי_הצפה": { he: "מישורי הצפה", en: "Floodplains" },
  "greens.מסדרונות_אקולוגיים": {
    he: "מסדרונות אקולוגיים",
    en: "Ecological corridors",
  },
  "greens.נחלים": { he: "נחלים", en: "Streams" },
  "greens.צוואר_בקבוק": { he: "צוואר בקבוק", en: "Bottleneck" },
  "greens.שמורות_טבע": { he: "שמורות טבע", en: "Nature reserves" },
  // --- land_use ---
  "land_use.אחסנה": { he: "אחסנה", en: "Storage" },
  "land_use.בית_עלמין": { he: "בית עלמין", en: "Cemetery" },
  "land_use.חניון": { he: "חניון", en: "Parking" },
  "land_use.חקלאות_מרעה_ותעשייה": {
    he: "חקלאות, מרעה ותעשייה",
    en: "Agriculture, pasture, and industry",
  },
  "land_use.כרייה_וחציבה": { he: "כרייה וחציבה", en: "Quarries" },
  "land_use.מגורים": { he: "מגורים", en: "Residential" },
  "land_use.מוסדות_ציבוריים": { he: "מוסדות ציבוריים", en: "Public institutions" },
  "land_use.מסחר_ומשרדים": { he: "מסחר ומשרדים", en: "Commerce and offices" },
  "land_use.מעורב_עם_מגורים": { he: "מעורב עם מגורים", en: "Mixed with residential" },
  "land_use.מעורב_עם_מסחר": { he: "מעורב עם מסחר", en: "Mixed with commerce" },
  "land_use.מתקני_הנדסה": { he: "מתקני הנדסה", en: "Engineering facilities" },
  "land_use.ספורט": { he: "ספורט", en: "Sports" },
  "land_use.שטח_לדרכים": { he: "שטח לדרכים", en: "Road reserve" },
  "land_use.שטחי_אש": { he: "שטחי אש", en: "Fire zones" },
  // Runtime id variant (trailing underscore in manifest)
  "land_use.שטחי_אש_": { he: "שטחי אש", en: "Fire zones" },
  "land_use.שטחים_פתוחים": { he: "שטחים פתוחים", en: "Open space" },
  "land_use.תחבורה": { he: "תחבורה", en: "Transportation" },
  "land_use.תיירות_ונופש": { he: "תיירות ונופש", en: "Tourism and leisure" },
  "land_use.תעסוקה": { he: "תעסוקה", en: "Employment" },
  "land_use.תעשייה_ומלאכה": { he: "תעשייה ומלאכה", en: "Industry and crafts" },
  // --- muniplicity_transport (typo id in layers manifest) ---
  "muniplicity_transport.במה": { he: "במה", en: "Skills area" },
  "muniplicity_transport.דרכי_עפר": { he: "דרכי עפר", en: "Dirt roads" },
  "muniplicity_transport.דרכים_אזוריות": { he: "דרכים אזוריים", en: "Regional roads" },
  "muniplicity_transport.דרכים_ארציות": { he: "דרכים ארציים", en: "National roads" },
  "muniplicity_transport.דרכים_מקומיות": { he: "דרכים מקומיות", en: "Local roads" },
  "muniplicity_transport.מועצות_אזוריות": { he: "מועצות אזוריות", en: "Regional councils" },
  "muniplicity_transport.מועצות_אזוריות_מתאר": {
    he: "מועצות אזוריות — מתאר",
    en: "Regional councils (cartographic outline)",
  },
  "muniplicity_transport.מסלולי_רכבת": { he: "מסלולי רכבת", en: "Railway alignments" },
  "muniplicity_transport.מרכז_תחבורה_מתוכנן": {
    he: "מרכז תחבורה מתוכנן",
    en: "Planned transit hub",
  },
  "muniplicity_transport.מרכז_תחבורה_קיים": {
    he: "מרכז תחבורה קיים",
    en: "Existing transit hub",
  },
  "muniplicity_transport.סינגלים": { he: "סינגלים", en: "Singletrack" },
  "muniplicity_transport.סעד": { he: "סעד", en: "Aid route" },
  "muniplicity_transport.שביל_הנגב_המערבי": {
    he: "שביל הנגב המערבי",
    en: "Western Negev trail",
  },
  "muniplicity_transport.שבילי_אופניים": { he: "שבילי אופניים", en: "Bicycle paths" },
  "muniplicity_transport.שבילי_אופניים_שקמה": {
    he: "שבילי אופניים (שקמה)",
    en: "Bicycle paths (Shikma)",
  },
  "muniplicity_transport.שבילים": { he: "שבילים", en: "Trails" },
  "muniplicity_transport.תחנות_רכבת": { he: "תחנות רכבת", en: "Railway stations" },
  // --- curated Moreshet axis (Supabase) ---
  "curated_moresht_axis.pink_line_parking": {
    he: "חניה ציר ורוד",
    en: "Pink line parking",
  },
};

/**
 * @param {string} fullLayerId
 * @param {LayerDisplayLocale} locale
 * @param {string} rawLabel
 * @param {string[] | null | undefined} [fullLayerIds] try each id; first glossary hit wins
 * @returns {string}
 */
export function getLayerDisplayLabel(
  fullLayerId,
  locale,
  rawLabel,
  fullLayerIds = undefined,
) {
  const loc = locale === "en" ? "en" : "he";
  const tryIds = [];
  if (fullLayerIds && fullLayerIds.length > 0) {
    for (const id of fullLayerIds) {
      if (id != null && String(id).trim() !== "")
        tryIds.push(String(id));
    }
  } else if (fullLayerId != null && String(fullLayerId).trim() !== "") {
    tryIds.push(String(fullLayerId));
  }
  const seen = new Set();
  for (const id of tryIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const row = LAYER_DISPLAY_LABELS[id];
    if (!row) continue;
    const s = row[loc];
    if (s != null && String(s).trim() !== "") return String(s);
  }
  return formatLayerLabelForDisplay(rawLabel);
}

export { LAYER_DISPLAY_LABELS };
