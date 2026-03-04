/**
 * Layer name utilities for grouping and display consistency.
 * Used by the layer sheet (October 7th consolidated rows) and the map legend
 * so that layers with the same logical name merge correctly despite
 * hyphen/underscore/space differences in manifest or display names.
 *
 * These functions are for grouping and display only; they do not change
 * storage or API layer ids.
 */

/**
 * Normalize a layer base name for grouping comparison.
 * Trims, collapses consecutive whitespace to a single space, then
 * normalizes hyphen-like characters and underscores to a single hyphen
 * so that e.g. "אירוע_נקודתי-רציחה_חטיפה" and "אירוע נקודתי-רציחה חטיפה"
 * yield the same string and merge in the sheet and legend.
 *
 * @param {string} name - Raw layer name or id (e.g. from manifest layer.name or layer.id)
 * @returns {string} Normalized string for comparison; do not use for display if it differs from input
 */
function normalizeLayerBaseName(name) {
  if (name == null || typeof name !== "string") return "";
  const trimmed = name.trim();
  if (trimmed === "") return "";
  const collapsedSpace = trimmed.replace(/\s+/g, " ");
  const normalized = collapsedSpace.replace(/[\s_\-]+/g, "-").replace(/-+/g, "-");
  return normalized.replace(/^-+|-+$/g, "");
}

/**
 * Hebrew geometry suffixes used in October 7th layer names.
 * Used to detect layers that should merge (e.g. חדירה_לישוב-אזור, חדירה_לישוב-נקודה).
 */
const GEOMETRY_SUFFIXES = "\u05d0\u05d6\u05d5\u05e8|\u05e0\u05e7\u05d5\u05d3\u05d4|\u05e6\u05d9\u05e8"; // אזור | נקודה | ציר

/**
 * Parse a layer name that may end with a geometry suffix.
 * Supports both hyphen (Name-אזור) and underscore (Name_אזור) conventions.
 *
 * @param {string} name - Layer name or id (e.g. "חדירה_לישוב-אזור" or "מאבק_וגבורה_אזור")
 * @returns {{ baseNameRaw: string, baseNameNorm: string, suffix: string } | null}
 */
function parseLayerNameWithGeometrySuffix(name) {
  if (name == null || typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed === "") return null;
  // Match hyphen OR underscore before Hebrew suffix
  const re = new RegExp(`^(.*?)[_\\-](${GEOMETRY_SUFFIXES})$`);
  const match = trimmed.match(re);
  if (!match) return null;
  const baseNameRaw = match[1].trim();
  const suffix = match[2];
  return {
    baseNameRaw,
    baseNameNorm: normalizeLayerBaseName(baseNameRaw),
    suffix,
  };
}

if (typeof window !== "undefined") {
  window.normalizeLayerBaseName = normalizeLayerBaseName;
  window.parseLayerNameWithGeometrySuffix = parseLayerNameWithGeometrySuffix;
  window.LayerNameUtils = {
    normalizeLayerBaseName,
    parseLayerNameWithGeometrySuffix,
  };
}

export { normalizeLayerBaseName, parseLayerNameWithGeometrySuffix };
