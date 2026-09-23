/**
 * Shared canvas painter for Murdered-in-captivity people markers and legends.
 * Ribbon-yellow disc with a top-entry dried-blood radial stain.
 */

export const RIBBON_YELLOW = "#FFD100";
export const CAPTIVITY_BLOOD_RGB = Object.freeze({ r: 154, g: 36, b: 30 });
export const KIDNAP_SURVIVOR_STATUS = "Kidnap survivor";
export const MURDERED_IN_CAPTIVITY_STATUS = "Murdered in captivity";
export const CAPTIVITY_STROKE_TO_RADIUS = 0.125;

export const CAPTIVITY_BLEED_GRADIENT_STOPS = Object.freeze([
  Object.freeze([0, "rgba(154, 36, 30, 0.96)"]),
  Object.freeze([0.22, "rgba(154, 36, 30, 0.7)"]),
  Object.freeze([0.4, "rgba(154, 36, 30, 0.34)"]),
  Object.freeze([0.58, "rgba(154, 36, 30, 0.14)"]),
  Object.freeze([0.78, "rgba(154, 36, 30, 0.04)"]),
  Object.freeze([1, "rgba(154, 36, 30, 0)"]),
]);

const SPEC_REV = "v1";

function createCanvas2DContext(size) {
  if (typeof document !== "undefined" && document.createElement) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    return { canvas, ctx, getImageData: () => ctx.getImageData(0, 0, size, size) };
  }
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    return { canvas, ctx, getImageData: () => ctx.getImageData(0, 0, size, size) };
  }
  return null;
}

/**
 * Paint yellow disc + top-bleed stain + white stroke.
 * `r` is the disc radius the stroke is centered on.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ cx: number, cy: number, r: number }} geometry
 */
export function paintCaptivityBleedMarker(ctx, { cx, cy, r }) {
  if (!ctx || !(r > 0)) return;
  const strokeWidth = r * CAPTIVITY_STROKE_TO_RADIUS;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = RIBBON_YELLOW;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  const gx = cx;
  const gy = cy - r * 0.9;
  const g = ctx.createRadialGradient(gx, gy, r * 0.06, gx, gy, r * 2.05);
  for (const [offset, color] of CAPTIVITY_BLEED_GRADIENT_STOPS) {
    g.addColorStop(offset, color);
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = strokeWidth;
  ctx.stroke();
}

/**
 * @param {{ radius: number }} options
 * @returns {{ imageId: string, radius: number, side: number, pad: number }}
 */
export function buildCaptivityBleedImageSpec({ radius } = {}) {
  const r = Number(radius);
  if (!Number.isFinite(r) || r <= 0) return null;
  const strokeWidth = r * CAPTIVITY_STROKE_TO_RADIUS;
  const pad = Math.max(1, Math.ceil(strokeWidth / 2) + 1);
  const side = Math.max(1, Math.ceil(2 * r + 2 * pad));
  const imageId = `otef_captivity_bleed_${SPEC_REV}_${String(r)}_${String(side)}`.replace(
    /[^a-zA-Z0-9_#.]/g,
    "_",
  );
  return { imageId, radius: r, side, pad };
}

/**
 * @param {{ imageId?: string, radius: number, side?: number }} spec
 * @returns {ImageData}
 */
export function createCaptivityBleedImageData(spec) {
  const r = Number(spec?.radius);
  if (!Number.isFinite(r) || r <= 0) {
    throw new Error("[captivity-bleed-marker] Invalid captivity bleed spec.");
  }
  const strokeWidth = r * CAPTIVITY_STROKE_TO_RADIUS;
  const pad = Number(spec?.pad) > 0 ? Number(spec.pad) : Math.max(1, Math.ceil(strokeWidth / 2) + 1);
  const side =
    typeof spec?.side === "number" && spec.side > 0
      ? spec.side
      : Math.max(1, Math.ceil(2 * r + 2 * pad));
  const ctx2d = createCanvas2DContext(side);
  if (!ctx2d) {
    throw new Error("[captivity-bleed-marker] requires a 2D canvas (browser / OffscreenCanvas).");
  }
  const { ctx, getImageData } = ctx2d;
  ctx.clearRect(0, 0, side, side);
  paintCaptivityBleedMarker(ctx, { cx: side / 2, cy: side / 2, r });
  return getImageData();
}

/**
 * Data URL for GIS legend swatches. Returns null when canvas is unavailable.
 * @param {{ radius?: number }} [options]
 * @returns {string|null}
 */
export function captivityBleedDataUrl({ radius = 8 } = {}) {
  const r = Number(radius);
  if (!Number.isFinite(r) || r <= 0) return null;
  const strokeWidth = r * CAPTIVITY_STROKE_TO_RADIUS;
  const pad = Math.max(1, Math.ceil(strokeWidth / 2) + 1);
  const side = Math.max(1, Math.ceil(2 * r + 2 * pad));
  const ctx2d = createCanvas2DContext(side);
  if (!ctx2d?.canvas) return null;
  const { canvas, ctx } = ctx2d;
  ctx.clearRect(0, 0, side, side);
  paintCaptivityBleedMarker(ctx, { cx: side / 2, cy: side / 2, r });
  if (typeof canvas.toDataURL !== "function") return null;
  return canvas.toDataURL("image/png");
}
