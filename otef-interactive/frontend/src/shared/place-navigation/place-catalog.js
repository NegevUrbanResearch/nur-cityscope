import generatedCatalog from "./place-catalog.generated.js";

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("he")
    .replace(/[\u0591-\u05c7]/g, "");
}

function labelsForPlace(place) {
  return [
    place.name?.he,
    place.name?.en,
    ...(place.aliases?.he || []),
    ...(place.aliases?.en || []),
  ].filter(Boolean);
}

function scorePlace(place, normalizedQuery) {
  if (!normalizedQuery) return place.priority || 100;
  const labels = labelsForPlace(place).map(normalizeText);
  if (labels.some((label) => label === normalizedQuery)) return 0;
  if (labels.some((label) => label.startsWith(normalizedQuery))) return 10;
  if (labels.some((label) => label.includes(normalizedQuery))) return 20;
  return Infinity;
}

export function searchPlaces(query, options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : 8;
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery && !options.includeStarter) return [];
  const canNavigateToPlace =
    typeof options.canNavigateToPlace === "function"
      ? options.canNavigateToPlace
      : () => true;

  return generatedCatalog.entries
    .filter((place) => place.selectable && canNavigateToPlace(place) !== false)
    .map((place) => ({ place, score: scorePlace(place, normalizedQuery) }))
    .filter((entry) => entry.score !== Infinity)
    .sort(
      (a, b) => a.score - b.score || (a.place.priority || 100) - (b.place.priority || 100),
    )
    .slice(0, limit)
    .map((entry) => entry.place);
}

export default generatedCatalog;
