export const MODEL_NAME_STROKE_WIDTH = 2;
export const MODEL_NAME_ANTIALIAS_GUARD = 2;

export function modelNameTextBounds(metric, strokeWidth = MODEL_NAME_STROKE_WIDTH) {
  if (!metric || !['width', 'left', 'right', 'ascent', 'descent'].every((key) => Number.isFinite(metric[key])) ||
      metric.width <= 0 || metric.ascent < 0 || metric.descent < 0 ||
      metric.left + metric.right <= 0 || metric.ascent + metric.descent <= 0 ||
      !Number.isFinite(strokeWidth) || strokeWidth < 1 || strokeWidth > 6)
    throw new Error('invalid model name ink metrics');
  const pad = strokeWidth / 2;
  return { width: metric.left + metric.right + 2 * pad,
    height: metric.ascent + metric.descent + 2 * pad,
    textOffsetX: (metric.left - metric.right) / 2,
    textOffsetY: (metric.ascent - metric.descent) / 2 };
}
