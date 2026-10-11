const fields = ["x", "y", "width", "height", "lineHeight", "swatchScale"];

function geometry(from, to, fraction, fromScale, toScale, scale) {
  const result = { ...to };
  for (const field of fields) {
    if (Number.isFinite(from?.[field]) && Number.isFinite(to?.[field])) {
      result[field] = (from[field] * fromScale * (1 - fraction) + to[field] * toScale * fraction) / scale;
    }
  }
  return result;
}

/** Blend relative glyph geometry as well as the row anchor when fit scale changes. */
export function interpolateLegendPlacement(from, to, fraction) {
  if (!from?.placement || !to?.placement || fraction >= 1) return to;
  if (fraction <= 0) return from;
  const a = from.placement, b = to.placement;
  const fromScale = from.fitScale ?? 1, toScale = to.fitScale ?? 1;
  const scale = fromScale + (toScale - fromScale) * fraction;
  const blend = (a, b) => geometry(a, b, fraction, fromScale, toScale, scale);
  return {
    ...blend(from, to),
    fitScale: scale,
    font: (from.font * fromScale * (1 - fraction) + to.font * toScale * fraction) / scale,
    placement: {
      ...blend(a, b),
      labelGeometry: blend(a.labelGeometry, b.labelGeometry),
      symbolGeometry: {
        ...blend(a.symbolGeometry, b.symbolGeometry),
        components: b.symbolGeometry.components.map((component, index) =>
          blend(a.symbolGeometry.components[index], component)),
      },
    },
  };
}
