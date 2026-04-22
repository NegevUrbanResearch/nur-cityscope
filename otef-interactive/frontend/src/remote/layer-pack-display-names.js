/**
 * Human-readable pack titles for known stable group ids. Curated is intentionally
 * not mapped here so `layerGroupTitle` uses `t("curatedGroupLabel")` only.
 *
 * @typedef {"he" | "en"} PackDisplayLocale
 */

const PACK_LABELS = {
  october_7th: { he: "7 באוקטובר", en: "October 7th" },
  projector_base: { he: "מקרן בסיס", en: "Projector base" },
  map_3_future: { he: "מפה 3 — עתיד", en: "Map 3 — future" },
  curated_moresht_axis: { he: "ציר מורשת (אוצרות)", en: "Moreshet axis (curated)" },
  future_development: { he: "פיתוח עתידי", en: "Future development" },
  municipality_transport: { he: "תחבורה מוניציפלית", en: "Municipal transport" },
  // Common GIS / hand-entry typo seen next to the canonical id
  municpality_transport: { he: "תחבורה מוניציפלית", en: "Municipal transport" },
};

export const REQUIRED_PACK_IDS = /** @type {const} */ ([
  "october_7th",
  "projector_base",
  "map_3_future",
  "curated_moresht_axis",
  "future_development",
  "municipality_transport",
  "municpality_transport",
  "curated",
]);

/**
 * @param {string} id
 * @returns {string}
 */
export function normalizePackId(id) {
  return String(id)
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

/**
 * @param {string} packId
 * @param {PackDisplayLocale} locale
 * @returns {string | null}
 */
export function getPackDisplayLabel(packId, locale) {
  const idStr = String(packId);
  if (idStr === "curated" || normalizePackId(idStr) === "curated") {
    return null;
  }
  const loc = locale === "en" ? "en" : "he";
  let row = PACK_LABELS[idStr];
  if (!row) {
    row = PACK_LABELS[normalizePackId(idStr)];
  }
  if (!row) {
    return null;
  }
  const label = row[loc];
  return label != null && String(label).trim() !== "" ? String(label) : null;
}
