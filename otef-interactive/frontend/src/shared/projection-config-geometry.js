import { normalizeRotationDeg } from './nli-name-wall-config.js';

export function outputToT3({ u, v }, { crop: c, post: p }) {
  const gain = p.scale * Math.min(1 / (c.x1 - c.x0), 1 / (c.y1 - c.y0));
  return { u: (c.x0 + c.x1) / 2 + (u - 0.5 - p.tx) / gain, v: (c.y0 + c.y1) / 2 + (v - 0.5 - p.ty) / gain };
}

export function t3ToOutput({ u, v }, { crop: c, post: p }) {
  const gain = p.scale * Math.min(1 / (c.x1 - c.x0), 1 / (c.y1 - c.y0));
  return { u: 0.5 + gain * (u - (c.x0 + c.x1) / 2) + p.tx, v: 0.5 + gain * (v - (c.y0 + c.y1) / 2) + p.ty };
}

export function visibleT3Rect(branch) {
  const a = outputToT3({ u: 0, v: 0 }, branch); const b = outputToT3({ u: 1, v: 1 }, branch);
  const x0 = Math.max(0, branch.crop.x0, Math.min(a.u, b.u)); const x1 = Math.min(1, branch.crop.x1, Math.max(a.u, b.u));
  const y0 = Math.max(0, branch.crop.y0, Math.min(a.v, b.v)); const y1 = Math.min(1, branch.crop.y1, Math.max(a.v, b.v));
  return x1 - x0 > 0 && y1 - y0 > 0 ? { x0, x1, y0, y1 } : null;
}
export function containsUv(rect, { u, v }) { return Boolean(rect && u >= rect.x0 && u <= rect.x1 && v >= rect.y0 && v <= rect.y1); }

/** Existing name-field reference plane to the composed texture for one output. */
export function planeToOutputUv([x, y], config, side, logicalPlane = {}) {
  const pre = config.pre;
  const planeScale = logicalPlane.planeScale ?? pre.scale * Math.min(config.outputs.left.post.scale, config.outputs.right.post.scale);
  const degrees = logicalPlane.heading ?? 41;
  const heading = (Number.isFinite(degrees) ? normalizeRotationDeg(degrees) : degrees) * Math.PI / 180;
  if (![x, y, planeScale, heading].every(Number.isFinite) || planeScale <= 0) throw new Error('invalid name plane coordinate');
  const rotate = ([a, b], angle) => [a * Math.cos(angle) - b * Math.sin(angle), a * Math.sin(angle) + b * Math.cos(angle)];
  const headed = rotate([x / planeScale, y / planeScale], heading);
  const translated = [headed[0] + pre.tx * 1920, headed[1] + pre.ty * 1080];
  const scaled = rotate(translated, -pre.rotateDeg * Math.PI / 180);
  return t3ToOutput({ u: 0.5 + scaled[0] * pre.scale / 1920, v: 0.5 + scaled[1] * pre.scale / 1080 }, config.outputs[side]);
}
