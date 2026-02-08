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
