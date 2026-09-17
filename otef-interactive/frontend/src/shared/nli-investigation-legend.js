import { NLI_VISUAL_TOKENS } from "./nli-investigation-theme.js";
import { INVESTIGATION_POLYGONS_FULL_ID } from "./nli-investigation-beats.js";

// Keep this order explicit: it is shared by both legend surfaces and is also
// the safe fallback when a fixture has no processed style metadata.
export const NLI_INVESTIGATION_CATEGORY_FALLBACKS = Object.freeze([
  Object.freeze({ key: "מרחב לחימה - קרב", label: "מוקד קרב/טבח" }),
  Object.freeze({ key: "שריפה", label: "מוקד שריפה" }),
  Object.freeze({ key: "מוקד חטיפה", label: "מוקד חטיפה" }),
]);

// Retain the historical export without duplicating the fallback literals.
export const NLI_LEGEND_SHORT_LABELS = Object.freeze(
  Object.fromEntries(NLI_INVESTIGATION_CATEGORY_FALLBACKS.map(({ key, label }) => [key, label])),
);

function investigationClasses(style) {
  return Array.isArray(style?.uniqueValues?.classes) ? style.uniqueValues.classes : [];
}

function symbolLayersFor(classEntry) {
  return Array.isArray(classEntry?.symbol?.symbolLayers) ? classEntry.symbol.symbolLayers : [];
}

/**
 * Convert an outside-to-inside color ramp to the legend's existing CSS fill
 * contract. Each centered, hard-edged rectangle is a separate background.
 */
export function resolvedColorsToLegendFill(resolvedColors) {
  const colors = Array.isArray(resolvedColors)
    ? resolvedColors.filter((color) => typeof color === "string" && color.trim())
    : [];
  if (colors.length === 0) return null;
  const step = 100 / colors.length;
  return colors
    .map((color, index) => ({ color: color.trim(), size: 100 - index * step }))
    .reverse()
    .map(({ color, size }) => `linear-gradient(${color} 0 0) center / ${size}% ${size}% no-repeat`)
    .join(", ");
}

/** Resolve a raw Notes value to the exact display label used by the legend. */
export function resolveInvestigationPolygonDisplayLabel(value, rawStyle = null) {
  const key = value == null ? "" : String(value);
  const classEntry = investigationClasses(rawStyle).find((entry) => String(entry?.value) === key);
  if (classEntry && classEntry.displayLabel != null) return String(classEntry.displayLabel);
  return NLI_INVESTIGATION_CATEGORY_FALLBACKS.find((entry) => entry.key === key)?.label || value;
}

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

export function investigationPolygonLegendItems(rawStyle = null) {
  const classes = investigationClasses(rawStyle);
  return NLI_INVESTIGATION_CATEGORY_FALLBACKS.map(({ key, label: fallbackLabel }) => {
    const classEntry = classes.find((entry) => String(entry?.value) === key);
    const layers = symbolLayersFor(classEntry);
    const gradient = layers.find((layer) =>
      layer?.type === "fill" && layer?.fillType === "gradient" && layer?.enable !== false && Array.isArray(layer.resolvedColors),
    );
    const solid = layers.find((layer) => layer?.type === "fill" && layer?.fillType !== "gradient" && layer?.enable !== false);
    const stroke = layers.find((layer) => layer?.type === "stroke" && layer?.enable !== false);
    const token = NLI_VISUAL_TOKENS.polygonCategories[key];
    const fill = key === "מוקד חטיפה"
      ? "#ffff73"
      : resolvedColorsToLegendFill(gradient?.resolvedColors) || solid?.color || token?.fill || NLI_VISUAL_TOKENS.polygonFallbackFill;
    return {
      label: classEntry?.displayLabel != null ? String(classEntry.displayLabel) : fallbackLabel,
      fill,
      // A processed class is authoritative: no enabled authored stroke is an
      // explicit no-border result, not permission to revive legacy tokens.
      stroke: classEntry ? (stroke?.color || "transparent") : (stroke?.color || token?.outline),
      shape: "polygon",
    };
  });
}
