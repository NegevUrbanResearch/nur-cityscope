/** Fire sites remain in the source data but are excluded from the exhibit. */
export function investigationCategoryVisible(value) {
  return value !== "שריפה";
}

const filteredBags = new WeakMap();

export function visibleInvestigationFeatures(features) {
  if (!Array.isArray(features)) return [];
  if (!filteredBags.has(features)) {
    const visible = features.filter(feature => investigationCategoryVisible(feature?.properties?.Notes));
    filteredBags.set(features, visible.length === features.length ? features : visible);
  }
  return filteredBags.get(features);
}

export const INVESTIGATION_VISIBILITY_FILTER = ["!=", ["get", "Notes"], "שריפה"];
