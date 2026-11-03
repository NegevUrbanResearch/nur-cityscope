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

const TOP_LEVEL_CURVES = new Set(["interpolate", "interpolate-hcl", "interpolate-lab", "step"]);
const LEAF_PRUNE_TOTAL = 1e-4;

function expressionContainsZoom(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  const op = value[0];
  if (op === "literal") return false;
  if (op === "zoom") return true;
  for (let index = 1; index < value.length; index += 1) {
    if (expressionContainsZoom(value[index])) return true;
  }
  return false;
}

function assertOpaqueOpacity(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("opacity goal must be finite");
    return;
  }
  if (!Array.isArray(value) || value.length === 0 || typeof value[0] !== "string") {
    throw new Error("opacity goal must be a finite number or expression");
  }
  if (TOP_LEVEL_CURVES.has(value[0])) {
    throw new Error(`opacity mix rejects top-level ${value[0]}`);
  }
  if (expressionContainsZoom(value)) {
    throw new Error("opacity mix rejects zoom dependency");
  }
}

function mergeLeaves(leaves) {
  const order = [];
  const byKey = new Map();
  for (const leaf of leaves) {
    const key = JSON.stringify(leaf.value);
    const existing = byKey.get(key);
    if (existing) {
      existing.weight += leaf.weight;
      continue;
    }
    const merged = { value: leaf.value, weight: leaf.weight };
    byKey.set(key, merged);
    order.push(merged);
  }
  return order;
}

function combineNumericLeaves(leaves) {
  let numericWeight = 0;
  let numericMass = 0;
  let numericCount = 0;
  const others = [];
  for (const leaf of leaves) {
    if (typeof leaf.value === "number") {
      numericWeight += leaf.weight;
      numericMass += leaf.value * leaf.weight;
      numericCount += 1;
    } else {
      others.push(leaf);
    }
  }
  if (numericCount <= 1) return leaves;
  if (!(numericWeight > 0)) return others.length > 0 ? others : leaves;
  others.push({ value: numericMass / numericWeight, weight: numericWeight });
  return others;
}

function pruneSmallLeaves(leaves) {
  if (leaves.length <= 1) return leaves;
  const order = leaves.map((leaf, index) => ({ index, weight: leaf.weight }));
  order.sort((left, right) => left.weight - right.weight || left.index - right.index);
  const drop = new Set();
  let dropped = 0;
  for (const entry of order) {
    if (drop.size >= leaves.length - 1) break;
    const next = dropped + entry.weight;
    if (next > LEAF_PRUNE_TOTAL) break;
    drop.add(entry.index);
    dropped = next;
  }
  if (drop.size === 0) return leaves;
  return leaves.filter((_, index) => !drop.has(index));
}

function normalizeLeaves(leaves) {
  const total = leaves.reduce((sum, leaf) => sum + leaf.weight, 0);
  if (!(total > 0)) throw new Error("opacity leaves have no positive weight");
  if (leaves.length === 1) return [{ value: leaves[0].value, weight: 1 }];
  return leaves.map((leaf) => ({ value: leaf.value, weight: leaf.weight / total }));
}

function compactLeaves(leaves) {
  return normalizeLeaves(pruneSmallLeaves(combineNumericLeaves(mergeLeaves(leaves))));
}

/**
 * Mix two opaque policy values. t <= 0 returns from and t >= 1 returns to.
 * Finite numbers lerp. A previously emitted sum stays one opaque value.
 * @param {unknown} from
 * @param {unknown} to
 * @param {number} t
 */
export function mixOpacityExpression(from, to, t) {
  assertOpaqueOpacity(from);
  assertOpaqueOpacity(to);
  if (typeof t !== "number" || !(t > 0)) return from;
  if (t >= 1) return to;
  return emitOpacityMix(interpolateOpacityLeaves([{ value: from, weight: 1 }], to, t));
}

/**
 * Scale saved leaf weights by 1-t and add one opaque to-leaf at weight t.
 * Equal values merge by JSON serialization. Retarget compacts locally.
 * @param {Array<{ value: unknown, weight: number }>} fromLeaves
 * @param {unknown} to
 * @param {number} t
 */
export function interpolateOpacityLeaves(fromLeaves, to, t) {
  assertOpaqueOpacity(to);
  if (!Array.isArray(fromLeaves)) throw new Error("opacity leaves must be an array");
  for (const leaf of fromLeaves) assertOpaqueOpacity(leaf.value);
  if (typeof t === "number" && t >= 1) return [{ value: to, weight: 1 }];
  const moving = typeof t === "number" && t > 0;
  const scaled = fromLeaves.map((leaf) => ({
    value: leaf.value,
    weight: leaf.weight * (moving ? 1 - t : 1),
  }));
  if (moving) scaled.push({ value: to, weight: t });
  return compactLeaves(scaled);
}

/**
 * Emit a number when every leaf is numeric. Otherwise emit one flat sum of
 * weighted opaque leaves. A sole weight-1 leaf returns its original value.
 * @param {Array<{ value: unknown, weight: number }>} leaves
 */
export function emitOpacityMix(leaves) {
  if (!Array.isArray(leaves) || leaves.length === 0) throw new Error("opacity mix has no leaves");
  for (const leaf of leaves) assertOpaqueOpacity(leaf.value);
  if (leaves.length === 1 && leaves[0].weight === 1) return leaves[0].value;
  if (leaves.every((leaf) => typeof leaf.value === "number")) {
    return leaves.reduce((sum, leaf) => sum + leaf.value * leaf.weight, 0);
  }
  const terms = leaves.map((leaf) => (leaf.weight === 1 ? leaf.value : ["*", leaf.value, leaf.weight]));
  return terms.length === 1 ? terms[0] : ["+", ...terms];
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

function asBoolean(value) {
  return value === true;
}

/**
 * Evaluate a lifecycle-scaled opacity number or orientation case/mix for one feature.
 * Unknown operators fall back to 1 so a canvas sink cannot blank labels.
 * @param {unknown} value
 * @param {Record<string, unknown>} [properties]
 */
export function evaluateOpacityExpression(value, properties = {}) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value;
  if (!Array.isArray(value) || value.length === 0) return 1;
  const op = value[0];
  if (op === "get") {
    return properties[value[1]];
  }
  if (op === "literal") return value[1];
  if (op === "==") {
    return evaluateOpacityExpression(value[1], properties) === evaluateOpacityExpression(value[2], properties);
  }
  if (op === "in") {
    const needle = evaluateOpacityExpression(value[1], properties);
    const haystack = evaluateOpacityExpression(value[2], properties);
    return Array.isArray(haystack) && haystack.includes(needle);
  }
  if (op === "*") {
    return Number(evaluateOpacityExpression(value[1], properties)) * Number(evaluateOpacityExpression(value[2], properties));
  }
  if (op === "+") {
    let sum = 0;
    for (let index = 1; index < value.length; index += 1) {
      sum += Number(evaluateOpacityExpression(value[index], properties));
    }
    return sum;
  }
  if (op === "case") {
    for (let index = 1; index < value.length - 1; index += 2) {
      if (asBoolean(evaluateOpacityExpression(value[index], properties))) {
        return evaluateOpacityExpression(value[index + 1], properties);
      }
    }
    return evaluateOpacityExpression(value[value.length - 1], properties);
  }
  return 1;
}
