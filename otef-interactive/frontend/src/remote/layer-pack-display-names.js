/**
 * Human-readable pack titles for known stable group ids. Curated is intentionally
 * not mapped here so `layerGroupTitle` uses `t("curatedGroupLabel")` only.
 *
 * @typedef {"he" | "en"} PackDisplayLocale
 */

const PACK_LABELS = {
  october_7th: { he: "7 באוקטובר", en: "October 7th" },
  projector_base: { he: "מקרן בסיס", en: "Projector base" },
};

export const REQUIRED_PACK_IDS = /** @type {const} */ ([
  "october_7th",
  "projector_base",
  "curated",
]);

/**
 * @param {string} packId
 * @param {PackDisplayLocale} locale
 * @returns {string | null}
 */
export function getPackDisplayLabel(packId, locale) {
  if (packId === "curated") {
    return null;
  }
  const loc = locale === "en" ? "en" : "he";
  const row = PACK_LABELS[packId];
  if (!row) {
    return null;
  }
  const label = row[loc];
  return label != null && String(label).trim() !== "" ? String(label) : null;
}
