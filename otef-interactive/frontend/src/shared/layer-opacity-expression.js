const CHANNELS = Object.freeze({
  fill: Object.freeze(["fill-opacity"]),
  line: Object.freeze(["line-opacity"]),
  circle: Object.freeze(["circle-opacity", "circle-stroke-opacity"]),
  symbol: Object.freeze(["icon-opacity", "text-opacity"]),
  raster: Object.freeze(["raster-opacity"]),
});

export function opacityChannelsForLayerType(type) {
  const channels = CHANNELS[type];
  return channels ? [...channels] : [];
}

function scaleMatch(expr, factor) {
  const out = [expr[0], expr[1]];
  for (let i = 2; i < expr.length - 1; i += 2) {
    out.push(expr[i], scaleOpacityExpression(expr[i + 1], factor));
  }
  out.push(scaleOpacityExpression(expr[expr.length - 1], factor));
  return out;
}

function scaleCase(expr, factor) {
  const out = [expr[0]];
  for (let i = 1; i < expr.length - 1; i += 2) {
    out.push(expr[i], scaleOpacityExpression(expr[i + 1], factor));
  }
  out.push(scaleOpacityExpression(expr[expr.length - 1], factor));
  return out;
}

function scaleInterpolate(expr, factor) {
  const out = [expr[0], expr[1], expr[2]];
  for (let i = 3; i < expr.length; i += 2) {
    out.push(expr[i], scaleOpacityExpression(expr[i + 1], factor));
  }
  return out;
}

function scaleStep(expr, factor) {
  const out = [expr[0], expr[1], scaleOpacityExpression(expr[2], factor)];
  for (let i = 3; i < expr.length; i += 2) {
    out.push(expr[i], scaleOpacityExpression(expr[i + 1], factor));
  }
  return out;
}

function scaleLet(expr, factor) {
  const out = expr.slice(0, -1);
  out.push(scaleOpacityExpression(expr[expr.length - 1], factor));
  return out;
}

function scaleExpression(expr, factor) {
  const op = expr[0];
  if (op === "let") return scaleLet(expr, factor);
  if (op === "match") return scaleMatch(expr, factor);
  if (op === "case") return scaleCase(expr, factor);
  if (op === "interpolate" || op === "interpolate-hcl" || op === "interpolate-lab") {
    return scaleInterpolate(expr, factor);
  }
  if (op === "step") return scaleStep(expr, factor);
  return ["*", expr, factor];
}

/**
 * Scale an authored opacity value by a lifecycle factor.
 * Factor 1 returns the same value. Zoom interpolate/step stay top-level,
 * match/case keep their classification, and an outer let keeps its bindings.
 * @param {unknown} value
 * @param {number} factor
 */
export function scaleOpacityExpression(value, factor) {
  if (factor === 1) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value * factor;
  if (!Array.isArray(value)) return value;
  return scaleExpression(value, factor);
}

/**
 * Copy paint with this layer type's lifecycle opacity channels scaled.
 * Omitted channels use default 1 while fading and are absent again at factor 1.
 * @param {string} layerType
 * @param {Record<string, unknown>|null|undefined} paint
 * @param {number} factor
 */
export function paintWithOpacityFactor(layerType, paint, factor) {
  const channels = CHANNELS[layerType];
  if (!channels) return paint;
  const source = paint && typeof paint === "object" ? paint : {};
  const next = { ...source };
  for (const channel of channels) {
    const present = Object.prototype.hasOwnProperty.call(source, channel);
    if (factor === 1) {
      if (!present) delete next[channel];
      continue;
    }
    next[channel] = scaleOpacityExpression(present ? source[channel] : 1, factor);
  }
  return next;
}
