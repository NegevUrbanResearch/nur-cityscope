const GRADIENT_EPSILON = 0.00015;

function segmentLengthApprox(a, b) {
  const latScale = Math.cos((((a[1] + b[1]) * Math.PI) / 180) / 2);
  return Math.hypot((b[0] - a[0]) * Math.max(0.0001, latScale), b[1] - a[1]);
}

export function buildLinePathMetrics(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return { cumulative: [0], total: 0 };
  const cumulative = [0];
  for (let index = 1; index < coords.length; index += 1) {
    cumulative.push(cumulative[index - 1] + segmentLengthApprox(coords[index - 1], coords[index]));
  }
  return { cumulative, total: cumulative[cumulative.length - 1] || 0 };
}

export function pointAtLineProgress(coords, metrics, fraction) {
  if (!Array.isArray(coords) || coords.length === 0) return null;
  const total = Number(metrics?.total);
  if (coords.length === 1 || !Number.isFinite(total) || total <= 0) return coords[0];
  const cumulative = Array.isArray(metrics?.cumulative) ? metrics.cumulative : [0];
  const target = Math.min(1, Math.max(0, Number(fraction) || 0)) * total;
  let segment = 0;
  while (segment < cumulative.length - 1 && cumulative[segment + 1] < target) segment += 1;
  const start = coords[segment];
  const end = coords[Math.min(segment + 1, coords.length - 1)];
  const startLength = cumulative[segment];
  const endLength = cumulative[Math.min(segment + 1, cumulative.length - 1)];
  const local = Math.min(1, Math.max(0, (target - startLength) / Math.max(1e-12, endLength - startLength)));
  return [start[0] + (end[0] - start[0]) * local, start[1] + (end[1] - start[1]) * local];
}

export function buildLineProgressGradient(fraction, opaqueColor, transparentColor) {
  const t = Math.min(1, Math.max(0, Number(fraction) || 0));
  if (t <= GRADIENT_EPSILON) {
    return ["interpolate", ["linear"], ["line-progress"], 0, opaqueColor, GRADIENT_EPSILON, transparentColor, 1, transparentColor];
  }
  if (t >= 1 - GRADIENT_EPSILON) {
    return ["interpolate", ["linear"], ["line-progress"], 0, opaqueColor, 1 - GRADIENT_EPSILON, opaqueColor, 1, transparentColor];
  }
  return ["interpolate", ["linear"], ["line-progress"], 0, opaqueColor, t, opaqueColor, t + GRADIENT_EPSILON, transparentColor, 1, transparentColor];
}
