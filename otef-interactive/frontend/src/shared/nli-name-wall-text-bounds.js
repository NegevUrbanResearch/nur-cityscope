export const MODEL_NAME_STROKE_WIDTH = 1;
export const MODEL_NAME_ANTIALIAS_GUARD = 2;

export function modelNameTextBounds(metric) {
  if (!metric || !['width', 'left', 'right', 'ascent', 'descent'].every((key) => Number.isFinite(metric[key])) ||
      metric.width <= 0 || metric.ascent < 0 || metric.descent < 0 ||
      metric.left + metric.right <= 0 || metric.ascent + metric.descent <= 0)
    throw new Error('invalid model name ink metrics');
  const pad = MODEL_NAME_STROKE_WIDTH / 2 + MODEL_NAME_ANTIALIAS_GUARD;
  return { width: metric.left + metric.right + 2 * pad,
    height: metric.ascent + metric.descent + 2 * pad,
    textOffsetX: (metric.left - metric.right) / 2,
    textOffsetY: (metric.ascent - metric.descent) / 2 };
}
