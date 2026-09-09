import { NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";
import { INVESTIGATION_POLYGONS_FULL_ID } from "./nli-investigation-beats.js";

export const NLI_LEGEND_SHORT_LABELS = Object.freeze({
  "מרחב לחימה - קרב": "קרב",
  "מוקד חטיפה": "חטיפה",
  "שריפה": "שריפה",
});

export function polygonGroupEnabled(layerGroups) {
  const groups = Array.isArray(layerGroups) ? layerGroups : [];
  for (const group of groups) {
    if (group?.id !== "nli") continue;
    for (const layer of group.layers || []) {
      if (`${group.id}.${layer.id}` === INVESTIGATION_POLYGONS_FULL_ID) return layer.enabled === true;
    }
  }
  return false;
}

export function investigationPolygonLegendItems() {
  return Object.keys(NLI_LEGEND_SHORT_LABELS).map((notes) => ({
    label: NLI_LEGEND_SHORT_LABELS[notes],
    fill: NLI_VISUAL_TOKENS.polygonCategories[notes].fill,
    stroke: NLI_VISUAL_TOKENS.polygonCategories[notes].outline,
    shape: "polygon",
  }));
}
