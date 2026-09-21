// Canonical popup copy for investigation polygon Notes values.
export const NLI_INVESTIGATION_CATEGORY_LABELS = Object.freeze([
  Object.freeze({ key: "מרחב לחימה - קרב", label: "מוקד קרב/טבח" }),
  Object.freeze({ key: "שריפה", label: "מוקד שריפה" }),
  Object.freeze({ key: "מוקד חטיפה", label: "מוקד חטיפה" }),
]);

function investigationClasses(style) {
  return Array.isArray(style?.uniqueValues?.classes) ? style.uniqueValues.classes : [];
}

/**
 * Convert an outside-to-inside color ramp to the legend's existing CSS fill
 * contract. Each centered, hard-edged rectangle is a separate background.
 * Optional processed opacities are paired with the colors so a buffered
 * gradient's discrete falloff remains visible at legend size.
 */
export function resolvedColorsToLegendFill(resolvedColors, resolvedOpacities = null) {
  const colors = Array.isArray(resolvedColors)
    ? resolvedColors.filter((color) => typeof color === "string" && color.trim())
    : [];
  if (colors.length === 0) return null;
  const opacities = Array.isArray(resolvedOpacities)
    && resolvedOpacities.length === colors.length
    && resolvedOpacities.every((opacity) => typeof opacity === "number" && Number.isFinite(opacity) && opacity >= 0 && opacity <= 1)
    ? resolvedOpacities
    : null;
  const cssColor = (color, opacity) => {
    if (opacity == null) return color;
    const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
    if (!match) return color;
    const channels = [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16));
    return `rgba(${channels.join(", ")}, ${opacity})`;
  };
  const step = 100 / colors.length;
  return colors
    .map((color, index) => ({ color: cssColor(color, opacities?.[index]), size: 100 - index * step }))
    .reverse()
    .map(({ color, size }) => `linear-gradient(${color} 0 0) center / ${size}% ${size}% no-repeat`)
    .join(", ");
}

/** Resolve a raw Notes value to the exact display label used by the legend. */
export function resolveInvestigationPolygonDisplayLabel(value, rawStyle = null) {
  const key = value == null ? "" : String(value);
  const classEntry = investigationClasses(rawStyle).find((entry) => String(entry?.value) === key);
  if (classEntry && classEntry.displayLabel != null) return String(classEntry.displayLabel);
  return NLI_INVESTIGATION_CATEGORY_LABELS.find((entry) => entry.key === key)?.label || value;
}
