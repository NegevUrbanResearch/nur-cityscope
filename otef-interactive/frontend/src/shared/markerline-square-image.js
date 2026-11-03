/**
 * Raster image for maplibre `symbol` + `icon-image` (markerLine square along line).
 * Colors are baked in; one image id per distinct fill/stroke/size.
 */

const SPEC_REV = "v1";

function createCanvas2DContext(size) {
  if (typeof document !== "undefined" && document.createElement) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    return { ctx, getImageData: () => ctx.getImageData(0, 0, size, size) };
  }
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    return { ctx, getImageData: () => ctx.getImageData(0, 0, size, size) };
  }
  return null;
}

/**
 * @param {object} [symbolLayer]
 * @param {object} [symbolLayer.marker]
 * @param {{ rotate?: number }} [options]
 * @returns {{ imageId: string, size: number, fill: string, stroke: string, strokeWidth: number, side: number, pad: number, rotate?: number }|null}
 */
export function buildMarkerLineSquareImageSpec(symbolLayer, options = {}) {
  if (!symbolLayer || typeof symbolLayer !== "object") return null;
  const marker = symbolLayer.marker || {};
  const size =
    typeof marker.size === "number" && marker.size > 0
      ? marker.size
      : 5;
  const fill =
    (marker.fillColor != null && String(marker.fillColor) !== "" && marker.fillColor) ||
    (marker.fill != null && String(marker.fill) !== "" && marker.fill) ||
    (marker.color != null && String(marker.color) !== "" && marker.color) ||
    "#000000";
  const strokeColor =
    (marker.stroke != null && String(marker.stroke) !== "" && marker.stroke) ||
    (marker.strokeColor != null && String(marker.strokeColor) !== "" && marker.strokeColor) ||
    fill;
  const strokeWidth =
    typeof marker.strokeWidth === "number" && marker.strokeWidth > 0
      ? marker.strokeWidth
      : 1;
  const shape = String(marker.shape || "").toLowerCase();
  const rotateOpt = Number(options.rotate);
  const rotate = shape === "diamond" ? 45 : Number.isFinite(rotateOpt) ? rotateOpt : 0;
  const pad = Math.max(1, Math.ceil(strokeWidth / 2) + 1);
  const box = rotate ? size * Math.SQRT2 : size;
  const side = Math.max(1, Math.ceil(box + 2 * pad + 2));
  const rotatePart = rotate ? `_r${rotate}` : "";
  const imageId = `otef_mlsq_${SPEC_REV}_${String(fill)}_${String(strokeColor)}_${String(size)}_${String(strokeWidth)}_${String(side)}${rotatePart}`.replace(
    /[^a-zA-Z0-9_#]/g,
    "_",
  );
  const spec = { imageId, size, fill, stroke: strokeColor, strokeWidth, side, pad };
  if (rotate) spec.rotate = rotate;
  return spec;
}

/**
 * @param {object} spec - from `buildMarkerLineSquareImageSpec`
 * @returns {ImageData}
 */
export function createMarkerLineSquareImageData(spec) {
  if (!spec || !spec.imageId) {
    throw new Error("[markerline-square-image] Invalid marker line square spec.");
  }
  const { side, size, fill, stroke, strokeWidth } = spec;
  const w = typeof side === "number" && side > 0 ? side : 8;
  const ctx2d = createCanvas2DContext(w);
  if (!ctx2d) {
    throw new Error("[markerline-square-image] requires a 2D canvas (browser / OffscreenCanvas).");
  }
  const { ctx, getImageData } = ctx2d;
  ctx.clearRect(0, 0, w, w);
  const cx = w / 2;
  const cy = w / 2;
  const half = size / 2;
  const rotate = Number(spec.rotate) || 0;
  ctx.fillStyle = String(fill);
  ctx.strokeStyle = String(stroke);
  ctx.lineWidth = strokeWidth;
  // Standards-based Canvas2D uses lineJoin property (not setLineJoin()).
  // Keep a defensive fallback for non-standard/mocked contexts.
  if (typeof ctx.setLineJoin === "function") ctx.setLineJoin("miter");
  else ctx.lineJoin = "miter";
  ctx.save();
  ctx.translate(cx, cy);
  if (rotate) ctx.rotate((rotate * Math.PI) / 180);
  ctx.fillRect(-half, -half, size, size);
  if (strokeWidth > 0) {
    ctx.strokeRect(-half, -half, size, size);
  }
  ctx.restore();
  return getImageData();
}
