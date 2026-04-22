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
  "map_3_future.greens": { he: "אזורי ירוק", en: "Greens" },
  "map_3_future.land_use": { he: "שימושי קרקע", en: "Land use" },
  "map_3_future.mimushim": { he: "מימושים", en: "Implementations" },
  "map_3_future.other": { he: "שכבה", en: "Layer" },
  "map_3_future.x": { he: "שכבה", en: "Layer" },
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
